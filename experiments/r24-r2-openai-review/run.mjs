import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const endpoint = 'https://api.openai.com/v1/chat/completions';
const model = 'gpt-4o-mini';
const repository = 'lijianjun004-star/tcl-v43-preview';
const ref = 'refs/heads/qa/r24-r2-openai-evaluation';
const schemaUrl = new URL('./evaluation-schema.mjs', import.meta.url);
const fixedUrl = new URL('./fixed-r2.json', import.meta.url);
const schemaSha256 = 'e08ce2888e6ce5cf544caa6da8a9a121307557a5a4c29bc80d0a80ab1be342ec';
const fixedSha256 = '6281ecedc4f4ad171d63c5b16de521dfaf78f2beb8be13c8231b82357beba5d7';
const labels = ['A', 'B', 'C'];

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const isoNow = () => new Date().toISOString();
const jsonFile = (path, value, options) => writeFile(path, JSON.stringify(value, null, 2) + '\n', options);

async function checkedFile(url, expected) {
  const bytes = await readFile(url);
  if (digest(bytes) !== expected) throw new Error('Fixed source digest mismatch');
  return bytes;
}

async function saveRequest(path, body) {
  try {
    await writeFile(path, body, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (await readFile(path, 'utf8') !== body) throw new Error('Existing request differs from fixed input');
  }
}

function scrub(text, token) {
  return text.replaceAll(token, '[REDACTED]')
    .replace(/\bsk[-_][a-zA-Z0-9._*…-]+/gi, '[REDACTED]');
}

function inspectRaw(bytes, token, httpStatus) {
  const text = bytes.toString('utf8');
  const sanitized = scrub(text, token);
  let envelope;
  try {
    envelope = JSON.parse(sanitized);
  } catch {
    return { raw: JSON.stringify({ error: { code: 'NON_JSON_RESPONSE', message: 'Response body withheld' } }),
      redacted: true, envelope: null };
  }
  if (!envelope || Array.isArray(envelope) || typeof envelope !== 'object') {
    return { raw: JSON.stringify({ error: { code: 'INVALID_ENVELOPE', message: 'Response body withheld' } }),
      redacted: true, envelope: null };
  }
  // A 401 can repeat masked fragments of a key; never store its free-form error message.
  if (httpStatus === 401 || envelope.error?.code === 'invalid_api_key') {
    return { raw: JSON.stringify({error: {code: 'AUTHENTICATION_FAILED',
      providerCode: envelope.error?.code === 'invalid_api_key' ? 'invalid_api_key' : null,
      message: 'Authentication response withheld to protect the credential'}}), redacted: true, envelope: null };
  }
  if (sanitized !== text || scrub(JSON.stringify(envelope), token) !== JSON.stringify(envelope)) {
    return { raw: JSON.stringify({ error: { code: 'CREDENTIAL_REDACTED',
      message: 'Response body withheld to protect the credential' } }), redacted: true, envelope: null };
  }
  return { raw: bytes, redacted: false, envelope };
}

function verifyLiveContext() {
  const env = process.env;
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== repository ||
      env.GITHUB_REF !== ref || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      env.GITHUB_RUN_ATTEMPT !== '1' || !/^\d+$/.test(env.GITHUB_RUN_ID || '') ||
      !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA || '')) {
    throw new Error('Live execution requires the designated first-attempt GitHub workflow dispatch');
  }
  if (!env.BATCH_API_TOKEN || env.BATCH_API_TOKEN.trim() !== env.BATCH_API_TOKEN) {
    throw new Error('Official project credential is missing or invalid');
  }
}

async function main() {
  const [mode, directory, ...extra] = process.argv.slice(2);
  if (!['--prepare', '--live'].includes(mode) || !directory || extra.length) {
    throw new Error('Usage: node run.mjs --prepare|--live OUTPUT_DIR');
  }
  if (mode === '--live') verifyLiveContext();
  const root = resolve(directory);
  const source = JSON.parse(await checkedFile(fixedUrl, fixedSha256));
  await checkedFile(schemaUrl, schemaSha256);
  const { evaluationResponseFormat, evaluationInstructions, validateEvaluationInput, validateEvaluationResult } =
    await import(schemaUrl.href);

  const requests = new Map();
  await mkdir(join(root, 'requests'), { recursive: true });
  for (const label of labels) {
    const input = validateEvaluationInput([{question: source.question, referenceAnswer: source.answer,
      keyPoints: source.points, answerText: source.samples[label]}]);
    const prompt = JSON.stringify(input.map((item, questionIndex) => ({ questionIndex, ...item })));
    const body = JSON.stringify({model, stream: false, store: false, response_format: evaluationResponseFormat,
      max_tokens: Math.min(8192, 512 + 650 * input.length),
      messages: [{role: 'system', content: evaluationInstructions}, {role: 'user', content: prompt}]});
    await saveRequest(join(root, 'requests', label + '.json'), body);
    requests.set(label, {body, input});
  }
  if (mode === '--prepare') {
    console.log('Prepared three fixed requests offline.');
    return;
  }

  const env = process.env;
  const token = env.BATCH_API_TOKEN;
  const provenance = {
    provider: 'OpenAI', endpoint, requestedModel: model, startedAt: isoNow(), endedAt: null,
    runUrl: 'https://github.com/' + repository + '/actions/runs/' + env.GITHUB_RUN_ID,
    sourceCommit: env.GITHUB_SHA, sourceRef: ref, sourceSchemaSha256: schemaSha256,
    fixedSha256, runnerSha256: digest(await readFile(new URL(import.meta.url))),
    attempts: 0, retryCount: 0, fallbackCount: 0, nonGetCount: 0, rateLimit: null,
    cleanup: 'Offline API evaluation only; no application data was written.',
  };
  const ledger = join(root, 'provenance.json');
  await jsonFile(ledger, provenance, { flag: 'wx' });
  for (const subdir of ['raw', 'meta']) await mkdir(join(root, subdir), { recursive: true });
  try {
    for (const [label, {body, input}] of requests) {
      const start = performance.now();
      const meta = {startedAt: isoNow(), endedAt: null, elapsedMs: null, httpStatus: null,
        requestId: null, method: 'POST', requestSha256: digest(body), rawRedacted: false,
        rateLimit: {}, outcome: 'network_failure'};
      provenance.attempts++;
      provenance.nonGetCount++;
      await jsonFile(ledger, provenance);
      try {
        const signal = AbortSignal.timeout(60000);
        const response = await fetch(endpoint, {method: 'POST', redirect: 'error', signal,
          headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token}, body});
        meta.httpStatus = response.status;
        const requestId = response.headers.get('x-request-id');
        if (requestId && /^[\w-]{1,150}$/.test(requestId) && scrub(requestId, token) === requestId) {
          meta.requestId = requestId;
        }
        for (const header of ['x-ratelimit-remaining-requests','x-ratelimit-remaining-tokens',
          'x-ratelimit-reset-requests','x-ratelimit-reset-tokens','retry-after']) {
          const value = response.headers.get(header);
          if (value && /^[\ddhm.s -]{1,80}$/.test(value)) meta.rateLimit[header] = value;
        }
        provenance.rateLimit = meta.rateLimit;
        const bytes = Buffer.from(await response.arrayBuffer());
        const { raw, redacted, envelope } = inspectRaw(bytes, token, response.status);
        meta.rawRedacted = redacted;
        if (!redacted) meta.rawSha256 = digest(bytes);
        await writeFile(join(root, 'raw', label + '.json'), raw, {flag: 'wx'});
        if (!response.ok) {
          meta.outcome = 'http_error';
          throw new Error('Provider returned HTTP ' + response.status);
        }
        meta.outcome = 'invalid_response';
        if (redacted || !envelope || envelope.object !== 'chat.completion' ||
            !/^gpt-4o-mini(?:-\d{4}-\d{2}-\d{2})?$/.test(envelope.model) ||
            envelope.choices?.length !== 1 || envelope.choices[0]?.finish_reason !== 'stop' ||
            envelope.choices[0]?.message?.refusal) throw new Error('Unexpected completion envelope');
        try {
          validateEvaluationResult(JSON.parse(envelope.choices[0].message.content), input);
          meta.outcome = 'valid_response';
        } catch {
          // A grading-format problem belongs to this answer. Keep the original reply
          // and continue with the next independent sample without retrying this one.
          meta.outcome = 'invalid_evaluation';
        }
      } catch {
        throw new Error(label + ' stopped: ' + meta.outcome + ', HTTP ' + (meta.httpStatus ?? 'unavailable'));
      } finally {
        meta.endedAt = isoNow();
        meta.elapsedMs = Math.round(performance.now() - start);
        await jsonFile(join(root, 'meta', label + '.json'), meta, {flag: 'wx'});
      }
    }
  } finally {
    provenance.endedAt = isoNow();
    await jsonFile(ledger, provenance);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
