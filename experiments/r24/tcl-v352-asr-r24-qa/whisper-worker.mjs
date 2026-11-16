/** Dedicated model runtime: no DOM, recordings, credentials or paid endpoints. */
import { SUPPORTED_WHISPER_MODELS, WHISPER_REVISIONS } from './whisper-bridge.mjs';

const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const HOSTS = new Set(['https://huggingface.co/', 'https://hf-mirror.com/']);
let runtime = null, pipe = null, loadedModel = '';
let queue = Promise.resolve();

async function handle(message) {
  const { id, type } = message;
  if (type === 'init') {
    runtime = await import(CDN);
    return null;
  }
  if (!runtime) throw new Error('语音识别运行时尚未就绪');
  if (type === 'load') {
    const preset = Object.keys(SUPPORTED_WHISPER_MODELS).find(key => SUPPORTED_WHISPER_MODELS[key] === message.model);
    if (!preset || message.revision !== WHISPER_REVISIONS[preset] || !HOSTS.has(message.host)) throw new Error('不支持的本机模型或下载地址');
    if (pipe && loadedModel !== message.model) throw new Error('本页不能同时加载不同语音模型，请刷新后切换');
    runtime.env.remoteHost = message.host;
    pipe = await runtime.pipeline('automatic-speech-recognition', message.model, {
      device: 'wasm', dtype: 'q8', revision: message.revision,
      progress_callback: info => self.postMessage({ id, type: 'progress', info: {
        status: info.status, loaded: info.loaded, total: info.total, progress: info.progress,
      } }),
    });
    loadedModel = message.model;
    return null;
  }
  if (type === 'infer') {
    if (!pipe) throw new Error('语音识别模型尚未就绪');
    if (!(message.data instanceof Float32Array) || !message.data.length || message.data.length > 180 * 16000) throw new Error('invalid prepared PCM');
    // Keep decoding policy fixed; do not accept arbitrary pipeline options.
    const result = await pipe(message.data, { language: 'chinese', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    return { text: String(result?.text || '') };
  }
  throw new Error('未知语音识别请求');
}

self.addEventListener('message', event => {
  const message = event.data;
  if (!message || !Number.isSafeInteger(message.id)) return;
  // Even malformed or simultaneous callers cannot overlap model operations.
  queue = queue.then(async () => {
    try { self.postMessage({ id: message.id, type: 'result', result: await handle(message) }); }
    catch (error) { self.postMessage({ id: message.id, type: 'error', error: String(error?.message || error) }); }
  });
});
