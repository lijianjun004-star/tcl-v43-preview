-- R25 only: PG Storage API private media. Apply AFTER schema.sql / api.sql
-- define public.r25wf_can_read_media(text), and before enabling media UI.
-- No cloud command is executed by this file's author.
-- Existing bucket rows and existing policy definitions are never modified.
-- New restrictive guards are true for every bucket other than r25wf-private.
-- Rollback: remove ONLY the r25wf_* policies introduced here; do not delete
-- objects or bucket metadata while submissions reference them.
BEGIN;

DO $r25wf_media_prerequisites$
BEGIN
  IF to_regprocedure('public.r25wf_can_read_media(text)') IS NULL THEN
    RAISE EXCEPTION 'Apply R25 schema/API first: r25wf_can_read_media(text) missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='storage' AND c.relname='objects' AND c.relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='storage' AND c.relname='buckets' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'PG storage objects/buckets RLS must already be enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id='r25wf-private') THEN
    RAISE EXCEPTION 'r25wf-private already exists: review existing row/policies; do not overwrite';
  END IF;
END
$r25wf_media_prerequisites$;

-- Bucket size is provider-enforced. MIME is a stored Content-Type claim, not
-- proof that the file contents are decodable or safe. Media API rechecks actual
-- storage.objects metadata and rejects more than 3 media references/submission.
INSERT INTO storage.buckets
  (id,name,public,file_size_limit,allowed_mime_types)
VALUES
  ('r25wf-private','r25wf-private',false,52428800,
   ARRAY['audio/webm','video/webm','audio/mp4','video/mp4',
         'audio/ogg','video/ogg','audio/wav','audio/x-wav',
         'audio/mpeg','audio/aac','audio/x-m4a','video/quicktime']);

-- anon: deny all new-bucket metadata/object access, even if legacy permissive
-- policies allow the entire storage table. Non-target buckets remain unchanged.
CREATE POLICY r25wf_bucket_anon_guard ON storage.buckets
AS RESTRICTIVE FOR ALL TO anon
USING (id <> 'r25wf-private')
WITH CHECK (id <> 'r25wf-private');

CREATE POLICY r25wf_object_anon_guard ON storage.objects
AS RESTRICTIVE FOR ALL TO anon
USING (bucket_id <> 'r25wf-private')
WITH CHECK (bucket_id <> 'r25wf-private');

-- Metadata can be read by authenticated clients so Storage API can resolve the
-- known bucket. No authenticated client may create/rename/reconfigure/delete it.
CREATE POLICY r25wf_bucket_authenticated_read ON storage.buckets
FOR SELECT TO authenticated
USING (id = 'r25wf-private' AND auth.role()='authenticated');

CREATE POLICY r25wf_bucket_insert_guard ON storage.buckets
AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (id <> 'r25wf-private');

CREATE POLICY r25wf_bucket_update_guard ON storage.buckets
AS RESTRICTIVE FOR UPDATE TO authenticated
USING (id <> 'r25wf-private')
WITH CHECK (id <> 'r25wf-private');

CREATE POLICY r25wf_bucket_delete_guard ON storage.buckets
AS RESTRICTIVE FOR DELETE TO authenticated
USING (id <> 'r25wf-private');

-- INSERT is the only client write. Storage API injects owner_id and actual
-- metadata; path first segment must be current user. The business helper must
-- return true for active, invitation-bound owners even before object creation.
-- No JSON size cast can run on an invalid numeric string (CASE, not AND order).
CREATE POLICY r25wf_object_insert_guard ON storage.objects
AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (
  bucket_id <> 'r25wf-private' OR (
    bucket_id='r25wf-private'
    AND auth.role()='authenticated'
    AND auth.uid() IS NOT NULL AND auth.uid() <> ''
    AND owner_id=auth.uid()
    AND path_tokens[1]=auth.uid()
    AND public.r25wf_can_read_media(name)
    AND CASE
      WHEN metadata->>'size' ~ '^[0-9]{1,8}$'
      THEN (metadata->>'size')::bigint BETWEEN 1 AND 52428800
      ELSE false
    END
    AND split_part(lower(metadata->>'mimetype'),';',1) = ANY(
      ARRAY['audio/webm','video/webm','audio/mp4','video/mp4',
            'audio/ogg','video/ogg','audio/wav','audio/x-wav',
            'audio/mpeg','audio/aac','audio/x-m4a','video/quicktime'])
  )
);

CREATE POLICY r25wf_object_insert_allow ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='r25wf-private'
  AND auth.role()='authenticated'
  AND owner_id=auth.uid() AND path_tokens[1]=auth.uid()
  AND public.r25wf_can_read_media(name)
);

-- Read helper is SECURITY DEFINER with locked search_path, uses auth.uid(),
-- rejects anon/unbound/inactive users, and allows only owner or a trusted
-- immutable submission's assignment operator/admin. Never accept event.uid,
-- metadata.role or client-provided assignment membership as authority.
CREATE POLICY r25wf_object_select_guard ON storage.objects
AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  bucket_id <> 'r25wf-private' OR (
    bucket_id='r25wf-private'
    AND auth.role()='authenticated'
    AND public.r25wf_can_read_media(name)
  )
);

CREATE POLICY r25wf_object_select_allow ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id='r25wf-private'
  AND auth.role()='authenticated'
  AND public.r25wf_can_read_media(name)
);

-- Immutable objects. Even if an old permissive UPDATE/DELETE policy is broad,
-- it cannot authorize changes to new R25 media. Administrative cleanup, if ever
-- implemented, must use Storage API under reviewed server-side authority.
CREATE POLICY r25wf_object_update_guard ON storage.objects
AS RESTRICTIVE FOR UPDATE TO authenticated
USING (bucket_id <> 'r25wf-private')
WITH CHECK (bucket_id <> 'r25wf-private');

CREATE POLICY r25wf_object_delete_guard ON storage.objects
AS RESTRICTIVE FOR DELETE TO authenticated
USING (bucket_id <> 'r25wf-private');

REVOKE ALL ON FUNCTION public.r25wf_can_read_media(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.r25wf_can_read_media(text) TO authenticated;

COMMIT;

-- Post-apply READ-ONLY inventory (root records before/after policy definitions):
-- SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
-- FROM pg_policies WHERE schemaname='storage' ORDER BY tablename,policyname;
-- SELECT id,public,file_size_limit,allowed_mime_types
-- FROM storage.buckets WHERE id='r25wf-private';
