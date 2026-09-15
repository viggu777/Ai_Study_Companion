# Prompt

Set up the initial repository for a Next.js 14 (App Router) + TypeScript project called
"ai-study-companion". Requirements:

- Tailwind CSS configured
- ESLint + Prettier configured
- Folder structure exactly as follows (create empty placeholder files where needed so the
  structure exists):

app/
  (auth)/login/page.tsx
  (auth)/signup/page.tsx
  (app)/dashboard/page.tsx
  (app)/spaces/[spaceId]/page.tsx
  (app)/projects/[projectId]/page.tsx
  (app)/projects/[projectId]/materials/page.tsx
  (app)/projects/[projectId]/tutor/page.tsx
  (app)/projects/[projectId]/quiz/page.tsx
  (app)/projects/[projectId]/mastery/page.tsx
  (app)/projects/[projectId]/growth/page.tsx
  (app)/projects/[projectId]/analytics/page.tsx
  (app)/admin/dashboard/page.tsx
  api/
components/
lib/auth/ lib/db/ lib/ai/ lib/rag/ lib/storage/ lib/jobs/ lib/analytics/ lib/security/
services/
ai/
db/schema/ db/queries/
types/
docs/

- Add a .env.example with these keys (no values):
  DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY, INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY
- Add a README.md with project name, one-line description, and a "Setup" section listing
  install steps (to be filled in as we go).
- Do not add any backend logic yet — this phase is scaffolding only.

Acceptance check: `npm run dev` boots with no errors and each route above renders an
empty placeholder page.

After acceptance checks pass, run `/compact` before starting the next phase.

# Purpose

Create the repository foundation required by every later phase while keeping this phase
limited to scaffolding and configuration.

# Result

The repository now has a working Next.js 14 App Router project with TypeScript, Tailwind
CSS, ESLint, Prettier, the required directory tree, all required placeholder routes, an
environment example, and a setup README.

The development server started successfully and every required route returned HTTP 200:

- `/login`
- `/signup`
- `/dashboard`
- `/spaces/test-space`
- `/projects/test-project`
- `/projects/test-project/materials`
- `/projects/test-project/tutor`
- `/projects/test-project/quiz`
- `/projects/test-project/mastery`
- `/projects/test-project/growth`
- `/projects/test-project/analytics`
- `/admin/dashboard`

`npm run typecheck`, `npm run lint`, and `npm run build` also passed.

# Changes Made

- Added the Next.js/React package configuration and npm scripts.
- Added TypeScript, ESLint, Prettier, Tailwind CSS, PostCSS, and Autoprefixer configuration.
- Added the root layout and global stylesheet.
- Added all phase 02 route placeholder files.
- Created the required `components`, `lib/*`, `services`, `ai`, `db/schema`, `db/queries`,
  `types`, and `app/api` directories.
- Added `.env.example`, `.gitignore`, and the initial README setup instructions.
- Installed dependencies and generated `package-lock.json`.

# Notes

- The repository was empty apart from the instruction documents, so this was a clean
  scaffold.
- Next.js was pinned to `14.2.35`, the latest published Next 14 release available in the
  package registry. `npm audit` still reports advisories whose published fixes require a
  newer Next major version; no major-version upgrade was made because phase 02 explicitly
  requires Next.js 14.
- Tailwind reports that no utility classes were detected because all phase 02 pages are
  intentionally empty placeholders.

# Compact

Ran `/compact` at end of phase to summarize session state before next phase.
