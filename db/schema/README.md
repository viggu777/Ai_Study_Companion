# Database Schema Migrations

This directory contains SQL migration files for the AI Study Companion database schema.

## Running Migrations

### Option 1: Supabase Dashboard (Recommended for Prototyping)

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Copy the contents of `001_initial_schema.sql` then `002_retrieve.sql` then `003_storage.sql` then `004_embeddings_384.sql` then `005_conversation_summary.sql` (in order)
4. Paste into a new query and run it

### Option 2: Supabase CLI

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase link --project-ref <your-project-ref>

# Run the migration
supabase db push
```

Or apply a specific migration file:

```bash
supabase migration up --include-all
```

### Option 3: Direct PostgreSQL Connection

```bash
psql "postgresql://postgres:<password>@<host>:5432/postgres" -f 001_initial_schema.sql
psql "postgresql://postgres:<password>@<host>:5432/postgres" -f 002_retrieve.sql
```

## Verification

After running the migration, verify the schema:

```sql
-- List all tables
\dt

-- Check RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';

-- Check policies
SELECT * FROM pg_policies WHERE schemaname = 'public';

-- Check indexes
\di

-- Test RLS isolation (run as authenticated user)
SET ROLE authenticated;
SET request.jwt.claim.sub = '<other-user-id>';
SELECT * FROM spaces; -- Should return 0 rows for other user's data
```

## Notes

- The migration enables the `pgvector` extension for embeddings
- All user-owned tables have RLS enabled with `user_id = auth.uid()` policies
- The `chunks.embedding` column is `VECTOR(384)` (local BAAI/bge-small-en-v1.5 via `embeddings/` Docker service) with an IVFFlat index for cosine similarity search — migrated from 768 (Groq nomic) by `004_embeddings_384.sql`, which also purges incompatible old chunks. Never mix dimensions.
- A unique partial index on `learning_events` prevents duplicate processing of `QUIZ_COMPLETED` and `MATERIAL_READY` events
- Foreign keys use `ON DELETE CASCADE` following the hierarchy: User → Space → Project → child entities