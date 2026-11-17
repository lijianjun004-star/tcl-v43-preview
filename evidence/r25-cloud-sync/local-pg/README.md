# Local PostgreSQL checks — localPGmock-auth

This directory runs PostgreSQL 18.6 through PGlite 0.5.16 in this workspace. It does not contact CloudBase, read cloud credentials, deploy SQL, or test the actual native login/storage transport.

`bootstrap.mjs` creates mock `auth.uid()` / `auth.role()` backed by request settings and mock provider `storage.objects` / `storage.buckets` tables. SQL runs with actual PostgreSQL roles (`anon`, `authenticated`), SECURITY DEFINER semantics and RLS. The mock grants broad legacy storage policies so the separately supplied restrictive new-bucket policies can be tested without hiding interactions.

Run `node workflow-test.mjs` after `/workspace/tcl-r25-cloud/backend/r25-cloudbase/schema.sql` is ready. `R25_SCHEMA=/absolute/path/schema.sql` can select another reviewed schema. It writes `workflow-result.json` with the exact input hash and all completed assertions; a failed assertion exits 1 and remains in the report.

These checks do not establish native CloudBase schema compatibility, production auth claims, service-role behavior, signed URL revocation, physical device behavior, real media content validation, cloud persistence, or cross-device delivery.
