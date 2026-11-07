# 练播房：模型通用项目上下文

更新日期：2026-11-07。适用于ChatGPT、Codex、Gemini、Claude及其他能读取Markdown的模型或代理。

这是本仓库唯一的模型通用交接入口。AGENTS.md、GEMINI.md、CLAUDE.md与START_HERE.md只指向本文件，不分别维护业务状态。开始或续接任务先读本文件，再核对仓库当前main、PR、Actions和线上页面；实时证据优先于历史快照。

## 项目和固定目标

| 项目 | 固定值 |
| --- | --- |
| 名称 | 练播房 / TCL新主播12周养成计划 |
| 仓库 | lijianjun004-star/tcl-v43-preview |
| 默认托管 | GitHub Pages |
| 旧根站 | https://lijianjun004-star.github.io/tcl-v43-preview/ |
| 新主播养成入口 | https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v09-ab/ |
| 发布文件 | 仓库根目录site.zip |
| 工作流 | .github/workflows/pages.yml |
| 自动触发 | push到main |
| 手动入口 | 已有workflow_dispatch |

常规更新沿用固定仓库和URL。保留旧根站与浏览器历史数据，不因换模型重新建站、改托管或随机更换路径。默认零新增费用，不自行购买服务或调用付费模型API。其他项目不继承此仓库作为目标。

## 用户确认的协作约定

- ChatGPT负责统筹与交付；Codex负责实现和测试；Gemini按任务需要参与整理或复核。按能力分工，不要求每次调用全部系统，也不把角色名称当作实际独立调用证据。
- 用户已确认本项目既定目标与范围内的常规提交、独立分支、PR、合并和测试部署默认批准。完成必要验证后直接推进，不就相同范围反复询问。
- 用户已允许API不可写时改用GitHub网页发布。发布流程仍遵循执行工具自身的权限、认证与必要确认规则；本文件不提供跨平台账号授权或登录凭据。
- 真实需求有歧义时，一次只问一个问题。已确认事项先查记录，不让用户重复解释。
- 新任务只处理当前请求。保留已暂停、只读或未验收的其他项目边界；不因恢复上下文自动推进CloudBase、后台接入或真实评分。
- 不宣称模型之间共享全部聊天记忆。以共同文件、实际读取结果、精确提交和验证证据交接。

## 当前已验证的业务发布

完整修复工具、源码、回滚基线及复验证据固定归档：https://github.com/lijianjun004-star/tcl-v43-preview/releases/tag/v0.9.1-v2.3 。标签对应发布提交79dd870de604fc2558d470ba4c8eb419454d6ff4；资产 TCL-V2.3-verified-release-kit.zip SHA-256 f6da614bb11239804eb18f6f2568ae0c7f95cbe300fc112d636f3151065e26ec。

任务 TCL-V23-20261104：按用户要求修复独立复验发现的问题，当前已部署 v0.9.1 / V2.3 稳定性修复静态测试版。

- 发布PR：https://github.com/lijianjun004-star/tcl-v43-preview/pull/8
- 发布提交：79dd870de604fc2558d470ba4c8eb419454d6ff4
- 成功Pages Actions：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/41720509159
- 发布基线：ea9c8f2edf6f9d943fd3dfc18c58415d68209141
- site.zip SHA-256：cc10c8849d1bd00453d6c46c8b1f24928e1552835c21ca9419abb1d0c722ade4
- 静态包94文件：旧根站43个文件逐字节保留，子目录51文件；50项资源哈希与覆盖检查通过。页面标题仍保留原v0.9，资源清单版本为 v0.9.1-v2.3-stability。
- 修复训练卡、live及诊断录音：授权前锁、独立会话和资源、迟到授权回收、构造/start/stop异常、旧事件、空音频失败、后台/离页释放、听写互斥。训练/live实际60秒、诊断45秒自动停止；正常live停止后保留相机预览，关闭或进入后台释放设备。
- 修复诊断Worker相对路径。子站SW升级v2.3，5秒未取得HTTP响应时中止网络并回退当前版本cache；不清理旧根站或模型缓存。首次离线未缓存可明确返回503；不承诺完整资源5秒下载。
- 本地执行：录音生命周期27/27、SW9/9、原诊断3/3、原发布门禁8/8、安全测试14/14、新ZIP/PR策略8/8、模拟HEAD变化合并拒绝、96项JS语法、HTTP9/9及50资源哈希通过。测试组存在覆盖重叠，不合并为单一通过率。
- 云端Chrome已打开新旧入口、训练详情打开/关闭、设备诊断、ASR诊断、清单、SW和公开Worker；线上清单50哈希逐项与候选一致，新脚本会话锁与停止timer可见。浏览器扩展元数据报错与应用来源错误区分记录。
- ASR诊断如实返回模型未就绪：ready.json HTTP404。完整中文离线模型、真实AI评分、后台鉴权及跨设备同步未接入。真人中文准确率、iPhone/Android录音录像和中国大陆可达性仍未验收。事件模拟不能替代真机验收。

## PR校验与主分支保护的真实状态

- CI安装PR：https://github.com/lijianjun004-star/tcl-v43-preview/pull/7 ，合并提交 ea9c8f2edf6f9d943fd3dfc18c58415d68209141。
- 安装检查成功：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/41718779145 。发布PR检查成功：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/41720320054 。
- main已有 .github/workflows/verify-pages-pr.yml 及 release-ci/release_guard.py、test_release_guard.py。每个main目标PR均运行 verify-pages-release；文档PR明确成功，发布PR只允许site.zip与校验值同步的pages.yml；CI维护独立校验。发布PR运行基线提交的校验器，不运行候选ZIP中的代码。
- ZIP校验新增实际有界zlib输出、中央目录数量与边界、本地头一致性、实际长度/CRC和流结束检查。
- **必需检查保护尚未保存成功**：GitHub保存规则时要求账号邮件再次验证。待配置：main要求PR、verify-pages-release由GitHub Actions提供、合并前保持最新、管理员也不绕过；无需额外他人审批。不能声称required check已强制生效。
- 本次按已授权网页方式，在实际CI成功后人工核对并合并；未绕过现有保护。发布工具的 --merge-on-pass / merge_verified_pr.sh 仍必须检查服务端required规则，没有规则时主动拒绝。
- 随本次交付提供修正发布脚本：始终以已验证SHA传入--match-head-commit；重复分支逐项核验后仅续接唯一open PR；main变化重新基于最新main准备新分支，不强推覆盖旧候选。CLI身份和完整真实gh流程尚未在本环境运行。

旧版回滚基线：恢复已验证的 site.zip（SHA-256 4187aeaead2240d8b627c64d18dec52d2622aebe4013055bd249397c3ee3ff39）和对应pages.yml校验值，走独立PR。保留本地历史数据；浏览器SW回滚生命周期需另行验收。

## 可恢复的发布通道

1. 优先使用当前足够的GitHub连接、CLI或API；先检查实际能力。
2. 已知曾发生：集成可读，create_branch/create_blob返回403 Resource not accessible by integration，即使仓库元数据push:true。不要据此认定GitHub Pages失效，也不要反复重试相同403。
3. 本项目已验证的备用方式是GitHub网页：已有正确账号登录时，可创建分支、上传site.zip、更新工作流哈希、创建及合并PR。PR #5即通过网页完成。
4. 不假定新的模型环境继承任何浏览器会话。若尚未连接或登录失效，按当前工具支持的安全流程恢复；不索取、保存或公开密码、Token、OTP。
5. 工具不足时准确说明当前阻塞，保留已完成内容；不能伪称已开启另一个Codex或Gemini会话。

## 发布与回滚步骤

1. 读取当前main、工作流及最新成功Actions，获取当前site.zip与校验值，确认任务范围。
2. 在独立分支准备更新。验证ZIP完整性、资源清单、相对路径和旧根站保留情况。
3. 更新site.zip时同步更新pages.yml中的SHA-256。当前工作流只解压site.zip；仅上传不同名字的ZIP或源码目录不会发布。
4. 核对PR差异后，按用户已确认的同范围授权合并。
5. 检查对应main提交的Actions确实成功，再验证新旧公网入口及关键资源，记录错误和未验证项。
6. 回滚通过新PR同时恢复最近已验证基线的site.zip与匹配工作流；不清理用户浏览器历史，不改其他仓库或CloudBase。

## 交接要求

每次实质任务记录：目标、当前执行方、来源版本、已做修改、PR/提交/Actions链接、实际验证、未验证项与下一步。把完成状态更新在本文件，不建立多个互相矛盾的“最新状态”文件。

切换模型时传递本文件URL与当前任务即可。要求接手方确认读取到固定发布入口、实际最新发布证据和未完成能力；无法读取时明确报告，不假装拥有前一个模型的记忆或权限。


## V3.3.4 专项练播独立手机测试部署（2026-11-04）

用户在知悉完整浏览器回归未执行后，明确要求先部署并亲自真机测试。当前是静态测试版，不是正式语音评分产品。

- 新入口：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-specialty-v33/ 。旧根站和 /tcl-v09-ab/ 保留，原有94文件逐字节不变；新目录仅12前端文件，共106文件。
- 来源修复包 V3.3.4 SHA256：89cd175388c04fd33699676e96268d9c95d48128966c7dbb5fe7117aa3fc0b84。site.zip SHA256：2f6ba643a38b1d2e2a767b1526cc270396b2e5a9422a01cad8d29bf78b7a8346。
- 修复：麦克风授权等待期间禁止重复申请和切题，离开后回收迟到流；独立语音会话阻止离页/切题/板块/平台后的旧回调，录音听写互斥。
- 本地：22/22 Node测试（其中12项为VM合成竞态）、HTTP9/9、语法及完整源码清单59文件通过。Chromium下载收到无效ZIP，完整浏览器回归未执行；不以他方历史日志替代本轮验收。
- CI规则PR #10：https://github.com/lijianjun004-star/tcl-v43-preview/pull/10 ，合并 ee8d8b9f3cd6497556c0853d605f1ccf358fac0a；新目录限定12文件及SHA清单，要求全部既有非specialty文件保持不变。原有8门禁测试通过，候选与额外/后端文件拒绝测试通过。
- 发布PR #11：https://github.com/lijianjun004-star/tcl-v43-preview/pull/11 ，已验证head c8fc3c870c01e69fa6ba121393369f4eab1b90f1；CI成功 https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/41842919069 。
- 发布提交：2480ff30ae3bcf75aca2ec1f1126fda0817004e8；Pages：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/41843092545 ，状态：completed/success。
- 待用户真机验收：摄像头麦克风、授权期间切题、退出再进入、切后台返回、单段120秒自动停止及反复录音回放。真机和中国大陆网络尚未验收。
- Worker/D1/R2未部署；中文ASR模型和真实AI评分未接入；主分支强制保护仍未保存成功。不得将测试部署等同正式全功能验收。
- 回滚通过新PR恢复本次发布前 ee8d8b9f3cd6497556c0853d605f1ccf358fac0a 的site.zip与匹配校验值，保留浏览器历史数据。后续以实时main为基线，避免回滚覆盖期间其他改动。


## V3.3.6 专项练播独立手机测试部署（2026-11-04，执行方：Claude）

用户确认接受“单场录制最长8分钟”上限，并同意由 Claude 直接走独立分支、PR、CI、合并。当前是替换 V3.3.4 的静态手机测试版，不是生产放行。

- 入口不变：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-specialty-v33/ 。旧根站43文件、/tcl-v09-ab/ 51文件逐字节不变；专项目录仍是 CI 白名单12文件（6个内容变化），共106文件。
- 来源包 V3.3.6（Gemini 整改，Claude 独立复验）ZIP SHA-256：c18ac1043b5e6a1310247da0b8e031a7202b3694fe800a49cc612821bfc37c20。site.zip SHA-256：7dc5dcdd679ccef83fc4d05a2e913b03e8e16b5038efbb04d637925e85cb15a0。
- 发布PR #13：https://github.com/lijianjun004-star/tcl-v43-preview/pull/13 ，head cab8cd9019df10e74df698efe48bb05562ff4284；verify-pages-release 成功 https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/41890275253 。
- 合并提交 8227785d59d492dbccd9e8418fec7f677fc45a7c；Pages：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/41890430968 ，completed/success（含 site.zip 校验步骤）。
- V3.3.6 相对 V3.3.4：整场音视频录制（单场8分钟或64MB自动停录，请求1Mbps）；未保存录像时 beforeunload 提示；录后 WAV 导出与可选 Whisper Tiny 识别（180秒/48MB 解码前预检）；第12板块旧平台名“抖音生活服务”只读兼容；9:16 contain 显示；TTS 手动朗读。
- 本地实测（Claude）：基线校验器 --verify-pr PASS、CI 回归8/8；候选包单元30/30、正向35/35、反向28/28、限额19/19、回归12/12、isolated 7/7、HTTP 9/9；真实时间8分钟自动停录（480.1秒，录像保留）；刷新提示生效；超时长录像在分配内存前拒绝；第12板块旧数据可读且不串板块；发布 site.zip 在真实子路径下浏览器冒烟0个404、0个外部请求、0个页面错误。
- 未验证：Claude 环境网络策略禁止访问 github.io，**未直接打开公网页面**，线上状态以 Pages Actions 成功为准，需用户手机确认。iPhone/Android 真机、iOS 实际码率（若忽略1Mbps，64MB可能早于8分钟触发）、中国大陆网络（ASR 依赖 cdn.jsdelivr.net 与 huggingface.co）、Whisper 模型 revision 未锁定、Worker/D1/R2 未部署。已知P3：页面标题仍显示 V3.3.5。
- 回滚：新PR恢复 site.zip 2f6ba643a38b1d2e2a767b1526cc270396b2e5a9422a01cad8d29bf78b7a8346 与匹配的 pages.yml 校验值（即 V3.3.4，main 4ccd48cd650c562b3c88cf3ebf2fdf43be642a7b）。

## V3.3.7 摄像头稳定性修复（2026-11-04，执行方：Claude）

用户真机反馈：摄像头"要么只显示一条横屏画面，要么整个画面被放大"，非常不稳定。已修复并部署到同一入口 /tcl-specialty-v33/ 。

- 根因（Chromium 内核实测复现）：V3.3.6 请求固定的 720×1280 / 9:16。Chromium/Android Chrome 以 resizeMode=crop-and-scale 裁切横屏传感器画面，只保留 32% 视野、放大 1.78 倍；不裁切的浏览器返回横屏画面，在 9:16 框内只占 32%；画面尺寸变化时不重新适配。
- 修复：取流不带固定比例并声明 resizeMode:'none'；竖持手机拿到横屏时，在同一轨道上 applyConstraints 换一次方向，不重复打开摄像头；与 9:16 相差 12% 以内铺满，其余完整显示，横屏时提示竖持；监听 video resize/loadedmetadata 与窗口 resize 自动重新适配；信息栏如实报告实际尺寸与显示方式；页面标题更正为 V3.3.7。
- 来源包 V3.3.7 SHA-256：841c05e6211aff9a9b9e25a1a9d0880a2074547d8ef385ddca73427fd7bcd248。site.zip SHA-256：0b4bfaa5d3855710146bff3faf8353100ff3ebdf3ee0f4a2eaf835dff307141a。与 V3.3.6 相比仅 tcl-specialty-v33/ 下 app.js、index.html、style.css、static-manifest.json 四个文件变化，其余102文件逐字节不变。
- 发布PR #15：https://github.com/lijianjun004-star/tcl-v43-preview/pull/15 ，head 412f5e18fc18bad31a677e49e3713be8e5f5c8b2，verify-pages-release 成功；合并提交 263fff02e8bc2d61fdb9519f34783d0d7ddd0997；Pages：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/41894406293 。
- 本地实测：A/B 对比 V3.3.6→V3.3.7，Chromium 视野 32%→100%，传感器方向设备画面占框 32%→100%；新增 tests/v337-camera-stability.py 17/17；原有单元30/30、正向35/35、反向28/28、限额19/19、回归12/12、isolated 7/7、HTTP 9/9；正向测试"必须contain"断言改为按本意检查不裁切（视野≥88%）。CI 校验器 PASS、回归8/8；部署版子路径冒烟0个404/0外部请求/0错误。
- 未验证：iPhone Safari / Android Chrome 真机（模拟只覆盖已知摄像头行为）；Claude 环境无法访问 github.io，线上以 Pages Actions 成功为准。若真机仍异常，请记录设备检查页"摄像头实际 W×H"那一行、手机型号和浏览器。
- 回滚：新PR恢复 V3.3.6 site.zip 7dc5dcdd679ccef83fc4d05a2e913b03e8e16b5038efbb04d637925e85cb15a0 与匹配的 pages.yml 校验值。

## V3.3.8 摄像头异步尺寸修复（2026-11-05，执行方：Claude；回应 ChatGPT V3.3.7 复验）

ChatGPT 独立复验 V3.3.7 的结论为"有条件通过独立测试阶段，不放行正式稳定版"，并发现 P2：方向纠正后轨道 getSettings() 已为竖屏、但 videoWidth/videoHeight 滞后，V3.3.7 据旧尺寸撤销纠正。该放行门禁对 V3.3.8 继续有效：仅用于独立测试站真机排障。

- 修复：是否撤销以轨道 getSettings() 为准（轨道仍横屏或报告 crop-and-scale 才撤销）；纠正成功后最多等3秒至画面与轨道方向一致；摄像头开启期间每0.5秒兜底检查画面尺寸并重新适配，关闭后停止；信息栏增加"诊断：轨道 W×H · 画面 W×H · 裁切模式（未报告时写明无法确认）· 屏幕竖持/横持"及镜像说明；window.__cameraLog 记录纠正过程。仅 tcl-specialty-v33/ 的 app.js、index.html、static-manifest.json 变化。
- 来源包 V3.3.8 SHA-256：41ccda1c8b77e3568a2ed25ff231c2969e3abfb8929afeec7ffc588737b07725。site.zip SHA-256：f80ffea116bef019d22014abcfd293235251f1e846cf3685b41fe1703b398abf。
- 发布PR #17：https://github.com/lijianjun004-star/tcl-v43-preview/pull/17 ，head 57c06668863d46407e207e0dfc73e3827019605f，verify-pages-release 成功；合并提交 facad87bde887e0e621ea425418afb108b991acb；Pages：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/41910032896 （success）。
- 本地实测：新增 tests/v338-camera-async.py（about:blank 注入，受限环境可运行）V3.3.8 16/16 连续3轮一致，V3.3.7 上 8/16；ChatGPT 原 camera_offline_fallback.py 在 V3.3.8 6/6×3轮、applyConstraints 每轮1次，在 V3.3.7 上随时序波动（6轮中2轮5/6）且每轮2次（每次都撤销）。其余：v337 摄像头17/17、单元30/30、正向35/35、反向28/28、限额19/19、回归12/12、isolated 7/7、HTTP 9/9；CI 校验器 PASS、回归8/8；部署版子路径冒烟0个404/0外部请求/0错误。
- 未验证：iPhone Safari、Android Chrome、微信/钉钉内置浏览器真机；真实传感器完整视野（需边缘参照物对照拍摄）。真机请记录设备检查页信息栏整行（含"诊断：…"）、机型系统版本和浏览器。
- 回滚：新PR恢复 V3.3.7 site.zip 0b4bfaa5d3855710146bff3faf8353100ff3ebdf3ee0f4a2eaf835dff307141a 与匹配的 pages.yml 校验值。

## V3.3.9 中文录后识别修复（2026-11-05，Codex执行）

- 目标：默认改为Vosk中文小模型，Whisper Tiny作为备用实验引擎；两者共用30ms能量静音筛选、约200ms余量、有声不足1秒拒绝、复读截断与中文比例质量提示。Whisper参数已核对transformers.js3.7.6源码，使用no_repeat_ngram_size=4、repetition_penalty=1.2。文本可编辑、不自动评分，原录像副本解码及SHA保护保留。
- 来源V3.3.8候选包SHA256：41ccda1c8b77e3568a2ed25ff231c2969e3abfb8929afeec7ffc588737b07725。发布前main 801b6c72429d4fff6ffc0d17d012a19039230e1c。
- 发布PR #19：https://github.com/lijianjun004-star/tcl-v43-preview/pull/19 ，已验证head 4c06a5dc6249cc0e74203805818c92089dd0f81b；PR检查success：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/41965163912 。合并 e599d173f1c8144ec39f626859fcda7a31e03245；Pages completed/success：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/41965316605 。
- site.zip SHA256：64cae310abb86cc6796d38243b305fb5ff8a944515ce140b3f2b4daef2858818。专项目录仍12文件，清单版本v3.3.9-zh-asr，旧根站43与/tcl-v09-ab/51文件逐字节不动。CI规则未修改。
- 分项实跑：原Node30/30、静音复读中文检查16/16、Vosk加载器13/13、入口取消/防重/离页/SHA保护6/6（Node VM模拟），npm65/65、HTTP9/9、门禁8/8、远端实际base/head的--verify-pr PASS。预览重新生成，标题/package/清单更新。
- 未执行：原七组浏览器测试及新增7项Vosk浏览器mock、真实Vosk普通话推理、iPhone/Android真机；Python Playwright安装成功但Chromium下载无效ZIP。线上vosk.js真实下载SHA匹配，不等于模型准确率已验收；没有虚构识别文本、耗时或内存。
- 有意的同源只读依赖：https://lijianjun004-star.github.io/live-practice-room/voice/ 。未修改该仓库；vosk.js固定SHA ed356edb8ac3c69df419d9252f1029bb04e23e381320f7a4611beb2d25217beb；11个模型分片当前使用固定文件名映射并做大小/非HTML启发式检查，**没有逐分片SHA-256**；真正的密码学完整性闸门是拼接43847018字节后的整包SHA ea1bfd4aebbe1bff20ec665c566bf4f2862e9e6cbfbb6d36dfb3357ebe1ef689。V3.4.2继续强制整包SHA校验，并在整包校验失败时清除11个缓存分片后再允许重试；vosk.js校验后才Blob执行，整包模型校验后才创建Model。对方更新资源后如哈希变化必须拒绝加载，需核验后同步固定哈希，不自动接受更新。
- 独立缓存tcl-specialty-vosk-v1，不清理其他缓存；首次约48MB/Wi-Fi确认、文件进度、可重试、下载/模型/推理有界等待并保留真实后台作业锁，取消与旧结果不得串场。模型加载和准确率仍需真机验收。
- 入口不变：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-specialty-v33/ 。手机验收：180秒/48MB以内清楚朗读测试中文2–3遍并停顿，结束后默认Vosk，确认首次下载，核对关键词和复读提示，保留机型/浏览器/时长/截图。测试句仅用于识别，不作商品或活动承诺。
- 回滚用新PR恢复V3.3.8 site.zip f80ffea116bef019d22014abcfd293235251f1e846cf3685b41fe1703b398abf 和匹配校验值，不清理用户数据，先核对实时main期间改动。未接付费/后台服务、不加日文注音处理。本轮只放行独立测试站，不声称正式稳定版。


## V3.3.10 Vosk中文模型下载修复（2026-11-05，执行方：Claude）

用户反馈线上 V3.3.9 Vosk 中文模型下载不了，提供 V3.3.10 修复包（ZIP SHA-256 d3470c164a68c578712b933298da2d2316af3293b4a223b2142fa9dad3384ce9）要求同步 web/。

- **未按原包 web/ 直接同步**：原包 app.js 基于 V3.3.6 摄像头代码（目录/package/static-manifest 仍为3.3.6，标题V3.3.5），直接同步会恢复 aspectRatio:9/16 裁切放大取流并丢失 V3.3.7/V3.3.8 画面适配、兜底检查与诊断。改为以线上 V3.3.9（main e2850b7）为基础，只移植"静音筛查+Vosk加载器+录后转写"代码块及面板/按钮绑定/按钮状态4处；摄像头代码保持线上版本。
- **根因核验（真实 vosk.js + 真实42MB模型，本地按线上URL提供）**：模型Blob URL提前释放——不成立（V3.3.9 真实库完整加载识别成功）；总超时120秒——成立（模拟约300KB/s：V3.3.9 121秒超时、12文件仅完成9个；V3.3.10 161秒完成）；缺少预下载入口——成立；缓存写入未捕获——基本不成立（已有try/catch，原包补了match/delete）；异步后确认框被拦截——依赖浏览器，未验证。
- **对原包的修正**：原包以"window.confirm 是否为原生函数"区分测试替身，导致真实浏览器下载48MB前不询问。改为所有浏览器一致：转写按钮在静音检查后、下载前询问（取消时提示改用预下载）；预下载按钮文字写明48MB，点击即同意，不依赖原生确认框。v335-reverse-browser.py 改为模拟用户点确定，并新增"首次下载前弹出48MB确认框"检查。
- 变化：模型准备超时转写300秒/预下载600秒；新增 #preloadVoskBtn；仅 tcl-specialty-v33/ 的 app.js、index.html、static-manifest.json 变化（标题V3.3.10，清单 v3.3.10-vosk-download）。合并包 SHA-256：70dae823276461f45391628855089b37032d62251b94c00a2ee33d9be8f098be。site.zip SHA-256：108fb2bcb6b88a817fc63296d39724f38ee90f3e29b21472bfce39c1dc02904a。
- 发布PR #21：https://github.com/lijianjun004-star/tcl-v43-preview/pull/21 ，head a0ad2b248336c37b480d91252993dff660d46c44，verify-pages-release 成功；合并提交 64825e7cc941b50fe62a85291e47d1bc0b5f2780；Pages：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/41987491840 。
- 本地实测：npm 65/65、v339 Vosk 浏览器mock 7/7、正向35/35、反向30/30、限额19/19、回归12/12、isolated 7/7、摄像头 v337 17/17 与 v338 16/16、HTTP 9/9、CI 校验器PASS与回归8/8；真实模型转写5.0秒、预下载3.0秒成功，0错误，缓存12条；发布 site.zip 子路径冒烟0个404/0外部请求/0错误。
- 未验证：普通话识别准确率（无中文语音样本，测试音为蜂鸣，空结果属预期）；iPhone/Android 真机；中国大陆网络下 github.io 实际下载速度。手机验收：Wi-Fi 下先点「预下载/校验 Vosk 中文模型（48MB）」至完成，失败可重点（已缓存分片复用），再开播清楚朗读测试句并转写。
- 回滚：新PR恢复 V3.3.9 site.zip 64cae310abb86cc6796d38243b305fb5ff8a944515ce140b3f2b4daef2858818 与匹配的 pages.yml 校验值。

## V3.4.0 弹幕真实化 + 逐题转写检查 + 知识库接入准备（2026-11-06）

本任务执行方为 ChatGPT；使用独立分支、业务 PR、固定 head SHA、实际 CI 成功后合并，之后由 GitHub Pages 发布。**这是独立测试站发布，不是正式评分产品验收。**

- 发布入口保持：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-specialty-v33/ ；没有改动旧根站或 `/tcl-v09-ab/`，历史营销内容脱敏留作独立后续任务。
- 用户最终决定：**京东/天猫共用训练数据与合规规则，抖音单独**。16个品类/平台板块不变，不拆出型号专属训练入口。
- Part A：按平台生成模拟观众口吻弹幕，泛化昵称、无应答闲聊、随机连发与投诉优先处理；京东/天猫模板属于待补真实语料的中性过渡版本，不冒充原始弹幕。
- Part B：每题独立会话ID、回答单题录音、Vosk已就绪自动录后转写、未就绪保留音频供补转写；跨题转写结果写回原题，离开会话旧结果作废；每题用时、合规提示与训练汇总保存在本机记录中，不宣称正式 AI 评分。
- Part C：内部两份 XLSX **未提交至 GitHub，未加入 site.zip**。244条当前讲解词的合规改写草案仅在私有交付文件中、全部待运营审核且“允许公开=否”；本地导入脚本为独立交付，不放在12个公开静态资源中。知识库原文及任何改写版**必须经过运营审核与用户本轮明确同意公开后**方可上站；本次实际导入0条。
- Part D：前端内置通用＋当前平台合规提示词表和人工复核标记，**不包含517条监控原始记录**。监控原话测试 517/517 命中只是关键词覆盖测试，不等于违法判定。
- 维护边界：V3.3.7/V3.3.8摄像头原生视野、异步尺寸纠正与诊断未回退；V3.3.10 Vosk 模型预下载、固定SHA校验、300/600秒上限及缓存策略保留。没有修改 `live-practice-room`、CI策略或其他仓库。
- 用户选择 **A：本轮先发布不新增敏感资料的V3.4；旧公开内容暂时保持原样，另行评估脱敏和安全回滚**。不得将该选择解释为授权新增知识库原文或促销素材。

### 发布与校验
- 业务PR #23：https://github.com/lijianjun004-star/tcl-v43-preview/pull/23
- PR已验证head：`6d780808cb06cbc3cd2ad10ec4c4505f1fe227d2`
- verify-pages-release：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42249890902 ，completed/success；GitHub可信基线检查实际输出 `verify-pages-release PASS: release/root/manifest/checksum/paths`，106个文件，旧根站43、原训练51、专项12，旧根逐字节保留。
- 合并提交：`2b91fadad9d22f8d313825b8b3aa1f3c83abde83`
- Pages：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42250084012 ，completed/success，ZIP校验、解压、资源上传与deploy步骤全部success。
- V3.4.0 site.zip SHA-256：`508f91d313da12c6465945b531540f4b476544f2dcde3de3c39a8a3e24dd37e5`。只修改 `site.zip` 和相应 `pages.yml` 哈希，未修改 CI。
- 回滚需以届时最新main为基线走新PR恢复V3.3.10的 `site.zip` SHA-256 `108fb2bcb6b88a817fc63296d39724f38ee90f3e29b21472bfce39c1dc02904a` 与匹配工作流校验值；不得直接重写或清理用户数据。

### 本轮独立测试与未验证项
- `npm run lint` 通过；`npm test` 65/65；`local-http-static` 9/9；`v335-browser-independent` 35/35；`v335-reverse-browser` 进程成功完成；`v336-reverse-guards` 19/19；`flow-v331-regression` 12项通过；`flow-v331-isolated` 成功完成。
- 摄像头 `v338-camera-async` 16/16；`v337-camera-stability` 原版受模拟HTTPS域名访问策略阻断，采用相同合成媒体场景的 about:blank 离线适配跑通15/15，原脚本最后2项真实Chromium摄像头**未执行**，不能写作原版17/17通过。
- `v339-vosk-browser` 原版因Node Playwright/浏览器安装及模拟域名限制未原样执行，采用离线隔离适配7/7；`v34-browser` 逐题转写/弹幕/mock模型 22/22；合规规则对内部测试517/517命中，4条正常表达无命中；知识改写草案244条数值标记比较未发现差异，但仍需运营逐句复核。
- 未执行：真正普通话录后识别准确率、iPhone Safari/Android Chrome真机、长时间录制真实硬件/中国大陆网络可达性、Worker/D1/R2云端同步。云端Pages操作成功不等于这些能力通过；本次验证工具无法直接打开 `github.io` 公网页面。

## V3.4.1 训练弹幕去商品编号、改问已公开型号（2026-11-07）

用户在 iPhone Safari 实测发现：练播房没有购物袋或商品号，V3.4 弹幕仍问“几号多少钱/有什么功能”，实际无法对应商品。按用户要求 **只调整公开弹幕模板与生成器**，保持16个板块、平台分组和媒体/ASR链路不变。

- 本次把两组平台（京东/天猫共用，抖音单独）的 `{n}号` 提问替换为 `{型号}` 及不同型号比较提问；包括价格咨询、功能、优惠、对比与连发。
- 型号只取 V3.4 已经**公开**的 `training-boards.json.public_model_names`。电视组合条目如 `98/85/75/65 T7M Pro` 只展示来源中已记录的 **T7M Pro 系列**，不臆造任何具体尺寸 SKU。
- 型号必须与练播品类一致：全品类问题显式注明 TCL 产品品类。雷鸟电视、雷鸟显示器、本地生活、智能门锁尚无核准的公开型号清单，**用通用品类问题替代**，不能拿 TCL 电视/显示器型号冒充雷鸟型号。
- 用户原有安全决定 A 继续有效：旧根站、旧 `/tcl-v09-ab/`、`legacy-65.json` 保持不变，旧站脱敏留作后续独立任务；未审核知识库原文或改写版、内部两份 XLSX、原监控记录均**不能**加入公开站点。
- 此次型号仅用于模拟观众提问，**没有依据未审核知识库生成标准答案，也不宣称型号级自动事实评分**。

### 实际复验与发布

- 本地：`npm run lint` PASS；`npm test` 65/65；新增型号弹幕 Chromium 模拟 20/20；V3.4 逐题转写模拟 22/22；原浏览器正常流程 35/35；浏览器反向测试进程 PASS；V3.3.8 摄像头异步 16/16；旧媒体生命周期 12项 PASS；隔离训练流程 PASS；HTTP静态资源 9/9。
- 新安全与品牌隔离测试涵盖16板块全部平台、通用型号回退、系列名去尺寸组合、同品类不同型号比较、雷鸟品牌隔离及旧编号模式回退。
- 当前主分支中与旧 V3.4 `site.zip` 相比只有4个 `tcl-specialty-v33/` 文件内容改变：`app.js`、`training-boards.json`、`index.html`、`static-manifest.json`。总计106个文件，根站43、旧训练站51、专项12；旧站和65卡逐字节保留。
- 新 SHA-256：`6af70cb7b21911a605aa47c8df4e0bd96a4b436084a6f7527187bfa95e324544`；旧 V3.4 SHA-256：`508f91d313da12c6465945b531540f4b476544f2dcde3de3c39a8a3e24dd37e5`。
- 业务 PR #25：https://github.com/lijianjun004-star/tcl-v43-preview/pull/25；锁定 CI 通过的 head `c8b492906cf78bf8be303de1e8627cdfbc53ec59`。
- trusted `verify-pages-release` 实际运行 PASS：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42255027148 ；校验输出证实旧站逐字节保留、白名单、清单、SHA均通过。
- 合并提交：`b49fddda36606d750fa37dea3b00efcfb98eb57a`；Pages：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42255166738 ，completed/success，原生 GitHub Actions 完成部署。
- 测试入口仍为：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-specialty-v33/ 。
- **未执行**：用户新发布版本的真实iPhone/Android二次验收、真人中文Vosk识别准确率、真实云数据库跨设备核验；自动化模拟结果不能代替这些检查。
- 需要回滚时按独立 PR 恢复旧V3.4 `site.zip` 与 `pages.yml` 对应校验值，先核对当时最新 main，不修改根站、旧站或用户记录。


## V3.4.2 Gemini/Claude/Codex 回归加固（2026-11-07）

用户将 V3.4.1 固定提交 `daea8a41f5aadf8f42d610f6946aed42cdb831bb` 先交由 Gemini 第一轮全面反推，再由 Claude 第二轮独立交叉复验，并提供 `tcl-v342-regression-pack.zip`。本轮由 ChatGPT 结合两份报告、回归包和额外代码审查实施最小增量修复。**仍属于独立测试站迭代，不等于真人中文识别、真机或正式AI评分已经验收。**

### 修复范围与边界

- Vosk 预下载改为独立生命周期：准备页显示下载/校验进度，开始直播不再误取消预下载；模型就绪后刷新既有题目的“补转写”按钮。
- toast 提升到直播/准备/抽屉之上；优先投诉弹幕保留警示底色并作为独立插入，不再混入主训练问题。
- 单题 Vosk 转写串行队列化，阻止与整场识别并发；录音/封装期间不再从队列移除待转写题，录音结束后继续消费；业务取消不销毁已加载模型。
- 重录会清理旧 transcript、合规和要点结果，但保留已人工保存且不同于旧 transcript 的回答；首次响应用时不被重录覆盖；结束直播时收敛未完成录音状态。
- 切平台、切板块、返回首页清理本场 session/active turn/音频和转写状态，避免跨场串题。
- 显示器尺寸、本地生活、智能门锁、全品类参数/场景按当前品类修正；公开型号清洗支持多系列拆分并剔除歧义单尺寸SKU；雷鸟继续禁止借用TCL型号。
- 京东/天猫仍共享训练规则，但按当前直播间识别“提到其他平台”；CR05收紧为竞品语境，避免普通描述误报。
- ASR复读检测不再因为正常多次说“TCL”删词；要点匹配收紧否定语义与过短片段；运营导入补齐参考话术等答案列别名和冲突校验。
- 运营导入表头采用精确优先、短表头模糊匹配；问题列与答案列必须不同；识别到问题表头但没有答案表头时保持 `incomplete`，不得拿“来源”等元数据冒充答案；无表头两列问答继续兼容。
- 品类共享冲突在实际导入路径显式带入当前 category，只在同品类比较；不同品类同名问题不互相阻断。
- Vosk整包SHA-256继续是无条件最终完整性闸门；整包校验失败清除11个缓存分片，避免坏缓存无限重试。没有新增或宣称不存在的逐分片SHA。
- 额外加固：识别器异步 error 可立即结束等待而不是白等30秒；云端待审ID写入 `data-*` 前转义。
- **未处理且继续独立**：F-17旧根站SW/CI策略、F-19参考话术展示、F-20旧站脱敏；Claude判定不成立的F-13未据此修改识别器。
- 旧根站43文件、`/tcl-v09-ab/` 51文件、`legacy-65.json`、V3.3.7/V3.3.8摄像头核心代码/样式逐字节或受守卫保持；未加入内部XLSX、未审核知识库原文/改写版或517条监控原话。

### 回归、Codex复审与发布证据

- 最终候选 `site.zip` 共106文件，SHA-256：`fa9bd90b750d7ad5aa5312858b86c068b4804b74c9ae7a6595e5942f15ff9747`；ZIP CRC/testzip通过。
- 本地边界守卫：22/22 PASS，0 fail / 0 warn；Claude纯函数回归：23/23缺陷用例 PASS、11/11不变量 PASS；针对Codex后续发现追加定向用例最终9/9 PASS；`app.js` 与 `lib/qa-import.js` Node语法检查通过。
- 原始Playwright浏览器回归**未执行到业务断言**：当前执行容器Chromium受系统管理策略 `URLBlocklist=["*"]` 阻断，生产origin与localhost均返回 `ERR_BLOCKED_BY_ADMINISTRATOR`。此项不能写作通过或失败，也不能用Node模拟替代真浏览器。
- 业务 PR #28：https://github.com/lijianjun004-star/tcl-v43-preview/pull/28 。最终固定 head：`49d87dc94dd83663c811497ccb05abe1a4df1808`。
- trusted `verify-pages-release` 最终运行：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42345104558 ，completed/success。
- Codex在早期head依次发现4项P2、1项P2、1项P2，共6项真实边界缺陷，均先修复并新增定向回归；对最终head `49d87dc...` 的复审 completed，`has_any_findings=false`、`has_unresolved_findings=false`。
- 合并提交：`cb4319bffdbc837ce6cbbbb4c39c400afd540e82`。
- Pages：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42345345717 ，completed/success；`Verify audited static bundle`、解压、Pages artifact上传、`Deploy independent test site` 全部 success。
- 固定测试入口不变：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-specialty-v33/ 。本轮工具无法直接打开 github.io 公网页面，因此公网页面内容本身仍需用户真机确认；Actions success只证明部署链路成功。
- **仍未执行**：iPhone Safari/Android Chrome V3.4.2真机复验、真人普通话Vosk准确率、中国大陆真实模型下载速度、长时间真实硬件录制、真实云数据库跨设备同步。当前没有正式AI评分，不得用模拟结果替代这些验收。
- 回滚需以届时最新main建立新PR，同时恢复 V3.4.1 `site.zip` SHA-256 `6af70cb7b21911a605aa47c8df4e0bd96a4b436084a6f7527187bfa95e324544` 及匹配的 `pages.yml` 校验值；不得直接重写main或清理用户历史数据。


## V3.4.3 多 Agent 训练一致性修复（2026-11-07）

**业务与安全边界**：仅 TCL 智能练播房独立测试站 `tcl-v43-preview/tcl-specialty-v33/`。旧根站 43 文件、`/tcl-v09-ab/` 51 文件、`legacy-65.json`、摄像头 V3.3.7/V3.3.8 核心、Vosk 整包 SHA 与原有限额保持不变。未导入未审核知识库原文、内部 XLSX 或直播监控记录。本版仍没有正式 AI 自动评分。

### 已实现
- 训练主弹幕使用当前教学题 `q.question`，与对应 `keyPoints` / `pointKeywords` 同源；随机弹幕只作辅助闲聊/投诉。
- 16 板块 × 3 阶段共 48 道 seed 题按现有品类重写，特别纠正本地生活、智能门锁及显示器等板块的通用家电错配。
- seed 题增加受控 `semantic_keywords` 原子要点同义词；上传/审核题无 aliases 时仍保留兼容判断。自查是规则匹配，不是语义大模型评分。
- 负向要点由词面相似升级为邻接否定/核对约束，修复短负向、同义改写、无关否定和自带否定含义别名等 Codex 反馈。自然语言组合仍不保证语义完全正确，出现前后矛盾的回答需人工复核。

### 并发和发布门禁的经验
- PR #30 业务初版因 ZIP 中文文件名编码导致可信门禁失败，但被过早合并；随后 PR #31 被关闭，没有合并。
- CI-only PR #32 已完成针对**唯一已知坏 ZIP SHA**的定点中文文件名恢复规则和回归；该例外不适用于其他 ZIP/文件名。
- PR #33 与 #34 是同源重复发布候选。为防止重复合并，#33 主动关闭且未合并，只以 #34 作最终发布。
- 真实最终发布 PR #34：https://github.com/lijianjun004-star/tcl-v43-preview/pull/34
- PR #34 最终 head：`820679ccd07ff7cca2ffb13956a003d1d2d09476`；GitHub trusted CI：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42351666382 （success）。
- Codex 对该 **exact head** 的最后复审：`status=completed, has_any_findings=false, has_unresolved_findings=false`。对旧 head 的历史 P2 不能与最终 head 混淆。
- 合并提交：`309df80525ec84199fa973a323be079bd5d1a98b`。
- 最终 `site.zip`：106 文件，SHA-256 `687b2da761b8b394d6528684f85f5ed322adb2ce6da9d72e89be06483cad486e`；UTF-8 `tcl-v09-ab/设备检查.html` 存在，ZIP CRC/testzip PASS。
- Pages：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42351910450 ，completed/success；Verify audited static bundle、Extract、Upload、Deploy 全部 success。
- 入口不变：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-specialty-v33/

### 已执行与未执行的边界
- V3.4.2 boundary guard：22/22 PASS，0 fail，1 个预期人工审核 WARN（只因 `training-boards.json` 的 `boards/version` 变化）。
- 旧缺陷回归：23/23 PASS；旧不变量：11/11 PASS；Codex 既有定向回归：9/9 PASS；V3.4.3 新定向：27/27 PASS。
- `app.js`、`lib/qa-import.js` Node 语法检查通过；ZIP CRC/testzip、manifest 11 文件哈希核对通过。
- 在受限 Chromium 用 about:blank 注入应用脚本和本地 JSON 替身，已实际看到 16 板块首页及“本地生活”板块入口，未观察到该检查中的 JS 页面错误；**不等于完整 Playwright 流程回归或真机验收**。
- 原浏览器全流程 Playwright 因 URLBlocklist 管理策略阻断目标地址，未执行到业务断言。iPhone Safari、Android Chrome、真人普通话 Vosk、中国大陆网络首次模型下载速度、长时真实硬件录制、真实跨设备后端均**未执行**。
- 当前工具无法直接打开 `github.io` 公网入口进行端到端验证；Pages Actions 成功证明发布链路，不证明所有客户端可用。
- 后续如需回滚：先核对实时 main，以新 PR 修改 `site.zip` 及 Pages SHA，禁止强制改写 main 或清理用户历史数据。
