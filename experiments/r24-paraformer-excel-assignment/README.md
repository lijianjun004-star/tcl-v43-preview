# TCL R24 Paraformer｜运营 Excel 专属作业最小增量｜2026-11-23

## 目标与边界

此包是 **独立开发与 Codex 复验交接包，不是已上线的安装包**。目标是将现有 R24 pages3「运营发布作业」接上 `.xlsx/.xls` 的逐题内容，形成**不可在原作业里静默改题**的题目快照，指定接收主播，主播按表中原题逐题练播、提交，运营跟踪和人工查看回执。公共题库不能混入这些作业题。

**冻结项：原 R24 的 `index.html`、`style.css`、训练页布局、原登录逻辑、Paraformer / Whisper / Vosk 模型与录制复盘逻辑均不主动调整**。本次仅在现有「发布作业」卡片里增加必要控件及最小状态代码；工作表仅在浏览器本机解析，不发给外部模型。不要迁入 R25 的密码、邀请码或管理员登录。

## 已取得的原始依据

- GitHub 仓库：`lijianjun004-star/tcl-v43-preview`。
- 当前目标入口：`https://lijianjun004-star.github.io/tcl-v43-preview/tcl-r24-paraformer/`（国内腾讯静态托管也有镜像）。
- **真实 pages3 源**：`experiments/r24-paraformer-release/site-only.zip`；历史官方 ZIP SHA256 `dec534aac5467b07fba730e422f14200d26e3293fd1f964bf1c4ff88d8f33fa5`，`app.js` SHA256 `37eb6128081571861c712c9c1e5d07c75fb498d08091e8f2ee94a48c00ef19ec`；如发生变更必须停止对旧版本打补丁。
- 附带的 `candidate/Historical_R24_Excel_Offline_Proof.zip` **是旧 R24 review-stability 的离线代码验证样本**，无 pages3 Paraformer 模型，严禁直接部署它来覆盖 `/tcl-r24-paraformer/`。
- 保留 22 文件历史 UI 校验基线 `R24_Original_Historical_22files.zip` 用于复现实验，不是本轮 pages3 最新源码。

## 用于 Codex 的最短运行命令

在已检出并核实的仓库根目录，且机器可运行 Python3 和 Node.js 时：

```bash
python3 '<解压本包的目录>/source/tools/build_from_official_r24.py' \
  experiments/r24-paraformer-release/site-only.zip --out /tmp/tcl-r24-excel-candidate
node --test '<解压本包的目录>/source/tests/assignment-excel.test.mjs'
```

**注意：** 本包 `source/tests/assignment-excel.test.mjs` 使用相对历史测试源路径；在独立复验环境先按目录结构运行现成的 `verification/` 对照测试，或由 Codex 根据本仓库的 `lib/qa-import.js` 显式修正测试导入路径，不能把导入路径失败写成产品缺陷，也不能跳过测试宣称通过。

上述脚本**不会部署或修改仓库原文件**，只在 `--out` 指定目录写候选和构建记录。源版本哈希不匹配会退出并停止。

## 已运行的测试与限制

- R24 历史源码的最小补丁：**PASS**，Node `--input-type=module --check` PASS。
- 本地 Excel 模拟表结构及作业快照单测 **22/22 PASS**；Python 代码保护测试 **5/5 PASS**。
- HTML、CSS、training-boards、legacy、原始音频模型桥和 Worker 的字节保持。除新增 assignment-excel.mjs 外，必要变更仅 app.js、静态 manifest、lib/parser.js 和 lib/qa-import.js（新增 Excel XML 命名空间及题目列别名兼容）。
- **pages3 官方 ZIP 本轮未能拷入受限容器并执行构建，必须由 Codex 使用准确历史 SHA 完成真实 pages3 包重建与浏览器回归。**
- Chromium 本容器 `Page.goto` 被 `ERR_BLOCKED_BY_ADMINISTRATOR` 阻断，**浏览器 UI/真机/云端往返测试 NOT RUN**。不要把单元测试等同真实作业交付验收。

## 跨设备边界

R24 pages3 目前是静态站 + 本机 IndexedDB，并不具备已认证的云端运营/主播账号后台。本次提供**离线手动交换包**：运营发布本地作业后「导出作业包 JSON」，把文件发给指定主播；主播用现有姓名进入并导入；主播提交后下载文字回执 JSON，再由运营导入并**人工核对**。不会自动跨设备推送、上传录音录像或实现可信权限认证。需要全自动跨设备作业、提交与媒体上传，必须另接服务端鉴权/存储，在独立任务中验收；禁止把姓名输入和 JSON 校验哈希冒充安全身份认证。

## QA3 候选（2026-11-23，未部署）

在 QA2 的全部补丁之后追加 `tools/apply_to_r24.py` 的 `qa3_review_fixes()`，版本 `r24-paraformer-excel-assignment-20261123-qa3-review-fixes`。修复两轮独立复验发现的问题：人工回执逾期标记丢失、噪音被识别为重复字答案、折叠按钮竖排、列表截断无提示、重复导入提示。详细问题、处理和 NOT RUN 范围见 [TEST_REPORT.md](TEST_REPORT.md) 的 QA3 一节。新增 `tests/browser_adversarial_e2e.py`，CI 在 `r24-excel-assignment-qa.yml` 中运行。QA3 未改发布门禁和 Pages，部署须另走门禁 PR + 发行 PR。
