# R25 姓名与邀请码登录已发布

用户要求首次用姓名、自设密码和邀请码加入主播端或运营端，之后姓名密码登录，保留原数据。已部署到固定入口：
https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r25-qa/

当前权威状态见根AI_CONTEXT.md最新同任务段。完整实现/测试/失败边界/公网字节与原数据保全证据冻结于 [9a194482c343ed2f01b0ba313904481157f598f0](https://github.com/lijianjun004-star/tcl-v43-preview/blob/9a194482c343ed2f01b0ba313904481157f598f0/evidence/r25-name-identity/DEPLOYMENT.md)。版本r25-name-invite-20261117，app7c83ce66…，ZIPa6f76379…。

CI PR135 / run44046616154；发布PR136 / run44047135428；merge11a14ad53fe18641ee38a9ca6bccd363b0c5902d；Pages44047332619所有步骤成功。实际云API72、本机产品UI26、公网产品UI26、发布门禁145通过。其他217资源不变，新版29产品/全站246；公网首轮245，唯一503项补读后246匹配，首尾版本一致。

原15行业务数据Hash全部保持，原2正式UID及姓名别名保持。定向清理10个专用测试身份（官方删除10成功0失败）及业务样本，保留原系统administrator；未清浏览器或私有媒体。新增成员不需单独技术账号或验证码；邀请码决定角色。管理员可发运营、主播邀请，运营可发主播邀请。

真机/大陆网络/真人语音及Native创建至SQL finalize之间的真实受控崩溃仍未验收，不以本地模拟或CDP丢响应替代。未新增Gemini请求、购买/升级套餐或付费模型API。
