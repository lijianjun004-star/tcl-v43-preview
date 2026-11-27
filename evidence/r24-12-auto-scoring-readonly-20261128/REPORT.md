# Claude 只读核查：上海 `.12` 主入口自动评分

- **核查时间**：2026-11-28 01:19–01:25（北京时间）
- **执行者**：Claude Code 云端会话
- **方式**：只读。未登录、未提交作业、未手动触发任何 GitHub 工作流、未启动验收补触发程序。
- **输入包**：`R24-上海OpenAI评分-Claude上线复核-20261127.zip`，358,895 字节，SHA-256 `199a9867fa3f879fd77d9420f855803315a5e871cf815e60f4ebbd9d5edaf659`。包内 `sha256sum -c` 43/43 通过。

## 结论

| 检查项 | 结果 | 证据来源 |
| --- | --- | --- |
| 上海 `.12` 主入口：员工提交后自动评分 | **NOT RUN：主库评分链路未就绪** | 第 2 节为 GitHub Actions 运行记录；第 3 节为运维记录 |
| 包内 100 分评分 | **仅作 canary 验收证据**，不代表主入口自动评分 | 第 4 节 |
| 网页实时出题、新加坡网关、真人录音转写 | NOT RUN | 本轮未涉及 |

## 1. 主入口当前版本（公网只读，2026-11-28 01:19:51 北京时间）

| 项目 | 值 |
| --- | --- |
| 网址 | `https://unknown-roadrunner-d7cap6e21f517-1519058345.tcloudbaseapp.com/tcl-r24-cloud-sync-pilot/` |
| 清单 | HTTP 200，4,208 字节，SHA-256 `c0c615d69232ab6dd1c76b415ad5ee8dc9bb15d9c937aa146260ce34acb4a814` |
| 版本 | `r24-paraformer-excel-cloud-sync-v2-20261124.12`，41 个资源，逐个哈希 41/41 一致 |
| `index.html` | `03b257e6c541712ca408df99c9358064e8903e450127bcba5f84a3acc888ceb2`，与清单一致，页面显示 `R24-20261124.12` |
| `app-config.json` | `apiBase` 为主函数 `https://unknown-roadrunner-d7cap6e21f517-1519058345.ap-shanghai.app.tcloudbase.com/tcl-r24-sync` |
| 前端评分方式 | 仍为 `.11` 设计：主播在复盘页手动点「发起 AI 评选」，调用 `/evaluate`。前端没有 canary 自动评分使用的字段（`pending_review`、`openai_offline`） |

## 2. 生产定时任务（证据：GitHub Actions 运行记录）

- 工作流：私库 `lijianjun004-star/tcl-r24-score-archive` 的 `.github/workflows/r24-private-score-archive.yml`，提交 `bd9c2c0c9efb3e20aa03f1cb21e08bf047cfef33`。
- 触发方式：每 15 分钟定时；或通过 `workflow_dispatch` 接收 `submission_saved` 唤醒。
- 运行条件：job 条件为 `vars.R24_REPO_SCORING_ENABLED == 'true' && github.run_attempt == '1' && (github.event_name == 'schedule' || …)`。
- **截至北京时间 2026-11-28 00:58**，该工作流仅运行过 1 次：[46037978999](https://github.com/lijianjun004-star/tcl-r24-score-archive/actions/runs/46037978999)。事件为 `schedule`，`run_attempt=1`，结论为 **`skipped`**。
- 推断：定时事件与首次尝试两个条件都满足，job 仍被跳过，因此**生产开关 `R24_REPO_SCORING_ENABLED` 当时未开启**。本会话无权直接读取仓库变量，此结论由运行记录推断。

## 3. 主库队列、触发器与评分角色（证据：运维记录，未经数据库直查）

- 来源：私库 `operations/shanghai-synthetic.md`，提交 `bd9c2c0`，提交时间 2026-11-27 07:06 UTC（北京时间 15:06）。
- 记录内容：
  - 上海 `.12` 主试点使用共享提交表。只读元数据核对时，专用评分队列、回读函数、入队触发器及评分 worker 角色**尚未安装**。
  - 队列 Secret 对 runner 不可见，业务评分开关关闭。
  - 升级共享函数（候选 `.13`）会改变整个试点的同步评选行为，需另行批准。
- 本轮 Claude **未连接上海数据库**。上述安装状态完全引自运维记录，需管理员在数据库中复核。

## 4. 包内 100 分的来源：仅为 canary 验收证据

- 评分发生在**独立 canary**，不是主入口：
  - 函数 `tcl-r24-sync-can1`
  - 页面 `…/tcl-r24-cloud-sync-pilot/synthetic-score-can1/`
  - 作业 `r24-sh-canary-install-v1`
- 运行属于 canary 工作流 `shanghai-canary.yml`。该工作流共 4 次运行，**全部为手动 `workflow_dispatch`**（时间为 UTC）：
  - 07:09，失败
  - 07:27，失败
  - 07:37，成功
  - 07:51，成功，即 [45961302717](https://github.com/lijianjun004-star/tcl-r24-score-archive/actions/runs/45961302717)，由验收观察程序补触发
- 该工作流设有每 10 分钟的定时（11 月 27–28 日），但**没有一次由定时触发**。
- 包内记录相互一致：
  - 提交于北京时间 15:38:51，15:51:00 补触发
  - 模型 `gpt-6.1-terra`，调用 1 次，543 + 135 = 678 tokens，得分 100
  - 回执 SHA `f110fbfe93f3b114d5c6496c6350561688bac82d772d23cbaec18c6714320f09` 与私库读回一致
- 适用范围：这些证据证明 canary 链路在**手动触发**下可以完成评分与回传。它不证明定时或上海唤醒能自动触发评分，也不证明 `.12` 主入口已接通。

## 5. 后续实测条件与方法

1. 管理员确认以下三项：
   - 主库已安装评分队列与入队触发器
   - 评分 worker 账号已按最小权限配置
   - 生产开关 `R24_REPO_SCORING_ENABLED=true`
2. Claude 用获批测试账号从 `.12` 主入口提交一题。**全程不点击「发起 AI 评选」**，不手动触发 GitHub 工作流，不启动验收补触发程序。
3. 按该次提交的实际结果更新验收结论，核对：
   - 是否自动入队
   - 私库运行的事件类型是否为 `schedule` 或来自上海的唤醒，而非人工 `workflow_dispatch`
   - 主播与运营刷新后是否读到同一成绩
   - 回执是否与源库一致
4. 实测前还需要：
   - 测试账号的登录方式（新浏览器需要原设备生成的一次性设备码）
   - 会话网络放行上海 API 域名 `unknown-roadrunner-d7cap6e21f517-1519058345.ap-shanghai.app.tcloudbase.com`
