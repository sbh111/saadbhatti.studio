# kafkaEventsPlan.md — Event streaming to Kafka (learning phase, toggleable)

> **Status:** Phase K1 implemented on the `kafka-events` branch (app-side capture,
> the like button, the toggle, and the local Kafka + collector stack). K2 is AWS
> deployment; K3 is the Python consumer — both still pending.
> For how the existing system is put together, see [architecture.md](architecture.md).

## Context

Stream page views, clicks, and artwork interactions from the live site into a Kafka broker
running in Docker on an AWS free-tier EC2 instance, then consume and analyze that stream
from a local Python program. The goal is hands-on Kafka experience worth putting on a
resume.

This is **explicitly a learning feature, not core to the site** — it must be switchable off
from an admin settings page, must never break the site when off or when the broker is
unreachable, and must not silently burn free-tier hours.

Unlike the earlier Kafka idea (queueing inquiry notifications — genuinely a bad fit), a
**clickstream is the canonical Kafka use case**, so this design is defensible in an
interview rather than something bolted on for the résumé line.

## Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Transport | **HTTP collector on EC2**; Vercel POSTs JSON, collector produces to Kafka on localhost | Kafka is **never exposed to the internet** (it has no auth by default — an open 9092 gets scanned and abused). Also avoids per-invocation TCP handshakes from serverless. Matches how real clickstream systems are built. |
| Collector | **Python / FastAPI** | Same toolchain as the Phase K3 consumer — learn one Kafka client for both produce and consume. |
| Client sending | **Batch + `navigator.sendBeacon`** | ~5–10× fewer requests; `sendBeacon` survives page unload, so exit events aren't lost. |
| Toggle | **DB-backed, default OFF** | Fresh deploys never stream until deliberately enabled. Flipped from `/admin/settings`. |
| Failure model | **Best-effort, never blocks** | Same contract as the mail phase: forwarding happens in `after()`, all errors swallowed, endpoint always returns 204. A dead broker must be invisible to visitors. |
| Repo layout | `collector/` directory in this repo | Versioned alongside the app; Vercel ignores it. |
| Interest signal | **Like button under each artwork** — durable Postgres row, private count | The only *explicit* interest signal (vs. the passive/proxy ones). Persists independent of the toggle, so the button is honest whether streaming is on or off; Kafka gets `artwork_like` as a bonus. |

## Architecture

```
Browser (client component)
  └─ queue events → flush on timer / pagehide (sendBeacon)
       └─ POST /api/events            ← Vercel, dynamic ƒ
            ├─ toggle off? → 204, stop here
            ├─ enrich: ipHash, geo, receivedAt
            └─ after() → POST https://ingest.saadbhatti.studio/events   (bearer token, TLS)
                              └─ EC2: FastAPI collector
                                   └─ produce → Kafka (localhost:9092, KRaft)
                                        └─ topic web.events.v1, key = sessionId
                                             └─ Phase K3: local Python consumer → pandas/matplotlib
```

Kafka's port is **closed in the security group**. Only the collector's HTTPS port is open.

**Likes take a parallel path** (deliberate, durable, not part of the client batch):

```
LikeButton (client) → POST /api/likes → Postgres row (durable, deduped by ipHash)
                                          └─ after() → collector (artwork_like, key = sessionId)  [only if toggle on & not admin]
```

---

## Phase K1 — App-side capture + toggle (fully local, no AWS)

Everything here is testable against local Docker; K2 only swaps the collector URL.

### Data + settings

**`prisma/schema.prisma`** — generic key/value settings table (future toggles reuse it):

```prisma
model Setting {
  key       String   @id @db.VarChar(64)
  value     String   @db.VarChar(255)
  updatedAt DateTime @updatedAt
  @@map("settings")
}
```

Migration: `npx prisma migrate dev --name add_settings`. Key: `event_streaming_enabled`.

**NEW `lib/settings.ts`** (server-only) — `getSetting` / `setSetting`, plus
`isEventStreamingEnabled()` with a **module-level ~60s TTL cache** so the hot ingest path
doesn't hit Postgres per request. Note the tradeoff in a comment: serverless means many
instances, so flipping the toggle propagates within ~60s rather than instantly — fine for
analytics, and the client-side config check (below) makes the common case immediate.

### Event schema

**NEW `lib/eventTypes.ts`** — client-safe (no server imports), mirroring the
`lib/inquiryLimits.ts` precedent so the tracker and the API validate against one definition:

```ts
export const EVENT_SCHEMA_VERSION = 1;
export type EventType =
  | "page_view" | "click" | "artwork_view" | "artwork_intent"
  | "artwork_like";                         // server-emitted by /api/likes, not the client batch
export interface ClientEvent {
  v: number; type: EventType; ts: string;   // ISO8601, client clock
  sessionId: string;                        // uuid, sessionStorage (dies with the tab)
  path: string; referrer: string | null;
  artworkPublicId?: string;                 // artwork_* events
  target?: string;                          // click: semantic label, never a raw selector
  gesture?: "middle_click" | "modifier_click" | "context_menu";
  viewport?: { w: number; h: number };
}
export const MAX_BATCH = 25;
export const FLUSH_INTERVAL_MS = 15_000;
```

Server enriches each event with `ipHash`, `country` (Vercel geo header — verify header name
at build time), `userAgent`, and `receivedAt`.

**What the event types capture:**

| Type | Trigger |
|---|---|
| `page_view` | Route change (`usePathname`) — client-side nav, so this is the only way to see it |
| `click` | Delegated listener on nav + artwork links |
| `artwork_view` | `IntersectionObserver`: artwork ≥50% visible for ≥1s — *which photos actually get looked at* |
| `artwork_intent` | Right-click / middle-click / ⌘-click on an artwork (proxy for "open in new tab") |
| `artwork_like` | **Explicit like** — the strongest signal; durable in Postgres, **server-emitted** by `/api/likes` (see below), not the client batch |

> **Honest limitation:** "opened the image in a new tab" is **not observable** from the origin
> page — the browser gives you nothing after the tab opens. `artwork_intent` captures the
> gestures that *precede* it (context menu, middle-click, modifier-click), which is the
> closest real proxy. Worth knowing before reading the numbers as literal "opens."

### Capture + endpoints

**NEW `components/EventTracker.tsx`** (client, mounted once in `AppShell`) — a queue that
flushes on a timer and on `pagehide`/`visibilitychange` via `sendBeacon`. Suppressed when:
`useIsAdmin()` (reuse the existing context — don't track yourself), config says disabled,
or `navigator.doNotTrack` is set. Wrapped so it can never throw into render.

> `sendBeacon` sends `text/plain` unless you pass a `Blob` with an explicit type — send
> `new Blob([json], { type: "application/json" })` or the route will reject the body.

**NEW `app/api/events/route.ts`** — public POST. Deliberately **not** under `/api/admin/`
(the proxy matcher would 401 every visitor — same reasoning as `/api/inquiries`). Pipeline:
toggle check → validate batch (size, known types, field lengths) → enrich → `after()`
forwards to the collector with a bearer token → **always 204**, even if the collector is
down.

**NEW `app/api/events/config/route.ts`** — public GET returning `{ enabled }`, short
`Cache-Control`. The tracker fetches this once per session, mirroring the existing
`AdminProvider` → `/api/admin/session` pattern. This is what keeps the public pages static:
the server never reads the toggle during page render.

### Likes — durable interest signal (the like button)

The like is the one **explicit** signal, so it gets first-class durable treatment rather than
living only in the ephemeral client batch — the button stays honest even when streaming is off.

- **`prisma/schema.prisma`** — a `Like` row deduped one-per-visitor via `@@unique([artworkPublicId, ipHash])`;
  the unique constraint **is** the rate limiter (one like per artwork per IP), so no extra throttling.
- **`components/LikeButton.tsx`** (client) — mounts in `ArtworkBlock`'s `<figcaption>`, taking
  `publicId={artwork.image}`. State is **localStorage-only** (heart fills on mount, **zero network on
  load** → the collection pages stay statically prerendered). **No public count.** Hidden for admins
  (matches `InquiryForm`). Sends the tab's `sessionId` so the Kafka event keeps its partition key.
- **`app/api/likes/route.ts`** — public `POST`/`DELETE`, near-clone of `/api/inquiries`: validate the
  artwork via `getArtworkIndex()`, `hashIp(clientIpOf())`, `create` and swallow the `P2002` unique
  violation (idempotent). **Server-side `isAdmin()` is a no-op.** New like → `after()` emits an
  `artwork_like` via the same collector helper `/api/events` uses (only when the toggle is on).
- **`app/admin/likes/page.tsx`** — clone of `/admin/comments`: `force-dynamic`, `isAdmin()` guard,
  one `prisma.like.groupBy` ranked desc, resolved via `getArtworkIndex()`. The **private count**
  surface — works with or without Kafka.

### Admin settings page

**NEW `app/admin/settings/{page.tsx,actions.ts}`** — copy the `/admin/comments` shape
exactly: `force-dynamic`, `isAdmin()` guard, a Server Action (`isAdmin()` re-check +
`revalidatePath`) driving the toggle form.

**MODIFY `lib/nav.ts`** — add `settings` and `likes` children to `buildAdminNavNode()`. The Phase D
plan anticipated exactly this ("a future *order log* sibling drops in as another child"), so
**NavTree needs no changes**.

### Local infrastructure

**MODIFY `docker-compose.yml`** — add `kafka` (`confluentinc/cp-kafka`, KRaft — no ZooKeeper) and
`collector`, both behind a **compose profile** so ordinary development is unaffected:

```
docker compose up -d                        # Postgres only — unchanged day-to-day
docker compose --profile streaming up -d    # + Kafka + collector
```

**NEW `collector/`** — `main.py` (FastAPI: `POST /events` with bearer auth, `GET /health`),
`Dockerfile`, `requirements.txt`.

Design choices worth being able to defend in an interview:
- **Single versioned topic** `web.events.v1` with a `type` field, not topic-per-type — low
  volume, and consumers want the whole session stream in order.
- **Partition key = `sessionId`** → all events for one visit land in one partition, so
  per-session ordering is preserved.
- Producer: `linger.ms` batching, `compression.type=lz4`, `acks=1` (learning data, not
  financial records).
- **Retention ~7 days** with small segments — free-tier disk is finite.

### Files
**New:** `lib/settings.ts`, `lib/eventTypes.ts`, `lib/collector.ts`, `lib/sessionId.ts`,
`components/EventTracker.tsx`, `components/LikeButton.tsx`, `app/api/events/route.ts`,
`app/api/events/config/route.ts`, `app/api/likes/route.ts`,
`app/admin/settings/{page.tsx,actions.ts}`, `app/admin/likes/page.tsx`,
`collector/{main.py,Dockerfile,requirements.txt}`, migration
**Modified:** `prisma/schema.prisma`, `lib/nav.ts`, `components/AppShell.tsx`,
`components/ArtworkBlock.tsx`, `docker-compose.yml`, `.env.local.example`, `README.md`

---

## Phase K2 — AWS deployment (mostly manual)

1. **t3.micro** (or t2.micro), Amazon Linux 2023, Docker + compose plugin.
2. **Add a swap file** — 1 GB RAM running Kafka + collector is genuinely tight. KRaft mode
   and `KAFKA_HEAP_OPTS=-Xmx256m -Xms256m` are not optional here.
3. **Security group:** collector port from anywhere; SSH **from your IP only**;
   **9092 not open at all**.
4. **TLS:** point `ingest.saadbhatti.studio` (Porkbun DNS) at the instance and front the
   collector with Caddy for automatic Let's Encrypt — ~5 lines of Caddyfile. Without TLS the
   bearer token crosses the wire in plaintext.
5. Set `EVENT_COLLECTOR_URL` + `EVENT_INGEST_TOKEN` in Vercel; enable the toggle in
   `/admin/settings`.
6. **Set an AWS billing alarm before anything else runs.** Also verify current free-tier
   terms for **public IPv4 addresses** — AWS began charging for them in 2024, and the
   allowance is time-limited. Stop or terminate the instance when you're done learning.

---

## Phase K3 — Python consumer + analysis

Separate program, own consumer group on `web.events.v1`. pandas + matplotlib over: top
paths, artwork view counts (which photos hold attention), session funnels, referrers,
time-of-day. Consuming to your laptop is AWS **egress** — tiny at this volume, but it counts.

---

## Risks & honesty

- **Privacy.** This is real visitor tracking. Reuse `hashIp()` + `IP_HASH_SALT` from
  `lib/inquiries.ts` (never a raw IP); session id in **sessionStorage, not a cookie**; no
  PII in any event; DNT respected; admin excluded. Likes are deduped one-per-visitor by the
  same salted IP hash (the unique constraint doubles as the rate limit); admin likes are a
  server-side no-op.
- **Toggle staleness** up to ~60s server-side across serverless instances (client-side is
  immediate on next session).
- **"New tab opens" are a proxy, not a measurement** — see the limitation note above.
- **Free tier is a real cost risk** if left running — billing alarm + a plan to tear down.

## Verification

**K1 (local, `--profile streaming`):**
- Browse the site → events appear in Kafka, confirmed with a console consumer inside the
  container; keys are session ids and one session's events share a partition.
- **Toggle off → zero events reach the collector** (check both collector logs and the
  consumer, not just the UI).
- **Stop the collector container, browse the site: no console errors, no failed navigation,
  pages render normally.** This is the load-bearing test — analytics must never break the site.
- Logged in as admin → no events emitted.
- **Likes:** click a heart → it fills and **persists across reload** (localStorage); a second
  click unlikes; the like appears ranked in `/admin/likes`. With streaming on, an `artwork_like`
  reaches the consumer; with it off, the like still persists but emits nothing. Liking while
  logged in as admin writes no row and emits nothing.
- `npx tsc --noEmit` clean; `npm run build` route table **unchanged for public routes**
  (`○`/`●`), with `/api/events`, `/api/events/config`, `/api/likes`, `/admin/settings`,
  `/admin/likes` as `ƒ`.
- Build passes with Docker fully stopped (no build-time dependency on Kafka or Postgres).

**K2 (prod):** enable toggle → real traffic lands in the EC2 broker; `9092` refuses
connections from outside the instance (verify with `nc` from your laptop); billing alarm armed.
