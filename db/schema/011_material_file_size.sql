-- R33: per-user storage quota needs historical byte totals.
-- Materials previously tracked only per-file size in code (10 MB cap).
ALTER TABLE materials ADD COLUMN IF NOT EXISTS file_size BIGINT;
CREATE INDEX IF NOT EXISTS idx_materials_user_size ON materials(user_id);
