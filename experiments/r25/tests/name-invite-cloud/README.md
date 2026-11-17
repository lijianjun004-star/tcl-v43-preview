当前执行结果：真实 broker 72/72，本机实际产品 UI 26/26，公网实际产品 UI 26/26；证据见 ../../../../evidence/r25-name-identity/。以下原驱动说明保留执行前准备与 NOT RUN 边界，不能当作当前最终验收结论。所有当轮合成身份/邀请已定向清理，重放须另外生成新 fixture。

# R25 姓名、密码、邀请码验收驱动

默认 dryrun 零网络、零浏览器、零云写入。root已授权并提供部署地址/私密fixture后，`results/broker-1` 实际执行72项通过；4项服务端独立审计/故障点检查仍NOT RUN。`results/ui-1` 实际本机产品UI首轮26项通过；`results/ui-public-1` 固定公网实际UI首轮26项通过，两者均含真实开户响应丢失恢复且分别使用全新姓名/邀请码。合同来源：`/workspace/tcl-r25-name-login/backend/r25-name-identity/API_CONTRACT.md` v1。

`run_broker.py` 使用真实 HTTP broker → bundled 官方 SDK/native Auth →真实 PG RPC。覆盖中文姓名 anchor/operator/outsider 开户、后续姓名解析及新context原生登录、同op/secret恢复及原UID复用、错误secret、status禁止密码字段、无/错邀请码拒绝且无alias、额外role/uid/username字段拒绝、重名拒绝、旧账号原密码/UID保持、跨context身份与任务/提交/反馈ACL。

新开户密码按官方native规则验收：8–32位、首位ASCII字母或数字，只允许ASCII字母/数字及 `()!@#$%^&*|?><_-`，小写/大写/数字/符号四类至少三类。正例通过 `new_password()` 生成 `A + 随机hex + 9z!`，不把两类弱样例当注册成功预期。`abc12345` 必须返回 `INVALID_PASSWORD`，后续检查无alias、无reservation；同一有效邀请码随后能正常开户。native CreateUser调用数仍由root/provider独立审计，未执行不算PASS。

`run_ui.py` 只操作实际产品表单，無config/SDK/业务回复注入；两个新角色与错人各自独立context。实际中文开户、独立context姓名密码登录、实际Tiny控件刷新后的首保存、任务→文字→提交→反馈→刷新。`--response-loss` 在真实Chromium收到ready开户响应后用CDP丢弃响应，验证页面不假成功、原operationId/secret status恢复同UID；不使用Route.fetch。

执行前由root部署并确认服务、提供owner-only(0600)私密fixture。`fixture.example.json`只有占位文本且`executionApproved:false`。API/UI两suite必须使用**不同的新姓名与未使用邀请码**，不可对同一fixture盲重跑。密码/邀请码只由私密fixture读取，不输出、复制或提交。旧账号只做登录/只读me，不改密码。此驱动不创建邀请码、不操作云配置、不清理数据。

```sh
python3 run_broker.py
python3 run_ui.py
node build-browser-adapter.cjs
python3 run_broker.py --execute --private-fixture /workspace/PRIVATE-broker.json --out results/broker-1
python3 run_ui.py --execute --private-fixture /workspace/PRIVATE-ui.json --response-loss --out results/ui-1
```

服务端证明独立于客户端：无效邀请确实未创建native账号、无密码入SQL/日志、正式旧UID/角色/业务数据前后不变，需要root在对应scope执行官方DescribeUserList和SQL只读前后审计。脚本明确记NOT RUN，不把“无alias”冒称“native零开户”。native创建至finalize间崩溃恢复，需要root提供安全checkpoint，当前不假定生产故障开关存在。无真实云配置前不得标记这些为PASS。

输出只保留受控错误类型、HTTP状态、错误code、哈希与检查结果；不记录原始异常、headers、请求body、operationSecret、密码、JWT。所有context在finally关闭。请求超时30秒、CDP等待45秒，不无限重试。
