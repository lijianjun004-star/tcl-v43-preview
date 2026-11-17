# R25 workflow RPC contract v1 — frozen 2026-11-17

Backend: existing CloudBase native PostgreSQL and native Auth. No new environment, NoSQL database, cloud function, custom password login or in-memory authoritative state. Business objects use `r25wf_` prefix. Browser uses official `app.rdb().rpc('r25wf_api',{action,payload,operation_id})` after native login. JS adapter may accept `{action,payload,operationId}` and map operationId to operation_id.

Every result is `{ok:true,data:{...}}` or `{ok:false,error:{code,message}}`. Errors use application codes; SQL/PostgREST transport errors remain transport errors. Trusted actor is `auth.uid()::text` and authenticated role. UID is an arbitrary string, including numeric strings; never parse as UUID or accept actor/role from payload. Frontend sends `payload.expectedActorUid` captured before each operation; SQL compares it to trusted auth.uid() and rejects mismatch with STALE_SESSION before any business read/write. This field is an assertion only, never authority, and is stripped before idempotency body comparison. It remains optional for native admin/test integrations; shipped frontend must send it for every RPC, including initial me using the captured native session UID. Initial admin is bound by a private CLI-only bootstrap, never a public first-user action.

`me` for an authenticated native account not yet bound returns `{user:{uid,role:'pending',displayName:'',username:uid,active:true},registered:false}`. Pending users can only call me and invites.redeem/accept; business calls return NOT_REGISTERED. Native password changes/logout stay in official Auth SDK. All writes require a stable operation_id (1–128 ASCII letters/digits/underscore/hyphen/dot/colon). Repeating same actor/action/key/body returns the exact prior committed response; changed body is IDEMPOTENCY_CONFLICT. Mutation `invites.redeem/accept` also requires operation_id. Unbound pending profile.active is true (registered=false distinguishes it from a disabled bound account). Lists are bounded to 100, default 50, with opaque cursor currently representing a server row ID.

## Actions and camelCase payloads

| action | payload | data |
| --- | --- | --- |
| `me` | `{}` | `{user:{uid,role,displayName,username,active},registered:true/false,capabilities:{...}}` |
| `operators.list` | `{}` | `{items:[{uid,id,displayName,username,role}]}` active operators/admin |
| `invites.create` | `{role:'operator'\|'anchor',displayName?,targetUid?,expiresHours?}` | `{invite:{id,code,role,targetUid,displayName,expiresAt}}`; admin may invite operator/anchor, operator only anchor; no admin invite |
| `invites.redeem` or `invites.accept` | `{code,displayName?}` | `{user:{uid,role,displayName,username,active},registered:true}`; one-time binding of existing native account, cannot replace an existing role |
| `assignments.create` | `{id?,title,boardId,platform,deadline?}` | `{assignment}`; operator/admin; own UID is server-set |
| `assignments.list` | `{limit?,cursor?,query?}` | `{items:[assignment],nextCursor:null\|id}`; operator own, admin all, anchor joined only; to discover/join use joinCode |
| `assignments.join` | `{joinCode}` (or `{assignmentId}` only if already joined) | `{join:{assignmentId,anchorUid,joinedAt},assignment}`; native anchor, late first join rejected; repeat existing join succeeds |
| `assignments.progress` | `{assignmentId}` | `{assignment,items:[{anchorUid,displayName,joinedAt,trainingCount,submissionCount,lastTrainedAt}]}`; owning operator/admin, no private answers |
| `training.record` | `{id,assignmentId?,boardId,platform,durationSeconds?}` | `{training:{id,anchorUid,assignmentId,boardId,platform,durationSeconds,finishedAt}}`; metadata only, own anchor; same id immutable |
| `training.list` | `{limit?,cursor?}` | `{items:[training],nextCursor}`; own anchor/admin, operator gets only assignment progress |
| `submissions.create` | `{id,assignmentId?,operatorId?,sessionId?,snapshot,media?:[]}` | `{receiptId:id,submission}`; own anchor, must have joined assignment; assignment locks receiver; free practice requires active operatorId |
| `submissions.list` | `{limit?,cursor?,assignmentId?}` | `{items:[submission],nextCursor}`; own anchor/receiving operator/admin |
| `submissions.get` | `{id}` or `{submissionId}` | `{submission}` same ACL |
| `feedback.create` | `{id?,submissionId,body}` | `{feedback}`; receiving operator/admin only; append-only |
| `feedback.list` | `{submissionId}` | `{items:[feedback]}`; same submission ACL |

Assignment shape: `{id,operatorUid,operatorId,operatorName,title,boardId,platform,joinCode,deadline,createdAt}`. joinCode is 12 hex characters; deadline/createdAt are server-formatted UTC timestamps. Recipient aliases operatorUid/operatorId carry the same stable native UID. Names are display only.

Submission lists return summaries with snapshot:null; use submissions.get to fetch the complete snapshot.

Submission shape: `{id,assignmentId,operatorUid,operatorId,operatorName,anchorUid,anchorName,sessionId,snapshot,media,submittedAt,late}`. A free-practice submission has null assignmentId. ReceiptId is immutable submission id. Snapshot must be an object with 1–200 turns; it preserves supplied question/model/SKU/answer/source metadata subject to bounds. Server does not manufacture official AI grades. Submission/media content is immutable. Server calculates submittedAt and deadline late status. Client time/name/actor fields do not grant authority.

Feedback shape: `{id,submissionId,operatorUid,operatorName,body,createdAt}`. Body is plain text, 1–5000 characters. Frontend must escape all user content when using HTML.

## Limits, private attachments, errors

Payload JSON up to 512 KiB; snapshot up to 384 KiB; each turn up to 32 KiB; 200 turns; total answers bounded by those limits; title 120, boardId 40, platform 80, IDs 128, displayName 60. No silent truncation. Deadline is ISO timestamp, now determined by database clock. Rows and mutation replies are persistent PostgreSQL transactions, not JS memory. Direct business tables have RLS default-deny; only authenticated users may execute the single RPC.

Private media capability is activated only after the separate `media-storage.sql` policies and real upload/download tests pass. Bucket is `r25wf-private`; at most 3 attachments, each at most 50 MiB; allowed MP4/WebM and WAV/MPEG/OGG audio MIME values. Payload item `{path,mime,size,sha256?}`: path starts with the current UID plus `/`, upload uses immutable random path and `upsert:false`. Submission RPC verifies the actual storage object, owner/path, metadata size/MIME and unique attachment binding. sha256 is a client declaration, not a server-computed integrity proof. Missing/unuploaded/foreign objects fail the whole submission; no placeholder may be treated as ready or delivered. Until capability is true, nonempty media is rejected MEDIA_NOT_AVAILABLE and frontend must explicitly ask whether to submit text only. Private object URLs must not be displayed as public URLs; use authenticated SDK download or short-lived signed playback with its bearer-link limitation stated.

Important codes: AUTH_REQUIRED, NOT_REGISTERED, ACCOUNT_DISABLED, FORBIDDEN, INVALID_PAYLOAD, FIELD_TOO_LONG, LIMIT_EXCEEDED, OPERATION_ID_REQUIRED, IDEMPOTENCY_CONFLICT, NOT_FOUND, ASSIGNMENT_CLOSED, NOT_JOINED, INVALID_INVITE, ALREADY_REGISTERED, INVITE_EXPIRED, CONFLICT, MEDIA_NOT_AVAILABLE, MEDIA_INVALID, MEDIA_ALREADY_ATTACHED, INTERNAL_ERROR. Responses do not expose raw SQL errors, password/session secrets or private content belonging to another actor. Invitation redemption and creation are rate-limited persistently by actor.

## Persistence/ACL invariants

Users `r25wf_users(uid text PK,role text,display_name text,active boolean)`; assignments `r25wf_assignments(id text PK,operator_uid text,...)`; joins `r25wf_joins(assignment_id,anchor_uid)`; submissions `r25wf_submissions(id text PK,assignment_id text nullable,operator_uid text,anchor_uid text,session_id text,snapshot jsonb,media jsonb,submitted_at timestamptz,late bool)`; feedback `r25wf_feedback(submission_id,operator_uid,body,...)`.

Private media helper: `public.r25wf_can_read_media(path text) returns boolean` uses the trusted current Auth UID, requires bound active user, allows uploader or a reader of its immutable submission. RLS helper is called by bucket policy and denies anonymous/other users. Object paths are unique across all submissions. Storage object mutation is separate from business transaction, but failed/missing upload never creates a successful receipt. Native storage policies must prevent client overwrite/delete after upload.

Both devices must authenticate separately. Server receipt plus another device querying that submission is delivery evidence. Local outbox state alone is not. Preserve local R25 recording/checkpoint paths and existing old sites. No automatic upload of legacy demo records or unsubmitted recordings.
