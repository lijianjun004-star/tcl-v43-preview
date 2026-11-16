# R25 公网浏览器纯文字冒烟

**最终状态 PASS，11项断言通过。** Pages43977679324成功后执行；目标为PR128合并b24abea1be778024edf493c01418fec22ae4e8ea对应公网独立R25入口。

实际空白Chromium156.0.8078.79，模拟移动布局390×844：登录主播→确认默认引擎Vosk（localStorage尚无设置）→只将测试context改为Tiny并刷新→2题文字练播→结束→逐题复盘→刷新同名恢复。两题文字、顺序、runId和turnIds完整保持，IndexedDB媒体记录为0，没有录音、模型下载或推理。

三次实际浏览器app.js响应均HTTP200，306675字节，SHA-256均为`2848488723324db8a897fcb0fc4cbe577916b0e3e01cce8e05922aed8c3d1bfc`。页面错误0、请求失败0、模型请求0；应用目录外请求数0。移动布局documentWidth=390、viewportWidth=390、scale=1、编辑框16px。

首轮结果保存在attempt-1/（exit1）。文字业务流程8项已通过，但测试驱动到跨导航后才读早先响应正文，Playwright报Network.getResponseBody失效；没有产品错误。只把独立驱动改为每次导航后立即读取/哈希实际响应，第二轮完整重跑exit0。未修改产品或业务断言。详见FIXTURE-ADAPTATION.md。

已人工查看首页与恢复复盘截图，内容与文字断言一致。截图：

- 01-home-default-vosk.png：首页本机中文识别提示；默认选择值另见result.json。
- 02-text-prep.png：纯文字准备页。
- 03-live-text-question-1.png / 03-live-text-question-2.png：两题直播文字。
- 04-two-question-review.png：结束后的逐题复盘。
- 05-refreshed-restored-mobile-review.png：刷新恢复后的两题复盘。

范围限制：此为真实公网页面/实际Chromium/IndexedDB上的纯文字流程与合成移动布局，不是真手机，不是中文ASR或识别准确率验收。测试期间使用Tiny设置仅为了避免纯文字流程自动下载42MB模型；默认Vosk的实际语音路径由其他专项测试与用户真机验收覆盖。
