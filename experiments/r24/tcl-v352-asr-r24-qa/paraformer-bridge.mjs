/** Local Mandarin Paraformer. Audio stays in this browser and a dedicated Worker. */
import { prepareAudio } from './whisper-bridge.mjs';

export const PARAFORMER_MODEL = 'ParaformerSmall-int8';
const MAX_SECONDS = 180;
const cancelled = () => new Error('Paraformer 识别已取消');
const timeoutError = label => new Error(`Paraformer ${label}超时，已释放本机识别资源；可重试或使用备用识别`);

// This is intentionally NOT a voice-activity detector. Only mathematically
// constant DC or a near-perfect stationary single oscillator is rejected. It
// does not classify room noise/music or reject speech by loudness/pitch. A real
// vowel has modulation/harmonics; quiet real speech must still reach the model.
export function classifyParaformerSignal(data, sampleRate = 16000) {
  if (!(data instanceof Float32Array) || data.length < 320 || sampleRate !== 16000) return { nonSpeech: false };
  let sum = 0, total = 0;
  for (const x of data) { if (!Number.isFinite(x)) return { nonSpeech: false }; sum += x; total += x * x; }
  if (total === 0) return { nonSpeech: true, reason: 'digital-silence' };
  const mean = sum / data.length;
  let variance = 0;
  for (const x of data) variance += (x - mean) * (x - mean);
  if (variance / total <= 1e-14) return { nonSpeech: true, reason: 'constant-dc' };
  if (data.length < .75 * sampleRate) return { nonSpeech: false };
  // Fit x[n-1]+x[n+1] = a*x[n]+b. The intercept allows a harmless DC
  // offset and noninteger periods without relaxing the tiny error tolerance.
  let sumX = 0, sumY = 0;
  for (let i = 1; i + 1 < data.length; i++) { sumX += data[i]; sumY += data[i - 1] + data[i + 1]; }
  const count = data.length - 2, meanX = sumX / count, meanY = sumY / count;
  let numerator = 0, denominator = 0;
  for (let i = 1; i + 1 < data.length; i++) {
    const center = data[i] - meanX;
    numerator += center * (data[i - 1] + data[i + 1] - meanY);
    denominator += center * center;
  }
  const coefficient = numerator / denominator;
  if (!Number.isFinite(coefficient) || Math.abs(coefficient) >= 2) return { nonSpeech: false };
  const frequency = Math.acos(coefficient / 2) * sampleRate / (2 * Math.PI);
  if (frequency < 40 || frequency > 7600) return { nonSpeech: false };
  const intercept = meanY - coefficient * meanX;
  let residual = 0;
  for (let i = 1; i + 1 < data.length; i++) {
    const error = data[i - 1] + data[i + 1] - coefficient * data[i] - intercept;
    residual += error * error;
  }
  const normalizedResidual = residual / denominator;
  return normalizedResidual <= 1e-12
    ? { nonSpeech: true, reason: 'stationary-tone', frequency, normalizedResidual }
    : { nonSpeech: false };
}

// Do not remove silence, duplicate words or samples. Short recordings pass through
// unchanged. Long inputs are contiguous <=30s blocks, cut at a quiet 20ms frame
// near each block end, without overlap or text deduplication.
export function segmentParaformerAudio(data) {
  const limit = 30 * 16000, window = 2 * 16000, frame = 320, segments = [];
  for (let start = 0; start < data.length;) {
    let end = Math.min(data.length, start + limit);
    if (end < data.length) {
      let best = Infinity, cut = end;
      for (let at = end - window; at + frame <= end; at += frame) {
        let energy = 0;
        for (let i = at; i < at + frame; i++) energy += data[i] * data[i];
        if (energy <= best) { best = energy; cut = at + frame; }
      }
      end = cut;
    }
    segments.push({ start, end });
    start = end;
  }
  return segments;
}

export function createLocalParaformer({ onProgress = () => {}, onDiagnostic = () => {}, loadTimeoutMs = 180000, inferTimeoutMs = 120000 } = {}) {
  let worker = null, ready = null, failure = null, epoch = 0, sequence = 0, queue = Promise.resolve();
  const pending = new Map(), controllers = new Set(), running = new Set();
  const progress = text => { try { onProgress(text); } catch {} };
  const emit = (stage, extra = {}) => { try { onDiagnostic({ stage, model: PARAFORMER_MODEL, ...extra }); } catch {} };
  const boundedMs = (value, fallback) => Math.max(50, Math.min(600000, Number(value) || fallback));

  function stopWorker(error, unhealthy = true) {
    const current = worker;
    worker = null; ready = null;
    if (unhealthy) failure = error;
    if (current) { current.terminate(); emit('worker-released'); }
    if (unhealthy) emit('model-error', { message: String(error?.message || error).slice(0, 220) });
    for (const job of pending.values()) { clearTimeout(job.timer); job.cleanup(); job.reject(error); }
    pending.clear();
  }
  function assertCurrent(callEpoch, signal) {
    if (callEpoch !== epoch || signal?.aborted) throw cancelled();
    if (failure) throw failure;
  }
  function request(type, fields, ms, signal, callEpoch) {
    assertCurrent(callEpoch, signal);
    const current = worker;
    if (!current) return Promise.reject(new Error('Paraformer 后台识别资源尚未就绪'));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const abort = () => { if (callEpoch === epoch && worker === current) stopWorker(cancelled()); };
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const timer = setTimeout(() => { if (callEpoch === epoch && worker === current) stopWorker(timeoutError(type === 'load' ? '模型加载' : '中文识别')); }, ms);
      pending.set(id, { resolve, reject, timer, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      try {
        if (type === 'infer') {
          // Never transfer caller-owned PCM or detach recorded audio.
          const data = new Float32Array(fields.data);
          current.postMessage({ id, type, ...fields, data }, [data.buffer]);
        } else current.postMessage({ id, type, ...fields });
      } catch (error) { stopWorker(new Error('Paraformer 后台请求失败：' + String(error?.message || error).slice(0, 120))); }
    });
  }
  async function ensureReady(signal, callEpoch) {
    assertCurrent(callEpoch, signal);
    if (ready) return ready;
    let current;
    try {
      if (typeof Worker !== 'function') throw new Error('当前浏览器不支持后台识别 Worker');
      current = new Worker(new URL('./paraformer-worker.js', import.meta.url), { name: 'tcl-paraformer' });
    } catch (cause) {
      const error = new Error('Paraformer 无法创建后台识别：' + String(cause?.message || cause).slice(0, 140));
      stopWorker(error);
      throw error;
    }
    worker = current;
    current.addEventListener('message', event => {
      if (worker !== current || callEpoch !== epoch) return;
      const message = event.data, job = pending.get(message?.id);
      if (!job) return;
      if (message.type === 'progress') {
        const info = message.info || {};
        progress(info.text || '正在准备本机 Paraformer 中文识别');
        emit('model-progress', { loaded: info.loaded, total: info.total, file: info.file, cached: info.cached });
        return;
      }
      pending.delete(message.id); clearTimeout(job.timer); job.cleanup();
      if (message.type === 'result') job.resolve(message.result);
      else {
        const error = new Error('Paraformer ' + String(message.error || '识别未完成').slice(0, 220));
        job.reject(error);
        stopWorker(error);
      }
    });
    current.addEventListener('error', event => {
      event.preventDefault?.();
      if (worker === current && callEpoch === epoch) stopWorker(new Error('Paraformer Worker 无法启动或已停止，可使用备用识别'));
    });
    current.addEventListener('messageerror', () => { if (worker === current) stopWorker(new Error('Paraformer 后台响应无法读取')); });
    progress('首次准备 Paraformer 中文模型，录音只在本机识别');
    emit('model-download');
    ready = request('load', {}, boundedMs(loadTimeoutMs, 180000), signal, callEpoch).then(result => { assertCurrent(callEpoch, signal); emit('model-ready', { heapBytes: result?.heapBytes }); });
    return ready;
  }
  function enqueue(action, externalSignal) {
    const callEpoch = epoch, controller = new AbortController(), token = { epoch: callEpoch };
    const relay = () => controller.abort();
    externalSignal?.addEventListener('abort', relay, { once: true });
    if (externalSignal?.aborted) controller.abort();
    controllers.add(controller);
    const task = queue.catch(() => {}).then(async () => {
      assertCurrent(callEpoch, controller.signal); running.add(token);
      try { return await action(controller.signal, callEpoch); }
      finally { running.delete(token); }
    });
    queue = task.catch(() => {});
    return new Promise((resolve, reject) => {
      const abort = () => reject(cancelled());
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) reject(cancelled());
      task.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
    }).finally(() => { controllers.delete(controller); externalSignal?.removeEventListener('abort', relay); });
  }
  async function prepared(audio, signal, callEpoch) {
    assertCurrent(callEpoch, signal);
    if (!audio || !(audio.data instanceof Float32Array) || audio.sampleRate !== 16000 || !Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > MAX_SECONDS || !audio.data.length || audio.data.length > MAX_SECONDS * 16000) throw new Error('invalid prepared 16 kHz audio');
    let sum = 0;
    for (const sample of audio.data) { if (!Number.isFinite(sample)) throw new Error('audio contains invalid PCM samples'); sum += sample * sample; }
    const rms = Math.sqrt(sum / audio.data.length), duration = audio.data.length / 16000;
    // Only digital/near-digital silence is rejected here. Quiet real speech is
    // not discarded by an RMS threshold before this Mandarin model sees it.
    if (rms < 1e-7) return { text: '', duration, rms, model: PARAFORMER_MODEL, chunks: [] };
    const signalType = classifyParaformerSignal(audio.data);
    if (signalType.nonSpeech) {
      emit('non-speech-filtered', { reason: signalType.reason });
      return { text: '', duration, rms, model: PARAFORMER_MODEL, chunks: [], nonSpeech: signalType.reason };
    }
    await ensureReady(signal, callEpoch);
    const segments = segmentParaformerAudio(audio.data), chunks = [], started = performance.now();
    const budget = boundedMs(inferTimeoutMs, 120000);
    for (let i = 0; i < segments.length; i++) {
      assertCurrent(callEpoch, signal);
      const remaining = budget - (performance.now() - started);
      if (remaining <= 0) { const error = timeoutError('中文识别'); stopWorker(error); throw error; }
      const { start, end } = segments[i];
      progress(segments.length > 1 ? `Paraformer 正在本机识别第 ${i + 1}/${segments.length} 段` : 'Paraformer 正在本机识别中文');
      const result = await request('infer', { data: segments.length === 1 ? audio.data : audio.data.subarray(start, end) }, remaining, signal, callEpoch);
      assertCurrent(callEpoch, signal);
      if (!result || typeof result.text !== 'string') { const error = new Error('Paraformer 未返回有效识别结果'); stopWorker(error); throw error; }
      if (Number.isFinite(result.heapBytes)) emit('worker-memory', { heapBytes: result.heapBytes });
      chunks.push({ startSeconds: start / 16000, endSeconds: end / 16000, text: result.text });
    }
    emit('inference-complete', { duration, chunks: chunks.length });
    return { text: chunks.map(chunk => chunk.text).join(''), duration, rms, model: PARAFORMER_MODEL, chunks };
  }
  const transcribe = (blob, { signal } = {}) => enqueue(async (internalSignal, callEpoch) => {
    emit('decode-start', { bytes: blob?.size || 0 });
    const audio = await prepareAudio(blob, { maxSeconds: MAX_SECONDS, signal: internalSignal });
    assertCurrent(callEpoch, internalSignal); emit('decoded', { duration: audio.duration, sampleRate: audio.sampleRate });
    return prepared(audio, internalSignal, callEpoch);
  }, signal);
  transcribe.transcribePreparedAudio = (audio, { signal } = {}) => enqueue((internalSignal, callEpoch) => prepared(audio, internalSignal, callEpoch), signal);
  transcribe.preload = ({ signal } = {}) => enqueue((internalSignal, callEpoch) => ensureReady(internalSignal, callEpoch), signal);
  transcribe.isResourceBusy = () => pending.size > 0 || [...running].some(token => token.epoch === epoch);
  transcribe.dispose = () => {
    epoch++;
    for (const controller of controllers) controller.abort();
    controllers.clear(); stopWorker(cancelled(), false); failure = null; queue = Promise.resolve();
  };
  transcribe.resetFailure = () => {
    // Explicit user retry only. Keep an active/ready worker intact and retire
    // any old queued generation before allowing another large model download.
    if (worker || transcribe.isResourceBusy()) return false;
    if (failure) transcribe.dispose();
    return true;
  };
  return transcribe;
}
