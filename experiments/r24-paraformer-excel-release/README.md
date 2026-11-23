# R24 Excel 专属作业 QA｜2026-11-23

这是独立测试入口，供运营验证 Excel 专属作业与人工回执流程。原 R24 Paraformer、历史 R24、R25 和腾讯云镜像继续使用原版本。本版本没有新增自动作业后台；跨设备需要人工传递 JSON，录音录像保存在各自浏览器。

## 入口和冻结版本

- [打开 Excel 作业测试版](https://lijianjun004-star.github.io/tcl-v43-preview/tcl-r24-paraformer-excel-qa/)
- 页面版本：`r24-paraformer-excel-assignment-20261123-qa1`。
- [冻结源码 ceee762](https://github.com/lijianjun004-star/tcl-v43-preview/tree/ceee762ef092837e17ab680bdb41c0d1ba55e229/experiments/r24-paraformer-excel-assignment)。原型目录里的旧 README、TEST_REPORT 和 CODEX_TASK 记录的是早期交接状态；本文件与主分支 AI_CONTEXT.md 中的最新记录优先。
- 发布提交：`1ff721925f826717fb63a8594766e35a812d08ab`；[发行 PR162](https://github.com/lijianjun004-star/tcl-v43-preview/pull/162)。
- 精确发行前端 ZIP SHA256：`29c2ac4c491b54c467aa31fcdfa68c0b882dbaf227b5869d977c81b11737396c`。
- app.js SHA256：`bb652c23ee3523e3415f4fbe5941b94c8765c0940063e8d5c47583903ff1ab82`。
- 版本来源为正式 pages3，原输入 ZIP SHA256：`dec534aac5467b07fba730e422f14200d26e3293fd1f964bf1c4ff88d8f33fa5`。
- 部署与公网核对：[Pages 运行 45136397011](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/45136397011)完成且成功；全部 352 个公网文件 HTTP 200，SHA256 与冻结静态树一致。

## 六步使用

1. **运营创建并预览。** 以原姓名入口选择运营，填写作业名称、品类、平台、截止时间及接收主播，上传 Excel 并预览题目、参考答案、型号、SKU、评分要点。当前验收使用合成的 XLSX/XLS 文件；运营真实表格仍需提供后核验，不能据此要求运营重做模板。
2. **运营确认发布。** 题目和接收名单形成固定快照，仅属于这份作业；修改原 Excel 不覆盖已发布作业。需要改题时发布新作业。
3. **运营传递作业包。** 点击“导出作业包给主播”，通过双方已有渠道发送 JSON。页面发布成功只代表本机保存，不代表主播收到。
4. **主播导入与练播。** 在本测试入口以名单中的姓名进入，导入 JSON，再从待完成作业按顺序答题、录音、转写和保存。未导入的跨设备作业不会自动出现。
5. **主播明确提交。** 全部题目均有有效回答后，明确提交并下载文字回执 JSON，人工发回运营。录音录像继续保存本机；文字回执不包含自动媒体上传。刷新后可恢复并再次导出回执。
6. **运营收件核实。** 在原浏览器和原运营姓名下导入回执，查看逐题回答与作业归属。“回执待核实”需要核对发送者；姓名与哈希校验不是身份认证。未收到回执也不能认定主播未完成。

## 本次保留和修复

- `index.html`、`style.css`、`training-boards.json`、`legacy-65.json` 与正式 pages3 逐字节一致。原姓名入口、主要布局及按钮行为保留，作业卡片增加 Excel、接收主播与 JSON 交接控件。
- Excel 不进入公共题库。发布快照、导入对象、提交身份、完整题数、逐题内容、型号/SKU 和回执版本均检查；空答、漏答、重复题、错版本或同会话冲突回执会拒绝。
- 京东/天猫沿原共享规则，抖音独立。QA 数据库、通知频道、术语、模型偏好及缓存使用独立名称，不迁移或清理正式站数据。
- 修复切题时播放器仍在加载、地址已被撤销的问题：先暂停并取消旧预览加载，再撤销地址。原始录音 Blob、录制、ASR 和录像业务逻辑保留。

## 实测证据

[最终浏览器及模型运行 45135920009](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/45135920009)对应上述冻结源码及完全相同的前端 ZIP。

| 检查 | 结果及范围 |
|---|---|
| 作业规则和 UI 生命周期 | 78/78，通过；其中纯模块 69 项、UI 辅助与媒体清理 9 项，零跳过 |
| 精确正式源码构建保护 | 9/9，通过 |
| Chromium 作业与媒体流程 | 54/54，通过；实际上传 XLSX/XLS、人工 JSON 往返、负向回执、三个尺寸、数据隔离；原生 MediaRecorder 配合合成设备，业务流程中的 ASR 使用明确的测试替身 |
| 实际录音录像回放 | 三段原始逐题录音均完整播放；整场原始录像可播放且时间前进 |
| 独立真实 Paraformer | 13/13，通过；真实 Worker/WASM/模型，固定 SHA 的公开 5.55 秒普通话录音，无模型结果替身；不等同手机或业务语料准确率验收 |
| 发布门禁 | 229 项通过；[PR161](https://github.com/lijianjun004-star/tcl-v43-preview/pull/161)建立独立规则，[PR163](https://github.com/lijianjun004-star/tcl-v43-preview/pull/163)固定最终 ZIP；[发行精确提交检查](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/45136262772)成功 |
| 静态资源 | 新目录 36 项：32 项前端与 4 项模型；旧 316 项构建时逐字节保留，总计 352 项；公网 352/352 返回 HTTP 200 且 SHA256 全部一致（首次351项，中文文件名正确编码后补核1项） |
| 真实业务 Excel／物理手机 | 未运行：尚未取得运营实际表格；物理 iPhone/Android、大陆实际网络、真人 TCL 口播未验收 |

前三轮浏览器失败没有被忽略：第一轮补齐结束确认弹窗操作，第二轮使测试遵守原有 700 毫秒防连点，第三轮发现并修复真实媒体地址生命周期错误；第四轮全部通过。原始失败运行分别为 45134335634、45134862378、45135212195，可在 GitHub Actions 追溯。

## 交付包与复验

- [完整复验包（约 97 MB）](https://github.com/lijianjun004-star/tcl-v43-preview/releases/download/r24-excel-qa-20261123/R24_Excel_QA_20261123.zip)，包含模型、源码、测试证据及回滚说明；[发行页](https://github.com/lijianjun004-star/tcl-v43-preview/releases/tag/r24-excel-qa-20261123)。完整包 SHA256：`30233880a3d03fb9c6b8c260c4bada17d706b6465ca4911fa543af97a133db2a`。发布后已下载回读并验证哈希，[交付运行 45137820122](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/45137820122)成功。

完整包的 `frontend/tcl-r24-paraformer-excel-qa/` 包含 36 个文件及固定模型；`source/` 为构建补丁和测试源码，`evidence/` 保存结果、日志及版本检查。模型组件许可随原目录保留。`SHA256SUMS` 可校验包内文件。

本机预览：在解压目录运行 `python3 -m http.server 8765 --bind 127.0.0.1 --directory frontend`，再打开 `http://127.0.0.1:8765/tcl-r24-paraformer-excel-qa/`。不要直接双击 HTML；模型和浏览器模块需要 HTTP 环境。

完整重建及浏览器复验使用冻结 Git 提交与随附 CI 工作流。安装依赖及首次下载模型需要网络；运行条件、模拟设备和公开样本来源均在测试源码／证据中明确记录。

## 尚未交付

- 自动跨设备分配作业、主播登录即自动收件、提交直达运营、集中进度和媒体同步。
- 服务端身份认证与可靠权限。现有 R25 后台没有因此自动接入本 QA。
- 原正式 R24 入口升级、运营真实 Excel 兼容性和真实人员／手机验收。

## 回滚

以届时主分支新建独立 PR，仅删除 `.github/workflows/pages.yml` 中名称为 `Stage isolated R2.4 Excel assignment preview` 的完整新增步骤，以及 `experiments/r24-paraformer-excel-release/site-only.zip`。精确反向门禁通过后合并，等待 Pages 成功并检查原站。不要恢复整份历史工作流、覆盖旧发行归档或清理浏览器数据。
