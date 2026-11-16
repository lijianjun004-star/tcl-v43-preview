// R2.5: timed-out Whisper Worker is terminated and no longer locks Vosk. Mocked Worker; no model, no speech.
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
const ROOT = process.env.R25_ROOT || new URL('../tcl-v352-asr-r25-qa/', import.meta.url).href;
const { createLocalWhisper } = await import(new URL('whisper-bridge.mjs', ROOT.endsWith('/') ? ROOT : ROOT + '/').href);
const audio = () => ({ data: new Float32Array(16000).fill(.1), sampleRate: 16000, duration: 1 });
const originalWorker = globalThis.Worker;
afterEach(() => { if (originalWorker === undefined) delete globalThis.Worker; else globalThis.Worker = originalWorker; });
function installWorker(handle) {
  const instances = [];
  globalThis.Worker = class {
    listeners = new Map();
    constructor(url, options) { this.url = url; this.options = options; this.messages = []; instances.push(this); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    postMessage(message, transfer) { const m = structuredClone(message, { transfer }); this.messages.push(m); queueMicrotask(() => handle(m, this)); }
    receive(data) { this.listeners.get('message')?.({ data }); }
    terminate() { this.terminated = true; }
  };
  return instances;
}
test('inference timeout: one inference only, Worker terminated, late result ignored, Whisper stays off, Vosk no longer locked', async () => {
  const workers = installWorker((m, w) => { if (m.type !== 'infer') w.receive({ id: m.id, type: 'result', result: null }); });
  const engine = createLocalWhisper({ inferTimeoutMs: 50 });
  const results = await Promise.allSettled([engine.transcribePreparedAudio(audio()), engine.transcribePreparedAudio(audio())]);
  assert.ok(results.every(r => r.status === 'rejected'));
  assert.equal(workers.length, 1);
  assert.equal(workers[0].messages.filter(m => m.type === 'infer').length, 1);
  assert.equal(workers[0].terminated, true, 'timed-out Worker must be terminated');
  const infer = workers[0].messages.find(m => m.type === 'infer');
  workers[0].receive({ id: infer.id, type: 'result', result: { text: 'late' } });
  await assert.rejects(engine.transcribePreparedAudio(audio()), /禁止/);
  assert.equal(workers.length, 1, 'no new Worker after timeout');
  assert.equal(engine.isResourceBusy(), false, 'Vosk fallback must not be blocked');
});
test('load timeout (runtime import hangs): Worker terminated and not busy', async () => {
  const workers = installWorker(() => {});
  const engine = createLocalWhisper({ loadTimeoutMs: 60 });
  await assert.rejects(engine.transcribePreparedAudio(audio()), /超时/);
  assert.equal(workers[0].terminated, true);
  assert.equal(engine.isResourceBusy(), false);
  await assert.rejects(engine.transcribePreparedAudio(audio()), /停用本页 Whisper/);
  assert.equal(workers.length, 1);
});
test('page-level injected pipeline cannot be terminated, so it keeps the fail-closed lock', async () => {
  const engine = createLocalWhisper({ inferTimeoutMs: 40, pipelineFactory: async () => () => new Promise(() => {}) });
  await assert.rejects(engine.transcribePreparedAudio(audio()), /超时/);
  assert.equal(engine.isResourceBusy(), true);
});
