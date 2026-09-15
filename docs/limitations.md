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
   18 deterministic fixtures + 46 unit/integration tests (`tests/`, `docs/evaluation.md`).
   No LLM-as-judge, no regression tracking across model versions, no dataset versioning.
5. **Single-model dependence.** Chat runs only on `Llama-4-Maverick-17B-128E-Instruct-FP8`,
   embeddings only on `nomic-embed-text-v1.5`. No fallback provider, no per-feature model
   routing, no cost-based tiering. A provider outage degrades Tutor/Quiz/Recommendations
   to errors/fallbacks (never stuck jobs, but degraded all the same).
6. **API keys are dummy in this environment** (`.env.local`). Live AI paths are verified by
   shape-validation + offline fixtures here; true end-to-end (real PDF → real Tutor answer)
   requires real `META_API_KEY`/`GROQ_API_KEY` and the manual Vercel smoke test (phase 18).
7. **No live deployment yet.** The app is deployment-ready (clean build, `18-deployment.md`
   checklist) but there is no Vercel URL, no Inngest Cloud sync, and no demo video in this
   snapshot. The repo is also not yet git-initialized (`git status → not a git repository`).
8. **Retrieval threshold is heuristic.** `RELEVANCE_THRESHOLD=0.25` was chosen from
   observed `nomic-embed-text-v1.5` score ranges, not tuned on a labeled corpus. The
   JS-cosine fallback in `lib/rag/retrieve.ts` caps at 100 chunks — fine for prototype
   scale, not for large libraries.
9. **Conversation context is a bounded window** (last 6 messages) plus weak-concept summary —
   long tutoring threads lose early detail, and there is no summarization/compaction step.
10. **No rate limiting, caching, or streaming.** Every Tutor message is a full round-trip;
    repeated identical questions re-embed and re-query; the UI has loading states but no
    token streaming. File uploads cap at a reasonable size but there is no per-user quota.
11. **Accessibility/polish is baseline.** Emerald sidebar theme is consistent and blue-free,
    but there has been no screen-reader pass, no keyboard-navigation audit, and empty/loading
    states vary in polish across pages.
