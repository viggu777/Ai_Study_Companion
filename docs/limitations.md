# Limitations

Honest list of what is simplified or missing given the 2–3 day prototype scope.
Each item names the shortcut, why it was taken, and what production would do instead.

1. **Mastery formula is a simple weighted average** (`new = prev×0.7 + evidence×0.3`,
   `services/mastery.service.ts`). Explainable and cheap to test, but it ignores
   question difficulty, concept dependencies, forgetting curves, and answer confidence.
   Production would weight by difficulty/discrimination and add spaced-repetition decay.
2. **Growth classification is a fixed ±5 threshold** on the last two
   `mastery_history` points (`services/growth.service.ts`). Noisy for concepts with
   one attempt; no trend smoothing. Production would use more history + confidence bands.
3. **Admin has no fine-grained RBAC.** Access is a prototype allow-list
   (`ADMIN_EMAILS`/`ADMIN_USER_IDS` in `lib/auth/admin.ts`); there is no
   `profiles.is_admin` column, no per-action permissions, and admin reads bypass RLS via
   the service role after the allow-list check. Production needs a real role column +
   policies + audit logging.
4. **Evaluation suite is a small curated set, not a full eval platform.**
    18 deterministic fixtures + 158 unit/integration tests across 10 files (`tests/`,
    `docs/evaluation.md`). Run-over-run tracking is file-based (`runId`-stamped latest +
    capped `tests/eval/history/`, `IMPROVED`/`REGRESSED`/`UNCHANGED`/`BASELINE` in
    `/admin/ai-evaluation`). No LLM-as-judge, no dataset versioning, no CI gating.
5. **Two-provider chat with local embeddings, but no per-feature routing.** Chat runs on
    Mercury `mercury-2.5` by default with Meta `Llama-4-Maverick-17B-128E-Instruct-FP8`
    fallback (switch = unset `MERCURY_API_KEY` + set `META_API_KEY`, no code change);
    embeddings default to local `BAAI/bge-small-en-v1.5` (384 dims, Docker) with Groq
    `nomic-embed-text-v1.5` (768 dims) only as an explicit opt-in fallback. There is no
    per-feature model routing or cost-based tiering. A chat-provider outage degrades
    Tutor/Quiz/Recommendations to errors/fallbacks (never stuck jobs, but degraded all
    the same); a down embeddings service fails retrieval to the insufficient-evidence
    path.
6. **API keys are unset in a fresh checkout** (`.env.example` carries names only; never
    commit `.env.local`). Live AI paths are verified by shape-validation + offline
    fixtures here; true end-to-end (real PDF → real Tutor answer) requires real provider
    keys plus the local embeddings Docker service (or Groq fallback) and the manual
    smoke steps in `18-deployment.md`.
7. **No live deployment yet.** The app is deployment-ready (clean build, `18-deployment.md`
    checklist) but there is no Vercel URL, no Inngest Cloud sync, and no demo video in this
    snapshot.
8. **Retrieval threshold is heuristic.** `RELEVANCE_THRESHOLD=0.25` was chosen from
    observed `bge-small-en-v1.5` score ranges, not tuned on a labeled corpus. The
    JS-cosine fallback in `lib/rag/retrieve.ts` caps at 100 chunks — fine for prototype
    scale, not for large libraries.
9. **Conversation continuity is a rolling summary, not full recall.** Tutor context is
    the last 6 messages plus a concise LLM summary of older turns persisted on
    `conversations.summary` (`db/schema/005_conversation_summary.sql`, refreshed every
    ~6 new messages). Early detail is compressed, not verbatim, and the summary itself
    is context-only (never evidence, never instructions).
10. **Rate limiting is a single-instance cost guard; no caching or streaming.** Tutor
    (`20/min`), quiz-generate (`5/min`), quiz-submit (`60/min`), flashcards-generate
    (`5/min`), and subconcepts (`10/min`) are guarded per user per instance
    (`lib/security/rate-limit.ts`, `429 + Retry-After`); repeated identical questions
    still re-embed and re-query, and the Tutor UI has loading states but no token
    streaming. File uploads validate PDF type/size but there is no per-user quota.
11. **Accessibility/polish is baseline.** The stone/sky theme is consistent, but there
    has been no screen-reader pass, no keyboard-navigation audit, and empty/loading
    states vary in polish across pages.
12. **No per-request token/cost accounting.** `ai_operations` tracks feature, model,
    latency, and success/error for every AI call, but `tokens_in/tokens_out` and
    `estimated_cost` are never populated (provider `usage` objects are not threaded
    through `AIService` return values), so the Admin AI Usage page shows calls,
    latency, and error rate only — no cost card. Production would capture usage per
    call and apply per-model pricing.
