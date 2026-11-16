# R25 独立源码复核与最小跟进修复

任务 `TCL-R25-CODEX-INDEPENDENT-REVIEW-20261116`。ChatGPT统筹，Codex本地复核与修复；基线提交 `910b3a1`，初始app SHA-256 `635ed0ea61402fe6277a5bed2c9d2887b6c8b1cfab05d7d90608006558efb60f`。本分支尚未推送、合并或部署；无付费API，没有修改R24、发行归档、工作流或发布门禁。

## 已复现并修复

### P2：下载失败后，每题录音重新启动静默下载

初始 `app.js` 的 `r25AutoVosk` 会在 `voskUi.state==='error'` 时停止自动下载，但 `r25RouteAsr` → `r25EnsureVosk` 没有同样的门槛。首次下载报错后继续录三题，会再次发起三次下载；Whisper失败后若Vosk已报错，也会重启失败的下载。整包SHA失败时已有实现会清除模型分片缓存，因此这种重试可能重复消耗整包流量；本轮没有实际制造42MB的重复下载。

使用未修改的实际路由、队列和 `preloadVoskModel` 函数，在Node VM中注入失败加载器复现：初次失败后，三题使总加载次数从1增至4。原始失败见 `evidence/r25-codex-review/retry-policy-before.log`。

修复让所有自动准备入口在错误状态停止，不改变手动按钮直调 `preloadVoskModel` 的入口。默认Vosk及Whisper失败后的题目均说明原录音已保存、需要手动重试，成功后仍自动补转全部已保存且没有文字的题。

新增 `tests/r25-retry-policy.cjs`：五项检查涵盖连续三题不自动重试、延后队列/重进训练不重试、手动重试成功补转、显式Whisper选择仍先尝试、Whisper失败后保留原录音与手动重试。测试没有调用真实网络或语音模型。

### P3：整场Whisper实际Tiny却显示Base

默认Vosk模式下，现有Whisper实例配置为Tiny；整场转写入口的完成文案却将所有非Tiny选择显示为Base。只修正标签分支，不改实际引擎或默认选择。

新增 `tests/r25-session-engine-label.cjs`，运行实际整场处理函数及实际模型配置表达式，核对Vosk、Tiny、Base三种偏好显示与配置一致。修前在Vosk偏好下失败，修后通过；音频与模型为模拟。

## 复核范围与验证

- R25数据库、BroadcastChannel、引擎偏好、私有术语键和Vosk缓存均使用独立命名空间；未修改R24数据。新增源码与R24对比仅七个产品文件。
- Vosk逐题结果保留人工修改及清空；任务有效性使用场次、板块、平台、音频对象和修订号。静态审查未发现新增P1或跨题覆盖证据。
- Bridge的真实Worker路径超时会先终止Worker、拒绝挂起请求，再释放fallback资源锁；本页Whisper继续禁用。注入式pipelineFactory无法强停，继续保持资源锁。现有7项mock检查和额外init/load/infer三阶段AbortSignal探针通过。
- 页面当前取消队列只使晚到结果无效，没有向bridge传入AbortSignal；不能称页面取消操作已立即停止Worker。三阶段探针证明的是bridge接口能力。
- 整场转写入口仍要求用户明确选择引擎；没有扩展为整场Whisper失败后自动Vosk回退。

最终app SHA-256 `2848488723324db8a897fcb0fc4cbe577916b0e3e01cce8e05922aed8c3d1bfc`。由更新后的 `tools/patch_r25.py` 从精确R24基线重新生成，21条manifest哈希重算吻合。相对R25初稿仅app与manifest改变。

本子任务运行相关既有检查：routing9、queue2、regression14、manual-clear3；新增retry-policy5、engine-label3，全部通过。首次regression夹具缺少实际页面已有的 `voskUi` 变量报ReferenceError，仅补夹具后通过，失败日志保留。源码复核的所有mock日志及摘要见 `evidence/r25-codex-review/`。

主任务另行执行浏览器回归及真实Vosk关键流程；其结果不能由上述mock测试代替。真手机、真实大陆网络、真人/TCL话术准确度仍未验收。发布须等待主任务的最终批准边界。
