## 运营离线批量出题

日常电视京东作业可以[上传资料自动生成 Excel](../../materials-inbox/README.md)。手动选择其他品类、平台、题数或验证格式时，使用以下入口。

1. 在仓库 Settings → Secrets and variables → Actions 添加项目密钥，Secret 名称见[工作流生成步骤](../../.github/workflows/r24-batch-questions-export.yml)中 `secrets.` 后的完整名称。
2. 打开 Actions → R24 batch questions export → Run workflow。此仓库公开，请仅提交可公开的资料；选择品类、平台、模型和 1–50 题。
3. 勾选 dry_run 可验证格式。运行完成后下载保留 14 天的 r24-batch-questions，run-summary.json 含本次用量和三个数据文件的哈希。
4. 在上海运营工作台选择匹配的训练板块和平台，上传 questions.xlsx，点击「解析并预览作业题目」，审核参考话术与评分要点后再发布。
