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

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="bad json")

    events = body.get("events") if isinstance(body, dict) else None
    if not isinstance(events, list):
        raise HTTPException(status_code=400, detail="no events")

    p = producer()
    produced = 0
    for event in events:
        if not isinstance(event, dict):
            continue
        key = (event.get("sessionId") or "").encode("utf-8")
        p.produce(TOPIC, key=key, value=json.dumps(event).encode("utf-8"))
        produced += 1

    # Block briefly so a crash right after 204 doesn't silently drop the batch.
    p.flush(5)
    log.info("produced %d event(s) to %s", produced, TOPIC)
    return Response(status_code=204)
