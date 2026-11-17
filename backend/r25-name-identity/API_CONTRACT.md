# R25 姓名 + 密码 + 邀请码契约 v1

这是新增、隔离的公开HTTPS身份入口。保留现有native UID、原始业务数据、旧原生用户名/密码登录；不更改ASR。新开户仍由官方Auth CreateUser(Type=externalUser)执行，业务角色只来自原有r25wf_invites。没有客户端自选角色、公开首人admin、自制密码哈希或密码数据库。

前端配置：`cloudbase.nameIdentity:{enabled:true,endpoint:'https://已部署的身份入口'}`。未配置或服务能力未验证时不能假称可自助开户。成功统一 `{ok:true,data:{...}}`，失败 `{ok:false,error:{code,message}}`；不回显密码/邀请码/operationSecret、云密钥或SQL错误。

## HTTP POST JSON

- `resolve`: `{action:'resolve',name}` → `{state:'ready',username,displayName,uid?,legacy?}`。浏览器随后仍用官方Auth `signInWithPassword({username,password})`，以原生session UID为准。ASCII输入优先经可信官方精确查询原生用户名，再查姓名alias，避免casefold别名覆盖旧登录；不让前端猜测UID。
- `register`: `{action:'register',name,password,inviteCode,operationId,operationSecret}` → `{state:'ready',username,uid,displayName}`。客户端收到后用仅保内存的同一密码官方登录，再me核对UID/角色；服务响应不是登录session。
- `status`: `{action:'status',operationId,operationSecret,name?}` → ready同上，或 `{state:'reserved',requiresPassword:true}`。同一次开户崩溃/响应丢失可以恢复；没有对应operationSecret不能查询预约或接管它。

前端在首次register请求之前，持久保存name+operationId(UUID)+operationSecret(32随机字节base64url/hex)，绝不持久密码。operationSecret长度43–128，至少256位由crypto生成；重试原操作保持相同二者与姓名/邀请。日常登录不按首次新密码规则拒绝旧密码。密码只在用户再次输入后暂存内存传给官方创建；创建已经成功时不会依据新重试密码重置它。

只允许表中字段。payload里的role、uid、username、providerUid等额外字段均拒绝，不作为授予权限的依据。姓名NFKC、trim、1–40字符，拒绝控制/方向隐藏字符；键按规范化后lowercase比较。重名须加部门或编号，不能自动合并两位用户。密码8–32字符、首位ASCII字母或数字，并在小写/大写/数字/指定符号四类中至少满足三类（官方指定符号：()!@#$%^&*|?><_-），只转官方Auth；provider额外密码规则失败会明确提示，不改为较弱密码。

## 持久状态机与旧账号

1. 服务先验证输入/持久限流，再由service-only SQL事务验证未过期、未消费的原邀请码及发起人当前权限。给现有UID定向的邀请码不能用来创建新用户。
2. 事务锁定规范化姓名、唯一operationId和邀请码，写持久reservation；nativeUsername固定为29字符ASCII `r25n_...`，不在UI展示。将邀请码consumed_by临时设为`reserved:<reservationId>`，避免旧redeem路径并发消费。
3. 官方CreateUser带固定username及Description marker `r25wf-name-v1:<reservationId>`。成功UID只来自官方响应。响应丢失后只可通过官方DescribeUserList精确Name和Description marker核对并恢复，不能接受客户端claimedUid/已有任意用户。
4. finalize在一个PG事务写原有r25wf_users角色、姓名alias、native用户名映射、reservation ready并把邀请码消费方改为官方UID。若该UID已有业务身份或映射冲突，拒绝，不覆盖旧UID/密码/数据。
5. native创建和PG不能跨服务原子提交：native已创建而finalize未完成时，同reservation及marker可继续；未找到native用户时status要求原密码，不能伪称ready。预约不会自动释放给其他人，避免未知native创建结果被新请求接管。丢失本机operationSecret时需管理员核对官方记录，不公开重置密码/换UID。

旧原生用户名的规范化namespace由native_identities保留：新开户/旧redeem不能以大小写变体占用，新增backfill也不能静默覆盖别人的alias或待完成预约；已有UID映射与数据不改写。

新迁移给原有r25wf_users增加只针对新增/改姓名的同名锁触发器，旧invites.redeem也必须尊重预约；预先存在的重名行原样保留不清理。finalize在同一事务先将预约UID设为官方核实UID，再通过此触发器绑定角色，失败整笔回滚。reserve与旧redeem采用invite行→name锁相同顺序避免死锁。

旧用户迁移由受信任管理通道调用backfill，只提供官方核实的UID/nativeUsername清单，SQL从原有active r25wf_users读displayName建立alias。重复姓名写冲突记录且不自动选一位；旧原生用户名继续可登录。迁移不更改UID、native密码、角色或任何训练/提交/媒体行。

## 服务适配接口

`provider-cloudbase.cjs`由平台适配模块提供：

- `dbCall(action,payload)` → `{ok,data}`/`{ok:false,error}`，调用`public.r25wf_name_identity_service(action text,payload jsonb)`；仅管理/service_role，客户端anon/authenticated无EXEC权限。
- `createNativeUser({username,password,displayName,marker})` → `{uid,username}`，官方CreateUser外部用户。
- `findNativeUser(username)` → 精确匹配的 `{uid,username,description,status}` 或null，Description为恢复标识。

handler只把SHA256(operationSecret)作为operationProof、MD5(lowercase inviteCode)作为inviteHash送PG；数据库/SQL日志不接触密码、原operationSecret、原邀请码。密码仅转CreateUser，不进业务SQL、持久队列或日志。

错误：INVALID_REQUEST、INVALID_NAME、NAME_TAKEN、NAME_CONFLICT、NAME_PENDING、NOT_FOUND、INVALID_INVITE、INVITE_FOR_EXISTING_ACCOUNT、INVITE_EXPIRED、REGISTRATION_CONFLICT、INVALID_OPERATION_SECRET、NATIVE_IDENTITY_CONFLICT、PROVIDER_UNAVAILABLE、NATIVE_CREATION_FAILED、ROLE_BINDING_BLOCKED、RATE_LIMITED。云端管理权限不存在时fail closed，禁止回退浏览器假注册或本地CLI永久密钥。

CORS只允许既定发布origin，POST application/json，OPTIONS不执行业务。Origin不是身份凭证，注册authorization仍是不可猜测有效邀请码。注册/解析/查询限流持久化，不能只存函数内Map。所有真实云写入、HTTP函数部署、管理身份权限及开户/旧数据保留测试由主任务执行；本目录作者不执行云写入或Git发布。
