# R25 姓名 + 密码直接注册契约 v2

新增主播、运营通过各自入口填写姓名和密码即可注册，不需要邀请码。公开注册身份严格限于 `anchor` / `operator`，不开放 `admin`。管理员既有账号、原生 UID、原用户名和原密码保持不变。密码继续只交官方 Auth CreateUser；本服务不创建自制密码库，也不签发登录会话。

前端配置仍为 `cloudbase.nameIdentity:{enabled:true,endpoint:'https://已部署的身份入口'}`。未部署并验证 v2 时不能显示可用的直接注册。成功统一 `{ok:true,data:{...}}`，失败 `{ok:false,error:{code,message}}`；不回显密码、operationSecret、云密钥或 SQL 错误。

## HTTP POST JSON

| action | 请求 | 成功响应 data |
| --- | --- | --- |
| resolve | `{action:'resolve',name}` | `{state:'ready',username,uid,displayName,legacy?}` |
| register（新） | `{action:'register',name,password,role:'anchor'或'operator',operationId,operationSecret}` | `{state:'ready',username,uid,displayName,role}` |
| status（新） | `{action:'status',operationId,operationSecret,role,name?}` | 上述 ready，或 `{state:'reserved',requiresPassword:true,role}` |
| register（旧客户端兼容） | `{action:'register',name,password,inviteCode,operationId,operationSecret}`，不得同时含 role | 上述 ready；role 来自原邀请码 |
| status（旧邀请预约） | `{action:'status',operationId,operationSecret,name?,role?}` | 上述 ready / reserved，均含原预约 role |

新直接预约的 status 必须带原 role。错误或缺失 role 返回 `REGISTRATION_CONFLICT`；格式非法或 admin 返回 `INVALID_ROLE`。旧邀请预约可省略 role；若提供，必须匹配。所有新 register 都必须指定身份，除非是兼容旧邀请格式。直接注册同时提供邀请码会被拒绝。服务不允许把旧邀请预约转换成直接预约，也不允许同一 operationId 改名、改角色或更换 operationSecret。

客户端收到 ready 后，用仅留内存的密码调用官方 `signInWithPassword({username,password})`，再调用业务 `me` 核对 UID、角色和 active 状态。服务响应不是登录 session。原生账号已经创建时，用户重输的密码不会用于重置密码；登录仍需原创建密码。

首次请求前，客户端持久保存 `name + role + operationId(UUID) + operationSecret(32随机字节base64url/hex)`，绝不持久化密码。凭据长度43–128，至少256位由 crypto 生成。重试与恢复始终使用原凭据。日常登录不按首次新密码规则拒绝旧密码。

只允许表中字段。客户端 `uid`、`providerUid`、`username`、`marker`、`active` 等额外字段均拒绝。姓名 NFKC、trim、1–40字符，拒绝控制/方向隐藏字符；键按规范化后 lowercase 比较。重名须加部门或编号，不自动合并账号。密码8–32字符、首位ASCII字母或数字，并在小写/大写/数字/指定符号四类中至少满足三类（符号：`()!@#$%^&*|?><_-`）。不降低官方密码规则。

## 持久状态机与兼容

1. HTTP 层校验字段并执行 PostgreSQL 持久限流：每来源每小时50次注册、全局200次注册；解析和状态每来源每小时600次。来源仅取平台注入 IP 的 SHA256；缺失来源使用共享限额，不能伪造 body 或 x-forwarded-for 绕过。
2. service-only SQL 使用 operationId 锁、规范化姓名锁、唯一约束预约原生用户名和身份。直接注册只接受 anchor/operator，`invite_id` 与 `invite_hash` 均为 NULL。旧邀请流程仍校验有效期、消费状态、目标UID及发起人权限，并预约消费邀请码。
3. 官方 CreateUser 使用固定29字符 ASCII username `r25n_...` 和 Description marker `r25wf-name-v1:<reservationId>`。UID只来自官方响应；超时后通过官方精确 Name 和 marker 查询恢复，不能采用客户端声称的 UID。
4. finalize 在一个 PG 事务绑定原生 UID、业务角色、姓名 alias、native 用户名映射和 ready 状态。直接预约的 role 再次核对；旧邀请预约继续校验发起权限并完成原邀请消费。已有 UID、账号映射或冲突姓名一律拒绝，不覆盖密码/权限/数据。
5. native 与 PG 不能跨服务原子提交。创建已成功、finalize 失败时，原预约/marker 可继续；尚无 native 时 status 返回 requiresPassword。预约不会自动释放给他人。丢失 operationSecret 需要管理员核对官方记录，不开放无凭据接管或密码重置。

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
3. 先验证 anon/authenticated 无权限、旧 resolve/邀请预约恢复仍可用，再部署本目录 v2 handler（provider 和原 STS 部署配置不变）。先迁移后函数，期间旧客户端邀请请求仍能运行。
4. 通过真实官方 Auth 做受控主播/运营注册、响应丢失恢复、旧账号登录、跨账号业务/媒体 ACL 验证，再发布新前端。这里的本地测试不证明上述云端验收已经完成。
5. 回退前端入口时保留 002 和 v2 handler，让已经创建的直接预约仍可恢复并让新旧账号继续登录。若需临时停止新增注册，通过入口/网关限制注册流量，同时保留 status/resolve 恢复通道。不得删除预约/UID或清理浏览器凭据。
6. **有直接预约后禁止直接恢复 001 或旧 handler**：旧服务的邀请前提和旧 status 无 role 会阻断直接预约恢复。若必须退回旧后端，先提供兼容恢复路径并核对所有直接预约终态，经专门评审后另做迁移；不把恢复 NOT NULL、删 NULL 邀请行作为常规回滚。

本目录没有执行云端写入、部署或正式账号创建。

## 本地验证

`tests/direct-registration.test.cjs` 使用实际 PGlite/PostgreSQL 引擎执行原 schema、001→002 升级以及重复迁移，再经真实 handler 调用服务 SQL。Auth/native 创建、auth claims 是明确的测试替身；不访问 CloudBase。

```sh
NODE_PATH=/path/to/runtime/node_modules node --test backend/r25-name-identity/tests/direct-registration.test.cjs
```

需要既有测试锁定的 `@electric-sql/pglite@0.5.16`。覆盖直接双角色、管理员/额外字段拒绝、原预约不变、角色与秘密绑定、原生超时和数据库失败恢复、marker/UID冒用拒绝、旧邀请权限、旧登录 namespace、数据库执行权限、限流和 CORS。PGlite 为单连接引擎，不能替代多进程 PostgreSQL 锁竞争、真实官方 Auth、真实云端 ACL、手机和中国大陆网络验收。
