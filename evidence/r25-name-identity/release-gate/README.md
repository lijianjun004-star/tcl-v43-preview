# R25 姓名邀请码版发布门禁证据

冻结版本 `r25-name-invite-20261117`；源码提交 `032b8448c421db08e8aef7e12761c1b98f39f320`。本目录收录离线发布门禁与真实静态构建证据，账号与产品UI实测另见上级证据目录。

- CI维护PR：[135](https://github.com/lijianjun004-star/tcl-v43-preview/pull/135)，精确head `87b2f87d9a166107eee631e3f65474552d438c3f`，仅两个 `release-ci` 文件；[Actions 44046616154](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/44046616154) completed/success，PR已合并。
- [最终单测日志](unit-tests-final.log)：145项通过，27.636秒。首次夹具计数断言失败及修正见 [FIXTURE-NOTE.md](FIXTURE-NOTE.md)。
- [完整构建日志](complete-stage-final.log)：恢复版→姓名邀请码版246文件、反向回滚245文件；两向均逐字节保留217个旧资源。6个真实归档负例均拒绝：ASR/初版云端与新版之间双向跳版、自重复、归档字节变化。
- 原28个R25策略常量保持原值；原有相邻更新边保留，仅增加恢复版↔姓名邀请码版。新版精确改6文件、增 `name-identity.mjs`、无删除。`site.zip`、Pages workflow及后端代码均未纳入此CI变更。
- [完整246文件期望哈希表](expected-public-files.json)，路径相对发布站点根目录；整树SHA-256 `3ca433417007fedc1e773909eab6fb483d8b49d70f2e6c663773ddb14b333e53`。计算方式为排序键、紧凑分隔符JSON的UTF-8 SHA-256，与门禁一致。
- ZIP SHA-256 `a6f76379262cdcf562983d3e3a3321b678f3485eaa04d22a85c9025bdc223317`；B64 SHA-256 `dee92ada3d1a657461fd79cc72554318fbf1cb1b2acfe7b5571d729601e0766b`。

[build-summary.json](build-summary.json) 包含冻结身份、29个产品文件哈希、构建结果与负例摘要；完整树映射单独保存以减少重复。GitHub回读记录见 [ci-pr.json](ci-pr.json)、[ci-run.json](ci-run.json)。本目录收录过程未改变任何runtime文件，也未执行后续业务归档合并。
