# 最终新版手机布局复验

2026-11-16，最新 smooth-mobile Worker 版本上的补充修复。直接运行未修改的 mobile/probe.py，MOBILE_EXPECT_STABLE=1，严格断言全部通过。

人工问答、长来源 URL；桌面 Chromium 触屏模拟，320/390/768/1024 四种宽度共 68 次状态采样（含重复导航，不是 68 个独立页面）。可见输入字号低于 16px 的状态为 0；整页横向溢出 0；全部 innerWidth 等于指定宽度且 scale=1；控件 touch-action 全为 manipulation；live 状态的模糊叠层全为 0；pageerror 为 0。

app 首尾 8dfa75983e44ce04d6e3620a2080fef51354a71a89c56c4ef935f281605dc332，CSS 首尾 35a869c93470924b66ea01ffe65ef7a578b34e8f61ab4bf1b89d98485b8ec5f2。source-verified.json 额外记录结束后实际文件哈希与探针起始哈希一致。review.png 已目视核对，390px 复盘内容和操作按钮正常换行。

460px 高度只模拟视口变小，不代表真实键盘。未进行物理 iOS/Android、系统缩放或无障碍手势实测，不把 Chromium scale=1 当作 iOS 聚焦缩放已真机通过。保留主动浏览器缩放。
