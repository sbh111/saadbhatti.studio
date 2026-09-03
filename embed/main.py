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

import httpx
import numpy as np
import psycopg
import torch
from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse
from pgvector.psycopg import register_vector
from PIL import Image, UnidentifiedImageError
from transformers import CLIPModel, CLIPProcessor

MODEL_ID = os.environ.get("MODEL_ID", "openai/clip-vit-base-patch32")
MODEL_REVISION = os.environ.get("MODEL_REVISION", "main")  # pin to a commit in prod
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

def _load_model() -> tuple[CLIPModel, CLIPProcessor]:
    log.info("loading CLIP model %s (revision %s)…", MODEL_ID, MODEL_REVISION)
    started = time.monotonic()
    model = CLIPModel.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
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


def _embed_image(img: Image.Image) -> np.ndarray:
    inputs = _processor(images=img, return_tensors="pt")
    with torch.no_grad():
        feats = _model.get_image_features(**inputs)  # [1, 512]
    vec = feats[0].cpu().numpy().astype(np.float32)
    if vec.shape != (EMBED_DIM,) or not np.all(np.isfinite(vec)):
        raise ValueError(f"bad embedding: shape={vec.shape}, non-finite values present")
    norm = float(np.linalg.norm(vec)) or 1.0
    return vec / norm  # L2-normalized, matching the query side


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
def reindex(authorization: str = Header(default="")) -> dict:
    _require_token(authorization)

    if _model is None:
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
        return {"indexed": 0, "pruned": 0, "failed": [], "total": 0}

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
        "indexed": indexed,
        "pruned": pruned,
        "failed": failed,
        "total": len(public_ids),
        "elapsedSeconds": round(elapsed, 1),
    }
