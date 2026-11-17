# Independent local verification — localPGmock-auth

2026-11-17. PostgreSQL 18.6 / PGlite 0.5.16; synthetic native-auth claims and mock provider storage metadata, actual SQL functions/roles/RLS. No cloud calls, private credentials, product edits or deployments.

## Current verified inputs

- Schema SHA-256: `576c6b7137e0fe89113597773b675b56b01baacd8c62a4b2d4c32b559f8b2f4e`
- Media policies SHA-256: `5b29f8df5c813191241ca834eff94c677b16b3e8ed3d0cec5c2bd36529c51d1f`
- Frontend cloud-workflow SHA-256: `d5475bb228dd367d93f86b18f7a972aa05cc7530752e1bf191d5ed9c1838e8e7`

## Results

- `workflow-result.json`: 58 assertions PASS. Schema apply, pending/auth/role binding, arbitrary-text UID, invitation role restrictions, operation-id replay/conflict, assignment join/receiver ACL, training immutable ID, immutable submitted snapshot metadata, feedback ACL, malformed bounds, private draft isolation, direct table and anonymous bypass rejection. Actual disk database close/reopen retained submission and idempotency reply. Wrong expectedActorUid is rejected before any business row, including me; correct assertions succeed and are stripped from idempotency bodies so earlier requests replay unchanged.
- `media-result.json`: 23 assertions PASS. Real PG RLS with intentionally broad mock legacy policies; owner upload, foreign path/unbound/invalid size/MIME rejected, unsubmitted media hidden from receiver, submitted media visible only to owner/receiver/admin, anonymous access denied, owner update/delete/overwrite blocked, unique object-to-submission binding, actual metadata/request match, same-key replay, disabled user access revoked, non-target legacy bucket behavior retained.
- `frontend-race-fixed-result.json`: 11 assertions PASS against the exact frontend hash above (before/after unchanged). Slow A native login cannot overlap later B; old identity callback cannot ultimately replace B's partition; a native session drift after preflight sends the original actor assertion and the actual local SQL rejects it with zero submission rows and no confirmed outbox receipt. Mock transport honors the actual expectedActorUid contract.

## Failures and repairs retained

Initial SQL failure is retained in `workflow-first-failure.json` and `debug-internal.log`: SQLSTATE42702 (`action` ambiguous) in rate-limit ON CONFLICT. Schema author repaired both clauses. `schema-debug.sql` and `schema-local-probe.sql` are local diagnostic copies; neither was applied to CloudBase. A temporary continuation also exposed a test expectation error (foreign receiver is correctly rejected); the final test separately verifies rejection then submits to the correct assignment owner.

Frontend review reproduced real module races before repair: `frontend-auth-race-before-patch.log` shows local user B, native SDK A, B content sent as A and confirmed in B outbox; `frontend-identity-callback-probe.log` shows user B with late applied partition A; `frontend-auth-drift-probe.log` shows preflight checks alone detect drift only after the synthetic write. Implementation author added native auth serialization, identity/partition sequencing and SQL expectedActorUid assertion. Current regression honors that new server assertion; old repro scripts intentionally assert the old broken schedule and are not current acceptance tests.

## Limits

No actual CloudBase Auth/PostgREST/Storage transport, blob upload/content inspection, signed URL lifecycle, cloud persistence, real simultaneous PG sessions, devices or Chinese mainland networking. These local tests cannot be described as cloud/cross-device acceptance. Parent implementation owner must run the provider checks and real workflow independently. Findings are not a guarantee against all possible interleavings.
