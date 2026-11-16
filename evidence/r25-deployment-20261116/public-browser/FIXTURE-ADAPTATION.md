# 公网浏览器驱动适配记录

首轮attempt-1原件完整保留。所有文字业务断言通过，最后跨导航读取app.js早先Response.body()时Playwright报Network.getResponseBody失效。原因是驱动把响应正文留到多次reload后读取。

仅修改独立驱动：在每次goto/reload网络空闲后、下一次导航前立即读取并哈希实际响应正文。未修改产品、请求内容、业务步骤或断言。第二轮重新执行同一公网文字流程。
