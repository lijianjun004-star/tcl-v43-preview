# CloudBase 作业同步适配器

这个包提供独立资源试点所需的云函数适配代码。已在本机验证 API 转换、令牌校验流程、唯一写入和查询边界。模拟测试未连接真实腾讯云身份服务、网关或数据库。

## 试点准备

1. 默认使用独立 CloudBase 环境和测试站域名。函数只能访问与运行环境一致的数据库。运行环境 ID 以 CloudBase 注入的 `TCB_ENV`、`SCF_NAMESPACE` 或调用上下文 `namespace` 为准，多个值出现时必须一致。共用上海现有环境的附加约束见下文。
2. 确认试点环境已开启用户名和密码登录，建立两个不同的测试用户。同步接口要求有效的访问令牌和已启用的入组记录。仅授予受邀测试用户作业角色。
3. 确认目标为 CloudBase PostgreSQL 环境。核对下列三个表名都可用，使用数据库管理员执行 [schema-postgresql.sql](schema-postgresql.sql)。SQL 在单一事务内新增三个表与索引，启用行级安全并撤销客户端角色的权限。云函数以服务端运行身份从 Node SDK 获取数据库权限。
4. 在 `tcl_r24_sync_v1_enrollments` 手动添加两条记录。分别用腾讯云身份控制台的真实用户 UID 作为 `id`，为两人填写同一个试点团队的 `team_id`。角色只能由受信任的管理员分配。
5. 在新建工作目录运行下方打包命令。用 [cloudbaserc.example.json](cloudbaserc.example.json) 配置隔离环境，保持 `TCL_R24_SYNC_ENABLED=false`，先核对变量和资源目标。

| PostgreSQL 表名 | 记录和索引 |
| --- | --- |
| `tcl_r24_sync_v1_enrollments` | `id` 为 CloudBase UID。字段 `team_id`、`display_name`、`active`、`role`。复合索引 `team_id,role,active,id` |
| `tcl_r24_sync_v1_assignments` | 每个作业一条冻结快照。复合索引 `team_id,id` |
| `tcl_r24_sync_v1_submissions` | 主播场次去重，服务端提交时间。复合索引 `assignment_id,team_id,id` 及 `team_id,anchor_id,id` |

```sql
INSERT INTO public.tcl_r24_sync_v1_enrollments (id, team_id, display_name, role, active)
VALUES ('<从试点环境控制台复制实际 UID>', 'r24-pilot', '试点运营', 'operator', true);
```

另一个帐号用 `role:"anchor"`。测试人员应使用独立账号，并由管理员控制登录方式和入组。撤销试点权限时把对应记录的 `active` 改为布尔值 `false`。在当前实现里每次 API 请求都向 CloudBase 的用户信息接口校验令牌，再重新查询入组记录。

## 上海现有环境的独立资源试点

经授权可在 `unknown-roadrunner-d7cap6e21f517` 新建专用函数、网关路由、数据库表和静态站目录。先查询所有本次资源名和目标目录，任何一项存在即停止。直接复用已开启的用户名密码登录。若该登录方式未启用，暂停并报告。账户密码、部署令牌和访问令牌不能写入代码或日志。

| 项目 | 专用值 |
| --- | --- |
| 函数 | `tcl-r24-sync` |
| HTTP 网关前缀 | `/api/tcl-r24-sync` |
| 表名前缀 | `tcl_r24_sync_v1` |
| 页面来源 | `https://unknown-roadrunner-d7cap6e21f517-1519058345.tcloudbaseapp.com` |

共用环境时显式配置函数环境变量：

```json
{
  "TCL_R24_SYNC_ENABLED": "true",
  "TCL_R24_SYNC_ALLOW_SHARED_SHANGHAI": "true",
  "TCL_R24_SYNC_ENV_ID": "unknown-roadrunner-d7cap6e21f517",
  "TCL_R24_SYNC_COLLECTION_PREFIX": "tcl_r24_sync_v1",
  "TCL_R24_SYNC_ORIGINS": "https://unknown-roadrunner-d7cap6e21f517-1519058345.tcloudbaseapp.com"
}
```

5 个值、运行环境身份和 3 个新表的权限设置都必须匹配。共用环境不调整环境级登录、域名、用户角色或全局权限。仅新增独立试点账号和入组记录，保留现有站点文件。先验证未登录的 API 返回 401，再发布启用云端功能的试点页面。

## 本地打包

运行时选择 Node.js 20.19 或更新版本。路径应指向试点专用工作目录。如果已存在同名目录，脚本会失败。

```sh
cd cloudbase
npm ci
npm test
mkdir -p /path/to/isolated-staging/functions
npm run stage -- /path/to/isolated-staging/functions/tcl-r24-sync
```

配置示例只指定一个新建的 Event 云函数，入口为 `index.main`。创建前在测试环境查询函数名和网关路径，发现占用就停止。可以通过 CloudBase 控制台创建函数，也可以在填好配置后使用 `tcb fn deploy tcl-r24-sync -e <isolated-env-id>`。数据库表和权限需要单独由管理员设置。打包脚本不执行云端命令。

在 CloudBase 的 HTTP 网关为试点域名添加 `/api/tcl-r24-sync` 前缀路由，将其转到该 Event 函数。**关闭路径透传**，使 `/api/tcl-r24-sync/me` 到函数时为 `/me`。网关需要传递 `Authorization` 请求头，由函数执行用户身份验证。若跨来源配置，网关需允许浏览器发送未经登录的 `OPTIONS` 预检，函数只为 `TCL_R24_SYNC_ORIGINS` 精确列出的 HTTPS 来源返回 CORS 许可。客户端角色仍无法直接读取这些表。开发版的公开页面可以选择同源路由，省去跨来源设置。

## 设备启用和姓名登录

在已有试点后台上依次应用 [设备启用迁移](schema-device-grants.sql)、更新试点函数、验证接口，再更新试点页面。迁移只新增 `tcl_r24_sync_v1_device_grants` 和索引。运营可让管理员为指定已入组账号签发一次性、限时启用码。管理员使用加密随机数生成 `R24-` 加 24 个小写十六进制字符。台账只写入原码的 SHA-256 小写十六进制值、对应 `enrollment_id` 和 `activation_expires_at`。原码只发给对应人员。

首次在某浏览器启用时，提交正式登记姓名和启用码。页面生成 256 位设备令牌，服务端根据启用记录取得真实身份、团队和角色。首次启用成功后，同一浏览器日常只输入姓名。换浏览器、清除保存数据、绑定过期或被撤销时，需新签发的启用码。设备绑定自启用起最长 90 天。提交结果丢失时，原设备可用同一令牌重试。另一个令牌无法复用已使用的启用码。

服务端保存设备令牌摘要，管理员可用该启用码的摘要撤销单一设备绑定，或停用入组记录撤销该账号所有设备。启用码、设备令牌、数据库管理令牌严禁记录在日志、证据或源码中。现有 CloudBase 原生访问令牌在本轮过渡中继续可用。

共享域内的首方页面属于同一浏览器安全来源。试点页面请仅存放在已经信任同域前端脚本的设备和浏览器。具备条件时使用独立业务域名，隔离不同站点的浏览器存储。

## 开启试点前的检验

- 验证试点的运行环境、函数、网关和数据库表，再把 `TCL_R24_SYNC_ENABLED` 设为 `true`。页面配置填这一个环境的 CloudBase 登录网关和作业 API 地址。所有客户端只使用 CloudBase 用户访问令牌，服务端使用函数运行身份。
- 先用两名测试人员验证 `GET /me`。未登录和未入组用户应返回 401。主播提交时改运营者姓名、伪造分组或越权查询其他运营的提交，服务端应拒绝。
- 用运营和主播两个独立的浏览器会话跑一次发布、领取、提交、刷新和运营核对，再测断网重试同一个场次不会产生重复提交。生产权限审核和真机验收仍需执行。
- 关闭试点时先设 `TCL_R24_SYNC_ENABLED=false` 并关闭页面云同步配置。已有作业和提交保留在试点专用表。历史本机记录通过当前 JSON 流程人工交接。

试点内部数据库查询每批最多 10 条，累积超过约 8 MiB 或无法在 100 批内完成会拒绝请求，避免展示缺失的结果。扩大试点前，应把列表分页和筛选条件下推至数据库。

本轮存储文字作业与逐题回答。没有录像存储、微信通知或历史自动迁移。需要运营可搜索的姓名时，应在同一试点团队中尽量使用不同的显示名。服务端以入组 UID 为访问依据。

## 官方接口依据

- [CloudBase User Me 接口](https://docs.cloudbase.net/en/http-api/auth/user-me)
- [HTTP API 示例及环境域名](https://docs.cloudbase.net/en/quick-start/http-api/introduce)
- [HTTP 网关调用 Event 函数](https://docs.cloudbase.net/en/service/access-cloud-function)
- [HTTP 网关路径透传](https://docs.cloudbase.net/service/path-passthrough)
- [CloudBase PostgreSQL 连接方式](https://docs.cloudbase.net/en/database/postgresql/connecting-to-postgresql)
- [PostgreSQL 角色及权限](https://docs.cloudbase.net/en/database/postgresql/roles)
- [PostgreSQL 新增数据](https://docs.cloudbase.net/en/api-reference/webv4/postgresql/insert)
- [函数运行时和环境变量配置](https://docs.cloudbase.net/cli-v1/functions/configs)
