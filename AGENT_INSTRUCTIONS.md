# Agent Instructions — Start Here

You are building "AI Study Companion." Before writing any code:

1. Read `docs/architecture.md` in full — this is the ground-truth architecture. Do not
   introduce technology, structure, or files that contradict it.
2. Read `docs/build-prompts.md` — it contains the full build plan as numbered phases
   (02 through 19), each phase already written as a ready-to-execute prompt.

## How to proceed

Execute `docs/build-prompts.md` **one phase at a time, in numeric order**. For each phase:

1. Read that phase's prompt block carefully.
2. Implement exactly what it describes — nothing from later phases, nothing outside
   `docs/architecture.md`'s tech stack.
3. Run the "Acceptance check" listed at the end of the phase yourself before considering
   it done. If it fails, fix it before moving on — do not proceed to the next phase with
   a broken acceptance check.
4. Create `docs/development-prompts/NN-name.md` for the phase using the template at the
   bottom of `docs/build-prompts.md`, filled in with what actually happened (real prompt,
   real result, real changes made, real notes) — not placeholder text.
5. Stop and wait for confirmation before starting the next phase, unless told to proceed
   through all phases automatically.

## Hard rules (apply to every phase)

- Never trust `projectId` / `materialId` / `userId` from the client. Always resolve and
  validate ownership server-side against the authenticated session.
- Every AI-facing feature returns a validated structured JSON schema — never persist raw
  LLM text directly, and never let the LLM set a mastery score directly (see
  `docs/architecture.md` §10 for the deterministic formula).
- Retrieval (RAG) is always scoped by `project_id` + `user_id` — never global.
- Route handlers stay thin; all logic lives in `services/`, all AI calls go through
  `lib/ai`'s `AIService` abstraction — do not call the OpenAI SDK directly elsewhere.
- Do not add microservices, a second database, custom auth, or other infrastructure not
  named in `docs/architecture.md` §16 ("What We Deliberately Did Not Build").

## Reference docs in this bundle

- `docs/architecture.md` — full architecture, schema, security model, MUST/SHOULD/FUTURE scope.
- `docs/build-prompts.md` — the 17 phase prompts (02–19) plus the dev-prompt template and time budget.
- `docs/prompting-guide.md` — background on how these prompts were derived; not required
  reading to execute, but useful if a phase needs to be split or re-scoped.

Begin with phase 02 now.
