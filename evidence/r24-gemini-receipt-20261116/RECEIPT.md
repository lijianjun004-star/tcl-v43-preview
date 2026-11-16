# R24 Gemini 复验结果接收核对

- 任务：TCL-R24-GEMINI-RECEIPT-20261116；领域：软件独立复验接收；总负责人：ChatGPT；当前执行者：本Codex会话。
- 状态：**REVIEW_RECEIVED_EVIDENCE_CONFLICT — 已收到审查报告，不能采纳“实跑全部通过”与总体通过结论。**
- 本轮新增Gemini请求0，自动重试0，未购买额度或调用付费模型API；用户手动完成的外部请求次数/模型不可由返回包确定，不把旧identity中的packager请求0当成本次Gemini执行次数。
- 范围：审查上传ZIP、核对原始日志、当前发行源码与实时部署；未改产品、工作流或发行归档，未重跑整套产品测试，未启动旧浏览器Gemini路线或其他暂停任务。

## 版本与可采纳事实

接收ZIP：`TCL-R24-review-stability-Gemini-复验结果-20261116.zip`，SHA-256 `9374c50fda53902df4edc6ecfd424f803f22cd6692c3ad44e973e940c32e503c`。5文件可读取，自带SHA256SUMS的4条均重新计算通过。这只能证明返回包内部完整性，不能证明报告中测试结论真实成立。

身份readback `MANUAL-R24-EB5D4B2C02AAACC8BF7B` 与既有打包记录一致。冻结main93584fa，实施97d343d、源证据9963a554、发布f6ee029/PR121；当前实时main `3277519a917e8bea8aa7fa5846b4348d8627353d`（PR124），较冻结main只增加文档。最新Pages [43958381029](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/43958381029) completed/success。

当前发行归档解码ZIP SHA-256仍为 `8c569a3f9b2adee09cc6ca668b121ab2390321eb76ad5e12c011acc7b3778b1a`，app仍为 `63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816`。本轮新读公网22产品文件，全部HTTP200且字节等于当前main发行归档；21条清单文件哈希及清单自身哈希匹配。该22项结果是ChatGPT本轮HTTP/哈希检查，不是Gemini动态功能验收，也不是整站217项复跑。

## 报告与原始日志的实质冲突

| 项目 | 报告声称 | 附件实际证据 | 接收判定 |
| --- | --- | --- | --- |
| 12项命令 | 全部exit0通过 | 14条executions中前2条exit0，其余10条Node命令exit1 MODULE_NOT_FOUND，2条Python命令exit2文件不存在 | 仅保留2条日志exit0，不得写12项通过；脚本找不到不是产品测试失败 |
| 浏览器 | 8脚本缺Playwright、exit1 | 仅2条尝试，均缺脚本文件、exit2 | 浏览器测试未执行；Playwright缺依赖/无法启动Chromium的原因未被日志证实 |
| 环境 | Linux6.6.137 / Python3.13.9 / Node20.20.0 | Linux6.12.105 / Python3.11.2 / Node18.20.4 | 以原始日志记录为准，原因未知 |
| release guard | Ran8tests in0.002s | exit0，但stdout/stderr各截至1200字符，无该总结 | 只能记录exit0及可见片段，不能采纳8项/耗时 |
| index.html哈希 | 7cdbd80… | 自带manifest/日志/当前发行均39a04e98… | 报告该行错误 |
| qa-import哈希 | bd8da40… | 均fac35e52… | 报告该行错误 |
| parser哈希 | e389b2d… | 均8603c685… | 报告该行错误 |

原始日志及报告均原样留存，不能以本轮核对覆盖原件。来源见 GEMINI-REPORT-ORIGINAL.md 与 RAW-EVIDENCE.md。

## 对三项建议的源码复核

使用main发行包中实际app63519c源码核对，独立内部审查也确认以下区别；均属静态审查，本轮未动态复现。

1. **P2恢复后首次写全量**：冷缓存恢复后首次checkpoint会写全量records，是既有明确披露并被`experiments/r24/tests/record-cache.py`断言的保守行为；不是新发现的数据损坏。实际用`localDB.transaction(['prefs','records'],'readwrite')`，没有报告引用的`['sessions','records','blobs']`、`records.clear()`、`recordStorageFingerprint`或`sessionPersistCursor`，restore也没有报告建议依赖的`recs`。逐题框oninput只置dirty，由保存按钮提交；整场文字框才每字保存。故“恢复后逐题首字触发clear+200put”的具体描述不成立。不可照抄预热补丁：需重新设计一致快照与衍生字段/中断状态处理，并覆盖首改、失败重试、跨标签和50ms刷新后再讨论收益；本轮保留既有实现。
2. **P3下载进度timer**：实际`r6WhisperCancelAll()`确未显式清timer/key；回调有`r6WhisperValid`守卫。可保留为后续清理候选，尚无动态缺陷证据；报告展示的`updateTurnDownloadProgress`函数不是实际实现。
3. **P3知识库清除focus**：实际`search.focus()`存在，可研究preventScroll；但实际app没有`safeFocus`函数，直接采纳报告替换会造成ReferenceError。已有文字输入处使用`input.focus({preventScroll:true})`。手机实际跳动仍未验证，不按错误建议改产品。

报告其他所谓“源码原文”也不能整体信任：`applyManualTurnEdit`、`asrState/asrMessage`与引用存储代码并非当前实现。仅相同app hash或readback不足以证明报告已忠实阅读全部源码。报告“无P1”和“准予发布/通过”的结论保留为Gemini陈述，不能升级为已验收事实；原因不明，不推断外部模型内部过程。

## 下一步与限制

本次交付已完成接收、版本对齐、原件留存、证据冲突定位与内部源码复核。现有线上版本与此前开发侧对应hash测试结论继续按各自范围保留；不会因外部报告矛盾判定产品新增故障或自动回滚。

外部复验闭环仍阻塞在报告/日志不一致。若继续让Gemini修订，应先按日志更正文案并按真实目录列出现有脚本；已有可用脚本在冻结源码`experiments/r24/tests/`，如`session_smooth_recovery.py`、`record-cache.py`、`bridge-worker.mjs`、`question-pool.mjs`，不在错误的`tests/playwright/`等路径。缺失脚本不冒充产品失败或通过；任何新实跑需单独保存真实命令/环境/完整输出/退出码和hash，不复制旧输出。不自动发送追加业务请求。

真手机、iOS软键盘、中国大陆网络、TCL真实语音准确度仍未验收；本轮不提供全面稳定版放行。

## 用户补充 Gemini 分享页回读（2026-11-16）

用户提供[Gemini分享链接](https://share.gemini.google/OsbtBfWsirG9)，实际跳转至[公开分享页](https://gemini.google.com/share/acdbbaa21bc9)。通用网页读取失败、普通HTTP只得页面外壳后，本轮用无登录的独立Chromium渲染读取到29235字符的正文及画布报告；未发送Gemini业务消息或操作登录。文本SHA-256 `55abdbaa0bb7e0117ac6d449181dc172d5436d838b3418cf83568da8d9146bba`，原始读取与截图保存在本轮工作区`/workspace/tcl-r24-review/`。

界面标注“基于 Carbon 创建”、创建2026-11-16 21:19、发布21:42；这仅说明页面标签，不证明后端实际模型或执行环境。页面可见原任务“请解压，先读00说明，再按01复验任务执行”，以及返回摘要、ZIP卡片和完整画布报告；附件提示“上传的文件未显示”，未取得新增可下载原始证据。

正文仍写12项退出0通过、8个脚本缺Playwright，并引用不存在的safeFocus/rs.clear等代码，未附更正或新的完整执行日志。内部独立复核同意：链接补充了报告来源，未消除前述证据冲突，**REVIEW_RECEIVED_EVIDENCE_CONFLICT结论不变**。本轮未改产品或重跑产品suite，无新增Gemini请求。前一接收记录PR125合并5fa3e3895d63c9811d4fe909ff172d7806484f1b，文档检查43962096814及Pages43962240134均success。
