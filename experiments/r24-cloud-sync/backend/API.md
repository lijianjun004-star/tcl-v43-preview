# R24 作业云同步接口

除开通和激活外，接口接受 `Authorization: Bearer <deviceCredential>`。服务端按有效设备凭证识别稳定账号 ID、团队和角色，按账号和作业范围授权。POST 请求使用 `application/json`。

## 身份与设备

| 方法 | 路径 | 请求和结果 |
| --- | --- | --- |
| POST | `/device/auto-enroll` | 传 `{name,role,deviceCredential}`。角色为 `anchor` 或 `operator`。成功返回 `{status:"enrolled",name,role,deviceId,principal}`。同姓名已有绑定时返回 409 `ALREADY_ENROLLED` 和 `registeredRole`。 |
| POST | `/device/activate` | 传 `{name,role,code,deviceCredential}`。成功返回 `{name,role,deviceId,principal}`。已有客户端还可使用 `displayName` 和 `deviceToken` 字段。 |
| POST | `/device/code` | 仅限已绑定设备，传 `{}`，返回 `{code,expiresAt,name,role}`。生成新码会作废该账号此前未使用的码。 |
| GET | `/me` | 校验设备并返回 `{principal:{id,role,displayName}}`。 |

姓名采用 NFKC、去首尾空白并检查 2–30 个字符及非法字符。设备凭证是 `r24d_` 加 64 位小写十六进制，签发码是 `R24-` 加 24 位小写十六进制。设备接口请求体上限 4,096 字节，响应禁止缓存。

设备错误返回 `{errorCode,error:{code,message}}`。激活对错码、错姓名或错角色返回 `CODE_MISMATCH`（401），对已过期或被作废的未用码返回 `CODE_EXPIRED`（401），对已成功绑定到另一台设备的码返回 `CODE_USED`（409）。同凭证的传输重试可恢复已绑定结果。开通和激活的超额请求返回 `RATE_LIMITED`（429）、`retryAfter` 和 `Retry-After` 响应头。

## 作业、领取与提交

| 方法 | 路径 | 请求和结果 |
| --- | --- | --- |
| GET | `/recipients` | 运营读取本团队启用的主播。公开发布可以省略此请求。 |
| POST | `/assignments` | 运营传 `{assignment,recipientIds}`。公开发布时 `recipientIds` 和 `assignment.assignedTo` 均为空数组。服务端复算冻结快照哈希并校验品类、平台和原题，返回 `{assignment,publishedAt,replayed}`。 |
| GET | `/assignments` | 运营读取自己发布的作业，主播读取团队中可领取的作业。主播行含本人 `claimedAt`、`submitted` 和 `lastSubmittedAt`。 |
| GET | `/assignments/draft` | 已登录运营读取 `{available}`，表示当前账号是否已开放一键出题。 |
| POST | `/assignments/draft` | 已开放的运营传 `{material,boardId,platform,count}`，成功时返回 `{requestId,source,degraded,retryCount,questions:[{question,answer,keyPoints}]}`。 |
| POST | `/assignments/:id/claim` | 主播传 `{}`，返回 `{claimedAt,replayed}`。同一主播重复领取返回同一时间，新领取超过截止时间将被拒绝。 |
| GET | `/assignments/:id/progress` | 发布运营读取 `{claims,nextCursor}`，每项包括 `anchorId,anchorName,claimedAt,submittedAt`。 |
| POST | `/assignments/:id/submissions` | 主播传 `{snapshot}`，返回 `{submission,replayed}`。先保存文字和转写。 |
| GET | `/assignments/:id/submissions` | 发布运营读取提交、回答及已确认音频信息。 |
| GET | `/assignments/:id/my-submissions` | 主播读取自己的提交、回答及已确认音频信息。 |

文字提交快照使用以下字段。

```js
{
  id, assignmentId, assignmentVersion, assignmentSnapshotSha256,
  operatorName, boardId, platform, anchorName,
  turns: [{questionId, question, answer, transcript, model, sku, asrStatus, manualCleared}]
}
```

`turns` 必须覆盖每道冻结原题并按原顺序提交。服务端记录提交人账号、时间和逾期情况。发布、领取和提交首次写入为 201，同内容安全重试为 200。沿用作业 ID 或同场次键但内容不同会返回 409。列表最多每页 20 条且受响应大小限制，传 `?cursor=<nextCursor>` 继续。

一键出题的资料最多 20,000 字，目标题数为 1–15。返回值是待复核草稿，运营确认后另行调用常规发布接口。网关成功的来源为 `openai_gateway`。兜底草稿返回 `source=fallback`、`degraded=true`、`errorCode` 和脱敏中文 `errorMessage`。拒绝访问或无可用兜底时返回非 200。网关错误可按请求编号和 `GATEWAY_HTTP_xxx`、`GATEWAY_TIMEOUT`、`GATEWAY_CONFIG_MISSING`、`INVALID_AI_JSON` 等错误码排查。网关成功、兜底及失败的来源与编辑确认流程见[联调说明](../cloudbase/README-CloudBase.md#私有网关联调)。

## 逐题录音

| 方法 | 路径 | 请求和结果 |
| --- | --- | --- |
| POST | `/assignments/:id/submissions/:submissionId/audio` | 仅提交人可在文字提交确认后传 `{questionId,mimeType,base64}`。返回 `{audio,replayed}`。 |
| GET | `/assignments/:id/submissions/:submissionId/audio?questionId=...` | 仅提交人或作业发布人可读取，返回 `{mimeType,base64}`。 |

每道题保存一段录音，二进制上限 512 KiB。接口允许 WebM、Ogg、MP4/M4A、WAV、MP3、AAC 音频，校验格式、题目和 SHA-256。相同音频可重试，已登记不同音频返回 `AUDIO_CONFLICT`。暂未确认上传的录音不会出现在可播放列表，文字提交保持有效。整场录像保存在主播本机 IndexedDB。

作业请求体上限为 1,000,000 UTF-8 字节。规范作业或回执上限各为 900,000 字节，每题回答上限 10,000 字符、转写 20,000 字符。作业错误返回 `{error:{code,message}}`。

```sh
node --test tests/api.test.mjs
```
