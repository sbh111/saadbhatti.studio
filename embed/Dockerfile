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

COPY main.py .

# Pre-download the model at build time, at the SAME pinned MODEL_ID/MODEL_REVISION
# main.py itself defaults to. The site's JS text encoder (lib/clip.ts) is pinned to
# a matching revision of a DIFFERENT repo — the ONNX conversion of these same
# upstream weights — so image and query vectors share one space (tech debt 2.3).
#
# The two values are extracted from main.py's own source via `ast` rather than
# repeated here as literals or threaded through as a build ARG: either of those
# would be a second place they could drift out of sync with main.py — exactly the
# bug this fix closes (MODEL_REVISION used to default to "main", so "pinned" was
# aspirational). Reading them this way can't drift, because there's nothing to
# keep in sync — it evaluates the same two assignments main.py evaluates at import
# time, without running the rest of the module (which would swallow a download
# failure into `_model_error` instead of failing the build: main.py treats a load
# failure as a runtime 503, not a startup crash — see its comment above
# _load_model()). Vision tower only (CLIPVisionModelWithProjection) — see the
# comment in main.py above _load_model() for why, and how that was verified safe.
RUN python -c "\
import ast; \
from transformers import CLIPProcessor, CLIPVisionModelWithProjection; \
tree = ast.parse(open('main.py').read()); \
ns = {'os': __import__('os')}; \
[exec(compile(ast.Module(body=[n], type_ignores=[]), 'main.py', 'exec'), ns) \
    for n in tree.body if isinstance(n, ast.Assign) \
    and any(getattr(t, 'id', None) in ('MODEL_ID', 'MODEL_REVISION') for t in n.targets)]; \
model_id, revision = ns['MODEL_ID'], ns['MODEL_REVISION']; \
print(f'baking {model_id} @ {revision}'); \
CLIPVisionModelWithProjection.from_pretrained(model_id, revision=revision); \
CLIPProcessor.from_pretrained(model_id, revision=revision)"

EXPOSE 8100

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8100"]
