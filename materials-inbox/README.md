# 上传资料，生成练播题库

这个仓库公开。提交前请确认资料可以公开，也可以先移除内部价格、客户姓名和联系方式。提交到 GitHub 时资料就会公开。

1. 用有仓库写入权限的账号[上传资料](https://github.com/lijianjun004-star/tcl-v43-preview/upload/main/materials-inbox)。手机和电脑都可以操作。选取 UTF-8 编码的 `.txt`、`.md` 或 `.csv` 文件，例如电视选购场景、商品卖点清单或问答素材。文件应能单独提供出题依据。
2. 点击 **Commit changes**。如果使用分支，请将资料 PR 合入 `main`。一次提交可以放多份资料，同一次推送的新增资料合并生成一份题库，共 10 道 TCL 电视京东口播题。总长度上限为 20,000 个 UTF-16 单位，含两份资料间的换行，常用汉字每字计一个单位。
3. 打开[自动出题运行记录](https://github.com/lijianjun004-star/tcl-v43-preview/actions/workflows/r24-materials-inbox.yml)，选对应提交的运行。成功后从 **Artifacts** 下载 `r24-questions-运行编号`，解压取出 `questions.xlsx`。请在 14 天内下载。包内还含 TSV、JSON，以及记录用量和文件 SHA-256 的 `run-summary.json`。
4. 在[上海试点运营端](https://unknown-roadrunner-d7cap6e21f517-1519058345.tcloudbaseapp.com/tcl-r24-cloud-sync-pilot/)选择 **TCL 电视 → 京东**，上传 Excel 后点击 **解析并预览作业题目**。逐题核对商品参数、价格、参考话术和评分要点，再由运营确认发布。

每道题的题干是一条模拟顾客弹幕，配一段参考话术和若干评分要点。例如，“大屏电视怎么判断能否进电梯？”可以练习让主播引导顾客核对包装尺寸、轿门和入户转角。资料未写明的费用或参数需要运营核实。

## 哪些操作会出题

- 自动流程使用 `gpt-4o-mini`，费用按现有项目的 API 实际用量计算。推送新增资料才生成；仅修改旧文件、删除文件、原样改名、更新本说明，均跳过生成。当前运行的 **Re-run** 不会再次付费出题。
- CSV 是供模型阅读的文本资料。已有成品题表可以直接到上海试点导入；Word、PDF、图片和 Excel 不属于这个收件箱的输入格式。
- 如需调整题数、品类或平台，或需要用修正后的同一份资料再出题，可使用[手动批量出题](https://github.com/lijianjun004-star/tcl-v43-preview/actions/workflows/r24-batch-questions-export.yml)。自动运行失败时先查看运行日志中的校验或上游错误，再决定是否重试。
- 生成的作业草稿不会自动发布到上海。请按第 4 步审核和发布。

## 选用每周刷新

仓库管理员在 **Settings → Secrets and variables → Actions → Variables** 添加 `R24_WEEKLY_FILE`。值填已合入主分支的一份固定资料的完整相对路径，例如 `materials-inbox/电视送装练习.txt`。每周一北京时间 09:00 计划根据当时的资料重新出 10 题。GitHub 调度可能延迟。删除该变量或留空即可停用；没有固定资料时会跳过付费步骤。每周产物从同一运行记录下载。
