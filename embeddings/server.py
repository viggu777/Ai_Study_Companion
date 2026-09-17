"""Local embeddings API: BAAI/bge-small-en-v1.5 via FastEmbed.

OpenAI-compatible subset:
  GET  /health          -> {"status": "ok", "model": ..., "dimension": 384}
  POST /v1/embeddings   -> {"object": "list", "data": [...], "model": ..., "usage": {...}}

Request body: {"input": "text" | ["t1", "t2"], "model": "<ignored, server is single-model>",
               "encoding_format": "float" | "base64"}
"""

import base64
import os
import struct
import time
from typing import List, Optional, Union

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

MODEL_NAME = os.environ.get("EMBED_MODEL", "BAAI/bge-small-en-v1.5")
# FastEmbed cache dir — mount a Docker volume here so the model survives restarts.
# Default HF/FastEmbed cache location is used when unset.

app = FastAPI(title="local-embeddings", version="1.0.0")

_model = None
_dim: Optional[int] = None


def get_model():
    global _model
    if _model is None:
        from fastembed import TextEmbedding

        _model = TextEmbedding(model_name=MODEL_NAME)
    return _model


def get_dim() -> int:
    """Probe once so /health reports the true output dimension."""
    global _dim
    if _dim is None:
        _dim = len(list(get_model().embed(["dimension probe"]))[0])
    return _dim


class EmbeddingRequest(BaseModel):
    input: Union[str, List[str]]
    model: Optional[str] = None
    encoding_format: Optional[str] = "float"


@app.get("/health")
def health():
    get_model()  # ensure loaded (downloads model on first run if uncached)
    return {"status": "ok", "model": MODEL_NAME, "dimension": get_dim()}


@app.post("/v1/embeddings")
def create_embeddings(req: EmbeddingRequest):
    inputs = [req.input] if isinstance(req.input, str) else req.input
    if not inputs:
        raise HTTPException(status_code=400, detail="input must be a non-empty string or list of strings")
    if any(not isinstance(t, str) for t in inputs):
        raise HTTPException(status_code=400, detail="every input must be a string")
    if req.encoding_format not in (None, "float", "base64"):
        raise HTTPException(status_code=400, detail="encoding_format must be 'float' or 'base64'")

    t0 = time.time()
    try:
        vectors = list(get_model().embed(inputs))
    except Exception as e:  # noqa: BLE001 — surface as 500 with message
        raise HTTPException(status_code=500, detail=f"embedding failed: {e}") from e
    elapsed_ms = int((time.time() - t0) * 1000)

    data = []
    for i, vec in enumerate(vectors):
        # FastEmbed yields numpy arrays — tolist() gives plain Python floats
        # that JSON can serialize (np.float32 is not JSON-serializable).
        values = [float(x) for x in vec.tolist()]
        if req.encoding_format == "base64":
            embedding = base64.b64encode(struct.pack(f"{len(values)}f", *values)).decode()
        else:
            embedding = values
        data.append({"object": "embedding", "embedding": embedding, "index": i})

    return {
        "object": "list",
        "data": data,
        "model": MODEL_NAME,
        "usage": {"prompt_tokens": 0, "total_tokens": 0, "processing_ms": elapsed_ms},
    }
