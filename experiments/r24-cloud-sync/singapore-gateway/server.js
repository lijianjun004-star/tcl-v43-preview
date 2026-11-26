'use strict';

const http = require('node:http');
const {createHash, timingSafeEqual} = require('node:crypto');

const CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const CHAT_PATH = '/v1/chat/completions';
const MAX_BYTES = 256 * 1024;
const models = new Set(['gpt-4o-mini', 'gpt-4o']);
const fields = new Set(['model', 'messages', 'stream', 'store', 'response_format', 'max_tokens', 'max_completion_tokens', 'temperature']);

function json(res, status, payload, extraHeaders = {}) {
  if (res.destroyed) return;
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders});
  res.end(JSON.stringify(payload));
}

function digest(value) {
  return createHash('sha256').update(value).digest();
}

function parseJson(chunks, length) {
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks, length)));
}

async function requestBody(req) {
  if (Number(req.headers['content-length']) > MAX_BYTES) throw new RangeError();
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({destroyOnReturn: false})) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new RangeError();
    chunks.push(chunk);
  }
  return parseJson(chunks, size);
}

function validCompletion(body) {
  if (!body || !models.has(body.model) || !Object.keys(body).every(key => fields.has(key)) ||
      (body.stream !== undefined && body.stream !== false) || (body.store !== undefined && body.store !== false)) return false;
  if (!Array.isArray(body.messages) || !body.messages.length || !body.messages.every(m =>
    m && ['system','user','assistant'].includes(m.role) && typeof m.content === 'string' && Object.keys(m).every(k => k === 'role' || k === 'content'))) return false;
  const limits = ['max_tokens', 'max_completion_tokens'].filter(k => Object.hasOwn(body, k));
  return limits.length <= 1 && limits.every(k => Number.isInteger(body[k]) && body[k] >= 1 && body[k] <= 8192);
}

function tokenUsage(value) {
  const usage = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    if (Number.isSafeInteger(value?.[key]) && value[key] >= 0) usage[key] = value[key];
  }
  return Object.keys(usage).length ? usage : null;
}

function rejectCredentials(value, secrets) {
  // Walk decoded JSON values and keys as well as checking the literal completion.
  // In structured replies the completion string contains a second JSON encoding.
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'string') {
      if (secrets.some(secret => item.includes(secret))) throw new TypeError();
    } else if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) pending.push(key, child);
    }
  }
}

function projectChoice(choice, structured, secrets) {
  const reason = choice?.finish_reason;
  const message = choice?.message;
  if (message?.role !== 'assistant' ||
      !['stop', 'length', 'content_filter', 'tool_calls', 'function_call'].includes(reason)) throw new TypeError();
  if (reason !== 'stop' || message.refusal || message.tool_calls || message.function_call) {
    // Retain the failure signal for clients without exposing a partial completion, tool arguments or refusal text.
    const finish = reason !== 'stop' ? reason : message.refusal ? 'content_filter' : 'tool_calls';
    return {finish_reason: finish, message: {role: 'assistant', content: null}};
  }
  const content = message.content;
  if (typeof content !== 'string' || !content.trim()) throw new TypeError();
  rejectCredentials(content, secrets);
  if (structured) {
    const result = JSON.parse(content);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new TypeError();
    rejectCredentials(result, secrets);
  }
  return {finish_reason: 'stop', message: {role: 'assistant', content}};
}

async function completionEnvelope(response, request, secrets) {
  if (!response.body || Number(response.headers.get('content-length')) > MAX_BYTES) throw new RangeError();
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new RangeError();
    chunks.push(chunk);
  }
  const body = parseJson(chunks, size);
  if (body?.error || !Array.isArray(body?.choices) || body.choices.length !== 1) throw new TypeError();
  const structured = ['json_object', 'json_schema'].includes(request.response_format?.type);
  const choice = projectChoice(body.choices[0], structured, secrets);
  const envelope = {choices: [choice], usage: tokenUsage(body.usage)};
  if (body.model !== undefined) {
    if (typeof body.model !== 'string' ||
        !/^gpt-4o(?:-mini)?(?:-[0-9]{4}-[0-9]{2}-[0-9]{2})?$/.test(body.model)) throw new TypeError();
    envelope.model = body.model;
  }
  rejectCredentials(envelope, secrets);
  return envelope;
}

function createGateway({providerKey, token, fetchImpl = fetch, timeoutMs = 28_000}) {
  const haveKey = typeof providerKey === 'string' && /^[\x21-\x7e]+$/.test(providerKey);
  const tokenDigest = typeof token === 'string' && /^[\x21-\x7e]{32,512}$/.test(token) &&
    !/^sk[-_]/i.test(token) && token !== providerKey ? digest('Bearer ' + token) : null;

  return http.createServer({maxHeaderSize: 16 * 1024, requestTimeout: 30_000, headersTimeout: 10_000}, async (req, res) => {
    const allowed = req.url === '/health' ? 'GET' : req.url === CHAT_PATH ? 'POST' : null;
    if (!allowed) return json(res, 404, {error: 'NOT_FOUND'});
    if (req.method !== allowed) return json(res, 405, {error: 'METHOD_NOT_ALLOWED'}, {Allow: allowed});
    if (req.url === '/health') return json(res, 200, {ok: true, configured: Boolean(tokenDigest && haveKey)});

    const auth = req.headersDistinct.authorization;
    if (!tokenDigest || auth?.length !== 1 || !timingSafeEqual(tokenDigest, digest(auth[0]))) {
      return json(res, 401, {error: 'UNAUTHORIZED'});
    }
    if (!haveKey) return json(res, 503, {error: 'GATEWAY_CONFIG_MISSING'});
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      return json(res, 415, {error: 'JSON_REQUIRED'});
    }
    let body;
    try {
      body = await requestBody(req);
    } catch (err) {
      req.resume();
      return err instanceof RangeError ? json(res, 413, {error: 'PAYLOAD_LIMIT'}, {Connection: 'close'}) :
        json(res, 400, {error: 'INVALID_BODY'});
    }
    if (!validCompletion(body)) return json(res, 400, {error: 'INVALID_COMPLETION'});
    body.store = false;
    if (body.max_tokens === undefined && body.max_completion_tokens === undefined) body.max_completion_tokens = 4096;

    const controller = new AbortController();
    const abort = () => controller.abort();
    const deadline = setTimeout(abort, timeoutMs);
    res.once('close', abort);
    try {
      const upstream = await fetchImpl(CHAT_ENDPOINT, {method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + providerKey}, body: JSON.stringify(body)});
      if (upstream.status !== 200) {
        const status = upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502;
        return json(res, status, {error: 'UPSTREAM_REJECTED'});
      }
      return json(res, 200, await completionEnvelope(upstream, body, [providerKey, token]));
    } catch {
      return controller.signal.aborted ? json(res, 504, {error: 'UPSTREAM_TIMEOUT'}) : json(res, 502, {error: 'UPSTREAM_FAILED'});
    } finally {
      clearTimeout(deadline);
      res.off('close', abort);
      abort();
    }
  });
}

module.exports = {createGateway};

if (require.main === module) {
  const server = createGateway({
    providerKey: process.env.OPENAI_API_KEY,
    token: process.env.AI_GATEWAY_TOKEN ?? process.env.GATEWAY_TOKEN,
  });
  server.listen(Number(process.env.PORT || 9000), '0.0.0.0');
}
