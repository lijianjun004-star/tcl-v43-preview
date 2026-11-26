import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {buildAssignmentDraftPrompt} from '../../overlay/assignment-drafts.mjs';
import {createAiGatewayClient} from '../ai-gateway-client.mjs';

const token = randomUUID();
const origin = 'https://draft-gateway.example.test';
const env = {AI_GATEWAY_URL: origin, AI_GATEWAY_TOKEN: token};
const prompt = buildAssignmentDraftPrompt('合成资料：按订单服务范围说明挂装要求。', {
  category: 'TCL 电视', platform: '京东', count: 1,
});
const row = {question: '挂架包含吗？', answer: '请核实订单条款。', keyPoints: ['核对挂架服务']};
const content = JSON.stringify({questions: [row]});
const usage = {prompt_tokens: 3, completion_tokens: 2, total_tokens: 5};
function envelope(text = content, finish = 'stop') {
  return {choices: [{finish_reason: finish, message: {role: 'assistant', content: text}}], usage: {...usage}};
}

function mockClient(responses, overrides = {}) {
  const calls = [], delays = [];
  const client = createAiGatewayClient({
    env: {...env, ...overrides},
    fetchImpl: async (url, options) => {
      const next = responses[calls.length];
      calls.push({url, options});
      assert.ok(next, 'unexpected dispatch');
      return typeof next === 'function' ? next(url, options) : next;
    },
    sleep: async ms => { delays.push(ms); },
  });
  return {client, calls, delays};
}

test('root, version base, complete and trailing-slash gateway URLs use one chat route', async () => {
  for (const suffix of ['', '/', '/v1', '/v1/', '/v1/chat/completions', '/v1/chat/completions/', '/v1/v1/chat/completions']) {
    const reply = envelope('\u0060\u0060\u0060json\n' + content + '\n\u0060\u0060\u0060');
    reply.usage.internal_credentials = token;
    const {client, calls, delays} = mockClient([Response.json(reply)], {AI_GATEWAY_URL: origin + suffix});
    const result = await client.generate(prompt);
    assert.deepEqual(result, {questions: [row], model: 'gpt-4o-mini', httpStatus: 200, retryCount: 0, usage});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, origin + '/v1/chat/completions');
    const {method, headers, body, redirect, signal} = calls[0].options;
    assert.equal(method, 'POST');
    assert.equal(redirect, 'error');
    assert.equal(headers.Authorization, 'Bearer ' + token);
    assert.ok(signal instanceof AbortSignal);
    const payload = JSON.parse(body);
    assert.equal(payload.model, 'gpt-4o-mini');
    assert.equal(payload.stream, false);
    assert.deepEqual(payload.response_format, {type: 'json_object'});
    assert.deepEqual(payload.messages.map(m => m.role), ['system', 'user']);
    for (const message of payload.messages) {
      assert.match(message.content, /JSON/u);
      for (const field of Object.keys(row)) assert.ok(message.content.includes(field));
    }
    assert.deepEqual(delays, []);
  }
});

test('missing gateway URL or token fails before network access or quota reservation', async () => {
  for (const overrides of [{AI_GATEWAY_URL: undefined}, {AI_GATEWAY_TOKEN: undefined}, {AI_GATEWAY_TOKEN: '  '}]) {
    const {client, calls} = mockClient([], overrides);
    let reserved = 0;
    await assert.rejects(client.generate(prompt, {beforeFetch: () => { reserved++; }}), {code: 'GATEWAY_CONFIG_MISSING'});
    assert.equal(calls.length, 0);
    assert.equal(reserved, 0);
  }
});

test('malformed URLs, direct provider domains, invalid timeouts and unsafe credential config fail closed', async () => {
  const invalidUrls = ['http://gateway.test', 'junk', 'https://user@gateway.test/', 'https://gateway.test/?v=1',
    'https://gateway.test/#v', 'https://gateway.test/unrelated', 'https://models.openai.com./v1'];
  const overridesList = [
    ...invalidUrls.map(AI_GATEWAY_URL => ({AI_GATEWAY_URL})),
    ...['', '0', '60001', '-1', '2.1', '2e3', '100junk'].map(AI_GATEWAY_TIMEOUT_MS => ({AI_GATEWAY_TIMEOUT_MS})),
    {AI_GATEWAY_TOKEN: 'bad\nheader'}, {AI_GATEWAY_TOKEN: ['bad']}, {AI_GATEWAY_TOKEN: ['sk', 'test'].join('-')},
  ];
  for (const overrides of overridesList) {
    const {client, calls} = mockClient([], overrides);
    await assert.rejects(client.generate(prompt), {code: 'GATEWAY_CONFIG_INVALID'});
    assert.equal(calls.length, 0);
  }
});

test('invalid or secret-bearing model configuration is never exposed in metadata', async () => {
  for (const model of [token, 'some-' + token, token.slice(0, 15), 'https://gateway.test', 'Bearer ' + token]) {
    const {client, calls} = mockClient([], {AI_GATEWAY_MODEL: model});
    assert.equal(client.model, null);
    await assert.rejects(client.generate(prompt), e => e.code === 'GATEWAY_CONFIG_INVALID' && e.model === null);
    assert.equal(calls.length, 0);
  }
});

test('empty and oversize source fail before the first gateway request', async () => {
  const {client, calls} = mockClient([]);
  for (const source of ['', ' '.repeat(100), '汉'.repeat(44000)]) {
    await assert.rejects(client.generate(source), {code: 'AI_DRAFT_INPUT_INVALID'});
  }
  assert.equal(calls.length, 0);
});

test('malformed envelope, broken fences, invalid schema, truncation and refusals never retry', async () => {
  const malformed = [
    new Response('unstructured'), new Response('{"choi'), Response.json({choices: []}), Response.json(envelope('text')),
    Response.json(envelope('{"questions":')), Response.json(envelope('{"questions":[]}')),
    Response.json(envelope(JSON.stringify({questions: [{...row, question: '   '}]}))),
    Response.json(envelope(JSON.stringify({questions: [{...row, answer: ['wrong type']}]}))),
    Response.json(envelope(JSON.stringify({questions: [{question: '字段缺失'}]}))),
    Response.json(envelope(JSON.stringify({questions: [{...row, keyPoints: []}]}))),
    Response.json(envelope(JSON.stringify({questions: [{...row, keyPoints: [' ']}]}))),
    Response.json(envelope('leading prose \u0060\u0060\u0060json\n' + content + '\n\u0060\u0060\u0060')),
    Response.json(envelope(content, 'length')), Response.json(envelope(content, 'content_filter')),
    Response.json({choices: [{message: {content, refusal: 'refused'}}]}),
    Response.json({choices: {0: {message: {content}}}}),
    Response.json({...envelope(), error: {message: 'provider failure'}}),
    new Response(new Uint8Array(256 * 1024 + 1)), new Response('small', {headers: {'content-length': '262145'}}),
  ];
  for (const value of malformed) {
    const {client, calls, delays} = mockClient([value]);
    await assert.rejects(client.generate(prompt), {code: 'INVALID_AI_JSON', retryCount: 0, httpStatus: 200});
    assert.equal(calls.length, 1);
    assert.deepEqual(delays, []);
  }
});

for (const status of [300, 400, 401, 403, 404, 408, 500, 501]) {
  test('HTTP ' + status + ' fails immediately and discards upstream body', async () => {
    const {client, calls, delays} = mockClient([new Response(token, {status})]);
    await assert.rejects(client.generate(prompt), error => {
      assert.equal(error.code, 'GATEWAY_HTTP_' + status);
      assert.equal(error.httpStatus, status);
      assert.equal(error.retryCount, 0);
      assert.ok(!(error.stack + JSON.stringify(error)).includes(token));
      return true;
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(delays, []);
  });
}

for (const status of [429, 502, 503, 504]) {
  test('HTTP ' + status + ' backs off 1500 ms and reserves each attempt', async () => {
    const {client, calls, delays} = mockClient([new Response(null, {status}), Response.json(envelope())]);
    const reservations = [];
    const result = await client.generate(prompt, {beforeFetch: () => { reservations.push(calls.length); }});
    assert.deepEqual(reservations, [0, 1]);
    assert.deepEqual(delays, [1500]);
    assert.equal(result.retryCount, 1);
    assert.deepEqual(result.questions, [row]);
  });
}

test('a second transient HTTP error ends the request with retryCount 1', async () => {
  const {client, calls, delays} = mockClient([new Response(null, {status: 502}), new Response(null, {status: 503})]);
  await assert.rejects(client.generate(prompt), {code: 'GATEWAY_HTTP_503', httpStatus: 503, retryCount: 1});
  assert.equal(calls.length, 2);
  assert.deepEqual(delays, [1500]);
});

for (const code of ['ECONNRESET', 'ETIMEDOUT', 'AbortError']) {
  test(code + ' retries once including nested fetch causes', async () => {
    const fails = () => {
      if (code === 'AbortError') throw new DOMException('request aborted', code);
      throw new TypeError(token, {cause: Object.assign(new Error(token), {code})});
    };
    const {client, calls, delays} = mockClient([fails, Response.json(envelope())]);
    assert.equal((await client.generate(prompt)).retryCount, 1);
    assert.equal(calls.length, 2);
    assert.deepEqual(delays, [1500]);
  });
}

test('generic transport failure is sanitized and cannot retry', async () => {
  const {client, calls} = mockClient([() => { throw new TypeError(token, {cause: new Error(token)}); }]);
  await assert.rejects(client.generate(prompt), error => {
    assert.equal(error.code, 'GATEWAY_NETWORK_ERROR');
    assert.ok(!(error.stack + JSON.stringify(error)).includes(token));
    return true;
  });
  assert.equal(calls.length, 1);
});

test('deadline aborts a hanging response body and a hanging fetch, without a third dispatch', async () => {
  const bodyNeverEnds = (url, options) => new Response(new ReadableStream({
    start(controller) {
      options.signal.addEventListener('abort', () => controller.error(options.signal.reason), {once: true});
    },
  }));
  const ignoresAbort = () => new Promise(() => {});
  const {client, calls, delays} = mockClient([bodyNeverEnds, ignoresAbort], {AI_GATEWAY_TIMEOUT_MS: '12'});
  await assert.rejects(client.generate(prompt), {code: 'GATEWAY_TIMEOUT', httpStatus: null, retryCount: 1});
  assert.deepEqual(calls.map(call => call.options.signal.aborted), [true, true]);
  assert.deepEqual(delays, [1500]);
});

test('failed quota reservations never dispatch, retry or expose backend details', async () => {
  for (const code of ['AI_DRAFT_LIMIT', 'AI_DRAFT_QUOTA_UNAVAILABLE', 'unknown']) {
    const {client, calls, delays} = mockClient([]);
    const beforeFetch = () => { throw Object.assign(new Error(token), {code}); };
    await assert.rejects(client.generate(prompt, {beforeFetch}), error => {
      assert.equal(error.code, code === 'AI_DRAFT_LIMIT' ? code : 'AI_DRAFT_QUOTA_UNAVAILABLE');
      assert.ok(!(error.stack + JSON.stringify(error)).includes(token));
      return true;
    });
    assert.equal(calls.length, 0);
    assert.deepEqual(delays, []);
  }
});
