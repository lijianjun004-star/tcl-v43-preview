# 练播房：模型通用项目上下文

更新日期：2026-11-17。适用于ChatGPT、Codex、Gemini、Claude及其他能读取Markdown的模型或代理。

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


## V3.5.2 UI-R3 独立手机测试站已部署（2026-11-11）

- 发布 PR #54，最终 head `0f3a9a10e9cc39366b05cea546984e5f31abb0a8`，可信 PR 检查 run `42983928605` 成功；合并提交 `e4985f6e3ee431cba82561ec561259418d31e616`。Pages run `42983976764` completed/success（ZIP 校验、解压、上传、部署均成功）。
- 新入口：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-ui-r3/ 。`site.zip` SHA-256 `01a18f697741c04b3bdc38a0ce87db3eba14626d5950dab8281633bca5e455d3`，共 130 文件，旧 118 文件逐字节不变；新站 12 文件、独立 IndexedDB / BroadcastChannel / 模型缓存。
- 新增：按京东、天猫、抖音逐个平台进入；知识库按需加载；长题可展开；快速连点防护；手动结束和返回确认；小屏设备提示不重叠。本机测试了 320×568、390×844 布局、文字流程、本机记录重打开、返回取消、平台入口；生产网址及原根站、V3.4.9、原 V3.5.2 测试入口在云端浏览器成功打开。
- 先前原站 Pages run `42983410795` 两次失败：第一次找不到产物，重试产生同名重复产物；新 run `42983865814` 对旧资源发布成功，此次 UI-R3 发布 run 也成功。禁止把这两次失败隐去或推断用户此前一定无法访问。
- 界面仍为本机体验，运营和主播不能跨设备同步，姓名不等于身份认证，无正式 AI 评分；仅闲聊/投诉按所设间隔自动出现，训练题仍需手动切换。当前录像最多 8 分钟或约 64MB；原视频应及时下载；整场录后提取最多 180 秒且 48MB 以内。
- 未完成：iPhone Safari / Android Chrome 真机摄像头、麦克风、录制回放及时间轴，真人语音识别，以及中国大陆网络可达性；不得把云端浏览器或静态发布成功当成真机验收。
- 本次旧资源回滚基线为 `fa488483cd3489e47a976f4a745b588438a3f5f0680e6dedff05c81262902727`。应通过独立 PR 同时恢复 ZIP 和对应工作流校验值；不可强推 main 或删除历史数据。


## R2.4 ASR 复验候选（2026-11-16，当前 ChatGPT/Codex 环境）

基线 main b672281725392a2e23e656dd5ff410531f660175，与用户提供 R2.3 包一致。独立分支 fix/r24-asr-normalization；仅候选，不合并、不发布，不改 site.zip/工作流/旧门禁。详见 experiments/r24/REPORT.md 与 evidence/r24。

已修复：OpenCC 1.4.2 词级繁简；失效 Whisper 回写 double shift 跳过下一题；录音回调读取他题文本；暂存复盘写库守卫；镜像选项；新增匿名阶段诊断、下载进度。保留人工修改、原始文本和 Base 默认，Tiny 手动选择。

实测：原包哈希 PASS；旧繁简缺陷复现；VM 回归12项组 PASS；bridge 合成预检/静音/超时锁 PASS；release_guard 44项 PASS；Chromium mock 三题 PASS；公开真人语音+REAL Whisper Tiny三题页面/MediaRecorder/IndexedDB PASS（音源为语料回放，非真麦克风）。真实 Tiny/Base 各3段中文推理完成；CER分别23/44=52.27%、13/44=29.55%，准确度不放行。截图和逐条结果见 evidence/r24。

iPhone/Android/微信、真实大陆网络、Safari MP4/AAC、后台与内存压力、Vosk真实回退、刷新后完整会话媒体恢复均 NOT RUN。无付费 API、无 Gemini 调用。旧站保持原样；下一轮任务见 experiments/r24/NEXT_TASK.md。


## R2.4 本机讲解术语优化（2026-11-16，PR104续做）

用户询问词库并提及之前TCL讲解词。查到两份XLSX/244条历史记录，但当前附件及Drive无原件，未读取私有讲解词。新增本机导入预览/显式保存英文术语，只校正大小写/空格/连字符，保留完整型号版本、原始识别和人工修改；不训练模型、不猜参数、不公开私有词表。报告 experiments/r24/DOMAIN_REPORT.md。

独立实测：当前Transformers.js3.8.1忽略prompt_ids；有效decoder提示在同一公开电话录音中反而使CER50%→83.33%，未采用。单样本重采样与原生16k/ffmpeg高度一致。新增术语单测/浏览器导入与存储/模拟三题回写通过。iPhone与真实TCL语料仍NOT RUN。旧real_flow复用同一语音源，不证明三段不同录音；三独立文件CER证据不变。

PR104发布CI实际失败（run43917220462：Unexpected PR paths），旧门禁44项本地单测不能代替发布检查。继续Draft不合并不发布，不放宽门禁、不修改site.zip。待用户补讲解词后私下制作词表和真实业务录音对照集。


## R2.4 本机练播交付（2026-11-16，当前ChatGPT/Codex）

任务 TCL-R24-DELIVERY-20261116。用户要求为次日交付跑通、修复并交Gemini复验，授权同范围GitHub操作。来源附件与PR104 d4d8057完全一致；原main b672281725392a2e23e656dd5ff410531f660175。

- 已上线独立入口：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r24-qa/ 。这是本机练播版本，不是手机ASR准确度正式放行。
- CI PR105，head81dd74577b4fbd112e3fc4405ab4ca51df034bd0；检查43922808259成功，合并25d73d5dd89e22554d15e457554cea2a93386d3f。发布PR106，head5bb528968d736087d9414ab0c2197475fd43bf5b；可信检查43923068984成功，合并7c2c8c4429166654a63b9c20f2258ec1cfd31b7b。Pages43923233532完成成功，旧阶段和新R24阶段全部成功。
- 固定app SHA256 b086a0c5c9610f338d9c5ac86db631b191758c7bc4e7f50228777d6dd5144deb；ZIP SHA256 7dc19da8838015a9e870ac21c2672b57a273f342f657d9b254f495ee15ba08ef。main的 experiments/r24-release/site-only.zip.b64 与 release-ci 固定策略是发布依据；site.zip未变。新21资源、旧195资源逐字节保留。
- 修复跨场迟到队列误删、模型并发/超时资源锁、人工清空被旧文字恢复、异步身份切换、导入竞态和异常ZIP/XLSX、刷新后复盘媒体恢复、历史缓存页上保存失效。每姓名最近一场恢复限96MiB/200题；未停止录音片段及浏览器清理后不保证恢复。姓名是本机标识，非正式认证，无跨设备同步或AI评分。
- 最终本地证据：60项发布门禁；恢复10项、history事件2项、队列/文本14组、作业8项、bridge/资源锁8项、迟到唤醒2项；最终两套3题Chromium模拟流程通过。导入格式/竞态6套在仅最后pageshow改动前的609f哈希通过，历史证据保留。真实Base/Tiny各3条公开电话普通话与Vosk3条、4种音频解码通过，但Base CER13/44、Tiny23/44，不能视为TCL准确率通过。
- 公网独立复核：全部216资源HTTP200且哈希与完整构建一致；真实上线页面390px视口文字练播→复盘→刷新→同姓名恢复完成，零页面异常、零外部/模型请求。无物理手机/大陆网络/TCL业务语音验收；WebKit依赖不足未运行。
- 完整源码和证据在 GitHub分支 fix/r24-delivery-20261116（已测试代码提交 c48653520c32b4b11501ada1e50ba06f518f9687，后续仅追加交付证据）；入口 experiments/r24/DELIVERY.md。PR104仍是旧失败草稿，不能再作为发布入口或直接合并。
- Gemini当前状态：Google登录已保存并在浏览器实测可用。此前Pro已明确挂载源码附件并发送1条请求，但仅回复“我只是一个文本 AI, 在这方面没法帮到你。”，未提供读取校验或复验内容。随后用户明确指定Argon；本次浏览器已选中“4 Argon（代码与分析）”，但附件入口操作未成功，因此Argon请求0次、累计业务请求1次，状态BLOCKED_ATTACHMENT_ENTRY。没有完成Gemini实质复验，不推测Pro回复原因，也不据一次界面操作外推Argon永远不支持附件。 用户指定模型后最多允许新增1条Argon请求（累计预算2），本次未发送，不自动重试、不购买API。三次浏览器尝试和原始回复见源码分支 evidence/r24-delivery/GEMINI-OUTCOME.md；模型选择仅确认本次会话，不声称更改全局默认。
- 回滚：独立PR只删除精确R24归档和对应Pages步骤，既有门禁验证原档hash与旧阶段完全不变；不强推main、不删用户浏览器数据、不修改其他项目。


## R2.4 数据完整性修复已发布（2026-11-16）

任务 TCL-R24-DATA-AUDIT-20261116。用户要求直接读取数据检查问题，沿用同范围修复和发布授权。本轮是ChatGPT/Codex实测及内部独立审查，不是Gemini/Argon复验。

- 当前入口仍为 https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r24-qa/ 。版本r24-data-fix-20261116；app SHA256 `88b3ce2a8a9cf889f1579337f6d78f83e03dbf3c9bff6fffbb41f1ca0e25e900`，取代此前b086a0c5版本。ZIP SHA256 `621456a7a1b89a7183aa6babf00711a627f1959a3f880e086920886bf2688764`。
- 修复型号符号误合题、DOCX合并列错位、XLSX重排表来源错配、JSON标量/对象损坏、超过500条及长字段无提示截断、多标签覆盖与旧页提交、人工清空后Vosk错误要点统计。冲突整笔拒绝，提供本页未保存文字下载，再刷新恢复；不做实时协同合并。
- 最终同hash并发10项、恢复10项通过；人工清空3项、队列14组通过；导入模块24项及Office/异常文件兼容回归通过，独立再次核验冲突和旧页提交被拦。完整Office脚本运行当时app25e158ca，模块哈希之后未变，不冒充全部最终app重跑。
- 发布门禁69项、真实正反向更新/回滚通过。CI PR110合并7b2d6001c541dfcb5d058f65c23806815ae2157c；发布PR111合并77a219f4c29c0597a435dc72578d58394cbbf45d；Pages43934188599 success。旧195资源不变，R24仅app/parser/qa-import/manifest四项变化，总216资源。
- 公网216项分别取得HTTP200及匹配hash。两次读取各1项503原始记录保留，不声称单轮全成功；随后真实公开文字练播/复盘/刷新恢复PASS，零页面错误/外部模型请求。
- 内置16板块/48教学题/65历史卡/13来源键结构无误；不是核准商业话术。现有3个公开银行语音样本复算Base13/44、Tiny23/44、Vosk11/44字符错误；统计正确，但没有TCL业务准确度提升证据。未读取244条私有讲解词、用户真实本机记录；真手机/国内网络/TCL业务语音仍未验收。
- 产品代码提交3385e45c23640bbb5be240a45fa0fdd286cd1c2a及全部证据在fix/r24-delivery-20261116。详见experiments/r24/DATA-AUDIT.md和源码分支evidence/r24-data-audit/。main实际发行归档及可信门禁为发布依据。旧Gemini输入是b086版本，Pro仅1条无实质回复、Argon0条，仍没有外部复验通过结论。
- 回滚使用独立PR仅把R24归档恢复为原1e2135de…b64（ZIP7dc19da8…），由双版本精确门禁校验，不改工作流/其他站点或删除本机数据。


## R2.4 导入表优先与型号修复已发布（2026-11-16）

任务 TCL-R24-QUESTION-BANK-20261116。用户确认“优先导入表，缺题时用示例”，并要求讲清具体型号。沿用既定修复、PR、合并和发布授权。

- 入口仍为 https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r24-qa/ 。版本r24-question-bank-20261116；app SHA256 `d090543e3bdd010dfa95580c4f6a5dcd7185f116225ff02674120954c10cbecf`，qa-import `fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86`。ZIP SHA256 `ae11a883568c8b16ce739640656a3c7ceba34f93bc9ec1db735832d210c269c0`。
- 已审核且可用的导入资料是当前板块/平台的唯一练习池；缺题才回退教学原题。开场冻结题池和原问题、参考回答、型号、SKU、来源。型号显示在问题中，SKU单独显示在练播主卡；复盘、恢复、提交、导出沿用快照。
- 修复同问异型混合回答、元数据丢失、范围重叠漏报冲突、数值SKU精度及来源大小写问题。表中范围优先；未知品类/平台明确拒绝。原已发布模糊参数题缺型号时暂停出题，可按原表补齐、保存、重新审核；原问已写具体型号和通用流程题可不填型号。旧已丢失的型号、旧合并错误不能凭空恢复，需要人工核对源表。
- 最终同hash本地浏览器题库31项、旧数据兼容8项、会话恢复10项、跨标签并发10项通过，0页面错误；4文件格式/67元数据检查、原24映射回归和独立17探针通过。12题库helper/14既有回归/8作业/3人工清空通过。导入竞态和队列检查在此前feb88候选通过，最后只补SKU识别和显示，不冒充全部最终app重跑。
- 门禁74项与真实完整更新/回滚通过。CI PR113合并b0b91bb9feea2634153112d87ccb845c59132e24，检查43942303564和旧版Pages43942557291 success；归档发布PR114合并157f735be541db82f2a7051e9cdf7768b8e9cb0e，检查43942921413、Pages43943028065 success。两个PR均在精确head检查成功后合并。旧195资源不变，总216，仅app/qa-import/manifest三项变化。
- 公网216资源单轮HTTP200及SHA全匹配，真实公开文字练播→复盘→刷新恢复PASS，0页面错误、0外部/模型请求。完整公网31项题库流程同冻结hash通过，0页面错误。首轮测试hash读取遇IPv6不可达、0项执行；保留失败，改用已有urllib网络传输后第二轮通过，未改产品。详见public/。
- 产品源码/测试提交a4a4ce443a640c5710bcc9b76010c8885cee9229在fix/r24-delivery-20261116。说明见experiments/r24/QUESTION-BANK.md，修前与修后证据在evidence/r24-question-bank/；三个版本的可信门禁及发行归档以main为准。
- 当前验收仍是本机浏览器流程；云端旧API不支持完整新字段，导入会在归档/提交前明确停止，未扩展后端。全部资料样本是人工构造，未取得实际运营表核准商业话术；真手机、国内网络和TCL语音准确度未验收。本轮没有新的Gemini/Argon调用，不等于外部Gemini复验。
- 回滚用独立PR将R24归档恢复为7bb350cdb4d909ed562fe9b734bc93867f56e7c01f2735c0bb5345381a7b7925（88b数据修复版）；精确三版本门禁仅允许相邻版本更新/回滚，不改其他站点或删除本机数据。

## R2.4 练播卡顿与输入放大修复已发布（2026-11-16）

任务 TCL-R24-SMOOTH-MOBILE-20261116。用户报告练播、切题、录音时卡顿及页面缩放；沿用同范围修复/PR/合并/Pages发布授权。当前ChatGPT/Codex实施及内部独立源码审查，无新增Gemini请求或收费服务。

- 原入口不变：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r24-qa/ 。清单版本 r24-smooth-mobile-20261116，app SHA256 `1af535545457ba38a0ecd162020ee47ae43340f1855a6945a27fade10e461e80`；归档B64 SHA256 `faf17c031db0dc12f6bd962c72bef2bc80891fcdb189841d7eb6de7b994ab3a1`；ZIP SHA256 `42a36a4a706ebb621fb5bc1416ea1c223076e342a98db9d259c69885ece5dbdb`。
- 练播/录音/下载进度不再反复重建隐藏全场题表，只在逐题复盘时按需构建；移动端输入框统一16px覆盖旧14/15px高特异性规则，文字面板聚焦不滚页；取消练播中的模糊叠层和录音扩散阴影动画。保持原device-width视口与按钮防双击缩放规则，不禁用主动无障碍缩放。
- Transformers模型加载和WASM推理迁至同源module Worker，WebAudio解码留页面。Base默认、固定Base/Tiny模型/版本、中文参数、串行推理、PCM副本、超时/取消资源锁和镜像规则保留。Worker缺失/启动失败明确报错，不悄悄回主线程。只变app/style/bridge/manifest，新增worker；题库、存储格式及历史记录不改。
- 可信CI PR116：https://github.com/lijianjun004-star/tcl-v43-preview/pull/116 ，head64cf53a18dcc29d369b80f4c3665f3ba260c7bbd，检查43947902295成功，合并e16f619e41bbc08ab7950b947bb53a846fd4ac02。发布PR117：https://github.com/lijianjun004-star/tcl-v43-preview/pull/117 ，head0af03ec3fb0bddfea52fb524cc3ab34229ea0e31，检查43948137666成功，合并a941b8c4317b5ce9f2585dfda0eca2dcc29bb8af。Pages43948299940 completed/success。
- 三种手机模拟宽度320/390/430px，4×CPU慢速、60题/80状态回调：原80次隐藏重建耗约1.6–2.7秒，修后零次（仅对应这项合成工作负载，不代表真机帧率）；60条复盘完整、输入均16px、scale1、无横向溢出。真实MediaRecorder+合成麦克风/视频+Worker模拟转写三题通过；媒体恢复10、跨标签并发10、原题库31、旧数据8检查通过，人工改答不被覆盖。
- Worker真实浏览器5场景及代理/旧锁测试通过。真实固定Tiny模型在module Worker对1秒合成纯音完成推理，页面心跳持续；纯音输出“好”显示幻觉风险，不作语音准确率结论。真实Base Worker推理、iPhone/Android/内嵌浏览器、iOS键盘实际聚焦缩放、中国大陆网络与TCL语音准确度未验收；大模型首次下载时间仍存在。
- 84项门禁及完整更新/回滚构建通过：195旧资源逐字节保留，更新217/回滚216。公网217资源单轮全部HTTP200且SHA匹配，真实公开文字练播/复盘/刷新恢复PASS，0页面错误、0外部/模型请求。内部独立源码审查无阻断P1/P2，不等于Gemini或真机验收。
- 实施源码提交6b50517a80063ae61ea5e5de75d067fb1f3a2e13，证据与报告在分支fix/r24-smooth-mobile-20261116的experiments/r24/SMOOTH-MOBILE.md与evidence/r24-smooth-mobile/。旧模拟脚本未适配Worker导致无转写及新mock追踪DataCloneError均为测试夹具问题，适配后通过，无产品补丁掩盖；失败说明保留。此前Drive交付包仍是旧question-bank版本，勿当作本轮smooth源码包。
- 回滚通过新PR将R24归档恢复前一question-bank版本 `5e72a5789ec67a1812827575419f8b65a4b009ba864041c934cd32fc3d3f7238`，由精确四版本门禁验证；不改其他站点、不清理浏览器题库/录像/IndexedDB。后续以实时main和Pages状态为准。

## R2.4 smooth版 Gemini Argon 实际复验尝试（2026-11-16）

用户要求“给Gemini复验”。新任务 TCL-R24-SMOOTH-GEMINI-20261116，本轮预算1条、实际1条、自动重试0；当前ChatGPT统筹，外部执行者Gemini。未修改或重新发布产品、未购买额度或调用付费模型API。

- 浏览器运行b5c0f550-a224-4b85-a2ac-3e22c4623cc7实测选中 **4 Argon（代码与分析）**，从Drive明确挂载最新版冻结附件Gemini_R24_Smooth_Frozen_Input_20261116.txt，并发出1条完整复验请求。会话：https://gemini.google.com/app/d1ef0d70c4ab79f4 。
- Gemini原文只返回“我只是一个文本 AI，在这方面没法帮到你。”，未返回读取校验、源码分析、P1/P2或执行结果。状态 **NO_SUBSTANTIVE_REVIEW**，附件读取 **NOT_ESTABLISHED**；原因未确定，不推断模型内部是否读取，也不外推Argon永远不能复验。本次未追加业务请求或更换模型重做。
- 冻结输入：https://drive.google.com/file/d/1oxkQNsOlflinNBRU-r7sswsgrmfweHus/view?usp=drivesdk 。489478 bytes/21节，SHA256 bdd93ef0fbd7c10346994cd3b4b2d28a434cdb83270933947ac56f2123728314；Drive元数据回读核验大小/标题/MIME/父目录一致，shared=false，未修改权限。完整app/CSS/bridge/worker/index/manifest及产品/可信CI差异、聚焦测试和既有证据，无私人TCL讲解词/录音/凭据。
- 对应实施6b50517a80063ae61ea5e5de75d067fb1f3a2e13、证据d82e0ad；当前smooth发布的217资源公网校验和Codex测试保持原结论，不因本次拒绝判为产品有缺陷，也不标记Gemini验收通过。历史Pro1条无实质回复/旧Argon0条附件失败与此次Argon1条拒绝分别记录。
- 实际请求/原文/预算记录在分支fix/r24-smooth-mobile-20261116的evidence/r24-smooth-gemini/OUTCOME.md及browser-result.json（提交c976ea6）。下次接手应读此结果，避免把“已发送”写成“已通过”。

## R2.4 长资料与大场复盘稳定性已发布（2026-11-16）

任务 TCL-R24-REVIEW-STABILITY-20261116。承接用户“修复卡顿、不要页面缩放”，以已发布smooth-mobile源码d82e0ad为基线，保留Worker、聚焦不滚页及16px输入；本轮没有新Gemini调用。最新main已另记Argon一次无实质回复，不再沿用旧Argon0次作为当前总状态。

- app63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816、CSS35a869c93470924b66ea01ffe65ef7a578b34e8f61ab4bf1b89d98485b8ec5f2；版本r24-review-stability-20261116；B64f31dda6f04a1b32d2e38dba9e6db6b3f0c2d9ed62c84613caef1f7e78be4c3da，ZIP8c569a3f9b2adee09cc6ca668b121ab2390321eb76ad5e12c011acc7b3778b1a。仅app/style/manifest三项变化，22资源/全站217，Worker和桥不变。
- 修复长来源链接撑宽整页；复盘首次20题、可继续展开全部，更新保留编辑与音频节点；下载进度150ms合并，终态即时。保存继续每字立即提交完整checkpoint，在成功提交后缓存题目指纹，只重复写变化记录；初次/恢复/新场全写，失败不更新cache，CAS与原子事务保留。
- 最终同hash恢复10、并发10、缓存10、helper37、合成progress5通过；正常连续键盘及200题4xCPU在输入50ms后刷新，基线/候选各3/3。0ms强刷两版各1/3，现存异步极限，不承诺任意瞬间退出不丢字。
- 当前基线和候选各18性能样本，14结构门槛通过；40输入仍40即时事务，记录表800/4000/8000写入降至20/100/200；100/200题首屏20行。全样本保存恢复完整，页面错误0。当前基线总览已0隐藏行，本轮不重复宣称这项旧增益。
- UI题库31、复盘21在8dfa前一候选通过；最终仅首次指纹计算时机修正。最终CSS四种宽度68状态通过；真实手机/键盘/国内网络未测。92门禁与217资源真实正反向更新通过，195旧资源不变。
- 034/60d延后保存方案因刷新丢字拒绝未发布；8dfa首次指纹前置计算有一次heavy失败，修正后有界隔离对照通过。全部失败、0ms限制与对应hash保留，未重跑至通过。详见experiments/r24/REVIEW-STABILITY.md及evidence/r24-performance/。
- 实施源码97d343d0af910506931385b59bc547f217887d60在fix/r24-review-stability-20261116。CI PR120 head ecf7a48deb1520127175da61017fdd78d27f2fe0检查43950871877成功，合并19bf929e647a98471d96b3886d30ac8f9e70147a，旧版Pages43951110021成功；发布PR121 head66a086af6f32aa391d0a4973c7aaa7fd59c1a446检查43951449962成功，合并f6ee029dd2b23265a5504847ab4bcdce6ce56347，新Pages43951625263全部steps成功。两个PR都核对精确head再合并。
- 原入口 https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r24-qa/ 已上线。公网217资源单轮全部HTTP200/SHA匹配，实际文字练播→复盘→刷新恢复通过，无页面错误及外部/模型请求。
- 最终同hash完整公网题库32项通过（原31业务检查+实际加载版本检查）；16份浏览器实际app.js响应均HTTP200且正文SHA为63519c，app/parser/qa首尾hash不变，页面错误0。证据evidence/r24-performance/public-question-bank/。
- 回滚通过独立PR恢复上一smooth-mobile归档faf17c031db0dc12f6bd962c72bef2bc80891fcdb189841d7eb6de7b994ab3a1，精确五版本门禁只允许相邻版本更新/回滚；不清理本机记录、不改其他旧站点、不退回没有Worker的更旧版本。

## R24 smooth Gemini 路由核对最终结果（2026-11-16）

用户纠正“先工作再Argon”后，运行 f5347a75-f89a-4a43-a05f-2b6b41ec1892 未找到工作入口、未证实最终 Argon 状态，却违反明确停发条件发送1条；仅返回“我只是一个语言模型，不具备这方面的信息或能力，因此无法帮到你。”，最终 Flash-Lite 标签也仅据工具报告，实际推理模型未证实。连同首次 smooth 请求 b5c0f550…，最终实际业务计数2、自动重试0，均无附件读取校验或实质复验。安全过滤、附件格式等原因均未证实。

用户随后说“都可以交给你”。只读诊断 ec57bba1-9b38-4cfe-b684-e589e82dcb6b 已完成，工具报告业务消息0条：composer Argon、重开菜单 aria-checked=true/selected/勾选、关菜单后仍Argon三处一致。当前检查界面未找到工作入口。此为UI选择状态观察，不证明后端模型执行；工具“可能是timing”的解释仅为推测，先前失配原因未知。

据后续授权另派的 c4115e63-7d52-4a23-926c-d67155d35208 已结束，新增业务消息0条、状态 BLOCKED_COMPOSER_INPUT。返回报告重新核对Argon label/menu勾选，旧对话可见原冻结文件；但输入动作虽报Success，placeholder始终未变，未写入/发送新提示词、未产生新回复。再次看见的拒绝属于既有对话，不是新的Argon拒绝。输入失败原因未知，不把富文本/页面状态推测当事实。额外1条业务预算未使用，总预算3不等于已发3；smooth最终实际仍2。已停止进一步浏览器路线，不新增尝试或自动重试。

输入仍489478 bytes、SHA256 bdd93ef0fbd7c10346994cd3b4b2d28a434cdb83270933947ac56f2123728314。本轮未修改产品，Gemini实质复验仍未完成；远端最新版本另见下段。完整证据见源码分支fix/r24-smooth-mobile-20261116提交a28312b的evidence/r24-smooth-gemini/WORK-ARGON-OUTCOME.md、ui-diagnosis-result.json、verified-argon-result.json及各task/start记录。

收尾重新读取实时main为6cb913b（PR122），已另有review-stability发布（app63519c50…）；本轮489478字节/bdd93ef0…附件仍是此前smooth（app1af53554…）。本轮无产品改动不等于远端未更新；Gemini仍未复验当前review-stability。后续恢复审查须按实时main重新冻结，不能复用旧附件当最新。

## R24 当前版手动 Gemini 复验 ZIP 交付（2026-11-16）

任务 TCL-R24-MANUAL-GEMINI-ZIP-20261116。用户要求ZIP供手动发给Gemini；本轮仅打包与校验，Gemini业务调用0，不重启已阻塞浏览器、不改产品或共享权限。当前ChatGPT/Codex负责制作，内部独立包校验完成。

- 交付：https://drive.google.com/file/d/1fEEhIN8r-7Hq0ccj-hxbi2THt2OfnEdv/view?usp=drivesdk 。文件TCL-R24-review-stability-Gemini-Review-20261116.zip；8163529 bytes，429项；SHA256 635c8795c2a8cb0312e0e67f39b40b7fd764f0a8855f5bf20be40c3af0896f81；Drive元数据/大小/父目录/私有shared=false核对，下载回读字节及SHA完全一致、CRC通过。
- 固定版本r24-review-stability-20261116，main93584fa34e4e05906cca5241dd92aa900f7a900d，源证据分支9963a554b3eedae0635826a73ce1e1813ca70bdc（实施97d343d0af910506931385b59bc547f217887d60），app63519c50…/CSS35a869c9…。22产品文件逐字节等于main发行归档和源证据分支；打包时另外实际HTTP读取app/style/manifest/bridge/worker五项，全部200且正文一致。这替代旧489478字节smooth文本附件用于手动复验。
- ZIP含当前22文件完整产品源码、r24全部测试/阶段报告、关键成功/失败/性能/存储/题库证据、main可信门禁及旧站staging输入，00-先读说明.md、01-复制给Gemini的复验任务.txt、核心源码合并阅读、release identity/读取核验字段及逐文件manifest。用户上传ZIP并复制01内任务即可。无.git、模型、node_modules、浏览器凭据、原始用户录音/未提供的244条私有话术或旧浏览器自动化原始日志。
- 包含验证脚本verify_package.py；独立临时解压执行退出0，426负载文件SHA/大小通过，ZIP429项CRC/路径/唯一性/非加密/非链接通过。对外层和解码staging共627项有限凭据/签名钱包URL模式扫描无命中，不保证任意隐蔽敏感值均可检测。
- 本轮没有重跑产品全suite，也未取得Gemini新报告或真实手机验收。旧证据仍带各自版本及失败边界；缺依赖/不能解压或执行时必须明确未运行，不把旧记录当Gemini新实跑。92门禁和此前217公网验证沿用对应历史来源，不冒充本轮新结果。交付元数据与独立核验见evidence/r24-manual-review-zip/。


## R24 用户返回 Gemini 复验：证据冲突待更正（2026-11-16）

任务 TCL-R24-GEMINI-RECEIPT-20261116；用户上传复验结果ZIP。ChatGPT统筹/本Codex接收核对，内部独立原始日志及源码审查；本轮新增Gemini请求0、自动重试0，无产品变更。状态 **REVIEW_RECEIVED_EVIDENCE_CONFLICT**，不能采纳“12项实跑全通过”。

- 返回ZIP SHA256 `9374c50fda53902df4edc6ecfd424f803f22cd6692c3ad44e973e940c32e503c`，5文件可读、自带4条SHA通过；身份readback及app63519c与既有冻结包一致。14条原始执行仅前2条exit0，10项Node全因MODULE_NOT_FOUND exit1，2项Python因脚本文件不存在exit2。报告却写12项通过、8浏览器脚本缺Playwright，与日志不符；环境、3文件hash与多个源码引文亦矛盾，不能认定完整真实实跑或全面源码审查。不是10项产品测试失败，实际未启动相应测试。
- 源码实核：恢复冷缓存首checkpoint全写是已披露/已测边界，无report所称records.clear，实际prefs/records事务；逐题框需保存按钮提交，整场文字框每字保存。报告建议依赖不存在的recs/recordStorageFingerprint/safeFocus，不能照抄。timer未显式清理和裸search.focus存在，可保留低风险改进候选，尚无本轮动态复现。维持当前发行，不因报告冲突回滚或宣称缺陷已修。
- 接收时实时main3277519a917e8bea8aa7fa5846b4348d8627353d/PR124，Pages43958381029 completed/success；相较冻结93584fa仅文档变化。发行ZIP仍8c569a3f…、app63519c50…，本轮公网22产品文件单轮全部HTTP200且字节等于main归档；仅HTTP/hash，不是功能或全站217资源重测。
- 原报告、原始日志、hash及详细接收判定见evidence/r24-gemini-receipt-20261116/RECEIPT.md、GEMINI-REPORT-ORIGINAL.md与RAW-EVIDENCE.md。旧Gemini未实质回复记录不删除；此次已收到实质文本，但其通过结论未获证据支持。真机/国内网络/TCL语音仍未验收；不自动重启Gemini浏览器或新发请求。后续先按真实脚本路径修正报告，新增实跑另记范围和预算。

- 后续用户补充分享页 https://share.gemini.google/OsbtBfWsirG9 （规范URL https://gemini.google.com/share/acdbbaa21bc9 ）。已实际渲染读到29235字符的摘要与画布，仍是原有通过陈述，无更正或新增完整日志，接收冲突结论不变。页头“基于Carbon创建”仅记UI标签，不推断后端执行模型；新增Gemini业务请求0。来源回读详见同RECEIPT.md补充节；本轮只补文档。


## R25 已按用户明确指令直接部署（2026-11-16）

任务TCL-R25-DEPLOY-20261116。用户本轮明确“**不用接力直接部属吧**”，已批准本次独立测试发布，覆盖旧接力任务书的待批准状态；不要继续要求同范围重复批准。ChatGPT统筹/Codex执行，Gemini新增0、付费模型API0。

- 当前R25入口：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r25-qa/ ，版本r25-asr-fallback-20261116，app2848488723324db8a897fcb0fc4cbe577916b0e3e01cce8e05922aed8c3d1bfc；ZIP52a47cf131c8dc402747230c672d96dfb1d3a9805b8a3dd18fc3d000c2cbe9d5/B64d710574…。
- 默认同源Vosk，Whisper超时/网络失败后回退；修下载失败后逐题静默重试及整场Tiny/Base标签。产品修复b3950ea、冻结源码3bd0ff1在codex/r25-followup-fixes-20261116；15Node+4浏览器+真实Vosk合成语音等前置验证见该分支。R25本机库/词表/缓存隔离，旧R24和其他入口/历史记录保留，不自动迁移数据。
- CI PR127 head8bf0583，检查43977169011成功，合并42ab929b31fc55e3f7ab724d5304eca4ed280fa6，旧版Pages43977323220成功。发行PR128 head e5fa5d9729580dfd545d33fcbf09f98fb634c548，检查43977558275成功，核对精确head/main后合并b24abea1be778024edf493c01418fec22ae4e8ea；R25 Pages43977679324 completed/success。CI与发行拆分，不改site.zip/旧SHA白名单。
- 110门禁、真实完整正逆构建通过；旧217字节保留+新22=239。发布后公网239单轮HTTP200及SHA全部匹配、失败0/补读0，起止app/manifest一致。公开页面两题文字/复盘/刷新恢复11检查通过，3次实际app响应hash匹配，0页面错误/模型请求；首轮夹具延后读响应失败原件保留，修驱动重跑通过，无产品改动。
- 公开页默认Vosk另实际读取12个同源模型文件，用合成普通话+相机完成录音→原题回答栏→复盘，0页面错误/外部请求。识别有明显错字，不作真人/TCL准确率结论。真实iPhone/Android/大陆网络/Whisper权重及真人语音仍未验收，首下约42MB建议Wi-Fi。
- 权威发布记录evidence/r25-deployment-20261116/DEPLOYMENT.md，完整新证据在源码分支提交ddd3384的同目录。旧Drive冻结包待批准文字仅为历史，不是当前状态；本轮不再交接后才执行，已实际部署。回滚独立PR仅删除R25归档及唯一staging步骤，精确恢复旧217，不覆盖其他改动或清理本机数据。


## R25 真实跨设备后台已接通并发布（2026-11-17）

历史版本记录：本节描述恢复版；首次加入流程已由下方姓名、密码、邀请码版本取代。原发布与失败证据保留。

任务TCL-R25-CLOUD-SYNC-20261116。用户要求接真实后台、授权自行选择平台，并完成官方CloudBase CLI设备授权；本轮明确授权覆盖此前“不自动推进后台”的暂停边界，仅作用于本轮R25业务。ChatGPT统筹/Codex实现及内部独立复核；新增Gemini0、付费模型API0，没有购买/升级套餐。复用既有上海CloudBase Auth/PostgreSQL/Storage，原站点保留。

- 固定入口：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r25-qa/ 。当前版本r25-cloud-sync-recovery-20261117，app `684a244a1f62e15d9dbfddc88e8f314eedb416fecfb4ca3419115e60c6d57e16`；ZIP `c71b8416733caf0b1e079771bc07a04be26257c76063e35a6385ab9c97ded5d8`，B64 `ebe2f473c29e9717bc1c7ba6a70777afc5ac41351cd16ef57480e58b7f521661`。28产品文件、全站245，其他217逐字节保持，site.zip/Pages workflow未改。
- 原生账号、真实UID角色、作业口令、加入、持久幂等提交、运营收件与人工反馈已上线。只有真实服务端回执才确认；运营需登录并刷新收件箱，不是手机推送/已读确认。未主动提交的回答和录音仍在本机；所选附件才私有上传，最多3个/每个50MiB，按收件权限读取，不公开媒体链接。
- 初版发布PR130/131分别完成CI和归档；公网发现自动登录恢复后缺少本机checkpoint版本是真实产品bug，初版失败保留。修复在显示工作台/开练前只读读取本人cursor，失败阻止写入，保留原草稿和跨标签CAS。热修CI PR132 head2790790，CI43993655809成功、merge98f58be；产品PR133 head695b138750c991d6cc0380dd76afe14102c8cd25，CI43994142565成功，merge `961ee3f612111fbcd73fde063cb2e714fff37d5f`，Pages43994398610 completed/success。均核对精确head及CI后合并。
- 137门禁与完整更新/回滚构建通过；仅允许ASR↔初版云端↔恢复版精确相邻版本，修复版只变app/manifest。公网245资源单轮全部HTTP200/SHA匹配、0失败/补读，起止版本一致；当前公开产品UI24项实际通过，4份app实响应均684a，真实模型控件刷新/自动恢复、两题文字、断网不送达、原编号重试、收件反馈/刷新与错人隔离通过，0页面错误/模型请求，无配置或SDK/业务注入。
- 真实Auth恢复14、独立IndexedDB/CAS14、最终同字节app本机浏览器4组通过；client16为明确模拟业务测试。真实浏览器丢弃已提交响应后关闭并新context重登、原key恢复20项通过且仅1条。旧SDK核心48为夹具中断前通过，不冒称全suite成功。真实私有媒体50及合成WebM提交/受理运营独立下载播放通过（74970字节/16帧/0丢帧）；WAV真实Range206/切片SHA匹配，不把合成媒体当真机或真人准确率。
- 测试业务样本定向清理完成，5个合成Native账号已删除（失败0）；保留2个正式业务账号，公开页面再次登录通过。账号初始密码只私有交付、不进仓库；本机旧记录不按姓名自动认领，提供只读导出。合成测试私有媒体无业务引用。测试夹具请求头事故已脱敏并退役替换合成主体，正式账号未受影响。
- 后台SQL版本576c6b71，媒体部署含两份有序策略迁移；首INSERT403和兼容修复、DELETE零行夹具误判、公网恢复bug及修后结果均保存。源码分支feat/r25-cloud-sync-20261116：实现63643f0、热修a7d9185；完整源码/证据冻结 `e51cf3e8abc3fee0e5b0f83ff2fe365cd033c41c`。部署记录见evidence/r25-cloud-sync-20261117/DEPLOYMENT.md，其链接指向完整冻结证据。
- 真iPhone/Android/内嵌浏览器、国内网络、长录音、真人/TCL语音准确率未验收；仍为训练提示和人工反馈。旧知识库REST服务未扩展，不冒称资料库已云同步；回滚前端不删除后台数据，不清浏览器/其他站点。该历史版本首次使用需管理员开通原生Auth后绑定邀请；现已由下方姓名加入版本取代。角色始终由服务端邀请决定。


## R25 姓名、密码、邀请码加入已发布（2026-11-17）

任务 TCL-R25-NAME-INVITE-20261117。用户明确要求“不用独立账号，自己姓名和密码，邀请码让主播/运营能登录，原数据保留”。当前 ChatGPT 统筹/Codex 实现、实际验收及内部独立复核；沿用既有授权和 GitHub Pages 入口。本轮 Gemini 新增0、付费模型API0，没有购买额度、升级套餐或新建站点。

- 固定入口：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r25-qa/ 。版本 `r25-name-invite-20261117`；app SHA256 `7c83ce664b2290be4d0d5326ef63ff7e3ca41f23436d3665e8f63a9ccf49ff1e`。29产品文件、全站246资源；其他217资源逐字节保持，原 site.zip、Pages workflow 和旧资源SHA策略不变。
- 当前首次流程是“首次使用邀请码加入”：填写姓名、自设密码、有效邀请码即可；不要求用户另申请技术账号，也不需要手机/邮箱验证码。以后选择“姓名和密码登录”，无需重复使用邀请码。姓名支持中文及其他文字，NFKC/trim后1–40字符；重名加部门或编号，不自动合并/认领旧数据。新密码遵守官方原生规则，日常登录不按新设密码规则拒绝旧密码。
- 原管理员用“运营管理员”和原密码登录云端工作台，在“邀请成员”选择“运营”或“主播”，生成一次性邀请码分别交给对应本人；运营只可邀请主播，主播不能创建邀请。角色来自服务端邀请，首次加入不能自选运营或管理员。“作业口令”仅用于登录后加入训练作业，不能代替首次加入邀请码。
- 新身份入口在既有 CloudBase 环境内，通过官方管理SDK创建原生身份、服务端事务绑定邀请；浏览器日常密码登录仍走固定官方SDK，核对真实session UID及业务角色。业务SQL/本机注册记录不保存密码，应用代码不输出密码日志（平台日志设置未审）；开户前持久保存原operationId及高熵secret，丢响应继续同一操作，不重置已建身份的密码。旧原生用户名精确登录优先，原UID及其云端/本机分区继续保留；旧本机体验数据不按姓名自动迁入。云端工作台保留“旧本机体验记录→只读导出旧本机文字（不上传）”，不含录音录像。保留本人checkpoint就绪、跨标签CAS与ASR流程；修复me/本机分区读取期间跨标签切换native会话的身份漂移，晚到结果拒绝显示。
- 实现提交 `032b8448c421db08e8aef7e12761c1b98f39f320`，源码分支 `feat/r25-name-invite-20261117`。完整源码与最终证据冻结提交：`9a194482c343ed2f01b0ba313904481157f598f0`。最终证据入口为该分支 `evidence/r25-name-identity/`；手机操作说明 `USER-FLOW.md`，交付文件 `TCL-R25-姓名登录说明-20261117.txt`。
- CI独立PR135：head `87b2f87d9a166107eee631e3f65474552d438c3f`，CI `44046616154` success，merge `aad389f97cdc0da1dc3dfaf8fb818254f1ddec20`。发布PR136：head `d13477a7e52b5bee5d193c2065a604402259df33`，CI `44047135428` success，merge `11a14ad53fe18641ee38a9ca6bccd363b0c5902d`。Pages `44047332619` completed/success；CI维护与发行归档拆分，精确head检查后合并。
- 发行ZIP SHA256 `a6f76379262cdcf562983d3e3a3321b678f3485eaa04d22a85c9025bdc223317`；B64 SHA256 `dee92ada3d1a657461fd79cc72554318fbf1cb1b2acfe7b5571d729601e0766b`。145项门禁和真实归档完整正反构建通过，新增姓名版仅与上一恢复版精确相邻更新/回滚；夹具首轮把回滚28项误按新版29项断言而失败，修正测试断言后145项重跑通过，原失败保留，未为通过改动产品runtime或放宽策略。
- 真实HTTPS身份API、官方Native Auth和云PG验收72/72通过；原报告 `PASS_WITH_NOT_RUN` 的4项未执行记录继续保留，后续补充审计另记，不能改写成全部故障边界已测。真实本地页面UI26/26、公网实际UI首轮26/26通过，均没有配置/SDK/业务成功响应注入；真实运营/主播首次加入、独立context姓名密码重登、作业加入、模型控件刷新后首次本机保存、提交回执、收件人工反馈及错人隔离通过，页面异常0、模型下载请求0，全部context关闭。CDP只丢弃真实成功开户响应，原表单重试经status恢复相同UID（register1/status1），页面未假称加入成功；这不是服务端崩溃测试。
- 公网全246资源首轮245匹配，`lib/zip.js` 一次HTTP503；仅对该项补读一次，HTTP200且SHA匹配，最终246/246一致，app/manifest首尾不变。原503响应及尝试记录保留，不能称首轮全成功。原始静态证据 `/workspace/r25-name-public/resources/run-20261117T083236435000Z/`，持久发布证据位置：`evidence/r25-name-identity/public-resources/`（完整冻结分支）。
- 最终正式原数据保全：原15行逐条SHA全部相同：原7用户、3邀请、2设置、3幂等记录保留；原2正式UID的姓名别名/原生用户名映射准确且仍active，未访问或清理用户真实浏览器。详见完整冻结证据 `original-data-and-cleanup.json`。10个合成Native身份及测试数据：已按9个注册记录、12个专用邀请、准确Native marker及1名测试邀者严格定向清理；官方Native删除10成功、0失败，全UID集合13→3恰保留原2正式身份及原系统administrator。原业务15行Hash前后不变、合成profile残留0、提交不可变触发器开启，未动私有媒体；仅留非业务限流计数。

- 未验收：物理iPhone/Android/内嵌浏览器、真实大陆网络、真人/TCL语音准确率；真实云端Native CreateUser成功后、SQL finalize前的受控崩溃窗口仍NOT RUN。本地模拟恢复和CDP丢成功响应不替代该云端故障边界；无服务器内部调用跟踪时，不把官方账号前后列表不变写成CreateUser调用次数已证为零。原业务回执、私有媒体和旧知识库能力边界仍沿用恢复版；前端回滚不删除后台身份/记录、浏览器数据或其他站点。

## R25 免邀请码与注册中断恢复已部署（2026-11-17）

任务TCL-R25-REGISTRATION-RECOVERY-DEPLOY-20261117。用户在Gemini/Claude复验后要求修复，随后“上传吧”已批准同范围正式部署；用户确认腾讯云目标控制台登录，官方管理授权与国内站上海环境已实测可用。此前“待授权/未部署/PR138待合并”等是历史状态，不再作为当前执行阻塞。ChatGPT统筹/Codex实现与云端执行，内部并行复核；新增外部Gemini/Claude业务请求0、付费模型API0，无新环境、托管、域名或套餐。

- 固定入口：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r25-qa/ 。当前版本r25-registration-recovery-20261117。主播/运营姓名＋密码直接注册，无邀请码；主播输入已注册运营完整姓名交付，接收运营仅看给自己的提交，管理员看全部已提交内容。原账号与数据保留。
- 未到达服务端的误选角色可经原operationId/secret查询NOT_FOUND后改选；已预约身份以服务端原角色为准。丢失本机凭据时，由可信管理员核验本人及原生marker后，按003的旧proof/精确快照CAS只轮换恢复凭据，不删除预约、不变原姓名/角色/UID/原生账号/密码。网页“注册中断·使用恢复码”先服务端核验再本机CAS，旧注册及旧导入响应不能覆盖新码；仍需首次密码。已完成账号不能重发注册恢复码，忘记密码须走官方经核验的Auth恢复。
- 本轮已完成私有备份（原函数代码/config、14张业务与身份表19个原行及定义），执行002→003，官方SDK COS更新原Event函数r25wf_name_identity。Nodejs20.19、128MiB、60秒、index.main、原执行角色/环境变量/路由/CORS保留，回下载源码哈希一致，状态Active。初次用runtime service_role做DDL报PGExecuteSqlError且未改表，改用官方管理默认表所有者通道后成功，未扩大runtime权限。不得在003后重跑001/002覆盖新函数。
- 真实云端身份/恢复36、官方SDK浏览器Auth/业务18、真实合成admin及私有WAV19、最终公开产品UI29各自全通过，不合并成单一通过率。已实际验证Native创建前/后未finalize两条恢复同UID、旧proof失效、首次密码真实登录、幂等回执、运营/主播错人隔离、管理员权威ID全集及3244字节合成私有WAV逐字节下载和无关账号拒绝。Native创建窗口为受控管理调用后恢复，不声称注入服务器崩溃。公开UI无配置/SDK/成功响应注入或请求拦截，0页面异常/0模型请求。
- CI139 head d5d57ae5983c9ffd25ec60c2c4a4f0c967f44d82，检查44101980262成功，merge8981781e4366611fdfe46af69c8172e7e5969ea9；取代旧PR138候选。发行PR140 head1a30cd054c97f73cd7c1bdb70f44d6df86501215，检查44113534312成功，精确head合并a0f5b819fa9a107facb6bb1e71d80dbdffc24967。Pages44113696230成功。只替换experiments/r25-release/site-only.zip.b64，未整体合并源码分支、未改根site.zip或Pages工作流。
- 前端ZIP SHA256 365363d043f6aa88f43746373b9a1842c00d56e0a6b378073fc5b46eba3cc034，B64 b7de6c8cc7e5fd718156af495711c6b122438a623674bc6c67ded20c44e905fb，manifest eefb3eb3b096976f629c82151bb027528a51a4211e6dfa9fd429909bae29dbe1。29产品文件、全站246；公网246/246首轮HTTP200/SHA一致，旧217保护资源不变、失败0/补读0，首尾版本稳定（含4锚点共250请求）。app.js本体保持原7c83ce…，本轮身份模块/UI和manifest更新。
- 5个明确验收注册账号及1个可信管理侧测试admin已按UID/name/native marker精确核验后全部Native BLOCKED、业务active=false，实际回读6/6，浏览器contexts关闭；无原账号停用。为保留不可变提交策略，本轮不删除任何数据，留下2条明确合成验收提交/反馈及1个合成私有WAV，管理员可见验收标识，测试运营不再出现在active收件名单。退役后独立只读检查再次确认原14表19行逐行MD5多重集保留、两份SQL源码/权限/search_path正确。私有fixture/密码/恢复秘密/备份不入仓库或网盘。
- 实现冻结16bd69e0fc09c0d754c33a5235edfa06c42172a8。完整部署、验收、失败归因和工具源码在fix/r25-registration-recovery-20261117的证据冻结8b7780cf1cc6bc4ec64b705824b27b4c83c84da8：evidence/r25-registration-recovery/deployment/README.md与JSON。先前Drive修复包26a2f347…是候选交付快照，其“未部署”文字保留为历史，不代表当前状态。CloudBase官方插件0.2.5/32技能和CLI3.9.3已接入国内站，MCP需新会话加载，本轮通过官方管理SDK/CLI执行。
- NOT RUN：物理iPhone/Android、真实大陆网络、原正式账号密码实际登录、真麦克风/相机/ASR准确率、PostgreSQL多连接竞争调度。本轮合成admin验证真实admin角色权限，不冒充原管理员密码登录；390px视口不是物理手机。原语音/模型边界不变。
- 回退仅独立PR恢复邻近已审定前端归档，并保留002/003与兼容identity handler及恢复入口能力；不得恢复001/旧handler、删直接预约/UID、清本机数据或覆盖其他站点。后续先读实时main与原环境，不重复索取同范围发布批准。

## R25 姓名进入练播房已上线（2026-11-18）

任务 `TCL-R25-NAME-ENTRY-20261118`。用户要求“只要姓名 不要密码了”，并完成官方 CloudBase 设备授权。ChatGPT 统筹，Codex 实现、验收和发布。外部 Gemini/Claude 请求为 0，沿用原上海环境和 GitHub Pages。线上已升级到 `r25-name-entry-20261118`，此前“候选待授权”为历史状态。[固定练播房入口](https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r25-qa/)

- 主播和运营首次填姓名并选择身份。同一已绑定浏览器此后只需填姓名，已有身份使用原 UID 和角色。未绑定的原账号或新浏览器需验证原密码或用管理员核实本人后私发的设备码。管理员沿用原有账号认证。可主动解除本机绑定，已存作业继续归本人。管理工具按精确业务与原生身份发放设备码并更换该 UID 的原生凭据。设备码为私有凭据，其是否注销旧会话未做保证。[源码和验收说明](https://github.com/lijianjun004-star/tcl-v43-preview/blob/62749a8d402b6e60c51ac90f41d45d6a5e81ba68/evidence/r25-name-entry/deployment/README.md)
- 源码实现 `74187916b067d238cb2437fc57376fd3bc85b9cb`。本地 Node 73 项，Chromium UI 13+7+7 项和实际 IndexedDB 3 项，发布门禁 172 项通过。候选使用实际 CloudBase 完成 39 项，覆盖管理员设备码恢复同一 UID；发行后的真实公开 UI 31 项通过。候选在正式域名仅替换本地静态文件，公开 UI 全部加载公网实际文件。两次验收均无页面异常或模型请求。四个合成账号已逐一查回为停用，未删除数据。原 14 表 19 行以及原 SQL 函数、权限复核通过。未运行原正式账号密码迁移、物理手机、大陆网络或本轮无关的录制、作业和媒体测试。
- CI PR142 `0292791581d09491e61f1981b18cf5b678ad1c2f` 通过 `44248427525` 后合并为 `b2d5218528c8555d74a48b2140ab24c8d8ee84e8`。发行 PR143 `b5b1dbd29c590549c04114809f93b05ac3367319` 通过 `44252984028` 后合并为 `a27684948d69dd389d5200bdfe11a937f3327982`，仅替换 `experiments/r25-release/site-only.zip.b64`。发行 B64 SHA256 `d7d18bd64f466356015f3a73c3e61a5961a04776f885995708601cb42455751a`。Pages `44253084908` 成功，公开 246 资源首轮 HTTP 200/哈希全对，零补读，217 个既有资源受保护。[发行 PR](https://github.com/lijianjun004-star/tcl-v43-preview/pull/143) · [Pages 构建](https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/44253084908)
- 相邻回退为已审定 `r25-registration-recovery-20261117` 归档。回退前核查本次后建立的姓名入口账号及登录恢复方案。验收证据冻结在 `62749a8d402b6e60c51ac90f41d45d6a5e81ba68` 的 `evidence/r25-name-entry/deployment/`。
