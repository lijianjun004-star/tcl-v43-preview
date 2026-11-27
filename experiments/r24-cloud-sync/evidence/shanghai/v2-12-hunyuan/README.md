# 上海 R24 混元线上验收

北京时间 2026-11-27 10:14:53，上海练播房试点 `R24-20261124.12` 用两个已绑定的合成账号在公网完成在线出题、主播作答、评分、提交和运营回看。运行代码固定在 `edb0eb02d08edd5a8e86373d14c632b9a15caba7`。在线模型为 CloudBase 腾讯混元 `cloudbase/hy3`。[上海试点](https://unknown-roadrunner-d7cap6e21f517-1519058345.tcloudbaseapp.com/tcl-r24-cloud-sync-pilot/) · [公网清单](https://unknown-roadrunner-d7cap6e21f517-1519058345.tcloudbaseapp.com/tcl-r24-cloud-sync-pilot/static-manifest.json)

| 公网步骤 | 验收结果 |
| --- | --- |
| 运营粘贴合成电视选购资料，点击生成 | HTTP 200，返回 3 道顾客弹幕、参考话术和评分要点，模型标识为 `cloudbase_hunyuan / hy3`，628 tokens |
| 运营在网页预览并确认 | 三题题干、话术、要点与模型结果一致。通过已鉴权发布 API 把作业仅定向给合成主播，HTTP 201 |
| 主播在独立浏览器领取作业并逐题作答 | 领取 HTTP 201，网页完成三道题的文字作答 |
| 主播从复盘页发起评选并提交 | 评选 HTTP 200，984 tokens，合成回答总分 33；提交 HTTP 201，保存了三段回答和同一个评选 ID |
| 运营刷新后查看主播记录 | 记录和主播提交的三道回答、完整评选逐项相同，评分只读 |
| 权限与用量 | 出题仅向一个合成运营开放，合成主播读取出题权限接口得到 HTTP 403。全试点的出题和评分共享每日 5 次额度，按北京时间计日 |

公网业务实测共使用 1,612 tokens。另有部署前 SDK 单独探测 1,124 tokens。两轮成功调用合计 2,736 tokens，实际账单金额未核对。[线上双角色回执](exercise-evidence.json) · [独立 SDK 探测](sdk-probe.json)

公网静态清单 SHA-256 为 `c0c615d69232ab6dd1c76b415ad5ee8dc9bb15d9c937aa146260ce34acb4a814`。上海全部 41 个资源的哈希均与冻结包匹配。发布只更新试点专用数据库对象、云函数及静态目录。原设备绑定在页面更新后继续有效。[清单及变更资源复读](public-hashes.json)

公网浏览器使用 Chromium 390 × 844。实体 iPhone Safari、Android Chrome、微信内置浏览器、真人口播评分质量本次未测。本轮测试使用逐题文字作答。该回执记录腾讯混元上海路线；OpenAI 仍用于已验证的 GitHub Actions 离线出题。

[草稿预览](draft.png) · [主播端评选](anchor-evaluation.png) · [运营只读回看](operator-evaluation.png)
