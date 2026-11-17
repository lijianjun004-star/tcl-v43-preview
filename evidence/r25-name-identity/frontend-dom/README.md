# 姓名加入与登录前端验证

代码：`experiments/r25/tcl-v352-asr-r25-qa/`。`app.js` 保留本人checkpoint读取就绪门禁、UID分区、ASR和旧数据逻辑；新增最小会话guard在分区异步读取后、显示前核对真实nativeUID，并保留原sequence检查。

- `node --test experiments/r25/tests/name-identity.mjs experiments/r25/tests/cloud-workflow.mjs`：33项通过，见node-tests.log。
- `R25_NAME_UI_EVIDENCE=... node experiments/r25/tests/name-login-ui.cjs`：Chromium实际DOM和原生IndexedDB，身份HTTP/Auth/业务为测试替身，无云写入。分组结果、源码SHA、390px截图见result.json/name-entry-mobile.png。
- 默认首次加入使用姓名、设置密码、邀请码三字段。后续姓名登录仍由官方Auth验证密码和nativeUID。
- 新开户先在独立IDB单事务保存姓名、operationId、256位operationSecret，未保存密码或邀请码。响应丢失查询原操作；NOT_FOUND继续同一操作，不换秘密或UID。
- 姓名身份服务配置保持关闭、endpoint为主任务已实测只读入口；正式handler部署并验证后方可启用。真实云开户、邀请码绑定、旧UID/数据保留和跨设备验证由主任务及独立真实测试执行，以上测试不证明云服务已接通。

前端没有修改manifest、归档、CI或云资源。角色来自服务端邀请，首次加入表单没有角色选择。管理员可邀请主播/运营，运营入口仅提供主播。

整页竞态验证见 `../frontend-auth-drift/result.json`：实际应用DOM/原生IndexedDB15项通过；只为控制时序替换身份SDK、HTTP及业务返回，未调用云。
