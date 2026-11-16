# 冻结候选最终浏览器回归

`SUMMARY.json` 列出 6 项最终测试及报告哈希。每个报告记录测试前后的 `app_sha256`，均为 `609fded562c0f854ec805e12cbbed1a7ed36f694c56d17e359cc0b2dbf1b5d88`，且 `source_unchanged=true`。

全部实际重新执行并退出 0：三题录制/模拟转写/人工修改/复盘入库、词表参与三题流程、词表文件导入与刷新、6 类正常和15类异常输入、操作员导入竞态与原生事务回滚、python-docx/openpyxl完整样本文档兼容。浏览器未见页面异常。

测试脚本在 `experiments/r24/tests`：`browser_e2e.py`、`glossary_flow.py`、`glossary_browser.py`、`delivery_imports.py`、`delivery_knowledge_import.py`、`delivery_office_compat.py`。不再依赖不存在的 `/site` 目录或固定工作区路径。默认报告均保存在本目录，可用 `R23_BROWSER_REPORT` 或 `R24_UI_OUTPUT` 指定新位置；不会覆写早期 R24 报告。

范围是桌面 Chromium，模型返回值为模拟、麦克风为合成音频、文档为构造数据；320/390 仅为 CSS 视口。不能代替手机硬件、真实 TCL 语音准确率或云端 API 验收。`real_flow.py` 的路径与输出已修复，但本轮未重新运行该真实模型脚本，使用音频专项报告核对真实模型结果。
