# R25 直接注册与按运营姓名交作业

任务：TCL-R25-DIRECT-REGISTRATION-20261117。北京时间 2026-11-17。

**状态：代码候选与本地验证完成，尚未部署到真实后台和 Pages。**

实现已保存至源码提交 `10fc15f15794db4c0654fb92dc5bca050aef9776`（26 个文件远端读回逐字节核对）。独立发布门禁 [草稿 PR #138](https://github.com/lijianjun004-star/tcl-v43-preview/pull/138) 已创建；其精确 head `86b35d8f13837ed01b3d946b0df3778186ea0b75` 的 [GitHub Actions](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/44067286780) 已 `completed/success`。PR 未合并，未发布新前端。

用户已明确：取消邀请码；主播、运营用姓名和自设密码直接注册登录；主播输入接收运营姓名交作业；接收运营查看自己的收件，管理员默认查看全部已交付作业。

## 已完成

- 注册角色仅提供主播、运营，后台严格限制为 `anchor`、`operator`；原管理员身份保留。
- 新注册不要求邀请码。姓名、密码登录仍使用原生 Auth，绑定不可变 UID；业务数据库与本机重试记录不保存密码。
- 以原操作编号、256 位恢复凭据和原角色恢复失败请求；旧邀请预约保持兼容，旧账号不重新创建或按姓名合并。
- 主播输入运营完整注册姓名；提交前刷新服务端名单，按 NFKC、首尾空格和大小写规范化精确匹配。没有匹配、已停用或存在重名时阻止提交；唯一匹配后保存稳定 UID。
- 运营仅看交给自己的作业；管理员默认看所有主播提交，并显示接收运营，可按既有后台权限添加反馈。
- 已关联训练作业仍固定交给原发布运营；待确认提交重试保留原接收方与内容。私有附件仍须主播主动选择。

## 来源与冻结

- main 基线：`c658a4a7af6a608a22f2708d3832e67746ed8136`。
- 源码基线：`9a194482c343ed2f01b0ba313904481157f598f0`。
- 开发分支：`feat/r25-direct-registration-20261117`。
- 候选：`r25-direct-registration-20261117`，29 个产品文件，仅修改配置说明、3 个身份/工作台模块与静态清单。
- 原 `app.js`、ASR、SDK、样式等 24 个产品文件逐字节保留。旧站 217 个资源由独立发布门禁进一步核对。
- 完整逐文件哈希、ZIP/B64 身份：[release-identity.json](release-identity.json)。可用 `python3 evidence/r25-direct-registration/build_candidate.py` 重建 ZIP。

## 本轮实际验证

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| 直接注册、姓名解析、角色重试、旧工作流 | 45/45 | verification/frontend-node.log |
| 后端 handler 与实际 PGlite SQL 集成 | 12/12 组 | verification/backend-node.log |
| 实际 PGlite PostgreSQL/RLS 权限与迁移 | 102/102 | acl-result.json |
| 发布门禁与完整更新/回退 | 153/153；两向均保护旧217，最终246资源 | release-gate/tests.log、full-build.log |
| 真实浏览器候选 UI | NOT RUN | 浏览器启动/连接受阻，见 runtime-blockers.json |
| 真实 CloudBase 注册、跨设备提交、私有附件 | NOT RUN | 官方客户端在 token 轮询前读取网卡信息失败，尚无有效管理登录 |
| 真实 iPhone/Android、大陆网络、真人语音 | NOT RUN | 本轮未执行 |

这些数字为不同范围，不合并成整体通过率。PGlite 使用真实 PostgreSQL 引擎，但原生 Auth 与 Storage 元数据为合成夹具，不能写成真实云端或手机验收通过。没有调用 Gemini、付费模型 API，也没有新增收费服务。

第一次根代理 ACL 启动缺少 `NODE_PATH`，在产品检查前报 MODULE_NOT_FOUND；补充已安装依赖路径后同一产品代码通过。原邀请码专用测试因用户改变业务契约标记 SUPERSEDED，并指定新测试；不把原结果算作本轮通过。

### 云端登录阻塞的进一步诊断

官方 CLI 3.9.3 普通设备授权、禁止自动开浏览器且使用 TTY 的设备授权均生成用户链接后提前退出，返回 `AUTH_FAILED`。官方 `@cloudbase/toolbox@0.9.4` 使用支持的 `throwError:true`、`noBrowser:true` 进一步返回 `API_ERROR: Device Flow 轮询请求失败`。这些已退出会话的链接不作为可完成的授权交接提供。

独立只读检查复现 Node `os.networkInterfaces()` 抛出 `ERR_SYSTEM_ERROR: uv_interface_addresses returned Unknown system error 1`。官方客户端代码在 `/token` 请求前必经 `getMacAddress()` → `address.mac()` → `address.interface()` → `os.networkInterfaces()`；该同步错误不在回调兜底范围内，因而导致轮询提前失败。此证据解释当前环境问题，不能据此判断用户账号或授权状态。未修改客户端认证逻辑、伪造设备信息、绕过环境限制或读取用户秘密。

## 待执行上线步骤

1. 在支持官方客户端正常运行的执行环境中恢复用户已授权的 CloudBase 管理登录；当前环境网卡信息读取限制须先解决。使用新生成且仍在等待的官方设备授权会话，不要求用户发送密码、密钥或验证码。
2. 核对既有上海环境 `unknown-roadrunner-d7cap6e21f517`、现有 `r25wf_name_identity` EVENT 函数及 `/r25-name-identity` 路由。读取当前正式身份与既有业务记录的保全摘要。
3. 仅应用 `backend/r25-name-identity/002-direct-registration.sql`；不要重跑存储建桶、管理员初始化或旧业务 schema。
4. 在原函数部署 v2 handler；保留已配置 runtime、临时 STS、HTTP 路由与固定官方依赖。更新前先保存现有函数配置和源码身份。
5. 使用专用合成账号真实验证主播/运营注册、换设备登录、旧账号不变、拒绝 admin 注册、姓名提交、接收运营/管理员可读、无关账号拒绝及私有媒体。
6. 后台验证通过后，按独立 CI PR→精确发行归档 PR→Pages 的现有流程更新原 R25 路径。正式版本发布遵循用户届时确认；此候选本身不代表上线。
7. 读取真实公网资源哈希并操作注册/登录/提交/收件流程。只报告实际通过范围，更新唯一 `AI_CONTEXT.md`。

## 回退

前端可沿精确相邻发行边退回姓名邀请码版。**一旦存在新直接注册预约，须保留 002 和 v2 handler 的恢复能力；不能恢复 001 或旧 handler。** 前端回退不删除原身份、作业、附件或本机记录。旧邀请路径在 v2 后台继续兼容。

## 重跑本地核心验证

使用项目外受控依赖目录安装 `@electric-sql/pglite@0.5.16`，然后：

```sh
export NODE_PATH=/absolute/path/to/test-dependencies/node_modules
node --test backend/r25-name-identity/tests/direct-registration.test.cjs
node --test experiments/r25/tests/direct-registration-identity.mjs experiments/r25/tests/direct-registration-receiver.mjs experiments/r25/tests/direct-registration-workflow.mjs experiments/r25/tests/cloud-workflow.mjs
node experiments/r25/tests/direct-registration-acl.mjs
# 有可用浏览器的环境再运行，不把未启动当作通过：
CHROMIUM_EXECUTABLE=/usr/bin/chromium python3 experiments/r25/tests/direct-registration-ui.py
```
