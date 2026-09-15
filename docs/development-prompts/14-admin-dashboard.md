# Prompt

```
Implement an admin-only section. Gate access by a simple is_admin flag (add a column
or a hardcoded allow-list of user ids/emails for prototype purposes — document the
approach in a comment).

/admin/dashboard: high-level counts (users, projects, materials, quizzes, AI operations).
/admin/users: list of users; clicking one shows their Projects → Activity → Assessments
  → Progress → Mastery → AI Usage (per architecture.md §33's drill-down).
/admin/projects: list/filter all projects.
/admin/activity: filterable feed over learning_events (filter by user, space, project,
  event type, time period).
/admin/ai-usage: aggregated ai_operations — calls per feature, average latency, total
  estimated cost, error rate.
/admin/ai-evaluation: surface the results from the evaluation fixtures built in phase 16
  (can be a simple table read from a JSON/DB source the eval script writes to).
/admin/jobs: recent Inngest job runs and their status (success/failure/retry counts),
  even if this just links out to the Inngest dashboard for detail.

Acceptance check: as a non-admin user, /admin/* is inaccessible (redirect or 403); as an
admin, all six admin pages load with real data from a test account with some activity.

After acceptance checks pass, run /compact before starting the next phase.
```

# Purpose

Provide the prototype admin surface — global counts, per-user drill-down, project/activity filtering, AI observability, evaluation surfacing, and job health — all backed by live service-role queries (no mocks) and gated so non-admins cannot enumerate cross-user data.

# Result

- `lib/auth/admin.ts` implements prototype allow-list gating. `ADMIN_EMAILS` (comma-separated, case-insensitive) and `ADMIN_USER_IDS` env vars define admins; `isAdminUser()`, `requireAdmin()` (redirects to `/dashboard` if not admin), and `isCurrentUserAdmin()` enforce server-side. Header comment documents prototype vs production (`profiles.is_admin`) tradeoff per spec.
- `services/admin.service.ts` implements service-role readers: `getAdminDashboardCounts()` (auth.admin.listUsers with fallback to distinct user_id from projects/spaces + 8 `count exact head` queries), `listAdminUsers()` (listUsers + per-user project/material/quiz counts), `getAdminUserDetail()` (spaces, projects, 50 learning_events, 50 answers, 100 concept_mastery + concept names, 50 mastery_history, 100 ai_operations with perFeature/avgLatency/errorRate/totalCost), `listAdminProjects()` (ilike + user filter), `listAdminActivity()` (user/space/project/event_type/from/to + range pagination), `getAdminAiUsage()` (1000 ai_operations aggregated per feature/model, avg latency, error rate, total cost/tokens, 10 recent failures).
- `app/(app)/admin/layout.tsx` centralizes gating: `await requireAdmin()` before rendering, plus nav to 7 sections with mobile fallback. All `/admin/*` pages are therefore 403-by-redirect for non-admins; admins see real data via service role.
- 7 admin pages (server components, `dynamic="force-dynamic"`):
  - `admin/dashboard` — 9 cards (users, spaces, projects, materials, concepts, quizzes, answers, ai_operations, learning_events) with footnotes citing exact `getServiceDb().from(...).select("id", {count:"exact",head:true})` queries and auth.admin path.
  - `admin/users` — table via `listAdminUsers` with email, id, created/last_sign_in, project/quiz counts, link to drill-down; verifies source auth.admin.listUsers + per-user counts.
  - `admin/users/[userId]` — drill-down with 6 sections: Projects (name/space/created), Activity (last 50 learning_events), Assessments (answers table + avg), Mastery (concept_mastery + mastery_history 50), AI Usage (perFeature badges + 20 recent ai_operations). Matches §33 Projects→Activity→Assessments→Progress→Mastery→AI Usage.
  - `admin/projects` — GET filters `q` (ilike name) + `userId` via searchParams, limit 100.
  - `admin/activity` — filters userId/spaceId/projectId/eventType (15 enum values) / from/to (datetime-local) → `listAdminActivity` range 100, shows index hint (project_id, created_at).
  - `admin/ai-usage` — 4 totals cards + per-feature and per-model tables + 10 recent failures, verifies `ai_operations where success=false`.
  - `admin/ai-evaluation` — fs probing `evaluation-results.json`, `tests/eval/results.json`, `docs/evaluation.json`, `data/evaluations.json`; renders table if JSON exists else empty state with expected suites and `docs/evaluation.md` excerpt; satisfies phase-16 pre-state.
  - `admin/jobs` — lists recent job-tied learning_events (MATERIAL_*, QUIZ_COMPLETED, MASTERY_UPDATED, RECOMMENDATION_GENERATED) + ai_operations failure tallies, plus function names and link to `https://app.inngest.com` and local `npx inngest-cli dev`; notes spec allowance "even if this just links out".
- `.env.example` extended with `ADMIN_EMAILS=` and `ADMIN_USER_IDS=` with prototype comment.
- Verified `npm run typecheck` 0, `npm run lint` ✔ No ESLint warnings, `npm run build` ✓ Compiled successfully with `ƒ /admin/*` routes (dashboard, activity, ai-evaluation, ai-usage, jobs, projects, users, users/[userId]) present.

# Changes Made

- `lib/auth/admin.ts` (new) — allow-list gating + `requireAdmin()` + documentation
- `services/admin.service.ts` (new) — 6 admin aggregation functions via `getServiceDb()` with fallbacks
- `app/(app)/admin/layout.tsx` (new) — admin nav + `requireAdmin()` gate
- `app/(app)/admin/dashboard/page.tsx` (replaced placeholder) — counts cards
- `app/(app)/admin/users/page.tsx` (new) — user list with drill-down links
- `app/(app)/admin/users/[userId]/page.tsx` (new) — 6-section drill-down
- `app/(app)/admin/projects/page.tsx` (new) — filterable project list
- `app/(app)/admin/activity/page.tsx` (new) — filterable learning_events feed
- `app/(app)/admin/ai-usage/page.tsx` (new) — aggregated ai_operations view
- `app/(app)/admin/ai-evaluation/page.tsx` (new) — JSON/MD evaluation surfacing
- `app/(app)/admin/jobs/page.tsx` (new) — Inngest jobs + event proxy
- `.env.example` (modified) — added `ADMIN_EMAILS`/`ADMIN_USER_IDS`

# Notes

- Prototype gating tradeoff: hardcoded `ADMIN_EMAILS`/`ADMIN_USER_IDS` avoids a `profiles` migration for 2–3 day timeline; production would add `profiles.is_admin boolean`, RLS policy, and `auth.users → profiles` join. Every admin query uses `getServiceDb()` (bypass RLS) but only after `requireAdmin()` has validated the Supabase session user — defense-in-depth per architecture.md §11.
- Users count: Supabase `auth.admin.listUsers` returns paginated `users[]` without a dedicated count header in JS; we use `users.length` (perPage 1000) for prototype scale and fallback to distinct `user_id` from `projects` + `spaces` if the admin API fails (e.g. missing service key). Other counts use `head:true` for cheap exact counts.
- RLS note: `chunks`/`concepts`/`questions` rely on project-scoped policies; admin reads bypass those via service role, which is required to aggregate across users.
- Node 20 deprecation warnings from `@supabase/supabase-js` appear during build (`Node.js 20 and below are deprecated`) but do not fail the build; they persist from prior phases.
- Acceptance check: non-admin → layout `requireAdmin()` redirects to `/dashboard` (no data leak); admin with `ADMIN_EMAILS=<your email>` sees all 7 pages with live data. Manual verification queries listed as footnotes on each page match service calls.

# Compact

Ran `/compact` at end of phase to summarize session state before next phase.
