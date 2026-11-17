# R25 注册中断恢复修复｜待发布候选

任务 TCL-R25-REGISTRATION-RECOVERY-20261117；ChatGPT 负责、当前 Codex 执行，并行内部代码复核及测试，未新增 Gemini/Claude 外部业务请求、付费 API 或线上变更。

基线：用户返回的 Gemini/Claude 复验包；源码 f5dee44471bb54c850118f9d94e1536e24df7ddc。实时 main 经 git/gh 只读核对仍为 c658a4a7af6a608a22f2708d3832e67746ed8136，现版为 name-invite；PR138 仍 draft/open，head86b35d8，原检查成功。不要整体合并本源码分支，其发行归档仍是历史旧版。

## 修复结果

- 未到服务端的误选身份：凭同一 operationId/secret 查询不到预约后，可改选主播/运营。网络不确定时保留原凭据；服务端已有预约始终固定原身份。并发晚到请求后通过持有秘密的 status 读取权威身份，不创建第二个预约或修改原身份。
- 丢失浏览器恢复凭据：仅可信管理员核验本人和原生身份后，离线工具生成私有恢复码及 proof-only SQL。003 在原操作锁、行锁、旧 proof/精确快照 CAS 下只轮换哈希，不删除预约或改原姓名、角色、UID、原生用户名、marker、密码。已完成账号和旧邀请预约拒绝轮换。
- 网页新增“注册中断 · 使用恢复码”。先验证服务端状态，再以本机快照 CAS 替换恢复信息；旧注册响应和旧恢复码迟到响应均不能覆盖新凭据。仍需首次密码，不产生自动登录。
- 保留001/002原文件。部署顺序002→003→身份函数→真实验收→CI→前端；003后不得重跑001/002覆盖函数。回退仅前端，保留恢复兼容后端。

管理员操作细节见 backend/r25-name-identity/API_CONTRACT.md。SQL成功执行不代表轮换成功，必须看到 ok=true、data.rotated=true 才能私下交码。恢复码不可公开、不可放URL、日志或仓库。忘记密码须另走经核验的官方Auth恢复，不通过此工具重置。

## 实际验证

- 四套前端 Node：54/54。
- 后端 handler + PGlite：20/20（原12+新增8）。
- 加载003并重复迁移后的 ACL/RLS：102/102。
- 跨层集成：1/1，实际client→handler→PGlite，原生Auth为测试替身；覆盖建原生账号前/后的丢凭据恢复和未送达改身份。
- Chromium原DOM：7/7；恢复DOM及跨页面真实IndexedDB：7/7，身份响应为合成数据。
- 最终发布门禁：162/162；真实归档从当前name-invite和原direct候选分别更新/回退，217旧资源逐字节保留，总246。
- 独立复核发现恢复码导入竞态，已修复并经Node及真实IndexedDB回归；当前复核未发现阻断项。
- 首轮改写full-build复现脚本时误用循环变量覆盖基线字节，脚本TypeError；已修正脚本并完整重跑，非产品失败。浏览器测试新增用例时夹具出现过语法错误，修正后7项通过。

不同范围不合并为单一通过率。verification/保留本轮日志。build_candidate.py可重建精确归档；full-build.py需git历史与构建依赖，可复现完整归档验证。

## 冻结发行身份

版本 r25-registration-recovery-20261117；29产品文件。相对main仅app-config.json、cloud-workflow.mjs、cloud-workspace.mjs、name-identity.mjs、static-manifest.json变化；相对原direct候选仅后四项。

ZIP SHA256 365363d043f6aa88f43746373b9a1842c00d56e0a6b378073fc5b46eba3cc034；B64 SHA256 b7de6c8cc7e5fd718156af495711c6b122438a623674bc6c67ded20c44e905fb。归档在candidate/，没有替换根site.zip或工作区历史发行归档。

## NOT RUN 与发布边界

真实CloudBase迁移/函数更新/多连接PostgreSQL竞态、真实Auth故障注入/密码登录/业务媒体权限、手机及大陆网络、GitHub正式合并及Pages发布均未执行。局部合成结果不能代替这些验收。按本次用户交接要求，正式合并或发布前须提交精确变更和测试结果确认。
