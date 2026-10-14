# CLIP image-embedding service. Mirrors collector/ (FastAPI + uvicorn), but bakes
# the pre-trained CLIP ViT-B/32 weights into the image so /reindex is ready on
# start and needs no network for the model.
FROM python:3.12-slim

WORKDIR /app

# Keep the HF cache inside the image so the baked weights are found at runtime.
ENV HF_HOME=/opt/hf-cache
ENV TRANSFORMERS_NO_ADVISORY_WARNINGS=1

# Install from the LOCK file (full transitive pins, CPU-only torch verified —
# see its header) for a reproducible build. requirements.txt is still copied in
# for reference/for anyone rebuilding the lock; it's not what gets installed.
COPY requirements.txt requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock

# Copied alone, ahead of main.py, so an ordinary main.py edit doesn't bust this
# layer's cache and force a re-download of the ~600 MB of weights below. See
# model_pin.py's own docstring for why the pin lives in its own file.
COPY model_pin.py .

# Pre-download the model at build time, at the SAME pinned MODEL_ID/MODEL_REVISION
# main.py itself imports from model_pin.py. The site's JS text encoder
# (lib/clip.ts) is pinned to a matching revision of a DIFFERENT repo — the ONNX
# conversion of these same upstream weights — so image and query vectors share
# one space (tech debt 2.3).
#
# Plain `import model_pin` — no `ast` hack needed now that the pin lives in its
# own file with nothing else in it, so importing it can't run main.py's other
# module-level code (which would swallow a download failure into `_model_error`
# instead of failing the build: main.py treats a load failure as a runtime 503,
# not a startup crash — see its comment above _load_model()). Vision tower only
# (CLIPVisionModelWithProjection) — see the comment in main.py above
# _load_model() for why, and how that was verified safe.
RUN python -c "\
from model_pin import MODEL_ID, MODEL_REVISION; \
from transformers import CLIPProcessor, CLIPVisionModelWithProjection; \
print(f'baking {MODEL_ID} @ {MODEL_REVISION}'); \
CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, revision=MODEL_REVISION); \
CLIPProcessor.from_pretrained(MODEL_ID, revision=MODEL_REVISION)"

COPY main.py .

EXPOSE 8100

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8100"]
