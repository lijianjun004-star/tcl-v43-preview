# 公网题库流程验收

固定入口：<https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r24-qa/>。

部署完成后使用真实桌面 Chromium、390×844 视口、原生 IndexedDB 和人工构造资料执行 `experiments/r24/tests/question_bank.py`。实际上传 CSV、JSON、DOCX、XLSX，经本机审核、练播、参考回答、复盘、刷新恢复及提交；不是静态源码推演或实际运营话术审核。

**31项全部通过，0页面异常，0项未完成。** 首尾实际 HTTP 获取的 app/parser/qa-import 哈希严格匹配本次冻结版本，详见 `freeze-verification.json` 和原始 `result.json`。手机视口截图展示具体型号与独立 SKU 上下文，未使用物理手机。

首次尝试在取 app.js 哈希前因 Node APIRequestContext 选择不可达 IPv6 而失败，未执行任何业务检查；原始记录保留在相邻 `question-bank-attempt-01-network/`。修正的只是测试哈希获取传输：改用遵循现有 HTTPS 代理的 urllib，与脚本最终核对方式一致，仍要求 HTTP 200 和完整 SHA256。产品代码及业务断言未改。

没有访问真实运营表、真实录音或任何模型服务，不代表 Gemini、真机、国内网络或商品事实验收。
