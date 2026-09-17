# Pre-downloads BAAI/bge-small-en-v1.5 (~130MB) so the container
# serves instantly and doesn't need HuggingFace access at runtime.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Bake the model into the image (override with EMBED_MODEL at runtime if needed)
ARG EMBED_MODEL=BAAI/bge-small-en-v1.5
ENV EMBED_MODEL=${EMBED_MODEL}
RUN python -c "from fastembed import TextEmbedding; m = TextEmbedding(model_name='${EMBED_MODEL}'); print('model ready, dim test:', len(list(m.embed(['ok']))[0]))"

COPY server.py .

EXPOSE 8000

# Single worker: FastEmbed/ONNX already threads internally; more workers duplicate RAM.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
