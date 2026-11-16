/** Candidate only: audio file -> decode/downmix/resample -> local Whisper.
 *  Zero added API cost. Includes bounded timeouts, single-pass 16kHz WebAudio
 *  downmix/resampling (iOS Safari memory-safe), 30s chunking for up to 120s audio,
 *  and automatic fallback from huggingface.co to hf-mirror.com.
 */
// Only these two multilingual open models are allowed; no paid transcription endpoint.
export const SUPPORTED_WHISPER_MODELS = Object.freeze({
  base: 'onnx-community/whisper-base',
  tiny: 'onnx-community/whisper-tiny',
});
export function resolveWhisperModel(preset) {
  if (preset !== 'base' && preset !== 'tiny') throw new Error('unsupported offline model preset');
  return SUPPORTED_WHISPER_MODELS[preset];
}
// Freeze the actual model artifacts; a mutable 'main' revision would make QA irreproducible.
export const WHISPER_REVISIONS = Object.freeze({
  base: '27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c',
  tiny: 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7',
});
// Base is the default; Tiny trades recognition capacity for lower memory use.
const DEFAULT_PRESET = 'base';
const PRIMARY_HF_HOST = 'https://huggingface.co/';
const MIRROR_HF_HOST = 'https://hf-mirror.com/';

// Only model loading/inference runs in this Worker. Keep WebAudio on the page:
// AudioContext/OfflineAudioContext are not available in every Worker runtime.
// Requests deliberately outlive caller timeouts; the engine below retains its
// unhealthy/resource lock until the page reloads, just as for local WASM work.
function createWorkerPipelineModule(progress_callback) {
  if (typeof globalThis.Worker !== 'function') {
    throw new Error('当前浏览器不支持后台语音识别 Worker，请使用新版 Safari/Chrome 或手动填写回答');
  }
  let worker;
  try { worker = new Worker(new URL('./whisper-worker.mjs', import.meta.url), { type: 'module', name: 'tcl-whisper' }); }
  catch (error) { throw new Error('后台语音识别 Worker 无法启动：' + String(error?.message || error)); }
  let nextId = 0, failed = null;
  const pending = new Map();
  const fail = error => {
    if (failed) return;
    failed = new Error('后台语音识别 Worker 已停止：' + String(error?.message || error));
    worker.terminate();
    for (const request of pending.values()) request.reject(failed);
    pending.clear();
  };
  worker.addEventListener('error', event => { event.preventDefault?.(); fail(event.message || '脚本无法加载'); });
  worker.addEventListener('messageerror', () => fail('无法读取识别响应'));
  worker.addEventListener('message', event => {
    const message = event.data;
    const request = message && pending.get(message.id);
    if (!request) return;
    if (message.type === 'progress') { try { progress_callback(message.info || {}); } catch {} return; }
    pending.delete(message.id);
    if (message.type === 'result') request.resolve(message.result);
    else request.reject(new Error(String(message.error || '后台语音识别失败')));
  });
  const request = (type, fields = {}, transfer = []) => new Promise((resolve, reject) => {
    if (failed) return reject(failed);
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    try { worker.postMessage({ id, type, ...fields }, transfer); }
    catch (error) { pending.delete(id); fail(error); reject(failed); }
  });
  const env = { remoteHost: PRIMARY_HF_HOST };
  // R2.5: a dedicated Worker CAN be stopped. Terminating it frees its WASM heap and
  // network work, so a timed-out Whisper no longer has to lock the page's Vosk.
  const ready = request('init').then(() => ({
    env,
    pipeline: async (_task, model, options) => {
      await request('load', { model, revision: options.revision, host: env.remoteHost });
      return (data, inferenceOptions) => {
        // Transfer a copy so a caller's prepared PCM remains reusable and the
        // Worker cannot detach audio held by the page or another waiting job.
        const pcm = new Float32Array(data);
        return request('infer', { data: pcm, options: inferenceOptions }, [pcm.buffer]);
      };
    },
  }));
  ready.dispose = () => fail('已释放');
  return ready;
}

function withBoundedTimeout(promise, ms, label, signal) {
  let timer = null;
  let onAbort = null;
  const timeoutMs = Math.max(50, Number(ms) || 60000);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      if (onAbort && signal?.removeEventListener) signal.removeEventListener('abort', onAbort);
    };
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    if (signal?.aborted) return done(reject, new Error('cancelled'));
    if (signal && typeof signal.addEventListener === 'function') {
      onAbort = () => done(reject, new Error('cancelled'));
      signal.addEventListener('abort', onAbort, { once: true });
    }
    timer = setTimeout(() => done(reject, new Error(`${label}超时（${Math.ceil(timeoutMs / 1000)}秒）`)), timeoutMs);
    Promise.resolve(promise).then(value => done(resolve, value), error => done(reject, error));
  });
}

function decodeAudioBufferCompat(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, val) => {
      if (!settled) {
        settled = true;
        fn(val);
      }
    };
    try {
      const p = ctx.decodeAudioData(
        arrayBuffer,
        decoded => done(resolve, decoded),
        err => done(reject, err || new Error('音频容器解码失败'))
      );
      if (p && typeof p.then === 'function') {
        p.then(decoded => done(resolve, decoded), err => done(reject, err));
      }
    } catch (err) {
      done(reject, err);
    }
  });
}

export async function prepareAudio(blob, { maxSeconds = 120, decodeTimeoutMs, signal } = {}) {
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 180) throw new Error('invalid audio duration limit');
  if (signal?.aborted) throw new Error('cancelled');
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Context || !Offline) throw new Error('AudioContext unavailable');
  if (!blob || typeof blob.arrayBuffer !== 'function' || !Number.isFinite(blob.size) || blob.size <= 0) {
    throw new Error('invalid or empty audio');
  }
  if (blob.size > 48 * 1024 * 1024) throw new Error('audio exceeds 48 MiB');
  const timeoutMs = Number(decodeTimeoutMs) || Number(globalThis.__ASR_DECODE_TIMEOUT_MS) || 30000;
  const ctx = new Context();
  try {
    const rawBytes = await withBoundedTimeout(blob.arrayBuffer(), timeoutMs, '读取音频字节', signal);
    const pcm = await withBoundedTimeout(decodeAudioBufferCompat(ctx, rawBytes), timeoutMs, '音频解码', signal);
    if (!pcm || !Number.isFinite(pcm.duration) || pcm.duration <= 0 || pcm.duration > maxSeconds) {
      throw new Error('invalid or overlong audio');
    }
    const sampleCount = Math.max(1, Math.ceil(pcm.duration * 16000));
    const offline = new Offline(1, sampleCount, 16000);
    const source = offline.createBufferSource();
    // Single-pass C++ downmix + 16kHz resample when pcm is a native AudioBuffer;
    // fallback to JS downmix if running under a synthetic test mock.
    try {
      source.buffer = pcm;
      if (source.buffer !== pcm) throw new Error('mock buffer requires copy');
    } catch {
      const mono = new Float32Array(pcm.length);
      for (let c = 0; c < pcm.numberOfChannels; c++) {
        const channel = pcm.getChannelData(c);
        for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / pcm.numberOfChannels;
      }
      const buf = offline.createBuffer(1, mono.length, pcm.sampleRate);
      buf.copyToChannel(mono, 0);
      source.buffer = buf;
    }
    source.connect(offline.destination);
    source.start();
    const rendered = await withBoundedTimeout(offline.startRendering(), timeoutMs, '音频重采样', signal);
    const data = rendered.getChannelData(0);
    let sumSq = 0;
    for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
    const rms = data.length ? Math.sqrt(sumSq / data.length) : 0;
    if (!Number.isFinite(rms)) throw new Error('audio contains invalid PCM samples');
    return { data: new Float32Array(data), sampleRate: 16000, duration: pcm.duration, rms };
  } finally {
    await ctx.close?.().catch?.(() => {});
  }
}

export function createLocalWhisper({
  onProgress = () => {},
  onDiagnostic = () => {},
  loadTimeoutMs,
  inferTimeoutMs,
  pipelineFactory = null,
  modelPreset = DEFAULT_PRESET,
} = {}) {
  const MODEL_ID = resolveWhisperModel(modelPreset);
  const revision = WHISPER_REVISIONS[modelPreset];
  const emit = (stage, fields = {}) => { try { onDiagnostic({stage, model: MODEL_ID, revision, ...fields}); } catch {} };
  const progress_callback = info => {
    if (info.status === 'progress') onProgress('下载模型：' + Math.round(Number(info.loaded)||0) + '/' + Math.round(Number(info.total)||0) + ' 字节 · ' + Math.round(Number(info.progress)||0) + '%');
  };
  let cachedPipe = null;
  let loadingPipePromise = null;
  let workerModule = null;
  // A timeout does not terminate WASM inference or an in-flight model load.
  // Once timed out, fail closed: no further jobs may re-enter this singleton.
  // The caller will use the Vosk fallback or report a recoverable error.
  let unhealthyReason = '';
  let workerReleased = false;
  const releaseWorker = () => {
    if (pipelineFactory) return; // page-level test factory: cannot be stopped, keep fail-closed lock
    try { workerModule?.dispose?.(); } catch {}
    workerModule = null; cachedPipe = null; loadingPipePromise = null; currentInference = null;
    workerReleased = true;
    emit('worker-released');
  };
  let currentInference = null;

  async function ensurePipeline(signal) {
    if (unhealthyReason) throw new Error(unhealthyReason);
    if (cachedPipe) return cachedPipe;
    if (loadingPipePromise) return await withBoundedTimeout(loadingPipePromise, loadTimeoutMs || Number(globalThis.__WHISPER_LOAD_TIMEOUT_MS) || 60000, '等待 Whisper 模型加载', signal);

    const perAttemptMs = Number(loadTimeoutMs) || Number(globalThis.__WHISPER_LOAD_TIMEOUT_MS) || 45000;
    loadingPipePromise = (async () => {
      if (typeof pipelineFactory === 'function') {
        cachedPipe = await withBoundedTimeout(pipelineFactory(MODEL_ID), perAttemptMs, '加载 Whisper 模型', signal);
        return cachedPipe;
      }
      if (!workerModule) workerModule = createWorkerPipelineModule(progress_callback);
      const mod = await withBoundedTimeout(workerModule, perAttemptMs, '启动后台语音识别运行时', signal);
      const { pipeline, env } = mod;
      try {
        if (env) env.remoteHost = globalThis.__WHISPER_FORCE_MIRROR ? MIRROR_HF_HOST : PRIMARY_HF_HOST;
        emit('model-download', {source: globalThis.__WHISPER_FORCE_MIRROR ? MIRROR_HF_HOST : PRIMARY_HF_HOST});
        cachedPipe = await withBoundedTimeout(
          pipeline('automatic-speech-recognition', MODEL_ID, { device: 'wasm', dtype: 'q8', revision, progress_callback }),
          perAttemptMs,
          '下载/初始化 Whisper 模型',
          signal
        );
        return cachedPipe;
      } catch (primaryErr) {
        // A timed-out load may still be running and may mutate global WASM/env
        // state. Do NOT start a second download from the mirror concurrently.
        if (signal?.aborted || /超时|cancelled/i.test(String(primaryErr?.message || primaryErr))) {
          unhealthyReason = 'Whisper 模型加载已超时/取消，已停用本页 Whisper 以防资源重入；请改用 Vosk 或重新打开测试页';
          throw primaryErr;
        }
        if (globalThis.__WHISPER_FORCE_MIRROR) throw primaryErr; // already on mirror: no identical second attempt
        onProgress('主源连接失败，正在切换备用镜像加载 Whisper 模型…');
        emit('model-download', {source: MIRROR_HF_HOST});
        if (env) env.remoteHost = MIRROR_HF_HOST;
        cachedPipe = await withBoundedTimeout(
          pipeline('automatic-speech-recognition', MODEL_ID, { device: 'wasm', dtype: 'q8', revision, progress_callback }),
          perAttemptMs,
          '镜像源下载/初始化 Whisper 模型',
          signal
        );
        return cachedPipe;
      }
    })();

    try {
      return await withBoundedTimeout(loadingPipePromise, 2 * perAttemptMs + 10000, 'Whisper 总加载', signal);
    } catch (error) {
      if (/超时|cancelled/i.test(String(error?.message || error))) {
        unhealthyReason = 'Whisper 模型加载已超时/取消，已停用本页 Whisper 以防资源重入；请改用 Vosk 或重新打开测试页';
        releaseWorker();
      }
      throw error;
    } finally {
      loadingPipePromise = null;
    }
  }

  async function transcribePreparedAudio(audio, { signal } = {}) {
    if (unhealthyReason) throw new Error(unhealthyReason);
    if (!audio || !(audio.data instanceof Float32Array) || audio.sampleRate !== 16000 ||
        !Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > 180 ||
        !audio.data.length || audio.data.length > 180 * 16000) {
      throw new Error('invalid prepared 16 kHz audio');
    }
    // Validate and measure the supplied PCM too: whole-session transcription uses
    // this entry point, sharing the exact same model and inference lock.
    let sumSq = 0;
    for (const sample of audio.data) sumSq += sample * sample;
    audio = { ...audio, rms: Math.sqrt(sumSq / audio.data.length) };
    if (!Number.isFinite(audio.rms)) throw new Error('audio contains invalid PCM samples');
    if (signal?.aborted) throw new Error('cancelled');
    if (audio.rms < 0.001) return { text: '', duration: audio.duration, rms: audio.rms, model: MODEL_ID }; // do not invent speech
    onProgress('加载多语言 Whisper ' + (modelPreset === 'base' ? 'Base 增强' : 'Tiny 轻量') + ' 模型（首次需下载；支持镜像自动切换）');
    const pipe = await ensurePipeline(signal);
    if (signal?.aborted) throw new Error('cancelled');
    emit('model-ready');
    onProgress('模型就绪，正在当前浏览器执行中文语音识别');
    const maxInferMs = Number(inferTimeoutMs) || Number(globalThis.__WHISPER_INFER_TIMEOUT_MS) || 120000;
    while (currentInference) {
      await withBoundedTimeout(currentInference.catch(() => {}), maxInferMs, '等待上一段 Whisper 推理', signal);
      if (unhealthyReason) throw new Error(unhealthyReason);
      if (signal?.aborted) throw new Error('cancelled');
    }
    try {
      const rawInference = Promise.resolve().then(() => pipe(audio.data, {
        language: 'chinese',
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
      }));
      // Release the lock only when underlying computation actually settles.
      currentInference = rawInference;
      rawInference.finally(() => { if (currentInference === rawInference) currentInference = null; }).catch(() => {});
      const result = await withBoundedTimeout(rawInference, maxInferMs, 'Whisper 中文语音识别', signal);
      if (signal?.aborted) throw new Error('cancelled');
      emit('inference-complete');
      return { text: result?.text || '', duration: audio.duration, rms: audio.rms, model: MODEL_ID };
    } catch (error) {
      if (/超时|cancelled/i.test(String(error?.message || error))) {
        unhealthyReason = 'Whisper 推理已超时/取消，可能仍在运行；本页禁止新的 Whisper 推理，请切换 Vosk 或重新打开';
        releaseWorker();
      }
      throw error;
    }
  }

  const transcribe = async (blob, { signal } = {}) => {
    if (unhealthyReason) throw new Error(unhealthyReason);
    if (signal?.aborted) throw new Error('cancelled');
    onProgress('解码并提取本题录音');
    emit('decode-start', {bytes: blob?.size||0, mime: blob?.type||''});
    const audio = await prepareAudio(blob, { signal });
    emit('decoded', {duration: audio.duration, rms: audio.rms, sampleRate: audio.sampleRate});
    return transcribePreparedAudio(audio, { signal });
  };
  transcribe.transcribePreparedAudio = transcribePreparedAudio;
  // Timeout cannot terminate WASM. Callers must not start another engine while
  // this page still owns potentially active work; preserve media and reload.
  transcribe.isResourceBusy = () => !!(loadingPipePromise || currentInference || (unhealthyReason && !workerReleased));
  return transcribe;
}
