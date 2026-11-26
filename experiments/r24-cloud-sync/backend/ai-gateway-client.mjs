import {setTimeout as delay} from 'node:timers/promises';
import {readAssignmentDraftResponse} from '../overlay/assignment-drafts.mjs';

import {evaluationInstructions, evaluationResponseFormat, validateEvaluationInput, validateEvaluationResult} from './evaluation-schema.mjs';

const transientStatuses = new Set([429, 502, 503, 504]);
const defaultModel = 'gpt-4o-mini';
const maxResponseBytes = 256 * 1024;
const maxPromptBytes = 128 * 1024;
const jsonInstructions = '仅输出一个 JSON 对象。questions 为非空数组，每项须含 question（非空顾客弹幕字符串）、answer（非空参考话术字符串）、keyPoints（非空评分要点字符串数组）。不要额外添加字段。';

function endpointFor(value) {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value) || /[\s\\?#@]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password ||
        /(?:^|\.)openai\.com$/iu.test(url.hostname.replace(/\.+$/u, ''))) return null;
    // Accept the origin, versioned base and full route. Never retain another path.
    if (!/^\/(?:v1\/)*(?:v1|chat\/completions)?\/?$/u.test(url.pathname)) return null;
    return new URL('/v1/chat/completions', url.origin).href;
  } catch {
    return null;
  }
}

function safeModel(value, token) {
  if (typeof value !== 'string' || !/^[a-z\d][a-z\d./:_-]{0,119}$/iu.test(value) ||
      value.includes('://') || /^(?:sk[-_]|bearer)/iu.test(value)) return null;
  if (typeof token === 'string' && token && (value.includes(token) || token.includes(value))) return null;
  return value;
}

class ClientFailure extends Error {
  constructor(code, meta) {
    super(code);
    Object.assign(this, {code, errorCode: code, ...meta});
  }
}

function publicUsage(value) {
  const usage = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    if (Number.isSafeInteger(value?.[key]) && value[key] >= 0) usage[key] = value[key];
  }
  return Object.keys(usage).length ? usage : null;
}

async function readEnvelope(response, meta) {
  if (!response.body || Number(response.headers.get('content-length')) > maxResponseBytes) {
    void response.body?.cancel().catch(() => {});
    throw new ClientFailure('INVALID_AI_JSON', meta);
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > maxResponseBytes) throw new ClientFailure('INVALID_AI_JSON', meta);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks, bytes)));
  } catch {
    throw new ClientFailure('INVALID_AI_JSON', meta);
  }
}

function completionText(envelope, meta, strict, token) {
  if (envelope?.error || !Array.isArray(envelope?.choices) || (strict && envelope.choices.length !== 1)) {
    throw new ClientFailure('INVALID_AI_JSON', meta);
  }
  const choice = envelope.choices[0];
  const message = choice?.message;
  if (((strict || choice?.finish_reason !== undefined) && choice?.finish_reason !== 'stop') ||
      ((strict || message?.role !== undefined) && message?.role !== 'assistant') ||
      message?.refusal || message?.tool_calls || message?.function_call ||
      typeof message?.content !== 'string' || !message.content.trim() || message.content.includes(token)) {
    throw new ClientFailure('INVALID_AI_JSON', meta);
  }
  return message.content;
}

function readDraft(content) {
  const questions = readAssignmentDraftResponse(content);
  if (questions.some(row => !row.keyPoints.length)) throw new Error('INVALID_AI_JSON');
  return {questions};
}

function transportFailure(error, aborted) {
  const codes = [error?.code, error?.cause?.code];
  if (aborted || error?.name === 'AbortError' || error?.cause?.name === 'AbortError' || codes.includes('ETIMEDOUT')) {
    return 'GATEWAY_TIMEOUT';
  }
  if (codes.includes('ECONNRESET')) return 'GATEWAY_NETWORK_RESET';
  return 'GATEWAY_NETWORK_ERROR';
}

// Bound quota reservation, retry waits and HTTP/body consumption against one operation deadline.
async function withDeadline(work, milliseconds, meta, onTimeout) {
  if (milliseconds <= 0) throw new ClientFailure('GATEWAY_TIMEOUT', meta);
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new ClientFailure('GATEWAY_TIMEOUT', meta));
    }, milliseconds);
  });
  try {
    return await Promise.race([work(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function createAiGatewayClient({env = process.env, fetchImpl = fetch, sleep = delay} = {}) {
  const token = env.AI_GATEWAY_TOKEN;
  const url = endpointFor(env.AI_GATEWAY_URL);
  const model = safeModel(env.AI_GATEWAY_MODEL ?? defaultModel, token);
  const rawTimeout = env.AI_GATEWAY_TIMEOUT_MS ?? '30000';
  const timeout = Number(rawTimeout);
  const missing = [env.AI_GATEWAY_URL, token].some(value => value == null || (typeof value === 'string' && !value.trim()));
  const valid = url && model && typeof token === 'string' && /^[\x21-\x7e]{1,8192}$/u.test(token) &&
    !/^sk[-_]/iu.test(token) && /^\d+$/u.test(rawTimeout) && timeout >= 1 && timeout <= 30000;

  async function attempt(body, meta, parse, scoring, budget, retryCount) {
    const controller = new AbortController();
    async function request() {
      // A retry becomes an attempt only when its HTTP request is dispatched.
      meta.retryCount = retryCount;
      const response = await fetchImpl(url, {
        method: 'POST', redirect: 'error', signal: controller.signal, body,
        headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
      });
      meta.httpStatus = response.status;
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        throw new ClientFailure('GATEWAY_HTTP_' + response.status, meta);
      }
      const envelope = await readEnvelope(response, meta);
      meta.usage = publicUsage(envelope?.usage);
      const content = completionText(envelope, meta, scoring, token);
      try {
        const result = parse(content);
        if (JSON.stringify(result).includes(token)) throw new Error('INVALID_AI_JSON');
        return {...result, ...meta};
      } catch {
        throw new ClientFailure('INVALID_AI_JSON', meta);
      }
    }
    try {
      return await withDeadline(request, Math.min(timeout, budget), meta, () => controller.abort());
    } catch (error) {
      if (error instanceof ClientFailure) throw error;
      throw new ClientFailure(transportFailure(error, controller.signal.aborted), meta);
    } finally {
      controller.abort();
    }
  }

  async function complete(prompt, {beforeFetch, parse, scoring, maxTokens}) {
    const initial = {model, httpStatus: null, retryCount: 0, usage: null};
    if (missing) throw new ClientFailure('GATEWAY_CONFIG_MISSING', initial);
    if (!valid) throw new ClientFailure('GATEWAY_CONFIG_INVALID', initial);
    const operation = scoring ? 'AI_EVALUATION' : 'AI_DRAFT';
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > maxPromptBytes ||
        prompt.includes(token)) throw new ClientFailure(operation + '_INPUT_INVALID', initial);
    const body = JSON.stringify({
      model, stream: false, store: false, response_format: scoring ? evaluationResponseFormat : {type: 'json_object'},
      max_tokens: maxTokens,
      messages: [{role: 'system', content: scoring ? evaluationInstructions : jsonInstructions}, {role: 'user', content: prompt}],
    });
    const end = performance.now() + 2 * timeout + 1500;
    for (let retryCount = 0; ; retryCount++) {
      const meta = {...initial};
      if (beforeFetch) {
        try {
          await withDeadline(beforeFetch, end - performance.now(), meta);
        } catch (error) {
          if (error instanceof ClientFailure) throw error;
          const code = error?.code === operation + '_LIMIT' ? error.code : operation + '_QUOTA_UNAVAILABLE';
          throw new ClientFailure(code, meta);
        }
      }
      try {
        return await attempt(body, meta, parse, scoring, end - performance.now(), retryCount);
      } catch (error) {
        const transient = transientStatuses.has(error.httpStatus) || error.code === 'GATEWAY_TIMEOUT' ||
          (!scoring && error.code === 'GATEWAY_NETWORK_RESET');
        if (retryCount || !transient) throw error;
        await withDeadline(() => sleep(1500), end - performance.now(), meta);
      }
    }
  }

  function generate(prompt, {beforeFetch} = {}) {
    return complete(prompt, {beforeFetch, parse: readDraft, scoring: false, maxTokens: 4096});
  }
  async function evaluate(items, {beforeFetch} = {}) {
    const input = validateEvaluationInput(items);
    const prompt = JSON.stringify(input.map((item, questionIndex) => ({questionIndex, ...item})));
    return complete(prompt, {
      beforeFetch, scoring: true, maxTokens: Math.min(8192, 512 + 650 * input.length),
      parse: content => validateEvaluationResult(JSON.parse(content), input),
    });
  }
  return {model, generate, evaluate};
}
