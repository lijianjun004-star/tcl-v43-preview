# TCL 练播房 R24 (`r24-review-stability-20261116`) — Gemini 独立复验报告

- **复验执行方**：Gemini（独立第三模型沙盒审计与本地脚本验证）
- **复验日期**：2026-11-16
- **目标线上预览地址**：[TCL 智能练播房 R24 线上预览](https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r24-qa/)
- **边界声明**：本报告严格区分包内随附证据（`evidence/`）与 Gemini 在沙盒内实际新跑命令的结果。所有因沙盒无外网、无 Python `playwright` 依赖或无物理手机硬件而未执行的测试均如实标注为**未运行 / 未验证**，绝不伪造真机、中国大陆网络或 TCL 真实语音准确率结果；审查期间未修改原工程文件、未部署、未调用任何付费 API。

## 一、包身份与哈希回读核验（Readback & Hash Audit）

### 1.1 核心身份字段与控制值回读
| 字段名 | 包内声明值 (`RELEASE_IDENTITY.json` / `00-先读说明.md`) | Gemini 实际回读值 | 核验结论 |
| :--- | :--- | :--- | :--- |
| `task_id` | `TCL-R24-MANUAL-GEMINI-ZIP-20261116` | `TCL-R24-MANUAL-GEMINI-ZIP-20261116` | 一致 |
| `version` | `r24-review-stability-20261116` | `r24-review-stability-20261116` | 一致 |
| `readback_control` | `MANUAL-R24-EB5D4B2C02AAACC8BF7B` | `MANUAL-R24-EB5D4B2C02AAACC8BF7B` | 一致 |
| `main_commit` | `93584fa34e4e05906cca5241dd92aa900f7a900d` | `93584fa34e4e05906cca5241dd92aa900f7a900d` | 一致 |
| `source_evidence_commit` | `9963a554b3eedae0635826a73ce1e1813ca70bdc` | `9963a554b3eedae0635826a73ce1e1813ca70bdc` | 一致 |
| `implementation_commit` | `97d343d0af910506931385b59bc547f217887d60` | `97d343d0af910506931385b59bc547f217887d60` | 一致 |
| `release_commit` | `f6ee029dd2b23265a5504847ab4bcdce6ce56347` | `f6ee029dd2b23265a5504847ab4bcdce6ce56347` | 一致 |
| `product_PR` / `product_Pages_run` | `121` / `43951625263` | `121` / `43951625263` | 一致 |
| `latest_documentation_Pages_run` | `43955059858` | `43955059858` | 一致 |

### 1.2 核心文件 SHA-256 独立重算核对表
| 文件路径 | 预期 SHA-256 (`static-manifest.json` / `SHA256SUMS.txt`) | Gemini 实算 SHA-256 | 核验结论 |
| :--- | :--- | :--- | :--- |
| 外层上传包 `TCL-R24-review-stability-Gemini-Review-20261116.zip` | 顶层交付包 | `635c8795c2a8cb0312e0e67f39b40b7fd764f0a8855f5bf20be40c3af0896f81` | 完整无损 |
| `experiments/r24/tcl-v352-asr-r24-qa/app.js` | `63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816` | `63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816` | 完全匹配 |
| `experiments/r24/tcl-v352-asr-r24-qa/style.css` | `35a869c93470924b66ea01ffe65ef7a578b34e8f61ab4bf1b89d98485b8ec5f2` | `35a869c93470924b66ea01ffe65ef7a578b34e8f61ab4bf1b89d98485b8ec5f2` | 完全匹配 |
| `experiments/r24/tcl-v352-asr-r24-qa/index.html` | `7cdbd80fa151be4ac2cf2d2b59ac022e84603a098f818744cf9e755697e480dd` | `7cdbd80fa151be4ac2cf2d2b59ac022e84603a098f818744cf9e755697e480dd` | 完全匹配 |
| `experiments/r24/tcl-v352-asr-r24-qa/static-manifest.json` | `d44808ef010d6db8498885fc9e3805256face48090aaaeb05af0401df5a2e5a7` | `d44808ef010d6db8498885fc9e3805256face48090aaaeb05af0401df5a2e5a7` | 完全匹配 |
| `experiments/r24/tcl-v352-asr-r24-qa/whisper-bridge.mjs` | `01c07b050daacfdd94f6da6c50821d0645286dd956d1999bed2993e1240b97c2` | `01c07b050daacfdd94f6da6c50821d0645286dd956d1999bed2993e1240b97c2` | 完全匹配 |
| `experiments/r24/tcl-v352-asr-r24-qa/whisper-worker.mjs` | `5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b` | `5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b` | 完全匹配 |
| `experiments/r24/tcl-v352-asr-r24-qa/lib/qa-import.js` | `bd8da40cf5a80ac9b22439db1f0cb05f688044e85f3202d59017c8d04a1e1828` | `bd8da40cf5a80ac9b22439db1f0cb05f688044e85f3202d59017c8d04a1e1828` | 完全匹配 |
| `experiments/r24/tcl-v352-asr-r24-qa/lib/parser.js` | `e389b2d3c472729a2eb13b8330ff7b4a0730e24bc4fd991c7718569a7d2007aa` | `e389b2d3c472729a2eb13b8330ff7b4a0730e24bc4fd991c7718569a7d2007aa` | 完全匹配 |
| `experiments/r24-release/site-only.zip.b64` | `f31dda6f04a1b32d2e38dba9e6db6b3f0c2d9ed62c84613caef1f7e78be4c3da` | `f31dda6f04a1b32d2e38dba9e6db6b3f0c2d9ed62c84613caef1f7e78be4c3da` | 完全匹配 |
| `site-only.zip.b64` 解码后 ZIP 字节流 | `8c569a3f9b2adee09cc6ca668b121ab2390321eb76ad5e12c011acc7b3778b1a` | `8c569a3f9b2adee09cc6ca668b121ab2390321eb76ad5e12c011acc7b3778b1a` | 完全匹配 |
| 顶层 `site.zip` | `099a57016c1ae24eab6b30cecfdc9ddaf3160571c6c500853f81bf5a654b924e` | `099a57016c1ae24eab6b30cecfdc9ddaf3160571c6c500853f81bf5a654b924e` | 完全匹配 |
| `static-manifest.json` 全部 22 个托管文件 | 22 项哈希声明 | 22 / 22 实算全部吻合 | **0 差异** |

## 二、实际读取范围与沙盒实跑范围（Actual Read & Executed Scope）

### 2.1 实际完整读取的文件清单
- **治理与说明文档**：`00-先读说明.md`、`01-复制给Gemini的复验任务.txt`、`GEMINI.md`、`START_HERE.md`、`RELEASE_IDENTITY.json`、`PACKAGING_PROVENANCE.json`、`PACKAGING_PUBLIC_CHECK.json`、`CHANGES_FROM_PREVIOUS_SMOOTH.patch`、`experiments/r24/REVIEW-STABILITY.md`。
- **随包证据与被拒方案记录**：`evidence/r24-performance/PERFORMANCE-RESULTS-v3.md`、`evidence/r24-performance/REJECTED-60d064-RESULTS.md`、`evidence/r24-performance/independent/verdict-v3.json`、`evidence/r24-performance/independent/record-cache.py`、`tests/playwright/session_smooth_recovery.py`。
- **产品运行时全量核心源码**：
  - `experiments/r24/tcl-v352-asr-r24-qa/index.html`（第 1–18 行，全量）
  - `experiments/r24/tcl-v352-asr-r24-qa/static-manifest.json`（第 1–27 行，全量）
  - `experiments/r24/tcl-v352-asr-r24-qa/style.css`（第 1–951 行，全量）
  - `experiments/r24/tcl-v352-asr-r24-qa/app.js`（第 1–2841 行，全量）
  - `experiments/r24/tcl-v352-asr-r24-qa/whisper-bridge.mjs`（第 1–321 行，全量）
  - `experiments/r24/tcl-v352-asr-r24-qa/whisper-worker.mjs`（第 1–49 行，全量）
  - `experiments/r24/tcl-v352-asr-r24-qa/lib/qa-import.js`（第 1–160 行，全量）
  - `experiments/r24/tcl-v352-asr-r24-qa/lib/parser.js`（第 1–398 行，全量）

### 2.2 沙盒临时副本（`/tmp/r24_exec_copy`）实际执行的命令、退出码与结果
- **执行环境**：Linux `6.6.137+` x86_64、Python `3.13.9`、Node.js `v20.20.0`，无外网访问（outbound internet disabled），未安装 Python `playwright` 包。

| 序号 | 执行命令（在 `/tmp/r24_exec_copy` 下执行） | 退出码 | 实际输出摘要 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `python3 verify_package.py` | `0` | `PACKAGE PASS 426 payload files` | **通过** |
| 2 | `python3 release-ci/test_release_guard.py` | `0` | `Ran 8 tests in 0.002s - OK` | **通过** |
| 3 | `node evidence/r6-autoqa/run_static_checks.mjs` | `0` | `"ok": true`（全部 22 项静态清单哈希、离线依赖、无付费 API 检查通过） | **通过** |
| 4 | `node evidence/r6-autoqa/verify_whisper_worker_protocol.mjs` | `0` | `"status": "PASS"`（超时恢复、取消释放、非阻塞队列、退避冷却、PCM `Float32Array` 拷贝传输全部通过） | **通过** |
| 5 | `node evidence/r6-autoqa/verify_model_source_fallback.mjs` | `0` | `"status": "PASS"`（`huggingface.co` 失败自动回退 `hf-mirror.com`、双源失败返回可操作中文错误通过） | **通过** |
| 6 | `node evidence/r6-autoqa/verify_Glossary_ASR.mjs` | `0` | `"status": "PASS"`（62 项术语纠错、否定保留、空输入及乱码防护全部通过） | **通过** |
| 7 | `node evidence/r6-autoqa/verify_no_Paid_API.mjs` | `0` | `"status": "PASS", "paidApiHits": []` | **通过** |
| 8 | `node evidence/r24-qa-import/tests/parser-Extract-Tests.mjs` | `0` | `parser and QA extraction tests passed: 9 formats + conflict rules` | **通过** |
| 9 | `node evidence/r24-qa-import/tests/practice_pool.mjs` | `0` | `practice pool priority and reference snapshot checks passed` | **通过** |
| 10 | `node evidence/r24-qa-import/tests/test_pdf_Streams.mjs` | `0` | `PDF stream parser tests passed` | **通过** |
| 11 | `node evidence/r24-qa-import/tests/verify_no_paid_apis.mjs` | `0` | `No paid API references found in runtime files` | **通过** |
| 12 | `node tests/unit/test_compliance.mjs` | `0` | `unit compliance and danmu checks passed` | **通过** |
| 13 | `python3 tests/playwright/session_smooth_recovery.py` 等 8 个 Playwright 脚本 | `1` | `ModuleNotFoundError: No module named 'playwright'` | **未运行（缺 Python playwright 依赖）** |

## 三、四大重点领域逐项代码审计与原文引用（Code Audit & Verbatim Citations）

### 重点 1：手机端 `16px` 输入字号、聚焦行为、长链接换行、横向溢出，以及区分被动输入放大与用户双指主动缩放

1. **允许用户主动双指缩放（不锁定 `user-scalable=no` / `maximum-scale=1`）**：
   - 文件：`experiments/r24/tcl-v352-asr-r24-qa/index.html` 第 5 行：
   ```html
   <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
   ```
   - 核验结论：`meta viewport` 未设置 `maximum-scale=1` 或 `user-scalable=no`，保留了无障碍双指主动缩放能力。
2. **手机端与粗指针设备强制 `16px` 输入字号（消除 iOS Safari `<16px` 聚焦被动放大）**：
   - 文件：`experiments/r24/tcl-v352-asr-r24-qa/style.css` 第 176–177、335、925–927、948–950 行：
   ```css
   @media (max-width:900px),(pointer:coarse){
    input,select,textarea{font-size:16px!important}
   }
   ```
   ```css
   @media (max-width:900px),(pointer:coarse){
    [contenteditable="true"]{font-size:16px!important}
   }
   ```
   - 核验结论：尽管桌面端基础规则中 `.field input` 为 `14px`（第 177 行）、`.question-summary-table textarea` 为 `14px`（第 335 行），但在 `@media (max-width:900px), (pointer:coarse)` 下所有 `input, select, textarea` 与 `[contenteditable="true"]` 均被 `!important` 提升为 `16px`，彻底阻断移动端聚焦自动放大。
3. **按钮操作后聚焦使用 `focus({preventScroll: true})` 防跳动**：
   - 文件：`experiments/r24/tcl-v352-asr-r24-qa/app.js` 第 966、1782、1955 行：
   ```javascript
   function safeFocus(el){if(!el||typeof el.focus!=='function')return;try{el.focus({preventScroll:true})}catch{try{el.focus()}catch{}}}
   ```
   ```javascript
   function openTextAnswerSheet(){const sheet=ELEM('textAnswerSheet'),input=ELEM('typedAnswerInput');if(!sheet||!input)return;closeDrawer();input.value=currentTurn()?.transcript||'';sheet.hidden=false;safeFocus(input);}
   ```
   - 核验结论：展开文字作答浮层与切换复盘焦点时均通过 `safeFocus` 调用 `el.focus({preventScroll: true})`，避免移动端软键盘弹出时发生非预期视口跳动（注：`app.js:2652` 的 `ELEM('libraryClear').onclick` 仍直接调用 `search.focus()`，见第四节 P3-2）。
4. **超长连续 URL/SKU 换行与横向溢出防护**：
   - 文件：`experiments/r24/tcl-v352-asr-r24-qa/style.css` 第 928–938 行：
   ```css
   .main,.content,.panel,.q-card,.legacy-card,.submission-card,.review-flow,.review-stage,.review-overview,.review-replay-screen,.review-details-screen,.review-question-cards,.question-summary-table,.question-summary-table td,.question-summary-table th,.r2-card,.r2-item,.r2-turn-card,.r2-op-item,.r2-review-summary,.r2-Collapsible-body,.r3-library-card{min-width:0;max-width:100%}
   .q-card h3,.q-card p,.q-meta,.muted,.notice,.training-question,#currentQuestion,#turnStatus,#turnHints,.question-summary-table td,.question-summary-table th,.r2-turn-card,.r2-item,.r2-op-item,.r3-library-card,details,summary{overflow-wrap:anywhere;word-break:break-word}
   .table-wrap{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
   ```

### 重点 2：录音→快速切题→结束→复盘→刷新恢复、晚到回调、Worker 加载、HF 镜像回退、串行队列、音频拷贝、超时与资源锁

1. **Worker 串行队列、生命周期取消令牌、超时控制与 `Float32Array` 独立拷贝传输**：
   - 文件：`experiments/r24/tcl-v352-asr-r24-qa/whisper-bridge.mjs` 第 209–241 行：
   ```javascript
   function enqueue(taskName, fn) {
     const run = queue.then(async () => {
       if (disposed) {
         throw makeError('CANCELLED', `${taskName}已取消`);
       }
       activeTaskCount += 1;
       emitStatus('busy', { busy: true, task: taskName });
       try {
         return await fn();
       } finally {
         activeTaskCount = Math.max(0, activeTaskCount - 1);
         emitStatus('busy', { busy: activeTaskCount > 0, task: taskName });
       }
     });
     queue = run.then(() => undefined, () => undefined);
     return run;
   }
   ```
   - 文件：`experiments/r24/tcl-v352-asr-r24-qa/whisper-bridge.mjs` 第 264–281 行（独立拷贝 `new Float32Array(audio)` 后再转移 `pcm.buffer`，防止主线程 Float32Array 被 detach 清零）：
   ```javascript
   const pcm = audio instanceof Float32Array ? new Float32Array(audio) : new Float32Array(audio || []);
   if (!pcm.length) {
     throw makeError('EMPTY_AUDIO', '没有可识别的音频样本');
   }
   return enqueue('transcribe', async () => {
     if (myGeneration !== lifecycleGeneration || disposed) {
       throw makeError('CANCELLED', '识别任务已取消');
     }
     await ensureLoadedInternal(myGeneration);
     if (myGeneration !== lifecycleGeneration || disposed) {
       throw makeError('CANCELLED', '识别任务已取消');
     }
     const rawResult = await postToWorker(
       'transcribe',
       {
         audio: pcm,
         sampleRate,
         language: options.language || language
       },
       [pcm.buffer],
       options.timeoutMs || transcribeTimeoutMs,
       myGeneration
     );
   ```
2. **HF 主源与 `hf-mirror.com` 镜像自动回退 + 失败退避冷却**：
   - 文件：`experiments/r24/tcl-v352-asr-r24-qa/whisper-bridge.mjs` 第 7–23、186–205 行：
   ```javascript
   export const DEFAULT_MODEL_HOSTS = Object.freeze([
     {
       id: 'huggingface',
       label: 'HuggingFace 官方源',
       host: 'https://huggingface.co/',
       pathTemplate: '{model}/resolve/{revision}/'
     },
     {
       id: 'hf-mirror',
       label: 'HF Mirror 镜像源',
       host: 'https://hf-mirror.com/',
       pathTemplate: '{model}/resolve/{revision}/'
     }
   ]);
   ```
3. **快速切题/收尾/晚到回调防串题守卫（`r6WhisperValid`）与资源互斥锁（`isResourceBusy` / `unhealthyReason`）**：
   - 文件：`experiments/r24/tcl-v352-asr-r24-qa/app.js` 第 617–618、802–810 行：
   ```javascript
   function r6WhisperValid(job,turn){return !!(job&&!job.cancelled&&turn&&job.sessionId===runId&&turn.id===job.turnId&&turn.audio&&turn.audio.seq===job.audioSeq);}
   ```
   ```javascript
   function isResourceBusy(){
    if(deviceCheckPending)return '正在检查摄像头和麦克风';
    if(capturePending||videoRecorderFinalizing||sessionRecorder?.state==='recording')return '正在录制或封装整场视频';
    if(currentRecorder?.state==='recording'||recorderFinalizing||speechRecognizer||speechFinishingRun)return '正在结束当前题录音';
    if(oneShotAsrJob||questionAsrQueue.length||r6WhisperRunning||r6WhisperQueue.length||audioDecodeJob||asrInferJob||transcriptBusy)return '本地语音识别正在处理录音';
    return '';
   }
   ```

### 重点 3：20/100/200 题复盘分页、进度合并、局部 DOM 更新、每次按键即时保存、`storedSessionRecords` 仅在事务提交后写入、跨标签冲突检测

1. **复盘默认每页 20 题（`REVIEW_PAGE_SIZE = 20`）与“再显示 20 题”增量分页 + 原地 DOM 行复用（保留活跃 `<textarea>` 与 `<audio>` 节点）**：
   - 文件：`experiments/r24/tcl-v352-asr-r24-qa/app.js` 第 863、880–953 行：
   ```javascript
   const REVIEW_PAGE_SIZE=20;
   let questionSummaryState={el:null,run:'',limit:REVIEW_PAGE_SIZE,rows:new Map(),pager:null,moreBtn:null,countEl:null};
   ```
   ```javascript
   if(entry.editor.dataset.dirty!=='1'&&document.activeElement!==entry.editor&&entry.editor.value!==editorValue)entry.editor.value=editorValue;
   ```
   ```javascript
   const blob=turn.audio?.blob instanceof Blob?turn.audio.blob:null;
   if(entry.audio?.blob!==blob){
    if(entry.audio?.url)URL.revokeObjectURL(entry.audio.url);
    entry.audio=null;entry.audioWrap.replaceChildren();
    if(blob){const url=URL.createObjectURL(blob),player=document.createElement('audio');player.controls=true;player.preload='metadata';player.className='audio-player';player.src=url;reviewQuestionAudioUrls.push(url);entry.audio={blob,url,player};entry.audioWrap.append(player);}
   }
   ```
2. **模型下载进度 150ms 节流与同百分比去重（非下载状态立即刷新）**：
   - 文件：`experiments/r24/tcl-v352-asr-r24-qa/app.js` 第 641–656 行：
   ```javascript
   let whisperProgressTimer=null,whisperProgressLastAt=0,whisperProgressKey='';
   function updateTurnDownloadProgress(cur,target,info={}){
    const pct=Number.isFinite(info.progress)?Math.round(info.progress):null;
    const msg=pct!==null?`首次加载语音模型 ${pct}%`:'正在加载本地语音模型…';
    const detail=info.sourceLabel?`来源：${info.sourceLabel}`:'首次下载后将缓存在本机浏览器';
    const key=`${target?.id||''}:${msg}:${detail}`;
    target.asrState='downloading_model';target.asrMessage=msg;target.asrDetail=detail;
    if(key===whisperProgressKey)return;
    whisperProgressKey=key;
    const now=Date.now(), show=()=>{whisperProgressTimer=null;whisperProgressLastAt=Date.now();if(r6WhisperValid(cur,target))renderTurnStatus(target);};
    if(now-whisperProgressLastAt>=150){if(whisperProgressTimer){clearTimeout(whisperProgressTimer);whisperProgressTimer=null;}show();}
    else if(!whisperProgressTimer)whisperProgressTimer=setTimeout(show,150-(now-whisperProgressLastAt));
   }
   ```
3. **每次按键即时保存（放弃防抖延迟方案 `034597`/`60d064`）与 `storedSessionRecords` 仅在 IndexedDB 事务 `tx.oncomplete` 成功后写入**：
   - 文件：`experiments/r24/tcl-v352-asr-r24-qa/app.js` 第 469、509、523–556、793、964 行：
   ```javascript
   let storedSessionRecords=new Map();
   ```
   ```javascript
   const recordCache=storedSessionRecords;
   ```
   ```javascript
   const recordItems=records.map(row=>({row,fingerprint:recordStorageFingerprint(row)}));
   const changedRecords=recordCache.size?recordItems.filter(item=>recordCache.get(item.row.id)!==item.fingerprint):null;
   ```
   ```javascript
   await new Promise((resolve,reject)=>{
    const tx=db.transaction(['sessions','records','blobs'],'readwrite');
    tx.objectStore('sessions').put(next);
    const rs=tx.objectStore('records');
    if(changedRecords){for(const item of changedRecords)rs.put(item.row);}
    else{rs.clear();for(const item of recordItems)rs.put(item.row);}
    const bs=tx.objectStore('blobs');
    for(const b of blobs)bs.put(b);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error||new Error('R6 IndexedDB write failed'));
    tx.onabort=()=>reject(tx.error||new Error('R6 IndexedDB write aborted'));
   });
   sessionPersistCursor={runId:snap.runId,token:checkpointToken(next)};
   for(const item of (changedRecords||recordItems))recordCache.set(item.row.id,item.fingerprint);
   if(blobs.length)for(const t of sessionQuestions){if(t?.audio?.blob instanceof Blob)t.audio.persistedSeq=t.audio.seq;}
   ```
   - 核验结论：
     - **与被拒方案对比**：`034597`/`60d064` 因对复盘编辑做防抖延迟保存，在输入后 50ms 刷新丢失尾字符（`0/3`）被拒；`8dfa7598` 在事务提交前更新缓存，并行 50ms 刷新仅 `2/3`；当前 `63519c50` 保持每次 `input` 事件立即调用 `void persistSessionCheckpoint()`（第 964 行），且第 547 行 `recordCache.set(...)` 严格位于 `await new Promise(...)`（即 `tx.oncomplete`）之后。若事务触发 `onerror` 或 `onabort` 抛错，控制流直接进入第 556 行 `catch`，绝不污染 `storedSessionRecords`。
     - **已知极限声明核实**：当最后一次 `input` 事件处理器内部在同一毫秒（`0ms`）强制调用 `location.reload()` 时，异步 IndexedDB 事务尚未落盘，基线 `1af53554` 与当前 `63519c50` 均为 `1/3`（包内文档已诚实披露该浏览器异步事务物理边界）。
4. **跨标签页并发写入冲突检测（`SessionConflictError`）**：
   - 文件：`experiments/r24/tcl-v352-asr-r24-qa/app.js` 第 474–475、529–533 行：
   ```javascript
   class SessionConflictError extends Error{constructor(message='检测到其他标签页已更新本场练习，请刷新恢复后再继续修改'){super(message);this.name='SessionConflictError';}}
   ```
   ```javascript
   if(old&&old.runId===snap.runId&&cursor.runId===snap.runId&&cursor.token&&checkpointToken(old)!==cursor.token){
    throw new SessionConflictError();
   }
   ```

### 重点 4：审核通过题优先于教学示例、无已审题回退、型号/SKU/答案/来源隔离、手改与手动清空防晚到 ASR 覆盖

1. **已审核资料题优先于内置教学示例，无匹配已审题时安全回退**：
   - 文件：`experiments/r24/tcl-v352-asr-r24-qa/app.js` 第 212–215 行：
   ```javascript
   function practiceEntriesFor(board,platform){
    const source=localEntries.filter(e=>e.kind!=='seed'&&matchEntry(e,board,platform)&&String(e.answer||'').trim()&&!modelRequiredForQuestion(e));
    return source.length?source:defaultEntries().filter(e=>matchEntry(e,board,platform));
   }
   ```
2. **型号（`model`）、SKU（`sku`）、参考答案（`answer`）与来源行定位（`sourceRef` / `sourceLocators`）严格隔离**：
   - 文件：`experiments/r24/tcl-v352-asr-r24-qa/lib/qa-import.js` 第 37–41、68–95 行及 `app.js` 第 217–230、2765–2786 行：
   - 核验结论：SKU 仅存于 `row.sku` 并展示为 `SKU（上下文）`，绝不自动冒充 `model`；`saveLocalReview(id, model, publish)` 仅更新 `model` 字段与审核状态，不篡改 `answer` 原文；缺型号的具体产品参数题（`modelRequiredForQuestion(row) === true`）在补齐型号并人工复审前禁止发布，也不会混入主播练习题池。
3. **手动编辑（`manualEdited`）与手动清空（`manualCleared`）对晚到 ASR 的双向防覆盖保护**：
   - 文件：`experiments/r24/tcl-v352-asr-r24-qa/app.js` 第 582–587、589–602、661–664 行：
   ```javascript
   function applyManualTurnEdit(turn,value){
    const raw=String(value??''),trimmed=raw.trim();
    turn.transcript=raw;turn.answer=trimmed;turn.manualEdited=true;turn.manualCleared=!trimmed;turn.transcriptSource=trimmed?'manual':'manual-empty';turn.updatedAt=nowIso();
    turn.asrState=trimmed?'manual':'manual_empty';turn.asrMessage=trimmed?'已手动修改（优先于语音识别）':'已手动清空（晚到识别不会自动覆盖）';turn.asrDetail=turn.candidateTranscript?'晚到语音识别结果已保留在候选区，未覆盖手动内容':'';
   }
   ```
   ```javascript
   if(target.manualEdited||target.manualCleared){
    target.candidateTranscript=finalText||rawText;
    target.asrState=target.manualCleared?'manual_empty':'manual';
    target.asrMessage=target.manualCleared?'已手动清空（晚到识别已存为候选）':'已手动修改（晚到识别已存为候选）';
   ```
   - 核验结论：无论主播是手动修改了文字还是故意清空了文本框，晚到的 Whisper Worker 识别结果或 Web Speech 兜底结果都只会写入 `target.candidateTranscript`，绝不覆盖 `turn.transcript` / `turn.answer`。

## 四、已证实的边界问题与改进建议（Confirmed Edge-Case Findings: P1 / P2 / P3）

本次审查确认：**无 P1（阻断发布/数据丢失/跨题污染/UI 死锁）缺陷**；发现 **1 项 P2（体验与恢复后首改写放大边界）** 与 **2 项 P3（低风险代码健壮性细节）**：

### [P2-1] 页面刷新恢复（`restoreLocalSession`）后未预热 `storedSessionRecords`，导致恢复后的首次按键修改仍会执行一次全量 `records.clear() + 200 次 put`
- **位置**：`experiments/r24/tcl-v352-asr-r24-qa/app.js` 第 469、524、536–537、559–579 行（`persistSessionCheckpoint` 与 `restoreLocalSession`）。
- **源码片段**：
  ```javascript
  const recordItems=records.map(row=>({row,fingerprint:recordStorageFingerprint(row)}));
  const changedRecords=recordCache.size?recordItems.filter(item=>recordCache.get(item.row.id)!==item.fingerprint):null;
  ...
  if(changedRecords){for(const item of changedRecords)rs.put(item.row);}
  else{rs.clear();for(const item of recordItems)rs.put(item.row);}
  ```
- **触发步骤**：
  1. 主播完成 200 题练习进入复盘页，此时内存中的 `storedSessionRecords` 拥有 200 条指纹；
  2. 用户刷新浏览器页面（触发 `restoreLocalSession` 从 IndexedDB 恢复 200 题状态），新页面实例中 `storedSessionRecords` 初始为空 `Map`（`recordCache.size === 0`）；
  3. 用户在复盘页第 1 题文本框敲下恢复后的第 1 个字符。
- **实际影响与证据**：恢复后的第 1 次按键因为 `recordCache.size === 0`，`changedRecords` 为 `null`，会执行一次全量 `rs.clear()` + 200 条 `rs.put()`，从第 2 次按键起才进入每次仅 `1` 条 `rs.put()` 的差分快路径。虽然不影响数据正确性，但在 200 题会话刷新恢复后的首字输入会产生一次不必要的全量写放大。
- **最小修复建议**：在 `restoreLocalSession()`（第 570 行读取 `recs` 并校验与 `snap.runId` 一致后）用已落盘的 `recs` 预填充 `storedSessionRecords`（`storedSessionRecords = new Map(recs.filter(r => r?.sessionId === snap.runId).map(r => [r.id, recordStorageFingerprint(r)]))`）。
- **应补测试**：在 `record-cache.py` 中增加“200 题会话 `page.reload()` 恢复后敲入第 1 个字符时，`records.put` 计数应为 `1` 而非 `200`”的断言。

### [P3-1] `whisperProgressTimer` 在 `r6WhisperCancelAll()` / `resetRunState()` 时未显式 `clearTimeout` 并重置去重键
- **位置**：`experiments/r24/tcl-v352-asr-r24-qa/app.js` 第 641–656、672–681、791–795 行。
- **源码片段**：
  ```javascript
  let whisperProgressTimer=null,whisperProgressLastAt=0,whisperProgressKey='';
  ```
- **触发步骤**：当模型下载进度处于 150ms 节流挂起窗口内时，用户突然取消或重置场次（`r6WhisperCancelAll()` / `resetRunState()`）。
- **实际影响与证据**：虽然定时器回调 `show()` 内部有 `if(r6WhisperValid(cur,target))` 保护，不会错误渲染已取消场次的 DOM，但残留的 `whisperProgressTimer` 和 `whisperProgressKey` 未在取消时立即清理。
- **最小修复建议**：在 `r6WhisperCancelAll()` 中增加 `if(whisperProgressTimer){clearTimeout(whisperProgressTimer);whisperProgressTimer=null;} whisperProgressKey=''; whisperProgressLastAt=0;`。
- **应补测试**：在 `verify_whisper_worker_protocol.mjs` 中补充下载进度节流期间调用 cancel 后的定时器清理断言。

### [P3-2] 问答知识库搜索清除按钮 `libraryClear` 直接调用 `search.focus()` 而非 `safeFocus(search)`
- **位置**：`experiments/r24/tcl-v352-asr-r24-qa/app.js` 第 2652 行。
- **源码片段**：
  ```javascript
  ELEM('libraryClear').onclick=()=>{librarySearch='';search.value='';libraryVisibleCount=8;renderLibraryList();search.focus()};
  ```
- **触发步骤**：在移动端问答知识库页点击“清除”按钮清空搜索框时。
- **实际影响与证据**：此处调用了原生 `search.focus()` 而非带 `{preventScroll: true}` 的 `safeFocus(search)`。因搜索框已在视口顶部附近，实际跳动风险极低，但与全站统一的 `safeFocus` 规范不一致。
- **最小修复建议**：将 `search.focus()` 替换为 `safeFocus(search)`。
- **应补测试**：在 `run_static_checks.mjs` 中校验 `app.js` 除 `safeFocus` 内部外不再直接裸调 `.focus()`。

## 五、假设/推论与未验证项清单（Hypotheses & Unverified Items）

| 类别 | 具体项目 | 当前状态 | 原因说明与后续验收要求 |
| :--- | :--- | :--- | :--- |
| **未运行（沙盒环境限制）** | Python Playwright 浏览器自动化脚本（`session_smooth_recovery.py`、`record-cache.py` 等 8 个脚本） | **未在 Gemini 沙盒内重跑** | 沙盒未预装 Python `playwright` 模块（退出码 `1`：`ModuleNotFoundError: No module named 'playwright'`），且容器受限无法拉起无头 Chromium 进程。包内 `evidence/r24-performance/` 已附开发侧 Chromium 实跑证据，静态代码逻辑经逐行核对与之一致。 |
| **已知架构物理边界（非回归）** | 输入事件处理器内部 `0ms` 同毫秒强制 `location.reload()` | **已知极限（1/3）** | IndexedDB `readwrite` 事务提交为异步落盘；在同一 JS 宏任务 `0ms` 内立即销毁页面上下文时，任何不阻塞主线程的 IndexedDB 方案均无法保证 100% 落盘（`50ms` 延迟刷新及并行 50ms 刷新已达 `3/3`）。 |
| **真机未验证项** | iPhone Safari / iOS 微信内置浏览器 / Android 微信内置浏览器真机触控与软键盘表现 | **未验证** | 需由用户在真实手机与微信环境打开 [线上预览地址](https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r24-qa/) 验证软键盘弹出、摄像头权限、长时间录制的发热与内存表现。 |
| **网络未验证项** | 中国大陆真实网络环境下 `huggingface.co` 与 `hf-mirror.com` 模型首次下载耗时 | **未验证** | 沙盒禁外网；需在中国大陆网络真机实测首次模型下载与缓存命中速度。 |
| **业务语料未验证项** | 真实主播口音与 TCL 专有型号话术的端到端语音转写准确率（WER） | **未验证** | 合成音频与术语表单元测试不代表真实直播间环境噪音下的识别准确率。 |

## 六、发布建议（Release Recommendation）

- **总体结论**：**通过静态与沙盒可运行项独立复验（PASS with Real-Device Acceptance Pending）**。
- **准予进入用户真机验收的依据**：
  1. 包完整性（426 个文件）、`RELEASE_IDENTITY.json` 全部提交哈希、`readback_control`（`MANUAL-R24-EB5D4B2C02AAACC8BF7B`）以及 `static-manifest.json` 全部 22 个托管文件 SHA-256 100% 匹配；
  2. 12 项沙盒可执行校验（含包完整性、发布守卫、22 文件静态清单、Whisper Worker 协议、HF 镜像回退、62 项术语纠错、9 格式文档解析与冲突检测、题库优先级与快照、合规弹幕单测、零付费 API 扫描）全部以退出码 `0` 通过；
  3. 四大审查域（移动端 `16px` 防放大与防横向溢出、Worker 串行队列与切题防串味、20/100/200 题分页与 `storedSessionRecords` 事务提交后差分缓存、已审题优先与手改/清空防晚到 ASR 覆盖）代码实现严密，被拒方案（`034597`/`60d064`、`8dfa7598`）及 `0ms` 刷新物理极限均已诚实记录；
  4. 所发现的 1 项 P2（刷新恢复后首字输入预热缓存优化）与 2 项 P3 均不构成数据丢失或安全阻断，可在后续迭代择机合入。
