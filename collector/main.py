"""
saadbhatti.studio event collector — the HTTP ingest tier in front of Kafka.

The one door in: Vercel POSTs batches of enriched events here over HTTPS with a
bearer token; this authenticates them and produces to Kafka on the private
network. Kafka is never exposed to the internet (see docs/kafkaEventsPlan.md).

Endpoints:
  GET  /health  → liveness, no auth
  POST /events  → { "v": 1, "events": [ {...}, ... ] }, Bearer auth, → 204

Events are keyed by sessionId so all events for one visit land in one partition
(per-session ordering). Single versioned topic: web.events.v1.

Past the bearer token this used to be a raw Kafka write primitive: no count
cap, no shape/size validation, no version check, and — worse — a partial
batch could already be on the wire by the time a later event in it failed
("{sessionId: 123}" raised AttributeError on `.encode()` mid-loop), and
`flush()`'s return value (messages STILL queued after the timeout) was
discarded, so a slow/dead broker meant the endpoint reported 204 while
quietly dropping events. Both are fixed below: the whole batch is validated
before anything is produced, and a nonzero flush() remainder is a 503.
"""

import json
import logging
import os

from confluent_kafka import Producer
from fastapi import FastAPI, Header, HTTPException, Request, Response

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("collector")

BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP", "kafka:9092")
TOPIC = os.environ.get("KAFKA_TOPIC", "web.events.v1")
TOKEN = os.environ.get("EVENT_INGEST_TOKEN", "")

# Mirrors lib/eventTypes.ts's MAX_BATCH (25) — the Next route already caps the
# batch it sends at this size, but this endpoint is the actual trust boundary
# (anyone with the bearer token can hit it directly), so it enforces its own
# copy rather than trusting the caller.
MAX_BATCH = 25
# Generous per-event ceiling: the Next-side field caps (path/referrer ≤512,
# target ≤64, sessionId ≤64, ts ≤40, plus a handful of small fixed fields) put
# a real event at well under 1 KB serialized. 8 KiB leaves headroom without
# letting one event dominate the whole request.
MAX_EVENT_BYTES = 8 * 1024
# Hard ceiling on the whole request body — batch size × per-event cap, so a
# full batch of maximally-sized events is exactly at the line rather than
# rejected by one limit and accepted by the other.
MAX_BODY_BYTES = MAX_BATCH * MAX_EVENT_BYTES
# Mirrors lib/eventTypes.ts's SESSION_ID_MAX — bounds the coerced sessionId
# used as the Kafka partition key.
SESSION_ID_MAX = 64

app = FastAPI(title="saadbhatti.studio event collector")

_producer: Producer | None = None


def producer() -> Producer:
    """Lazily build one long-lived producer (Kafka clients are meant to be reused)."""
    global _producer
    if _producer is None:
        _producer = Producer(
            {
                "bootstrap.servers": BOOTSTRAP,
                "linger.ms": 50,  # small batching window
                "compression.type": "lz4",
                "acks": "1",  # learning data, not financial records
                "enable.idempotence": False,
            }
        )
    return _producer


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/events")
async def ingest(request: Request, authorization: str = Header(default="")) -> Response:
    if not TOKEN or authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="unauthorized")

    # Content-Length is a cheap early-out but not trusted alone (absent on
    # chunked transfer, or simply wrong) — the actual byte count is checked
    # below once the body is in hand.
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise HTTPException(status_code=400, detail="body too large")

    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise HTTPException(status_code=400, detail="body too large")

    try:
        body = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="bad json")

    events = body.get("events") if isinstance(body, dict) else None
    if not isinstance(events, list):
        raise HTTPException(status_code=400, detail="no events")
    if len(events) > MAX_BATCH:
        raise HTTPException(status_code=400, detail="too many events")

    # Validate + serialize the WHOLE batch before producing anything. This is
    # the fix for the original partial-batch bug: a shape error on event N
    # must reject the request, not leave events 0..N-1 already produced with
    # no way to compensate.
    prepared: list[tuple[bytes, bytes]] = []
    for event in events:
        if not isinstance(event, dict):
            raise HTTPException(status_code=400, detail="bad event")
        # Untrusted input, coerced rather than trusted to already be a string
        # (the original bug: a numeric sessionId raised on `.encode()`).
        session_id = str(event.get("sessionId", ""))[:SESSION_ID_MAX]
        value = json.dumps(event).encode("utf-8")
        if len(value) > MAX_EVENT_BYTES:
            raise HTTPException(status_code=400, detail="event too large")
        prepared.append((session_id.encode("utf-8"), value))

    p = producer()
    produced = 0
    for key, value in prepared:
        try:
            p.produce(TOPIC, key=key, value=value)
        except BufferError:
            # Local delivery-report queue is full. Give the background poll a
            # moment to drain acked deliveries, then retry exactly once —
            # past that, the broker/network is the problem, not a momentary
            # blip, so surface it as a 503 rather than looping.
            p.poll(1)
            try:
                p.produce(TOPIC, key=key, value=value)
            except BufferError:
                log.warning(
                    "producer queue still full after retry, dropping batch "
                    "(%d of %d events already produced)",
                    produced,
                    len(prepared),
                )
                raise HTTPException(status_code=503, detail="busy")
        produced += 1

    # flush() RETURNS the count of messages still queued when the timeout
    # elapses — discarding that return was the original bug: a slow or dead
    # broker meant this line silently reported success (204) while the
    # events sat unflushed and were then lost. A nonzero remainder is exactly
    # the silent-loss case this docstring claims to prevent, so it's a 503.
    remaining = p.flush(5)
    if remaining > 0:
        log.warning("flush timed out with %d message(s) still queued", remaining)
        raise HTTPException(status_code=503, detail="not flushed")

    log.info("produced %d event(s) to %s", produced, TOPIC)
    return Response(status_code=204)
