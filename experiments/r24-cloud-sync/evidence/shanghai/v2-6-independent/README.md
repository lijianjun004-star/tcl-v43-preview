# R24 `.6` Gemini 独立核查与复盘提交补验

依据为用户转回的 Gemini 报告，时间为北京时间 2026-11-26 05:02–05:04。上海试点当时为 `R24-20261124.6`，当前已再次核对同版本原始公网文件。

| 证据 | 结论 |
| --- | --- |
| Gemini 公网版本与清单条目 | PASS。短版本 `.6`，清单完整版本 `r24-paraformer-excel-cloud-sync-v2-20261124.6`，36 项。原始响应 SHA-256 在其环境未计算。 |
| Gemini Excel 样本核验 | PASS。`R24-模拟试点作业.xlsx` 6,315 字节，5 列、3 道题，文本 SKU `000041` 保留，SHA-256 `0a4658d77130d28ac6fc305f86d6569bd3bd05bcdff19ecdfc51ac2360f946b3`。 |
| Gemini 运营发布、主播提交、运营双入口查收及录音播放 | NOT RUN。托管浏览器无法上传外部 Excel、启动第二独立会话或访问麦克风。该次没有录制或核验播放，也没有新增线上账号。 |
| Codex 既有 `.6` 公网双账号验收 | PASS。三题 Excel 发布、领取并提交、运营在「作业进度」及「主播记录」查收同一份提交、三段合成录音逐一播放。见原测试记录。 |
| Codex 本轮 `.6` 保存与提交对照 | PASS（本机 Chromium 独立会话、虚拟麦克风、本机测试后端）。保存复盘且显示已成功存到本机后，运营两处都看不到提交，服务端提交请求数为零。点「提交到云端」后，两处均出现唯一提交，三题一致，三段录音可播放。未写入公网。 |

Codex 本轮下载的公网清单与三个关键前端文件仍和 `.6` 候选逐字节匹配。清单原始字节 SHA-256 `3ff8696ff1c7c7d33d2a0e9e0e01ea3197832e2c3f6f5e9b7c28c4fe114d0a9e`。本机补验不能替代 Gemini 的独立线上实测；真实业务 Excel、实体手机、微信内置浏览器及真人口播仍待用实际环境验收。

[模拟 Excel](https://docs.google.com/spreadsheets/d/1Z-gePGxTh0HOa04BF8CZUnjDsKrdBS2z/edit) · [既有 `.6` 公网验收](https://docs.google.com/document/d/1ib9gPqev4PEehT8HU770sGFV-uMQFZVq/edit) · [本机补验数据](private-draft-local.json)
