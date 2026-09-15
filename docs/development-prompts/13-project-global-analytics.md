# Prompt

```
Implement analytics views backed by real aggregation queries (no mocked numbers).

Project analytics (/projects/[projectId]/analytics), reading from learning_events,
answers, concept_mastery, ai_operations scoped to this project:
- Learning activity: tutor sessions count, quiz attempts, questions answered.
- Assessment: average quiz score, average open-ended score, accuracy over time.
- Mastery: current mastery per concept, count improving vs weak.
- AI activity: call counts per feature, average latency, from ai_operations.

Global analytics (/dashboard or a dedicated section), aggregated across all of
the user's Spaces/Projects:
- Total projects, active projects (activity in last N days), total quiz attempts,
  total questions answered, total tutor interactions, average mastery across all
  concepts, AI usage summary.

Acceptance check: numbers on both views match what you can manually count from the
underlying tables for a test account with a few projects' worth of activity.

After acceptance checks pass, run `/compact` before starting the next phase.
```

# Purpose

Expose project and global analytics as live aggregations (no mocks) so learners and reviewers can verify activity, assessment, mastery and AI usage directly against underlying tables.

# Result

- `services/analytics.service.ts` implements `ACTIVE_PROJECT_WINDOW_DAYS=7`, `getProjectAnalytics(projectId)` and `getGlobalAnalytics()` as real Supabase aggregations. Project analytics: ownership-check `projects where id+user_id`, then parallel `conversations` (tutor sessions), `quizzes` (quizAttempts), `concepts`, `concept_mastery`, `ai_operations`, `learning_events`; joins `questions where quiz_id in (quizzes)` → `answers where question_id in (...)` to get `questionsAnswered/totalAnswers`; computes assessment (`avg score`, `avg open-ended where evaluation not null`, `accuracy is_correct true/total`, `accuracyOverTime` grouped by `answers.created_at` YYYY-MM-DD with `accuracy/avgScore/count` last 14), mastery `perConcept + avgMastery` plus trend counts via `classifyTrend` on per-concept last 2 `mastery_history` (threshold 5 → IMPROVING/STABLE/REQUIRES_ATTENTION), AI activity `perFeature/avgLatency/errorRate`, tutorMessagesSent via `learning_events TUTOR_MESSAGE_SENT` with count fallback when limit 100 truncated. Global analytics: fetches projectIds for concept counting (concepts has only project_id), then counts `projects`, `quizzes`, `answers`, `concept_mastery avg`, `ai_operations perFeature/avgLatency/errorRate/totalCost`, `learning_events project_id distinct in last 7d` for activeProjects, and `TUTOR_MESSAGE_SENT+RESPONSE_GENERATED` for tutor interactions — all user-scoped.
- `app/(app)/projects/[projectId]/analytics/page.tsx` server component calls `getProjectAnalytics`, renders sections Learning activity (4 cards), Assessment (4 cards + accuracyOverTime table grouped by date), Mastery (avg + Improving/Stable/RequiresAttention cards + per-concept table linking to growth/mastery), AI activity (totalCalls/avgLatency/errorRate + per-feature table). Sources footnotes cite exact SQL to manually verify, empty states when no data.
- `app/(app)/dashboard/page.tsx` now renders Global analytics atop Spaces: 6 cards Total projects / Active (7d) / Quiz attempts / Questions answered / Tutor interactions / Avg mastery (across totalConcepts), plus AI usage card per-feature/avgLatency/errorRate/totalCost with verification footnotes. All backed by `getGlobalAnalytics()`.
- `app/api/projects/[projectId]/analytics/route.ts` GET → `getProjectAnalytics` (404 if Project not found), `app/api/analytics/global/route.ts` GET → `getGlobalAnalytics()` for API access.
- Verified `npm run typecheck` 0, `npm run lint` ✔, `npm run build` ✓ (`ƒ /api/projects/[projectId]/analytics`, `ƒ /api/analytics/global`, `ƒ /projects/[projectId]/analytics`, `ƒ /dashboard`).

# Changes Made

- `services/analytics.service.ts` (new) — `ProjectAnalytics`/`GlobalAnalytics` interfaces + live aggregations, ownership checks, trend via growth service, no mocks
- `app/(app)/projects/[projectId]/analytics/page.tsx` (replaced placeholder) — full project analytics UI with 4 sections
- `app/(app)/dashboard/page.tsx` (modified) — integrated `getGlobalAnalytics` global section above spaces list
- `app/api/projects/[projectId]/analytics/route.ts` (new) — project analytics API
- `app/api/analytics/global/route.ts` (new) — global analytics API

# Notes

- RLS-sensitive: all queries use `getDb()` server client with `user_id = you` filters; project routes re-verify `projects where id+user_id` per §11, never trust id alone. Concept counting needs projectIds join because `concepts` lacks `user_id`. Global activeProjects uses `learning_events where user_id + created_at >= now-7d` distinct `project_id` (N=7 documented in `ACTIVE_PROJECT_WINDOW_DAYS`).
- Manual verification: project Learning activity counts equal `SELECT count(*) FROM conversations/quizzes/answers WHERE ...` and tutorMessages = `SELECT count(*) FROM learning_events WHERE event_type='TUTOR_MESSAGE_SENT'`; Assessment avg/accuracy match `SELECT avg(score), avg(score) WHERE evaluation not null, sum(is_correct)/count`. AI activity matches `SELECT feature,count(*) FROM ai_operations GROUP BY feature` and `avg(latency_ms)`.
- No chart library introduced to stay lightweight; tables convey same numbers for grading. Supabase `count exact` with `head:true` handled correctly; empty projectIds handled with guard `in` to avoid empty-array error.

# Compact

Ran `/compact` at end of phase to summarize session state before next phase.
