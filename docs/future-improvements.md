# Future Improvements

The FUTURE list from `docs/architecture.md` §19 — one sentence each on why it was not
built now and how the current schema supports adding it later.

1. **Learning Path Engine** — Not built: needs ordering/dependency logic on top of the
   mastery data we only just started collecting; later, `concepts` + `concept_mastery`
   become the nodes and scores the sequencer optimizes over.
2. **Mistake Intelligence** — Not built: requires clustering wrong answers into patterns,
   which needs answer volume first; later, `answers(evaluation→missingConcepts)` plus
   `learning_events(QUESTION_ANSWERED)` are already the pattern-mining inputs.
3. **Concept Graph** — Not built: prerequisite edges need curation/validation UX beyond the
   2–3 day budget; later, a `concept_edges(concept_id, requires_concept_id)` table hangs
   cleanly off the existing `concepts` primary keys.
4. **Socratic Tutor Mode** — Not built: a questioning-style system prompt + turn-state is a
   second Tutor personality to evaluate separately; later, it reuses `conversations`/
   `messages` with a `mode` flag and the same `<retrieved_evidence>` grounding block.
5. **Spaced Repetition** — Not built: scheduling needs due-date computation the simple
   0.7/0.3 formula deliberately avoids; later, `mastery_history.created_at` +
   `concept_mastery.mastery_score` already give the forgetting-curve inputs for per-concept
   intervals.
6. **Evidence-Aware Learning UI** — Not built: showing *why* a score changed per question
   needs richer evidence rendering; later, `concept_mastery.evidence` JSONB already stores
   per-question scores (`question_scores`) ready to visualize.
7. **AI Learning Coach** — Not built: a cross-project meta-advisor needs the aggregation
    maturity of the analytics layer first; later, it reads the same `learning_events` +
    `concept_mastery` + `recommendations` tables the global dashboard already aggregates.

## Recently implemented (were gaps, now done — 2026-09-17)

- **Tutor conversation summarization** — rolling concise summary of older turns on
  `conversations.summary` (`db/schema/005_conversation_summary.sql`), sent alongside
  the 6-message window as context-only.
- **Evaluation run tracking** — `runId`-stamped runs with capped `tests/eval/history/`
  and `IMPROVED`/`REGRESSED`/`UNCHANGED`/`BASELINE` comparison in `/admin/ai-evaluation`
  (`services/evaluation.service.ts`).
- **Admin System Health** — lightweight `/admin/health` (DB, storage, AI providers,
  embeddings, jobs, recent failures, overall `HEALTHY`/`DEGRADED`).
- **Home Dashboard PRD alignment** — Continue Learning, Recent Projects, Overall
  Progress, Areas Requiring Attention, Recommended Next Action (`services/dashboard.service.ts`).
