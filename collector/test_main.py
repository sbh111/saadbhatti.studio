"""
Tests for the /events validation and produce/flush handling added for tech
debt 2.5 (silent partial batches, unbounded input, discarded flush() result).

Run in a fresh virtualenv (confluent_kafka itself is never actually needed —
every test below installs a fake Producer via a stub module in sys.modules,
so no real Kafka broker, and no librdkafka build toolchain, is required):

    python3 -m venv .venv-collector-test && source .venv-collector-test/bin/activate
    pip install fastapi==0.115.6 httpx pytest
    pytest collector/test_main.py
    deactivate && rm -rf .venv-collector-test

(pinned fastapi version matches collector/requirements.txt; httpx is only
needed for FastAPI's TestClient and pytest to run the file — neither is a
runtime dependency of the collector itself.)
"""

import sys
import types

import pytest


class FakeProducer:
    """Stands in for confluent_kafka.Producer — records what would have been
    sent and lets each test dictate backpressure (BufferError) and flush()
    behavior without a real broker anywhere in the loop."""

    def __init__(self, *_args, **_kwargs):
        self.produced: list[tuple[str, bytes, bytes]] = []
        self.buffer_error_countdown = 0  # produce() calls left that should raise
        self.flush_remaining = 0  # what flush() reports as still queued
        self.polled = 0

    def produce(self, topic, key=None, value=None):
        if self.buffer_error_countdown > 0:
            self.buffer_error_countdown -= 1
            raise BufferError("queue full")
        self.produced.append((topic, key, value))

    def poll(self, timeout=0):
        self.polled += 1

    def flush(self, timeout=0):
        return self.flush_remaining


def _install_fake_confluent_kafka():
    # collector/main.py does `from confluent_kafka import Producer` at import
    # time — stub the module out before importing main so the real package
    # (which needs librdkafka) never has to be installed for these tests.
    if "confluent_kafka" in sys.modules:
        return
    stub = types.ModuleType("confluent_kafka")
    stub.Producer = FakeProducer
    sys.modules["confluent_kafka"] = stub


_install_fake_confluent_kafka()

from fastapi.testclient import TestClient  # noqa: E402

import collector.main as main  # noqa: E402


@pytest.fixture(autouse=True)
def token(monkeypatch):
    monkeypatch.setattr(main, "TOKEN", "test-token")


@pytest.fixture
def fake_producer(monkeypatch):
    fp = FakeProducer()
    monkeypatch.setattr(main, "_producer", fp)
    return fp


AUTH = {"Authorization": "Bearer test-token"}


def client() -> TestClient:
    return TestClient(main.app)


def test_rejects_missing_or_wrong_token(fake_producer):
    r = client().post("/events", json={"events": []})
    assert r.status_code == 401
    r = client().post(
        "/events", json={"events": []}, headers={"Authorization": "Bearer wrong"}
    )
    assert r.status_code == 401
    assert fake_producer.produced == []


def test_rejects_non_dict_body(fake_producer):
    r = client().post(
        "/events",
        data="[]",
        headers={**AUTH, "content-type": "application/json"},
    )
    assert r.status_code == 400
    assert fake_producer.produced == []


def test_rejects_batch_over_max_batch(fake_producer):
    events = [{"sessionId": "s"} for _ in range(main.MAX_BATCH + 1)]
    r = client().post("/events", json={"events": events}, headers=AUTH)
    assert r.status_code == 400
    assert fake_producer.produced == []


def test_rejects_non_dict_event_without_producing_earlier_ones(fake_producer):
    # The original bug: an error partway through the loop left earlier events
    # already produced with no compensation. The whole batch must now be
    # validated before anything is produced — this batch has one good event
    # before the bad one, and NOTHING should have reached the producer.
    events = [{"sessionId": "a"}, "not-a-dict", {"sessionId": "b"}]
    r = client().post("/events", json={"events": events}, headers=AUTH)
    assert r.status_code == 400
    assert fake_producer.produced == []


def test_coerces_sessionid_to_str(fake_producer):
    # The original bug: a non-string sessionId raised AttributeError on
    # .encode() mid-batch. It must now be coerced, not rejected or crashed on.
    r = client().post(
        "/events", json={"events": [{"sessionId": 12345}]}, headers=AUTH
    )
    assert r.status_code == 204
    assert len(fake_producer.produced) == 1
    _, key, _ = fake_producer.produced[0]
    assert key == b"12345"


def test_rejects_oversized_event(fake_producer):
    events = [{"sessionId": "s", "blob": "x" * main.MAX_EVENT_BYTES}]
    r = client().post("/events", json={"events": events}, headers=AUTH)
    assert r.status_code == 400
    assert fake_producer.produced == []


def test_rejects_oversized_body(fake_producer):
    big_events = [
        {"sessionId": "s", "blob": "x" * 100} for _ in range(main.MAX_BATCH)
    ]
    # Individually each event is tiny, but pad the body past MAX_BODY_BYTES
    # via a top-level field so the whole-body cap (not the per-event cap) is
    # what trips.
    r = client().post(
        "/events",
        json={"events": big_events, "padding": "x" * main.MAX_BODY_BYTES},
        headers=AUTH,
    )
    assert r.status_code == 400
    assert fake_producer.produced == []


def test_retries_once_on_buffer_error_then_succeeds(fake_producer):
    fake_producer.buffer_error_countdown = 1  # first produce() fails, retry succeeds
    r = client().post(
        "/events", json={"events": [{"sessionId": "s"}]}, headers=AUTH
    )
    assert r.status_code == 204
    assert fake_producer.polled == 1
    assert len(fake_producer.produced) == 1


def test_returns_503_when_buffer_stays_full_after_retry(fake_producer):
    fake_producer.buffer_error_countdown = 999
    r = client().post(
        "/events", json={"events": [{"sessionId": "s"}]}, headers=AUTH
    )
    assert r.status_code == 503


def test_returns_503_when_flush_leaves_messages_queued(fake_producer):
    # The original bug: flush()'s return value (messages still queued) was
    # discarded, so this exact case silently reported 204.
    fake_producer.flush_remaining = 3
    r = client().post(
        "/events", json={"events": [{"sessionId": "s"}]}, headers=AUTH
    )
    assert r.status_code == 503


def test_happy_path_produces_and_returns_204(fake_producer):
    r = client().post(
        "/events",
        json={"events": [{"sessionId": "s", "type": "page_view"}]},
        headers=AUTH,
    )
    assert r.status_code == 204
    assert len(fake_producer.produced) == 1
