# AI Study Companion — Remaining Tasks Execution Plan

## How OpenCode must use this file

This file contains the remaining improvements identified by comparing the current implementation with the Project Requirements.

### Execution rule

Execute tasks **strictly in order**:

**Task 1 → stop → Task 2 → stop → Task 3 → stop → ...**

Do NOT execute multiple tasks in one run.

At the beginning of each run:
1. Read this file.
2. Identify the **first incomplete task**.
3. Read the current project implementation and relevant documentation/PRD.
4. Execute ONLY that task.
5. Run the required checks.
6. Update this file by marking that task as completed if appropriate.
7. Report what changed.
8. STOP. Do not begin the next task.

When I later tell you to continue, start with the next incomplete task.

### Important scope rule

Do not work on deployment in these tasks.

Do not add unrelated features.

Do not rewrite working architecture unnecessarily.

Use the existing architecture and business logic wherever possible.

Before changing anything, inspect the actual implementation. The implementation is the source of truth for existing behavior.

---

# Task 1 — Align the Home Dashboard with the PRD

**Status: COMPLETED (2026-09-17 — Continue Learning / Recent Projects / Overall Progress / Areas Requiring Attention / Recommended Next Action implemented via `services/dashboard.service.ts` + rewritten `app/(app)/dashboard/page.tsx`; tests/typecheck/lint/build all pass).**

## Goal

Improve `/dashboard` so the Home Dashboard clearly answers:

**Where was I? How am I doing? What should I do next?**

The PRD expects:
- Continue Learning
- Recent Projects
- Overall Progress
- Areas Requiring Attention
- Recommended Next Action

## Work

Inspect the existing dashboard, analytics services, recommendation logic, mastery/growth logic, project pages, and shared UI components.

Implement:

### 1. Continue Learning
Show the user's most relevant/recent project and provide a direct way to continue learning.

Use real activity/project data. Do not invent data.

### 2. Recent Projects
Clearly show recent projects with useful metadata and direct navigation.

### 3. Overall Progress
Reuse the existing global analytics/mastery calculations.

Do not create a second mastery formula.

### 4. Areas Requiring Attention
Surface weak concepts/projects using existing mastery/growth/recommendation logic.

Provide useful links to the relevant project, concept, Tutor, material, or quiz.

### 5. Recommended Next Action
Use existing recommendation data and `RecommendedNextAction` behavior where appropriate.

Do not create generic fake recommendations.

## Engineering constraints

- Keep server-side data fetching efficient.
- Parallelize independent reads where appropriate.
- Preserve authentication and project/user isolation.
- Reuse shared UI components.
- Handle empty and error states.
- Keep responsive behavior.
- Do not change unrelated project pages.

## Validation

Run:
- relevant tests
- typecheck
- lint
- build where practical

Verify:
- new user with no projects
- user with projects but little activity
- user with mastery/recommendation data

### Completion condition

The Home Dashboard visibly satisfies the PRD's five dashboard areas without breaking existing functionality.

---

# Task 2 — Strengthen Admin System Health

**Status: COMPLETED (2026-09-17 — lightweight `/admin/health` page via `getAdminSystemHealth()` + `computeOverallStatus()` in `services/admin.service.ts`, wired into admin layout/sidebar/topbar; tests/typecheck/lint/build all pass).**

## Goal

The PRD expects the Admin Dashboard to provide visibility into:

- Users
- Spaces
- Projects
- Activity
- Engagement
- Learning analytics
- AI usage
- AI evaluation
- Background processing
- System health

The existing Admin area already covers most of these. Strengthen the missing/weak **System Health** portion without turning it into a full monitoring platform.

## Work

Inspect the existing admin services, jobs page, AI usage page, database/storage helpers, environment checks, and existing error handling.

Add a lightweight System Health section/page that can show, using safe server-side checks:

- Database connectivity/status
- Supabase/storage status where practical
- AI provider configuration/status
- Embedding service status where practical
- Background-job/Inngest status
- Recent relevant failures
- Overall status such as HEALTHY / DEGRADED

Use real checks and clearly indicate when a check cannot be performed.

Do not expose secrets or environment values.

Do not create fake health results.

## Engineering constraints

- Admin-only access.
- Use existing admin authorization.
- Keep service-role usage server-side.
- Do not expose service keys to the browser.
- Avoid slow blocking checks where possible.
- Keep the system-health page lightweight.

## Validation

Test:
- authorized admin
- normal user cannot access it
- health failures render safely
- missing optional services do not crash the dashboard

Run tests/typecheck/lint/build as practical.

### Completion condition

Admin has a clear, lightweight System Health view aligned with the PRD.

---

# Task 3 — Improve Persistent Tutor Continuity

**Status: COMPLETED (2026-09-17 — rolling conversation summary persisted on `conversations` via `db/schema/005_conversation_summary.sql`; summary+recent-window wiring in `ai/tutor.ts` + `services/tutor.service.ts` with `maybeRefreshConversationSummary()`; tests/typecheck/lint/build all pass).**

## Goal

Strengthen the Tutor's persistent relevant context.

The current Tutor already uses:
- Project learning goal
- Concepts
- Weak mastery
- Materials
- Conversation history
- Recent message window

The limitation is that a bounded message window can lose older important conversation context.

## Work

Inspect:
- `services/tutor.service.ts`
- conversation/message schema
- Tutor prompts
- AIService
- existing persistence patterns

Implement a lightweight conversation-summary mechanism.

The design should allow the Tutor to retain useful older context without sending the entire conversation history on every request.

Possible architecture:

- Persist a concise conversation summary.
- Update the summary periodically or after meaningful exchanges.
- Include the summary plus the recent message window in future Tutor requests.
- Keep the summary project/conversation scoped.
- Do not store unnecessary or sensitive information.

The summary must not replace recent messages.

## Safety and correctness

- Retrieved/material content remains untrusted data.
- Preserve current prompt-injection defenses.
- Preserve project isolation.
- Do not let the LLM directly modify learning state.
- Validate generated structured summary data before persistence.

Do not implement a complicated long-term memory system.

## Validation

Test:
- new conversation
- short conversation
- long conversation
- summary update
- Tutor response using summary + recent messages
- authorization/isolation

Update database migration/schema only if genuinely required.

### Completion condition

Older useful Tutor context can survive beyond the bounded recent-message window without compromising isolation or reliability.

---

# Task 4 — Improve AI Evaluation with Run Tracking

**Status: COMPLETED (2026-09-17 — file-based run tracking via `services/evaluation.service.ts` (normalize/compare `IMPROVED`/`REGRESSED`/`UNCHANGED`/`BASELINE`); `tests/eval/run-eval.ts` emits `runId`/`suiteVersion` + archives previous runs to `tests/eval/history/`; `/admin/ai-evaluation` shows run metadata, comparison badge, and case-level flips; eval suite 18/18, tests/typecheck/lint/build all pass).**

## Goal

The project already has curated evaluation fixtures and automated tests.

Improve the Admin AI Evaluation experience so it is easier to identify regressions between evaluation runs.

## Work

Inspect:
- `tests/eval`
- evaluation result files
- `docs/evaluation.md`
- `/admin/ai-evaluation`
- evaluation service/loading logic

Add lightweight run metadata such as:

- evaluation run ID/version
- timestamp
- total cases
- passed
- failed
- pass rate
- previous run comparison

Show a simple result such as:

- IMPROVED
- REGRESSED
- UNCHANGED

based on pass-rate/case-level comparison.

Preserve current evaluation behavior.

Do not add an expensive LLM-as-a-judge system.

Do not invent historical data.

If there is no previous run, clearly show that this is the baseline.

## Validation

Run the evaluation suite.

Verify:
- current results load
- baseline works
- a changed result can be detected
- malformed evaluation output does not crash Admin
- no sensitive data is exposed

### Completion condition

The project can demonstrate basic AI regression awareness through repeatable evaluation runs.

---

# Task 5 — Synchronize All Project Documentation with the Current Implementation

**Status: COMPLETED (2026-09-17 — reconciled README/architecture/evaluation/limitations/future-improvements/ai-tools-usage/build-prompts + as-built notes in development-prompts/03/06/14/16/18/19 + WEBSITE_COMPLETE_OVERVIEW drift section; fixed stale test counts, Mercury/local-384 providers, 404 semantics, rate limits, admin map, rail/services lists, rolling-summary + eval-tracking coverage; regenerated architecture/ai-tools-usage/development-prompts PDFs; tests/typecheck/lint/build all pass).**

## Goal

The overview identified documentation drift.

The PRD explicitly requires accurate:
- architecture documentation
- AI usage documentation
- development prompts
- evaluation approach
- known limitations
- future improvements
- repository documentation

## Work

Inspect and reconcile, at minimum:

- `README.md`
- `docs/architecture.md`
- `docs/evaluation.md`
- `docs/limitations.md`
- `docs/future-improvements.md`
- `docs/ai-tools-usage.md`
- `docs/build-prompts.md`
- `docs/development-prompts/*`
- architecture PDF if generated from source
- evaluation documentation/PDF if applicable

Correct stale statements about:

- test counts
- model/provider choices
- embedding dimensions/provider
- rate limits
- UI/theme
- project navigation/features
- 401/404 authorization behavior
- background-job behavior
- AI interaction architecture
- current admin functionality
- current deployment status

Important:

The documentation must describe the **current code**, not an older intended architecture.

Do not claim deployment is complete.

Do not invent production verification.

Keep known limitations honest.

## Additional requirement

Ensure the documentation clearly distinguishes:

### AI used to build the product
Examples:
- coding assistants
- OpenCode/development agents
- debugging assistance

### AI used by the final product
Examples:
- Tutor
- quiz generation
- open-ended assessment
- recommendations
- concept extraction
- document understanding/evaluation where applicable

## Validation

Search the repository for stale statements.

Check the main documents for contradictions.

### Completion condition

A new developer and evaluator reading the repository documentation should see the same architecture and capabilities that actually exist in code.

---

# Task 6 — Polish the Project Dashboard Around the Learning Loop

**Status: COMPLETED (2026-09-17 — `app/(app)/projects/[projectId]/page.tsx` only: numbered 6-step learning-loop strip with live per-stage status, Needs-attention/On-track/Get-started card from existing growth+materials data, rec titles linked; no new queries/logic; tests/typecheck/lint/build all pass).**

## Goal

Make the project hub communicate the core learning loop more clearly without adding major functionality.

The PRD's desired loop is:

Space
→ Project
→ Material
→ Knowledge
→ Tutor
→ Grounded Answer
→ Assessment
→ Mastery
→ Growth
→ Recommendation
→ Continue Learning

## Work

Inspect:

`/projects/[projectId]`

Improve information hierarchy so the user can immediately understand:

- what they are learning
- what needs attention
- what they should do next
- where to learn/practice/measure progress

Use existing data and navigation.

Prefer improving existing cards, sections, labels, order, and links rather than creating a new architecture.

Make the following especially clear:

- active recommendation
- weakest/attention concepts
- recent learning state
- material availability
- next action

Keep the existing visual language.

## Constraints

No new major backend system.

No duplicate recommendation/mastery logic.

No unnecessary redesign.

### Completion condition

The project hub clearly communicates the learning loop and makes the next action easy to find.

---

# Task 7 — Full Requirements Verification and Test Hardening

**Status: COMPLETED (2026-09-17 — `docs/requirements-checklist.md` with PASS/PARTIAL/MISSING per area; verified live: smoke-live 27/27, smoke-deep 6/6, full chain unsupported→READY→8 mastery→1 recommendation→growth/analytics 200, ai_operations per-feature audit; fixed smoke-deep fixture/status/shape expectations; tests 158/typecheck/lint/build all pass; no deployment).**

## Goal

Before submission preparation, perform a final implementation verification against the PRD.

## Work

Use the actual Project Requirements document and verify each major requirement.

Create or update a checklist covering:

### Core learning loop
- Authentication
- Spaces
- Projects
- PDF upload
- Background processing
- Knowledge extraction/retrieval
- Tutor
- Grounded citations
- Unsupported questions
- Adaptive quiz
- Open-ended assessment
- Mastery
- Growth
- Recommendations
- Analytics
- Continue learning

### Engineering
- Project isolation
- Authentication/authorization
- Input validation
- Secure APIs
- Prompt-injection defense
- Structured AI output validation
- AI observability
- Evaluation
- Error handling
- Idempotency
- Background jobs
- Testing

### Admin
- Users
- Spaces/Projects
- Activity
- Engagement
- Analytics
- AI usage
- AI evaluation
- Background jobs
- System health
- User drill-down

### Documentation/submission readiness
- README
- Architecture documentation
- AI usage documentation
- Development prompts
- Evaluation documentation
- Limitations
- Future improvements

## Work required

Run the complete automated test suite.

Run evaluation tests.

Run typecheck.

Run lint.

Run build.

Run available smoke tests that can be safely executed locally.

Fix only issues discovered by this verification.

Do not start deployment.

## Completion condition

Produce a final requirements checklist with:

- PASS
- PARTIAL
- MISSING

and cite the relevant implementation/file for each non-obvious item.

Do not mark an item PASS merely because documentation says it exists; verify the implementation.

---

# Task 8 — Final Repository / Submission Documentation Readiness

**Status: COMPLETED (2026-09-17 — README gained Architecture summary, Embedding-service setup, Configuration examples, Deployment information (not deployed), Known limitations; `.env.example` added missing `INNGEST_DEV`; `.gitignore` now covers `tests/eval/history/`; synced `docs/evaluation.md` to latest run `eval-20260917-181106-kzbyca` 18/18 and fixed `18-deployment.md` env-parity/key-count drift; secret scan clean (only `.env.example` tracked, `.env.local` ignored); tests 158/typecheck/lint/build all pass; no deployment, no credentials created).**

## Goal

Prepare the repository for the required public submission artifacts, excluding actual deployment.

The PRD requires the repository to contain:

- source code
- README
- setup instructions
- configuration examples
- architecture documentation
- testing instructions
- deployment information

It also requires:
- architecture documentation
- AI usage documentation
- development prompts
- evaluation approach
- known limitations
- future improvements

## Work

Inspect the repository and make sure:

1. `README.md` contains:
   - project overview
   - architecture summary
   - setup instructions
   - required environment variables
   - local development
   - database migration steps
   - embedding-service setup
   - testing commands
   - evaluation commands
   - build/lint/typecheck commands
   - deployment instructions/architecture
   - known limitations

2. `.env.example` contains required variable names but no real secrets.

3. No API keys, service-role keys, passwords, tokens, or private credentials are committed.

4. Documentation links are valid.

5. Development prompts are organized clearly.

6. Architecture documentation matches the current implementation.

7. Evaluation documentation matches the current test/evaluation suite.

8. The repository does not claim that deployment is complete when it is not.

## Important

Do not create or expose credentials.

Do not perform the actual deployment.

Do not push to GitHub automatically.

### Completion condition

The repository is organized and documented so it can be made public without documentation/security inconsistencies.

---

# Final Instruction

After completing each task:

1. Do not automatically start the next task.
2. Report:
   - task completed
   - files changed
   - important implementation decisions
   - tests/checks run
   - failures or limitations
3. Mark only that task as completed in this file.
4. Wait for the instruction to continue.

## Execution order

1. Home Dashboard PRD Alignment
2. Admin System Health
3. Persistent Tutor Continuity
4. AI Evaluation Run Tracking
5. Documentation Synchronization
6. Project Dashboard Learning-Loop Polish
7. Full Requirements Verification and Test Hardening
8. Final Repository / Submission Documentation Readiness

Deployment is completely excluded from this task file.

Do not inspect, configure, test, or implement deployment as part of any task here.
Deployment will be handled as a separate phase only after Tasks 1–8 are completed.
