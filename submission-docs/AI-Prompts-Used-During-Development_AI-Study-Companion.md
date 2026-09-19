# AI Study Companion — AI Prompts Used During Development

> **Full Stack AI Engineer Intern — Project Submission**
> Live: https://ai-study-companion-three-inky.vercel.app/ · 18 September 2026
> Agent / models: OpenCode coding agent · Claude (planning) · Muse Spark (implementation sessions)
> Raw history: `extra-docs/docs/development-prompts/` (19 per-phase logs: prompt + purpose + result + deviations)
> Status: 314 tests passing · 18 eval fixtures green

---

> **How to read this.** I worked in strict build order — one prompt at a time, acceptance checks green before moving on, `/compact` between phases. The prompts below are the *material* ones (lightly cleaned for readability: typos fixed, secrets redacted), grouped the way the submission asks — architecture, frontend, backend, database, AI, debugging, testing, documentation & deployment. Each shows **context → prompt → why it mattered → outcome**. The per-phase folder in the repo holds the verbatim logs.

**Contents:** 1. Architecture & planning (P1–P3) · 2. Database (P4–P5) · 3. Backend (P6–P9) · 4. AI (P10–P14) · 5. Frontend (P15–P18) · 6. Debugging (P19–P22) · 7. Testing & evaluation (P23–P24) · 8. Documentation & deployment (P25–P26) · 9. Lessons learned

---

## 1. Architecture & planning

### P1 — "Help me think before I code" (planning with Claude)

**Context:** Day 0, before any code.

> I've got the PRD for an AI Study Companion (Spaces → Projects → PDFs → Tutor → Quiz → Mastery → Growth → Recommendations + Admin). I'm one dev with 3–4 days. Can you help me turn this into a buildable architecture: the smallest stack that still satisfies "grounded + cited + unsupported handling + isolation + observability + eval", the exact DB tables I'll need, and a phased build order with acceptance checks per phase? Be ruthless about what I should NOT build.

**Why it mattered:** produced `architecture.md` — single source of truth — and the MUST/SHOULD/FUTURE scope that protected the timeline.
**Outcome:** 19 phases in dependency order; "no microservices / no second vector DB / no custom auth" written down so I never reconsidered mid-build.

### P2 — "Turn the architecture into agent-ready tasks"

**Context:** still planning, about to start OpenCode.

> Now convert that architecture into copy-paste prompts for my coding agent (OpenCode). One prompt per phase, each ending with its acceptance check and a "run /compact before next phase" reminder. Assume the agent has read architecture.md. Include the exact schema, the RAG thresholds, and the tutor output shape in the relevant phases so I don't have to repeat myself later.

**Why it mattered:** produced `build-prompts.md` — I never had to design-while-coding.
**Outcome:** phases 02–19 executable in order; every phase log follows the same template (prompt / purpose / result / changes / notes / compact).

### P3 — "Scaffold it, nothing fancy yet"

**Context:** to OpenCode, Phase 02, fresh repo.

> Hey — let's scaffold the Next.js 14 (App Router) + TypeScript repo "ai-study-companion". Tailwind, ESLint + Prettier, the folder layout from architecture.md (app routes for dashboard/spaces/projects/tutor/quiz/…/admin, plus lib/, services/, ai/, db/schema/, types/, docs/). Add .env.example with just the key names (no values!) and a short README with setup steps we'll fill in as we go. No backend logic yet — placeholders that render are enough. I'll check with `npm run dev`. After that, run /compact.

**Outcome:** clean booting skeleton; every later phase had somewhere to land.
**Lesson:** keeping P3 logic-free avoided half-wired imports haunting me for days.

---

## 2. Database

### P4 — "Write the schema like you mean the RLS"

**Context:** to OpenCode, Phase 03.

> Using Supabase Postgres + pgvector, can you write the migrations under db/schema/ for the full schema in architecture.md §6 (spaces → … → ai_operations)? uuid PKs, timestamptz, CASCADEs, ivfflat/hnsw on chunks.embedding, indexes on every project_id/user_id + learning_events(project_id, created_at), and RLS on everything user-owned (`user_id = auth.uid()`). I started chunks at 1536 in the draft — flag whatever dim you actually use and keep it consistent. Add a README for running it. Acceptance: migrates clean on a fresh project and RLS blocks cross-user reads. Then /compact.

**Outcome:** migrations 001 (+ 002 retrieve, 003 storage); later 004–014 layered embeddings 384 → Gemini 768, summaries, practice, dedupe, pinning.
**Deviation I chose:** embedding dim moved twice (1536 → 384 → 768) — each with its own migration + guards rather than editing history.

### P5 — "Auth that actually redirects properly"

**Context:** to OpenCode, Phase 04.

> Let's wire Supabase Auth: signup/login/logout, server + client sessions, middleware guard so everything under the app routes bounces logged-out users to /login. I need a `getCurrentUser()` for pages (redirects) and a `requireUserId()` for API routes that throws 401 JSON instead of redirecting — I keep seeing APIs 500 on auth failure and that's wrong. Simple forms with real error messages are fine. I'll test signup → refresh-stays-logged-in → logout → deep-link-redirects. Then /compact.

**Outcome:** dual helpers + `isAuthError → 401` mapping; route-audit tests lock it in. This one decision killed a whole class of flaky "sometimes 500" bugs.

---

## 3. Backend — spaces, projects, materials & jobs

### P6 — "CRUD where you can't read anyone else's stuff"

**Context:** to OpenCode, Phase 05.

> Spaces + Projects CRUD please, fully ownership-scoped. Every service lookup must be `WHERE id AND user_id` — I don't want to rely on remembering to call a separate check. Thin route handlers only. /dashboard lists spaces, /spaces/[id] lists projects (404 — not 403 — for other people's stuff), project page can be a placeholder for now. Emit SPACE/CREATED + PROJECT_CREATED. I'll verify with two accounts that A's URLs 404 for B. Then /compact.

**Outcome:** `project.service.ts` pattern reused by every later service; ownership tests still assert it.

### P7 — "Upload returns fast, processing happens behind the scenes"

**Context:** to OpenCode, Phase 06.

> Material upload + background pipeline next. Sync part: validate PDF (size cap), store in the private bucket under user/project, create materials row QUEUED, emit event, fire Inngest, return 202 — don't block. Async (Inngest): PROCESSING → extract text with page numbers → chunk ~500-800 tokens w/ overlap → embed via AIService → store chunks → extract concepts (structured, ≤8) → READY; any failure → FAILED + processing_error, never stuck. Materials page needs QUEUED/PROCESSING/READY/FAILED + Retry. I'll upload a real PDF and a corrupt one. Then /compact.

**Outcome:** pipeline + `AIService` skeleton + status UI. Later hardened with SHA-256 dedupe, atomic claims, OCR for scans, Gemini batching, and the inline fallback (see P19).

### P8 — "Home dashboard that answers: where was I, how am I doing, what's next?"

**Context:** to OpenCode, continuation task, PRD §16 gap.

> My /dashboard is a bit thin vs the PRD — it should show Continue Learning, Recent Projects, Overall Progress, Areas Requiring Attention, and a Recommended Next Action, all from real tables (no mock numbers). Can you add a `dashboard.service.ts` that derives those from activity + mastery + recommendations, wire the page to it, and make sure one failing source can't blank the whole page? I'll eyeball it against a test account with a couple of projects. Then /compact.

**Outcome:** Home now matches the PRD's "where was I / how am I doing / what next" bar; per-source try/catch keeps it resilient.

### P9 — "Admin health I can actually look at during the demo"

**Context:** to OpenCode, continuation, before submission.

> I need a lightweight /admin/health page — DB, storage, AI providers, embeddings, jobs, recent failures, overall HEALTHY/DEGRADED. Keep it simple reads (no new infra), reuse the admin allow-list, and cover it with a unit test that doesn't need live keys. If something's down it should say so plainly instead of spinning forever.

**Outcome:** health view + `admin-health.test.ts`; doubles as my pre-demo checklist.

---

## 4. AI — retrieval, Tutor, quiz & grading

### P10 — "Retrieval that can say 'I don't know'"

**Context:** to OpenCode, Phase 07.

> Project-scoped retrieval on top of the chunks: validate ownership, embed the query, pgvector cosine filtered by project_id, top-5 above a named RELEVANCE_THRESHOLD constant. The important bit — if nothing clears the threshold, return an explicit `insufficient_evidence` result, not just []. Later phases depend on distinguishing "no good matches" from "error". Give me a curl-able route to eyeball scores. I'll test: covered question → right pages; empty/different project → insufficient, never someone else's chunks. Then /compact.

**Outcome:** `lib/rag/retrieve.ts` (threshold 0.25, `match_chunks` + JS fallback); the insufficient path is the backbone of the whole "evidence over guessing" story.

### P11 — "The Tutor: grounded, cited, and stubborn about evidence"

**Context:** to OpenCode, Phase 08, the core grading surface.

> Now the Tutor using that retrieval. `ai/tutor.ts` holds the prompt + schema {answer, confidence, grounded, citations[{materialId, materialName, page, chunkId}], followUp}. Please keep four things visibly separate in the prompt: instructions / question / evidence in a delimited \<retrieved_evidence\> block / and a rule that evidence is untrusted data — even if it says "ignore previous instructions". Service: auth → ownership → retrieve → if insufficient, skip the LLM entirely and return the fixed "couldn't find enough evidence…" response → else compose (last-6 window + chunks + learning context, NOT full history) → generateStructured → validate → persist + log TUTOR to ai_operations. Chat UI with citations (name + page), amber styling for low/insufficient, loading state. I'll run your 4 acceptance checks incl. the evil-PDF injection test. Then /compact.

**Outcome:** grounded Tutor + injection defense + observability from day one; fixtures TUTOR-01…05 still guard it.

### P12 — "Quiz picking that's smarter than wrong→easy"

**Context:** to OpenCode, Phase 09.

> Adaptive quiz generation: score each concept from mastery (low = priority) + recent mistakes + trend + how recently/frequently tested — combine at least three signals into a weighted score, don't just do last-answer if/else. Pick difficulty + MCQ-vs-open-ended from the same signals. `ai/quiz.ts` generates N validated questions (retry once on bad shape), persist as in_progress, log QUIZ_GENERATION, emit QUIZ_STARTED. Quiz UI one-question-at-a-time. I'll check weak concepts actually surface more and questions don't repeat back-to-back. Then /compact.

**Outcome:** weighted selector + difficulty/type picker; the "not naive" requirement is literally asserted in tests.

### P13 — "Grade MCQ with code, open-ended with care"

**Context:** to OpenCode, Phase 10.

> Answer submission + grading: MCQ deterministic in backend (no LLM!), open-ended via `ai/assessment.ts` → {score 0-100, understanding, strengths[], missingConcepts[], reasoningQuality, feedback}, validated before persist. submitAnswer persists, emits QUESTION_ANSWERED, and when the last question lands, completes the quiz (idempotent — double-submit must not double-fire QUIZ_COMPLETED). Log OPEN_ENDED_EVALUATION. UI: per-question correctness/feedback + summary screen. I'll do a mixed quiz and double-post the last answer to check idempotency. Then /compact.

**Outcome:** deterministic MCQ, explanatory open-ended grading (≥60 ⇒ correct), per-question idempotency incl. race handling, answer-gating (answers hidden until graded).

### P14 — "Mastery is math, not vibes — plus growth + recommendations that name names"

**Context:** to OpenCode, Phases 11–12 (I combined the review).

> Two linked pieces. (1) Mastery: on QUIZ_COMPLETED in an Inngest step (not inline), per concept `new = prev*0.7 + evidence*0.3` (MCQ 0/100, open-ended as-is, average multiples) — plain backend code, the LLM never sets a number. Upsert mastery + history row + MASTERY_UPDATED. I'll verify the math by hand on one concept. (2) Growth: classify from last two history points (>+5 IMPROVING, <-5 REQUIRES_ATTENTION, else STABLE) with a simple table/chart. Recommendations: structured {title, action_items} from weak concepts + mistakes + goal + activity — and please explicitly ban "keep studying" generic output; items must name real concepts/materials, 2–5 items, persisted ACTIVE + event + log. Card on project dashboard + list + COMPLETED/DISMISSED. Check: weak concept → REQUIRES_ATTENTION + a recommendation naming it. Then /compact.

**Outcome:** explainable mastery, growth bands, specific recommendations (skipped when nothing weak — by design); `mastery_history` is what makes growth + future spaced-repetition possible.

---

## 5. Frontend — project hub, dashboards & admin

### P15 — "Project page that fans out without falling over"

**Context:** to OpenCode, mid-build UI pass.

> The /projects/[id] hub feels fragile — can you make it load project + ACTIVE recommendations + growth + materials in parallel with per-source catch (one failure ≠ blank page), keep the Materials→Tutor→Quiz→Growth→Analytics rail always visible, and add proper skeletons + empty states? Ownership 404s stay. I'll throttle one source to check the page still renders.

**Outcome:** resilient hub; the pattern was copied to dashboard + admin pages.

### P16 — "Analytics with numbers I can recount by hand"

**Context:** to OpenCode, Phase 13.

> Project + global analytics from real aggregations only. Project: activity (sessions/attempts/answers), assessment (avg score, accuracy over time), mastery (per-concept, improving vs weak), AI activity (calls/latency from ai_operations). Global: totals across my spaces/projects + mastery avg + AI summary. No mocks. I'll manually count rows for a test account and compare. Then /compact.

**Outcome:** `analytics.service.ts` (project + global) with ownership-checked queries; admin engagement/learning views reuse the same aggregations.

### P17 — "Admin: allow-list for now, but the full drill-down"

**Context:** to OpenCode, Phase 14.

> Admin section gated by a simple allow-list (ADMIN_EMAILS / ADMIN_USER_IDS — leave a comment that prod wants a real role column). Pages: dashboard counts; users + per-user drill-down (projects → activity → assessments → progress → AI usage); projects; activity feed with user/space/project/type/time filters; ai-usage (calls, latency, cost, errors); ai-evaluation (render whatever the eval script writes); jobs (recent runs, link to Inngest for detail). Non-admins get bounced. I'll check all pages with real test-account data. Then /compact.

**Outcome:** 11 admin views incl. engagement, learning, health, and run-over-run eval comparison — the "observable AI" story reviewers can click through.

### P18 — "Make the sidebar feel like one product"

**Context:** to OpenCode, late UI polish.

> The sidebar grew organically and it shows — workspace / project / admin sections, mobile drawer, active states. Can you rework `Sidebar.tsx` into one shared shell so dashboard, project pages and admin all feel like the same app? Keep it boring and fast (no new deps). I'll click through mobile + desktop.

**Outcome:** unified shell; small change, big "real product" feel in the demo video.

---

## 6. Debugging — the ones that saved the submission

### P19 — "Materials stuck in QUEUED on Vercel — help me make this bulletproof"

**Context:** to OpenCode, pre-deploy fire-drill.

> I'm seeing uploads sit in QUEUED when Inngest delivery hiccups on serverless. Can we: (a) add an inline `processMaterial` fallback + `maxDuration=60` so the request heals itself, (b) claim atomically (QUEUED/FAILED→PROCESSING) so fallback + job can't double-chunk, (c) SHA-256 dedupe per project (duplicate → reuse row, no second job), (d) retry route that always reprocesses inline? Keep READY materials never auto-reprocessed. I'll test by blocking Inngest and confirming READY anyway.

**Outcome:** the strongest pipeline in the repo; demo-day insurance. Logged in `17-debugging.md`.

### P20 — "Switch embeddings to Gemini 768 without breaking retrieval"

**Context:** to OpenCode, provider migration.

> We're moving embeddings to Gemini `gemini-embedding-2` at 768 dims (free tier, server-only key). I need: migration 012 to VECTOR(768), AIService updated (docs as title|text, queries as task|query, dim gate that refuses mismatches), batched embeds (20/req), 10-min query cache, purge + reindex script (manual, NOT auto-run), and README updated. Old vectors must NOT be silently mixed — fail loudly on dim mismatch. I'll verify live that outputDimensionality=768 returns 768 floats and retrieval still filters at 0.25. Then /compact.

**Outcome:** single-provider Gemini space; `match_chunks(vector(768))` + guards enforce it; stale FastEmbed/Groq docs were the main thing I had to correct afterwards (see P25).

### P21 — "Build is failing on a circular type in eval fixtures — smallest fix?"

**Context:** to OpenCode, broken build, late at night.

> `npm run build` is failing on a circular type between RETRIEVAL_FIXTURES and the eval runner. What's the minimal fix that keeps the 18 fixtures intact and the admin comparison working? Don't refactor the whole eval service — just break the cycle and re-run build + eval + the eval tracking tests.

**Outcome:** one-type fix, build green; captured in the phase-15 log as a reminder that eval fixtures are load-bearing.

### P22 — "Tutor answers are leaking between projects?? (false alarm — prove it)"

**Context:** to OpenCode, security scare, turned out fine.

> I'm paranoid about cross-project leakage in Tutor answers. Can you trace every read in the tutor path (retrieval → conversation → chunks → excerpts) and confirm each is ownership-gated, add/extend a test that user B can't retrieve user A's chunks even with A's projectId, and show me the exact WHERE clauses? If anything filters by project_id alone after a single check, flag it. Then /compact.

**Outcome:** verified `project_id + user_id` scoping throughout + RLS; residual note (service-role background reads) honestly recorded in limitations rather than hidden.

---

## 7. Testing & evaluation

### P23 — "Tests that protect the grade, not coverage theatre"

**Context:** to OpenCode, Phase 16A.

> I don't have time for exhaustive coverage — give me the tests that protect the grade: mastery formula table-tests, ownership/IDOR tests, tutor insufficient-evidence (mock retrieval → no LLM call), quiz answer-gating, rate-limit windows, 401/404 mapping, admin health, eval run-tracking, Gemini formatting + error paths, migration ordering, scanned-PDF OCR, dedupe hashing. Everything must run offline (`npm test`, vitest). I'll treat red as a build-blocker.

**Outcome:** 314 tests / 26 files, all green — the safety net that let me refactor (Gemini move, sidebar rework) without fear.

### P24 — "An eval suite I can re-run after every prompt tweak"

**Context:** to OpenCode, Phase 16B + continuation.

> Now the AI eval: 18 fixed fixtures in `tests/eval/fixtures.ts` — Tutor (grounded / unsupported / multi-concept / citation / injection), Retrieval (query→expected source), Assessment (missing-concept), Recommendations (specificity rubric). `npm run eval` should attempt live calls but score offline too, write results.json + per-run history, and stamp runId/suiteVersion. Then wire /admin/ai-evaluation to compare latest vs previous (IMPROVED/REGRESSED/UNCHANGED/BASELINE) via a pure `evaluation.service.ts`. Write up real outputs in evaluation.md — no placeholders. I'll re-run after any prompt/model change. Then /compact.

**Outcome:** regression-aware eval; prompt/model/retrieval edits are now diffed, not silently shipped.

---

## 8. Documentation & deployment

### P25 — "Docs pass: make everything true again"

**Context:** to OpenCode, Phase 19, pre-submission.

> Docs audit time. README (setup, env table, test/eval commands, live URL), ai-tools-usage (strict build-vs-runtime split), limitations (honest, with prod paths), future-improvements (one sentence each + which existing table supports it), evaluation.md (real run outputs). And please hunt stale claims — old embedding dims/providers, test counts, "no deployment yet" — and fix them against the actual code (AIService, schema 012, package.json, live URL). No invented numbers: run the commands and paste outputs. Then /compact.

**Outcome:** this submission set; the audit caught exactly the drift (FastEmbed-384/Groq mentions, 158-vs-314 counts) a reviewer would have flagged.

### P26 — "Deploy it and smoke-test the whole loop live"

**Context:** to OpenCode, Phase 18 (I ran the live pass by hand).

> Walk me through the deploy checklist: Vercel import + env from .env.example, migrations 001→014 in order, private materials bucket, /api/inngest synced in Inngest Cloud, no secrets committed. Then give me a smoke script I can run myself on the live URL: signup → space/project → upload PDF → wait READY → tutor Q + citation → unsupported Q → quiz (MCQ + open-ended) → mastery/growth/recommendations move → admin pages load. I'll do the live run manually and report back what breaks.

**Outcome:** live at `https://ai-study-companion-three-inky.vercel.app/`; hardening (inline fallback, maxDuration, Gemini purge+reindex) came out of that manual pass — the kind of thing AI can't do for you.

---

## 9. What I learned about prompting (and what I'd do differently)

| Lesson | What I'll repeat |
|---|---|
| Plan once, in writing, before coding | architecture.md + phased prompts meant I never paid "re-design tax" mid-sprint. The /compact rhythm kept context fresh across 19 phases. |
| Put acceptance checks in the prompt, not after | "I'll verify X by doing Y" forced testable output — and gave me the eval fixtures almost for free. |
| State the non-goal explicitly | "No backend logic yet", "don't refactor the whole service", "fail loudly on dim mismatch" saved more time than any clever wording. |
| Keep the human as reviewer, on record | Every phase log has Changes/Notes — where I overruled the agent (recommendation specificity, 0.7/0.3 simplicity, allow-list over fake RBAC). That's what makes this "my original work" honestly. |
| Debug prompts need symptoms + constraints | P19–P22 worked because I pasted the failure, named what must not break, and asked for the minimal fix — not "make it better". |
| Docs rot faster than code | P25's "hunt stale claims against the code" step should have run after every provider change, not just at the end. Next time: docs check inside each phase's acceptance criteria. |

*Originality statement: this deliverable is my original work. AI tools (above) assisted with planning, implementation, debugging and drafting under my direction; the architecture decisions, acceptance testing, live deployment, smoke tests, demo video, and these submission documents were produced and verified by me. Provider keys, accounts and the deployed instance are mine; no third-party code is presented as my own.*
