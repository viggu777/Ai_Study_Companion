# AI Study Companion — Architecture Documentation

> **Full Stack AI Engineer Intern — Project Submission**
> AI-Powered Learning & Growth Workspace (PRD v3.0, Candidate Challenge Edition)
>
> | | |
> |---|---|
> | **Live deployment** | https://ai-study-companion-three-inky.vercel.app/ |
> | **Stack** | Next.js 14 + TypeScript · Supabase (Postgres + pgvector + Auth + Storage) · Inngest · Mercury `mercury-2.5` · Gemini `gemini-embedding-2` (768-d) |
> | **Version / Date** | v1.0 — 18 September 2026 · Prototype scope (3–4 days) |
> | **Quality gates** | 314 tests / 26 files passing · 18 eval fixtures green · build + lint + typecheck clean |

---

## Contents

1. [Product overview & the closed learning loop](#1-product-overview--the-closed-learning-loop)
2. [Technology choices & justification](#2-technology-choices--justification)
3. [High-level system architecture](#3-high-level-system-architecture)
4. [Request lifecycle (auth → ownership → logic → DB)](#4-request-lifecycle)
5. [Frontend architecture & route map](#5-frontend-architecture--route-map)
6. [API & service layer](#6-api--service-layer)
7. [Database design & entity relationships](#7-database-design--entity-relationships)
8. [Data isolation & security layers](#8-data-isolation--security-layers)
9. [Material processing pipeline](#9-material-processing-pipeline)
10. [RAG retrieval flow](#10-rag-retrieval-flow)
11. [Grounded Tutor (citations, unsupported handling, injection defense)](#11-grounded-tutor)
12. [Adaptive quiz & assessment](#12-adaptive-quiz--assessment)
13. [Mastery, growth & recommendations](#13-mastery-growth--recommendations)
14. [Persistent learning context](#14-persistent-learning-context)
15. [Events & background workflows](#15-events--background-workflows)
16. [AI engineering, observability & evaluation](#16-ai-engineering-observability--evaluation)
17. [Reliability & failure handling](#17-reliability--failure-handling)
18. [Deployment topology & configuration](#18-deployment-topology--configuration)
19. [Testing · Trade-offs · Limitations · Future work](#19-testing--trade-offs--limitations--future-work)

---

## 1. Product overview & the closed learning loop

**AI Study Companion** is a persistent, contextual, measurable learning workspace — deliberately *not* a PDF chatbot. A learner organises study into **Spaces** (broad areas) → **Projects** (focused goals), uploads **Materials** (PDFs + images), learns with a **grounded AI Tutor**, is tested by an **adaptive Quiz** (MCQ + open-ended), and watches **Concept Mastery** evolve into **Growth Analysis** and actionable **Recommendations**. An **Admin Dashboard** gives platform-level visibility into users, learning, AI usage, evaluation and system health.

The defining architectural idea is a **closed evidence loop**: every AI feature either *produces* learning evidence or *acts on* it. Nothing stands alone.

```text
┌──────────────┐   ┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ Create Space │──▶│Create Project│──▶│ Upload Material  │──▶│ Process & Index  │
└──────────────┘   └──────────────┘   └──────────────────┘   └────────┬─────────┘
                                                                     │
┌──────────────────┐   ┌──────────────────┐   ┌─────────────┐   ┌─────▼──────────┐
│ Continue Learning│◀──│ Recommend Next   │◀──│Analyse Growth│◀──│ Learn w/ Tutor │
│  (loop repeats)  │   │ Action           │   │              │   │ (cited answer) │
└────────┬─────────┘   └──────────────────┘   └──────────────┘   └─────┬──────────┘
         │                                            ▲               │
         │        ┌──────────────┐   ┌────────┴──────┐  ┌──────▼───────┐
         └────────│ Update       │◀──│ Evaluate      │◀─│Adaptive Quiz │
                  │ Mastery      │   │ (grade answers)│  │MCQ + open    │
                  └──────────────┘   └────────────────┘  └──────────────┘

         ╰── every step emits events ──▶ every event can trigger the next workflow ──╯
```

**Design principles:** Context-first (never leak across Projects) · Evidence over guessing ("insufficient evidence" rather than hallucinate) · Persistent-but-relevant context (bounded, not full history) · Asynchronous by design · Observable AI · Controlled AI↔app interaction (validated tools, never raw DB access).

---

## 2. Technology choices & justification

| Layer | Choice (actual, shipped) | Why — engineering judgement |
|---|---|---|
| App framework | Next.js 14 App Router + TypeScript | Full-stack in one repo; thin route handlers + server components; one-command Vercel deploy |
| UI | React + Tailwind (stone/sky theme, shared Sidebar) | No custom design system; project rail = the learning loop made visible |
| Database | Supabase Postgres (single source of truth) | Relational domain (User→Space→Project→…) fits Postgres; one project for DB + Auth + Storage |
| Vector search | pgvector in the same Postgres, `chunks.embedding VECTOR(768)` | No second vector DB to operate; relational + vector predicates in one query; `match_chunks` RPC scoped by `project_id` |
| Auth | Supabase Auth (JWT, sessions, RLS) | No custom auth; middleware guards app routes; service checks + RLS defence-in-depth |
| File storage | Supabase Storage, private `materials` bucket | Same project as DB/Auth; paths scoped `user/project/file`, sanitised filenames |
| Background jobs | Inngest (Cloud) + inline fallback | Event-driven with retries, zero infra; `maxDuration=60` + direct fallback so serverless never strands uploads in QUEUED |
| Chat / structured / eval | Mercury (Inception Labs), `mercury-2.5` via `lib/ai/AIService.ts` | OpenAI-compatible + JSON mode; reasoning-model shaping (token headroom, temp clamp, `reasoning_effort=low`); schema validation on every output |
| Embeddings | Google Gemini `gemini-embedding-2`, 768 dims | Free-tier eligible; Matryoshka-native 768 preserves `VECTOR(768)` column (migration 012); same model+config for docs and queries; key server-only |
| Deployment | Vercel (app) + Supabase (data) + Inngest (jobs) | Zero-ops for a solo 3–4 day prototype; env-separated, secrets never committed |

> **Deliberately not built:** microservices, Kubernetes, a dedicated vector DB, custom auth/queues, multi-provider routing, distributed tracing. Each would cost a day with zero observable payoff at prototype scale. See §19.

---

## 3. High-level system architecture

```text
                              ┌───────────────┐
                              │     USER      │
                              │ (browser)     │
                              └───────┬───────┘
                                      │ HTTPS
                                      ▼
                        ┌─────────────────────────┐
                        │   NEXT.JS 14 APP (TS)   │
                        │  UI pages + thin API    │
                        │  route handlers         │
                        └────┬──────────────┬─────┘
                 synchronous │              │ emits events
                             ▼              ▼
               ┌──────────────────┐  ┌──────────────────┐
               │  SERVICE LAYER   │  │  INNGEST JOBS    │
               │  services/*.ts   │  │  lib/jobs/*.ts   │
               │  ownership +     │  │  material │      │
               │  business logic  │  │  mastery │ recom-│
               └────┬─────────┬───┘  │  mend. │ practice│
                    │         │      └────────┬─────────┘
                    ▼         ▼               │ (served at /api/inngest,
          ┌─────────────┐ ┌───────────────────▼──────────────────┐
          │ AISERVICE   │ │     SUPABASE POSTGRES + PGVECTOR     │
          │ lib/ai/     │ │  relational tables + VECTOR(768)    │
          │ Mercury:    │ │  + RLS policies                     │
          │  chat /     │ └───────────────────┬──────────────────┘
          │  structured │                     │
          │  / eval     │          ┌──────────▼──────────┐
          │ Gemini:     │          │ SUPABASE STORAGE    │
          │  embeddings │          │ private `materials` │
          └─────────────┘          │ bucket (PDFs)       │
                                   └─────────────────────┘

  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  CROSS-CUTTING  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  │ Observability: ai_operations (every AI call)          │
  │ Events: learning_events (activity + analytics + admin)│
  │ Evaluation: 18 fixtures + run history + admin compare │
  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```

Component responsibilities:

```text
┌──────────┐ renders ┌──────────┐ delegates ┌──────────┐
│ FRONTEND │ ──────▶ │API ROUTES│ ─────────▶ │ SERVICES │
│ app/(app)│  JSON   │ app/api/*│  no DB in  │services/ │
└──────────┘         └──────────┘  handlers  └────┬─────┘
                                                  │
                  ┌───────────────┬───────────────┼───────────────┐
                  ▼               ▼               ▼               ▼
           ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐
           │ lib/ai/    │  │ lib/rag/   │  │ lib/db/    │  │ lib/jobs + │
           │ AIService  │  │ retrieve + │  │ typed      │  │ security/  │
           │ prompts    │  │ match_     │  │ queries +  │  │ storage/   │
           │ ai/*.ts    │  │ chunks     │  │ RLS        │  │ auth       │
           └────────────┘  └────────────┘  └────────────┘  └────────────┘
```

---

## 4. Request lifecycle

Every request — synchronous page/API call or background job — passes the same enforcement chain before touching data:

```text
  ┌────────────────┐
  │ 1. AUTHENTICATE│  Supabase session → resolve user_id
  └───────┬────────┘  API routes: requireUserId() throws 401 JSON (never 500/redirect)
          ▼           Pages: getCurrentUser() redirects to /login
  ┌────────────────┐
  │ 2. AUTHORIZE   │  /admin/* → allow-list check (ADMIN_EMAILS / ADMIN_USER_IDS)
  └───────┬────────┘  everything else → must own the resource (step 3)
          ▼
  ┌────────────────┐
  │ 3. OWNERSHIP   │  WHERE id = $1 AND user_id = $2  — never a bare id lookup
  └───────┬────────┘  miss → 404 (no existence leak: caller can't probe others' ids)
          ▼           background jobs carry user_id/project_id in the event payload
  ┌────────────────┐
  │ 4. RATE LIMIT  │  per-user fixed windows → 429 + Retry-After
  └───────┬────────┘  tutor 20/min · quiz-gen 5/min · quiz-submit 60/min
          ▼           flashcards 5/min · subconcepts 10/min
  ┌────────────────┐
  │ 5. BUSINESS    │  service executes logic (may call AIService / retrieval)
  │    LOGIC       │  AI outputs schema-validated before use
  └───────┬────────┘
          ▼
  ┌────────────────┐
  │ 6. DATABASE    │  Postgres (+ pgvector) with RLS user_id = auth.uid()
  └───────┬────────┘  as an INDEPENDENT second enforcement layer
          ▼
  ┌────────────────┐
  │ 7. OBSERVE     │  ai_operations row (AI calls) + learning_events row
  └────────────────┘  (domain actions) — powers analytics + admin
```

---

## 5. Frontend architecture & route map

App Router, server components by default; client components only for interactivity (Tutor chat, quiz taking, forms). One shared `components/Sidebar.tsx` shell (workspace / project / admin sections, mobile drawer).

```text
app/
├── (auth)/ login · signup                        ← public, simple validated forms
├── (app)/  [guarded by middleware → /login]
│   ├── dashboard/                               ← HOME (PRD §16)
│   │     Continue Learning · Recent Projects · Overall Progress
│   │     Areas Requiring Attention · Recommended Next Action
│   │     (services/dashboard.service.ts, per-source try/catch)
│   ├── spaces/ · spaces/[spaceId]/               ← Space detail → project list
│   ├── profile/
│   ├── projects/[projectId]/
│   │   ├── page.tsx                             ← PROJECT HUB (parallel fan-out,
│   │   │                                          per-source catch, never blank)
│   │   ├── materials/ ── upload + QUEUED/PROCESSING/READY/FAILED + Retry
│   │   ├── tutor/ ────── chat + citations + insufficient-evidence styling
│   │   ├── quiz/ ─────── Start → one-question-at-a-time → summary
│   │   ├── practice/ ─── sectioned deep practice + MCQ
│   │   ├── flashcards/ ─ weak-concept flip-card decks
│   │   ├── concepts/ ─── concept list + sub-concept expansion
│   │   ├── mastery/ ─── per-concept % bars + evidence
│   │   ├── growth/ ───── previous vs current + trend badges
│   │   ├── analytics/ ── activity · assessment · mastery · AI
│   │   └── recommendations/ ─ ACTIVE list + COMPLETED/DISMISSED
│   └── admin/  [allow-list gated]
│       ├── dashboard · users · users/[userId] (drill-down) · spaces
│       ├── projects · activity (5 filters) · engagement · learning
│       └── ai-usage · ai-evaluation (run-over-run) · jobs · health
└── api/  (thin handlers — see §6)
```

Project rail (always visible inside a Project — the loop made navigable):

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Project hub                                                          │
│ Materials │ Tutor │ Quiz │ Practice │ Flashcards │ Concepts │ Mastery │
│ Growth │ Analytics │ Recommendations                             │
└──────────────────────────────────────────────────────────────────────┘
```

Every async view implements all five states:

```text
Loading ──▶ Processing ──▶ Ready ──▶ Failed (+ Retry) ──▶ Empty
```

---

## 6. API & service layer

**Rule:** a route handler never talks to the database directly. It resolves the session, calls a service, maps errors. Ownership lives in exactly one place per entity.

```text
  Browser ── fetch ─▶ app/api/.../route.ts ──▶ services/*.ts ──▶ lib/* ──▶ Supabase
                        │ thin:                 │ owns:              │ typed
                        │ session, params,      │ ownership check,   │ queries,
                        │ validation,           │ business logic,    │ storage,
                        │ 401/404/429           │ events, AI calls   │ RLS
                        │ mapping               │                    │
```

| Area | Key files | Responsibility |
|---|---|---|
| Learning CRUD | `project, material, chunk, concept, flashcard services` | Spaces/Projects, upload, chunks, concepts, decks — ownership-scoped |
| AI orchestration | `tutor, quiz, recommendation, practice, misconception, knowledge-graph services` | RAG orchestration, adaptive selection, grading, recommendations |
| Learning science | `mastery.service.ts`, `growth.service.ts` | Deterministic 0.7/0.3 updates; ±5 trend classification |
| Insight | `analytics, dashboard, admin, evaluation services` | Project/global aggregations; Home "what next"; admin drill-downs; eval run comparison |
| Prompts & schemas | `ai/tutor, quiz, assessment, concepts, recommendation, flashcards, practice.ts` | System prompts + JSON schemas + server-side validators per feature |
| Cross-cutting | `lib/auth, lib/db, lib/rag, lib/storage, lib/jobs, lib/security` | Sessions, typed queries, retrieval, uploads, Inngest registration, rate limits |

Key API surface (representative):

```text
POST /api/spaces · GET /api/spaces/[spaceId]/projects · POST .../projects
POST /api/projects/[projectId]/materials (202) · POST /api/materials/[id]/retry
GET+POST /api/projects/[projectId]/tutor (+ /conversations/[id])
GET /api/projects/[projectId]/retrieve?q=... (manual retrieval probe)
POST /api/projects/[projectId]/quiz · POST .../quiz/[quizId]/submit
GET /api/projects/[projectId]/recommendations · PATCH /api/recommendations/[id]
GET /api/chunks/[chunkId] (citation excerpts, ownership-checked)
GET /api/analytics/global · GET /api/projects/[projectId]/analytics
POST /api/inngest (Inngest Cloud → lib/jobs functions)
```

---

## 7. Database design & entity relationships

One Postgres holds relational + vector data (uuid PKs, timestamptz, CASCADE to parents; migrations `001→014` in order via `npm run migrate` or SQL editor).

```text
                        ┌─────────────┐
                        │ auth.users  │  (Supabase Auth owns hashing/expiry)
                        └──────┬──────┘
                               │ 1
                               │ n
                        ┌──────▼──────┐
                        │   spaces    │  id · user_id · name · description
                        └──────┬──────┘
                               │ 1
                               │ n
                  ┌────────────▼────────────┐
                  │        projects         │  id · space_id · user_id
                  │  name · description     │  learning_goal
                  └────────────┬────────────┘
                               │ 1
              ┌────────────────┼────────────────┬───────────────┬──────────────┐
              │ n              │ n              │ n             │ n            │ n
     ┌────────▼────────┐ ┌────▼─────┐ ┌────────▼──────┐ ┌──────▼─────┐ ┌──────▼───────┐
     │   materials     │ │ concepts │ │ conversations │ │  quizzes   │ │recommenda-   │
     │ filename·hash·  │ │ name ·   │ │ summary ·     │ │ status     │ │tions title · │
     │ size·status·    │ │ descript.│ │ pinned        │ │ completed_ │ │action_items· │
     │ page_count·err  │ │ source_  │ └──────┬────────┘ │ at         │ │status        │
     └────────┬────────┘ │ mat_id   │        │ 1       └──────┬───────┘ └──────────────┘
              │ 1        └────┬─────┘        │ n              │ 1
              │ n            │ 1     ┌───────▼───────┐        │ n
     ┌────────▼────────┐     │ n     │   messages    │  ┌─────▼────────┐
     │     chunks      │ ┌───▼───────┴───┐ role·content│  │ questions  │
     │ content·page ·  │ │concept_mastery│ citations   │  │ type MCQ/  │
     │ chunk_idx·      │ │ score·evidence│ └─────────────┘  │ OPEN · diff│
     │ embedding       │ └───────┬───────┘                  │ options·   │
     │ VECTOR(768)     │         │ 1                        │ answer·    │
     └─────────────────┘         │ n                        │ explan.    │
                        ┌────────▼────────┐                 └─────┬──────┘
                        │ mastery_history │                       │ 1
                        │ prev·new·reason │                       │ n
                        │ (growth input)  │                 ┌─────▼────────┐
                        └─────────────────┘                 │   answers    │
                                                            │ response·  │
  practice_assignments ──▶ practice_items                   │ correct·   │
  misconceptions (repeated-mistake tracking)                │ score·eval │
                                                            └────────────┘

  ─ ─ ─ cross-cutting (reference users × spaces × projects) ─ ─ ─
  learning_events (user/space/project · event_type · entity · metadata)
  ai_operations   (feature · model · request_id · latency · success · tokens · cost · error)
```

Physical notes: indexes on all FKs + `learning_events(project_id, created_at)` + hnsw/ivfflat on `chunks.embedding`; unique constraints on `concept_mastery(project,concept,user)` and idempotency keys in `learning_events`; `SET NULL` for quizzed concepts; RLS `user_id = auth.uid()` on all user tables.

---

## 8. Data isolation & security layers

```text
                    ┌─────────────────────────────────────────┐
                    │ LAYER 1 — Service checks (primary)      │
                    │ WHERE id=$1 AND user_id=$2 everywhere   │
                    │ miss → 404 (never 403: no existence     │
                    │ leak, ids can't be probed)              │
                    └───────────────────┬─────────────────────┘
                                        ▼
                    ┌─────────────────────────────────────────┐
                    │ LAYER 2 — Postgres RLS (independent)    │
                    │ user_id = auth.uid() on user tables;    │
                    │ parent-mediated policies for chunks,    │
                    │ concepts, messages, questions           │
                    └───────────────────┬─────────────────────┘
                                        ▼
        ┌───────────────────────────────┼───────────────────────────────┐
        ▼                               ▼                               ▼
┌───────────────┐             ┌───────────────────┐           ┌───────────────────┐
│ Retrieval     │             │ Background jobs   │           │ Storage           │
│ always        │             │ carry user_id +   │           │ private bucket,   │
│ WHERE         │             │ project_id in the │           │ path user/project │
│ project_id    │             │ event payload;    │           │ /file, sanitised  │
│ (+ user own)  │             │ re-check project  │           │ names, UID-prefix │
│ never global  │             │ ownership inside  │           │ policy            │
└───────────────┘             └───────────────────┘           └───────────────────┘
```

Auth error contract: routes use `requireUserId()` → `401 {"error":"Unauthorized"}` (never 500/redirect); pages use `getCurrentUser()` → redirect to `/login`. Writes (e.g. recommendation status) scope both fetch and update by `user_id`.

---

## 9. Material processing pipeline

```text
  ┌──────────┐   validate: pdf/png/jpg/webp · ≤10 MB · non-empty
  │  UPLOAD  │ ─▶ SHA-256 hash ─┬─ duplicate in project? ── YES ──▶ reuse row (200)
  └──────────┘  (sync handler)  │                                        (no 2nd job)
                                │ NO
                                ▼
                    ┌───────────────────────┐
                    │ store private bucket  │  path: user/project/sanitised-file
                    │ materials row QUEUED  │  emit MATERIAL_UPLOADED
                    │ fire Inngest (202)    │  + inline processMaterial fallback
                    └───────────┬───────────┘
                                ▼
                    ┌───────────────────────┐
                    │ CLAIM (atomic)        │  QUEUED/FAILED → PROCESSING
                    │ prevents double-      │  (Inngest + fallback can't
                    │ chunking              │   both process)
                    └───────────┬───────────┘
                                ▼
            ┌───────────────────────────────────┐
            │ EXTRACT (preserve page numbers)   │
            │  image → OCR · normal PDF → parse │
            │  scanned PDF → OCR · <20 chars →  │
            │  FAIL fast (readable error)       │
            └───────────────┬───────────────────┘
                            ▼
            ┌───────────────────────────────────┐
            │ CHUNK (~2400 chars / 320 overlap) │
            │ keep page_number + chunk_index    │
            └───────────────┬───────────────────┘
                            ▼
            ┌───────────────────────────────────┐
            │ EMBED (Gemini, batches of 20)     │
            │ dim-gate 768 · per-call           │
            │ observability row                 │
            └───────────────┬───────────────────┘
                            ▼
            ┌───────────────────────────────────┐
            │ INSERT (batches of 50,            │
            │ stale rows deleted first)         │
            └───────────────┬───────────────────┘
                            ▼
            ┌───────────────────────────────────┐
            │ CONCEPTS (≤8, NON-FATAL)          │
            │ failure → [] (never stuck in      │
            │ PROCESSING), link source_mat_id   │
            └───────────────┬───────────────────┘
                            ▼
              ┌─────────────────────────┐
              │ READY  /  FAILED+error  │  emit MATERIAL_READY / FAILED
              │ Retry reprocesses       │  READY never auto-reprocessed
              │ inline (self-healing)   │
              └─────────────────────────┘
```

Material state machine:

```text
  QUEUED ──▶ PROCESSING ──▶ READY
     │            │
     │            └──────────▶ FAILED ──(Retry)──▶ PROCESSING (inline)
     └────────────────────────▶ FAILED (validation: type/size/empty)
```

---

## 10. RAG retrieval flow

```text
  query string
      │
      ▼
  ┌─────────────────┐
  │ validate project│  project belongs to user_id? else 404
  │ ownership       │
  └────────┬────────┘
           ▼
  ┌─────────────────┐
  │ embed query     │  Gemini gemini-embedding-2 (same model/config as docs)
  │ (10-min cache   │  docs: "title | text" · queries: "task: search result | query"
  │  per normalized │  cache avoids re-embed of repeated questions
  │  query)         │
  └────────┬────────┘
           ▼
  ┌──────────────────────────────┐
  │ pgvector match_chunks        │  filter WHERE project_id (+ user)
  │ (query_vector VECTOR(768))   │  over-fetch ≤100 across materials
  │ fallback: JS-cosine over     │  cap keeps prototype fast + bounded
  │ ≤100 rows (dev path)         │
  └──────────────┬───────────────┘
                 ▼
  ┌──────────────────────────────┐
  │ filter + balance             │  drop similarity < RELEVANCE_THRESHOLD (0.25)
  │ top-K 5, spread across       │  carry filename · page · chunk_id · score
  │ materials (no one-file       │  into the prompt
  │ domination)                  │
  └──────────────┬───────────────┘
                 ▼
        ┌───────────────┐
        │ any chunks    │── NO ──▶ return { insufficient_evidence: true }
        │ above thr.?   │          (typed result — NOT [] — so callers can
        └───────┬───────┘           distinguish "no matches" from "error")
                │ YES
                ▼
        return ranked evidence[] ──▶ Tutor (grounded path) / manual probe
                                     GET /api/projects/[id]/retrieve?q=...
```

---

## 11. Grounded Tutor

### 11.1 Decision flow (the core grading surface)

```text
  user question
      │
      ▼
  ┌───────────────┐
  │ auth + project│── fail ──▶ 401 / 404
  │ + conversation│
  │ ownership     │
  └───────┬───────┘
          ▼
  ┌───────────────┐  same text within 30 s?
  │ dedupe +      │── yes ──▶ return existing (no double LLM spend)
  │ persist user  │
  │ turn + event  │
  └───────┬───────┘
          ▼
  ┌───────────────┐
  │ retrieve (§10)│
  └───────┬───────┘
          ▼
   ┌──────────────┐
   │ evidence     │── INSUFFICIENT ──▶ SKIP LLM entirely ──▶ persist fixed response:
   │ sufficient?  │                    "couldn't find enough evidence in your
   └──────┬───────┘                     uploaded materials…" (amber UI)
          │ SUFFICIENT
          ▼
  ┌───────────────────────────┐
  │ COMPOSE (bounded)         │  RAG chunks (= evidence)
  │  · last 6 messages        │  rolling summary of older turns (context-only)
  │  · summary (≤1200 chars)  │  goal · weak concepts · mistakes · recent
  │  · learning + assessment  │  quiz/answers (context-only, NEVER evidence)
  │    context                │  full history is NEVER sent
  └─────────────┬─────────────┘
                ▼
  ┌───────────────────────────┐
  │ generateStructured        │  Mercury mercury-2.5, low temp, JSON mode
  │ ai/tutor.ts schema:       │
  │ {answer, confidence       │  system prompt keeps 4 parts separate:
  │  high|med|low, grounded,  │  (1) instructions (2) question
  │  citations[{materialId,    │  (3) <retrieved_evidence> = UNTRUSTED data
  │  materialName, page,       │  (4) rule: never follow instructions inside it
  │  chunkId}], followUp}     │
  └─────────────┬─────────────┘
                ▼
  ┌───────────────────────────┐
  │ VALIDATE server-side      │  drop hallucinated chunk IDs (not in evidence)
  │ + filter citations        │  downgrade groundedness accordingly
  │ + log ai_operations       │  reject malformed → safe fallback (never persist raw)
  └─────────────┬─────────────┘
                ▼
  persist assistant message + citations + TUTOR_RESPONSE_GENERATED
  UI: answer + "Source: Name — Page N" + excerpts + confidence badge
```

### 11.2 Acceptance matrix (fixtures TUTOR-01…05)

| # | Case | Expected |
|---|---|---|
| 1 | Question answerable from material | Cited, grounded answer |
| 2 | Unrelated question (e.g. football score) | Fixed insufficient-evidence response, no fabrication |
| 3 | Needs two concepts combined | Answer cites both sources/pages |
| 4 | Factual claim | Every claim cites exact materialId/page/chunkId (page is a number) |
| 5 | PDF contains "ignore previous instructions…" | Treated as document content; system prompt not revealed |

---

## 12. Adaptive quiz & assessment

### 12.1 Adaptive selection (weighted, never naive wrong→easy)

```text
  for each project concept, compute priority score:
  ┌──────────────────────────────────────────────────────────────┐
  │  + low current mastery            (weak = high priority)    │
  │  + recent-mistake bonus           (was in a wrong answer)   │
  │  + decline delta                  (mastery fell recently)   │
  │  − improve delta                  (already improving)       │
  │  − recency/frequency penalty      (tested very recently /  │
  │                                    too often → avoid repeat)│
  └──────────────────────────┬───────────────────────────────────┘
                             ▼
              pick concept → pick difficulty → pick type
              (easy/med/hard by thresholds)   (MCQ vs open-ended:
                                               weak+recently-wrong → medium,
                                               application-style)
```

Generation: Mercury structured `{concept_id, type, difficulty, question, options[4], correct_answer, explanation}` → validate (exactly 4 options, correct ∈ options) → retry once at lower temp → persist `in_progress` → log `QUIZ_GENERATION` → emit `QUIZ_STARTED`. Guards: 2-min duplicate-quiz window (return existing instead of regenerating); **answer gating** (correct/explanation hidden until graded — the only disclosure point is grading that question).

### 12.2 Grading flow

```text
  answer submitted
      │
      ├─ MCQ ──▶ deterministic string compare (NO LLM) ──▶ is_correct
      │
      └─ OPEN ──▶ ai/assessment.ts ──▶ {score 0–100, understanding,
                   strengths[], missingConcepts[], reasoningQuality
                   strong|partial|weak, feedback}
                   validate → failure RAISES (never writes a guess)
                   score ≥ 60 ⇒ correct
      │
      ▼
  persist answers row + QUESTION_ANSWERED
      │
      ▼
  all questions graded? ── NO ──▶ wait for next
      │ YES
      ▼
  quiz completed + QUIZ_COMPLETED (idempotent: re-POST returns
  existing answer; duplicate completion fires no second chain)
      │
      ▼
  UI: per-question correctness/feedback + end-of-quiz summary
```

---

## 13. Mastery, growth & recommendations

```text
  QUIZ_COMPLETED (Inngest step, NOT inline — independently retryable)
      │
      ▼
  ┌─────────────────────────────────────────────┐
  │ MASTERY (deterministic backend math)        │
  │                                             │
  │   evidence per concept = average of its     │
  │   quiz questions (MCQ 0/100, open as-is)    │
  │                                             │
  │   ┌─────────────────────────────────────┐   │
  │   │ new = prev × 0.7 + evidence × 0.3 │   │
  │   │ (clamp 0–100, round; THE LLM NEVER  │   │
  │   │  SETS A NUMBER — it only produced   │   │
  │   │  the evidence)                      │   │
  │   └─────────────────────────────────────┘   │
  │   upsert concept_mastery + mastery_history  │
  │   row (prev, new, reason) + MASTERY_UPDATED │
  └──────────────────────┬──────────────────────┘
                         ▼
  ┌─────────────────────────────────────────────┐
  │ GROWTH (last two history points)            │
  │   delta > +5  →  IMPROVING       (green)    │
  │   delta < −5  →  REQUIRES_ATTENTION (amber) │
  │   else        →  STABLE          (slate)    │
  │   UI: previous vs current + trend badges    │
  └──────────────────────┬──────────────────────┘
                         ▼
  ┌─────────────────────────────────────────────┐
  │ RECOMMENDATIONS (chained workflow)          │
  │   weak = score < 60 OR REQUIRES_ATTENTION   │
  │   nothing weak? → SKIP (by design, no row)  │
  │   else Mercury → {title, action_items[2–5]} │
  │   prompt BANS "keep studying"; validator    │
  │   enforces named concepts/materials         │
  │   persist ACTIVE + event + log → dashboard  │
  │   card + list + COMPLETED/DISMISSED         │
  └─────────────────────────────────────────────┘
```

Beyond baseline (differentiation): Flashcards (weak-concept decks) · Deep Practice (sections + MCQ) · Misconception tracking (repeated-mistake bump/merge) · Knowledge Graph · Sub-concept expansion · conversation pinning.

---

## 14. Persistent learning context

Only *useful* context is stored or sent — never full transcripts. Per Tutor request:

```text
                    ┌─────────────────────────┐
                    │    CURRENT REQUEST      │
                    └────────────┬────────────┘
                                 ▼
              ┌──────────────────────────────────┐
              │ IDENTIFY REQUIRED CONTEXT        │
              └──┬───────┬───────┬───────┬───────┘
                 ▼       ▼       ▼       ▼
        ┌─────────┐ ┌──────┐ ┌───────┐ ┌───────────┐
        │ Project │ │Conv. │ │ Learn │ │ Assess-   │
        │Knowledge│ │6 msgs│ │ goal ·│ │ ment:     │
        │= RAG    │ │+ roll│ │ weak ·│ │ recent    │
        │chunks   │ │ing   │ │ mis-  │ │ quiz/ans  │
        │EVIDENCE │ │summ. │ │ takes │ │           │
        └────┬────┘ └──┬───┘ └───┬───┘ └─────┬─────┘
             └─────────┴────┬────┴───────────┘
                            ▼
                 ┌─────────────────────┐
                 │ COMPOSE AI CONTEXT  │  bounded size no matter how
                 │ (summary is context │  long the user has studied;
                 │ -only: never evi-   │  relevant, never exhaustive
                 │ dence/instructions) │
                 └──────────┬──────────┘
                            ▼
                 ┌─────────────────────┐
                 │ GENERATE RESPONSE   │
                 └─────────────────────┘
```

Summary mechanics: rolling concise summary (≤1200 chars, no sensitive data) persisted on `conversations.summary` (migration 005), refreshed ~every 6 new messages once the thread reaches 8+; best-effort refresh never blocks the answer.

---

## 15. Events & background workflows

One `learning_events` table backs the activity feed, analytics, recommendations and admin. Catalog:

```text
SPACE_CREATED · PROJECT_CREATED
MATERIAL_UPLOADED · MATERIAL_PROCESSING_STARTED · MATERIAL_READY · MATERIAL_FAILED
TUTOR_MESSAGE_SENT · TUTOR_RESPONSE_GENERATED
QUIZ_STARTED · QUESTION_ANSWERED · QUIZ_COMPLETED
MASTERY_UPDATED · RECOMMENDATION_GENERATED · RECOMMENDATION_COMPLETED
(+ practice / misconception events)
```

The three intelligent workflows:

```text
┌─ MATERIAL ─────────────────────────────┐  ┌─ LEARNING ────────────────────────┐
│ Upload → Process → Chunk → Embed →     │  │ Quiz Completed → Evaluate →       │
│ Concepts → READY (/ FAILED + Retry)    │  │ Update Mastery → Detect Weakness  │
└────────────────────────────────────────┘  │ → Insight → Recommend             │
                                             └───────────────────────────────────┘
┌─ REPEATED-MISTAKE ───────────────────────────────────────────────────────────┐
│ Pattern detected (misconception bump/merge over answers.evaluation)          │
│ → Update Learning Context → Targeted Recommendation                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

Idempotency & recovery (retries never duplicate state):

```text
material:  atomic QUEUED/FAILED→PROCESSING claim · SHA-256 dedupe (dup → reuse)
           delete-stale-before-insert · READY never auto-reprocessed ·
           retry route reprocesses inline (heals if Inngest delivery failed)
quiz:      2-min generation guard (return recent empty quiz) ·
           per-question answer idempotency incl. concurrent-race handling ·
           unique constraint where duplication harms (e.g. QUIZ_COMPLETED)
tutor:     30 s duplicate-question dedupe
```

User never needs the browser open — jobs run on Inngest (served at `/api/inngest`) with the inline fallback for serverless gaps.

---

## 16. AI engineering, observability & evaluation

AI is an engineered system: one `AIService` abstraction (chat / structured / embeddings / evaluation / doc-understanding), JSON-mode + per-feature validators, 90 s timeouts, typed fallbacks.

### 16.1 Observability data flow

```text
  every AIService call (success OR failure)
      │
      ▼
  ┌────────────────────────────────────────────────────────┐
  │ ai_operations row:                                     │
  │ feature · model · request_id · latency_ms · success ·  │
  │ tokens_in/out · estimated_cost · error                  │
  │                                                        │
  │ features: TUTOR · CONVERSATION_SUMMARY · EMBEDDING ·   │
  │ QUIZ_GENERATION · OPEN_ENDED_EVALUATION ·              │
  │ CONCEPT_EXTRACTION · RECOMMENDATION ·                  │
  │ FLASHCARD_GENERATION · SUBCONCEPT_GENERATION (+practice)│
  └──────┬───────────────────────────────┬─────────────────┘
         ▼                               ▼
  ┌──────────────┐              ┌──────────────────┐
  │ /admin/      │              │ project + global │
  │ ai-usage     │              │ analytics (AI    │
  │ calls ·      │              │ activity cards)  │
  │ latency ·    │              └──────────────────┘
  │ errors · cost│
  └──────────────┘
  answers: why slow? which model? why poor retrieval?
           which workflow failed? what did it cost?
```

### 16.2 Evaluation pipeline (regression-aware)

```text
  tests/eval/fixtures.ts — 18 FIXED cases (deterministic, offline-scoreable)
  ├── TUTOR (5): grounded · unsupported · multi-concept · citation · injection
  ├── RETRIEVAL: query → expected concept/source → relevance check
  ├── ASSESSMENT: answer → expected characteristics (e.g. "flags missing X")
  └── RECOMMENDATION (2): weak-concept scenario → specificity rubric
        (names a concept? gives a concrete next step?)
      │
      ▼  npm run eval (live attempted, offline scoring kept)
  ┌──────────────────────────────────────────────┐
  │ results.json + tests/eval/history/<runId>    │  runId/suiteVersion stamped
  │ + evaluation-results.json                    │
  └──────────────────────┬───────────────────────┘
                         ▼
  /admin/ai-evaluation: latest vs previous →
    IMPROVED / REGRESSED / UNCHANGED / BASELINE (services/evaluation.service.ts, pure)
```

A prompt, model or retrieval change that regresses behaviour is caught — not silently shipped.

---

## 17. Reliability & failure handling

| Failure | Handling (shipped) | User sees |
|---|---|---|
| AI timeout / provider failure | 90 s timeout; retry once w/ backoff; typed error | Friendly message, never stuck Loading |
| Invalid AI output (schema fail) | Reject + log (`success=false`, `request_id`) + safe fallback | Degraded-but-sane response |
| PDF processing failure | `FAILED` + `processing_error` persisted | Status + Retry button |
| Retrieval returns nothing | Insufficient-evidence path (§10–11), not an error | "Couldn't find enough evidence…" + guidance |
| Unauthenticated | `requireUserId()` → `401 {"error":"Unauthorized"}` | Redirect (pages) / 401 (routes) |
| Not-owned resource | 404, no existence leak | Not-found page |
| Cost spike / abuse | Per-user windows → `429 + Retry-After` | "Try again shortly" |
| Retried operation | Dedupe keys, atomic claims, idempotent writes | No duplicate state, ever |

**Performance (prototype-appropriate):** pgvector top-K + threshold (no app-side full scans); balanced-per-material retrieval; paginated analytics/admin; everything long-running async; embeddings only for real work (10-min query cache, no re-embed of READY material). Streaming Tutor + response caching = documented future work.

---

## 18. Deployment topology & configuration

```text
  ┌──────────────┐   git push   ┌──────────────┐  sync /api/inngest  ┌──────────────┐
  │ PUBLIC REPO  │ ───────────▶ │    VERCEL    │ ──────────────────▶ │   INNGEST    │
  │ (no secrets) │              │ Next.js app  │                     │    CLOUD     │
  └──────────────┘              │ + /api/*     │ ◀────────────────── │    (jobs)    │
                                └──────┬───────┘   job callbacks      └──────────────┘
                                       │ service-role (server only)
                        ┌──────────────┼──────────────┐
                        ▼              ▼              ▼
                 ┌────────────┐ ┌────────────┐ ┌────────────┐   ┌────────────┐
                 │ SUPABASE   │ │ SUPABASE   │ │ SUPABASE   │   │ EXTERNAL   │
                 │ Postgres + │ │ Auth       │ │ Storage    │   │ Mercury +  │
                 │ pgvector   │ │ (JWT/RLS)  │ │ private    │   │ Gemini AI  │
                 │ (migr.     │ │            │ │ materials  │   │ (server    │
                 │  001→014)  │ │            │ │ bucket     │   │  keys only)│
                 └────────────┘ └────────────┘ └────────────┘   └────────────┘
```

Setup: import repo → set env (`.env.example` — names only, never values) → run migrations `001→014` (`npm run migrate` or SQL editor, in order) → ensure private `materials` bucket → sync `/api/inngest` in Inngest Cloud → smoke-test the full loop live.

| Var | Used for |
|---|---|
| `DATABASE_URL` | Direct Postgres (migrations) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + server Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Server/admin paths only — never the browser |
| `MERCURY_API_KEY` / `MERCURY_API_BASE_URL` / `MERCURY_CHAT_MODEL` | Chat/structured/eval (`mercury-2.5` default) |
| `GEMINI_API_KEY` / `GEMINI_EMBEDDING_MODEL` / `GEMINI_EMBEDDING_DIM` | Embeddings (`gemini-embedding-2`, 768 — must match column) |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` / `INNGEST_DEV` | Jobs (`DEV=1` → inline fallback locally) |
| `ADMIN_EMAILS` / `ADMIN_USER_IDS` | Prototype admin allow-list for `/admin/*` |

Production hardening shipped: inline material fallback + `maxDuration=60` (Vercel never strands QUEUED), Gemini 768-d with purge + reindex, retry-always-inline.

---

## 19. Testing · Trade-offs · Limitations · Future work

**Testing (meaningful, not exhaustive)** — `npm test` (vitest, offline): mastery math · ownership/IDOR · tutor insufficient path + citation filtering + summary continuity · quiz gating · rate-limit windows · 401/404 mapping · admin health · eval run-tracking · Gemini formatting + mocked errors · migration ordering · scanned-PDF OCR · dedupe hashing. Plus `npm run eval` (18 fixtures) and `npm run build / lint / typecheck` — all green.

```text
  unit/integration (vitest, 314/26) ──┐
                                      ├──▶ /admin/ai-evaluation (run-over-run compare)
  eval fixtures (tsx, 18 cases) ──────┘         │
                                                ▼
                                     IMPROVED / REGRESSED / UNCHANGED / BASELINE
```

| Trade-off (chosen) | Why | Production path |
|---|---|---|
| Mastery = 0.7/0.3 average; growth = ±5 | Explainable, testable in hours | Difficulty-weighted + forgetting curves + confidence bands |
| Admin = allow-list, no RBAC | Zero-schema authz for prototype | `profiles.is_admin` + policies + audit log |
| Eval = curated fixtures + file history | Real signal without eval-platform build | LLM-as-judge + dataset versioning + CI gates |
| Rate limit = single-instance memory | Cost guard in minutes | Shared store (Redis) for multi-instance |
| No streaming / no cache | Correctness first on the clock | Token streaming + embedding/response cache |

**Known limitations (honest):** token/cost columns exist but provider `usage` isn't threaded into every row (calls/latency/errors complete; cost estimated) · quiz-completed fallback leans on Inngest delivery (inline heal exists for materials) · injection delimiters cover Tutor/practice/concepts, remaining prompts queued · uploads have file-level (not per-user quota) limits.

**Future (schema already supports):**

```text
Learning Path Engine ...... order concepts+mastery into sequences
Mistake Intelligence ...... cluster answers.evaluation → missingConcepts
Concept Graph ............. concept_edges(concept_id, requires_concept_id)
Socratic Tutor Mode ....... second Tutor personality, same evidence block
Spaced Repetition ......... mastery_history.created_at + scores → intervals
Evidence-aware UI ......... mastery.evidence.question_scores → visualised
AI Learning Coach ......... cross-project advisor over events + mastery
```

> **Success criterion — met:** a user completes Space → Project → Material → Knowledge → Tutor (+citation) → Unsupported handling → Adaptive Quiz → Assessment → Mastery → Growth → Analytics → Recommendation → Continue Learning without losing context, while an admin simultaneously inspects users, projects, activity, analytics, AI usage, evaluation and health. Live at the URL at the top of this document.
