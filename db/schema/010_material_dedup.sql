-- 010: material file-hash dedup (duplicate-upload handling).
-- uploadMaterial() computes SHA-256 of the file bytes and reuses the existing
-- row in the same project instead of creating a duplicate row + duplicate
-- background job. Index keeps the lookup cheap; no UNIQUE constraint so a
-- re-upload after delete, or two different projects with the same file,
-- still works.
ALTER TABLE materials ADD COLUMN IF NOT EXISTS file_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_materials_project_hash
  ON materials (project_id, file_hash)
  WHERE file_hash IS NOT NULL;
