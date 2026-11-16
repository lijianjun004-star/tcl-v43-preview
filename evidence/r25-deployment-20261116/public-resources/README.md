# R25 公网资源回读准备

状态：READY，尚未发送任何本轮公网请求。等待总负责人确认指定Pages已成功后执行。

冻结基线为 `/workspace/r25-release-candidate/freeze.json` 与 `_site`；239资源（旧217＋新22）已逐项本地SHA核对一致。R25 app `2848488723324db8a897fcb0fc4cbe577916b0e3e01cce8e05922aed8c3d1bfc`，manifest `858d1d25afb68cf2cd0b1968f5a57340ce8a16113c0b44e1ae51bf2ebc87015b`，版本 `r25-asr-fallback-20261116`。

`verify_public.py --execute --deployment-commit <sha> --pages-run <id>`：先读app/manifest起始锚点，再4并发GET239资源，仅对首轮失败资源各补读一次，最后读取结束锚点。每次请求的URL、状态、正文SHA、响应头、时间与异常即时保存在独立run目录的attempts.jsonl；所有失败正文与锚点正文保留。结果明确区分首轮全通过、有限补读通过与失败；不重新跑整套以掩盖失败。失败锚点不自动补读。

所有请求仅公开HTTP读取；不写产品、仓库、页面、浏览器数据。不启动ASR，不声称功能/真机/中国大陆网络/准确率验收。
