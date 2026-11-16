/** Candidate only: audio file -> decode/downmix/resample -> local Whisper.  */
const MODEL_ID = 'onnx-community/whisper-tiny'; // multilingual; NOT .en
const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

export async function prepareAudio(blob, { maxSeconds = 120 } = {}) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context) throw new Error('AudioContext unavailable');
  if (blob.size > 48 * 1024 * 1024) throw new Error('audio exceeds 48 MiB');
  const ctx = new Context();
  try {
    const pcm = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (!Number.isFinite(pcm.duration) || pcm.duration <= 0 || pcm.duration > maxSeconds) throw new Error('invalid or overlong audio');
    const mono = new Float32Array(pcm.length);
    for (let c = 0; c < pcm.numberOfChannels; c++) {
      const channel = pcm.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / pcm.numberOfChannels;
    }
    // OfflineAudioContext performs browser-native resampling to 16 kHz.
    const sampleCount = Math.max(1, Math.ceil(mono.length * 16000 / pcm.sampleRate));
    const offline = new OfflineAudioContext(1, sampleCount, 16000);
    const buf = offline.createBuffer(1, mono.length, pcm.sampleRate);
    buf.copyToChannel(mono, 0);
    const source = offline.createBufferSource();
    source.buffer = buf;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const data = rendered.getChannelData(0);
    let sumSq = 0;
    for (const x of data) sumSq += x * x;
    const rms = Math.sqrt(sumSq / data.length);
    return { data: new Float32Array(data), sampleRate: 16000, duration: pcm.duration, rms };
  } finally { await ctx.close().catch(() => {}); }
}

export function createLocalWhisper({ onProgress = () => {} } = {}) {
  let cachedPipe;
  return async (blob, { signal } = {}) => {
    if (signal?.aborted) throw new Error('cancelled');
    onProgress('解码并提取本题录音');
    const audio = await prepareAudio(blob);
    if (signal?.aborted) throw new Error('cancelled');
    if (audio.rms < 0.001) return { text: '' }; // do not invent speech
    onProgress('加载多语言 Whisper 模型（首次需下载；网络/内存可能失败）');
    // External library and model files are not bundled, pinned model hash NOT verified.
    // This is an isolated research adapter, not a production-approved supply chain.
    if (!cachedPipe) {
      const { pipeline } = await import(CDN);
      cachedPipe = await pipeline('automatic-speech-recognition', MODEL_ID, { device: 'wasm', dtype: 'q8' });
    }
    if (signal?.aborted) throw new Error('cancelled');
    onProgress('在当前浏览器执行中文语音识别');
    const result = await cachedPipe(audio.data, { language: 'chinese', task: 'transcribe' });
    if (signal?.aborted) throw new Error('cancelled');
    return { text: result?.text || '' };
  };
}
