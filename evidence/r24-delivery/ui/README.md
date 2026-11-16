# R24 导入与浏览器交付回归

当前会话独立执行，桌面 Linux Chromium 156.0.8078.79。所有文档均为人工构造，未使用用户私有讲解词，未调用付费模型或 Gemini。

已复现并修复：

- `parser-before.json`：XLSX 超出合法列范围仍分配单元格；DOCX 篡改 CRC 仍被接受。现在限制 Excel 坐标和累计分配单元格，校验 ZIP 中央/局部头、CRC、实际长度、重复名字及压缩方式。超过安全上限须拆分导入。
- `knowledge-import-before.json`：导入预览后变更目标仍可保存；双击保存产生两条重复记录；文件解析中离开页面产生空 DOM 异常。现在保存与原文件/目标/身份/DOM 关联，异步过期结果取消，保存加同步锁，本机整批写入同一事务。云端状态冻结且可能部分完成时禁止直接重复提交；云端接口未实际运行。

实际验证：

- `imports.json`：6 个正常文件（TXT、CSV、DOCX、XLSX，含 ZIP stored、deflate、data descriptor）、15 个异常/损坏/超限文件、惰性文本中脚本标记不执行。原已保存术语不被导入预览或失败覆盖。390×844、320×568 CSS 视口无横向溢出，工具面板可滚动。无页面异常和外部网络请求。
- `office-compatibility.json`：python-docx、openpyxl 生成的完整人工样本文档，经实际浏览器解析得到预期三个术语。
- `knowledge-import-after.json`：切换目标/文件使预览失效；双击只保存一份；离开后迟到解析无异常；人工模拟第二条写入出现 QuotaExceeded，原生 IndexedDB 整批回滚为 0 条，重试仅保存 2 条。
- `glossary-browser.json`：既有词表导入、显式保存、刷新保留、无参数补写、非法词保持原词表、训练期间锁定通过。
- `browser-mock.json`：既有三题完整录制/转写/人工修改/复盘/IndexedDB 流程通过，模型结果是 MOCK，音频为合成正弦波。这是本轮其他修复前执行的基线回归；最终 app 改动后须由主验收重新运行，不能替代最终版本全流程验收。

复跑：在仓库根目录运行 `python experiments/r24/tests/delivery_imports.py` 和 `python experiments/r24/tests/delivery_knowledge_import.py`。可选 Office 生成器验证：`python experiments/r24/tests/delivery_office_compat.py`（另需 python-docx、openpyxl）。这些测试只启动有界的临时本机 HTTP 服务，完成即停止。

尚未验证：iPhone/Android 真机、手机麦克风与相机硬件、真实 TCL 语音准确率、中国大陆网络、正式云端导入 API。小屏视口不等于真机。
