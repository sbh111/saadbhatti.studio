import { CLOUD_NAME } from "./cloudinary";
import { CATALOG_CACHE_TAG, CATALOG_REVALIDATE_SECONDS } from "./constants";
import { stripReorderPrefix } from "./slug";

/**
 * Low-level authenticated Cloudinary Admin API client — everything that can
 * read or MUTATE Cloudinary lives here. lib/catalog.ts builds the read-side
 * domain model on top of apiGet(); admin route handlers use the write helpers.
 */

const BASE = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}`;

function authHeader(): string {
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!key || !secret) {
    throw new Error(
      "Missing CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET. Locally: put them in .env.local (see .env.local.example). On Vercel: Project → Settings → Environment Variables."
    );
  }
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

/** Cached read used by the public catalog; invalidated via revalidateTag(CATALOG_CACHE_TAG). */
export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Authorization: authHeader() },
    next: { revalidate: CATALOG_REVALIDATE_SECONDS, tags: [CATALOG_CACHE_TAG] },
  });
  if (!response.ok) {
    throw new Error(
      `Cloudinary Admin API ${path} failed: HTTP ${response.status} ${await response.text()}`
    );
  }
  return response.json() as Promise<T>;
}

/** Uncached read — used before a write so the merge starts from fresh state. */
async function apiGetFresh<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Authorization: authHeader() },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      `Cloudinary Admin API ${path} failed: HTTP ${response.status} ${await response.text()}`
    );
  }
  return response.json() as Promise<T>;
}

// Loop guard, not a normal limit: Cloudinary always terminates a paginated read
// via an absent `next_cursor`, so reaching this means either next_cursor never
// cleared (a bug here, or an API change) or the catalog has grown far past any
// size this site is expected to reach. Either way this THROWS instead of
// quietly stopping — a second, bigger silent truncation would defeat the whole
// point of tech debt 2.2. 40 pages × 500/page = 20,000 items.
const MAX_PAGES = 40;

/**
 * Fetch every page of a Cloudinary Admin API list endpoint that paginates via
 * `next_cursor` (confirmed present on `/folders`, `/folders/:folder`, and
 * `/resources/by_asset_folder` — see https://cloudinary.com/documentation/admin_api).
 * Generic over both the fetcher — pass `apiGet` (cached + tagged, for the public
 * catalog read) or `apiGetFresh` (no-store, for a read that must see the latest
 * write) so this helper doesn't have to know about caching at all — and the
 * response shape, since Cloudinary names the array field differently per
 * endpoint ("folders" vs "resources"); `extract` pulls `{items, next_cursor}`
 * out of whatever one page's JSON looks like.
 *
 * `buildPath(cursor)` gets `undefined` for the first page and the previous
 * page's cursor after that — it must URL-encode the cursor itself (via
 * `encodeURIComponent`), same as every other query value this module builds;
 * Cloudinary's cursors can contain characters that need escaping.
 */
export async function fetchAllPages<Raw, Item>(
  fetchPage: (path: string) => Promise<Raw>,
  buildPath: (cursor: string | undefined) => string,
  extract: (page: Raw) => { items: Item[]; next_cursor?: string }
): Promise<Item[]> {
  const all: Item[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, next_cursor } = extract(await fetchPage(buildPath(cursor)));
    all.push(...items);
    if (!next_cursor) return all;
    cursor = next_cursor;
  }
  throw new Error(
    `Cloudinary pagination did not terminate within ${MAX_PAGES} pages ` +
      `(${all.length} item(s) collected) — either next_cursor never cleared or ` +
      `the catalog has grown far beyond any expected size.`
  );
}

/** Cloudinary context strings are pipe-delimited key=value pairs. */
function escapeContext(value: string): string {
  return value.replace(/([=|])/g, "\\$1");
}

/**
 * One form field's update: its full read chain (the same chain
 * `lib/catalog.ts` reads through — canonical key first, aliases after) and
 * the new value. `""` means "the admin cleared this field."
 */
export interface ContextFieldUpdate {
  keys: readonly string[];
  value: string;
}

/**
 * Pure read-modify-write merge behind `updateArtworkContext`, split out so it
 * is unit-testable without touching the network (mock fetch to test the
 * function that calls this instead).
 *
 * Setting a field (non-empty value) writes ONLY its canonical — first —
 * key. Aliases are left untouched: the read chain already tries the
 * canonical key first, so nothing needs deleting for it to win.
 *
 * Clearing a field (empty value) deletes EVERY key in its chain. Deleting
 * only the canonical key isn't enough: an untouched alias (a leftover
 * `caption`, a lowercase `film`) would resurface through the read-side
 * fallback the moment the canonical key is gone — the exact bug in tech
 * debt 3.2. The chain is, by definition, "every spelling of this field," so
 * clearing it means removing all of them.
 */
export function mergeContext(
  current: Record<string, string>,
  fields: ContextFieldUpdate[]
): Record<string, string> {
  const merged = { ...current };
  for (const { keys, value } of fields) {
    const trimmed = value.trim();
    if (trimmed) {
      merged[keys[0]] = trimmed;
    } else {
      for (const key of keys) delete merged[key];
    }
  }
  return merged;
}

/**
 * Update an asset's contextual metadata. Cloudinary's update endpoint REPLACES
 * the entire custom context (verified empirically), so this reads the current
 * context first and merges via `mergeContext` (see above); unrelated keys
 * (e.g. alt/Description) are preserved either way.
 */
export async function updateArtworkContext(
  publicId: string,
  fields: ContextFieldUpdate[]
): Promise<void> {
  const current = await apiGetFresh<{
    context?: { custom?: Record<string, string> };
  }>(`/resources/image/upload/${encodeURIComponent(publicId)}`);

  const merged = mergeContext(current.context?.custom ?? {}, fields);

  const contextParam = Object.entries(merged)
    .map(([k, v]) => `${escapeContext(k)}=${escapeContext(v)}`)
    .join("|");

  const response = await fetch(
    `${BASE}/resources/image/upload/${encodeURIComponent(publicId)}`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ context: contextParam }),
      cache: "no-store",
    }
  );
  if (!response.ok) {
    throw new Error(
      `Cloudinary context update for "${publicId}" failed: HTTP ${response.status} ${await response.text()}`
    );
  }
}

/**
 * Rename an asset's display_name (its filename) WITHOUT touching public_id.
 * Deliberately the Admin API update endpoint — not the Upload-API `rename` —
 * so public_id (the stable key for staged edits, delivery URLs, future 1c DB
 * rows) never changes. De-risked empirically: this call preserves public_id,
 * asset_folder, and context.custom (an update that omits `context` leaves the
 * existing context intact — no REPLACE wipe).
 */
async function updateDisplayName(
  publicId: string,
  displayName: string
): Promise<void> {
  const response = await fetch(
    `${BASE}/resources/image/upload/${encodeURIComponent(publicId)}`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ display_name: displayName }),
      cache: "no-store",
    }
  );
  if (!response.ok) {
    throw new Error(
      `Cloudinary display_name update for "${publicId}" failed: HTTP ${response.status} ${await response.text()}`
    );
  }
}

type ReorderResult =
  | { ok: true }
  | { ok: false; reason: "stale" | "error"; message?: string };

/**
 * Reorder a collection by renumbering the `NN-` filename prefixes so that the
 * catalog's localeCompare(display_name) sort yields `orderedPublicIds`.
 *
 * Order = alphabetical display_name, so position N gets a zero-padded prefix
 * (uniform width within the collection: max(2, digits(count))). The original
 * suffix is preserved by stripping any existing leading digits with
 * `stripReorderPrefix` (lib/slug.ts) — the SAME helper the catalog read side
 * uses to derive the URL slug, so renumbering here can never change a slug
 * (tech debt 1.8). Applied SEQUENTIALLY (rate-limit-friendly, deterministic
 * partial state) and no-ops are skipped, so a partial failure leaves the
 * reorder staged and re-saving recomputes + heals — idempotent.
 */
export async function reorderCollection(
  collectionPath: string,
  orderedPublicIds: string[]
): Promise<ReorderResult> {
  try {
    // Fresh (uncached) read of the live folder membership + current filenames —
    // ALL of it, not just the first 500: the stale-check below compares set
    // membership, so a collection past one page would otherwise misfire as
    // "stale" for every asset past the 500th (tech debt 2.2).
    const resources = await fetchAllPages<
      { resources?: { public_id: string; display_name?: string }[]; next_cursor?: string },
      { public_id: string; display_name?: string }
    >(
      apiGetFresh,
      (cursor) =>
        `/resources/by_asset_folder?asset_folder=${encodeURIComponent(collectionPath)}&max_results=500` +
        (cursor ? `&next_cursor=${encodeURIComponent(cursor)}` : ""),
      (page) => ({ items: page.resources ?? [], next_cursor: page.next_cursor })
    );

    // Stale check: if the live public_id set differs from what was staged (an
    // asset was added/removed since staging), refuse — bulk renames are
    // destructive, so reject rather than merge-guess. Stays staged client-side.
    const liveIds = new Set(resources.map((r) => r.public_id));
    const stagedIds = new Set(orderedPublicIds);
    const sameSize = liveIds.size === stagedIds.size;
    const sameMembers = [...stagedIds].every((id) => liveIds.has(id));
    if (!sameSize || !sameMembers) {
      return { ok: false, reason: "stale" };
    }

    const currentName = new Map(
      resources.map((r) => [
        r.public_id,
        r.display_name ?? r.public_id.split("/").pop() ?? r.public_id,
      ])
    );
    const width = Math.max(2, String(orderedPublicIds.length).length);

    // Sequential apply; skip no-ops (already-correct names) so retries are cheap.
    for (let i = 0; i < orderedPublicIds.length; i++) {
      const publicId = orderedPublicIds[i];
      const prefix = String(i + 1).padStart(width, "0");
      const suffix = stripReorderPrefix(currentName.get(publicId) ?? publicId);
      const nextName = `${prefix}-${suffix}`;
      if (nextName === currentName.get(publicId)) continue;
      await updateDisplayName(publicId, nextName);
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
