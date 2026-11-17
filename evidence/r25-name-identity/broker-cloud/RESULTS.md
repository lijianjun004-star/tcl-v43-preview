# Real name/invitation broker verification

Status: **72/72 executed checks passed**, process exit 0, all browser contexts closed. Overall `PASS_WITH_NOT_RUN` preserves four separate unexecuted server-side checks.

Actual deployed HTTPS broker, official CloudBase JS SDK 3.11.1, native Auth and PostgreSQL RPC were used. No service response, native Auth or PG business call was mocked. This is API/native-Auth acceptance; actual product UI enrollment is a separate run and has not yet executed.

Passed: Chinese-name anchor/operator/outsider creation; 29-character opaque native username accepted by official Auth; independent-context daily name resolution and original-password login; `abc12345` rejected with `INVALID_PASSWORD` before alias/reservation, original invite subsequently usable; absent/wrong invites rejected; untrusted role/UID/username fields rejected; same operation/secret status and replay preserve UID; wrong secret denied; status rejects password; duplicate name cannot change original password; old native username casefold namespace protected; old administrator still logs in with original password and immutable UID before/after; actual task, joining, submission receipt, operator inbox/feedback and outsider access denial; each context retains its own identity.

Not run by this suite:

- Official provider before/after audit proving invalid invitations create no native account.
- Provider audit proving weak-password paths invoke CreateUser zero times.
- Full trusted SQL snapshot comparison of formal business data excluding synthetic test rows.
- Controlled crash between successful native CreateUser and SQL finalize. Successful response replay/status was tested; it does not substitute for that server checkpoint.

Root owns these independent audits and any cleanup. Synthetic test credentials, invitation codes and operation secrets are excluded. `SECRET-SCAN.json` found no supplied password/invite or JWT pattern in evidence. Full recorded checks are in `result.json`; the exact invocation/exit is in `command.json`, build metadata in `adapter-build.json`, and safe output in `run.log`.
