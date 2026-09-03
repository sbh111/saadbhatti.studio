# CLIP image-embedding service. Mirrors collector/ (FastAPI + uvicorn), but bakes
# the pre-trained CLIP ViT-B/32 weights into the image so /reindex is ready on
# start and needs no network for the model.
FROM python:3.12-slim

WORKDIR /app

# Keep the HF cache inside the image so the baked weights are found at runtime.
ENV HF_HOME=/opt/hf-cache
ENV TRANSFORMERS_NO_ADVISORY_WARNINGS=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the model at build time (pinned in main.py); ON THE SAME variant the
# site's JS text encoder uses, so image and query vectors share one space.
RUN python -c "from transformers import CLIPModel, CLIPProcessor; \
    CLIPModel.from_pretrained('openai/clip-vit-base-patch32'); \
    CLIPProcessor.from_pretrained('openai/clip-vit-base-patch32')"

COPY main.py .

EXPOSE 8100

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8100"]
