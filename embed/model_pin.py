"""The pinned CLIP model identity — split out of main.py so the Dockerfile can
COPY it alone, ahead of the ~600 MB model-download RUN step, without dragging in
main.py's other imports/logic (FastAPI, torch, the route handlers, ...). That
split is what keeps the download layer cached across ordinary main.py edits:
Docker invalidates a layer only when the files it COPYs change, so as long as
this file doesn't change, the download RUN below it stays cached even after
main.py changes.

MODEL_ID / MODEL_REVISION together pin the exact CLIP vision-tower weights this
service bakes in and loads. main.py imports both from here; the Dockerfile's
download RUN does the same (`python -c "import model_pin; ..."`) — one place,
read the same way in both spots, so there is nothing to keep in sync.
"""

import os

MODEL_ID = os.environ.get("MODEL_ID", "openai/clip-vit-base-patch32")
# Pinned 2026-09-13 to the repo's current HEAD commit (checked via
# https://huggingface.co/api/models/openai/clip-vit-base-patch32) — previously
# defaulted to "main" with a "pin to a commit in prod" comment nobody had
# acted on. An unpinned load means upstream repushing this repo would
# silently swap in a different vision tower with no error anywhere; query
# vectors from lib/clip.ts's Xenova/clip-vit-base-patch32 (pinned separately —
# a different repo, the ONNX conversion of the same weights) would then be
# comparing against a stored image-vector space they no longer match.
# Changing this (or lib/clip.ts's pin) requires re-embedding every artwork —
# the Dockerfile bakes THIS default at build time (see its comment), so the
# env override below only matters for a manual re-run against a different
# revision, never for the baked image.
MODEL_REVISION = os.environ.get(
    "MODEL_REVISION", "3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268"
)
