# TCL R24 Excel 作业跨设备同步试点

基于已经发布的 QA3 `r24-paraformer-excel-assignment-20261123-qa3-review-fixes`。GitHub main 参考提交 `5c3de29946777454cca367d15abe7db6cd6723f5`，原站清单 SHA-256 `ce897151ee99aeed5b9b946c27119b3a6b9f74ab372903b147b68a7a0e2556e1`。本试点已在现有上海 CloudBase 环境的独立路径部署，并完成公网双浏览器验收。实体手机和真实业务账号尚待验收。[上海部署记录](evidence/shanghai/README.md)。

## 业务流程

1. 运营输入已登记姓名进入，上传并预览 Excel 后发布。服务端验证作业发布者和冻结题目，将作业发布给同团队主播。
2. 主播输入自己的已登记姓名进入，按运营姓名或作业标题搜索并领取训练。用当前作业版本继续原有逐题复盘。
3. 主播主动点「提交到云端」。服务端确认后页面显示「已提交到云端」。网络中断时保留本机复盘，并允许重试相同场次。
4. 运营在另一台设备用原运营账号登录，打开「作业进度」后选择「查看云端提交」。已打开工作台时可点「刷新云端作业」读取新发布作业，再查看最新提交。当前阶段以打开或刷新工作台读取为准。

云端只接收答复、转写和作业版本。录像、录音和自由练习留在主播设备。既有 QA3 本机作业与回执继续使用原存储，新试点按 CloudBase 环境与真实账号隔离本地草稿，不自动导入或补发旧记录。配置为空时保留人工 JSON 交接，界面明确显示本机保存。首次使用某台设备时，先输姓名，再输入管理员发放的一次性设备码。之后同一浏览器只填姓名，退出页面不会移除绑定。绑定有效期 90 天，新设备、清除浏览器数据、过期或撤销后须领取新码。R24 设备码不互通 R25，也不改写任何原账号密码。

## 在本机准备候选

使用 Python 3.11 或更新版本。从原 LITE 发布包补齐 4 个模型，先核验 QA3 的 36 个文件。然后执行以下命令。输出目录必须尚不存在。

```sh
python3 stage-site.py /path/to/verified/tcl-r24-paraformer-excel-qa site
```

将实际试点环境 ID 和 HTTPS 作业网关地址交给构建脚本可生成云端登录版。请用新的输出目录。

```sh
python3 stage-site.py /path/to/verified/tcl-r24-paraformer-excel-qa candidate-cloud \
  --env-id YOUR_ISOLATED_ENV_ID --api-base https://YOUR_HTTP_GATEWAY/api/tcl-r24-sync
```

构建只复制和校验原包，替换候选的应用入口，加入作业 API 访问层并生成 37 文件哈希清单。原版模型、收音录像、题库与 Excel 校验代码沿用 QA3。

## 验证与联调

```sh
node --test backend/tests/*.test.mjs
(cd tests && npm ci && npm test)
(cd cloudbase && npm ci && npm test)
```

先在试点环境中开通 CloudBase 用户名密码登录，准备一个运营和一个主播账号，录入受服务端保护的角色和团队。部署 HTTP 函数与数据库配置方法见 [CloudBase 适配说明](cloudbase/README-CloudBase.md)。[接口说明](backend/API.md)列出请求、校验和重试规则。[浏览器复验](tests/README.md)说明如何复现本机验证。

真实验收需要两台手机、两个账号。运营发布一份试点 Excel，主播领取并提交，运营无需接收 JSON 即可看到同一场答复。增加一个其他团队账号确认看不到该作业，测试弱网重试后运营只收到一条记录。用试点资料执行，确认本地验证与公网验证的证据再确定正式切换时间。
