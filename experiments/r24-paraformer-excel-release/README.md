# TCL 练播房 R24 Excel 专属作业 QA2｜运营姓名搜索、自主领取

本文件以 2026-11-23 已成功发布并复验的 **QA2** 为当前版本。原正式 R24、历史 R24、R25、CloudBase 镜像及已有页面路径不变。本 QA 继续是**浏览器本地数据＋人工 JSON 交换**，不是已经接入共享运营后台的产品。

## 当前入口与冻结发布证据

- [手机网页：R24 Excel 作业 QA2](https://lijianjun004-star.github.io/tcl-v43-preview/tcl-r24-paraformer-excel-qa/)；固定路径不变。
- 页面版本：`r24-paraformer-excel-assignment-20261123-qa2-operator-search`。
- 前端发行 ZIP `experiments/r24-paraformer-excel-release/site-only.zip` SHA-256：`a99012ad503baedd404a1c8ed6e4ffb304a07372e6641ec9367a42343035a9d6`；`app.js` SHA-256：`8af5310dbe54250c6a19dbe25f00cfc0d103a4b29fe0242bf2995522cd3f82f9`；`assignment-excel.mjs` SHA-256：`e7bb2a73a2e63b35e687d7a0e4c3d4e996f0dd5330e312d055cbe79e373763af`。
- 原正式 pages3 输入 ZIP SHA-256：`dec534aac5467b07fba730e422f14200d26e3293fd1f964bf1c4ff88d8f33fa5`。仅对应作业 `app.js`、`assignment-excel.mjs`、静态清单变更，其余正式资源不变。
- [QA2 源码及 PR #165](https://github.com/lijianjun004-star/tcl-v43-preview/pull/165)，已跑完全量测试的源码提交 `33fdfa6298bba31cba2b98f5e12231acd0d09718`。新增的发布/公网验证 workflow 为源码分支后续独立提交，不更改被验证的业务代码。
- [发布校验 PR #166](https://github.com/lijianjun004-star/tcl-v43-preview/pull/166)合入 `3833f0be01848bd77cf7a612cb4ff3c9e3513da1`；[QA2 发布 PR #167](https://github.com/lijianjun004-star/tcl-v43-preview/pull/167)合入主分支 `ac64863acdb3238ee2efaa3765c14b24659b9e43`。
- [Pages 成功运行 45142722021](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/45142722021)；[公网 8 资源 SHA-256 检查 45142987868](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/45142987868)成功。

## 当前作业业务流程（六步）

1. **运营创建作业。** 进入原运营姓名入口，填作业标题、品类、平台、截止时间；上传运营现有 Excel（XLSX/XLS）并预览问题、答案、型号、SKU、评分要点。**不再要求填写主播名单。**
2. **运营发布。** 本次 Excel 题目成为仅属于这份作业的固定快照，默认所有主播可以自主领取；题目不混入公共题库，修改源 Excel 不会改变已发布记录。旧的指定姓名名单作业仍受原名单限制。
3. **运营发作业 JSON。** 当前发布操作只保存至运营本机浏览器；其他手机看不到此作业，须运营通过已有渠道发送 JSON 作业包。
4. **主播搜索与领取。** 主播输入自己的姓名，导入收到的 JSON，再在“运营作业”按**运营姓名**搜索并主动领取，完成逐题练播、录音、转写和复核。主播姓名用作领取／提交记录，**对 QA2 公开作业不做预分配限制**。
5. **主播提交回执。** 完成全部题目后主动提交，导出文字回执 JSON 并人工传回运营。音视频暂只保留在主播浏览器，不随 JSON 自动传送。
6. **运营核实。** 运营在原浏览器、原运营姓名下导入回执，能够看到实际提交人和逐题回答；标记“回执待核实”。姓名和 SHA-256 不构成服务端身份认证，未收到回执不能判定主播未完成。

**关键界限：** “公开自主领取”指**对已进入该浏览器数据中的作业不再要求姓名预先在名单里**；不等于跨手机自动发现、同步或授权。要实现真正的登录即可搜索运营作业、提交直达后台，必须另行接入受认证保护的共享服务端。

## QA2 验收（以实际运行记录为准）

| 检查 | 结果 |
|---|---|
| Excel 作业规则、身份和 UI 生命周期 | [80/80 PASS](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/45141447932) |
| 源码/补丁与原有资源隔离 | [10/10 PASS](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/45141447932) |
| Chromium 实际 XLSX/XLS 导入、姓名搜索、公开领取、音视频/回执 | [57/57 PASS](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/45141448081)，使用合成设备和业务流 ASR 测试替身 |
| 独立真实 Paraformer Worker/WASM/普通话样本 | [13/13 PASS](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/45141448081) |
| QA2 版本升级／安全回滚门禁 | [231 项 PASS](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/45142327800)，QA1/QA2 仅三项变更 |
| Pages 构建、部署及公网资源 | [Pages SUCCESS](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/45142722021)；[8/8 HTTP 200 + SHA-256 匹配](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/45142987868) |
| 真实运营 Excel、物理 iPhone/Android、国内网络、TCL 真实口播 | **未执行／未验收** |

保留与正式 pages3 字节相同的 `index.html`、`style.css`、`training-boards.json`、`legacy-65.json`；继续单独使用 QA 数据库、频道、缓存，不改动正式训练题库/音视频/ASR 代码。浏览器测试使用合成 XLSX/XLS、合成摄像头／麦克风，并不等于真实手机验收。

## 历史 QA1 复验包（不是最新 QA2 安装包）

- 原 QA1 版本为 `r24-paraformer-excel-assignment-20261123-qa1`，归档前端 ZIP SHA-256 `29c2ac4c491b54c467aa31fcdfa68c0b882dbaf227b5869d977c81b11737396c`。
- [历史 QA1 完整 97 MB 复验 ZIP](https://github.com/lijianjun004-star/tcl-v43-preview/releases/download/r24-excel-qa-20261123/R24_Excel_QA_20261123.zip)，含模型、测试证据、源码、回滚说明，完整包 SHA-256 `30233880a3d03fb9c6b8c260c4bada17d706b6465ca4911fa543af97a133db2a`。
- 旧版 [测试 45135920009](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/45135920009) 的 78/9/54/13、旧版公网 352/352 SHA 对齐，是 **QA1 历史证据**；不可冒充 QA2 的新测结果。

## 未交付与回滚

- 未交付跨设备自动发布与搜索、云端用户身份鉴权、提交直达运营、集中实时进度、音视频跨设备同步；现有 R25 后台并未自动接入 QA2。
- 当前 QA2 的精确回滚可以新建 **仅替换 `experiments/r24-paraformer-excel-release/site-only.zip` 为原 QA1 固定 ZIP** 的 PR，按发布门禁确认通过后合入，再等待 Pages 成功；禁止同时修改原站或回滚整份历史工作流。若完整撤销独立 QA 站，须按已有发行策略另行审核。
- 后续取得真实运营 Excel 后只检查兼容性，不要求运营为系统重做工作表。
