"""
CLIP image-embedding service (image-search phase).

A local, on-demand container you spin up and probe: `POST /reindex` walks the
catalog, embeds each artwork image with pre-trained CLIP ViT-B/32, and upserts the
512-d vectors into Postgres (pgvector). The site's search endpoint reads those
vectors and compares them against a query vector produced by the SAME CLIP variant
on the JS side — model parity is the whole reason image and query vectors line up.

Independent of the Next app: it pulls the artwork id list from the site's
bearer-gated catalog-index endpoint, fetches images from Cloudinary, and writes
straight to Neon. Nothing here runs in the cloud — run it when you need to refresh.

Errors are meant to be DIAGNOSABLE: every stage logs what it's doing, failures log
a traceback to the container log (`docker compose logs -f embed`) and come back as
a JSON body naming the stage and cause, rather than a bare 500. Per-image failures
never abort the run — they're collected and reported.

`/reindex` always logs (and echoes back) the catalog/database HOST it resolved to
— never credentials — so a defaulted-wrong env var is visible, not silent (see
docker-compose.yml). `?dry_run=true` computes what a run WOULD embed/prune —
diffing the catalog against the table — without fetching a single image, calling
CLIP, or writing anything; use it to sanity-check a target before committing to
the real thing.

Env:
  EMBED_TOKEN           bearer required to call /reindex
  CATALOG_INDEX_URL     e.g. https://saadbhatti.studio/api/catalog-index
  CATALOG_INDEX_TOKEN   bearer for that endpoint
  EMBED_DATABASE_URL    Postgres URL (prefer the DIRECT/non-pooled Neon URL)
  CLOUDINARY_CLOUD_NAME default "sbh111"
  MODEL_ID / MODEL_REVISION  pinned CLIP variant (must match the JS text encoder)
  LOG_LEVEL             default INFO (set DEBUG for per-image detail)
"""

import io
import logging
import os
import time
from urllib.parse import urlparse

import httpx
import numpy as np
import psycopg
import torch
from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse
from pgvector.psycopg import register_vector
from PIL import Image, UnidentifiedImageError
from transformers import CLIPProcessor, CLIPVisionModelWithProjection

from model_pin import MODEL_ID, MODEL_REVISION

CLOUD_NAME = os.environ.get("CLOUDINARY_CLOUD_NAME", "sbh111")
EMBED_DIM = 512

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
log = logging.getLogger("embed")

app = FastAPI()


class StageError(Exception):
    """A failure we can attribute to a specific stage, with an HTTP status.

    Carrying the stage makes the response self-diagnosing: you see *where* it
    broke (config / catalog / database / model) instead of a bare 500.
    """

    def __init__(self, stage: str, message: str, status: int = 500, hint: str = ""):
        super().__init__(message)
        self.stage = stage
        self.message = message
        self.status = status
        self.hint = hint


@app.exception_handler(StageError)
async def _stage_error_handler(_request: Request, exc: StageError) -> JSONResponse:
    log.error("[%s] %s%s", exc.stage, exc.message, f" — {exc.hint}" if exc.hint else "")
    body = {"error": exc.message, "stage": exc.stage}
    if exc.hint:
        body["hint"] = exc.hint
    return JSONResponse(status_code=exc.status, content=body)


@app.exception_handler(Exception)
async def _unhandled_handler(_request: Request, exc: Exception) -> JSONResponse:
    # Last resort: log the full traceback so "Internal server error" is never the
    # only thing you get, and echo the exception type/message back to the caller.
    log.exception("unhandled error: %s", exc)
    return JSONResponse(
        status_code=500,
        content={
            "error": f"{type(exc).__name__}: {exc}",
            "stage": "unhandled",
            "hint": "See container logs for the traceback: docker compose logs -f embed",
        },
    )


# --- Model (loaded at import; baked into the image at build time) -------------
#
# Vision tower ONLY — CLIPVisionModelWithProjection, not the full CLIPModel.
# This embedder never encodes text (that half runs in the JS query encoder), so
# the text tower is dead weight: same checkpoint file either way (the HF repo
# ships one combined file), but CLIPVisionModelWithProjection only instantiates
# the vision half, cutting resident params ~42% (151M → 88M) — verified, along
# with numerical equivalence, before switching: .image_embeds from this class is
# bit-for-bit identical (max abs diff 0.0, well under the 1e-5 bar) to
# CLIPModel.get_image_features() on the same input, for the pinned MODEL_ID/
# MODEL_REVISION + torch/transformers versions in requirements.lock. That
# equivalence is exactly why _image_embeds() below still exists — re-verify it
# after any transformers upgrade, the same way this one was checked.

def _load_model() -> tuple[CLIPVisionModelWithProjection, CLIPProcessor]:
    log.info("loading CLIP vision tower %s (revision %s)…", MODEL_ID, MODEL_REVISION)
    started = time.monotonic()
    model = CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    model.eval()
    processor = CLIPProcessor.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    log.info("model ready in %.1fs", time.monotonic() - started)
    return model, processor


try:
    _model, _processor = _load_model()
    _model_error: str | None = None
except Exception as exc:  # noqa: BLE001 — surface at request time, not just at boot
    # Don't crash the container: /health should still answer and say what's wrong.
    _model, _processor = None, None
    _model_error = f"{type(exc).__name__}: {exc}"
    log.exception("model load FAILED — /reindex will return 503 until fixed")


def _default_gateway() -> str | None:
    """This container's default gateway (i.e. the host, from in here).

    On Linux, `host.docker.internal:host-gateway` resolves to the DEFAULT bridge
    (docker0) gateway, which is not this container's gateway when compose puts it
    on its own network — dialing it black-holes into a timeout. Surfacing the real
    gateway turns that into a one-line fix instead of a guessing game.
    """
    try:
        with open("/proc/net/route") as fh:
            for line in fh.readlines()[1:]:
                parts = line.split()
                if len(parts) > 2 and parts[1] == "00000000":  # default route
                    gw = int(parts[2], 16)  # little-endian hex
                    return ".".join(str((gw >> (8 * i)) & 0xFF) for i in range(4))
    except OSError:
        pass
    return None


def _require_env(name: str, stage: str, hint: str = "") -> str:
    value = os.environ.get(name)
    if not value:
        raise StageError(
            stage,
            f"Missing required env var {name}",
            status=500,
            hint=hint or f"Set {name} for the embed service (see docker-compose.yml).",
        )
    return value


def _image_url(public_id: str, width: int = 336) -> str:
    # CLIP resizes to 224x224 anyway, so we fetch a small source (not the display
    # 2048): 336 stays above the 224 crop for normal aspect ratios with no upscale,
    # at ~4x fewer pixels than 640. f_jpg (not f_auto) guarantees a Pillow-decodable
    # format — f_auto can return AVIF, which Pillow can't decode without a plugin.
    return (
        f"https://res.cloudinary.com/{CLOUD_NAME}/image/upload/"
        f"f_jpg,q_auto,c_limit,w_{width}/{public_id}"
    )


def _image_embeds(out: object) -> torch.Tensor:
    """The projected image-embedding tensor from the vision model's forward pass.

    Depending on the transformers version this returns either a bare Tensor or a
    ModelOutput (CLIPVisionModelOutputWithProjection normally, carrying
    `.image_embeds`) — this defended against exactly that difference once
    already, when main.py called CLIPModel.get_image_features() instead: some
    versions hand back a Tensor directly, others a ModelOutput. Indexing a
    ModelOutput with [0] yields its FIRST FIELD — last_hidden_state, shape
    (1, 50, 768) for ViT-B/32 — not the batch's first row, so resolve the
    tensor explicitly instead of subscripting blindly.
    """
    if isinstance(out, torch.Tensor):
        return out
    for attr in ("image_embeds", "embeds", "pooler_output"):
        value = getattr(out, attr, None)
        if isinstance(value, torch.Tensor):
            return value
    if isinstance(out, (tuple, list)) and out and isinstance(out[0], torch.Tensor):
        return out[0]
    raise ValueError(
        f"could not find an image-embedding tensor in {type(out).__name__}"
    )


def _embed_image(img: Image.Image) -> np.ndarray:
    inputs = _processor(images=img, return_tensors="pt")
    with torch.no_grad():
        feats = _image_embeds(_model(**inputs))

    feats = feats.detach().cpu().float()
    if feats.ndim == 2 and feats.shape[0] == 1:
        feats = feats[0]  # drop the batch dim → (512,)
    vec = feats.numpy().astype(np.float32)

    # Distinct checks: a wrong shape and a non-finite value are different faults
    # and must not be reported as the same thing.
    if vec.shape != (EMBED_DIM,):
        raise ValueError(
            f"expected a ({EMBED_DIM},) image embedding, got {tuple(vec.shape)} — "
            "the vision model did not return the projected embedding"
        )
    if not np.all(np.isfinite(vec)):
        raise ValueError("image embedding contains non-finite values (NaN/Inf)")

    norm = float(np.linalg.norm(vec)) or 1.0
    return vec / norm  # L2-normalized, matching the query side


def _host_of(url_or_dsn: str) -> str:
    """Hostname only, for logging/echoing a resolved target — never credentials.

    Both CATALOG_INDEX_URL and EMBED_DATABASE_URL can carry a user:pass, and
    both get logged at the start of every /reindex (see below) — this is the
    one thing that's safe to show.
    """
    try:
        return urlparse(url_or_dsn).hostname or "(unparseable)"
    except ValueError:
        return "(unparseable)"


def _require_token(authorization: str) -> None:
    expected = os.environ.get("EMBED_TOKEN")
    if not expected:
        raise StageError(
            "config",
            "EMBED_TOKEN is not set on the service",
            status=500,
            hint="Set EMBED_TOKEN in the embed container's environment.",
        )
    if authorization != f"Bearer {expected}":
        got = "missing" if not authorization else "mismatched"
        raise StageError(
            "auth",
            f"Unauthorized ({got} bearer token)",
            status=401,
            hint='Send: -H "Authorization: Bearer $EMBED_TOKEN"',
        )
    log.info("auth ok")


def _fetch_public_ids() -> list[str]:
    url = _require_env(
        "CATALOG_INDEX_URL",
        "config",
        "e.g. https://saadbhatti.studio/api/catalog-index (local site: "
        "http://host.docker.internal:3000/api/catalog-index)",
    )
    token = os.environ.get("CATALOG_INDEX_TOKEN", "")
    if not token:
        log.warning("CATALOG_INDEX_TOKEN is empty — the site will likely reject this")

    log.info("fetching catalog index from %s", url)
    try:
        # Follow redirects (e.g. a trailing-slash 308). NOTE: httpx strips the
        # Authorization header across an origin change, so an apex→www redirect
        # silently de-authenticates us — hence the cross-origin check below.
        resp = httpx.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=30.0,
            follow_redirects=True,
        )
    except httpx.RequestError as exc:
        gateway = _default_gateway()
        hint = (
            "Is the URL reachable from inside the container? localhost points at "
            "the container itself, not the host."
        )
        if gateway:
            # On Linux, host.docker.internal maps to the docker0 gateway, which is
            # NOT this container's gateway when compose uses its own network —
            # dialing it times out. This gateway is the host as seen from here.
            hint += (
                f" This container's gateway (the host) is {gateway} — try "
                f"CATALOG_INDEX_URL=http://{gateway}:3000/api/catalog-index"
            )
        raise StageError(
            "catalog",
            f"Could not reach the catalog index: {type(exc).__name__}: {exc}",
            status=502,
            hint=hint,
        ) from exc

    redirected = bool(resp.history)
    final_url = str(resp.url)
    cross_origin = redirected and resp.history[0].url.netloc != resp.url.netloc
    if redirected:
        log.warning(
            "catalog index redirected %s → %s%s",
            url,
            final_url,
            " (cross-origin: bearer token was dropped)" if cross_origin else "",
        )

    if resp.status_code == 401:
        if cross_origin:
            raise StageError(
                "catalog",
                "Catalog index rejected our token (401) after a cross-origin redirect",
                status=502,
                hint=f"The redirect to {final_url} dropped the Authorization header. "
                f"Set CATALOG_INDEX_URL to the canonical URL directly: {final_url}",
            )
        raise StageError(
            "catalog",
            "Catalog index rejected our token (401)",
            status=502,
            hint="CATALOG_INDEX_TOKEN here must equal CATALOG_INDEX_TOKEN on the site.",
        )
    if resp.status_code == 404:
        raise StageError(
            "catalog",
            f"Catalog index not found (404) at {final_url}",
            status=502,
            hint="That deployment doesn't have /api/catalog-index yet — deploy the "
            "search branch, or point CATALOG_INDEX_URL at a local dev site "
            "(http://host.docker.internal:3000/api/catalog-index).",
        )
    if resp.status_code >= 400:
        raise StageError(
            "catalog",
            f"Catalog index returned HTTP {resp.status_code}",
            status=502,
            hint=f"Response body (truncated): {resp.text[:200]!r}",
        )

    try:
        payload = resp.json()
    except ValueError as exc:
        raise StageError(
            "catalog",
            "Catalog index did not return JSON",
            status=502,
            hint=f"Body (truncated): {resp.text[:200]!r}",
        ) from exc

    ids = payload.get("publicIds")
    if not isinstance(ids, list):
        raise StageError(
            "catalog",
            "Catalog index JSON has no 'publicIds' list",
            status=502,
            hint=f"Got keys: {list(payload)[:10]}",
        )

    public_ids = [str(i) for i in ids]
    log.info("catalog index returned %d artwork id(s)", len(public_ids))
    return public_ids


def _connect_db() -> psycopg.Connection:
    dsn = _require_env(
        "EMBED_DATABASE_URL",
        "config",
        "Use the DIRECT (non-pooled) Neon URL, or the local db container URL.",
    )
    try:
        conn = psycopg.connect(dsn, autocommit=True, connect_timeout=15)
    except psycopg.Error as exc:
        raise StageError(
            "database",
            f"Could not connect to Postgres: {type(exc).__name__}: {exc}",
            status=502,
            hint="Check EMBED_DATABASE_URL (host reachable from the container, "
            "credentials, sslmode). Neon: prefer the direct, non-pooled URL.",
        ) from exc

    try:
        register_vector(conn)
    except Exception as exc:  # noqa: BLE001 — extension missing is the usual cause
        conn.close()
        raise StageError(
            "database",
            f"pgvector not available: {type(exc).__name__}: {exc}",
            status=500,
            hint="Run the migration that does CREATE EXTENSION vector "
            "(npx prisma migrate deploy).",
        ) from exc
    return conn


@app.get("/health")
def health() -> dict:
    return {
        "ok": _model_error is None,
        "model": MODEL_ID,
        "revision": MODEL_REVISION,
        "dim": EMBED_DIM,
        "modelError": _model_error,
        # The host as seen from inside this container — the address to use in
        # CATALOG_INDEX_URL when the site runs on the host.
        "hostGateway": _default_gateway(),
        "env": {  # presence only — never echo secret values
            "EMBED_TOKEN": bool(os.environ.get("EMBED_TOKEN")),
            "CATALOG_INDEX_URL": os.environ.get("CATALOG_INDEX_URL") or None,
            "CATALOG_INDEX_TOKEN": bool(os.environ.get("CATALOG_INDEX_TOKEN")),
            "EMBED_DATABASE_URL": bool(os.environ.get("EMBED_DATABASE_URL")),
        },
    }


@app.post("/reindex")
def reindex(authorization: str = Header(default=""), dry_run: bool = False) -> dict:
    _require_token(authorization)

    # Log — and echo back in the response — which catalog and which database
    # this run targets, host only, never credentials. CATALOG_INDEX_URL and
    # EMBED_DATABASE_URL both default local (docker-compose.yml) and both need
    # an explicit override for a production refresh; this is the guard rail
    # that makes a defaulted-wrong var visible instead of a silent cross-wire.
    # A "mixed" target (e.g. a local catalog against the production DB) is NOT
    # refused — there's one Cloudinary cloud, so that combination can be a
    # deliberate, legitimate refresh, not just a mistake.
    catalog_host = _host_of(os.environ.get("CATALOG_INDEX_URL", ""))
    db_host = _host_of(os.environ.get("EMBED_DATABASE_URL", ""))
    log.info(
        "/reindex target — catalog host=%s, db host=%s%s",
        catalog_host,
        db_host,
        " [DRY RUN — no writes]" if dry_run else "",
    )
    target = {"catalogHost": catalog_host, "databaseHost": db_host, "dryRun": dry_run}

    # A dry run needs no model — it never embeds anything — so this check only
    # applies to a real run.
    if not dry_run and _model is None:
        raise StageError(
            "model",
            f"CLIP model failed to load: {_model_error}",
            status=503,
            hint="Rebuild the image (docker compose --profile embedding build embed).",
        )

    started = time.monotonic()
    public_ids = _fetch_public_ids()
    if not public_ids:
        log.warning("catalog is empty — nothing to embed, skipping prune")
        return {**target, "indexed": 0, "pruned": 0, "failed": [], "total": 0}

    if dry_run:
        # Read-only preview: no image fetch, no CLIP, no write — just compares
        # the catalog's public_ids against what's already in the table, so a
        # target (and the size of the run) can be sanity-checked before paying
        # for the real thing.
        with _connect_db() as conn:
            with conn.cursor() as cur:
                cur.execute('SELECT "publicId" FROM artwork_embeddings')
                existing = {row[0] for row in cur.fetchall()}
        catalog_ids = set(public_ids)
        elapsed = time.monotonic() - started
        log.info(
            "dry run done in %.1fs — would embed new=%d refresh=%d prune=%d total=%d",
            elapsed,
            len(catalog_ids - existing),
            len(catalog_ids & existing),
            len(existing - catalog_ids),
            len(public_ids),
        )
        return {
            **target,
            "wouldEmbedNew": len(catalog_ids - existing),
            "wouldRefresh": len(catalog_ids & existing),
            "wouldPrune": len(existing - catalog_ids),
            "total": len(public_ids),
            "elapsedSeconds": round(elapsed, 1),
        }

    indexed, failed = 0, []

    with _connect_db() as conn:
        with conn.cursor() as cur:
            for n, pid in enumerate(public_ids, 1):
                try:
                    log.info("[%d/%d] embedding %s", n, len(public_ids), pid)
                    url = _image_url(pid)
                    try:
                        r = httpx.get(url, timeout=60.0, follow_redirects=True)
                        r.raise_for_status()
                    except httpx.HTTPStatusError as exc:
                        raise RuntimeError(
                            f"image fetch returned HTTP {exc.response.status_code} "
                            f"for {url}"
                        ) from exc
                    except httpx.RequestError as exc:
                        raise RuntimeError(
                            f"image fetch failed ({type(exc).__name__}) for {url}"
                        ) from exc

                    try:
                        img = Image.open(io.BytesIO(r.content)).convert("RGB")
                    except UnidentifiedImageError as exc:
                        raise RuntimeError(
                            "Pillow could not decode the image "
                            f"(content-type={r.headers.get('content-type')!r}, "
                            f"{len(r.content)} bytes)"
                        ) from exc

                    vec = _embed_image(img)

                    try:
                        cur.execute(
                            'INSERT INTO artwork_embeddings ("publicId", embedding, "updatedAt") '
                            "VALUES (%s, %s, now()) "
                            'ON CONFLICT ("publicId") DO UPDATE '
                            'SET embedding = EXCLUDED.embedding, "updatedAt" = now()',
                            (pid, vec),
                        )
                    except psycopg.errors.UndefinedTable as exc:
                        # Structural: every row will fail the same way — stop now.
                        raise StageError(
                            "database",
                            "Table artwork_embeddings does not exist",
                            status=500,
                            hint="Run the migration: npx prisma migrate deploy.",
                        ) from exc
                    indexed += 1
                except StageError:
                    raise  # structural — propagate, don't record as a per-image failure
                except Exception as exc:  # noqa: BLE001 — per-image, keep going
                    log.exception("failed to embed %s", pid)
                    failed.append(
                        {"publicId": pid, "error": f"{type(exc).__name__}: {exc}"}
                    )

            # Prune embeddings for artworks no longer in the catalog. Guarded by the
            # empty-catalog early return above, so a fetch hiccup can't wipe the table.
            try:
                cur.execute(
                    'DELETE FROM artwork_embeddings WHERE "publicId" <> ALL(%s)',
                    (public_ids,),
                )
                pruned = cur.rowcount
            except psycopg.Error as exc:
                raise StageError(
                    "database",
                    f"Prune failed: {type(exc).__name__}: {exc}",
                    status=500,
                    hint="Embeddings were written; only the prune step failed.",
                ) from exc

    elapsed = time.monotonic() - started
    log.info(
        "reindex done in %.1fs — indexed=%d pruned=%d failed=%d total=%d",
        elapsed,
        indexed,
        pruned,
        len(failed),
        len(public_ids),
    )
    return {
        **target,
        "indexed": indexed,
        "pruned": pruned,
        "failed": failed,
        "total": len(public_ids),
        "elapsedSeconds": round(elapsed, 1),
    }
