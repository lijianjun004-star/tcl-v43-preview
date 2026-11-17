-- Narrow proposal after the original owner's upload returned HTTP403.
-- Root applies only after reviewing the preserved failed run.
-- PG Storage may authorize the pending INSERT before owner_id / metadata are
-- finalized. Do not depend on those final-state columns in INSERT WITH CHECK.
-- Keep provider bucket 50MiB/MIME limits, all SELECT/anon/update/delete guards,
-- and submission finalization's actual object owner/size/MIME verification.
-- Changes ONLY the two policies created by media-storage.sql for the NEW bucket.
BEGIN;
ALTER POLICY r25wf_object_insert_guard ON storage.objects
WITH CHECK (
  bucket_id <> 'r25wf-private' OR (
    bucket_id='r25wf-private'
    AND auth.role()='authenticated'
    AND auth.uid() IS NOT NULL AND auth.uid() <> ''
    AND split_part(name,'/',1)=auth.uid()
    AND length(split_part(name,'/',2))>0
    AND public.r25wf_can_read_media(name)
  )
);

ALTER POLICY r25wf_object_insert_allow ON storage.objects
WITH CHECK (
  bucket_id='r25wf-private'
  AND auth.role()='authenticated'
  AND auth.uid() IS NOT NULL AND auth.uid() <> ''
  AND split_part(name,'/',1)=auth.uid()
  AND length(split_part(name,'/',2))>0
  AND public.r25wf_can_read_media(name)
);
COMMIT;

-- This is a compatibility hypothesis until real owner upload and ACL tests pass.
-- Do not enable private_media from this file.
-- In particular, verify direct PostgREST storage-schema row forgery is rejected.
