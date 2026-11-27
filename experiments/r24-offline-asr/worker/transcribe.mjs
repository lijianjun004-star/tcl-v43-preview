import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const endpoint = 'https://api.openai.com/v1/audio/transcriptions';
const model = 'gpt-transcribe';
const language = 'zh';
const maxBytes = 512 * 1024;
const formats = {
  wav: 'audio/wav', mp3: 'audio/mpeg', mpeg: 'audio/mpeg', mpga: 'audio/mpeg',
  m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', flac: 'audio/flac', ogg: 'audio/ogg',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const now = () => new Date().toISOString();
const jsonBytes = value => JSON.stringify(value, null, 2) + '\n';
const saveJson = (path, value, flag = 'wx') => writeFile(path, jsonBytes(value), {flag, mode: 0o600});
const fail = code => { throw new Error(code); };

function audioSignature(data, ext) {
  const begins = (text, offset = 0) => data.subarray(offset, offset + text.length).equals(Buffer.from(text, 'ascii'));
  switch (ext) {
    case 'wav': return data.length > 44 && begins('RIFF') && begins('WAVE', 8);
    case 'm4a':
    case 'mp4': return data.length >= 16 && begins('ftyp', 4);
    case 'mp3':
    case 'mpga':
    case 'mpeg': return data.length >= 8 && (begins('ID3') || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0));
    case 'webm': return data.length > 16 && data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
      data.subarray(0, 1024).includes(Buffer.from('webm'));
    case 'flac': return data.length > 42 && begins('fLaC');
    case 'ogg': return data.length > 27 && begins('OggS');
    default: return false;
  }
}

async function loadSamples(path) {
  const {samples} = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(samples) || !samples.length) fail('EMPTY_MANIFEST');
  const seenIds = new Set();
  const seenFiles = new Set();
  const loaded = [];
  for (const row of samples) {
    const {id, file, sha256: expected} = row ?? {};
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id) || seenIds.has(id.toLowerCase()) ||
        typeof file !== 'string' || !/^[^/\\\x00-\x1f\x7f]+\.[A-Za-z0-9]+$/u.test(file) ||
        file.startsWith('.') || seenFiles.has(file) || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))
      fail('INVALID_SAMPLE_MANIFEST');
    seenIds.add(id.toLowerCase());
    seenFiles.add(file);
    const ext = extname(file).slice(1).toLowerCase();
    if (!Object.hasOwn(formats, ext)) fail('UNSUPPORTED_AUDIO_FORMAT');
    const handle = await open(join(dirname(path), file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size <= 0 || info.size > maxBytes) fail('INVALID_AUDIO_SIZE');
      const data = Buffer.alloc(info.size + 1);
      let total = 0;
      while (total < data.length) {
        const {bytesRead} = await handle.read(data, total, data.length - total, total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      const bytes = data.subarray(0, total);
      if (total !== info.size || sha256(bytes) !== expected) fail('AUDIO_HASH_MISMATCH');
      if (!audioSignature(bytes, ext)) fail('AUDIO_FORMAT_MISMATCH');
      loaded.push({id, ext, size: total, sha256: expected, bytes});
    } finally {
      await handle.close();
    }
  }
  return loaded;
}

function usageFrom(value) {
  if (!value || typeof value !== 'object') return null;
  const usage = {};
  if (['tokens', 'duration'].includes(value.type)) usage.type = value.type;
  for (const k of ['input_tokens', 'output_tokens', 'total_tokens']) {
    if (Number.isSafeInteger(value[k]) && value[k] >= 0) usage[k] = value[k];
  }
  if (Number.isFinite(value.seconds) && value.seconds >= 0) usage.seconds = value.seconds;
  if (value.input_token_details) {
    const details = {};
    for (const k of ['text_tokens', 'audio_tokens']) {
      const n = value.input_token_details[k];
      if (Number.isSafeInteger(n) && n >= 0) details[k] = n;
    }
    if (Object.keys(details).length) usage.input_token_details = details;
  }
  return Object.keys(usage).length ? usage : null;
}

function safeField(value, token) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,119}$/i.test(value) &&
    !value.includes(token) && !/sk[-_]/i.test(value) ? value : null;
}

async function decodeResponse(response) {
  const chunks = [];
  let size = 0;
  if (!response.body) fail('NO_RESPONSE_BODY');
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 256 * 1024) fail('RESPONSE_TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function withPlan(output, plan) {
  const path = join(output, 'preflight.json');
  try {
    await saveJson(path, plan);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    if (await readFile(path, 'utf8') !== jsonBytes(plan)) fail('EXISTING_PLAN_MISMATCH');
  }
}

export async function run({mode, manifest, output, token, fetchImpl = fetch}) {
  if (!['--prepare', '--live'].includes(mode) || !manifest || !output) fail('INVALID_ARGUMENTS');
  if (mode === '--live' && (typeof token !== 'string' || !token.trim() || token !== token.trim()))
    fail('MISSING_OPENAI_CREDENTIAL');
  const samples = await loadSamples(resolve(manifest));
  const root = resolve(output);
  await mkdir(root, {recursive: true, mode: 0o700});
  // Input and output must be separate so uploading the evidence folder cannot include a source recording.
  const inputDir = dirname(resolve(manifest));
  if (root === inputDir || inputDir.startsWith(root + '/') || root === '/') fail('OUTPUT_CONTAINS_INPUT');
  const plan = {model, language, endpoint, responseFormat: 'json', maxBytes,
    samples: samples.map(({id, ext, size, sha256}) => ({id, ext, size, sha256}))};
  await withPlan(root, plan);
  if (mode === '--prepare') return;
  const ledger = {startedAt: now(), endedAt: null, endpoint, model, language,
    attempts: 0, retryCount: 0, fallbackCount: 0, outcome: 'running'};
  const journal = join(root, 'provenance.json');
  await saveJson(journal, ledger);
  try {
    await mkdir(join(root, 'transcripts'), {mode: 0o700});
    await mkdir(join(root, 'meta'), {mode: 0o700});
    for (const {id, ext, sha256: sourceSha, bytes} of samples) {
      const form = new FormData();
      form.set('model', model);
      form.set('language', language);
      form.set('response_format', 'json');
      form.set('file', new Blob([bytes], {type: formats[ext]}), 'clip.' + ext);
      const meta = {id, startedAt: now(), endedAt: null, elapsedMs: null, audioSha256: sourceSha,
        requestedModel: model, returnedModel: null, requestId: null, usage: null, httpStatus: null,
        errorCode: null, errorType: null, transcriptSha256: null, outcome: 'network_failure'};
      const start = performance.now();
      ledger.attempts++;
      await saveJson(journal, ledger, 'w');
      try {
        const resp = await fetchImpl(endpoint, {method: 'POST', body: form, redirect: 'error',
          headers: {Authorization: 'Bearer ' + token}, signal: AbortSignal.timeout(90000)});
        meta.httpStatus = resp.status;
        meta.requestId = safeField(resp.headers.get('x-request-id'), token);
        meta.outcome = resp.ok ? 'invalid_response' : 'http_failure';
        const data = await decodeResponse(resp);
        meta.usage = usageFrom(data?.usage);
        if (!resp.ok) {
          meta.errorCode = safeField(data?.error?.code, token);
          meta.errorType = safeField(data?.error?.type, token);
          fail('PROVIDER_HTTP_ERROR');
        }
        meta.returnedModel = safeField(data?.model, token);
        if (resp.status !== 200 || typeof data?.text !== 'string' || !data.text.trim() ||
            data.text.includes(token) || /\bsk[-_][a-z0-9_*-]{8,}/i.test(data.text)) fail('INVALID_TRANSCRIPT');
        await writeFile(join(root, 'transcripts', id + '.txt'), data.text, {flag:'wx', mode:0o600});
        meta.transcriptSha256 = sha256(data.text);
        meta.outcome = 'transcribed';
      } catch (err) {
        if (['TimeoutError','AbortError'].includes(err.name)) meta.outcome = 'timeout';
        fail('SAMPLE_' + id + '_' + meta.outcome.toUpperCase());
      } finally {
        meta.endedAt = now();
        meta.elapsedMs = Math.round(performance.now() - start);
        await saveJson(join(root, 'meta', id + '.json'), meta);
      }
    }
    ledger.outcome = 'complete';
  } finally {
    if (ledger.outcome === 'running') ledger.outcome = 'stopped';
    ledger.endedAt = now();
    await saveJson(journal, ledger, 'w');
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [mode, manifest, output, ...extra] = process.argv.slice(2);
  if (extra.length || !manifest || !output) {
    console.error('Usage: node transcribe.mjs --prepare|--live INPUT_MANIFEST.json OUTPUT_DIRECTORY');
    process.exitCode = 2;
  } else {
    run({mode, manifest, output, token: process.env.OPENAI_API_KEY}).then(() => {
      console.log(mode === '--prepare' ? 'Offline audio preflight passed.' : 'Transcription evidence saved.');
    }).catch(error => {
      const known = /^[A-Z][A-Z0-9_]{0,100}$/.test(error.message);
      console.error(known ? error.message : 'ASR_WORKER_FAILED');
      process.exitCode = 1;
    });
  }
}
