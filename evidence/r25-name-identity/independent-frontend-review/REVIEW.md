# Independent name frontend review

Scope: read-only new `name-identity.mjs`, name-related workflow/workspace diffs and preservation of app checkpoint/UID partition gates. No cloud calls, product changes, commits or deployments.

## Reproduced P2: native UID can drift while `me` is in flight

`acceptSession` captures native UID A and sends expectedActorUid A, but the native session can become B after that request is sent and before A's valid `me` response returns. No native UID check follows `me` before `setIdentity(A)`. During this controlled native-auth chain, `onNativeAuthEvent` also skips events because nativeMutationDepth is nonzero.

The local deterministic probe `post-me-drift.mjs` returned success with nativeUid B, workflowUid A and identity callback A. `post-me-drift-result.json` contains the frozen hashes. The application's unchanged `onIdentityChange` loads local history by that UID and may render the old identity's partition. The next business call would detect native drift, but that occurs after identity installation.

Suggested correction: verify native UID immediately after me and again after async identity application, reject and clear a drifted identity, and ensure a native event that definitively differs from an already installed user invalidates the in-progress local partition callback. Preserve expectedActorUid and all epoch checks.

## Other inspected boundaries

- Reservation is generated with crypto UUID and 32 random bytes before HTTP, stored in an independent environment-keyed IDB. Reserve uses one readwrite transaction, preserving the same operation/secret across concurrent callers.
- Stored objects contain name/operation/secret and optional ready uid/username; no password or raw invitation.
- Lost reply continues status using the stored operation; NOT_FOUND continues register with the same operation. Ready recovery does not call password-reset.
- Browser daily password login still calls the official SDK, not the business RPC. Broker/native UID checks are present before profile acceptance.
- Duplicate registration errors do not reach official signIn or business profile installation.
- UI has no new role selector in joining; operator invitations offer only anchor and administrator invitations anchor/operator. Backend remains authority.
- At the initial review, before the race fix, app.js differed only in three login copy changes. The final P2 fix additionally passes an isCurrent guard into local partition switching and checks it after asynchronous DB/checkpoint reads and before rendering. The original checkpoint cursor readiness, partition sequence, CAS protection, UID partition selection, legacy-data read-only export and ASR behavior remain in place.

This is local mock race evidence and static source review. It does not verify the real identity broker, native provisioning, PG roles, cross-device persistence or real mobile hardware.

## Fix recheck

Final stable source: workflow SHA256 `a592b2f79a7e80f1317b036352bdf9033182da0e4d26d5b3b65d0e845a156277`; app SHA256 `7c83ce664b2290be4d0d5326ef63ff7e3ca41f23436d3665e8f63a9ccf49ff1e`. Both remained identical before and after this recheck.

- Original me-in-flight reproduction now rejects STALE_SESSION, leaves workflow identity null and never applies A.
- Actual extracted app partition/checkpoint functions plus actual workflow pass four synthetic callback cases: native drift during DB read and checkpoint read, each with and without an auth event. No A render occurred, final local identity was signed out, A records were absent, and STALE_SESSION was raised.
- Evidence: `post-me-drift-after-result.json`, `identity-callback-after-result.json`, corresponding scripts and logs. Prior result/source snapshots remain intact. An initial fixture mistake is explicitly recorded in `identity-callback-FIXTURE-NOTE.md`.

The reproduced P2 is fixed in this source. No further P1/P2 found within this focused scope. These are local mock execution checks, not real cloud/mobile acceptance.
