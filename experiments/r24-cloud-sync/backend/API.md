# QA3 作业云同步接口

接口接受 `Authorization: Bearer <access token>`。服务端认证器校验令牌和启用的帐号，并提供稳定帐号 ID、团队、角色及展示姓名。客户端可读取角色以选择界面。访问许可由服务端根据帐号 ID、团队和作业归属判定。

| 方法 | 路径 | 请求和结果 |
|---|---|---|
| GET | `/me` | 返回 `{principal:{id,role,displayName}}`。角色为 `operator` 或 `anchor`。 |
| GET | `/recipients` | 运营可读取本团队启用的主播帐号，返回 `{recipients:[{id,displayName}]}`。团队公开发布无需此接口。 |
| POST | `/assignments` | 运营传 `{assignment,recipientIds}`。`assignment` 是未更改的 QA3 `makeAssignment` 结果。团队公开发布时 `recipientIds` 和 `assignment.assignedTo` 均为空数组。返回 `{assignment,publishedAt,replayed}`。 |
| GET | `/assignments` | 运营读取自己发布的作业，主播读取本团队可参与的作业。返回 `{assignments:[{assignment,publishedAt}],nextCursor}`。主播行另含 `submitted` 和 `lastSubmittedAt`，只反映当前帐号的提交。 |
| POST | `/assignments/:id/submissions` | 主播传 `{snapshot}`，返回 `{submission,replayed}`。使用当前练播的 QA3 冻结版本和完整、有序的回答。 |
| GET | `/assignments/:id/submissions` | 发布运营读取对应作业的提交，返回 `{submissions,nextCursor}`。 |

提交需要以下练播字段：

```js
{
  id, assignmentId, assignmentVersion, assignmentSnapshotSha256,
  operatorName, boardId, platform, anchorName,
  turns: [{questionId, question, answer, transcript, model, sku, asrStatus, manualCleared}]
}
```

`turns` 必须覆盖每道原题并保持原顺序。提交不接收录音或录像文件。服务端只保存列出的答题内容，计算提交时间和逾期状态，并用认证帐号记录归属。提交记录包括 `id`、`assignmentId`、`assignmentVersion`、`snapshotSha256`、`anchorId`、`anchorName`、`sessionId`、`submittedAt`、`late` 和 `turns`。

新发布和新提交返回 201。同一运营重试相同作业 ID 与内容，或同一主播重试同一作业和场次及内容，返回 200 和原记录。该去重依赖写入存储的原子新增操作。已有 ID 的内容无法修改，冲突返回 409。作业和记录列表最多每页 20 条且受约 1 MB 响应大小限制，传 `?cursor=<nextCursor>` 继续，直到游标为 `null`。

POST 仅接收 `application/json`，上限 1,000,000 UTF-8 字节。QA3 校验另限制每份规范化作业或回执为 900,000 字节，每题回答最多 10,000 字符，转写最多 20,000 字符。错误格式为 `{error:{code,message}}`。

`api.mjs` 提供 Node.js 20+ 的 WHATWG Request 到 Response 处理器。它使用原样保留的 QA3 校验器和该发行版的板块映射。`memory-store.mjs` 是本地测试存储，进程结束后数据消失。运行测试：

```sh
node --test tests/api.test.mjs
```
