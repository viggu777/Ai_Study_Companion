# Prompt

```
Part A — Growth Analysis:
- services/analytics or mastery.service.ts: a function that reads mastery_history per
  concept and classifies each concept as IMPROVING / STABLE / REQUIRES_ATTENTION by
  comparing the two most recent history points (define a simple threshold, e.g. >+5 =
  improving, <-5 = requires attention, else stable).
- UI on /projects/[projectId]/growth: a simple table or chart per concept showing
  previous vs current mastery and the trend classification.

Part B — Recommendations:
- ai/recommendation.ts: structured-output prompt that takes weak concepts, recent
  mistakes, mastery, learning goal, and recent activity, and produces a specific,
  actionable recommendation: {title, action_items: [string, ...]}. Explicitly instruct
  the model to avoid generic output like "keep studying" — action items should name
  actual concepts/materials/page ranges where available.
- services/recommendation.service.ts: triggered after mastery updates (chained from
  phase 11's workflow) and persists to `recommendations` with status='ACTIVE'. Emit
  RECOMMENDATION_GENERATED.
- Log to ai_operations (feature='RECOMMENDATION').
- UI: recommendation card on the Project dashboard and a dedicated list view, with a
  way to mark a recommendation COMPLETED or DISMISSED (emit RECOMMENDATION_COMPLETED
  on completion).

Acceptance check: after completing a quiz that leaves a concept weak, confirm a growth
entry shows REQUIRES_ATTENTION for that concept and a recommendation is generated that
names that specific concept, not a generic message.

After acceptance checks pass, run `/compact` before starting the next phase.
```

# Purpose

Surface learner growth from deterministic mastery history and close the loop with specific, grounded recommendations chained after mastery updates.

# Result

Part A — `services/growth.service.ts` exports `classifyTrend(prev,new) => IMPROVING (>+5) / REQUIRES_ATTENTION (<-5) / STABLE` (`TREND_THRESHOLD=5`) and `getGrowthAnalysis(projectId, {userId,useServiceDb})` which: ownership-checks `projects where id + user_id`, fetches `concepts` for project, `concept_mastery` current scores, and per-concept last 2 `mastery_history` rows (ordered `created_at desc limit 2`). If no history → STABLE with `previous null`; if 1 history row → delta = `new-previous` of that row; if ≥2 rows → delta = `latest.new - prior.new`, `current = mastery.current ?? latest.new`. Returns `GrowthEntry[]` with `previousScore/currentScore/delta/trend/historyCount`. `/projects/[projectId]/growth` server component renders summary badges (`Improving/Stable/Requires attention counts`) and table per concept (previous, current, delta colored, trend pill), with threshold footnote; empty state when no concepts.

Part B — `ai/recommendation.ts` defines `RecommendationSchema {title:string, action_items:array}`, `RECOMMENDATION_SYSTEM_PROMPT` forbidding generics (`"keep studying"` rejected) and requiring each `action_item` name a real concept + material/page range when available (2-4 items, title 6-10 words naming primary weak concept), `buildRecommendationUserPrompt({projectName,learningGoal,weakConcepts,recentMistakes,masterySnapshot,recentActivity,materialsContext})` with structured blocks, and `validateRecommendationOutput` (title ≤120, 2-5 items each ≥10 chars, generic heuristic reject).

`services/recommendation.service.ts` `generateRecommendationForProject({projectId,userId,spaceId})` via `getServiceDb()`: validates ownership, runs `getGrowthAnalysis(..., useServiceDb:true)`, builds `weakConcepts = REQUIRES_ATTENTION || mastery<60`, gathers `recentMistakes` (last 20 answers incorrect/score<60 mapped to concept name), `recentActivity` (last 10 `learning_events`), `materialsContext` (per weak concept `source_material_id→materials.filename + chunks pages pp. X-Y`), calls `aiService.generateStructured({systemPrompt:RECOMMENDATION_SYSTEM_PROMPT,schema:RecommendationSchema,temperature:0.4})` with retry `temperature:0.3` on validation fail, logs `ai_operations feature RECOMMENDATION` with `requestId` latency both success/failure, persists `recommendations {project_id,user_id,title,action_items,status ACTIVE}` and emits `RECOMMENDATION_GENERATED`. Also exports `listRecommendations(projectId)` and `updateRecommendationStatus(id, status)` which updates row and emits `RECOMMENDATION_COMPLETED` (via service DB) on COMPLETED.

Inngest chaining per architecture §13 `Quiz Completed → Evaluate → Update Mastery → Detect Weakness → Generate Recommendation`: `lib/jobs/mastery.ts:4` after `step.run("update-mastery")` now chains `step.run("trigger-recommendation") → inngest.send({name:"mastery/updated", data:{projectId,userId,spaceId,quizId}})` when `updated.length>0`, with fallback `step.run("fallback-recommendation") → generateRecommendationForProject` on send failure; `lib/jobs/recommendation.ts:4` (`id recommendation-generate`, `trigger mastery/updated`) steps to `generateRecommendationForProject`. `app/api/inngest/route.ts:5` serves `[...materialFunctions, ...masteryFunctions, ...recommendationFunctions]`.

UIs: `app/api/projects/[projectId]/recommendations/route.ts` GET list; `app/api/recommendations/[recommendationId]/route.ts` PATCH status; `app/(app)/projects/[projectId]/recommendations/page.tsx` + `RecommendationClient.tsx` filtered list with COMPLETED/DISMISSED actions; `app/(app)/projects/[projectId]/page.tsx` now fetches top-3 ACTIVE recs and renders `RecommendationDashboardCard.tsx` (COMPLETED/DISMISSED inline, link to full list). Build `✓`, `typecheck` 0, `lint` ✔.

# Changes Made

- `ai/recommendation.ts` (new) — prompt forbidding generics, schema, builder, validator
- `services/growth.service.ts` (new) — `classifyTrend` + `getGrowthAnalysis` per spec threshold
- `services/recommendation.service.ts` (new) — generation orchestration, weak/mistakes/materials context, observability, persistence, list/update + events
- `lib/jobs/recommendation.ts` (new) — Inngest `mastery/updated → recommendation-generate`
- `lib/jobs/mastery.ts` (modified) — chains `mastery/updated` after mastery update with fallback direct call
- `app/api/inngest/route.ts` (modified) — serves 3 function groups
- `app/api/projects/[projectId]/recommendations/route.ts` (new) — GET list
- `app/api/recommendations/[recommendationId]/route.ts` (new) — PATCH status + `RECOMMENDATION_COMPLETED`
- `app/(app)/projects/[projectId]/growth/page.tsx` (modified) — table with trend classification
- `app/(app)/projects/[projectId]/recommendations/page.tsx` + `RecommendationClient.tsx` (new) — dedicated list view
- `app/(app)/projects/[projectId]/page.tsx` (modified) — dashboard recommendation card
- `app/(app)/projects/[projectId]/RecommendationDashboardCard.tsx` (new) — dashboard ACTIVE card

# Notes

- Trend computed from `mastery_history` last two `new_score` values (or single row's `previous→new`), not from current `concept_mastery` alone, so growth reflects the two most recent evidence points as spec requires. Threshold `5` makes -5.1 → REQUIRES_ATTENTION, +5.1 → IMPROVING, ±5 exact → STABLE.
- Weak detection for recommendations: `REQUIRES_ATTENTION` OR `mastery_score<60` OR missing mastery (treated 0). So a quiz that drops a concept from 50→42.5 (evidence 25) will show REQUIRES_ATTENTION and trigger a recommendation naming that concept specifically — generic "keep studying" is rejected at prompt + validator heuristic.
- `generateRecommendationForProject` uses `getServiceDb()` (background context, bypasses RLS) but still enforces `projects.user_id = userId` manually; no `user_id` ever comes from client. `materialsContext` resolves `concepts.source_material_id → materials.filename + chunks page range pp. X-Y`; if missing, still requires concept name in action items.
- Workflow is Inngest-chained and retryable independently: `quiz/completed → mastery-update (step update-mastery) → mastery/updated → recommendation-generate (step generate-recommendation)` with local fallback `setTimeout`/`step.run fallback` mirroring `material/uploaded` fallback for dev without Ingest cloud.

# Compact

Ran `/compact` at end of phase to summarize session state before next phase.
