-- Phase: storage bucket + policies for material PDFs
-- Run after 001_initial_schema.sql (Supabase SQL Editor).
-- Uploads/downloads go through the service role (see
-- lib/storage/materialStorage.ts), so these policies are defense-in-depth
-- for user-JWT access, not a hard requirement for upload to work.
-- The bucket itself IS required.

-- 1. Private bucket (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('materials', 'materials', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Allow authenticated users to manage only their own prefix:
--    storage path layout is <userId>/<projectId>/<materialId>-<file>
--    so (storage.foldername(name))[1] must equal auth.uid()::text.
DROP POLICY IF EXISTS "materials_user_isolation_insert" ON storage.objects;
CREATE POLICY "materials_user_isolation_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'materials'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "materials_user_isolation_select" ON storage.objects;
CREATE POLICY "materials_user_isolation_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'materials'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "materials_user_isolation_delete" ON storage.objects;
CREATE POLICY "materials_user_isolation_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'materials'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
