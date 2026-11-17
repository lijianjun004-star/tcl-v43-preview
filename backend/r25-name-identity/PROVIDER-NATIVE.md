# Native identity provider: implementation and probe history

Current outcome (2026-11-17): the production Event handler is deployed. Actual public broker + official Native Auth + PG checks passed 72/72, and actual local product UI passed 26/26. See [final backend verification](../../evidence/r25-name-identity/BACKEND-VERIFICATION.md). The read-only preparation checkpoints below remain historical evidence, not the current release gate.

Scope: existing domestic environment `unknown-roadrunner-d7cap6e21f517`, region `ap-shanghai`. No cloud request, account creation, role creation or deployment was performed by this preparation task. No CLI credentials were read or copied into function configuration.

Files:

- `provider-cloudbase.cjs`: `createProvider({envId,region})` returns `dbCall`, `createNativeUser`, `findNativeUser`, `probeReadOnly`.
- `readonly-probe.cjs`: dual Event and HTTP implementation, no request-body reads, no writes.
- `provider-probe-entry.js`: Event runtime handler **`provider-probe-entry.main`**. The `.js` shim avoids implicit `.cjs` resolution assumptions.

Use dependency **`@cloudbase/manager-node@5.10.4`**, Nodejs20.19. Instantiate `new Manager({envId,region,secretId,secretKey,token})`; token is the platform's STS session token. Provider reads `TENCENTCLOUD_SECRETID`, `TENCENTCLOUD_SECRETKEY`, `TENCENTCLOUD_SESSIONTOKEN` inside each call, not module initialization. All three are required. No permanent key, management API token, developer login file or client-supplied credential/header fallback is allowed.

## Exact official admin APIs

```js
const manager = new Manager({envId,region,secretId,secretKey,token});
const created = await manager.user.createUser({
  name: 'r25n_<24 hex>', type: 'externalUser', userStatus: 'ACTIVE',
  password, nickName: displayName, description: marker,
}); // cloud API CreateUser, result.Data.Uid

const list = await manager.user.describeUserList({
  name: username, pageNo: 1, pageSize: 100,
}); // cloud API DescribeUserList, NOT DescribeUsers
// list.Data.UserList: {Uid,Name,Type,UserStatus,NickName,Description,...}
// Name is FUZZY: require an exact Name match and verify type/status/marker.

const sql = await manager.database.executePGSql({
  Sql: 'SELECT 1 AS ok,current_user AS role', Role: 'service_role',
}); // cloud API ExecutePGSql, result.Rows are JSON strings for column arrays
```

`CreateUser` defaults to internalUser if Type omitted: provider always forces externalUser. Native username is ASCII 1–64; new names only use server-derived `r25n_` plus24hex. Read-only legacy lookup accepts existing ASCII names and never renames, resets or overwrites them. Display names remain PG aliases. Native NickName requires2–64, so a one-character display name is omitted from native nickname rather than falsified; PG still stores the actual display name. Native password rules are8–32 characters, first character letter/digit, at least3 categories among lower/upper/digit/allowed special characters. Native errors are sanitized into code/requestId only; no raw error/request/payload is propagated.

Description is returned by official `DescribeUserList`. Recovery requires exact server marker `r25wf-name-v1:<reservation UUID>`; username existence alone is not ownership proof. Missing Description, mismatched marker or account type cannot be silently claimed. Lookup is bounded to5 pages and exact matching; it fails closed on unknown response shape/unsafe numeric UID precision.

`dbCall` calls only `public.r25wf_name_identity_service(action,payload)` with `Role:service_role`. Dynamic action and JSON are UTF8→base64 data literals decoded inside SQL, not unescaped SQL syntax. It forbids password/raw operationSecret/raw inviteCode fields recursively. Handler passes operationProof/inviteHash, never raw secrets, and the SQL ACL grants execution only to service_role. Provider never edits `auth.users` or exposes a password-reset/update/delete-user method.

## Runtime identity and deployment gate

CloudBase's HTTP/Web resource integration page says HTTP functions do not automatically inject the secret pair; native SCF execution-role documentation says non-image functions with a bound execution role receive temporary credentials. CLI3.9.3's default function Role is `TCB_QcsRole`. These statements do not establish current role permissions or runtime behavior.

Root selected **Event function + CloudBase HTTP access-service route** for this same native provider. Event functions can receive full HTTP request information through the gateway; `--httpFn` is not required for that route. This avoids depending on the conflicting Web-function credential behavior. Use one isolated function and one isolated service path; do not change global gateway/auth policy.

Root has now actually deployed/invoked Event function `r25wf_name_identity` on Nodejs20.19 and supplied `/workspace/r25-name-provider-probe-invoke-result.json`. Independent safe-field inspection found all three credential-presence booleans true, nativeLookup.ok=true/matchedCount0 and pgSelect.ok=true/columns `ok,role`. It was the initial probe revision, so do not claim the later stricter returned-row check was executed. Native CreateUser write permission remains explicitly NOT_TESTED_READONLY at this checkpoint. This proves this Event runtime has temporary credentials and the two read capabilities; it does not establish the conflicting Web/HTTP runtime behavior.

Root deployment sequence (this document does not execute it):

1. Prepare a small Event function package with the three provider/probe files and pinned manager dependency; handler `provider-probe-entry.main`, runtime Nodejs20.19. Use the ordinary Event deployment, **without `--httpFn`**. Root chooses the exact new function name and approved resource settings.
2. CLI invoke the probe. It returns only credential-presence booleans, `DescribeUserList` no-match request outcome and `ExecutePGSql SELECT1 AS service_role` outcome/requestId. Neither user lists nor credentials/SQL row bodies are returned.
3. Confirm attached runtime role privileges if either read operation is denied. Do not copy developer credentials or add permanent keys as a fallback.
4. Only after successful native read probes, root creates the isolated HTTP access-service route with current `tcb service create`/auth help. Read the actual returned URL; do not guess the gateway hostname.
5. Verify GET through that URL returns the same safe probe. Provider explicitly reports `nativeCreatePermission: NOT_TESTED_READONLY`; read permission does not prove CreateUser permission. Root can then authorize one scoped synthetic registration test of the actual invite handler.

The probe has an optional HTTP bootstrap on PORT or9000 for comparison but Event+service routing is the selected path. Event GET produces a standard `{statusCode,headers,body,isBase64Encoded:false}` response; CLI invoke with empty event returns the JSON object. Other HTTP methods return405. No function deployment, service creation, role/policy modification or native account write occurs in the probe.

## Local validation

`/workspace/r25-name-provider-tools/test-provider.cjs` passed8 focused mock checks: Create external account/marker, fuzzy lookup exclusion/Description, legacy ASCII lookup, quoted/Unicode SQL data encoding roundtrip, PG result envelope, secrets excluded from PG, permanent/missing-token credentials rejected, raw SDK errors stripped. Node syntax checks passed. These are local mocks, **cloudRequests0**, not native/cloud acceptance.

Official sources:

- https://docs.cloudbase.net/service/access-cloud-function
- https://docs.cloudbase.net/cloud-function/resource-integration/cloudbase
- https://cloud.tencent.com/document/product/583/47933
- https://docs.cloudbase.net/cli-v1/functions/deploy
- Public npm `@cloudbase/manager-node@5.10.4`: `types/user/types.d.ts`, `lib/user/index.js`, `lib/database/index.js`, `types/context.d.ts`.
- Public npm `tencentcloud-sdk-nodejs-tcb@4.1.344`: API2018-06-08 models for CreateUser/DescribeUserList/ExecutePGSql.
- Local CLI3.9.3 `fn deploy --help` and public bundled default-role implementation.
