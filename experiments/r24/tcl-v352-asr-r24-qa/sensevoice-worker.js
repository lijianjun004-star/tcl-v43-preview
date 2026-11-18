/* SenseVoiceSmall int8, official single-thread sherpa WASM. No audio upload. */
'use strict';
const ASSET_BASE = new URL('./vendor/sensevoice/', self.location.href);
const VERSION = 'sensevoice-small-int8-sherpa-1.12.20';
const MANIFEST_SHA256 = 'd63e3d6c587d49ac5a14508465afbb55db6a4f7e26cee934238e7b5ada43a90e';
const CACHE_NAME = 'tcl-r24-sensevoice-assets-1.12.20-v1';
const networkFetch = self.fetch.bind(self);
let recognizer = null, loading = null, operations = Promise.resolve();
const progress = (id, info) => self.postMessage({ id, type: 'progress', info });
const messageError = error => String(error?.message || error || '本机识别失败').slice(0, 220);
async function sha256(bytes) {
  if (!self.crypto?.subtle) throw new Error('当前浏览器缺少安全的模型校验能力');
  return [...new Uint8Array(await self.crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
}
function validateEntry(entry) {
  if (!entry || typeof entry.file !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(entry.file) || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > 256 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('模型资源清单无效');
  return new URL(entry.file, ASSET_BASE).href;
}
async function verifiedFile(entry, id) {
  const url = validateEntry(entry);
  let cache;
  try { if (self.caches) cache = await self.caches.open(CACHE_NAME); } catch {}
  if (cache) {
    const cached = await cache.match(url).catch(() => null);
    if (cached) {
      const bytes = new Uint8Array(await cached.arrayBuffer());
      if (bytes.length === entry.bytes && await sha256(bytes) === entry.sha256) {
        progress(id, { text: '已校验本机缓存：' + entry.file, file: entry.file, loaded: bytes.length, total: entry.bytes, cached: true });
        return bytes;
      }
      await cache.delete(url).catch(() => {});
    }
  }
  progress(id, { text: '正在下载并校验 SenseVoice：' + entry.file, file: entry.file, loaded: 0, total: entry.bytes });
  const response = await networkFetch(url, { credentials: 'omit', redirect: 'error', cache: 'no-store' });
  if (!response.ok) throw new Error('模型资源下载失败 HTTP ' + response.status);
  const declared = Number(response.headers.get('content-length'));
  if (declared > entry.bytes) throw new Error('模型资源长度不符');
  let bytes;
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = []; let loaded = 0, last = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        loaded += value.byteLength;
        if (loaded > entry.bytes) throw new Error('模型资源超过固定长度');
        chunks.push(value);
        if (performance.now() - last > 200) {
          progress(id, { text: `正在下载 SenseVoice：${entry.file} · ${(loaded / 1048576).toFixed(1)}/${(entry.bytes / 1048576).toFixed(1)} MiB`, file: entry.file, loaded, total: entry.bytes });
          last = performance.now();
        }
      }
    } catch (error) { try { await reader.cancel(); } catch {} throw error; }
    bytes = new Uint8Array(loaded); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  } else bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== entry.bytes || await sha256(bytes) !== entry.sha256) throw new Error('模型资源 SHA-256 校验失败：' + entry.file);
  if (cache) { try { await cache.put(url, new Response(bytes)); } catch {} }
  progress(id, { text: 'SenseVoice 资源校验完成：' + entry.file, file: entry.file, loaded: bytes.length, total: entry.bytes, cached: false });
  return bytes;
}
async function load(id) {
  if (recognizer) return null;
  if (loading) return loading;
  loading = (async () => {
    if (typeof WebAssembly !== 'object') throw new Error('当前浏览器不支持本机 WebAssembly 识别');
    const manifestBytes = await verifiedFile({ file: 'manifest.json', bytes: 1928, sha256: MANIFEST_SHA256 }, id);
    let manifest; try { manifest = JSON.parse(new TextDecoder().decode(manifestBytes)); } catch { throw new Error('模型资源清单无法读取'); }
    if (manifest.version !== VERSION || manifest.runtime?.threads !== 1 || manifest.runtime?.language !== 'zh' || manifest.runtime?.useInverseTextNormalization !== true) throw new Error('模型运行配置不匹配');
    const files = manifest.files;
    if (!files || Object.keys(files).sort().join(',') !== 'api,data,runtime,wasm') throw new Error('模型资源清单不完整');
    for (const entry of Object.values(files)) validateEntry(entry);
    const runtimeBytes = await verifiedFile(files.runtime, id);
    const wasmBytes = await verifiedFile(files.wasm, id);
    const apiBytes = await verifiedFile(files.api, id);
    const parts = files.data.parts;
    if (!Array.isArray(parts) || !parts.length || parts.length > 64 || parts.reduce((sum, part) => sum + part.bytes, 0) !== files.data.bytes) throw new Error('模型分片清单不完整');
    let dataBytes = new Uint8Array(files.data.bytes), offset = 0;
    for (const part of parts) { const bytes = await verifiedFile(part, id); dataBytes.set(bytes, offset); offset += bytes.length; }
    if (offset !== files.data.bytes || await sha256(dataBytes) !== files.data.sha256) throw new Error('SenseVoice 整包 SHA-256 校验失败');
    progress(id, { text: '下载与校验完成，正在启动本机 SenseVoice 中文识别', loaded: offset, total: files.data.bytes });
    const blobs = [];
    function execute(bytes) {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' })); blobs.push(url); importScripts(url);
    }
    try {
      await new Promise((resolve, reject) => {
        self.Module = {
          noInitialRun: true,
          wasmBinary: wasmBytes,
          print: () => {}, printErr: () => {},
          getPreloadedPackage: (_name, size) => {
            if (size !== files.data.bytes || !dataBytes) throw new Error('模型预加载包不匹配');
            const buffer = dataBytes.buffer; dataBytes = null; return buffer;
          },
          locateFile: file => {
            if (file !== files.data.file && file !== files.wasm.file) throw new Error('运行时请求未登记资源');
            return new URL(file, ASSET_BASE).href;
          },
          onRuntimeInitialized: resolve,
          onAbort: () => reject(new Error('SenseVoice 本机运行时无法启动或内存不足')),
        };
        // All runtime assets already passed pinned hashes. Any unexpected lazy
        // network read by upstream code fails closed; recorded audio is never sent.
        self.fetch = () => Promise.reject(new Error('未登记的运行时网络请求已阻止'));
        self.XMLHttpRequest = class { constructor() { throw new Error('未登记的运行时网络请求已阻止'); } };
        execute(runtimeBytes);
      });
      execute(apiBytes);
      if (typeof OfflineRecognizer !== 'function') throw new Error('SenseVoice 本机识别接口缺失');
      recognizer = new OfflineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          tokens: './tokens.txt', numThreads: 1, provider: 'cpu', debug: 0,
          senseVoice: { model: './sense-voice.onnx', language: 'zh', useInverseTextNormalization: 1 },
        },
        decodingMethod: 'greedy_search',
      }, self.Module);
      if (!recognizer.handle) throw new Error('SenseVoice 模型初始化失败');
      // The dedicated Worker owns its FS, recognizer and heap until .dispose().
      // Per-inference streams below are freed immediately. No shared main-page WASM.
      self.Module.wasmBinary = null;
      progress(id, { text: 'SenseVoice 中文模型已就绪' });
      return null;
    } finally { for (const url of blobs) URL.revokeObjectURL(url); }
  })();
  return loading;
}
function infer(data) {
  if (!recognizer) throw new Error('SenseVoice 模型尚未就绪');
  if (!(data instanceof Float32Array) || data.length === 0 || data.length > 30 * 16000) throw new Error('invalid prepared PCM segment');
  for (const sample of data) if (!Number.isFinite(sample)) throw new Error('invalid PCM sample');
  const stream = recognizer.createStream();
  if (!stream?.handle) throw new Error('SenseVoice 识别流创建失败');
  try {
    stream.acceptWaveform(16000, data);
    recognizer.decode(stream);
    const result = recognizer.getResult(stream);
    if (typeof result?.text !== 'string') throw new Error('SenseVoice 返回格式无效');
    return { text: result.text.replace(/<\|[^|]+\|>/g, '').trim() };
  } finally { stream.free(); }
}
self.addEventListener('message', event => {
  const message = event.data;
  if (!message || !Number.isSafeInteger(message.id) || message.id <= 0) return;
  operations = operations.then(async () => {
    try {
      let result;
      if (message.type === 'load') result = await load(message.id);
      else if (message.type === 'infer') result = infer(message.data);
      else throw new Error('不支持的本机识别请求');
      self.postMessage({ id: message.id, type: 'result', result });
    } catch (error) { self.postMessage({ id: message.id, type: 'error', error: messageError(error) }); }
  });
});
