# R25 独立测试版已部署（2026-11-16）

任务 TCL-R25-DEPLOY-20261116。用户本轮明确“**不用接力直接部属吧**”，已批准直接发布本次R25修正版。该明确指令取代接力包中的待批准状态；本轮已完成常规CI、PR合并、Pages发布与公网验证，不再要求同范围重复批准。总负责人ChatGPT，执行Codex；新增Gemini业务请求0、付费模型API0。

入口：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r25-qa/ 。这是独立静态测试版，保留根站、旧培训入口与R24，不宣称真人语音准确率或真手机已验收。

## 实际发布版本

- 清单版本：`r25-asr-fallback-20261116`。
- 产品修复提交：`b3950ea3b0c2e212031e26ca820369424a9a3bf1`，审查后冻结源码快照`3bd0ff1e5e923c801d4a30e05d70986a167e549a`；源码/测试在`codex/r25-followup-fixes-20261116`。
- app SHA256：`2848488723324db8a897fcb0fc4cbe577916b0e3e01cce8e05922aed8c3d1bfc`。
- manifest SHA256：`858d1d25afb68cf2cd0b1968f5a57340ce8a16113c0b44e1ae51bf2ebc87015b`。
- 发行ZIP SHA256：`52a47cf131c8dc402747230c672d96dfb1d3a9805b8a3dd18fc3d000c2cbe9d5`；B64 SHA256：`d7105747e91bb3a4fc878624b343aa047d1ae142787d72afa1822b94b38cab51`。
- 默认Vosk（同源约42MB）；可选Whisper，网络/Worker超时失败回退Vosk。Vosk下载失败后不按每题静默重复下载，等待手动重试、保留已录题；修正整场Tiny/Base标签。R25数据库、词表、模型缓存独立，旧R24本机记录不迁移也不清理。

## CI、PR及Pages证据

| 阶段 | 精确版本与实际结果 |
| --- | --- |
| CI独立PR | [PR127](https://github.com/lijianjun004-star/tcl-v43-preview/pull/127)，head`8bf0583f67d85a9576f5a9d1f6db40e0e1047a55`；检查[43977169011](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/43977169011)成功后，合并`42ab929b31fc55e3f7ab724d5304eca4ed280fa6` |
| CI后旧版发布 | Pages[43977323220](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/43977323220)completed/success |
| 发行独立PR | [PR128](https://github.com/lijianjun004-star/tcl-v43-preview/pull/128)，基于实际main42ab；head`e5fa5d9729580dfd545d33fcbf09f98fb634c548`；固定base/head本地可信门禁与GitHub检查[43977558275](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/43977558275)成功，核对main/head后合并 |
| 产品发行提交 | `b24abea1be778024edf493c01418fec22ae4e8ea` |
| R25 Pages | [43977679324](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/43977679324)completed/success，全部步骤含R25 staging通过；实际合并后main归档SHA/22项CRC回读一致 |

CI只改两个门禁文件；发行只新增精确归档并向Pages添加一个固定staging步骤。未修改site.zip、R24归档或旧SHA白名单。旧217资源完整树指纹`13df1a6bac7a368dac95b336f17c89c8fda8c8460a98e38c868bed84092a1cc6`，新增22后239；本地追加及精确逆向回滚均已执行，110项门禁通过。此前15组Node、4组浏览器、5真实Vosk+合成语音及手动重试浏览器测试按对应hash保留，不冒充本次全部重跑。

## 公网实际验证

1. **239/239资源单轮通过**：全部HTTP200且正文SHA匹配，旧217与新22逐项覆盖，失败0、补读0。2026-11-16 23:16:15.758785 UTC至23:16:36.951687 UTC；共243次GET（239资源+4个起止锚点）。起止app/manifest hash与清单版本一致。
2. **实际公开页文字流程PASS**：空白Chromium页面默认Vosk；仅为纯文字检查在测试context改Tiny以避免下载模型，完成2题文字→结束→逐题复盘→刷新同名恢复。11项断言通过，答案顺序、runId/turn IDs一致、媒体0；3次实际app.js响应均200且SHA284848，页面错误/请求失败/模型请求/应用目录外请求均0。390px合成移动视口无横向溢出、scale1、输入16px。不是iPhone硬件验收。
3. **实际公开页默认Vosk流程PASS**：未替换产品或模型响应，真实公网读取12个同源运行库/模型文件；合成普通话WAV作为麦克风，合成相机。自动下载→录音11.1秒→原题回答栏有简体文字→逐题复盘通过，实际加载app正文SHA284848，页面错误0、外部请求0。状态实际到达“已转写”，不外推真手机耗时。

合成语音识别有明显错字，仅证明真实模型到原题回填链路，不证明真人普通话、TCL型号、数字或噪声准确率。公网检查发生在云环境，不代表中国大陆网络。

纯文字检查首轮在功能流程完成后，读取早先已导航离开的响应正文时报Playwright错误。保留attempt-1完整结果；仅改独立测试驱动为导航后立即保存响应正文，再单次完整重跑通过，没有产品补丁。其余本次公网资源与默认Vosk检查未发生失败重试。

完整新证据在源码证据提交[`ddd3384dbf3a03faaa3144acfa6b4e35705eec0e`](https://github.com/lijianjun004-star/tcl-v43-preview/tree/ddd3384dbf3a03faaa3144acfa6b4e35705eec0e/evidence/r25-deployment-20261116)：public-resources下result/attempts.jsonl及起止实际正文，public-browser下结果/原失败/截图/驱动，public-vosk下真实模型链路结果/截图/驱动，以及release-local-check.log与release-identity.json。此前Drive交付包是发布前冻结备份，其中待批准文字为历史状态；当前状态以本报告及main/AI_CONTEXT.md为准。

## 限制与回滚

真iPhone/Android（MP4/AAC、键盘、后台、发热/内存）、中国大陆首下42MB用时、真实Whisper权重及真人TCL准确率仍未验收。首次建议Wi-Fi；本机存储独立，不自动迁移R24历史，也不提供跨设备同步或正式AI评分。

回滚须基于当时最新main独立PR，只删除`experiments/r25-release/site-only.zip.b64`及唯一R25 staging步骤；工作流恢复PR127合并42ab时的精确内容。沿用新门禁的精确逆向校验，回滚后旧217资源逐字节不变；不恢复整个旧main、不改其他站点、不清理用户浏览器数据。未执行真实线上回滚。
