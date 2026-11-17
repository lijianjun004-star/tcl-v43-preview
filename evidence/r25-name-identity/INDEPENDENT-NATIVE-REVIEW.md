# Independent native identity boundary review

Scope: local source review, public official SDK models/source, focused local mocks, and safe-field inspection of the root-supplied Event read-only probe. This reviewer did not create cloud accounts, modify policies, deploy functions or send cloud writes.

Reviewed final source at this checkpoint:

- `001-name-identity.sql`: SHA256 `0cea86c37538ee6212dad529434b207a8768f24139b8773ecac063c737f1ad4c`
- `handler.cjs`: SHA256 `b5bee8e6fbf7cf4c06ccd85f29312160e11d751161d07219d8c3d6432b83d39a`
- `provider-cloudbase.cjs`: SHA256 `5dd3a1054245b0e75d282f0a0d3fe44b3523af4af6cb7bf876f9a08f0187c78c`

## Findings and repairs

1. Initial handler accepted two-category passwords while the actual pinned manager SDK rejected them before CAPI. This would reserve an invite then fail native creation. Handler and provider now check the native8–32, first-alphanumeric, minimum3-category policy before reservation/credential access. Existing native password login does not use this new-account validator.
2. Initial reserve/finalize did not share a global name namespace with old `r25wf_api` invitation redemption. The repaired migration adds a profile-write trigger with the same normalized name advisory lock, rejecting new collisions without rewriting pre-existing duplicate profiles. Reserve uses invite→name lock order. Finalize claims only its verified UID inside the transaction before the profile guard, and rolls the claim/profile/alias/invite together back on failure. Native identity writes also have a namespace guard.
3. Initial resolve preferred casefold aliases over exact old native login names. A case-variant alias could hide an existing native account without changing its UID. A focused local run reproduced this: the old native account was never queried and the new alias UID was returned. Repaired handler checks exact ASCII native names first and validates `resolveLegacy`; SQL reserves normalized native-username keys. The same local handler scenario now returns the old UID.

No further blocking static finding in the reviewed boundary: client extra role/UID fields are rejected; native UID comes only from official CreateUser or exact-name/marker lookup; existing ready UID cannot change; finalization refuses already-owned business UID/native mappings; issuer/role invitation checks are repeated; tables have RLS and browser privileges revoked; the service function grants EXECUTE only to service_role. No plaintext password/raw operationSecret/raw inviteCode enters the administrative PG payload. SQL arguments are base64 data literals, never interpolated names or raw SQL supplied by the client. Raw SDK error objects are replaced with safe code/requestId.

The reservation is durable and intentionally has no automatic lease expiry/release. Do not claim an automatic lease-recovery mechanism. Recovery requires the original operation proof, fixed native username and exact server Description marker. No existing password is reset.

## Validation and runtime limits

Local provider tests passed8 focused cases, plus5 invalid-new-password cases rejected before credential/SDK access,2 business-name/native-nickname boundary cases, and the repaired legacy exact-username precedence scenario. These are separate local checks, not a combined native cloud pass count. Provider omits unsupported one-codepoint or >64-codeunit native nicknames while preserving the actual40-codepoint PG display name.

Root's actual Event probe evidence `/workspace/r25-name-provider-probe-invoke-result.json` shows all three temporary credential-presence booleans true, DescribeUserList no-match count0 and PG SELECT outcome ok with columns `ok,role`. This was the initial probe revision; it did not execute the later stricter returned-row parser. It explicitly reports nativeCreatePermission NOT_TESTED_READONLY, so these reads do not establish CreateUser write permission.

Official public CreateUser model and manager source allow native Name length1–64 and the generated `r25n_`+24hex name has29 characters. No24-character limit was found for this specific API. Real create + official Auth login of that29-character name, actual Description recovery, invite/native-create ordering, concurrency, and old data retention still require root's real E2E evidence before runtime acceptance. Dynamic results are maintained separately; this report does not substitute mocks or model agreement for them.
