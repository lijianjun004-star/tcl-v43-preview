# 手机布局与意外缩放修复

仅修改style.css末尾22行；index.html未改。最终CSS SHA256 `bab5d63331e487b77636249078a8231db534210ef9cd8773d03c8adb0e0a1263`。

实际Chromium触屏模拟，320/390/768/1024四种宽度，共68次状态采样（含重复导航与返回；不是68个独立页面）。使用人工问答及长来源URL；460px高度仅模拟视口变小，不冒充真实键盘。

- 修前61个状态含14/15px输入控件，修后0；针对旧.field与行内字体优先级，触屏输入统一至少16px。
- 修前7个状态整页横向溢出，修后0。390px视口的长来源审核卡原scrollWidth2528px，修后390px；通过grid min-width/minmax、长字符串换行、上传控件宽度修复，没有用全站overflow:hidden掩盖内容。表格保留内部横向滚动。
- 输入与操作控件使用touch-action:manipulation，抑制控件双击手势；保留正常滚动和主动pinch/browser缩放。没有user-scalable=no/maximum-scale限制。
- 手机直播的6个backdrop-filter层降至0；保留原半透明背景，没有声称已测得FPS提升。
- 最终68次采样整页innerWidth等于配置宽度、visualViewport.scale=1，0页面错误，测试期间CSS hash不变。

运行：`MOBILE_OUT=<输出目录> MOBILE_EXPECT_STABLE=1 python evidence/r24-performance/mobile/probe.py`。before/是修前原始结果；after/为首次修后；verified/是补齐严格断言后的最终结果和截图。

未进行物理iOS/Android键盘与系统缩放验证。Chromium中已直接测出旧字号偏小，但不能据此声称重现了iOS焦点自动缩放；CSS针对其已知触发条件，同时实际修复了整页被长内容挤宽。

探针中的页面标签表示请求的测试步骤；运营身份请求进阶话术页时，权限逻辑会留在当前设置页，该次只算重复布局采样，不声称覆盖该受限页面。
