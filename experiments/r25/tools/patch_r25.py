#!/usr/bin/env python3
"""R2.5 patch: build tcl-v352-asr-r25-qa from the R24 (app 63519c50) source.

Usage: python3 -I patch_r25.py <r24-source-dir> <out-dir>
Every replacement asserts its anchor occurs exactly the expected number of times,
so a changed baseline fails loudly instead of being patched silently.
"""
import hashlib, json, pathlib, shutil, sys

SRC, OUT = map(pathlib.Path, sys.argv[1:3])
if OUT.exists():
    shutil.rmtree(OUT)
shutil.copytree(SRC, OUT)
APP_SHA_R24 = '63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816'
assert hashlib.sha256((SRC / 'app.js').read_bytes()).hexdigest() == APP_SHA_R24, 'unexpected R24 app.js baseline'


def sub(name, old, new, count=1):
    p = OUT / name
    s = p.read_text(encoding='utf-8')
    n = s.count(old)
    assert n == count, f'{name}: expected {count} x {old[:70]!r}, found {n}'
    p.write_text(s.replace(old, new), encoding='utf-8')


# ---------------------------------------------------------------- namespaces
sub('app.js', "tcl-specialty-v352-asr-r24-qa", "tcl-specialty-v352-asr-r25-qa", 3)  # IDB store, BroadcastChannel, Vosk cache
sub('app.js', "tcl-r24-asr-diagnostics", "tcl-r25-asr-diagnostics")
sub('app.js', "localStorage.getItem('tcl-r24-asr-model')", "localStorage.getItem('tcl-r25-asr-engine')")
sub('glossary-ui.mjs', "tcl-r24-private-asr-terms-v1", "tcl-r25-private-asr-terms-v1")
sub('index.html', "<title>TCL 智能练播房｜R2.4 本机练播版</title>", "<title>TCL 智能练播房｜R2.5 中文转写回退修复版</title>")

# ---------------------------------------------------------------- engine choice: Vosk default
sub('app.js',
    "  try { return localStorage.getItem('tcl-r25-asr-engine') === 'tiny' ? 'tiny' : 'base'; }\n  catch { return 'base'; }",
    "  // R2.5: default is same-origin Vosk (42 MiB, SHA-verified, Simplified output).\n"
    "  // Whisper Tiny/Base stay available as an opt-in enhancement.\n"
    "  try { const v = localStorage.getItem('tcl-r25-asr-engine'); return v === 'tiny' || v === 'base' ? v : 'vosk'; }\n"
    "  catch { return 'vosk'; }")
sub('app.js', "modelPreset: readR23ModelPreference(),", "modelPreset: readR23ModelPreference()==='base'?'base':'tiny',")

sub('r23-model-choice.js', "const key='tcl-r24-asr-model';", "const key='tcl-r25-asr-engine';")
sub('r23-model-choice.js',
    "const get=()=>{try{return localStorage.getItem(key)==='tiny'?'tiny':'base';}catch{return 'base';}};",
    "const get=()=>{try{const v=localStorage.getItem(key);return v==='tiny'||v==='base'?v:'vosk';}catch{return 'vosk';}};")
sub('r23-model-choice.js',
    "const value=selector.value==='base'?'base':'tiny';",
    "const value=selector.value==='base'||selector.value==='tiny'?selector.value:'vosk';")
sub('r23-model-choice.js',
    "const note=value==='base'?'启用 Whisper Base 增强识别，下载与内存占用会增加。':'切回 Whisper Tiny 轻量识别。';",
    "const note=value==='vosk'?'改用本机中文识别（Vosk，约42MB，输出简体，推荐手机使用）。':value==='base'?'启用 Whisper Base 增强识别（约77MB，需能访问模型站点，下载失败会自动改用本机中文识别）。':'启用 Whisper Tiny 轻量识别（需能访问模型站点，下载失败会自动改用本机中文识别）。';")
sub('index.html',
    '<select id="r23ModelChoice" aria-label="选择免费转写模型"><option value="tiny">轻量 Tiny · 低内存</option><option value="base">增强 Base · 更大模型</option></select><small>默认 Base；低内存设备可手动选 Tiny，可能降低准确度。切换会刷新当前页面。识别准确率尚未通过手机验收。</small>',
    '<select id="r23ModelChoice" aria-label="选择免费转写模型"><option value="vosk">本机中文识别 Vosk · 推荐手机</option><option value="tiny">Whisper Tiny · 实验</option><option value="base">Whisper Base · 实验</option></select><small>默认本机中文识别（约42MB，输出简体）。Whisper 需能访问模型站点，失败时自动改用本机识别。切换会刷新当前页面。识别准确率尚未通过手机验收。</small>')

# ---------------------------------------------------------------- simplified output: Taiwan phrases too
sub('asr-normalize.mjs', "Converter({ from: 'tw', to: 'cn' })", "Converter({ from: 'twp', to: 'cn' })")

# ---------------------------------------------------------------- routing after each question's recording
sub('app.js', "if(turnAtStart)r6WhisperSubmit(turnAtStart.id,blob);", "if(turnAtStart)r25RouteAsr(turnAtStart,blob);")
sub('app.js', "function r6WhisperCancelAll(",
    "// ---------- R2.5 routing: Vosk by default, automatic Vosk after any Whisper failure ----------\n"
    "// Kept inside the queue block so Node VM harnesses that slice it see the state too.\n"
    "let r25WhisperDisabled=false,r25VoskWanted=false;\n"
    "function r25EnsureVosk(){\n"
    " if(typeof voskModel==='undefined'||typeof preloadVoskModel!=='function')return; // same defensive style as the R24 fallback branch\n"
    " if(voskModel||voskLoadJob||voskUi.state==='loading'||voskUi.state==='init')return;\n"
    " if(r6WhisperRunning||r6WhisperQueue.length||transcriptBusy||oneShotAsrJob){r25VoskWanted=true;return;}\n"
    " r25VoskWanted=false;void preloadVoskModel({silent:true});\n"
    "}\n"
    "function r25RouteAsr(turn,blob){\n"
    " if(!turn||turn.runId!==runId)return;\n"
    " if(readR23ModelPreference()!=='vosk'&&!r25WhisperDisabled){r6WhisperSubmit(turn.id,blob);return;}\n"
    " if(voskModel){enqueueQuestionAsr(turn.id);return;}\n"
    " turn.asrStatus='原始录音已保存；正在准备本机中文识别模型（约42MB，首次需下载），就绪后自动写入本题回答'+(turn.captureLimitReached?'（仅录入前120秒，后续未录音）':'');\n"
    " renderTurnStatus(turn);r25EnsureVosk();\n"
    "}\n"
    "function r25AutoVosk(){if(readR23ModelPreference()==='vosk'&&voskUi.state!=='error')r25EnsureVosk();}\n"
    "globalThis.r25RouteAsr=r25RouteAsr;\n"
    "function r6WhisperCancelAll(")

# R2.5 state lives inside the queue block so Node VM harnesses that slice it see it too.

# Whisper failure with Vosk not ready: queue an automatic Vosk download instead of stopping at "手动填写".
sub('app.js',
    "      if(r6WhisperValid(task,turn)){\n          const errMsg=String(err?.message||err||'未知错误').slice(0,100);",
    "      if(r6WhisperValid(task,turn)){\n          const errMsg=String(err?.message||err||'未知错误').slice(0,100);\n"
    "          // R2.5: engine-level failures (runtime/model load, network, timeout, Worker) switch the rest of this page to Vosk.\n"
    "          // Per-recording problems (decode, overlong audio) only send this question to Vosk.\n"
    "          if(/超时|Worker|fetch|import|加载|下载|网络|network|停用本页|禁止/i.test(errMsg))r25WhisperDisabled=true;")
sub('app.js',
    "            turn.asrStatus='Whisper 识别未完成：'+errMsg+(r6WhisperEngine.isResourceBusy?.()?'；底层资源仍被锁定，请保存备份后重新打开页面；当前可手动填写':'；原录音仍可回听，可手动填写或准备备用 Vosk');\n            renderTurnStatus(turn);",
    "            if(r6WhisperEngine.isResourceBusy?.()){\n"
    "              turn.asrStatus='Whisper 识别未完成：'+errMsg+'；底层资源仍被锁定，请保存备份后重新打开页面；当前可手动填写';\n"
    "            }else{\n"
    "              turn.asrStatus='Whisper 不可用（'+errMsg+'），已自动改用本机中文识别：正在准备模型（约42MB），就绪后自动写入本题回答';\n"
    "              r25VoskWanted=true;\n"
    "            }\n"
    "            renderTurnStatus(turn);")
sub('app.js',
    "  }finally{r6WhisperRunning=false;void drainQuestionAsrQueue();}",
    "  }finally{r6WhisperRunning=false;if(r25VoskWanted&&!r6WhisperQueue.length)r25EnsureVosk();void drainQuestionAsrQueue();}")

# Pre-live: start the default Vosk download (or cache load) as soon as the training page is shown.
sub('app.js', "ELEM('startScene').onclick=startScene;ELEM('preloadBeforeStart').onclick=preloadVoskModel;",
    "ELEM('startScene').onclick=startScene;ELEM('preloadBeforeStart').onclick=preloadVoskModel;r25AutoVosk();")
sub('app.js', "首次逐题转写需联网下载 Whisper", "首次使用需联网下载中文识别模型（约42MB，下载后存本机）")

# Wording: in Vosk mode the model is the main engine, not a "backup".
sub('app.js', "function voskWidgetHtml(kind){",
    "function voskWidgetHtml(kind){\n const html=voskWidgetHtmlR24(kind);\n if(readR23ModelPreference()!=='vosk')return html;\n"
    " return html.replace(/逐题默认使用 Whisper (Tiny|Base)，首次转写需联网。备用 Vosk 约42MiB，可在需要时手动准备。/,'每题录音结束后自动转成简体中文写入回答栏。首次需下载约42MiB，下载后存本机。').replace(/备用 ?Vosk 中文识别/g,'本机中文识别').replace(/备用 ?Vosk/g,'中文识别模型');\n}\n"
    "function voskWidgetHtmlR24(kind){")

# ---------------------------------------------------------------- bridge: release the Worker on timeout
sub('whisper-bridge.mjs',
    "  const env = { remoteHost: PRIMARY_HF_HOST };\n  return request('init').then(() => ({",
    "  const env = { remoteHost: PRIMARY_HF_HOST };\n"
    "  // R2.5: a dedicated Worker CAN be stopped. Terminating it frees its WASM heap and\n"
    "  // network work, so a timed-out Whisper no longer has to lock the page's Vosk.\n"
    "  const ready = request('init').then(() => ({")
sub('whisper-bridge.mjs',
    "        return request('infer', { data: pcm, options: inferenceOptions }, [pcm.buffer]);\n      };\n    },\n  }));\n}",
    "        return request('infer', { data: pcm, options: inferenceOptions }, [pcm.buffer]);\n      };\n    },\n  }));\n"
    "  ready.dispose = () => fail('已释放');\n  return ready;\n}")
sub('whisper-bridge.mjs',
    "  let unhealthyReason = '';",
    "  let unhealthyReason = '';\n"
    "  let workerReleased = false;\n"
    "  const releaseWorker = () => {\n"
    "    if (pipelineFactory) return; // page-level test factory: cannot be stopped, keep fail-closed lock\n"
    "    try { workerModule?.dispose?.(); } catch {}\n"
    "    workerModule = null; cachedPipe = null; loadingPipePromise = null; currentInference = null;\n"
    "    workerReleased = true;\n"
    "    emit('worker-released');\n"
    "  };")
sub('whisper-bridge.mjs',
    "        unhealthyReason = 'Whisper 模型加载已超时/取消，已停用本页 Whisper 以防资源重入；请改用 Vosk 或重新打开测试页';\n      }\n      throw error;\n    } finally {\n      loadingPipePromise = null;\n    }",
    "        unhealthyReason = 'Whisper 模型加载已超时/取消，已停用本页 Whisper 以防资源重入；请改用 Vosk 或重新打开测试页';\n        releaseWorker();\n      }\n      throw error;\n    } finally {\n      loadingPipePromise = null;\n    }")
sub('whisper-bridge.mjs',
    "        unhealthyReason = 'Whisper 推理已超时/取消，可能仍在运行；本页禁止新的 Whisper 推理，请切换 Vosk 或重新打开';\n      }\n      throw error;",
    "        unhealthyReason = 'Whisper 推理已超时/取消，可能仍在运行；本页禁止新的 Whisper 推理，请切换 Vosk 或重新打开';\n        releaseWorker();\n      }\n      throw error;")
sub('whisper-bridge.mjs',
    "  transcribe.isResourceBusy = () => !!(unhealthyReason || loadingPipePromise || currentInference);",
    "  transcribe.isResourceBusy = () => !!(loadingPipePromise || currentInference || (unhealthyReason && !workerReleased));")

# ---------------------------------------------------------------- manifest
man = json.loads((OUT / 'static-manifest.json').read_text(encoding='utf-8'))
man['version'] = 'r25-asr-fallback-20261116'
for f in list(man['files']):
    man['files'][f] = hashlib.sha256((OUT / f).read_bytes()).hexdigest()
(OUT / 'static-manifest.json').write_text(json.dumps(man, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('R25_PATCH_OK', {k: man['files'][k][:12] for k in ('app.js', 'whisper-bridge.mjs', 'asr-normalize.mjs', 'index.html', 'r23-model-choice.js')})
