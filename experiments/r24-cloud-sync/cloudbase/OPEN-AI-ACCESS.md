# 全员开放 AI 评分与 AI 出题：管理员部署清单

本清单把上海试点的 AI 功能从名单制改为全员开放：

- **AI 评分**：团队 `r24-pilot` 内所有有效主播，提交作业后自动评分。只覆盖 1–15 题的作业，这是评分程序可处理的范围；16 题及以上的作业仍显示为未开通自动评分，由运营人工复核。
- **AI 出题**：所有有效运营都能一键出题或解析题目。

代码默认保持关闭。下列步骤需由具备上海 CloudBase、数据库和 GitHub 管理权限的人员按顺序执行。

## 0. 上线前确认

- **地区与授权**：评分在 GitHub Actions 上调用 OpenAI，员工提交的回答文字会发送给 OpenAI。请负责人确认员工所在地区及数据处理符合 OpenAI 的使用授权。
- **费用**：按用户要求不设日上限。试点允许任何人填写姓名自动开通账号，拿到网址的人都能消耗模型额度。紧急关闭方式见第 6 节。
- **出题模型通道**：AI 出题由上海函数直接调用模型，不经过 GitHub。请确认以下二选一已可用：
  - 腾讯混元：`TCL_R24_SYNC_AI_MODEL_PROVIDER=cloudbase`
  - 已部署的 AI 网关：`AI_GATEWAY_URL` 与 `AI_GATEWAY_TOKEN`

## 1. 数据库（上海试点库，用试点表的所有者执行）

1. 确认 [共享评分队列](schema-repository-scoring-shared.sql) 已安装，即 schema `r24_repo_scoring` 存在。
2. 执行一次 [全员模式迁移](schema-repository-scoring-open.sql)。
   - 该迁移为单一事务。
   - 重复执行会因数据表已存在而失败，不会改动数据。
   - 原有精确名单继续有效。
3. 开启团队全员评分：

   ```sql
   insert into r24_repo_scoring.open_grants(team_id) values ('r24-pilot');
   ```

4. 可选：若要给出题设置超过 20 次的日上限，执行 [日限额扩展](schema-ai-drafts-limit.sql)。不设上限时无需执行。

## 2. 上海函数 `tcl-r24-sync`

部署本分支经 `cloudbase/stage.mjs` 暂存的函数代码，并设置以下环境变量：

| 变量 | 值 |
| --- | --- |
| `TCL_R24_SYNC_AI_ENABLED` | `true` |
| `TCL_R24_SYNC_AI_OPERATOR_IDS` | `*`（所有有效运营） |
| `TCL_R24_SYNC_AI_DAILY_LIMIT` | 留空或删除（不设上限）。需要封顶时填 1–10000 的整数 |
| `R24_REPO_WAKE_ENABLED` | `true` |
| `R24_REPO_WAKE_REPOSITORY` | `lijianjun004-star/tcl-r24-score-archive` |
| `R24_REPO_WAKE_REPOSITORY_ID` | `1474053872` |
| `R24_REPO_WAKE_APP_ID` | 第 3 步创建的 GitHub App ID |
| `R24_REPO_WAKE_INSTALLATION_ID` | 该 App 在私库的安装 ID |
| `R24_REPO_WAKE_APP_PRIVATE_KEY` | 该 App 的私钥，放在受保护变量中，不得写入源码、截图或工单 |

模型通道相关变量保持现有配置。

## 3. GitHub App（提交后立即唤醒评分）

1. 新建一个 GitHub App：
   - 权限只勾选 **Actions: Read and write**，Metadata 为默认只读。
   - 不订阅任何 Webhook。
2. 只安装到私库 `lijianjun004-star/tcl-r24-score-archive`。
3. 生成私钥，按第 2 节填入上海函数。

上海函数在每次提交成功后，向私库工作流 `r24-private-score-archive.yml` 发送 `submission_saved`，该信号不携带任何提交内容。唤醒失败不影响提交本身，定时任务会作为兜底处理积压。

## 4. 私库 `tcl-r24-score-archive`

1. 合并"处理到队列清空"的评分程序改动：
   - 每次运行处理到队列清空。
   - 6 分钟后不再领取新任务，单次最多 100 份。
2. 确认仓库变量 `R24_SHANGHAI_HTTPS_SCORING_ENABLED` 未设为 `false`。

## 5. 验收（不手动触发）

1. 用合成运营「Claude验收运营1128」发布一份 1 题作业。
2. 用合成主播「Claude验收主播1128」领取。作业列表中该作业应显示 `autoScore: true`。
3. 主播只点一次「完成并提交」：
   - 不点「发起 AI 评选」。
   - 不手动运行 GitHub 工作流。
4. 记录以下时间：
   - 提交时间
   - 私库运行开始时间（事件应为 `workflow_dispatch`，由 GitHub App 发起，`signal=submission_saved`）
   - 出分时间
5. 主播与运营分别刷新，核对总分和逐题评语一致。
6. 用该运营在「AI 出题草稿」实际生成一次，确认不再提示"当前账号暂无法使用云端出题"。

## 6. 紧急关闭与回退

| 目的 | 操作 |
| --- | --- |
| 停止全员评分（保留名单） | `delete from r24_repo_scoring.open_grants where team_id = 'r24-pilot';`。未处理的任务随之失效，重新开启不会复活它们 |
| 停止所有评分 | 私库仓库变量 `R24_SHANGHAI_HTTPS_SCORING_ENABLED=false` |
| 停止提交后唤醒 | `R24_REPO_WAKE_ENABLED=false` |
| 停止 AI 出题 | `TCL_R24_SYNC_AI_ENABLED=false`，或把 `TCL_R24_SYNC_AI_OPERATOR_IDS` 改回运营 ID 名单 |
| 给出题加日上限 | `TCL_R24_SYNC_AI_DAILY_LIMIT` 填数字；超过 20 先执行第 1 节第 4 步 |
