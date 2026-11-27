# 已提交作业的评分归档

主播确认提交一份练播作业后，系统可将其评分回执归档到专用私有仓库。源库中已附评分的提交直接沿用原成绩。缺少评分时，后台可用已核对的逐题文字和该作业的冻结评分要点生成辅助评分。每份回执保留“待复核”状态。原始提交和原成绩始终独立保存。

## 提交与归档

1. 单独审批的数据库脚本在同一事务中为符合授权名单的新提交建立唯一任务。未确认的转写草稿、历史作业和其他人员均不会自动入队。
2. 私有仓库的 Actions 任务按计划每 15 分钟检查一次，每轮最多领取三场。GitHub 的实际启动时间可能延后。已有成绩直接复用；对于缺分的提交，仅将审定答案、题面、参考答案和评分要点交给 OpenAI。工作流的日志不输出这些文字。
3. 附加评语及计量保存在源库任务表，专用分支 `r24-score-receipts` 的 `score-receipts/v1/<任务编号>.json` 仅含模型、分数、等级、分项命中或遗漏的要点序号、来源和复核状态。归档程序写后核对 Git 对象并确认任务。相同文件可安全重试，已有不同内容会保留原件并报告冲突。
4. 计费请求发出前会先持久化状态。模型结果已存而仓库写入失败时，只重试归档。如果进程在计费请求期间失联，任务保留 `attempting` 或进入 `held`，管理员可查请求记录后判断。此情形不自动重发模型请求。撤销名单会阻止后续领取，已经发出的请求无法撤回。

## 独立验证

在本目录执行 `npm ci --ignore-scripts`，然后执行 `npm test`。用 `node acceptance.mjs /tmp/r24-synthetic-evidence` 可在新的输出目录跑无账单的合成提交验收。该命令通过提交 API 写入隔离的 PGlite 数据库，访问实际数据库触发器，使用本地隔离 Git 检查归档一致性。固定的 GitHub 验收工作流只对合成记录调用一次官方模型，并将这一份回执写入独立的合成 QA 分支。生产归档程序拒绝公开仓库。

## 正式接线所需资源

- 业务方确认允许的处理地域、服务供应商和人员范围。公开测试程序的成功只覆盖合成样本。
- 经批准后，管理员核对试点 PostgreSQL 既有业务基础表后，依次应用 `../cloudbase/schema-repository-scoring.sql` 和 `../cloudbase/schema-repository-score-readback.sql`。第一个脚本默认创建空的 `r24_repo_scoring.allowlist`。授权粒度为团队、作业与主播的组合；只允许授权后的新提交。数据库连接使用仅加入 `r24_scoring_worker` 的独立登录角色，TLS 证书须可验证；不要配置业务管理员密钥。
- 在授权的私有处理仓库放入本目录、相邻 backend 的 `evaluation-schema.mjs` 与 `.github/workflows/r24-private-score-archive.yml`。从默认分支启用调度，准备专用非默认回执分支 `r24-score-receipts`，给予工作流写入该分支的权限。
- 配置仓库变量 `R24_REPO_SCORING_ENABLED=true`、Secret `R24_SCORE_DATABASE_URL`（标准 PostgreSQL 连接地址，TLS 由程序启用），以及需要时的 `R24_SCORE_DB_CA_PEM`。仅当需要对缺分的作业调用 OpenAI 时提供 `OPENAI_API_KEY`。运行程序访问源库和 GitHub 都需要该执行网络可达，不应为此将数据库开放到整个公网。
- 上海正式数据接线、私有仓库权限及人工复核流程须另行验收。当前源码没有将辅助评分发布为正式考核成绩的入口。

### 提交后唤醒私有仓库

上海只在新提交已经保存、且该用户可以读取到对应排队任务时发一次唤醒信号。服务端通过已限制在专用私有仓库的 GitHub App 签发短期令牌，只申请 `actions:write` 权限并检验仓库 ID、名称和可见性。它调用固定文件 `r24-private-score-archive.yml` 的 `workflow_dispatch`，附带默认分支和常量 `submission_saved`。唤醒请求没有作业编号、课件、回答、姓名或云凭证。GitHub 访问整体超时为 3 秒，失败或漏唤醒由每 15 分钟的计划检查恢复，文本提交可正常完成。前端不需要 GitHub 凭证或直接调用 GitHub。

合成验收仅使用模拟 GitHub App 和模拟的私有目的地。正式启用时，需在上海试点云函数的服务端配置 `R24_REPO_WAKE_ENABLED=true`、`R24_REPO_WAKE_REPOSITORY`（精确 owner/repo）、`R24_REPO_WAKE_REPOSITORY_ID`、`R24_REPO_WAKE_APP_ID`、`R24_REPO_WAKE_INSTALLATION_ID`，以及以多行 PEM 存放的 Secret `R24_REPO_WAKE_APP_PRIVATE_KEY`。待私有工作流合并至默认分支、允许处理该批数据且配置完整后再开启该选项。可关闭唤醒单独使用定时检查。
