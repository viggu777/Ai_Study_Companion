# Local Embeddings — BAAI/bge-small-en-v1.5 via FastEmbed (Docker)

Free, open-source, no API key. Output dimension is **384** (not 768 like Groq
nomic) — the database migration `db/schema/004_embeddings_384.sql` aligns
`chunks.embedding` + the `match_chunks` RPC with it. Both must be applied together.

## Run locally (testing)

```bash
cd embeddings
docker compose up -d --build
curl localhost:8000/health
# {"status":"ok","model":"BAAI/bge-small-en-v1.5","dimension":384}
```

The app talks to it via (defaults in `lib/ai/AIService.ts`):

```bash
EMBEDDING_PROVIDER=local
EMBEDDING_API_BASE_URL=http://localhost:8000/v1
EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
```

Test an embedding (OpenAI-compatible):

```bash
curl localhost:8000/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"input": ["hello world", "second text"], "model": "BAAI/bge-small-en-v1.5"}'
```

## Deploy (VPS / production)

```bash
cd embeddings
docker compose up -d --build   # model is baked into the image; cache volume survives restarts
```

Then point the app at it:

```bash
EMBEDDING_API_BASE_URL=http://<host>:8000/v1
```

Notes:
- Image is CPU-only, ~1GB with the model baked in. bge-small handles ~50-100
  short texts/sec on a modest CPU — plenty for this workload (batches of 20).
- Single uvicorn worker is intentional: ONNX already threads internally and each
  worker would duplicate model RAM (~250MB).
- To switch back to Groq: `EMBEDDING_PROVIDER=groq` + valid `GROQ_API_KEY` —
  but that also requires migrating the column back to `VECTOR(768)`. Don't mix
  dimensions: every row in `chunks.embedding` must match the active model.
