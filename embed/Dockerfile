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

# Pre-download the model at build time (pinned in main.py); ON THE SAME variant the
# site's JS text encoder uses, so image and query vectors share one space.
# Vision tower only (CLIPVisionModelWithProjection) — see the comment in
# main.py above _load_model() for why, and how that was verified safe.
RUN python -c "from transformers import CLIPProcessor, CLIPVisionModelWithProjection; \
    CLIPVisionModelWithProjection.from_pretrained('openai/clip-vit-base-patch32'); \
    CLIPProcessor.from_pretrained('openai/clip-vit-base-patch32')"

COPY main.py .

EXPOSE 8100

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8100"]
