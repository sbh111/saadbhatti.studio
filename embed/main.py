"""
CLIP image-embedding service (image-search phase).

A local, on-demand container you spin up and probe: `POST /reindex` walks the
catalog, embeds each artwork image with pre-trained CLIP ViT-B/32, and upserts the
512-d vectors into Postgres (pgvector). The site's search endpoint reads those
vectors and compares them against a query vector produced by the SAME CLIP variant
on the JS side — model parity is the whole reason image and query vectors line up.

Independent of the Next app: it pulls the artwork id list from the deployed site's
admin-gated catalog-index endpoint, fetches images from Cloudinary, and writes
straight to Neon. Nothing here runs in the cloud — run it when you need to refresh.

Env:
  EMBED_TOKEN           bearer required to call /reindex
  CATALOG_INDEX_URL     e.g. https://saadbhatti.studio/api/admin/catalog-index
  CATALOG_INDEX_TOKEN   bearer for that admin endpoint
  EMBED_DATABASE_URL    Postgres URL (prefer the DIRECT/non-pooled Neon URL)
  CLOUDINARY_CLOUD_NAME  default "sbh111"
  MODEL_ID / MODEL_REVISION  pinned CLIP variant (must match the JS text encoder)
"""

import io
import os

import httpx
import numpy as np
import psycopg
import torch
from fastapi import FastAPI, Header, HTTPException
from pgvector.psycopg import register_vector
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

MODEL_ID = os.environ.get("MODEL_ID", "openai/clip-vit-base-patch32")
MODEL_REVISION = os.environ.get("MODEL_REVISION", "main")  # pin to a commit in prod
CLOUD_NAME = os.environ.get("CLOUDINARY_CLOUD_NAME", "sbh111")
EMBED_DIM = 512

app = FastAPI()

# Baked into the image at build time, so this is a fast local load, not a download.
_model = CLIPModel.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
_model.eval()
_processor = CLIPProcessor.from_pretrained(MODEL_ID, revision=MODEL_REVISION)


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
    norm = float(np.linalg.norm(vec)) or 1.0
    return vec / norm  # L2-normalized, matching the query side


def _require_token(authorization: str = Header(default="")) -> None:
    expected = os.environ.get("EMBED_TOKEN")
    if not expected or authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="unauthorized")


def _fetch_public_ids() -> list[str]:
    url = os.environ["CATALOG_INDEX_URL"]
    token = os.environ.get("CATALOG_INDEX_TOKEN", "")
    resp = httpx.get(
        url, headers={"Authorization": f"Bearer {token}"}, timeout=30.0
    )
    resp.raise_for_status()
    ids = resp.json().get("publicIds", [])
    return [str(i) for i in ids]


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model": MODEL_ID, "dim": EMBED_DIM}


@app.post("/reindex")
def reindex(authorization: str = Header(default="")) -> dict:
    _require_token(authorization)

    public_ids = _fetch_public_ids()
    indexed, failed = 0, []

    with psycopg.connect(os.environ["EMBED_DATABASE_URL"], autocommit=True) as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            for pid in public_ids:
                try:
                    r = httpx.get(_image_url(pid), timeout=60.0)
                    r.raise_for_status()
                    img = Image.open(io.BytesIO(r.content)).convert("RGB")
                    vec = _embed_image(img)
                    cur.execute(
                        'INSERT INTO artwork_embeddings ("publicId", embedding, "updatedAt") '
                        "VALUES (%s, %s, now()) "
                        'ON CONFLICT ("publicId") DO UPDATE '
                        'SET embedding = EXCLUDED.embedding, "updatedAt" = now()',
                        (pid, vec),
                    )
                    indexed += 1
                except Exception as exc:  # noqa: BLE001 — report per-image, keep going
                    failed.append({"publicId": pid, "error": str(exc)})

            # Prune embeddings for artworks no longer in the catalog (only when we
            # actually have a catalog, so a fetch hiccup can't wipe the table).
            pruned = 0
            if public_ids:
                cur.execute(
                    'DELETE FROM artwork_embeddings WHERE "publicId" <> ALL(%s)',
                    (public_ids,),
                )
                pruned = cur.rowcount

    return {
        "indexed": indexed,
        "pruned": pruned,
        "failed": failed,
        "total": len(public_ids),
    }
