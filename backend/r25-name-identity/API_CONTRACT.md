# R25 姓名 + 密码直接注册契约 v3（安全恢复）

新增主播、运营通过各自入口填写姓名和密码即可注册，不需要邀请码。公开注册身份严格限于 `anchor` / `operator`，不开放 `admin`。管理员既有账号、原生 UID、原用户名和原密码保持不变。密码继续只交官方 Auth CreateUser；本服务不创建自制密码库，也不签发登录会话。

前端配置仍为 `cloudbase.nameIdentity:{enabled:true,endpoint:'https://已部署的身份入口'}`。未部署并验证 v2 时不能显示可用的直接注册。成功统一 `{ok:true,data:{...}}`，失败 `{ok:false,error:{code,message}}`；不回显密码、operationSecret、云密钥或 SQL 错误。

## HTTP POST JSON

| action | 请求 | 成功响应 data |
| --- | --- | --- |
| resolve | `{action:'resolve',name}` | `{state:'ready',username,uid,displayName,legacy?}` |
| register（新） | `{action:'register',name,password,role:'anchor'或'operator',operationId,operationSecret}` | `{state:'ready',username,uid,displayName,role}` |
| status（新） | `{action:'status',operationId,operationSecret,role?,name?}` | 上述 ready，或 `{state:'reserved',requiresPassword:true,role}` |
| register（旧客户端兼容） | `{action:'register',name,password,inviteCode,operationId,operationSecret}`，不得同时含 role | 上述 ready；role 来自原邀请码 |
| status（旧邀请预约） | `{action:'status',operationId,operationSecret,name?,role?}` | 上述 ready / reserved，均含原预约 role |

status 可省略 role，以原 operationId 和 256 位 operationSecret 查询服务端权威角色；提供 role 时必须匹配，否则返回 `REGISTRATION_CONFLICT`，格式非法或 admin 返回 `INVALID_ROLE`。此查询不会更改角色；原生账号已存在时只按原预约角色完成原预约。所有新 register 都必须指定身份，除非是兼容旧邀请格式。直接注册同时提供邀请码会被拒绝。服务不允许把旧邀请预约转换成直接预约，也不允许同一 operationId 改名、改角色或由公开请求更换 operationSecret。仅下方受信任管理恢复可轮换丢失的预约凭据。

客户端收到 ready 后，用仅留内存的密码调用官方 `signInWithPassword({username,password})`，再调用业务 `me` 核对 UID、角色和 active 状态。服务响应不是登录 session。原生账号已经创建时，用户重输的密码不会用于重置密码；登录仍需原创建密码。

首次请求前，客户端持久保存 `name + role + operationId(UUID) + operationSecret(32随机字节base64url/hex)`，绝不持久化密码。凭据长度43–128，至少256位由 crypto 生成。重试与恢复始终使用原凭据。日常登录不按首次新密码规则拒绝旧密码。

只允许表中字段。客户端 `uid`、`providerUid`、`username`、`marker`、`active` 等额外字段均拒绝。姓名 NFKC、trim、1–40字符，拒绝控制/方向隐藏字符；键按规范化后 lowercase 比较。重名须加部门或编号，不自动合并账号。密码8–32字符、首位ASCII字母或数字，并在小写/大写/数字/指定符号四类中至少满足三类（符号：`()!@#$%^&*|?><_-`）。不降低官方密码规则。

## 持久状态机与兼容

1. HTTP 层校验字段并执行 PostgreSQL 持久限流：每来源每小时50次注册、全局200次注册；解析和状态每来源每小时600次。来源仅取平台注入 IP 的 SHA256；缺失来源使用共享限额，不能伪造 body 或 x-forwarded-for 绕过。
2. service-only SQL 使用 operationId 锁、规范化姓名锁、唯一约束预约原生用户名和身份。直接注册只接受 anchor/operator，`invite_id` 与 `invite_hash` 均为 NULL。旧邀请流程仍校验有效期、消费状态、目标UID及发起人权限，并预约消费邀请码。
3. 官方 CreateUser 使用固定29字符 ASCII username `r25n_...` 和 Description marker `r25wf-name-v1:<reservationId>`。UID只来自官方响应；超时后通过官方精确 Name 和 marker 查询恢复，不能采用客户端声称的 UID。
4. finalize 在一个 PG 事务绑定原生 UID、业务角色、姓名 alias、native 用户名映射和 ready 状态。直接预约的 role 再次核对；旧邀请预约继续校验发起权限并完成原邀请消费。已有 UID、账号映射或冲突姓名一律拒绝，不覆盖密码/权限/数据。
5. native 与 PG 不能跨服务原子提交。创建已成功、finalize 失败时，原预约/marker 可继续；尚无 native 时 status 返回 requiresPassword。预约不会自动释放给他人。丢失 operationSecret 使用下方受信任管理恢复；不得清理站点存储作为通用修复，不开放无凭据接管或密码重置。

旧原生登录名优先通过官方精确查找，再解析姓名 alias；其规范化 namespace 继续保留，不能被大小写变体、直接注册或旧 redeem 覆盖。旧用户 backfill 只接受官方核实的 UID/nativeUsername，读取原业务姓名；重复旧姓名标记冲突，不合并旧行。既有 UID、密码、角色及训练/提交/媒体数据均不重写。

业务提交权限继续由原业务 API 和原生 session 决定：注册不授予管理员权限；运营接收提交范围及管理员全局查看来自既有 ACL，不能用注册请求伪造。前端输入运营姓名需解析到服务端提供的启用运营身份；业务 API 仍校验接收 UID 和作业归属。本迁移不改提交或媒体 ACL。

## 适配与秘密边界

`provider-cloudbase.cjs` 保持官方 adapter：

- `dbCall(action,payload)` 调用 `public.r25wf_name_identity_service(text,jsonb)`，仅管理/service_role 可执行；anon/authenticated 无 EXEC 和私有表权限。
- `createNativeUser({username,password,displayName,marker})` 调用官方外部用户创建；`findNativeUser(username)` 精确验证 Name / Type / status / Description。
- handler 只把 SHA256(operationSecret) 送 PG；兼容邀请请求只把 MD5(lowercase inviteCode) 送 PG。密码、原 operationSecret、原邀请码不得进入业务 SQL、队列、数据库或日志。
- 不读取本地永久 CLI 密钥作为运行时后备。官方或数据库不可用时 fail closed，不回退浏览器假注册。

错误包括 `INVALID_ROLE`、`INVALID_REQUEST`、`INVALID_NAME`、`NAME_TAKEN`、`NAME_CONFLICT`、`NAME_PENDING`、`NOT_FOUND`、`REGISTRATION_CONFLICT`、`INVALID_OPERATION_SECRET`、`NATIVE_IDENTITY_CONFLICT`、`PROVIDER_UNAVAILABLE`、`NATIVE_CREATION_FAILED`、`RATE_LIMITED`。兼容邀请请求保留原邀请相关错误。HTTP 冲突409、未找到404、限流429、供应方不可用503，其余输入错误400。

CORS 只允许配置 origin、POST/OPTIONS。Origin 不是身份凭证；直接注册是公开注册，服务端角色白名单、持久限流和原生账号验证独立生效。姓名不代表经过人工实名审核。

## 上线顺序与回退

1. 冻结并核对现有函数、原生账号和业务行；现网已部署的 `001-name-identity.sql` 不改写。新环境先安装既有业务 schema 和 001。
2. 通过受信任管理通道执行 `002-direct-registration.sql`，整个迁移一个事务。它允许邀请列为空并增加成对为空约束，替换服务函数，保留全部旧行和服务权限；可重复执行。不要重新执行 001 作为“升级”。
3. 接着执行 `003-registration-recovery.sql`，增加仅管理侧可执行的预约凭据轮换，并允许持原凭据的 status 省略 role。003 不改动任何现存预约。不要随后重跑 001/002 覆盖新函数。先验证 anon/authenticated 无权限、旧 resolve/邀请预约恢复仍可用，再部署本目录 handler（provider 和原 STS 部署配置不变）。先迁移后函数，期间旧客户端邀请请求仍能运行。
4. 通过真实官方 Auth 做受控主播/运营注册、响应丢失恢复、旧账号登录、跨账号业务/媒体 ACL 验证，再发布新前端。这里的本地测试不证明上述云端验收已经完成。
5. 回退前端入口时保留 002、003 和当前 handler，让已经创建的直接预约仍可恢复并让新旧账号继续登录。若需临时停止新增注册，通过入口/网关限制注册流量，同时保留 status/resolve 恢复通道。不得删除预约/UID或清理浏览器凭据。
6. **有直接预约后禁止直接恢复 001 或旧 handler**：旧服务的邀请前提和旧 status 无 role 会阻断直接预约恢复。若必须退回旧后端，先提供兼容恢复路径并核对所有直接预约终态，经专门评审后另做迁移；不把恢复 NOT NULL、删 NULL 邀请行作为常规回滚。

本目录没有执行云端写入、部署或正式账号创建。

## 本地验证

`tests/direct-registration.test.cjs` 使用实际 PGlite/PostgreSQL 引擎执行原 schema、001→002→003 升级以及重复迁移，再经真实 handler 调用服务 SQL。Auth/native 创建、auth claims 是明确的测试替身；不访问 CloudBase。

```sh
NODE_PATH=/path/to/runtime/node_modules node --test backend/r25-name-identity/tests/direct-registration.test.cjs
```

需要既有测试锁定的 `@electric-sql/pglite@0.5.16`。覆盖直接双角色、管理员/额外字段拒绝、原预约不变、角色与秘密绑定、原生超时和数据库失败恢复、marker/UID冒用拒绝、旧邀请权限、旧登录 namespace、数据库执行权限、限流和 CORS。PGlite 为单连接引擎，不能替代多进程 PostgreSQL 锁竞争、真实官方 Auth、真实云端 ACL、手机和中国大陆网络验收。


## 丢失本机恢复凭据：受信任管理恢复

适用范围仅为 **未完成的直接注册预约**。管理员须先在线下核对申请人和原注册姓名，并在官方 Auth 核对该预约的 native_username、Description marker 及账户状态。姓名本身不是身份凭证；不要向仅能报出姓名的人发放恢复码。已完成账号使用原密码登录；旧邀请预约沿用原邀请恢复路径。

管理工具只轮换 `operation_proof`，不删除预约，不改变 operationId、姓名、角色、native_username、marker、UID 或密码。即使原生账号已经创建、业务 finalize 尚未完成，也保留原生账号；恢复后仍使用首次密码登录。忘记首次密码须走官方 Auth 的经核验密码恢复流程，本工具不重置密码。

1. 通过受信任数据库管理控制台，只读取得待恢复行（替换下面姓名字面量并正确 SQL 转义；也可按已知 operation_id 查找）：

   ```sql
   SELECT jsonb_build_object(
     'envId','unknown-roadrunner-d7cap6e21f517',
     'reservationId',id,'operationId',operation_id,
     'name',display_name,'role',role,'operationProof',operation_proof
   ) AS private_snapshot,
     native_username,native_marker,state
   FROM public.r25wf_name_registrations
   WHERE display_name='已核对的注册姓名'
     AND state='reserved' AND uid IS NULL
     AND invite_id IS NULL AND invite_hash IS NULL;
   ```

   必须唯一定位。把 `private_snapshot` 的 JSON 对象保存成权限 0600 的本机私有 `snapshot.json`，不得上传仓库、聊天或共享网盘。native_username/marker 仅供管理员核对，不加入 snapshot JSON。

2. 离线生成私有文件（不连接云端）：

   ```sh
   node backend/r25-name-identity/prepare-registration-recovery.cjs /private/snapshot.json /private/new-recovery-directory
   ```

   输出目录须尚不存在，工具以 0700 创建目录、0600 写入 `rotate-proof.sql` 与 `recovery-code.txt`。stdout 不含恢复码。SQL 只含新旧 proof 哈希，不包含新原始 secret；恢复码属于秘密，不应出现在命令行参数、网址、日志或截图中。

3. 在已安装 003 的同一环境，通过受信任管理控制台执行 `rotate-proof.sql`。检查返回 `ok=true`、`data.rotated=true`，再把 `recovery-code.txt` 私下交给经核实的申请人。**SQL 尚未成功时不得发码**。`RECOVERY_STALE`、`RECOVERY_NOT_PENDING` 或任何错误时保留现状重新核对；不要删行、改角色或绕过检查。

4. 申请人在网页“恢复中断注册”入口粘贴恢复码。客户端先用码内凭据向服务端核验，只有核验成功后才保存到本机，再继续原姓名、原角色的注册或登录；若原生账号已存在，必须使用首次密码。不要公开恢复码或清理浏览器数据。

`public.r25wf_name_recovery_rotate(jsonb)` 与公开身份函数分离；仅 trusted management / service_role 有 EXECUTE，anon/authenticated/PUBLIC 无权限；公开 HTTP action 不支持恢复轮换。输入必须是 `reservationId, operationId, name, role, expectedProof, newProof`，不接受原始 secret 或 password。按原 operationId 获取与 reserve/status/finalize 相同的事务锁，并 `FOR UPDATE`，核对 pending/direct、ID、姓名、角色和旧 proof 后只更新 proof。旧码立即失效；旧 SQL 重放失败。若并发 finalize 已完成，会拒绝轮换；若轮换先完成，旧 finalize 的原 proof 会失效，新码只恢复同一原生预约。

可携带码格式固定为 `R25REC1.` 加 UTF-8 JSON 的 base64url，字段为 `{version:1,envId,name,role,operationId,operationSecret}`。编码不等于加密，任何持有码的人都可查询或继续此预约；该码不能直接获得 Auth session、读取作业或重置密码。当前恢复码沿用预约凭据的持久有效期；怀疑泄露时管理员重新核对并再次轮换尚未完成的预约。已 ready 账号不再发注册恢复码。

新增测试：

```sh
NODE_PATH=/path/to/runtime/node_modules node --test backend/r25-name-identity/tests/registration-recovery.test.cjs
```

覆盖丢失凭据后无原生账号/已有原生账号两条恢复路径、同 UID/用户名/marker/角色保全、旧 proof 失效、快照 CAS/重放拒绝、finalize 先完成拒绝轮换、公开权限拒绝、旧邀请保护、003 重跑无损、离线工具私有文件与 stdout 保密。PGlite 是单连接：锁语句和两种串行结果得到验证，真实 PostgreSQL 多连接竞争仍须云端验收。
