# R25 云端同步实现

任务 TCL-R25-CLOUD-SYNC-20261116，实施日期 2026-11-17。用户授权直接部署并授权官方 CloudBase CLI；本实现复用现有上海环境，保留固定 GitHub Pages URL、旧入口与本机历史，不购买或升级套餐。

`tcl-v352-asr-r25-qa/` 是发行的完整 28 文件源码，版本 `r25-cloud-sync-20261117`。官方 JS SDK 固定 3.11.1，本地打包；公开配置仅环境标识，不含管理密钥、密码或会话。

后台见 `backend/r25-cloudbase/`：原生用户名密码认证、真实 UID 角色、PG 原子 RPC、稳定操作编号、作业口令、主播加入、不可变提交、运营收件与人工反馈。媒体使用独立私有 bucket，主动选择后上传，不覆盖或自动上传旧录像。默认角色不足时仅允许绑定邀请；客户端不能填写姓名获得运营权限。

首个媒体迁移的 INSERT 规则在真实云上传阶段过早检查了尚未完成的 metadata/owner。实际部署随后应用 `media-storage-insert-compat.sql`，仅调整本轮两个新 INSERT policy；桶的大小/MIME限制、读取授权和禁止修改/删除规则保留，提交时仍核验实际对象 owner/size/MIME。相关失败与修复后真实证据均保留。

可复核边界：本机 ASR、题库导入和旧知识库 REST 与新业务后台区分；本轮不声称正式 AI 评分、旧知识库云同步或手机硬件验收。账号初始密码只私有交付，不进入此仓库。

发行身份见 `static-manifest.json` 和 `evidence/r25-cloud-sync/release-identity.json`；本地模拟、真实云 SDK、实际页面及公开部署证据分别记录。部署状态以 **main 的 AI_CONTEXT.md、精确 PR/Actions 与公网回读** 为准，不将本源码分支的历史状态当当前线上状态。
