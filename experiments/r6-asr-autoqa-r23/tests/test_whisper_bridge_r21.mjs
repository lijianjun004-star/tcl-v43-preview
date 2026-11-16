import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAudio, createLocalWhisper } from '../site/tcl-v352-asr-autoqa-r23/whisper-bridge.mjs';

function setupMockWebAudio({ sampleRate = 48000, durationSec = 2, amplitude = 0.2, hangDecode = false } = {}) {
  const totalSamples = Math.floor(sampleRate * durationSec);
  const chData = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    chData[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * amplitude;
  }
  const fakeDecodedBuffer = {
    duration: durationSec,
    sampleRate,
    length: totalSamples,
    numberOfChannels: 1,
    getChannelData: () => chData,
  };
  globalThis.AudioContext = class {
    decodeAudioData() {
      if (hangDecode) return new Promise(() => {});
      return Promise.resolve(fakeDecodedBuffer);
    }
    async close() {}
  };
  globalThis.OfflineAudioContext = class {
    constructor(channels, length, rate) {
      this.channels = channels;
      this.length = length;
      this.rate = rate;
      this.destination = {};
    }
    createBuffer(ch, len, rate) {
      return {
        duration: len / rate,
        sampleRate: rate,
        length: len,
        numberOfChannels: ch,
        _data: new Float32Array(len),
        copyToChannel(src) { this._data.set(src); },
        getChannelData() { return this._data; },
      };
    }
    createBufferSource() {
      const self = this;
      return {
        buffer: null,
        connect() {},
        start() {},
      };
    }
    async startRendering() {
      const out = new Float32Array(this.length);
      for (let i = 0; i < this.length; i++) {
        out[i] = Math.sin((2 * Math.PI * 440 * i) / this.rate) * amplitude;
      }
      return { getChannelData: () => out };
    }
  };
}

test('WB-1: prepareAudio resamples 48kHz audio to 16kHz and computes RMS', async () => {
  setupMockWebAudio({ sampleRate: 48000, durationSec: 2, amplitude: 0.25 });
  const blob = new Blob([new Uint8Array(1024)], { type: 'audio/mp4' });
  const res = await prepareAudio(blob);
  assert.equal(res.sampleRate, 16000);
  assert.equal(res.data.length, 32000);
  assert.equal(res.duration, 2);
  assert.ok(res.rms > 0.1, `Expected RMS > 0.1, got ${res.rms}`);
});

test('WB-2: prepareAudio times out cleanly when WebKit decodeAudioData hangs', async () => {
  setupMockWebAudio({ hangDecode: true });
  const blob = new Blob([new Uint8Array(1024)], { type: 'audio/mp4' });
  await assert.rejects(
    prepareAudio(blob, { decodeTimeoutMs: 60 }),
    /音频解码超时/
  );
});

test('WB-3: createLocalWhisper rejects silence (rms < 0.001) without invoking model pipeline', async () => {
  setupMockWebAudio({ amplitude: 0 });
  let pipelineCalled = 0;
  const engine = createLocalWhisper({
    pipelineFactory: async () => {
      pipelineCalled++;
      return async () => ({ text: '不应被调用' });
    }
  });
  const blob = new Blob([new Uint8Array(512)], { type: 'audio/webm' });
  const out = await engine(blob);
  assert.equal(out.text, '');
  assert.equal(pipelineCalled, 0, 'Silence must short-circuit before loading or running Whisper');
});

test('WB-4: createLocalWhisper passes chunk_length_s=30 and stride_length_s=5 for 60s–120s long audio', async () => {
  setupMockWebAudio({ durationSec: 75, amplitude: 0.2 });
  let capturedOpts = null;
  let capturedLength = 0;
  const engine = createLocalWhisper({
    pipelineFactory: async () => async (pcm, opts) => {
      capturedLength = pcm.length;
      capturedOpts = opts;
      return { text: '长音频完整分段识别结果' };
    }
  });
  const blob = new Blob([new Uint8Array(4096)], { type: 'audio/webm' });
  const out = await engine(blob);
  assert.equal(out.text, '长音频完整分段识别结果');
  assert.equal(capturedLength, 75 * 16000);
  assert.equal(capturedOpts.chunk_length_s, 30);
  assert.equal(capturedOpts.stride_length_s, 5);
  assert.equal(capturedOpts.language, 'chinese');
  assert.equal(capturedOpts.task, 'transcribe');
});

test('WB-5: createLocalWhisper single-flight lock prevents duplicate concurrent pipeline loads', async () => {
  setupMockWebAudio({ durationSec: 1, amplitude: 0.2 });
  let factoryCalls = 0;
  const engine = createLocalWhisper({
    pipelineFactory: async () => {
      factoryCalls++;
      await new Promise(r => setTimeout(r, 40));
      return async () => ({ text: '并发测试通过' });
    }
  });
  const b1 = new Blob([new Uint8Array(512)]);
  const b2 = new Blob([new Uint8Array(512)]);
  const [r1, r2] = await Promise.all([engine(b1), engine(b2)]);
  assert.equal(factoryCalls, 1, 'Pipeline factory must only be initialized once across concurrent calls');
  assert.equal(r1.text, '并发测试通过');
  assert.equal(r2.text, '并发测试通过');
});