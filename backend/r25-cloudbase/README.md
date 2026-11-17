# R25 CloudBase PostgreSQL 后端

本目录使用现有 CloudBase 原生 Auth、PostgreSQL RPC 和私有 Storage，不创建新的环境、NoSQL数据库、云函数或自制密码接口。全部新业务对象及策略以 `r25wf_` 开头，私有桶为 `r25wf-private`。旧静态站和其他业务表/桶不属于本目录的变更范围。

接口契约见 [API_CONTRACT.md](API_CONTRACT.md)。业务入口为 `app.rdb().rpc('r25wf_api', {action,payload,operation_id})`；原生登录后 UID 为字符串，不必是 UUID。SDK、RLS、真实跨设备测试的实际结果以项目主交接及对应证据为准，不以本README代替上线验收。

## 部署顺序

1. 通过官方CLI的已授权管理会话核对目标环境：原生用户名登录开启、匿名关闭、原生PostgreSQL可读写且已有auth/storage系统表。只修改指定现有环境。
2. 管理通道执行 `schema.sql`。它创建独立业务表、默认拒绝的RLS、固定search_path的SECURITY DEFINER RPC及私有媒体授权谓词。业务表不授予客户端直接读写；RPC仅授予authenticated，anon/PUBLIC不可执行。
3. 用管理员SQL将一个已存在的原生用户UID绑定为业务admin；无公开首人管理员入口。初始管理员绑定由有管理权限的人执行一次，不能把测试UID、密码或bootstrap私有脚本提交到仓库。
4. 用正式原生账号测试me、待绑定账号、邀请、作业、加入、主动提交、回执、收件、反馈和另一设备读回；测试跨用户和匿名拒绝，以及同一operation_id重试。
5. 如需私有附件，再执行 `media-storage.sql`。它要求新桶不存在，避免覆盖既有配置；非目标桶规则保持原样。真实验证上传、权限、不可覆盖/删除、对象元数据及附件关联后，由管理通道明确启用private_media capability。
6. 发布前端对应配置与完整static-manifest，经精确发布门禁上线；只有真实后台和前端两端都验证后才能称已接通。回滚前端不删除后台数据。

官方CLI 3.9.3的命令帮助已在本任务实际读取核对：

```sh
# 下列值全部是占位符；不能把云密钥、管理Token或密码写入本文件。
R25_ENV_ID='你的既有环境ID'

tcb db execute -e "$R25_ENV_ID" --sql "SELECT 1"
# 从文件读取SQL后作为一个参数传入，勿把文件内容拼成未转义的Shell程序。
tcb db execute -e "$R25_ENV_ID" --sql "$(cat backend/r25-cloudbase/schema.sql)"
tcb db execute -e "$R25_ENV_ID" --sql "$(cat backend/r25-cloudbase/media-storage.sql)"
```

原生PostgreSQL环境下CLI的 `--read-only` 开关会被忽略；只读检查必须实际使用SELECT，不可凭该开关执行任意SQL。

首次管理员绑定模板仅可在受信任管理通道手工替换执行，禁止发布为前端按钮/API：

```sql
INSERT INTO public.r25wf_users(uid,role,display_name,active)
VALUES ('ADMIN_NATIVE_UID','admin','管理员显示名',true)
ON CONFLICT(uid) DO NOTHING;
```

媒体启用模板（仅在真实附件/ACL验收通过之后）：

```sql
INSERT INTO public.r25wf_settings(key,value)
VALUES ('private_media','{"enabled":true}'::jsonb)
ON CONFLICT(key) DO UPDATE SET value=excluded.value;
```

## 为新运营或主播开通账号

正式账号分两步：原生Auth开通登录身份，业务邀请绑定权限。邀请不能创建原生用户名账号，前端禁止“自选运营/管理员”注册，也没有自制密码哈希或云函数登录。

推荐管理员在CloudBase官方控制台创建用户名密码账号，并以安全方式单独交付初始密码。用官方CLI也可；本环境已实测可用于网页登录的是 **externalUser**，CLI默认internalUser不可照抄使用。

```sh
# 优先控制台输入密码；CLI示例通过隐藏输入避免把明文写入Shell历史。
# 不在录屏/共享终端执行，不将CLI输出当成公开项目文档。
R25_ENV_ID='你的既有环境ID'
R25_USERNAME='新成员账号'
read -r -s -p '初始密码: ' R25_INITIAL_PASSWORD
printf '\n'
tcb user create "$R25_USERNAME" -e "$R25_ENV_ID" \
  --type externalUser --status ACTIVE --password "$R25_INITIAL_PASSWORD"
unset R25_INITIAL_PASSWORD

# 查询创建结果中的稳定UID；显示姓名不是UID。
tcb user list -e "$R25_ENV_ID" --name "$R25_USERNAME" --json
```

随后：

1. 管理员用正式账号登录练播房，生成主播或运营的一次性邀请；可指定目标UID。运营账户的API只能邀请主播，不能邀请运营或管理员。
2. 新成员用刚开通的原生账号登录。此时me返回pending，不能访问作业、提交或媒体。
3. 新成员输入邀请口令和显示姓名，服务端原子消费邀请并绑定持久role，再重新查询me。
4. 初始密码应由本人通过页面的官方Auth改密功能修改。管理员重置密码使用官方控制台或 `tcb user update UID --password ...`，不要新增业务RPC密码字段。

邀请默认48小时，最多168小时，单次使用；已绑定账号不能靠另一个邀请换角色，管理员权限也不能通过邀请获得。邀请仅对当前仍有资格的发起人有效。

## 停用、权限与数据保留

紧急停用先把对应 `r25wf_users.active` 设为false，再用官方Auth控制台/CLI将原生账号设为BLOCKED。业务RPC和私有媒体谓词每次检查active，不仅依靠客户端缓存。不要为了停用账号删除其已提交记录或已关联媒体。

```sql
-- 用真实目标UID替换占位符；执行前核对对象，保留变更审计。
UPDATE public.r25wf_users SET active=false WHERE uid='TARGET_NATIVE_UID';
```

```sh
tcb user update 'TARGET_NATIVE_UID' -e "$R25_ENV_ID" --status BLOCKED
```

权限事实：

- 主播只能提交自己的记录；作业接收运营由作业发布者锁定。自由练播必须选择真实活跃运营。
- 未主动提交的回答和媒体不向运营开放。作业进度仅返回加入、次数、时间与提交状态。
- 接收运营可读对应提交/附件并写人工文字反馈；其他运营/主播无权读取。管理员可管理已提交记录，原生登录身份本身不自动赋予admin。
- 提交JSON快照和附件关联不可修改或删除。反馈追加保存，不伪造AI评分。
- 所有写操作需稳定operation_id，幂等回执与业务写入在同一PostgreSQL事务提交。同key换内容拒绝，网络超时不能改新ID重复发送。
- 媒体最多3个、每个50MiB；仅private bucket、本人UID首段、INSERT only。RPC校验实际storage.objects的owner/size/MIME及唯一关联，没上传成功就没有附件送达回执。
- client sha256只是声明。MIME是存储元数据，不代表服务端完成了音视频解码、恶意文件扫描或真人准确率验收。
- 鉴权下载产生的本机Blob在读取时按权限检查，已经下载到用户设备的字节不能被后台远程收回。短期签名URL是bearer链接，不能宣称转发后仍不可访问；本轮优先authenticated SDK读取。
- 本机outbox不是云端数据库。界面必须保留“待发送/未确认”和“云端回执已确认”的差别。

## 验证与维护

本地独立验证用PGlite实际PostgreSQL、模拟Auth和存储元数据；它证明事务/RLS/逻辑，不证明CloudBase服务和真实对象字节。真实验收需用至少运营、主播及无权限账号，在隔离浏览器登录后走完整链路。

`schema.sql`可重复应用，已有业务数据与private_media设置不覆盖。`media-storage.sql`有“目标桶已存在则停止”的保护，不能当作无脑重复部署脚本。维护时读取现有策略再作只针对R25的迁移，不删除旧桶/旧表或重置整个环境。

本轮没有替换旧知识库REST后端，me明确返回questionBank=false。已有知识库前端仍需按它的实际模式使用；不能把作业同步成功写成整个知识库、私人未提交录音及历史演示数据都已上云。
