# R24 Paraformer Pages1：Gemini 独立复验接收核对（2026-11-18）

用户上传 `TCL-R24-Paraformer-Pages1-Independent-Recheck-Evidence-20261118.zip`（23,585 字节，SHA256 `85a1d565242f6399a9d659fe6725c2540ad771914e95fb833ab187fec15c0d4f`，6 项）。本次由 Claude Code 只读核对，未运行包内脚本、未新增 Gemini 请求。

| 核对项 | 结果 |
|---|---|
| 包内 `SHA256SUMS.txt` 5 项 | 5/5 OK |
| 报告结论 | 0 P0 / 0 P1 / 0 P2 / 2 P3 |
| `static-manifest.json` SHA256 `c0e6c3e8…`、登记 34 个文件 | 与 main 发布包一致 |
| 4 个模型组件字节数/哈希 | 与 `release_guard.py` 固定值一致 |
| 结果 JSON | node 9/9、browser 21/21 PASS；**报告正文写 19/19，与 JSON 21 项不一致**（计数差异，未见失败项） |
| P3-1 术语大小写顺序 | **复现属实**（见下） |
| P3-2 Windows `.mjs` MIME | 仅为说明文档提示，本环境无 Windows，未验证 |

## P3-1 复现

`app.js` 757–759 行与 2619–2621 行确为先 `canonicalizeTerms`（经 `normalizeWhisperChinese`/`assessAsrText`）后 `normalizeSpokenNumbers`。用发布包原函数、词表 `HDMI 2.1 / T7M Pro / USB 3.0` 实跑：

| 原始 | 现行结果 | 数字转换后再校正一次 |
|---|---|---|
| 支持hdmi二点一接口 | 支持hdmi2.1接口 | 支持HDMI 2.1接口 |
| 这款t七m pro很好 | 这款t7m pro很好 | 这款T7M Pro很好 |
| usb三点零接口 | usb3.0接口 | USB 3.0接口 |

只在用户保存了本机术语表时才有修正目标；页面已提示"型号数字需人工核对"，属 P3。

## 证据边界

- Gemini 浏览器 Q1 文本来自受控 Worker 返回，验证的是后处理链路，不是真人语音准确率。
- Gemini 与本次 Claude 复验均未在实体 iPhone/Android、大陆网络下执行。
