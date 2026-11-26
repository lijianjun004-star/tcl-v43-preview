import {setTimeout as delay} from 'node:timers/promises';
import {readAssignmentDraftResponse} from '../overlay/assignment-drafts.mjs';

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

function readQuestions(envelope, meta) {
  if (envelope?.error || !Array.isArray(envelope?.choices)) throw new ClientFailure('INVALID_AI_JSON', meta);
  const choice = envelope.choices[0];
  const message = choice?.message;
  if ((choice?.finish_reason !== undefined && choice.finish_reason !== 'stop') ||
      (message?.role !== undefined && message.role !== 'assistant') || message?.refusal || message?.tool_calls || message?.function_call) {
    throw new ClientFailure('INVALID_AI_JSON', meta);
  }
  let questions;
  try {
    questions = readAssignmentDraftResponse(message?.content);
  } catch {
    throw new ClientFailure('INVALID_AI_JSON', meta);
  }
  if (questions.some(row => !row.keyPoints.length)) throw new ClientFailure('INVALID_AI_JSON', meta);
  return questions;
}

function transportFailure(error, aborted) {
  const codes = [error?.code, error?.cause?.code];
  if (aborted || error?.name === 'AbortError' || error?.cause?.name === 'AbortError' || codes.includes('ETIMEDOUT')) {
    return 'GATEWAY_TIMEOUT';
  }
  if (codes.includes('ECONNRESET')) return 'GATEWAY_NETWORK_RESET';
  return 'GATEWAY_NETWORK_ERROR';
}

export function createAiGatewayClient({env = process.env, fetchImpl = fetch, sleep = delay} = {}) {
  const token = env.AI_GATEWAY_TOKEN;
  const url = endpointFor(env.AI_GATEWAY_URL);
  const model = safeModel(env.AI_GATEWAY_MODEL ?? defaultModel, token);
  const rawTimeout = env.AI_GATEWAY_TIMEOUT_MS ?? '60000';
  const timeout = Number(rawTimeout);
  const missing = [env.AI_GATEWAY_URL, token].some(value => value == null || (typeof value === 'string' && !value.trim()));
  const valid = url && model && typeof token === 'string' && /^[\x21-\x7e]{1,8192}$/u.test(token) &&
    !/^sk[-_]/iu.test(token) && /^\d+$/u.test(rawTimeout) && timeout >= 1 && timeout <= 60000;

  async function attempt(body, meta) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ClientFailure('GATEWAY_TIMEOUT', meta));
      }, timeout);
    });
    async function request() {
      const response = await fetchImpl(url, {
        method: 'POST', redirect: 'error', signal: controller.signal, body,
        headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
      });
      meta.httpStatus = response.status;
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new ClientFailure('GATEWAY_HTTP_' + response.status, meta);
      }
      const envelope = await readEnvelope(response, meta);
      meta.usage = publicUsage(envelope?.usage);
      return {questions: readQuestions(envelope, meta), ...meta};
    }
    try {
      return await Promise.race([request(), deadline]);
    } catch (error) {
      if (error instanceof ClientFailure) throw error;
      throw new ClientFailure(transportFailure(error, controller.signal.aborted), meta);
    } finally {
      clearTimeout(timer);
    }
  }

  async function generate(prompt, {beforeFetch} = {}) {
    const initial = {model, httpStatus: null, retryCount: 0, usage: null};
    if (missing) throw new ClientFailure('GATEWAY_CONFIG_MISSING', initial);
    if (!valid) throw new ClientFailure('GATEWAY_CONFIG_INVALID', initial);
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > maxPromptBytes) {
      throw new ClientFailure('AI_DRAFT_INPUT_INVALID', initial);
    }
    const body = JSON.stringify({
      model, stream: false, response_format: {type: 'json_object'}, max_tokens: 4096,
      messages: [{role: 'system', content: jsonInstructions}, {role: 'user', content: prompt}],
    });
    let retryCount = 0;
    for (;;) {
      const meta = {...initial, retryCount};
      if (beforeFetch) {
        try {
          await beforeFetch();
        } catch (error) {
          const code = error?.code === 'AI_DRAFT_LIMIT' ? 'AI_DRAFT_LIMIT' : 'AI_DRAFT_QUOTA_UNAVAILABLE';
          throw new ClientFailure(code, {...meta, retryCount: 0});
        }
      }
      try {
        return await attempt(body, meta);
      } catch (error) {
        const transient = transientStatuses.has(error.httpStatus) ||
          error.code === 'GATEWAY_TIMEOUT' || error.code === 'GATEWAY_NETWORK_RESET';
        if (meta.retryCount || !transient) throw error;
        await sleep(1500);
        retryCount = 1;
      }
    }
  }
  return {model, generate};
}
