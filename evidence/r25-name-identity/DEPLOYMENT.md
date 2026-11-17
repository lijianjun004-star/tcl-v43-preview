# R25 姓名、密码、邀请码：已部署

2026-11-17。用户要求运营和主播首次用自己的姓名、自设密码和邀请码加入，之后用姓名和密码登录，保留原数据。已在原入口部署并完成真实公网业务验证：

https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r25-qa/

不需要另申请登录名或手机/邮箱验证码。角色由服务端邀请码决定；管理员可邀请运营、主播，运营可邀请主播。原管理员使用“运营管理员”和原密码，进入“邀请成员”。作业口令与首次加入邀请码分开。手机说明见 [USER-FLOW.md](USER-FLOW.md)。

## 发行身份

- 版本 `r25-name-invite-20261117`；实现提交 `032b8448c421db08e8aef7e12761c1b98f39f320`，分支 `feat/r25-name-invite-20261117`。
- app SHA256 `7c83ce664b2290be4d0d5326ef63ff7e3ca41f23436d3665e8f63a9ccf49ff1e`。
- ZIP SHA256 `a6f76379262cdcf562983d3e3a3321b678f3485eaa04d22a85c9025bdc223317`；B64 SHA256 `dee92ada3d1a657461fd79cc72554318fbf1cb1b2acfe7b5571d729601e0766b`。
- 29产品文件、全站246。恢复版相比仅改app/config/workflow/workspace/style/manifest，新增name-identity.mjs；其他217资源逐字节保留。后端、测试及私密fixture未装入静态发行包。
- CI PR [135](https://github.com/lijianjun004-star/tcl-v43-preview/pull/135)：head `87b2f87d9a166107eee631e3f65474552d438c3f`，CI [44046616154](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/44046616154) success，merge `aad389f97cdc0da1dc3dfaf8fb818254f1ddec20`。
- 归档发布PR [136](https://github.com/lijianjun004-star/tcl-v43-preview/pull/136)：head `d13477a7e52b5bee5d193c2065a604402259df33`，CI [44047135428](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/44047135428) success；merge `11a14ad53fe18641ee38a9ca6bccd363b0c5902d`。
- Pages [44047332619](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/44047332619) 所有部署步骤success。两PR均核对当前main、精确head及实际CI成功后合并，未改根site.zip/Pages workflow；不声称必需检查规则已保存。

## 已运行的验证

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| 实际HTTPS身份服务、官方Native Auth、云PG业务 | 72/72，保留原4项NOT RUN | [broker-cloud/RESULTS.md](broker-cloud/RESULTS.md) |
| 实际本机产品表单/云业务 | 首轮26/26 | [ui-local/RESULTS.md](ui-local/RESULTS.md) |
| 实际固定公网产品表单/云业务 | 首轮26/26，5份app实响应匹配，页面异常0 | [ui-public/RESULTS.md](ui-public/RESULTS.md) |
| 可信发布门禁及完整双向构建 | 145/145，246更新/245回滚，旧217保持 | [release-gate/README.md](release-gate/README.md) |
| 公网全站HTTP/SHA | 首轮245/246；lib/zip.js一次503，仅补读该项一次后200且SHA匹配；最终246/246，首尾app/manifest一致 | [public-resources/result](public-resources/run-20261117T083236435000Z/result.json) |
| 原数据与定向清理后校验 | 原15行哈希全部不变，原2正式UID映射及姓名别名准确，immutable触发器开启 | [original-data-and-cleanup.json](original-data-and-cleanup.json) |

实际UI只操作产品控件，无配置、SDK或业务成功响应注入。三人独立context验证首次加入、姓名密码重登、作业发布/加入、实际模型选择控件刷新后的第一次本机保存、提交回执、运营反馈、刷新可读及错人隔离。CDP丢弃真实ready开户响应后，页面不假成功；原表单重试以status恢复同UID，register1/status1。测试没有下载模型，不代表ASR或真机验收。

本地真实SQL、模拟Native以及两连接原生PG并发验证见 [BACKEND-VERIFICATION.md](BACKEND-VERIFICATION.md) 与 [local-replay](local-replay/README.md)。源码驱动在 `experiments/r25/tests/name-invite-cloud/`。发布门禁首轮一条夹具把回滚28文件误按新版29文件断言，修夹具后145项通过；原失败说明保留，没有以产品改动或放宽策略通过检查。

## 后台、身份与数据保留

复用既有上海CloudBase；新增隔离Event函数和HTTP路径，通过平台临时STS调用官方管理SDK，仅有效邀请才能创建原生身份。浏览器仍以官方SDK进行密码登录并检查真实UID/角色。业务SQL不保存密码、原邀请码或原operation secret；应用代码不输出密码日志，平台日志配置本轮未审。最终函数/SQL身份、权限实读及隐私边界见后端报告。

原用户不重新开户，旧原生登录名继续兼容；姓名别名映射到原UID。原本机分区保留，不按同名自动认领未认证的旧体验数据，旧文字可只读导出；未上传的媒体仍在原设备。本轮未访问或清理用户真实浏览器。

所有测试只使用本轮专用管理员和三套独立fixture。测试后按9个注册记录、12个测试邀请、准确原生marker和1个专用邀者定向清理10个合成身份及其业务数据。清理事务前后检查原7用户、3邀请、2设置、3幂等记录的15行哈希；原记录全部保留。没有按用户名前缀批量删除，也没有删除未知来源的系统administrator。官方Native删除10成功、0失败；全量UID集合验证恰剩原3身份（含原2正式身份及系统administrator）。原2正式姓名别名/原生用户名/UID映射准确，正式active2、合成profile残留0，提交不可变触发器仍开启。私有媒体未做删除；原设置及存储能力不变。

清理SQL的冻结SHA为 `2253d7293663030fe3630f389edf35db23caafcaa1509e6b6ef076b21fa458f4`；私有原值与删除计划不入仓库。执行前本地纯合成替代夹具13断言通过，越界邀请/反馈会整事务回滚，[本地结果](cleanup-local-surrogate-result.json) 不冒充真实云原值验证。

## 验证边界与回滚

原broker报告的NOT RUN原样保留，补充证据分开记录：后续无效邀请/弱密码两次拒绝请求的官方Native全UID集合10→10不变；最终正式数据审计已独立完成。没有服务器内部CreateUser调用跟踪；真实云端Native创建成功至SQL finalize前的受控崩溃仍未运行，本地模拟恢复和CDP丢响应不能替代它。

物理iPhone/Android、内嵌浏览器、大陆网络和真人/TCL语音准确率本轮未验收。没有新增Gemini业务请求、付费模型API或购买/升级套餐；复用现有套餐资源。

回滚走新PR，仅沿精确相邻发行边恢复上一恢复版归档；后台身份/记录保留，不清浏览器或其他站点。回滚旧前端不会删除新身份，但姓名加入/姓名解析界面需要姓名版前端，恢复服务时须考虑新成员登录入口。

原始公网app响应及实际生成的测试bundle保留原字节（含原有行尾空格），不为格式检查改写取证字节；其余新增手写文件通过git whitespace检查。
