# AI Study Companion — Complete Website / Project Overview

> **Source of truth:** the actual implementation in this repo (read September 2026).
> No feature is listed unless it exists in code. File paths are absolute-from-repo-root.
> Target reader: a new developer who must understand frontend, backend, database, AI,
> workflows, and deployment from this document alone.
>
> Prior session fixes (already in code): recommendation `space_id` select bug fixed,
> sidebar collapse rewritten + "Back to space" moved below logo, TopBar redesigned,
> `/profile` page built, `RecommendationClient` hardened.

---

## 0. One-paragraph summary

AI Study Companion is a Next.js 14 (App Router) + TypeScript full-stack app backed by
Supabase (Postgres + pgvector + Auth + Storage), Inngest (background jobs), Mercury
(Inception Labs, chat/structured) with Meta Llama fallback, and a local FastEmbed
embedding service (`BAAI/bge-small-en-v1.5`, 384 dims, `embeddings/` Docker).
Users organize learning as **Spaces → Projects**, upload **PDF Materials** into a
Project, chat with a **grounded Tutor** (citations, insufficient-evidence path,
prompt-injection defense), take **Adaptive Quizzes** (MCQ + LLM-graded open-ended),
and the system deterministically tracks **Concept Mastery → Growth → Recommendations**,
surfaced via **Analytics**, **Activity feed**, **Admin dashboard**, and per-project
**Flashcards / Concepts / Mastery / Growth / Analytics / Recommendations** pages.
Route handlers under `app/api/` are thin; all business logic lives in `services/`;
all prompts/schemas/validators live in `ai/` behind `lib/ai/AIService.ts`.
Every user-data query is scoped `WHERE id AND user_id`; RLS is defense-in-depth.
Every AI call writes one row to `ai_operations`; every domain transition emits a row
to `learning_events`.

The closed learning loop (from `docs/architecture.md` §1, implemented):

```
Spaces → Projects → Materials (PDF) → Chunks+Embeddings+Concepts
  → Tutor (RAG, citations) → Quiz (evidence) → Mastery (0.7/0.3 formula)
  → Growth (±5 trend) → Recommendations → Next Action → (more evidence)
```

---

## 1. Tech stack & project structure

| Layer | Choice (actual) | Evidence |
|---|---|---|
| Framework | Next.js 14.2.35 App Router, React 18.3.1, TypeScript 5.7 | `package.json`, `next.config.mjs`, `app/` |
| UI | React + Tailwind 3.4 + custom `components/ui.tsx` (no shadcn dependency installed) | `tailwind.config.ts`, `components/ui.tsx` |
| DB / vector | Supabase Postgres + pgvector (`VECTOR(384)` live) | `db/schema/*.sql` |
| Auth | Supabase Auth (email/password), `@supabase/ssr` | `lib/auth/*`, `middleware.ts` |
| Storage | Supabase Storage bucket `materials` (private) | `db/schema/003_storage.sql`, `lib/storage/materialStorage.ts` |
| Jobs | Inngest (`material/uploaded`, `quiz/completed`, `mastery/updated`) + direct-call fallback | `lib/jobs/*`, `app/api/inngest/route.ts` |
| Chat LLM | Mercury `mercury-2.5` when `MERCURY_API_KEY` set, else Meta `Llama-4-Maverick-17B-128E-Instruct-FP8` | `lib/ai/AIService.ts:94-116` |
| Embeddings | Local FastEmbed `BAAI/bge-small-en-v1.5` 384d (default); `EMBEDDING_PROVIDER=groq` → `nomic-embed-text-v1.5` 768d (requires re-migration) | `lib/ai/AIService.ts:40-55`, `embeddings/` |
| PDF parse | `pdf-parse` (loaded via `pdf-parse/lib/pdf-parse.js` to dodge ESM bug) | `services/material.service.ts:496-513`, `next.config.mjs` |
| Tests | Vitest (unit/integration) + `tsx tests/eval/run-eval.ts` fixtures | `vitest.config.ts`, `tests/` |
| Node | `>=22` | `package.json:engines` |

### 1.1 Important folders & files

```
app/
  page.tsx                    → / (session redirect)
  layout.tsx                  → <html>, Inter font, metadata
  globals.css                 → Tailwind + .page-enter/.fade-enter/.skeleton/.tnum
  error.tsx / not-found.tsx / (app)/loading.tsx
  (auth)/login/page.tsx       → /login
  (auth)/signup/page.tsx      → /signup (form + onboarding topic → creates space)
  (app)/layout.tsx            → auth guard + <AppShell>
  (app)/dashboard/page.tsx    → /dashboard
  (app)/spaces/new/page.tsx   → /spaces/new
  (app)/spaces/[spaceId]/page.tsx
  (app)/spaces/[spaceId]/projects/new/page.tsx
  (app)/projects/[projectId]/page.tsx            → project hub
  (app)/projects/[projectId]/{materials,tutor,flashcards,concepts,quiz,mastery,growth,analytics,recommendations}/
  (app)/profile/page.tsx + ProfileClient.tsx     → /profile (name + password)
  (app)/admin/{dashboard,users,users/[userId],projects,activity,ai-usage,ai-evaluation,jobs}/
  api/{profile,auth/logout,spaces,spaces/[spaceId],spaces/[spaceId]/projects,
       projects/[projectId],projects/[projectId]/{materials,concepts(+[conceptId]/subconcepts),
       flashcards,quiz(+[quizId](+/submit)),tutor(+conversations),analytics,recommendations,retrieve},
       materials/[materialId](+/retry),chunks/[chunkId],recommendations/[recommendationId],
       analytics/global,inngest}
components/
  AppShell.tsx                → sidebar + topbar + content column shell
  Sidebar.tsx                 → nav (workspace/project/admin), collapse, profile popover, logout
  TopBar.tsx                  → breadcrumbs, ⌘K search, notifications stub, account menu
  ui.tsx                      → Button/LinkButton/Card/Badge/PageHeader/Stat/Field/inputClass/Alert/EmptyState/Spinner
  icons.tsx                   → ~20 stroke SVGs (no icon lib)
  avatar.ts                   → avatarTone/displayNameOf/initialOf (pure, shared client+server)
  RecommendedNextAction.tsx   → project hub "next action" card
  AuthShell.tsx / AuthPreview.tsx → login/signup split layout + rotating mock preview
services/  project | material | chunk | concept | flashcard | quiz | tutor |
           mastery | growth | recommendation | analytics | admin  (.service.ts)
lib/       auth/{getCurrentUser,admin,middleware,supabase/{server,client}} |
           db/supabase | ai/{AIService,observability} | rag/{chunker,retrieve} |
           storage/materialStorage | jobs/{client,material,mastery,recommendation} |
           security/{ownership,rate-limit} | datetime.ts
ai/        tutor | quiz | assessment | concepts (subconcepts) | flashcards | recommendation
db/schema/ 001_initial_schema.sql → 002_retrieve.sql → 003_storage.sql → 004_embeddings_384.sql
embeddings/ server.py + Dockerfile + docker-compose.yml + requirements.txt + README.md
middleware.ts / tailwind.config.ts / next.config.mjs / vitest.config.ts
tests/{unit/*,integration/*,eval/{fixtures,run-eval,results.json}} / evaluation-results.json
scripts/{smoke-live,smoke-deep,retrieve-test,generate-pdfs.py} / smoke-test.ts
types/pdf-parse.d.ts
docs/      architecture.md (+.pdf) | build-prompts.md | development-prompts/02-19 (+.pdf) |
           evaluation.md | limitations.md | future-improvements.md |
           prompting-guide.md | ai-tools-usage.md (+.pdf)
.env.example / .env.local / README.md / AGENT_INSTRUCTIONS.md
```

---

## 2. Frontend — pages, components, flows, state, forms, styling

### 2.1 Global shell & styling language

- `app/layout.tsx`: server component, `Inter --font-inter`, title template `%s · AI Study Companion`, `themeColor #022c22`, `bg-stone-100 font-sans`.
- `app/globals.css`: Tailwind base/components/utilities; `::selection` sky; 2px sky `:focus-visible`; thin stone scrollbars; keyframes `rise-in/shimmer/fade-in`; utilities `.page-enter` (240ms rise), `.fade-enter`, `.skeleton` shimmer, `.tnum` tabular numbers.
- Design tokens (enforced by `components/ui.tsx`): page `bg-stone-100` → cards `rounded-xl border-stone-200 bg-white shadow-card` → primary `bg-sky-600 hover:bg-sky-700` → accent ring `sky-600/10..20`. No emoji; all icons from `components/icons.tsx` (24px, stroke 1.8).
- `app/error.tsx` (client): shows `error.message`, `Try again (reset)` + `Back to dashboard`. `app/not-found.tsx`: static 404 card linking `/dashboard` (wording deliberately conflates missing vs forbidden). `app/(app)/loading.tsx`: skeleton grid.
- `app/(app)/layout.tsx` (server): `getCurrentUser()` (redirects to `/login` if null) → `isAdminUser(user)` + `displayNameOf(user)` → `<AppShell>`. Individual pages render content only.
- `components/AppShell.tsx` (client): `useSidebarCollapsed()` (synced offset) + `mobileOpen` + `displayName` state (synced from props so sidebar rename propagates without reload). Layout: `h-dvh overflow-hidden` → `<Sidebar>` (fixed) + right column `padding-left 264/72px` via injected `<style>` (desktop `lg+` only) → `<TopBar onMenu>` → `<main overflow-y-auto px-4 py-6>`.

### 2.2 Sidebar (`components/Sidebar.tsx`, client)

- Shared collapsed state `useSidebarCollapsed()`: `localStorage asc:sidebar-collapsed` + `CustomEvent asc:sidebar-toggle` + cross-tab `storage` listener. Setter is intentionally side-effect-free w.r.t. React updater (computes from a `ref`, then persists + dispatches) — earlier version did work inside the updater and behaved as "collapse not working".
- Nav sections: `workspaceNav` = Dashboard `/dashboard`, New Space `/spaces/new`, Profile `/profile`; `projectNav(projectId)` (parsed from `^/projects/[^/]+`) = Overview, Materials, Tutor, Flashcards, Concepts, Quiz, Mastery, Growth, Analytics, Recommendations (10 items); `adminNav` (only if `isAdmin`) = Overview/Users/Projects/Activity/AI Usage/AI Evaluation/Jobs. Active = exact or `startsWith(href + "/")`.
- Header: logo `A` mark + "AI Study Companion" linking `/dashboard`; mobile-only × close button; **`Back to space` pill sits BELOW the logo** (`mt-3`, `bg-stone-100`, hover sky) and only renders on project routes.
- Bottom: profile popover (avatar, name, email, display-name input with Enter/Escape, Save, `View full profile → /profile`), Logout (`POST /api/auth/logout` then `window.location.href=/login` to clear RSC cache), desktop-only (`hidden lg:flex`) Collapse/Expand toggle. Mobile: overlay + slide-in drawer `w-[264px]` (collapsed rail `lg:w-[72px]` desktop only).

### 2.3 TopBar (`components/TopBar.tsx`, client) — redesigned

- Sticky `top-0 z-20 h-16 bg-white/85 backdrop-blur` + 2px gradient hairline (`sky-600 → sky-400 → teal-400`).
- Breadcrumbs (`useMemo`): `/dashboard` → Dashboard; `/profile` → Profile; `/spaces/new`; space routes (real space name); project routes (linked space + Project + one of 10 `PROJECT_PAGES`); `/admin/*` (7 `ADMIN_PAGES`). Current page renders as highlighted pill; parents as hover links with `›` separators.
- Real names via module `globalNameCache` + `localStorage asc:name:project|space:*` + `inflight` dedupe; parallel `GET /api/projects/:id` + `GET /api/spaces/:id` (+ linked space). Zero fetches on back/forward/remount when cached.
- ⌘K/Ctrl+K page-jump search: `destinations` = Dashboard, New Space, current project pages, admin pages (if admin). Filtered dropdown with hint chips; Enter jumps to first match; Escape closes. Hidden below `md`.
- Notifications: bell with presence dot; dropdown is an explicit **stub** ("You're all caught up … will show up here") — no notifications system exists.
- Account menu: avatar pill (tone + initial + name on `xl`) → dropdown with name/email, `View profile & settings → /profile`, `Sign out` (same logout POST + hard nav). Closes on navigation.

### 2.4 Routes & UI flows

| Route | Server/Client | Data & behavior |
|---|---|---|
| `/` (`app/page.tsx`) | server | `auth.getUser()` → `redirect(/dashboard or /login)`. No UI. |
| `/login` | client `force-dynamic` | `email/password` states; `supabase.auth.signInWithPassword` → `router.push(/dashboard)+refresh`; `AuthShell` + `Field/inputClass/Alert/Button`. |
| `/signup` | client `force-dynamic` | Two-step `form → onboarding`. Validates name required, password ≥8 + match. `signUp({data:{display_name}})` → topic chips (Exam prep/Biology/Interview/Spanish) + `POST /api/spaces` → `/spaces/:id`; `Skip → /dashboard`. |
| `/dashboard` | server | Parallel `listSpaces()` + `getGlobalAnalytics()` (global failure caught → error box). 6 `Stat` cards (projects, quiz attempts, tutor interactions, avg mastery, AI calls, avg latency) + `AI usage by feature` badges + spaces grid (`prefetch` links) + `New Space`. `EmptyState` when 0 spaces. |
| `/spaces/new` | client | `name/desc/error/loading`; requires trimmed name; `POST /api/spaces` → `/spaces/:id`; Cancel = `router.back()`. |
| `/spaces/:spaceId` | server | `getSpace + listProjects` parallel; `notFound()` if null; project cards → `/projects/:id`; `New Project` button. |
| `/spaces/:spaceId/projects/new` | client | `useParams().spaceId`; `name/desc/learningGoal`; `POST /api/spaces/:id/projects` → `/projects/:id`. |
| `/projects/:projectId` (hub) | server | Parallel `getProject`, `listActiveRecommendations(3).catch([])`, `getGrowthAnalysis.catch([])`, `listMaterials.catch([])`. Weakest-first `RecommendedConcept[]` (`currentScore ?? -1` sort + material names). 9 feature tiles + Active-recs card + `<RecommendedNextAction>`. |
| `/projects/:projectId/materials` | server page + `MaterialsClient` | Page reads `?material=` highlight id. Client: `materials/uploading/error/retrying/deleting` + 3s polling while `QUEUED/PROCESSING`; upload validates PDF + 10MB, optimistic `QUEUED` prepend; `POST /api/projects/:id/materials` (FormData), `POST /api/materials/:id/retry`, `DELETE /api/materials/:id` (confirm if READY). Table File/Status/Pages/Created/Action with tone badges. |
| `/projects/:projectId/tutor?q=` | server page + `TutorClient` (~1000 lines) | Page passes `initialQuestion` (sliced 500). Client: conversations list + active conversation + messages + composer; boot `GET conversations` → auto-create if empty → `GET tutor?conversationId=`; local intent regex: quiz intent (`quiz\|test me\|mock test\|practice`) → inline quiz-card, flashcard intent → flashcard-card, else optimistic user msg + `POST tutor {question,conversationId}` → `TutorResponse{answer,confidence,grounded,citations,followUpSuggestion}`. Quick-action pills, fallback follow-ups, copy/regenerate/ask-follow-up, autogrow textarea (Enter send), chats grouped TODAY/YESTERDAY/7D/30D/MONTH + search, Sources panel (`GET /api/chunks/:id`, cached excerpts), collapsible sidebars. Full-height via `-mx-4 -my-6`. Links to Quiz/Flashcards/Materials. |
| `/projects/:projectId/flashcards` | server guard + `FlashcardsClient` | `count` select 5/10/15/20 (default 10); `POST flashcards {count}`; local shuffle, progress bar, flip (button + space hint), Prev / Still learning / Got it. |
| `/projects/:projectId/concepts` | server guard + `ConceptsClient` | `GET concepts` on mount, A-Z sort, search filter, group by material; expandable subconcepts (`POST concepts/:id/subconcepts`); links Practice (`/quiz`), Ask tutor (`/tutor?q=Explain X`), Flashcards. |
| `/projects/:projectId/quiz` | server guard + `QuizClient` (~635 lines) | `quizzes/fetching/generating/error/activeQuiz/currentIdx/selected/openResponse/results/submitting/completed/showFeedback`. `GET quiz` history, `POST quiz {count:10}`, `GET quiz/:id?answers=1` resume (first unanswered or summary), `POST quiz/:id/submit {questionId,response}` merges `correct_answer/explanation`. StepDots, MCQ radio cards with verdict colors, open-ended textarea (AI-graded), inline `evaluation{score,understanding,strengths,missingConcepts,reasoningQuality,feedback}`, summary avg% + per-question review, history badges. |
| `/projects/:projectId/mastery?concept=` | server + `MasteryClient` | Server builds `MasteryEntry[]` weakest-first from growth + material names. Client: expandable rows, search, filter ALL/IMPROVING/STABLE/REQUIRES_ATTENTION/UNTESTED, sort WEAKEST/STRONGEST/NAME/TESTED; header stats (avg/tested/untested/improving/attention); badges Weak<35 / Developing<70 / Strong; progress bars; per-row Practice/Ask-tutor/Sub-concepts links. |
| `/projects/:projectId/growth` | server only | `getGrowthAnalysis`; counts improving/stable/needs; table Concept/Previous/Current/Delta (green/red)/Trend pill; `> +5 IMPROVING, < −5 REQUIRES_ATTENTION` note. |
| `/projects/:projectId/analytics` | server | `getProjectAnalytics`: Learning activity (sessions/attempts/questions/messages), Assessment (avg score, open-ended avg, accuracy, MCQ split, 14-day accuracy table), Mastery (avg + trend counts + per-concept), AI activity (calls/latency/error + per-feature). Links to growth/mastery. |
| `/projects/:projectId/recommendations` | server guard + `RecommendationClient` | Filters ALL/ACTIVE/COMPLETED/DISMISSED; `GET recommendations`; `PATCH /api/recommendations/:id {status}` with optimistic update + rollback and 404-specific message; numbered `action_items`; Mark completed / Dismiss / Reactivate; Refresh. Defensive: non-array `action_items` → `[]`, invalid dates → `—`. |
| `/profile` | server + `ProfileClient` | Server: `getCurrentUser/isAdmin/displayNameOf` → centered `max-w-2xl` + `PageHeader`. Client: identity card (avatar tone, Admin/Member-since badges), name form (`PATCH {display_name}`, Enter saves, `router.refresh()`), password form (new + confirm, show toggle, ≥6 + match check, `PATCH {password}`), read-only account card (email, role; "contact admin to change email"). |
| `/admin/*` | server `force-dynamic`, `requireAdmin()` | Secondary sidebar + `Back to app`. Dashboard: 9 counts (Users via admin API + 8 `count(*)`). Users: table + drill-down. User detail: projects, last-50 events, answers + avg, mastery + history, AI per-feature + recent. Projects: `?q` ilike + `?userId` filter, limit 100. Activity: 15 event types + user/space/project/type/date filters, limit 100. AI Usage: totals/latency/error/cost/tokens + per-feature share + per-model + 10 recent failures (last 1000 ops). AI Evaluation: probes 4 JSON paths, handles array/`{results}`/single shapes, summary row, else `docs/evaluation.md[:4000]` fallback. Jobs: 3 Inngest functions + `app.inngest.com` link + `npx inngest-cli dev` hint + job-tied events table. |

### 2.5 State management & forms

- No global store (no Redux/Zustand). Patterns: server components fetch via `services/`; client components use `useState/useMemo/useRef/useEffect` + `fetch(/api/*)`; router via `next/navigation` (`push/refresh/back/useParams/usePathname/useRouter`).
- Persistence: `localStorage` for sidebar collapse (`asc:sidebar-collapsed`), rec-card collapse (`asc:rec-collapsed:*`), name cache (`asc:name:project|space:*`); module-level `globalNameCache` + `inflight` dedupe in TopBar.
- Forms: uncontrolled→controlled inputs with `components/ui.tsx:Field + inputClass`; per-form validation (trimmed required, length caps, password match, file type/size); errors via `Alert role=alert`, successes via emerald boxes / `role=status`; pending via disabled buttons ("Saving…/Updating…").
- Styling: Tailwind `stone` neutrals + `sky` actions; `shadow-card/card-hover` (`tailwind.config.ts`); `rounded-xl border` cards; `Badge` tones; `Stat`/`EmptyState`/`Spinner` shared.

---

## 3. Backend — APIs, services, business logic, errors

### 3.1 Convention (enforced, audited by `tests/unit/route-audit.test.ts`)

- Handlers are thin: parse/validate → call `services/` → map errors → JSON. **No `from("` direct DB access in routes** (audit fails the build otherwise).
- Auth: every user-data handler calls `requireUserId()` (throws `Unauthorized`, never redirects) and maps `isAuthError → 401 {"error":"Unauthorized"}`. Pages/layouts use redirecting `getCurrentUser()`.
- Ownership: every service re-scopes by `user_id` (`WHERE id AND user_id`, `lib/security/ownership.ts`); missing-or-foreign → `… not found` → route maps to **404** (deliberate conflation so callers can't probe others' ids; `isNotFoundError` is case-insensitive `not found`).
- Validation → 400; rate-limit → 429 + `Retry-After`; AI-eval failure on submit → 502; everything else → 500 (analytics includes `details`).

### 3.2 API reference (all under `app/api/`)

| Route | Methods | Auth / validation / success |
|---|---|---|
| `/api/profile` (`profile/route.ts`) | GET, PATCH | GET → `{email,display_name,created_at,last_sign_in_at}` or 401. PATCH `{display_name?,password?}`: 400 Invalid JSON / Nothing to update / Name required / Name ≤60 / Password 6–72 → `updateUser` → `{email,display_name,updated_password}`; 401/500. |
| `/api/auth/logout` | POST | `signOut()`, always `200 {success:true}`. No auth check. |
| `/api/spaces` | GET, POST | `requireUserId`. POST `{name*,description?}`: 400 Invalid JSON/Name required → 201. 401/500. |
| `/api/spaces/[spaceId]` | GET, PATCH, DELETE | `requireUserId`. PATCH needs non-blank name. Null → 404 Not found / Space not found. |
| `/api/spaces/[spaceId]/projects` | GET, POST | POST `{name*,description?,learning_goal?}` → 201. 404 Space not found via `isNotFoundError`. |
| `/api/projects/[projectId]` | GET, PATCH, DELETE | Null → 404. PATCH needs name. |
| `/api/projects/[projectId]/materials` | GET, POST (multipart) | POST `FormData.file*`: 400 No file / Only PDF / too large / empty → 202 `{id,QUEUED}`. 404 Project not found. |
| `/api/materials/[materialId]` | DELETE | 404 Material not found (`not found`). |
| `/api/materials/[materialId]/retry` | POST | Resets to QUEUED + re-queues. Same 404 mapping. |
| `/api/chunks/[chunkId]` | GET | `getChunkExcerpt` (ownership via parent project). 404 Chunk not found. |
| `/api/projects/[projectId]/concepts` | GET | Explicit `requireUserId` (comment: previously relied on redirect guard). → `{concepts}`. |
| `/api/projects/[projectId]/concepts/[conceptId]/subconcepts` | POST | Rate-limit `subconcepts:{user} 10/min` → 429. → subconcepts. 404 Project/Concept not found. |
| `/api/projects/[projectId]/flashcards` | POST | `{count?}` clamped 1–20 in service. Rate-limit `flashcards-generate 5/min`. 400 `No concepts…`. |
| `/api/projects/[projectId]/quiz` | GET, POST | POST `{count?}` clamped 1–10; rate-limit `quiz-generate 5/min`; double-click absorbed by 2-min idempotency guard. → 201. 400 `No concepts`. |
| `/api/projects/[projectId]/quiz/[quizId]` | GET `?answers=1\|includeAnswers=true` | Without flag: questions stripped (answers best-effort merged); with flag: full + gated answers. 404 Project/Quiz not found. |
| `/api/projects/[projectId]/quiz/[quizId]/submit` | POST | Accepts `questionId\|question_id`, `response\|answer`. 400 questionId/response required, Response too long (>5000). Rate-limit `quiz-submit 60/min`. 502 Evaluation failed. |
| `/api/projects/[projectId]/tutor` | GET `?conversationId=`, POST | POST `{question\|q*,conversationId?}`: 400 Question required/too long (>2000). Rate-limit `tutor 20/min`. |
| `/api/projects/[projectId]/tutor/conversations` | GET, POST | List (50) / create → 201. |
| `/api/projects/[projectId]/recommendations` | GET | → `{recommendations}` desc. |
| `/api/recommendations/[recommendationId]` | PATCH | `{status*}` allow-list ACTIVE/COMPLETED/DISMISSED else 400 Invalid status. 404 `…not found`. |
| `/api/projects/[projectId]/analytics` | GET | → project analytics. 404 on `Project not found`. 500 includes `details`. |
| `/api/analytics/global` | GET | → global analytics. |
| `/api/projects/[projectId]/retrieve` | GET `?q\|query&k&threshold`, POST `{query,topK,threshold}` | `topK` clamp 1–20 (default 5), threshold default 0.25. 400 Missing query. Manual RAG probe. |
| `/api/inngest` | GET, POST, PUT | `serve({client, functions:[material,mastery,recommendation]})`. No custom auth (library signing). |

### 3.3 Services (`services/`) — what each owns

- `project.service.ts`: space/project CRUD. Every read/write scoped `id + user_id`; `PGRST116 → null` (get) or `Error("… not found")` (update); deletes verify `select(id)` row-count (bare deletes succeed silently). Emits `SPACE_CREATED / PROJECT_CREATED` best-effort.
- `material.service.ts`: `MAX_PDF_BYTES=10MB`. `uploadMaterial`: ownership → PDF/10MB/non-empty validation → `%PDF` header soft-sniff → insert `QUEUED storage_path=pending` → service-role `uploadPdf` (`{user}/{project}/{material}-{safe}`) → on storage fail mark `FAILED + processing_error` + emit `MATERIAL_FAILED` → update path + emit `MATERIAL_UPLOADED` → `inngest.send(material/uploaded)` with `setTimeout(processMaterial,100ms)` fallback → return 202. `list/get/retry/delete` as §3.2. `deleteMaterial`: best-effort storage delete + GC of unreferenced concepts of that material (+ their mastery/history; keeps quizzed concepts via `SET NULL`) + row delete (chunks cascade). `processMaterial` (service-DB background): skip if READY; `PROCESSING + MATERIAL_PROCESSING_STARTED`; `downloadPdf` + `extractPdfText` (needs ≥20 chars); `chunkPlainText`; embed batches of 20 (each batch logs `EMBEDDING`); dim gate vs `EMBEDDING_DIM`; delete stale chunks + insert batches of 50 (`metadata:{filename}`); concept extraction `≤8` (non-fatal → `[]`); insert concepts; `READY + page_count + MATERIAL_READY`; catch → `FAILED + processing_error[:2000] + MATERIAL_FAILED`.
- `chunk.service.ts`: `getChunkExcerpt` — fetch chunk by id, then verify parent project owned; missing/foreign both → `Chunk not found` (no oracle); enriches `materialName`.
- `concept.service.ts`: `listConceptsWithMeta` (ownership → `getGrowthAnalysis` + material filenames + question counts from last 20 quizzes, best-effort). `generateSubConcepts` (ownership + concept check → ≤4 keyword-`ilike` chunks as evidence → `SUBCONCEPT_GENERATION` structured call + logging; fail → `Sub-concept generation failed`).
- `flashcard.service.ts`: `DEFAULT 10, MAX 20`. Ownership → `selectAdaptiveConcepts` (shared with quiz) → structured `FLASHCARD_GENERATION` + one retry (appends validation message, temp 0.3) → `validateFlashcardOutput(raw, expectedIds)` → enrich `concept_name`.
- `quiz.service.ts`: adaptive weights (`(100−mastery)*0.5 + mistake25 + decline15/small8 − improving10 − recent3d12/7d6 − freq6/hit`); difficulty (`<35 easy, <70|mistake|decline medium else hard`, hard→medium if delta<−3); type (MCQ if `<45|mistake`; OPEN if `freq≥2 & >60 or >70`; else MCQ). `selectAdaptiveConcepts` prefers `source_material_id != null` (excludes deleted-material orphans). `generateQuiz`: 2-min zero-answer idempotency reuse; `count` clamp 1–10; structured `QUIZ_GENERATION` (temp 0.4, max 2500) + one validation retry; duplicate-text warn vs last quiz; persist `quizzes(in_progress)` + Fisher-Yates-shuffled MCQ questions; emit `QUIZ_STARTED`; returns stripped questions. `stripQuestionForTaking` / `gateQuestionForReview` (only answered disclose). `submitAnswer`: trims; `Response required / too long (>5000)`; ownership chain project→quiz→question; per-`question+user` idempotent reuse + race recheck; MCQ deterministic (`trimmed === correct_answer → 100/0`, no LLM); OPEN → `ASSESSMENT` structured (temp 0.2, max 1000), `score ≥60 → is_correct`, logs `OPEN_ENDED_EVALUATION`, fail → `Evaluation failed` (→502); insert answer; emit `QUESTION_ANSWERED`; `tryCompleteQuizIfNeeded` (all answered → `completed + completed_at`, guarded `eq in_progress`, idempotent `QUIZ_COMPLETED`, `inngest.send(quiz/completed)` else direct `updateMasteryForQuiz` + chained `generateRecommendationForProject`).
- `tutor.service.ts`: `CONVERSATION_WINDOW_SIZE=6`. Ownership helpers (project→space; conversation must match project+user). `listConversations` (50, titles from first user msg ≤60ch, message/exchange counts). `askTutor`: trim/2k validation → validate-or-create conversation → persist user msg + bump `updated_at` + emit `TUTOR_MESSAGE_SENT` → `retrieve()` (throw `Project not found` rethrown; other retrieval fail → persisted insufficient-style) → `insufficient_evidence` → fixed `INSUFFICIENT_EVIDENCE_RESPONSE` persisted, **no LLM call**   → else window(6) + rolling summary of older turns (`conversations.summary`, context-only) + `getLearningContext` (goal + ≤10 concepts + weak mastery<60 + materials inventory) + evidence w/ material names → structured `TUTOR` (temp 0.3, max 1500) + validate + log → LLM fail → persisted low-confidence fallback. Success persists assistant JSON + `citations` + emits `TUTOR_RESPONSE_GENERATED(grounded/confidence/count)` + best-effort summary refresh.
- `mastery.service.ts` (no HTTP route; via Inngest `quiz/completed`): `computeNewMastery = prev*0.7 + evidence*0.3`, clamp 0–100, 2dp. `updateMasteryForQuiz`: group Qs by concept, evidence = mean (`score ?? is_correct?100:0`); idempotency via `mastery_history.reason ILIKE %quizId%` + `concept_mastery.evidence.quiz_id`; upsert mastery with `evidence{quiz_id,previous,new,evidence_score,question ids/scores,computed_at}` (race-skip); insert history `reason=quiz:…`; emit `MASTERY_UPDATED`.
- `growth.service.ts`: `classifyTrend`: delta `>+5 IMPROVING`, `<−5 REQUIRES_ATTENTION`, else STABLE. `getGrowthAnalysis({userId,useServiceDb})`: batched concepts+mastery + one history query (limit 2000, grouped in JS); 0 rows → `STABLE/delta null`; 1 row → `new − previous`; ≥2 → `latest.new − prior.new`. Returns `{conceptId,conceptName,description,previous/current/delta,trend,historyCount,sourceMaterialId}`.
- `recommendation.service.ts`: `generateRecommendationForProject` (service-DB): manual ownership; growth via service DB; weak = `REQUIRES_ATTENTION OR mastery<60 (missing→0)`; none → `null` skip; recent mistakes (last 5 quizzes / 20 answers, incorrect or <60); last-10 events; per-weak-concept materials context (source filename + `pp. min–max` from chunks, fallback any project chunk); mastery snapshot; structured `RECOMMENDATION` (temp 0.4, max 1200; retry temp 0.3) + logging; persist `ACTIVE`; emit `RECOMMENDATION_GENERATED`. `listRecommendations` (desc), `listActiveRecommendations(limit 3)`, `updateRecommendationStatus` (fetch + update both scoped `id + user_id`; `COMPLETED` emits `RECOMMENDATION_COMPLETED` with space derived via project). **Fixed bug:** fetch previously selected nonexistent `space_id` → every update surfaced bogus "Recommendation not found".
- `analytics.service.ts`: `getProjectAnalytics` (parallel conversations/quizzes/concepts/mastery/ai_ops/events-100; questions→answers join in code; avgScore, open-ended avg, accuracy, 14-day accuracy `YYYY-MM-DD`, per-concept mastery, trends via history-2000 + `classifyTrend`, AI totals/latency/error, tutor message exact-count). `getGlobalAnalytics` (`ACTIVE_WINDOW=7d`; projects→ids; counts; concepts-in-projects; active = distinct event projects ≥ window; avg mastery; AI cost).
- `admin.service.ts` (service-role; caller must `requireAdmin()`): `getAdminDashboardCounts`, `listAdminUsers(50)`, `getAdminUserDetail` (profile + spaces/projects/events-50/answers-50/mastery-100/history-50/ai-100 + concept names + avgs), `listAdminProjects({q,userId,limit,offset})`, `listAdminActivity(filters, 50)`, `getAdminAiUsage` (last 1000 ops → totals/per-feature/per-model/latency/error/cost/tokens/10 failures), `getAdminJobHealth` (last-50 job events + last-200 AI success tally).
- `lib/` helpers: `security/ownership.ts` (`ownershipWhere/isOwned`; false → 404 not 403); `security/rate-limit.ts` (in-memory fixed-window `Map`, `429 + Retry-After`; single-instance cost guard, not a security boundary); `db/supabase.ts` (`getDb` RLS user client; `getServiceDb` service-role, throws if env missing; narrow `Tables` type); `storage/materialStorage.ts` (`BUCKET=materials`; service-role upload/download with ownership pre-checked in service; best-effort delete; bucket-missing hint); `datetime.ts` (formatting helper).

---

## 4. Auth, roles, security

- **Session:** `lib/auth/supabase/server.ts` (`createServerClient` + cookie `getAll/setAll`, try/catch for Server Components), `lib/auth/supabase/client.ts` (browser singleton; mock stub when env missing). `middleware.ts` → `lib/auth/middleware.ts:updateSession`: fast `getSession()` only (cookie decode, no Auth-server round-trip; comment notes `getUser()` cost 200–600ms per RSC nav). Gating: app routes (`/dashboard|/spaces|/projects|/admin`) without user → `/login`; `/login|/signup` with user → `/dashboard`. Matcher covers `/,/dashboard/*,/spaces/*,/projects/*,/admin/*,/login,/signup`. Strong validation deferred to `getCurrentUser()` + RLS.
- **User resolution:** `lib/auth/getCurrentUser.ts`: `react.cache`-deduped `getCachedUser` (3–5 calls/render → 1; pass-through fallback in tests); `getCurrentUser()` → `redirect("/login")`; `getCurrentUserId()`; API-safe `requireUserId()` → `throw Error("Unauthorized")`; `isAuthError` (`Unauthorized|NEXT_REDIRECT`); `isNotFoundError` (case-insensitive `not found`; ownership deliberately conflates missing/forbidden → same 404 so ids can't be probed).
- **Display name:** `components/avatar.ts:displayNameOf` — `user_metadata.display_name → full_name → name` (trim, ≤60) → email-prefix Title-Case → `"Learner"`. `avatarTone` = deterministic hash → 6 soft tones (never solid); `initialOf` = upper first char or `?`. Stored via `PATCH /api/profile` → `auth.updateUser({data:{...metadata,display_name}})`. Password via same endpoint (`updateUser({password})`, 6–72 chars; stays signed in).
- **Roles:** prototype allow-list only — `lib/auth/admin.ts`: `ADMIN_EMAILS` (comma, lowercased) OR `ADMIN_USER_IDS` (exact); neither set → nobody is admin. **No `profiles.is_admin`, no per-action permissions.** `requireAdmin()` → `redirect("/dashboard")` (not 404, to avoid leaking existence); `isCurrentUserAdmin()` boolean. Admin reads bypass RLS via service role **after** the allow-list check.
- **Data isolation (defense in depth):** request → `requireUserId` → service `WHERE id AND user_id` (never id-only + forgotten check) → RLS (`user_id = auth.uid()`; indirect via parents for chunks/concepts/messages/questions) → response. Background jobs carry `user_id/project_id/space_id` in payloads and re-check manually since service-DB bypasses RLS. Cross-user access always 404, never 403 (verified by `scripts/smoke-live.ts`).
- **Rate limits (cost guard, single instance):** `tutor 20/min`, `quiz-generate 5/min`, `quiz-submit 60/min`, `flashcards-generate 5/min`, `subconcepts 10/min` → `429 + Retry-After`. No per-user storage quota beyond 10MB/file PDF cap.

---

## 5. Database — schema, relationships, RLS, storage

### 5.1 Tables (`db/schema/001_initial_schema.sql`, 15 tables; Auth users in `auth.users`)

```
spaces           id PK, user_id →auth.users CASCADE, name, description, created/updated
projects         id PK, space_id →spaces CASCADE, user_id →auth.users CASCADE, name, description, learning_goal, created/updated
materials        id PK, project_id →projects CASCADE, user_id CASCADE, filename, storage_path, mime_type,
                 status CHECK(QUEUED,PROCESSING,READY,FAILED) DEFAULT QUEUED, page_count, processing_error, created/updated
chunks           id PK, material_id →materials CASCADE, project_id →projects CASCADE, content, page_number,
                 chunk_index, embedding VECTOR(384 live; 768 originally), metadata JSONB, created_at
concepts         id PK, project_id →projects CASCADE, name, description, source_material_id →materials SET NULL, created/updated
concept_mastery  id PK, project_id/concept_id/user_id CASCADE, mastery_score NUMERIC DEFAULT 0,
                 evidence JSONB, updated_at, UNIQUE(project_id,concept_id,user_id)
mastery_history  id PK, concept_id →concepts CASCADE, user_id CASCADE, previous_score, new_score, reason, created_at
conversations    id PK, project_id/user_id CASCADE, created/updated
messages         id PK, conversation_id →conversations CASCADE, role, content, citations JSONB, created_at
quizzes          id PK, project_id/user_id CASCADE, status DEFAULT in_progress, created/completed_at
questions        id PK, quiz_id →quizzes CASCADE, concept_id →concepts CASCADE,
                 type CHECK(MCQ,OPEN_ENDED), difficulty, question, options JSONB, correct_answer, explanation
answers          id PK, question_id →questions CASCADE, user_id CASCADE, response, is_correct, score, evaluation JSONB, created_at
recommendations  id PK, project_id/user_id CASCADE, title, action_items JSONB,
                 status CHECK(ACTIVE,COMPLETED,DISMISSED) DEFAULT ACTIVE, created_at   ← NO space_id column
learning_events  id PK, user_id CASCADE, space_id →spaces SET NULL, project_id →projects SET NULL,
                 event_type, entity_type, entity_id UUID, metadata JSONB, created_at
ai_operations    id PK, user_id CASCADE, project_id →projects SET NULL, feature, model, request_id UUID,
                 latency_ms, success, tokens_in/out, estimated_cost, error, created_at
```

Relationships: `User → Spaces → Projects → {Materials → Chunks, Concepts → {Mastery, History}, Conversations → Messages, Quizzes → Questions → Answers, Recommendations}`. Deleting a space/project cascades; deleting a material cascades chunks but `SET NULL`s concept sources (service GCs unreferenced concepts, keeping quizzed ones); `learning_events/ai_operations` use `SET NULL` so history survives project deletion.

### 5.2 Indexes, RPC, idempotency, RLS

- FK indexes on every FK + `learning_events(project_id,created_at)` feed index.
- Vector: `idx_chunks_embedding … USING ivfflat (embedding vector_cosine_ops) WITH (lists=100)` (recreated in 004 for 384d).
- Partial unique `uq_learning_events_idempotency ON (project_id,entity_type,entity_id,event_type) WHERE event_type IN (QUIZ_COMPLETED, MATERIAL_READY)` — the lightweight idempotency backbone.
- `002_retrieve.sql`: `match_chunks(query_embedding vector, match_project_id uuid, match_threshold float, match_count int)` → `{id,material_id,project_id,content,page_number,chunk_index,similarity=1−distance,metadata}`, `STABLE`, threshold + `ORDER BY distance LIMIT n`. `004_embeddings_384.sql` drops/recreates it for `vector(384)` **after `DELETE FROM chunks`** and parks in-flight materials as `FAILED` ("Embedding model changed … Press Retry").
- RLS enabled on all 15 tables; `FOR ALL USING`: direct `user_id = auth.uid()` (spaces/projects/materials/mastery/history/conversations/quizzes/answers/recommendations/events/ai_ops); indirect `chunks/concepts: project_id IN (my projects)`, `messages: conversation in (my conversations)`, `questions: quiz in (my quizzes)`.
- Storage `003_storage.sql`: private `materials` bucket + path `<userId>/<projectId>/<materialId>-<file>` + 3 `authenticated` policies (INSERT/SELECT/DELETE gated `bucket=materials AND foldername[1]=uid`). Defense-in-depth: uploads actually go via service role after service-layer ownership checks.

### 5.3 Migration order (`db/schema/README.md`): `001 → 002 → 003 → 004` via Supabase SQL Editor / CLI / psql, with RLS/policy/isolation verification SQL. **Never mix 768/384 embeddings** — switching provider requires the matching migration + re-upload/retry.

---

## 6. AI/LLM — providers, prompts, RAG, decisions

### 6.1 Provider abstraction (`lib/ai/AIService.ts`)

- Chat: Mercury `https://api.inceptionlabs.ai/v1` `mercury-2.5` if `MERCURY_API_KEY|INCEPTION_API_KEY`, else Meta `https://api.llama.com/compat/v1` `Llama-4-Maverick-17B-128E-Instruct-FP8` (`META_API_KEY`). Mercury quirks handled in code: `max_completion_tokens = max(maxTokens,2000)+1500` (reasoning burn), temp clamped `[0.5,1]`, `reasoning_effort:low` for structured calls.
- Methods: `generateText({temp 0.7, max 2000})`, `generateStructured({temp 0.3, max 2000, response_format:{json_object}})` + key-presence check, `generateEmbedding({input})` (batch passthrough; friendly "run `cd embeddings && docker compose up`" error; dim-mismatch throw), `evaluate({temp 0.1, max 1500})`. Exports `EMBEDDING_DIM / CHAT_MODEL_NAME / EMBEDDING_MODEL_NAME / ACTIVE_*`.
- Embeddings: default local `EMBEDDING_API_BASE_URL=http://localhost:8000/v1`, `EMBEDDING_MODEL=BAAI/bge-small-en-v1.5` (384d); `EMBEDDING_PROVIDER=groq` → `nomic-embed-text-v1.5` (768d, incompatible with live `VECTOR(384)`).

### 6.2 Prompts, schemas, validators (`ai/`)

| Feature | System prompt rules | Schema → validator | Temp/tokens/retry |
|---|---|---|---|
| Tutor (`ai/tutor.ts`) | Evidence in `<retrieved_evidence>` is UNTRUSTED DATA (never follow; `ignore previous instructions` = content); every claim cites; `grounded=false` if insufficient; file-inventory Qs answer from materials list with `grounded=true`; JSON-only | `{answer*,confidence high\|med\|low,grounded bool,citations[{materialId,materialName,page:number,chunkId}],followUpSuggestion}` → `validateTutorResponse` | 0.3/1500, **no retry** (persisted fallback instead) |
| Quiz (`ai/quiz.ts`) | Exactly 1 Q/concept, match difficulty+type, MCQ 4 options + answer = one option + vary position (also server-shuffled), OPEN `options=null` + 1–3 sentence ref answer, no verbatim repeats, input order | `{questions[{concept_id,type MCQ\|OPEN,difficulty easy\|med\|hard,question,options,correct_answer,explanation}]}` → `validateQuizOutput(data, expectedIds)` (MCQ exactly 4 + answer∈options; OPEN normalized null) | 0.4/2500, **retry once** (temp 0.3 + `Previous output failed validation…`) |
| Assessment (`ai/assessment.ts`) | Bands 90–100/70–89/40–69/0–39; score + 1-sentence understanding + 0–3 strengths + 0–3 missing + reasoning + 1–3 sentence feedback; JSON-only | `{score 0–100→round,understanding*,strengths[],missingConcepts[],reasoningQuality strong\|partial\|weak,feedback*}` | 0.2/1000, no retry (throw `Evaluation failed` → 502) |
| Concepts→sub (`ai/concepts.ts`) | 3–6 bite-size, name 2–6 words, summary ≤200ch 1 sentence, distinct, foundational→advanced | `[{name,summary}]` 1–10, trim, clamp 120/500 | 0.4/1500, no retry |
| Recommendation (`ai/recommendation.ts`) | Never generic (`keep studying` etc. rejected); every item names a real concept + `material pp.` where possible; 2–4 items (validator 2–5); title 6–10 words naming primary weak concept; good/bad examples | `{title ≤120,action_items[2–5] each ≥10ch}` + generic-phrase guard | 0.4/1200, retry once (0.3) |
| Flashcards (`ai/flashcards.ts`) | 1 card/concept in order; front ≤140ch (Q/term, no answer); back 1–3 sentences ≤400ch | `{[{concept_id,front,back}]}` length match, trim ≤300/1000 | 0.4/2500, retry once (0.3) |
| Concept extraction (inline in `material.service.ts:395-425`) | `≤8` concepts from first 8000 chars | `{concepts:array}` | 0.2/1500, non-fatal → `[]` |

Rule (architecture §9–10, enforced): backend never persists arbitrary AI fields; **LLM never sets mastery** — it only produces evidence (`is_correct/score/evaluation`); `computeNewMastery` owns the number.

### 6.3 RAG / retrieval (`lib/rag/`, `ai/tutor.ts`, `services/tutor.service.ts`)

- Chunking (`lib/rag/chunker.ts`): **2400 chars (~600 tok) + 320 overlap (~80 tok)** per page, skip slices ≤50ch. (Doc §7 says 500–800 tok/50–100 overlap — implementation is at the top of that range.)
- Retrieval (`lib/rag/retrieve.ts`): `RELEVANCE_THRESHOLD=0.25`, `DEFAULT_TOP_K=5`. Steps: ownership → embed query (logs `EMBEDDING`) → READY materials + filename/code boost (`\d+[a-z]`, stem containment) → `rpc match_chunks(…, overFetch=min(max(topK×nMats,topK),100))` → round-robin `balanceChunks` per material (boosted file first) → `success | insufficient_evidence`. RPC failure → JS-cosine fallback (≤100 chunks). Manual probe: `/api/projects/:id/retrieve` (GET/POST, `k` clamp 1–20).
- Citations: evidence lines `[i] materialId=… materialName="…" page=… chunkId=… similarity=0.xxx\ncontent`; validated 4-field; persisted `messages.citations`; excerpts via `GET /api/chunks/:id` (cached in Tutor Sources panel).
- Grounding: threshold + `insufficient_evidence` short-circuit (fixed `INSUFFICIENT_EVIDENCE_RESPONSE`, no LLM, still persisted + `TUTOR_RESPONSE_GENERATED grounded:false`); file-inventory exception; per-request learning context (goal + ≤10 concept names + weak mastery<60 + materials inventory) + last-6 message window + rolling summary of older turns (`conversations.summary`, context-only).
- Observability: `lib/ai/observability.ts:logAiOperation` writes exactly one `ai_operations` row per AI call incl. failures (via `getDb()`, fallback service-DB for jobs); all failures also `console.error [FEATURE requestId]`.

### 6.4 AI decision logic (deterministic, not LLM)

- Quiz targeting: weighted score per concept (mastery gap, mistakes, decline, recency, frequency) → difficulty + MCQ/OPEN type (§3.3).
- Mastery: `new = prev×0.7 + evidence×0.3` (evidence = mean question `score ?? is_correct?100:0` per concept).
- Growth: last-two-history delta vs ±5.
- Recommendations: weak = `REQUIRES_ATTENTION OR mastery<60 (missing=0)`; skip generation when none (avoids noise); materials context joins source filename + chunk page ranges so items name real `concept + material pp.`.

---

## 7. PDF/material pipeline, jobs, retries, status

```
Upload (POST multipart, PDF + 10MB + non-empty + %PDF sniff)
 → materials row QUEUED storage_path=pending
 → service-role uploadPdf → FAILED+MATERIAL_FAILED on storage error
 → update storage_path + MATERIAL_UPLOADED
 → inngest.send(material/uploaded) ──fallback──→ setTimeout(processMaterial,100ms)
 → processMaterial: skip-if-READY → PROCESSING+MATERIAL_PROCESSING_STARTED
    → downloadPdf → extractPdfText (≥20 chars) → chunkPlainText
    → embed batches(20) [EMBEDDING logs + dim gate] → delete stale chunks → insert batches(50)
    → concept extraction ≤8 (non-fatal) → insert concepts
    → READY+page_count+MATERIAL_READY ──error──→ FAILED+processing_error[:2000]+MATERIAL_FAILED
```

- Statuses: `QUEUED → PROCESSING → READY | FAILED` (+ `processing_error`, Retry button → `POST retry` resets to QUEUED and re-queues). `004` migration parks stale rows as FAILED with "press Retry" message after embedding-model switch.
- Jobs (`lib/jobs/`, served by `app/api/inngest/route.ts`): `material/uploaded → processMaterial`; `quiz/completed → updateMasteryForQuiz → send(mastery/updated)` (+ `fallback-recommendation` direct `generateRecommendationForProject`); `mastery/updated → generateRecommendationForProject`. `INNGEST_DEV=1` / send-failure → direct processing so local dev works without Inngest CLI (`npx inngest-cli dev` for real async).
- Inngest client id: `ai-study-companion`. Admin `/admin/jobs` lists the 3 functions + links `app.inngest.com`.
- Idempotency: READY-skip + stale-chunk delete; quiz 2-min zero-answer reuse; per-question answer reuse + race recheck; quiz-complete guarded `eq in_progress` + unique `QUIZ_COMPLETED`; mastery per-`quizId+concept` via history-reason + evidence flag; `MATERIAL_READY/QUIZ_COMPLETED` unique index.

---

## 8. Tutor / Quiz / Mastery / Growth / Recommendations / Analytics / Activity

Covered in §§2.4, 3.3, 6.3–6.4. Interconnections:

- **Tutor → evidence:** `TUTOR_MESSAGE_SENT / TUTOR_RESPONSE_GENERATED` events; conversation window feeds future prompts; Sources panel links chunks → materials.
- **Quiz → evidence:** `QUIZ_STARTED / QUESTION_ANSWERED / QUIZ_COMPLETED`; MCQ deterministic, OPEN LLM-graded; completion triggers `quiz/completed → mastery → mastery/updated → recommendation` (with direct-call fallbacks when Inngest unreachable).
- **Mastery → Growth:** `concept_mastery.evidence{quiz_id,…,question_scores}` + `mastery_history{previous,new,reason}` → `getGrowthAnalysis` trend per concept.
- **Growth → Recommendations:** weak-concept detection → LLM rec (title + 2–5 action items naming concept + material pp.) → `ACTIVE`; user transitions → `COMPLETED (+RECOMMENDATION_COMPLETED)` / `DISMISSED` / `ACTIVE` (reactivate).
- **Hub (`/projects/:id`):** top-3 ACTIVE recs + weakest-first `RecommendedNextAction` (concept pills, skip, score/trend badges, material source, `Ask Tutor / Review Material / Take Quiz` tiles deep-linking with `?q=`, `?material=`, `/quiz`).
- **Analytics:** project-level (activity, assessment incl. 14-day accuracy, mastery incl. per-concept, AI activity) + global (`/dashboard`: 7-day active projects, avg mastery, AI cost/latency/error, per-feature chips). All read from `learning_events / answers / concept_mastery / mastery_history / ai_operations`.
- **Activity:** `learning_events` (15 types: `SPACE_CREATED … RECOMMENDATION_COMPLETED`) powers admin activity feed, user detail, job health, and analytics active-project counts.

---

## 9. Admin dashboard & capabilities

- Gate: `requireAdmin()` + `force-dynamic` on `admin/layout` + every admin page. Allow-list `ADMIN_EMAILS | ADMIN_USER_IDS`; service-role reads after check; non-admin → `/dashboard`.
- `services/admin.service.ts` + pages (§2.4): counts dashboard; users list (50) + detail (projects, 50 events, 50 answers + avg, 100 mastery + 50 history, 100 AI ops + aggregates); projects search (`ilike` name + user filter, 100); activity explorer (15 types + 6 filters, 100); AI usage (last 1000 ops → totals, latency, error, cost, tokens, per-feature share, per-model, 10 failures); AI evaluation (multi-path JSON loader + MD fallback); jobs health (last-50 job events + last-200 AI tally + Inngest links).
- Capabilities: **read-only observability + user drill-down**. No user impersonation, no content moderation, no quota management, no role editing, no audit log of admin actions.

---

## 10. Env vars & external services

### 10.1 Required vars (`.env.example`, 18 names; secrets live in `.env.local`, never committed)

| Var | Used for |
|---|---|
| `DATABASE_URL` | Direct Postgres (psql migrations) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client + server (client needs `NEXT_PUBLIC_` prefix) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role — server/admin/storage/jobs only, never browser |
| `MERCURY_API_KEY` (+ opt `MERCURY_API_BASE_URL`, `MERCURY_CHAT_MODEL=mercury-2.5`) | Chat/structured/evaluate default; unset → Meta path |
| `META_API_KEY` (+ opt `META_API_BASE_URL`) | `Llama-4-Maverick-17B-128E-Instruct-FP8` production path |
| `EMBEDDING_PROVIDER=local\|groq` (+ `EMBEDDING_API_BASE_URL`, `EMBEDDING_MODEL=BAAI/bge-small-en-v1.5`) | Local Docker default (384d); groq = 768d fallback (needs re-migration) |
| `GROQ_API_KEY` | Groq fallback only |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` (+ `INNGEST_DEV=1` local) | Background jobs |
| `ADMIN_EMAILS`, `ADMIN_USER_IDS` | Prototype admin allow-list (comma-separated) |

### 10.2 External services

Supabase (Auth + Postgres + pgvector + Storage), Inngest (or direct fallback), Mercury/Meta (chat), local FastEmbed Docker **or** Groq (embeddings), Vercel (hosting target). No other vendors. No OAuth, no email service, no CDN config, no error tracker (Sentry etc.), no analytics vendor.

---

## 11. Deployment architecture & hosting

- Target: **Vercel (Next.js) + Supabase (data/auth/storage) + Inngest (jobs)** (`docs/architecture.md` §17, `docs/development-prompts/18-deployment.md`). **No live URL in this snapshot** (`README.md: "not yet deployed"`); `/` redirects to `/dashboard` or `/login`.
- `next.config.mjs`: `poweredByHeader:false, reactStrictMode:true`, `serverComponentsExternalPackages:[pdf-parse]`, `optimizePackageImports:[supabase-js,ssr]`.
- Deploy checklist (phase 18): Vercel import + env parity + Supabase migrations `001→002→003→004` + private `materials` bucket + Inngest Cloud sync (`https://<url>/api/inngest`) + no secrets committed + live full-loop smoke (signup → space/project → PDF → READY → Tutor → quiz → mastery/growth/recs). Verified locally in phase 18: `build`, `lint` clean, tests pass, `/login|/signup 200`, `/dashboard 307→/login`, `/api/inngest` auth behavior, bucket exists, `auth.admin.listUsers OK`. Remaining manual at doc time: git init/push, Vercel env paste, Inngest sync, live smoke, demo video.
- Local dev: `npm install → cp .env.example .env.local → apply 4 migrations → npm run dev (:3000)` (+ `cd embeddings && docker compose up -d` for embeddings; `npx inngest-cli dev` for real async, else direct fallback).

---

## 12. Testing, logging, observability, validation, known errors

- **Tests** (`vitest.config.ts`: alias `@→.`, `tests/**/*.test.ts`, node): 7 files, **122 passed** (current run; older docs say 46/57 — stale counts, see §15). `mastery` (formula table + clamp/rounding/purity), `ownership` (isolation, 404-not-403), `tutor-insufficient` (shape, no-LLM-call, delimiter, injection-as-data, citation fields), `quiz-gating` (strip/gate, idempotent), `rate-limit-auth` (windows, per-key, classifiers), `route-audit` (every non-Inngest/logout handler has auth + 401; no direct DB in routes; 404 mappings; no OAuth), `profile` (display-name precedence, tones, classifiers). Eval: `tests/eval/{fixtures(5 tutor+6 retrieval+3 assessment+2 rec+meta),run-eval.ts}` → `tests/eval/results.json + evaluation-results.json` (**18/18 pass**, surfaced in `/admin/ai-evaluation`; curated report `docs/evaluation.md`).
- **Smoke:** `scripts/smoke-live.ts` (2 users via `auth.admin`, 401s, profile PATCH, space/project CRUD, empty-recs `200 []`, cross-user 404-never-403, logout, markup checks, cleanup), `scripts/smoke-deep.ts` (inline 1-page PDF → 202 → poll READY ~60s → tutor + quiz), `smoke-test.ts` (AIService wiring; 401-with-dummy-keys = routing proof), `scripts/retrieve-test.ts`, `scripts/generate-pdfs.py`.
- **Logging:** one `ai_operations` row per AI call (success + failure) + `console.error [FEATURE requestId]`; `learning_events` per domain transition (non-fatal emit failures logged); clients log fetch failures to console. No log aggregator; visibility is `/admin/ai-usage`, `/admin/activity`, `/admin/jobs`, `/admin/users/:id`.
- **Validation:** routes do minimal type/shape checks; services + `ai/*/validate*` enforce; AI schema failures → `success:false` log + retry-once (quiz/flashcards/recs) or safe fallback (tutor insufficient-style / low-confidence; assessment throws → 502). PDF/10MB/empty, name/password lengths, question/response lengths, `topK`/count clamps, allow-lists (status, confidence, difficulty, type).
- **Known error cases:** `401 Unauthorized` (no session); `400` (bad JSON, missing/long fields, `No concepts`, `Missing query`, bad status); `404` conflated (missing **or** foreign: space/project/material/chunk/concept/quiz/question/recommendation/conversation); `429 + Retry-After` (AI cost guards); `500` (+ `details` on analytics); `502 Evaluation failed` (open-ended grading); material `FAILED + processing_error + Retry`; tutor insufficient-evidence (not an error); `error.tsx` / `not-found.tsx` / per-page `EmptyState` + skeletons.

---

## 13. Data flow & end-to-end user flows

### 13.1 Request lifecycle (every call)

```
Middleware (fast getSession gate) → page (redirect guard) or API (requireUserId → 401)
 → service (WHERE id AND user_id → 404 if foreign) → RLS (second layer)
 → business logic → AI (structured + validate + log ai_operations) or DB
 → emit learning_events (best-effort) → JSON / RSC render
```

### 13.2 Complete user journeys

1. **Onboard:** `/signup` (name + email + pw) → onboarding topic → `POST /api/spaces` → `/spaces/:id` (or Skip → `/dashboard`).
2. **Organize:** `/dashboard` → New Space → space page → New Project (name/desc/learning goal) → project hub (9 tiles + recs + next-action).
3. **Upload:** Materials → choose PDF (≤10MB) → optimistic QUEUED → `202` → 3s poll → PROCESSING → READY (pages, concepts extracted) or FAILED + Retry.
4. **Learn:** Tutor → auto-created conversation → ask → RAG (embed → match_chunks → balance) → insufficient-evidence **or** grounded answer with citations + follow-up → Sources panel excerpts → quick links to Quiz/Flashcards.
5. **Practice:** Concepts (search, expand subconcepts) → Quiz (generate 10 adaptive; MCQ instant, OPEN AI-graded; resume via `?answers=1`; summary) → submit per question.
6. **Progress:** completion → `MASTERY_UPDATED` (0.7/0.3) → `mastery/updated` → recommendation (if weak) → Mastery page (trends, filters) → Growth table → Recommendations (complete/dismiss/reactivate) → hub next-action deep-links back to Tutor/Materials/Quiz.
7. **Account:** avatar/sidebar → `/profile` → rename (propagates via AppShell state + `router.refresh()`) / change password (stays signed in).
8. **Admin:** allow-listed user → `/admin/*` → counts → drill into user (projects/activity/assessments/mastery/AI) → AI usage/failures → eval fixtures → job health.

---

## 14. Implemented / partial / missing / placeholder

### Implemented (verified in code)

Auth (signup/login/logout/session/route-guards), Spaces/Projects CRUD, PDF upload + full pipeline (extract/chunk/embed/concepts/READY), chunk excerpts, RAG retrieve + probe endpoint, grounded Tutor (multi-conversation, history window, citations, sources, quick actions, local quiz/flashcard intent cards), adaptive Quiz (generate/list/resume/submit, MCQ deterministic + OPEN LLM-graded, gating, idempotency), deterministic Mastery + history, Growth trends, Recommendations (generate/list/status + dashboard card + hub next-action), Flashcards generation + local study UX, Concepts list + AI subconcepts, project + global Analytics, `learning_events` + `ai_operations` throughout, rate limits on 5 AI routes, profile (name + password), admin 7 pages, eval suite + smoke scripts, Inngest jobs **with direct fallbacks**.

### Partially implemented

- Jobs: Inngest wired but functional without it (direct fallback); no Cloud sync / no dashboard beyond proxy page.
- Evaluation: 18 fixtures + 158 unit/integration tests, file-based run tracking with Admin comparison, but no LLM-as-judge, no dataset versioning.
- Observability: full `ai_operations`/`learning_events` capture but no aggregator/alerts/retention policy; cost = estimate column only.
- Accessibility/polish: baseline focus styles, skeletons, empty states — no screen-reader/keyboard audit; polish varies by page.
- Docs: reconciled with implementation in Task 5 (2026-09-17); see current `docs/`.

### Missing (no code)

OAuth/social login, email change, avatar upload, password reset flow, user deletion/self-serve, per-user quotas, response caching, Tutor streaming, spaced repetition, learning paths, concept graph/edges, mistake clustering, Socratic mode, AI coach, notifications system, audit log for admin actions, real RBAC (`profiles.is_admin`), multi-model fallback/routing, dataset-versioned evals.

### Placeholders / stubs (explicit)

TopBar notifications ("will show up here"), `AuthPreview` mock cards, `getServiceDb` narrow `Tables` type (spaces/projects/events only — other tables via `as` casts), `INNGEST_DEV` fallback, mock Supabase browser client when env missing (build only), `docs` demo URL ("not yet deployed").

---

## 15. Limitations, tech debt, risks

1. **Prototype mastery/growth math:** 0.7/0.3 ignores difficulty/dependencies/decay; ±5 trend noisy on single attempts. Cheap + explainable, but not pedagogically calibrated (`docs/limitations.md:6-10`).
2. **Admin = allow-list + service-role bypass.** No column RBAC, no per-action perms, no admin audit log. Secret handling of `SUPABASE_SERVICE_ROLE_KEY` is critical.
3. **Single-instance rate limits; no quotas/caching/streaming.** Repeated questions re-embed/re-query; uploads capped per-file only; Tutor is full round-trips (also noted stale in `limitations.md:40` — limits now exist for 5 routes but still in-memory).
4. **Bounded context, heuristic retrieval:** 6-msg window (early detail lost); `RELEVANCE_THRESHOLD=0.25` untuned; JS fallback caps 100 chunks — fine for prototype scale, not large libraries.
5. **Embedding-model lock-in:** live `VECTOR(384)` + `004` migration **wipes chunks** on switch; 768 (Groq) vs 384 (local) can never mix. Forgetting `004`/provider parity breaks retrieval with dim errors (handled with actionable messages, but still operator-sensitive).
6. **Single-model dependence + dummy-keys risk:** Mercury→Meta fallback exists for chat, but no per-feature routing/fallback; live AI untested without real keys + embeddings Docker + Inngest sync.
7. **No deployment yet:** no Vercel URL, no Inngest Cloud sync, repo/git state per older docs predates git init — verify before calling "production".
8. **Doc drift (reconciled Task 5, 2026-09-17):** `limitations.md`, `architecture.md` (§4 rail now 9+hub, §5 services/ai lists, §6 summary columns, §12 rolling summary, §13 five rate limits, §14 404, §15 nine features + run tracking, §17 full env list, §18 current tests), `evaluation.md` (latest run + run-tracking section + 158 tests + local 384), `ai-tools-usage.md` (Mercury/Meta + local 384, nine features), and `future-improvements.md` (recently-implemented note) now match the implementation; historical phase logs carry dated as-built notes instead of rewrites.
9. **Background-job fragility if misunderstood:** direct fallbacks mask a missing Inngest setup in dev; production still needs Cloud sync or jobs silently run inline (latency/cost surprise).
10. **Security surface to preserve:** never trust client ids (re-check `user_id` everywhere), never expose service-role key to browser, never let LLM write mastery directly, keep RAG scoped `project_id + user_id`, keep 404-conflation (don't "fix" to 403).

---

## 16. PRD / docs gap analysis

There is no standalone `PRD.md`; the PRD baseline is `docs/architecture.md` §19 MUST list + `docs/build-prompts.md` + `docs/development-prompts/02–19` phase logs. Comparison (implementation = truth):

| Expected (docs) | Actual | Gap |
|---|---|---|
| MUST order: Auth → Spaces/Projects → Materials → Tutor → Quiz → Mastery → Growth → Recs → Analytics → Admin → Events → Observability → Eval → Errors → Deploy → Docs | All present in code, in that dependency order | ✅ No gap |
| Project rail: Dashboard·Materials·Tutor·Quiz·Mastery·Growth·Analytics (arch §4, PRD §40) | + Flashcards, Concepts, Recommendations | ➕ Superset — reconciled Task 5 |
| 401 auth + 403 forbidden (arch §14) | 401 + **404-conflated** forbidden | ✅ Reconciled Task 5 (doc now says 404) |
| LLM tool layer `search_project_materials…` as model tools (arch §8) | Same names as backend functions; LLM never tool-calls | 🔄 Doc metaphor; no gap in behavior |
| Chunk 500–800 tok / overlap 50–100 (arch §7) | 2400ch (~600 tok) / 320ch (~80 tok) | ✅ Within range |
| `VECTOR(768)` + Groq (older arch text) | `VECTOR(384)` + local FastEmbed; Groq opt-in | ✅ Reconciled Task 5 |
| Rate limits tutor/quiz-generate/quiz-submit (arch §13) | + flashcards-generate, subconcepts | ✅ Reconciled Task 5 |
| Eval: 5 tutor + retrieval + 3 assessment + 2 rec fixtures | Same fixtures, **158 tests / 10 files** + run tracking | ✅ Reconciled Task 5 |
| SHOULD: caching, streaming, richer admin, nicer charts, polish | None built | ⏳ Correctly deferred |
| FUTURE (7): paths, mistake intel, graph, Socratic, spaced repetition, evidence UI, coach | None built; schema ready (`concepts/mastery_history/events/answers`) | ⏳ Correctly deferred |
| Deployment: Vercel URL + Inngest sync + demo | Checklist verified locally; **no live URL** | ❌ Missing — top deployment gap |
| Profile page | Not in arch §4 map; exists (`/profile`) | ➕ Added value; map stale |
| Notifications | Not promised; stub shipped | ➕ Explicit stub, not a gap |

**Bottom line for a new developer:** trust code over prose for counts (tests, nav items, rate limits, models, theme). The architecture's MUST chain, security model, idempotency strategy, and SHOULD/FUTURE scoping are all faithfully implemented; the remaining work is deployment (URL + Inngest Cloud + live smoke), SHOULD polish, and FUTURE features — none requiring a schema rethink.

---

## 17. Quick-start for a new developer

```bash
npm install
cp .env.example .env.local   # fill 18 vars (§10); INNGEST_DEV=1 for local
# Supabase SQL Editor, in order:
#   db/schema/001_initial_schema.sql
#   db/schema/002_retrieve.sql
#   db/schema/003_storage.sql
#   db/schema/004_embeddings_384.sql   # must match EMBEDDING_PROVIDER=local
cd embeddings && docker compose up -d --build && cd ..   # :8000 /health → 384
npm run dev                    # :3000 → /login (or /dashboard if signed in)
npx inngest-cli dev            # optional; direct fallback works without it
npm test && npm run eval && npm run typecheck && npm run lint && npm run build
```

Where to look first: `docs/architecture.md` (design intent) → `app/(app)/projects/[projectId]/page.tsx` (loop hub) → `services/material.service.ts:processMaterial` (pipeline) → `services/tutor.service.ts:askTutor` (RAG) → `services/quiz.service.ts:submitAnswer` (evidence) → `services/mastery.service.ts` (formula) → `services/recommendation.service.ts` (weakness → action) → `app/(app)/admin/*` (observability). Keep `services/` owning logic, `ai/` owning prompts, routes thin, ids always re-scoped by `user_id`.

