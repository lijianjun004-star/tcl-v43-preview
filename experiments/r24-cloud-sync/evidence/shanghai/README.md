# 上海 CloudBase 作业同步试点发布记录

2026-11-24 已按用户批准，在现有上海环境 `unknown-roadrunner-d7cap6e21f517` 发布 [R24 作业同步试点](https://unknown-roadrunner-d7cap6e21f517-1519058345.tcloudbaseapp.com/tcl-r24-cloud-sync-pilot/)。

- 新路径 `tcl-r24-cloud-sync-pilot/`，上传前 CLI 返回 0 文件，上传后 CLI 校验 37/37，公网逐文件 SHA-256 37/37。原 QA3 公网清单 SHA 未变。未使用 prune。
- 现有环境是 PostgreSQL。使用默认管理角色按事务新增三张独立表、索引和 RLS，未使用或开通文档数据库。SQL 回读显示匿名及已登录浏览器用户无直接读写权限，函数服务角色仅有试点所需读和新增权限。
- 新增 Node Event 函数 `tcl-r24-sync` 与 HTTP 接入路径 `/tcl-r24-sync`。通用自定义域名路由命令拒绝系统域名和通配域名，改用 CloudBase 自带的 `service create`。回查既有路由完全相同。现有用户名密码登录和安全域名设置已启用，原样沿用。
- 公网 API 用两个独立原生测试账号通过发布、读取同一冻结题目、提交和运营收件。实测同场次重试返回同一提交，运营仅一条记录，主播读取运营收件接口收到 403，未登录收到 401。合成数据只在独立试点团队。
- 公网 Chromium 在两个独立会话中先点击腾讯云页面的「确定访问」，再用各自 CloudBase 账号恢复工作台。运营上传真实格式合成 XLSX，主播搜索领取、完成三题并提交，运营查到唯一提交和三题原文。页面异常 0。
- 默认测试域名的浏览器访问可能先显示腾讯云「风险提醒」，该中间页的响应码为 404。公网资源哈希校验通过，生产业务用户的正式域名和真机验收仍需另行安排。

[公网文件核验](public-hash-evidence.jsonl) · [公网业务 API](live-api-evidence.jsonl) · [数据库权限](acl-evidence.json) · [公网浏览器验收](live-browser-final.jsonl)
