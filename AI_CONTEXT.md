# 练播房：模型通用项目上下文

更新日期：2026-11-04。适用于ChatGPT、Codex、Gemini、Claude及其他能读取Markdown的模型或代理。

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
