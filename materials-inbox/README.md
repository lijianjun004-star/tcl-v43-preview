# 上传练播资料，下载审核题库

**本仓库公开。仅上传可公开的商品卖点或已脱敏场景。严禁提交未公开定价、客户或主播隐私、内部机密文档。** 上传到 GitHub 就会公开。出题前的检查只能阻止向模型发送资料，无法撤回已经公开的提交。

## 上传到出题

1. 管理员在[仓库 Actions 变量](https://github.com/lijianjun004-star/tcl-v43-preview/settings/variables/actions)中将 `R24_INBOX_AUTO_ENABLED` 设为小写 `true`。未开启时，推送运行会说明跳过原因。
2. [上传资料到收件箱](https://github.com/lijianjun004-star/tcl-v43-preview/upload/main/materials-inbox)。资料提交到 `main` 或资料 PR 合入 `main` 后，新建和修改的资料会触发出题。每次最多 **3 份**，每份最多 **100 KiB（102,400 字节）**。每份资料单独出一套题，默认每套 10 题，最多 50 题。根目录的 README.md 和 .gitkeep 不参与出题。
3. 打开[资料出题工作流](https://github.com/lijianjun004-star/tcl-v43-preview/actions/workflows/r24-materials-inbox.yml)，选中对应提交。运行摘要会列出每份资料对应的编号目录、品类、平台、题数、模型、token 用量和文件 SHA-256。在 **Artifacts** 下载压缩包，保留期 14 天。每个编号目录都有 `questions.xlsx`、`questions.tsv`、`questions.json` 和 `run-summary.json`。
4. 在[上海试点运营端](https://unknown-roadrunner-d7cap6e21f517-1519058345.tcloudbaseapp.com/tcl-r24-cloud-sync-pilot/)选择与资料一致的品类、平台，上传该目录的 `questions.xlsx` 并点击 **解析并预览作业题目**。每题含一条模拟顾客弹幕、参考话术和评分要点。由运营核对商品参数、价格和服务承诺，再确认发布。

## 可上传的资料

| 文件 | 读取方式 |
| --- | --- |
| `.txt`、`.md` | UTF-8 纯文本，可含 UTF-8 BOM。适合顾客画像、练播场景、商品卖点。 |
| `.csv`、`.tsv` | UTF-8 表格文本；表头和各行一起作为资料交给模型。 |
| `.xlsx` | 读取普通工作簿的可见工作表单元格。使用静态文字或数值。复杂文件可另存一份仅保留值的表格再传。 |

文件数、大小、格式、元信息和敏感信息检查都在整批出题前执行。发现疑似密钥、11 位大陆手机号、18 位身份证号或电子邮箱会拦住整批，只报告类别和安全文件名。超额会报错，请拆分或压缩资料内容后再提交。普通 ZIP、旧版 XLS、Word、PDF 及图片不在支持范围内。

Excel 按工作簿顺序读取所有可见工作表。列之间用制表符分隔，工作表之间留空行。隐藏表、行、列及支持的 XML 元数据会接受敏感信息扫描，可见正文才用于出题。日期、金额按存储值读取；需要精确展示时，请先把显示值转换成文字。单元格公式、外部引用、宏、批注和图片等复杂部件会被拒绝。命名区域作为元数据扫描。单份 Excel 最多 128 个 ZIP 条目、4 MiB 解压 XML、32 张工作表、20,000 个单元格。扫描文本最多 8 MiB，拼出的可见 UTF-8 正文最多 100 KiB；超过任一上限都会整份报错。

整批通过预检后按文件顺序调用模型。若后面的文件生成失败，已完成的调用可能产生费用，整批不会上传半成品。GitHub 的 Re-run 会跳过；重新发起手动生成会产生新的调用。

## 指定品类、平台和题数

默认值为电视、京东、10 题、`gpt-4o-mini`。平台只接受京东、天猫或抖音。可以直接命名为 `电视_天猫_12题_大屏入户.xlsx`，也可以在文本顶部连续写入以下字段。头部有效值覆盖文件名中的有效值；有冲突的重复字段、无效的平台或超范围的题数会报错。

```text
---
category: 电视
platform: 抖音
count: 3
---
顾客住高层，担心大屏电视搬不进家。请主播引导顾客核对外包装尺寸、电梯轿门和入户转角，请配送人员确认可行性。
```

## 手动演练与每周刷新

- **手动选文件**。在[工作流](https://github.com/lijianjun004-star/tcl-v43-preview/actions/workflows/r24-materials-inbox.yml)点 **Run workflow**，选择 main，`file` 填收件箱里文件的完整相对路径。勾选 `dry_run` 会生成合成样题，模型请求与用量为零。未勾选时是真实付费生成。此显式手动入口可在自动开关关闭时使用。
- **手动粘贴文字**。原[手动批量出题](https://github.com/lijianjun004-star/tcl-v43-preview/actions/workflows/r24-batch-questions-export.yml)仍可选品类、平台、题数、模型，接受最多 20,000 个 UTF-16 字符单元。
- **每周刷新**。如需周期出题，在开启总开关后，再把仓库变量 `R24_WEEKLY_FILE` 设为固定资料的完整路径。计划为每周一北京时间 09:00，GitHub 调度可能延迟。删除该变量可单独关闭周任务。真实模型运行按实际用量计费。
