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


## V3.4.4 逐题汇总与中文数字后处理修复（2026-11-07）

**用户实测反馈**：V3.4.3 的“逐题回答汇总”没有文字；中文口述数字、型号可能被 ASR 听错或被转换逻辑误改。本次修复只改善保留、汇总、回填和保守数字格式化，不宣称 Vosk 模型本身识别准确率已提升。

### 业务调整
- 逐题汇总优先显示用户已保存的人工回答，再回退到本题识别文字；录音存在但识别未完成时显示明确的待补转写状态和入口。
- Vosk 在用户主动触发准备后可以串行补转写此前本场保留的单题录音。浏览器语音识别结果也写回当前本题记录，不仅停留在临时编辑框。
- 题目切换和结束本场时保存当前编辑稿；全场录后文字只在用户明确选择复制时填入当前题，不自动拆分并伪造逐题转写。
- 同题重录清除旧 normalized/raw ASR 文字，使用每题 `audioRevision` 阻止旧音频识别回写。Vosk 与浏览器 ASR 共享修订状态，避免旧结果覆盖新结果；任务出队前检查已识别的题并跳过过期队列项。
- 保留模型**识别原文**供核对，手动修改的文本优先显示、保存。识别原文与规范化文本相同时，若与人工修正答案不同仍允许展开原文。
- **保守口述数字格式化**：仅转换明确的数字与单位，例如 `七十五寸→75寸`、`两点五匹→2.5匹`、`一千九百九十九元→1999元`、`百分之八十→80%`。保留 `两三分钟`、`十五六分钟`、`一万五元`、`百分之十几`、`几十分钟`、`三到五元` 等近似或省略表达，禁止局部转换。将 `千瓦`、`千瓦时` 等复合单位视为完整单位，避免拆错。并不从训练题推测实际型号、价格和正确数值。
- 合规负向要点匹配的后置否定范围得到额外修复（例如“最低价不用怀疑”不误判为“不承诺最低价”）。其结果仍是有限规则的参考自查，而非正式 AI 自动评分。

### GitHub 分支、审查、CI 和上线
- 仅使用独立业务 PR #37：https://github.com/lijianjun004-star/tcl-v43-preview/pull/37 。审查过程中 Codex 多次提出真实 P2：模糊数字误转换、重录旧 rawTranscript、复合单位拆分、模糊百分比局部转换、双引擎识别竞态、排队 Vosk 覆盖浏览器识别、清空人工编辑后答案不同步，以及十几/十七八等区间误转换。每次先修再提交和重新审查。
- 唯一最终业务 head：`8690e8299dc70e96371b5a8f885b25f8d5d3efc7`。Codex 对该 exact head 的最新代码复审为 `status=completed`，`has_any_findings=false`，`has_unresolved_findings=false`。旧 head 的绿灯不得替代新 head。
- Trusted PR CI：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42358888120 ，`completed/success`。
- 业务合并 SHA：`062f92a039a44ba93d585e936ae7046c66bcaa54`。
- 最终 106 文件 `site.zip` SHA-256：`05ccd22f13acad926128e59155c83b57c98576ee2351975a990220c7a2faf745`，并与 Pages workflow 中的 pinned SHA 匹配。只修改 `site.zip` 和其 Pages SHA。
- Pages 发布：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42360506753 ，`completed/success`；Verify audited static bundle、Extract、Upload 和 Deploy 全部成功。
- 实测入口保持：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-specialty-v33/ 。
- 根站 43 文件、`/tcl-v09-ab/` 51 文件、`legacy-65.json` 和原摄像头核心、Vosk 模型来源/整包 SHA 等边界保持；未纳入未审核知识资料。

### 测试证据、保留风险
- V3.4.4 专项回归 74/74 PASS；V3.4.3 专项 30/30 PASS；Claude 旧缺陷 23/23 PASS、不变量 11/11 PASS；边界守卫 22/22 PASS。
- 已用隔离 Chromium + 模拟浏览器 ASR 事件验证页面、逐题 DOM 汇总、人工纠错显示、补转写入队、跨引擎回调竞态；未见该测试中的 JS 异常。这些测试**不能代替真人普通话模型识别测试**。
- **仍未执行**：iPhone Safari 和 Android Chrome 真机权限/录音/回放、真实普通话语音下的数字/型号准确率、中国大陆网络 Vosk 首次下载、长时录制、真实跨设备后端同步，以及完整端到端 Playwright 公网导航。
- 后续需要收集同一题的“用户实际说法、原始模型识别文本、人工纠正文本、浏览器/设备、模型准备状态”，区分声学模型听错与文本格式化错误。明确禁止在缺少真实语音证据时声称“中文准确率已达到验收标准”。
- 本版本不改仓库 `tcl-live-monitor`；不修改旧版训练站或其他 Pages 路径。回滚须先核对届时实时 main，通过新独立 PR 及可信门禁实施。

## V3.4.5 弹幕多样化专项发布（2026-11-07）

本次按用户确认的原 GitHub 发布链路直接实施；不要求 Work、不重建仓库、不触碰其他项目。**性质仍是测试站**，不等于正式稳定版。

### 真实发布证据

- 来源：用户上传的 `TCL-V3.4.5-弹幕多样化-复验与候选包(4).zip`，内含 `01-候选发布/site.zip` 及复验证据和修复脚本。
- 发布 PR #39：https://github.com/lijianjun004-star/tcl-v43-preview/pull/39 ，唯一业务 head `be193cc4b9b15272e55d9629d883b752a1314eda`，从 V3.4.4 main 基线 `741a198d92683816f76b87f00dfc737b08381c3a` 建独立分支。仅修改 `site.zip` 与 `.github/workflows/pages.yml` 中的匹配校验值。
- GitHub Blob 传输后重新计算并核对 Git 对象 SHA：`070d06323a4e076f86c3bd5ebfc5abaa42dd20f5`；候选 `site.zip` 的 SHA-256 为 `a4db4efed7e095f01d283ca8866a348b34c8f8f74816fe8e6a716cc097c7eed8`。
- 候选 106 个 ZIP 文件全部通过 CRC/testzip；12 个专项文件与上传包的 12 个源码文件逐字节一致。独立读取 GitHub 最新 main 的旧 `site.zip` 对账了全部 106 个目录项：仅 `tcl-specialty-v33/app.js`、`index.html`、`training-boards.json`、`static-manifest.json` 四项出现 CRC/解压长度变化，其余 102 项一致；可信 CI 进一步执行发布门禁。受压缩参数影响，重新压缩后的 ZIP 成员压缩字节不保证相同，保留结论针对解压资源内容。
- 可信 PR CI：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42373906885 ，`verify-pages-release` completed/success。
- 合并提交：`305ef81cdb548cd9c692ee7ce2131c6a9ea344da`；对应 Pages Actions：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42373987406 ，completed/success；验证静态包、解压、上传和 Pages 部署步骤全部 success。
- 固定专项入口：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-specialty-v33/ 。本次外部网页访问工具未能直接访问 `github.io`，**没有宣称完成真实公网端到端浏览器验收**；Actions 发布成功是独立证据。

### 变更边界与功能

- 保留 16 个板块及原训练要点、合规自查，不生成未经核准的知识库讲解词。
- 观众弹幕采用同阶段不同口语问法、洗牌袋避免快速重复、随机昵称、平台差异化闲聊和优先投诉；主播提示展示原训练要点。
- 不更改根站 43 个文件与 `/tcl-v09-ab/` 51 个文件的解压资源、摄像头核心、Vosk 整包 SHA 校验和来源、转写防串题、`legacy-65.json` 或 `app-config.json`。不修改 `live-practice-room`、`tcl-live-monitor` 或 CloudBase。
- 上传包所附复验记录：弹幕多样化测试通过；v335-browser-independent 35/35、v335-reverse-browser 29/29、v336-reverse-guards 19/19、V3.3.7 camera 17/17、V3.3.8 camera async 16/16、V3.3.9 mock 7/7，以及实际 Vosk 下载/初始化/逐题识别/写回链路在合成音频环境下通过。上述细项为**交接包提供的证据**，不能误称本次 GitHub Actions 全部重新运行。独立执行过 ZIP 完整性、106 项差异检查；PR 可信发布门禁已在 GitHub 重新通过。
- 已知 P2：旧 V3.3.10 单测资产在 V3.4.4 与 V3.4.5 上均只有 44/59 通过，另有一个超时；不能将过期断言当作 V3.4.5 新回归，也不能声称全套单测通过。
- **未完成**：iPhone Safari、Android Chrome 真机；真人普通话及数字/型号识别准确率；中国大陆网络首次加载约 48MB Vosk 模型；长时真机音画录制；跨设备后端；本工具对 `github.io` 公网入口的直接访问。不可伪造识别文字或宣布正式稳定。
- 回滚基线：V3.4.4 `site.zip` SHA-256 `05ccd22f13acad926128e59155c83b57c98576ee2351975a990220c7a2faf745`；重新开独立 PR 同步恢复 `site.zip` 和 Pages 校验值，不强推、不清缓存。

## V3.4.6 Gemini 复验修复发布（2026-11-08）

状态：**GitHub Pages 独立专项测试站部署成功，仍非正式稳定版**。沿用 `tcl-specialty-v33/` 固定入口，不修改其他仓库、CloudBase 或旧版本业务资源。

### 发布与审查的可追溯事实
- 来源：用户上传 `TCL-V3.4.6-Gemini核实与修复候选包.zip`，先读 `00-先读我-Gemini报告核实与V3.4.6候选.md`。交接说明包含 Gemini 五个 P2 的重现/修复记录及旧测试调整，外部报告结论需和实测区分。
- 基线 main：`8bf8363a1ac28d3b8b4697e1ef0b373a804a4417`（V3.4.5）。业务 PR #41：https://github.com/lijianjun004-star/tcl-v43-preview/pull/41 。分支 `release/v346-gemini-fixes-20261108`；唯一审查 head `72fa976a93d3e33b509d8cc8d6034f2eb85596f8`。
- 可信 PR CI：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42461675709 ，`verify-pages-release` completed/success。
- **Codex 对同一最终 head 的审查已等待完成再合并**：PR 评论中的 `codex-review-state:v1` 记录 `commit_sha=72fa976a93d3e33b509d8cc8d6034f2eb85596f8`，`status=completed`、`has_any_findings=false`、`has_unresolved_findings=false`；无未解决的 review threads。没有重复 V3.4.5 业务 PR #39 在 Codex 提交 P2 前合并的问题（PR #39 合并 2026-11-07T12:46:50Z，Codex P2 评论随后 12:48:34Z 发布）。
- 业务合并 SHA：`4908af4d86dba83e02704204b7c3a11b9cf4eae9`。对应 Pages Actions：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42462079203 ，completed/success；Verify audited static bundle、Extract、Upload 与 Deploy 全部 success。
- 候选 `site.zip` SHA-256：`bbe690233242f458e95032e4d62c087ae0b60bc91d58803777f5d337b3fbb3bf`，与 `pages.yml` pinned SHA 相符。Git Blob SHA：`522df429dc88027b9db76c5365eff5f116f90117`。
- 线上固定地址：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-specialty-v33/ 。**工作流部署成功不能代替真机或公网端到端验证**；本运行环境未独立访问线上 `github.io` 页面。

### 变更和测试边界
- `site.zip` 共 106 个文件且 CRC 完整。逐项解压内容对比 V3.4.5：仅 `tcl-specialty-v33/app.js`、`index.html`、`style.css`、`training-boards.json`、`static-manifest.json` 五项变更，其他 101 个资源逐字节一致（包括旧根站、旧训练站、`legacy-65.json`、Vosk 模型加载及 SHA 校验配置）。
- 修复：雷鸟电视/雷鸟显示器问法隔离（qv184/qv214）；全品类跨品类对比；本地生活抖音成交问法；同题重录的新识别文本回填；主动清空人工回答后回退识别原文；聚焦态投诉红棕背景；单题识别推理锁，防止超时后新旧推理并发。
- 本轮独立运行：Chromium 修复回归 `v346-fixes.py` **6/6 PASS**，弹幕多样化浏览器测试 PASS，v335-browser-independent / v335-reverse-browser / v336-reverse-guards 均退出 0；Node 可运行的六个测试文件 **61/61 PASS**。另外两个后端/源包测试文件因交接包缺少 `worker/src.js` 无法运行，不能计入通过。旧摄像头异步测试在本次重跑中已输出 `COMPLETE 16/16`，但测试进程未在调用超时前正常退出，**不计作完整退出成功**。交接包列有更广泛的复验和 69/69 记录，属于交接方结果，不能当成全部被本轮重新执行。
- **仍未执行**：真人普通话与数字型号准确率、iPhone Safari / Android Chrome 摄像头与麦克风真机、国内网络首次下载约 48MB Vosk 模型、长时真实硬件音画同步、跨设备云端后端、公网完整端到端。
- 回滚基线：V3.4.5 `site.zip` SHA-256 `a4db4efed7e095f01d283ca8866a348b34c8f8f74816fe8e6a716cc097c7eed8`；需开独立 PR 同时恢复 `site.zip` 和 `pages.yml` 校验值，禁止强推 main 或清除浏览器历史数据。

## V3.4.7 最小修正发布（2026-11-09）

状态：**GitHub Pages 专项测试站已部署成功，仍不等同正式稳定版**。固定入口继续为 `/tcl-specialty-v33/`；不修改旧根站、`/tcl-v09-ab/`、其他仓库或 CloudBase。

### 来源、复验与候选修正
- 用户上传 `TCL-V3.4.7-复验与最小修正候选包.zip`，先读 `00-先读我-V3.4.6改版复验与V3.4.7候选.md`。该包说明：线上 V3.4.6 main 为 `a947aa967e677f0fc63e8191e7e5f02d6c75a239`，线上 `site.zip` SHA-256 `bbe690233242f458e95032e4d62c087ae0b60bc91d58803777f5d337b3fbb3bf`。
- 原 V3.4.7 候选 `site.zip` SHA-256 为 `bcb4c4d8308a00cb6f023f86347435b3207f24e734a12b0ebd75610c8b8429b9`。独立复验确认 106 文件 ZIP CRC 正常、12 个专项文件与源码逐字节一致；当前环境实际重跑 `npm test` **66/66 PASS**、`npm run lint` PASS、`v346-fixes.py` PASS、`v346b-typing.py` PASS、`retry_after_timeout.py` PASS（`maxActive=1`）、`v345-danmu-variety.py` 16 板块 / 25 平台组合 PASS、`v338-camera-async.py` **16/16 PASS**。
- 原包已纠正上一轮“69/69”统计错误：完整 Node 单元测试实际为 **66/66**。本包中“iPhone 14 Pro / Pixel 7 尺寸实测”不作为有效真机/准确视口证据；记录中的实际宽度均为 500px。
- V3.4.7 相对线上 V3.4.6 的实质业务变化：转写等待期间人工输入即时保存、保留人工修改；本地生活/显示器/昵称弹幕隔离；保留单题 Vosk 推理互斥、不在超时时强制释放仍在运行的推理锁；分片等待时间随测试超时设置收敛；版本号更新为 V3.4.7。

### PR #43、Codex P2 与最终修复
- 业务 PR #43：https://github.com/lijianjun004-star/tcl-v43-preview/pull/43 。首次 head `95d0c57893f713646083175e63c6fba6e4540b33`。
- 首次 head 的可信 PR CI 成功，但 Codex exact-head 审查发现 **P2**：当本题已有浏览器语音识别的旧自动文字，再执行 Vosk 补转写且得到不同新文字时，`turn.answer` 与逐题汇总会更新，但当前 `#answerText` 输入框仍可能保留旧自动文字；切题/结束时旧文字可能反向覆盖新回答。
- GitHub 中 `@codex address that feedback` 因该仓库未配置 Codex Environment，未能直接自动修改分支；随后按该 finding 做最小修复并补回归：
  - 没有人工编辑时，Vosk 新自动结果同步更新当前题输入框、`turn.answer` 和汇总；
  - 识别等待期间人工输入继续保留；
  - 识别等待期间用户主动清空也继续保留，Vosk 结果仅作为识别原文/回退文本；
  - 新增精确回归覆盖“旧浏览器 ASR → Vosk 新结果”以及等待期间人工输入/清空，**3/3 PASS**。
- 修复后重新构建最终 `site.zip`，SHA-256 **`2e2183c83067211c4ba550ad5dd8a065c7aaf8152fb7ce5e0037dd93ac2ad7da`**；Git blob SHA `ed4907bb1ffb48efb92dfab894cc0ec551f1faa2`。原候选 `bcb4c4d8…` 已作废，不得再发布。
- 修复后重新运行：66/66 单元测试 PASS、lint PASS、Codex-P2 精确回归 3/3 PASS、V3.4.6 修复回归 PASS、真实输入事件回归 PASS、超时后重试 PASS（最大并发识别仍为 1）。
- 最终业务 head：`39a7dc363db806f0780b3a67caf46934d8337f9d`。可信 PR CI：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42586600518 ，completed/success。
- Codex 对该**最终 head**重新审查，状态：`completed`、`has_any_findings=false`、`has_unresolved_findings=false`；旧 head 的 P2 finding 不再作为最终未解决项。
- 业务合并 SHA：`96e64451470be3cb0a4cdf71e93f26561ba60a46`。
- Pages 部署：https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42587047560 ，completed/success；Verify audited static bundle、Extract、Upload、Deploy 均 success。

### 发布边界、剩余风险与回滚
- 独立对比候选 ZIP 与线上 V3.4.6：106 个目录项数量一致；实质内容变化集中在 `tcl-specialty-v33/app.js`、`index.html`、`training-boards.json`、`static-manifest.json`。中文 `设备检查.html` 在不同 ZIP 读取路径中出现文件名编码表现差异，但 CRC 与解压大小一致，不是内容变化。
- 当前仍有 **P3**：回答框每次输入事件都会立即调用保存并重绘汇总；300 次连续输入测试触发约 300 次写库。当前模拟环境耗时约 53ms，功能正确，但低端手机 + 中文输入法下可能需要后续 300ms 左右防抖优化。本次不扩大需求。
- **未执行/不能宣称**：真人普通话及数字/型号准确率、iPhone Safari / Android Chrome 真机权限与长时录制、中国大陆网络首次约 48MB Vosk 下载、完整公网端到端。当前网页读取工具无法直接访问 `github.io`，Pages Actions 成功只证明发布链路，不证明所有客户端已验收。
- 固定测试入口：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-specialty-v33/ 。
- 回滚基线：V3.4.6 `site.zip` SHA-256 `bbe690233242f458e95032e4d62c087ae0b60bc91d58803777f5d337b3fbb3bf`；通过新的独立 PR 同步恢复 `site.zip` 和 `pages.yml` 校验值，禁止强推 main 或清除用户浏览器历史。


## V3.4.8 主播/运营简化交互与作业流（2026-11-09）

- 产品：手机优先双入口「主播练播房 / 直播运营」，仅姓名进入（**前端演示，不是真实身份认证**）；自由训练可反复练习、主动选择运营提交；运营作业按运营姓名/作业名称/训练板块搜索，作业提交固定归原运营，不自动提交；截止时间可选，运营能看加入/训练日志和次数，但未提交成绩、逐题、转写、媒体详情不得展示。
- 流程：开播前设备检测、弹幕间隔 30秒/1分钟/2分钟（用于闲聊/投诉，题目切换仍手动）、手机 9:16 专注态、结束后独立复盘。
- PR #45 原合并时存在未处理 Codex P1/P2，不能视为最终安全基线；修复 PR #46 最终 head `80d3d97b94a9411756acf2dd4e81d7b5b42f38d8`，合并 main `b9041f158d066853cc06783fe63d3c72418a4c8d`；Pages `https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42609797558` completed/success。
- V3.4.8 `site.zip` SHA-256：`155d56b66a8b4678e70407fe37da918a27b9a46914f864ec82a122e53357676d`，保留作回滚基线。

## V3.4.9 界面逻辑修复与跨标签原子事务补丁（2026-11-10）

- V3.4.9 原候选 `site.zip` SHA-256 `4d8b6231952280cf2af13c0d96e97bf574737dfb03dd3a82939dea3614a1af08`，**已作废，禁止重新发布**：静态「先读再写」无法防止两个标签页真正并发时的丢更新。
- 原候选改善：离开复盘可临时返回本场、手机返回行为、文字模式作答、中文连续搜索不失焦、截止时间状态、作业上下文清理、运营可看训练次数、手机复盘布局和交互提示。静态页面刷新、身份切换或关闭浏览器仍可能丢失未提交的会话媒体；页面提示中须如实告知。
- 新 P2 修复：`updatePrefList()` 将 `assignments` / `assignmentJoins` / `trainingLogs` 的读取、同步 mutate、写入放在**同一 IndexedDB prefs readwrite 事务**。仅在 tx.complete 后返回和 BroadcastChannel 通知，异常 abort/reject；内存回退兼容。影响范围仅 `tcl-specialty-v33/app.js` + `static-manifest.json`，媒体/摄像头/Vosk/ASR 核心、旧根站及 `/tcl-v09-ab/` 资源不变。
- **最终线上 `site.zip`**：SHA-256 `183777276ed14d05293fa5f92e93b22b59a363569335647009d0b6cbb8ca158b`，106 文件，ZIP CRC PASS，Manifest 11/11。Git blob SHA `c4199707fa3a9fe6b3f93f38901ae2e532450105`。
- 业务 PR #47：https://github.com/lijianjun004-star/tcl-v43-preview/pull/47；exact head `eb66f43d68c6a915fd0340cb978b8cad17e9bf0e`；可信 CI https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42764829301 completed/success；Codex 对该 head review completed，`has_any_findings=false`、`has_unresolved_findings=false`；合并 SHA `6fb948bb82a13216abc371033fa860467f4b328d`。
- Pages https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/42765273529 completed/success；Verify ZIP、解压、artifact 上传、Deploy 全部成功。固定测试站 https://lijianjun004-star.github.io/tcl-v43-preview/tcl-specialty-v33/ 。当前外部网页访问工具打不开该网站，**Actions 成功不是公网真机验收**。
- 本轮独立执行：Node 事务模型双标签/去重/回滚/通知 15/15 PASS（**不是原生双标签 IndexedDB 验收**）；Chromium about:blank 注入 UI 14/14 PASS、隐私/截止状态 12/12 PASS；弹幕计时 15/15 PASS；JS 语法、ZIP CRC、manifest 完整性 PASS。Node Playwright 完整脚本因环境缺包未执行。
- **未执行**：真实同源双标签原生 IndexedDB、iPhone Safari/Android Chrome 真机、真人普通话与产品数字/型号准确率、中国大陆网络模型首次加载、长时真机录制、正式跨设备后端及身份鉴权。姓名输入仅供本机测试，不能宣称运营数据生产级隔离。直播监控相关仓库、CloudBase、其他 Pages 路径均未改动。
- 回滚：以届时最新 main 开新独立 PR，同时恢复 V3.4.8 `site.zip` SHA `155d56b66a8b4678e70407fe37da918a27b9a46914f864ec82a122e53357676d` 与对应 `pages.yml` pinned SHA；不得重写 main、清浏览器数据或覆盖其他站点。

## 直播监控 R2.1 接力审计与修复（2026-11-10，执行方：Claude）

**这是另一个项目的记录**：仓库 `lijianjun004-star/tcl-live-monitor`（TCL 京东直播监控），不是练播房。应用户要求记在本文件；该仓库自身没有 AI_CONTEXT.md。本节不改变练播房的任何状态、发布或回滚基线，本仓库的 `site.zip` 与 `pages.yml` 未动。

### 来源与任务
- 用户上传 `TCL京东直播监控_R2.1_Gemini复验与Claude交接完整包_20261110.zip`，按其中 `02-Claude接力审计任务书.md` 的 4 项执行审计，随后按用户逐步指示修复并合并。
- 独立核验：`MANIFEST.json` 7/7、`HANDOFF_MANIFEST.json` 95/95 SHA-256 匹配；包内源码与分支 `experiment/r21-jd-today-delivery` 的 `5836da6` 逐字节一致；本地 `node --test tests/*.test.mjs` 188/188。

### 审计结论
- 未发现可绕过 `formal_opening_rate_percent: null` 的路径：7 条映射全为 `PENDING`，即使提供已核实排班与自称已证实的 LIVE 观测，结果仍为 `null` / `BLOCKED_IDENTITY`。
- `MIXED_OBSERVED` 与 `OBSERVED_LIVE_PRESENT` 的差异不是数据问题：包内 `r21-accepted.json` 由提交 `50d75df`（20:22）生成，真实巡检 20:23:50 运行，`27a31ed`（20:28）才改枚举。
- 单个 `OFFLINE` 会整包 `BLOCKED` 并清空房间；真实链路目前到不了这里（`tcl-jd-all.mjs` 写死 `offlineRuleValidated:false`），保留为上游契约被破坏的报警。
- 15 分钟与 60 秒边界本身无漏洞。

### 修复与合并（均为 squash 合入 `experiment/r21-jd-today-delivery`，合并前 CI 通过且 Codex 对该 head 无发现）
- PR #33，head `9ff10b1`，合并 `80ed382`：预览页每 30 秒及切回标签页重算有效期；CSV 公式防护覆盖前导空白、控制字符、全角符号；`BLOCKED` 不渲染不导出房间；0 房间改为 `BLOCKED`/`EMPTY_ROOM_CATALOG`；`maxAgeMs` 非有限值或负数按过期拦截；验收报告补证据版本说明。测试 188→196。
- PR #34，head `6a17d8f`，合并 `6aa9fa6`：LIVE 必须具备采集端在线、分钟数据 3 分钟内、非停播候选，否则 `LIVE_EVIDENCE_INCONSISTENT`；`reason` 限定字符集并截 80；`category`/`warnings` 去控制字符；不存在的时间戳拒绝；映射表有任一未核实身份时不出开播率（新增 `crosswalk_identities_complete` 与状态 `NOT_READY_CROSSWALK_IDENTITIES_INCOMPLETE`）；预览页内嵌样本与真实证据对齐。测试 196→200。
- PR #35，head `538fd8a`，合并 `578cce0`：处理 Codex 在 PR #32 上的 P2（已复现）。`catalog_complete_attested` 除分页范围外还要求 `catalogStatus === 'RECEIVED'`，并尊重 `monitoringCoverage.roomCatalogComplete === false`。测试 200→201。该问题是首轮审计漏掉的，不是 #33/#34 引入。
- PR #32（R2.1 当日交付）：应用户要求由草稿转正式；Codex 首次审查 `6aa9fa6` 报上述 P2，修复后经 `@codex review` 对 `578cce0` 复审 `has_any_findings=false`；该 head 上 `offline-quality`×2 与 `audit` 均 success。以普通 merge 合入 `experiment/r20-jd-opening-rate-readiness`，合并提交 `7f70280cbe9b032bc9f84bfb676ae36cd64f81ae`。https://github.com/lijianjun004-star/tcl-live-monitor/pull/32

### 边界与未完成
- **main、旧 Pages、生产 cron 均未改动**；R2.1 目前只在实验分支 `experiment/r20-jd-opening-rate-readiness` 上。合并 #32 之后该分支上的 CI 结果未查看。
- 未访问真实 TCL 运营源，未重跑真实源工作流；手机 Safari 真机未测，预览页只在无头 Chromium（390×844）验证。
- 有意未改：房间 1 的期望品类（冰箱/空调，待运营确认，改掉会让品类冲突告警消失）；`r21-jd-real-source-one-shot.yml` 步骤名中的 "six-room"（改该文件会在合并时触发一次真实源巡检）；开播率命令行默认读 R2.0 六房间映射表（R2.0 工作流依赖）。
- 副作用：重新生成的 `r21-formal-readiness.json` 多一个字段 `crosswalk_identities_complete:false`，不再与交付包逐字节相同；LIVE 复核的 3 分钟阈值镜像 `probes/lib/tcl-ops.mjs`，上游阈值变更需同步。
- 仍不可宣称：京东公开主播账号映射（0/7）、正式排班（0 条）、可靠 OFFLINE 反例、真实开播率/准时率、跨运行持久化、24 小时无人值守。7/7 LIVE 是一次状态截面，不是开播率。


## V3.5.2 UI-R3 测试站准备（2026-11-11）

- 以 GitHub main `bfedfc91d1a21f9e323dfd4f908125798f70d301` 为业务资源基线：`site.zip` SHA-256 `fa488483cd3489e47a976f4a745b588438a3f5f0680e6dedff05c81262902727`，共 118 文件。V3.4.9 位于 `/tcl-specialty-v33/`，V3.5.2 原手机测试站位于 `/tcl-v352-mobile-qa/`。此前文本中的旧 106 文件哈希为历史状态，不是本次读取的 main 资源。
- CI 规则 PR #53 已合并到 `a567fd003e75b324f5ef6022a526758cd43a2867`；识别旧测试目录并为 `/tcl-v352-ui-r3/` 增加清单、哈希、存储隔离与旧文件保护。门禁回归 20/20；可信 PR Actions run `42983323334` 成功。
- UI-R3 发布 PR #54 准备中，候选 `site.zip` SHA-256 `01a18f697741c04b3bdc38a0ce87db3eba14626d5950dab8281633bca5e455d3`，保留 118 个既有文件、仅新增 12 个资源。以 GitHub PR 和最新 Pages Actions 为准，尚不可声称本候选已部署。
- 合并纯 CI 改动触发了原始站点资源的 Pages run `42983410795`：第一次产物上传成功，但部署读取到 0 个同名产物；重跑同一 run 后出现 2 个同名产物而失败。该运行未证明原站关闭或已更新；须使用新的 workflow run 验证，不能反复重跑同一 run。原站资源未被修改，公网访问及中国大陆可用性仍需实测。
- UI-R3 仅供独立手机测试：本机记录不跨设备同步，暂无正式 AI 评分；iPhone/Android 真机摄像头、录像回放、语音识别及大陆网络仍未验收。保留 8 分钟/64MB 录像保护和 180 秒/48MB 录后解码上限。
