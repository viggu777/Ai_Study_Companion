-- 014: guard against duplicate concept names per material.
--
-- Context: processMaterial() used to APPEND up to 8 concept rows on every run
-- (UI Retry, re-upload, embedding-model reindex), so reprocessed materials
-- showed repeated topics on the Concepts page. The service layer is now
-- replace-not-append (unreferenced concepts from a previous run are deleted
-- before fresh inserts, with fuzzy name matching in code), and this unique
-- index is the backstop for exact duplicates.
--
-- IMPORTANT: run the merge script BEFORE applying this migration, or it will
-- fail on existing duplicates:
--   npx tsx scripts/dedupe-concepts.ts --apply
--
-- NULL source_material_id rows (legacy/orphaned concepts) are bucketed under
-- a zero UUID so they are covered too (plain UNIQUE ignores NULLs).
-- Name comparison is case-insensitive + trimmed; fuzzier variants
-- (punctuation, diacritics) are handled in code (lib/concepts/normalize.ts).

CREATE UNIQUE INDEX IF NOT EXISTS uq_concepts_project_material_name
  ON concepts (
    project_id,
    COALESCE(source_material_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(name))
  );
