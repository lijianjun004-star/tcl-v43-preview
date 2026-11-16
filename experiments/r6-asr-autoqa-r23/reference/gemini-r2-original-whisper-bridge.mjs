/** Candidate only: audio file -> decode/downmix/resample -> local Whisper.
 *  Zero added API cost. Includes bounded timeouts, single-pass 16kHz WebAudio
 *  downmix/resampling (iOS Safari memory-safe), 30s chunking for up to 120s audio,
 *  and automatic fallback from huggingface.co to hf-mirror.com.
 */
const MODEL_ID = 'onnx-community/whisper-tiny'; // multilingual; NOT .en
const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const PRIMARY_HF_HOST = 'https://huggingface.co/';
const MIRROR_HF_HOST = 'https://hf-mirror.com/';

function withBoundedTimeout(promise, ms, label, signal) {
  let timer = null;
  let onAbort = null;
  const timeoutMs = Math.max(50, Number(ms) || 60000);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('cancelled'));
      return;
    }
    if (signal && typeof signal.addEventListener === 'function') {
      onAbort = () => {
        clearTimeout(timer);
        reject(new Error('cancelled'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
    timer = setTimeout(() => {
      reject(new Error(`${label}超时（${Math.ceil(timeoutMs / 1000)}秒）`));
    }, timeoutMs);
    Promise.resolve(promise).then(
      val => {
        clearTimeout(timer);
        if (onAbort && signal?.removeEventListener) signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      err => {
        clearTimeout(timer);
        if (onAbort && signal?.removeEventListener) signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
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

export async function prepareAudio(blob, { maxSeconds = 120, decodeTimeoutMs } = {}) {
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
    const rawBytes = await withBoundedTimeout(blob.arrayBuffer(), timeoutMs, '读取音频字节');
    const pcm = await withBoundedTimeout(decodeAudioBufferCompat(ctx, rawBytes), timeoutMs, '音频解码');
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
    const rendered = await withBoundedTimeout(offline.startRendering(), timeoutMs, '音频重采样');
    const data = rendered.getChannelData(0);
    let sumSq = 0;
    for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i];
    const rms = data.length ? Math.sqrt(sumSq / data.length) : 0;
    return { data: new Float32Array(data), sampleRate: 16000, duration: pcm.duration, rms };
  } finally {
    await ctx.close?.().catch?.(() => {});
  }
}

export function createLocalWhisper({
  onProgress = () => {},
  loadTimeoutMs,
  inferTimeoutMs,
  pipelineFactory = null,
} = {}) {
  let cachedPipe = null;
  let loadingPipePromise = null;

  async function ensurePipeline(signal) {
    if (cachedPipe) return cachedPipe;
    if (loadingPipePromise) return await withBoundedTimeout(loadingPipePromise, loadTimeoutMs || Number(globalThis.__WHISPER_LOAD_TIMEOUT_MS) || 60000, '等待 Whisper 模型加载', signal);

    const perAttemptMs = Number(loadTimeoutMs) || Number(globalThis.__WHISPER_LOAD_TIMEOUT_MS) || 45000;
    loadingPipePromise = (async () => {
      if (typeof pipelineFactory === 'function') {
        cachedPipe = await withBoundedTimeout(pipelineFactory(), perAttemptMs, '加载 Whisper 模型', signal);
        return cachedPipe;
      }
      const mod = await withBoundedTimeout(import(CDN), perAttemptMs, '加载 Transformers.js 运行时', signal);
      const { pipeline, env } = mod;
      try {
        if (env && !globalThis.__WHISPER_FORCE_MIRROR) {
          env.remoteHost = PRIMARY_HF_HOST;
        }
        cachedPipe = await withBoundedTimeout(
          pipeline('automatic-speech-recognition', MODEL_ID, { device: 'wasm', dtype: 'q8' }),
          perAttemptMs,
          '下载/初始化 Whisper 模型',
          signal
        );
        return cachedPipe;
      } catch (primaryErr) {
        if (signal?.aborted) throw primaryErr;
        onProgress('主源连接受限，正在切换国内镜像源加载 Whisper 模型…');
        if (env) env.remoteHost = MIRROR_HF_HOST;
        cachedPipe = await withBoundedTimeout(
          pipeline('automatic-speech-recognition', MODEL_ID, { device: 'wasm', dtype: 'q8' }),
          perAttemptMs,
          '镜像源下载/初始化 Whisper 模型',
          signal
        );
        return cachedPipe;
      }
    })();

    try {
      return await loadingPipePromise;
    } finally {
      loadingPipePromise = null;
    }
  }

  return async (blob, { signal } = {}) => {
    if (signal?.aborted) throw new Error('cancelled');
    onProgress('解码并提取本题录音');
    const audio = await prepareAudio(blob);
    if (signal?.aborted) throw new Error('cancelled');
    if (audio.rms < 0.001) return { text: '', duration: audio.duration, rms: audio.rms }; // do not invent speech
    onProgress('加载多语言 Whisper 模型（首次需下载；支持镜像自动切换）');
    const pipe = await ensurePipeline(signal);
    if (signal?.aborted) throw new Error('cancelled');
    onProgress('在当前浏览器执行中文语音识别');
    const maxInferMs = Number(inferTimeoutMs) || Number(globalThis.__WHISPER_INFER_TIMEOUT_MS) || 120000;
    const result = await withBoundedTimeout(
      pipe(audio.data, {
        language: 'chinese',
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
      }),
      maxInferMs,
      'Whisper 中文语音识别',
      signal
    );
    if (signal?.aborted) throw new Error('cancelled');
    return { text: result?.text || '', duration: audio.duration, rms: audio.rms };
  };
}