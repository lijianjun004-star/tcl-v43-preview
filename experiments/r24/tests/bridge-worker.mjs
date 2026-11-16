import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { createLocalWhisper, WHISPER_REVISIONS } from '../tcl-v352-asr-r24-qa/whisper-bridge.mjs';

const audio = () => ({ data: new Float32Array(16000).fill(.1), sampleRate: 16000, duration: 1 });
const originalWorker = globalThis.Worker;
afterEach(() => { if (originalWorker === undefined) delete globalThis.Worker; else globalThis.Worker = originalWorker; });

function installWorker(handle) {
  const instances = [];
  globalThis.Worker = class {
    listeners = new Map();
    constructor(url, options) { this.url = url; this.options = options; this.messages = []; instances.push(this); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    postMessage(message, transfer) {
      const received = structuredClone(message, { transfer });
      this.messages.push(received);
      queueMicrotask(() => handle(received, this));
    }
    receive(data) { this.listeners.get('message')?.({ data }); }
    terminate() { this.terminated = true; }
  };
  return instances;
}

test('Worker proxy pins model, forwards progress and transfers only a PCM copy', async () => {
  const progress = [];
  const workers = installWorker((message, worker) => {
    if (message.type === 'load') worker.receive({ id: message.id, type: 'progress', info: { status: 'progress', loaded: 12, total: 24, progress: 50 } });
    worker.receive({ id: message.id, type: 'result', result: message.type === 'infer' ? { text: '后台结果' } : null });
  });
  const engine = createLocalWhisper({ onProgress: text => progress.push(text) });
  const prepared = audio();
  assert.equal((await engine.transcribePreparedAudio(prepared)).text, '后台结果');
  assert.equal(prepared.data.length, 16000);
  assert.equal(workers.length, 1);
  assert.match(workers[0].url.pathname, /\/whisper-worker\.mjs$/);
  assert.equal(workers[0].options.type, 'module');
  const load = workers[0].messages.find(m => m.type === 'load');
  assert.equal(load.model, 'onnx-community/whisper-base');
  assert.equal(load.revision, WHISPER_REVISIONS.base);
  assert.equal(load.host, 'https://huggingface.co/');
  assert.ok(progress.some(text => text.includes('12/24') && text.includes('50%')));
  assert.equal(engine.isResourceBusy(), false);
});

test('Worker unavailable fails explicitly, while injected Node pipelines remain supported', async () => {
  delete globalThis.Worker;
  await assert.rejects(createLocalWhisper().transcribePreparedAudio(audio()), /不支持.*Worker/);
  const injected = createLocalWhisper({ pipelineFactory: async () => async () => ({ text: 'test' }) });
  assert.equal((await injected.transcribePreparedAudio(audio())).text, 'test');
});

test('Worker inference timeout never starts a second inference or releases unhealthy lock', async () => {
  const workers = installWorker((message, worker) => {
    if (message.type !== 'infer') worker.receive({ id: message.id, type: 'result', result: null });
  });
  const engine = createLocalWhisper({ inferTimeoutMs: 50 });
  const results = await Promise.allSettled([engine.transcribePreparedAudio(audio()), engine.transcribePreparedAudio(audio())]);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(workers.length, 1);
  assert.equal(workers[0].messages.filter(m => m.type === 'infer').length, 1);
  const infer = workers[0].messages.find(m => m.type === 'infer');
  workers[0].receive({ id: infer.id, type: 'result', result: { text: 'late' } });
  await assert.rejects(engine.transcribePreparedAudio(audio()), /禁止/);
  assert.equal(engine.isResourceBusy(), true);
});

test('Worker error rejects pending inference and cannot fall back to page inference', async () => {
  const workers = installWorker((message, worker) => {
    if (message.type === 'infer') worker.listeners.get('error')({ message: 'worker crashed', preventDefault() {} });
    else worker.receive({ id: message.id, type: 'result', result: null });
  });
  const engine = createLocalWhisper();
  await assert.rejects(engine.transcribePreparedAudio(audio()), /Worker 已停止.*worker crashed/);
  assert.equal(workers[0].terminated, true);
  await assert.rejects(engine.transcribePreparedAudio(audio()), /Worker 已停止/);
  assert.equal(workers.length, 1);
});
