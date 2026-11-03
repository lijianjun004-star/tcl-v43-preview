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

