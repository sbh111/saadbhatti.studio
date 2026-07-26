# Event collector — FastAPI + confluent-kafka (librdkafka ships in the wheel, so
# no apt build step needed). Kept tiny; it's the only thing exposed to the net.
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
