# TCL R24 Paraformer｜运营 Excel 作业专属题库接力（2026-11-23）

## 已确认的真实需求

运营用 Excel 给指定主播布置作业；**一行一题**，含题目、参考答案、型号、SKU、评分要点。运营发布前要检查题目并指定主播；这些题只属于这份作业，**绝不能自动混入公共题库**。主播做完作业提交，运营能看到完成/提交结果。

**冻结的用户体验**：保留 `tcl-r24-paraformer/` 当前 pages3 的全部原 UI 风格、页面结构、姓名进入、摄像头/录像、Paraformer、逐题转写、复盘；本候选只在现有「发布作业」卡片内添加必要的 Excel / 主播选择 / 预览操作，不改原 CSS 或 HTML 文件。

## 当前交付状态

本包是**可移植、经过本地测试的功能实现候选，不是已部署版本**。测试基础为历史 `r24-review-stability-20261116`（22 静态资源）；该源码不是最新 Paraformer pages3，因此**禁止将本包 `preview/` 直接覆盖 `tcl-r24-paraformer/`**。Codex 必须从仓库取得 pages3 真正发行源（PR #158），按任务书保守移植并新建独立测试入口。

- 源仓库：`lijianjun004-star/tcl-v43-preview`
- 当前确认在用的目标入口：`https://lijianjun004-star.github.io/tcl-v43-preview/tcl-r24-paraformer/`
- 正式 pages3 实施 PR：https://github.com/lijianjun004-star/tcl-v43-preview/pull/158
- pages3 `app.js` 已审计 SHA-256：`37eb6128081571861c712c9c1e5d07c75fb498d08091e8f2ee94a48c00ef19ec`
- 历史 R24 测试基线 app SHA-256：`63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816`

## 实现内容

1. 运营选择 Excel、品类、平台、截止时间和主播；浏览器本机解析并预览一行一题（默认最多100题）。
2. 问题、参考答案、型号、SKU、评分要点、来源位置固定进单次作业，SHA-256 标识内容版本；旧版作业可读。
3. 作业发布采用已有本机事务存储；主播只能看到分给该姓名的作业，训练时只读取专属题目快照；不改公共知识库 `localEntries`。
4. 复盘录音和逐题回答沿用既有逻辑，提交后导出可核对版本的 JSON 回执。
5. **特别注意**：R24 静态网页没有正式账号和跨设备同步。已加「导出作业包 → 主播手动导入 → 导出提交回执 → 运营手动导入」，但回执真实性仍需运营核对。这是过渡式本机业务流程，不是假装云端已送达。
6. XLSX 兼容性修复：解析器兼容 `x:row`/`x:c`/`x:v` 以及标准不带前缀的 XML；新增 `题目/作业题目` 表头别名。

## 复验结论

- Node 单元测试 **24/24 PASS**；真实合成 Excel `.xlsx` 含 3 题完成解析，保留 SKU 前导零。
- `app.js` 作为 ESM 的语法检查 PASS；`parser.js` 和 `qa-import.js` 语法 PASS。
- 原 HTML、CSS、训练数据、Whisper 文件字节未改。
- Chromium E2E：**NOT RUN**，当前容器对 localhost 返回 `ERR_BLOCKED_BY_ADMINISTRATOR`。
- 最新 pages3 完整 Paraformer 真机回归、跨设备后端、真实员工 Excel：**NOT RUN**。

## 文件说明

- `implementation/assignment-excel.mjs`：作业隔离、校验、版本与回执纯逻辑。
- `implementation/tools/apply_to_r24.py`：对原历史 R24 文件进行严格定位的移植脚本；目标源不符会报错并停止。
- `implementation/tests/*`：单元和 XLSX 兼容性检查。
- `example/`：**人工虚构**的 TCL 产品 Excel 测试样本，绝非正式审核话术。
- `preview/`：旧 R24 界面适配验证文件，非 Paraformer pages3 的可覆盖安装包。
- `evidence/`：执行日志、哈希、版本范围与代码差异。