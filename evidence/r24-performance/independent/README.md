# 独立边界复核

## 当前修复候选（63519c，2026-11-16）

当前基线已更新为 `d82e0ad` 的线上 smooth-mobile 版本，app SHA-256 `1af535545457ba38a0ecd162020ee47ae43340f1855a6945a27fade10e461e80`。候选为 `63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816`，CSS 为 `35a869c93470924b66ea01ffe65ef7a578b34e8f61ab4bf1b89d98485b8ec5f2`。本复核不修改产品，未发出模型请求。全部记录为人工构造，播放样本是 30 秒静音 WAV，不是真实业务资料或录音。

候选保持每次输入立即排队保存完整 checkpoint，只减少已成功保存且没有变化的逐题 record 写入。首次保存的缓存为空时，先沿用完整写入事务，成功后才生成指纹；失败不会填充缓存。原生 IndexedDB 的 CAS、媒体和 record 原子提交、串行写入链均保留。静态检查确认 records 只有这一处写入路径；reset 用新 Map，使旧异步任务只能更新旧缓存。

### 实测与边界

| 证据目录 | 场景 | 基线 1af | 候选 63519c |
|---|---|---|---|
| `current-heavy-v3` | 200 题、CPU 4x、单次 input 50ms 后刷新；基线/候选交替各 3 次 | 3/3 | 3/3 |
| `current-keyboard-baseline-v3` / `current-keyboard-v3` | 1 题、10 个 trusted 键盘 input，末次 input 内立即刷新 | 1/3 | 1/3 |
| 同上 | 1 题、11 个 trusted 键盘 input，末次输入 50ms 后刷新 | 3/3 | 3/3 |

数字表示实际重载后 IndexedDB 含有完整预期文字的次数。测试前其他代理停止浏览器测量，三个运行顺序执行；均为相同桌面 Linux Chromium 156、相同默认 context 和原生数据库。所有 input 的 `isTrusted` 值与逐样本文字已记录，0 页面异常。没有重跑候选直到通过。重负载对照交替执行，键盘基线为候选出现 0ms 边界后的一次补测。3 次有界样本不能估计可靠性概率。

**结论：这些对照未发现相对当前线上基线的新增保存劣化；不能承诺在异步事务完成前强制刷新仍保住末字。** 两份 0ms 键盘报告保持原始 `FAIL`，不能改为全通过，也不能把 0ms 失败概括为所有刷新失效。关机、强杀浏览器、真手机并未测试。

`current-review-v2/result.json` 在此前 `8dfa75983e44ce04d6e3620a2080fef51354a71a89c56c4ef935f281605dc332` 上通过 21 项：61 题全部分页可达、草稿和音频节点保持、实际音频持续播放、切页暂停、显式保存、切题、清空、结束、提交及新旧场隔离，前后 hash 不变。8dfa 到 63519c 仅移动冷缓存指纹计算时点并删除空白，复盘 DOM 和事件实现没有变化；未把这 21 项说成 63519c 全量重跑。已审阅最终 `evidence/r24-review-stability/final635/record-cache/result.json`：10 项全部通过、同 63519c 前后 hash、0 页面错误；覆盖首次全写、40 输入对应 40 checkpoint、无变 record 不重写、配额中止后别题保存重试、串行队列、恢复、新场及缓存命中时跨标签 CAS。此专项由其他代理运行，不混算为本独立脚本结果。同目录最终恢复 10 项与并发 10 项也已读取核对：全部通过、app 为 63519c、source_unchanged 为 true、0 页面错误。机器可读结论见 `verdict-v3.json`，状态为 `PASS_WITH_EXISTING_0MS_LIMIT`。

### 保留的失败候选

- `current-heavy-v2/result.json`：8dfa 首次指纹计算发生在事务开始之前，200 题/4x/50ms 基线 3/3、候选 2/3；当时存在并发浏览器负载，未据此计算可靠率。该结果促成冷缓存路径修复，原始失败保留。
- 下文记录的 034597 和 60d064 防抖保存候选均被拒绝；不能用它们较好的耗时或少事务数替代当前即时保存结果。
- `review_probe_v2.py` 是无 timer 命名的功能复核；`reload_probe_v2.py` 保留首次当前基线失败方法，`reload_probe_v3.py` 只改变为基线/候选交替顺序。`record_cache_probe.py` 是准备但未运行的备用脚本；已有其他代理 10 项原生数据库专项，因此没有重复计分。

## 历史防抖候选（均未采用）

当前产品源码未由本复核者修改。桌面 Linux Chromium 156，原生 IndexedDB；数据为人工构造的练播记录与知识条目，音频为 30 秒静音 WAV，不代表真实用户录音、ASR 准确率或手机真机验收。

## 版本与结论

- 基线：`3672708`，app SHA-256 `d090543e3bdd010dfa95580c4f6a5dcd7185f116225ff02674120954c10cbecf`。
- 首个性能候选：`034597b149d7150bfd04e184c3f94b97ccbe09ed22d5480d5245a35abb6d87de`。
- 增加 `beforeunload` 提前 flush 的候选：`60d06449fdcff6e9ff8831f27508e17c3837cc37c6c24002a493c34772f3d1f6`。
- CSS 始终锁定 `bab5d63331e487b77636249078a8231db534210ef9cd8773d03c8adb0e0a1263`，本轮没有重复移动布局 68 次采样。

`final/result.json` 在 60d064 上通过 21 项功能检查，运行前后 app hash 相同且无 pageerror：61 题分页全部可达，未保存题内草稿不自动写入 snapshot，其他题状态更新及保存保留编辑框/音频节点与正在播放的音频，切页暂停音频并保留草稿，显式保存落盘；切题、清空、结束、复盘切页、提交均保留最新已输入文字，开始新场前保存旧场，旧 timer 不把内容写入新场。

**重负载立即刷新仍未关闭。** 200 题、CPU 4 倍节流时，60d064 在输入 50ms 后刷新仍 0/3 保住末字，而相同基线为 3/3；不能把普通负载通过概括为所有刷新场景可靠。

## 保存/刷新结果

| 证据目录 | app | 场景 | 0ms | 50ms |
|---|---|---|---|---|
| `reload` | d090 / 034597b | 1 题，单次 input，无内部 hook | 3/3 / 0/3 | 3/3 / 0/3 |
| `reload-beforeunload`（app owner 运行） | 60d064 | 同一窄脚本，1 题 | 3/3 | 3/3 |
| `reload-keyboard` | 60d064 | 1 题，10–11 个 `isTrusted=true` 键盘 input | 3/3 | 3/3 |
| `reload-heavy-baseline` | d090 | 200 题，CPU 4x，单次 input | 0/3 | 3/3 |
| `reload-heavy` | 60d064 | 200 题，CPU 4x，单次 input | 1/3 | 0/3 |
| `reload-keyboard-heavy` | 60d064 | 200 题，CPU 4x，10 个 trusted input | 0/3 | 未测 |

数字表示刷新后原生 IndexedDB 仍包含预期完整文字的次数。重负载 0ms 基线也失败，属于既有极限；50ms 的差异是新增回归证据。3 次样本是有界复现，不是可靠性概率估计。浏览器关闭/系统杀进程并未测。

首轮 `candidate/result.json` 为 034597b 的 14 项通过；扩展 `extended/result.json` 保留第一次发现刷新失败的记录，未覆盖或删除。

## 方法与复现

`review_probe.py` 在 HTTP 返回 app.js 时附加只供测试访问当前 turns、更新某题状态的 accessor；未编辑磁盘产品源码。它使用正常 UI 处理器、原生数据库和实际播放节点。提交验证针对 checkpoint 的整场文字及 submission 的全部题目；既有 submission 数据结构不包含 `postTranscript`，本次没有更改该约定。

```sh
INDEPENDENT_OUT=evidence/r24-performance/independent/new-result python evidence/r24-performance/independent/review_probe.py
```

`reload_probe.py` 使用基线 `git show` 和候选 app 原始字节，不注入内部 accessor。single 模式派发一次 DOM input 后立即或 50ms 后 `location.reload()`；keyboard 模式使用 Playwright 连续键盘输入，额外监听最后一个 input 来触发刷新，并在 sessionStorage 中记录每个事件的 `isTrusted`。监听器不调用 app 内部 flush，也不写 app 的草稿或数据库。

```sh
R24_RELOAD_OUT=evidence/r24-performance/independent/new-reload R24_RELOAD_VERSIONS=candidate R24_RELOAD_TURNS=200 R24_RELOAD_RATE=4 R24_RELOAD_INPUT=keyboard R24_RELOAD_DELAYS=0,50 python evidence/r24-performance/independent/reload_probe.py
```

## 静态复核

实际 `runId` 变更入口（恢复、开始新场）均在赋新值前执行 reset/flush；checkpoint 在第一个 await 前同步复制 snapshot、捕获 owner/cursor；串行写入链和 IndexedDB 内的旧 token 对比保留，submit 仍先确认 checkpoint 成功并携带预期 token。此次没有发现绕过 CAS 的新增路径。跨标签并发完整测试由 app owner 另行执行；本报告不把静态检查代替并发实测。
