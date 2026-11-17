# R25 原生私有媒体验收

结论：**PASS_MEDIA_ACL_WITH_RANGE，完整suite 50项通过**。证据为真实Chromium、官方CloudBase JS SDK3.11.1、原生Auth/PG/Storage；媒体是人工生成的0.5秒440Hz单声道PCM WAV，不含真人音视频或ASR调用。

完整运行：`runs/20261117T004002413830Z/result.json`。固定50项均true，page errors为0；SDK bundle SHA及入口SHA在原始结果中保留，实际测试源代码另存 `tested-core-source/`。这次实际执行发生在root启用private_media后，没有用本机outbox替代服务器回执，也没有mock云请求。

已证实：

- owner上传后下载16044字节与本地合成WAV SHA256一致。
- 未关联operator、outsider、匿名SDK不能读取或申请签名；另对匿名无Authorization直接HTTP GET确认404。
- 客户端覆盖被403拒绝；DELETE API可返回成功但实际removedCount为0，随后原对象完整字节/hash保持不变。没有放宽删除策略。
- 直接PostgREST请求storage schema伪造objects行被406 / DATABASE_PGRST106拒绝。该证据仅证明当前schema暴露配置，未来改变schema暴露须重新验收。
- foreign实际对象、本人不存在对象、伪造size、伪造MIME、4个真实附件提交均被拒绝；3个真实附件获得原生PG提交回执。
- 关联受理运营和admin在独立浏览器context下载同一媒体，字节/hash一致；outsider、anon继续拒绝；同一对象重复绑定第二份提交被拒绝，受理运营登出后再次读取被拒绝。
- 无效JWT被拒绝。真实Range GET返回206，Content-Range为`bytes 0-99/16044`、Accept-Ranges为`bytes`，正文恰100字节且切片SHA一致。
- 60秒签名URL在另一个context不带Authorization仍能下载，实际证实其bearer能力。产品应走session鉴权download后本机Blob URL；不将签名URL当作每次按点击者检查的ACL。

root另通过实际SQL查询确认最终storage.objects.owner_id与该上传者UID匹配、metadata.size=16044、mimetype=audio/wav；SQL原始文件由root持有，不把含身份字段的原始文件或私有配置复制到本证据目录。StorageAPI.info返回顶层size/contentType，metadata为空且不含owner，不据此伪造owner核验。

## 保留的失败与修正

`PREFLIGHT-RESULTS.md`及各独立runs结果保留全过程：初始上传403、诊断明确新INSERT guard拒绝；root随后仅对本轮新bucket的两个INSERT policy作兼容修正，移除pending INSERT对owner/生成列/metadata最终值的依赖，保留本人uid路径、active helper、provider桶大小/MIME、读取及禁止覆盖/删除等限制；提交finalize仍核对最终真实owner/size/MIME。具体哪项旧谓词在初始INSERT时不满足未单独隔离，不把时序假设冒充全部事实。

compat后的第一轮因驱动仅把remove API的ok当成删除成功而误判FAIL；后续只读原对象hash证明未被删除，驱动改查removedCount和实际字节，原FAIL结果未覆盖。没有修改云策略来迎合该夹具。

可选真实MediaRecorder合成WebM运行在root发来暂停消息前已启动。收到暂停后已终止进程143，记为 `runs/video-20261117T004238445200Z/result.json` 中CANCELLED_BY_ROOT，未返回视频结果，上传是否完成不由本地结果确定，**不计通过**。对象模板保留于该运行取消记录，不删除任何对象。

随后root替换为新的native测试anchor并明确批准一次WebM补测：`runs/video-20261117T004636079250Z/result.json` 为 **PASS_SYNTHETIC_WEBM_SUBMITTED_AND_RECIPIENT_PLAYBACK**，9个外层检查均通过。真实MediaRecorder从合成canvas与oscillator录得VP8/Opus WebM 74970字节、1.56秒、320×180；owner上传/下载hash一致并实际播放16帧、0丢帧；提交获真实PG回执后，受理运营独立context下载同一SHA并实际播放16帧、0丢帧，page errors均0。没有访问旧anchor凭据，也不重跑原核心50项。

该WebM原始结果的共享驱动顶层仍带未使用的WAV默认fixture字段；原件保留不覆盖，实际视频依据为其video.steps与recipientVideo.steps。`VIDEO-SUMMARY.json`提供有明确来源的修正摘要，`tested-source/`冻结实际运行的video源码和adapter hash。后续驱动只修正这项元数据，不为此重复云测试。此补测不能外推真摄像头、真手机、MP4/AAC、实际拖动或真人语音准确率。

## 交付范围与限制

本次是原生API/媒体ACL验收，不是完整产品UI验收。真实手机、iOS/Android/微信内嵌浏览器、MP4/AAC解码、长录音内存、物理音视频拖动、中国大陆网络和真人/TCL语音准确率均未测。Range仅证明该合成WAV的真实HTTP分段，不外推全部媒体格式和真机播放器。

测试旧anchor按root要求随后退役，后续不读取或复用其旧token；这里保留的是执行时冻结结果，不声称退役账户当前仍可访问。当前产品发布和新UID验收状态由共同AI_CONTEXT维护。

已复制各run结果、测试源码与有限安全扫描；没有复制私有账号配置、浏览器storageState、cookies、请求Authorization、原始签名URL或页面trace。`SAFETY-SCAN.json`为有限JWT/私钥/服务key/签名URL模式扫描，不承诺检测任意隐蔽敏感值。
