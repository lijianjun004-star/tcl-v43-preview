# CloudBase 作业同步适配器

这个包提供隔离试点所需的云函数适配代码。已在本机验证 API 转换、令牌校验流程、唯一写入和查询边界。模拟测试未连接真实腾讯云身份服务、网关或数据库。

## 试点准备

1. 选定一个独立已开通的 CloudBase 环境和测试站域名。适配器拒绝在已发布 QA3 的 `unknown-roadrunner-d7cap6e21f517` 环境中启用，也拒绝访问与函数运行环境不符的数据库。运行环境 ID 由 CloudBase 的 `TCB_ENV` 或 `SCF_NAMESPACE` 提供。
2. 在隔离环境开启用户名和密码登录，建立两个不同的测试用户。禁止匿名用户使用同步接口。仅授予受邀测试用户作业角色。
3. 建立以下 3 个文档集合。三者均用 [database.rules.json](database.rules.json) 拒绝客户端直接读写。通过云函数的受控服务端角色访问集合。生产试点需要根据腾讯控制台支持的 IAM 粒度收敛函数运行角色。
4. 在 `tcl_r24_sync_v1_enrollments` 手动添加两条记录。分别用腾讯云身份控制台的真实用户 UID 作为 `_id`，为两人填写同一个试点团队的 `teamId`。角色只能由受信任的控制台管理员分配。
5. 在新建工作目录运行下方打包命令。用 [cloudbaserc.example.json](cloudbaserc.example.json) 配置隔离环境，保持 `TCL_R24_SYNC_ENABLED=false`，先核对变量和资源目标。

| 默认集合名 | 记录和索引 |
| --- | --- |
| `tcl_r24_sync_v1_enrollments` | `_id` 为 CloudBase UID。字段 `teamId`，`displayName`，`active`，`role`。复合索引 `teamId,role,active,_id` |
| `tcl_r24_sync_v1_assignments` | 每个作业一条冻结快照。复合索引 `teamId,_id` |
| `tcl_r24_sync_v1_submissions` | 主播场次去重，服务端提交时间。复合索引 `assignmentId,teamId,_id` 及 `teamId,anchorId,_id` |

```json
{"_id":"<从隔离环境控制台复制实际 UID>","teamId":"r24-pilot","displayName":"试点运营","role":"operator","active":true}
```

另一个帐号用 `role:"anchor"`。测试人员应使用独立账号，并由管理员控制登录方式和入组。撤销试点权限时把对应记录的 `active` 改为布尔值 `false`。在当前实现里每次 API 请求都向 CloudBase 的用户信息接口校验令牌，再重新查询入组记录。

## 本地打包

运行时选择 Node.js 20.19 或更新版本。路径应指向试点专用工作目录。如果已存在同名目录，脚本会失败。

```sh
cd cloudbase
npm ci
npm test
mkdir -p /path/to/isolated-staging/functions
npm run stage -- /path/to/isolated-staging/functions/tcl-r24-sync
```

配置示例只指定一个新建的 Event 云函数，入口为 `index.main`。创建前在测试环境查询函数名和网关路径，发现占用就停止。可以通过 CloudBase 控制台创建函数，也可以在填好配置后使用 `tcb fn deploy tcl-r24-sync -e <isolated-env-id>`。数据库集合和权限需要单独由管理员设置。打包脚本不执行云端命令。

在 CloudBase 的 HTTP 网关为试点域名添加 `/api/tcl-r24-sync` 前缀路由，将其转到该 Event 函数。**关闭路径透传**，使 `/api/tcl-r24-sync/me` 到函数时为 `/me`。网关需要传递 `Authorization` 请求头，由函数执行用户身份验证。若跨来源配置，网关需允许浏览器发送未经登录的 `OPTIONS` 预检，函数只为 `TCL_R24_SYNC_ORIGINS` 精确列出的 HTTPS 来源返回 CORS 许可。集合规则仍保持拒绝直接读取。开发版的公开页面可以选择同源路由，省去跨来源设置。

## 开启试点前的检验

- 验证新环境变量和函数确实在隔离环境，再把 `TCL_R24_SYNC_ENABLED` 设为 `true`。页面配置填这一个环境的 CloudBase 登录网关和作业 API 地址。所有客户端只使用 CloudBase 用户访问令牌，服务端使用函数运行身份。
- 先用两名测试人员验证 `GET /me`。未登录和未入组用户应返回 401。主播提交时改运营者姓名、伪造分组或越权查询其他运营的提交，服务端应拒绝。
- 用运营和主播两个独立的浏览器会话跑一次发布、领取、提交、刷新和运营核对，再测断网重试同一个场次不会产生重复提交。生产权限审核和真机验收仍需执行。
- 关闭试点时先设 `TCL_R24_SYNC_ENABLED=false` 并关闭页面云同步配置。已有作业和提交保留在隔离库。历史本机记录通过当前 JSON 流程人工交接。

试点内部数据库查询每批最多 10 条，累积超过约 8 MiB 或无法在 100 批内完成会拒绝请求，避免展示缺失的结果。扩大试点前，应把列表分页和筛选条件下推至数据库。

本轮存储文字作业与逐题回答。没有录像存储、微信通知或历史自动迁移。需要运营可搜索的姓名时，应在同一试点团队中尽量使用不同的显示名。服务端以入组 UID 为访问依据。

## 官方接口依据

- [CloudBase User Me 接口](https://docs.cloudbase.net/en/http-api/auth/user-me)
- [HTTP API 示例及环境域名](https://docs.cloudbase.net/en/quick-start/http-api/introduce)
- [HTTP 网关调用 Event 函数](https://docs.cloudbase.net/en/service/access-cloud-function)
- [HTTP 网关路径透传](https://docs.cloudbase.net/service/path-passthrough)
- [Node SDK 数据库新增](https://docs.cloudbase.net/en/api-reference/server/node-sdk/database/add)
- [重复 _id 错误](https://docs.cloudbase.net/error-code/DATABASE_DUPLICATE_WRITE)
- [文档库安全规则](https://docs.cloudbase.net/database/security-rules)
- [函数运行时和环境变量配置](https://docs.cloudbase.net/cli-v1/functions/configs)
