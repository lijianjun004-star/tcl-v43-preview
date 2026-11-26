'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {once} = require('node:events');
const {createGateway} = require('./server.js');

const token = 'local-fixture-token-for-service-contract';
const providerKey = 'local-fixture-upstream-value';
const body = {model: 'gpt-4o-mini', messages: [{role: 'user', content: '合成练习'}], stream: false};
const good = {model: body.model, choices: [{message: {role: 'assistant', content: '{}'}, finish_reason: 'stop'}]};
const headers = {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'};

async function setup(t, options = {}) {
  const calls = [];
  const upstream = options.upstream ?? (async () => Response.json(good));
  const server = createGateway({providerKey, token, ...options, fetchImpl: (...args) => {
    calls.push(args);
    return upstream(...args);
  }});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const send = (path, options = {}) => fetch(origin + path, options);
  const complete = (args = {}) => send('/v1/chat/completions', {method: 'POST', headers, body: JSON.stringify(body), ...args});
  return {calls, send, complete};
}

test('health is public, read-only and reports setup state', async t => {
  const ready = await setup(t);
  const response = await ready.send('/health');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {ok: true, configured: true});
  assert.equal(ready.calls.length, 0);
  const missing = await setup(t, {providerKey: ''});
  assert.deepEqual(await (await missing.send('/health')).json(), {ok: true, configured: false});
  assert.equal((await missing.complete()).status, 503);
  assert.equal(missing.calls.length, 0);
});

test('only the two exact routes and respective methods are accepted', async t => {
  const {send, calls} = await setup(t);
  for (const [path, method, status, allow] of [
    ['/v1/models', 'GET', 404, null], ['/v1/models', 'POST', 404, null],
    ['/v1/chat/completions/', 'POST', 404, null], ['/v1/chat/completions?extra=1', 'POST', 404, null],
    ['/health', 'POST', 405, 'GET'], ['/health', 'HEAD', 405, 'GET'],
    ['/v1/chat/completions', 'GET', 405, 'POST'], ['/v1/chat/completions', 'DELETE', 405, 'POST'],
  ]) {
    const response = await send(path, {method, headers});
    assert.equal(response.status, status);
    assert.equal(response.headers.get('allow'), allow);
  }
  assert.equal(calls.length, 0);
});

test('missing or wrong tokens cause no upstream request; token and provider key must be independent', async t => {
  const {complete, calls} = await setup(t);
  for (const authorization of [undefined, 'Bearer wrong', 'Bearer ' + providerKey]) {
    const h = {'Content-Type': 'application/json'};
    if (authorization) h.Authorization = authorization;
    const response = await complete({headers: h});
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {error: 'UNAUTHORIZED'});
  }
  assert.equal(calls.length, 0);
  const bad = await setup(t, {providerKey: token});
  assert.equal((await bad.complete()).status, 401);
  assert.equal(bad.calls.length, 0);
});

test('valid draft and evaluation JSON reach the fixed upstream; actual usage passes through', async t => {
  const usage = {prompt_tokens: 17, completion_tokens: 8, total_tokens: 25};
  const {complete, calls} = await setup(t, {upstream: async () => Response.json({...good, usage, extra: 'private-metadata'})});
  for (const format of [{type: 'json_object'}, {type: 'json_schema', json_schema: {name: 'evaluation',
    strict: true, schema: {type: 'object', properties: {}, required: [], additionalProperties: false}}}]) {
    const response = await complete({body: JSON.stringify({...body, response_format: format, max_tokens: 8192})});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {...good, usage});
    const [url, options] = calls.at(-1);
    assert.equal(new URL(url).protocol, 'https:');
    assert.equal(new URL(url).pathname, '/v1/chat/completions');
    assert.deepEqual(JSON.parse(options.body), {...body, response_format: format, max_tokens: 8192, store: false});
    assert.equal(options.headers.Authorization, 'Bearer ' + providerKey);
    assert.equal(options.redirect, 'error');
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], calls[1][0]);
});

test('invalid MIME, excessive or malformed bodies and unsupported model/stream are refused before fetch', async t => {
  const {complete, calls} = await setup(t);
  assert.equal((await complete({headers: {...headers, 'Content-Type': 'text/plain'}})).status, 415);
  assert.equal((await complete({body: 'x'.repeat(256 * 1024 + 1)})).status, 413);
  for (const candidate of ['{', 'null', JSON.stringify({...body, stream: true}),
    JSON.stringify({...body, model: 'other-model'}), JSON.stringify({...body, max_tokens: 8193})]) {
    assert.equal((await complete({body: candidate})).status, 400);
  }
  assert.equal(calls.length, 0);
});

test('upstream status is preserved without echoing provider errors or credentials', async t => {
  const {complete, calls} = await setup(t, {upstream: async () => new Response(providerKey, {status: 429})});
  const response = await complete();
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {error: 'UPSTREAM_REJECTED'});
  assert.equal(calls.length, 1);
});

test('malformed and oversized upstream envelopes do not leave partial HTTP 200 responses', async t => {
  for (const value of ['{', '{}', ' '.repeat(256 * 1024 + 1)]) {
    const {complete} = await setup(t, {upstream: async () => new Response(value)});
    const response = await complete();
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {error: 'UPSTREAM_FAILED'});
  }
});

test('upstream timeout aborts before success and returns a sanitized error', async t => {
  const {complete, calls} = await setup(t, {timeoutMs: 20, upstream: (url, {signal}) =>
    new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('fixture timeout')), {once: true}))});
  const response = await complete();
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), {error: 'UPSTREAM_TIMEOUT'});
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].signal.aborted, true);
});

test('success envelopes project only chat content and partial real usage', async t => {
  for (const counters of [null, {total_tokens: 12}]) {
    const {complete} = await setup(t, {upstream: async () => Response.json({
      model: 'gpt-4o-mini-2024-07-18',
      usage: {...counters, unrelated: providerKey, prompt_tokens: 'wrong type', completion_tokens: -2},
      choices: [{finish_reason: 'stop', logprobs: token, message: {role: 'assistant', content: '{}', other: providerKey}}],
      unrelated: token,
    })});
    const response = await complete();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {model: 'gpt-4o-mini-2024-07-18', choices: good.choices, usage: counters});
  }
});

test('truncation, refusals and tool responses retain failure signals without reflecting extra content', async t => {
  for (const [reason, extras, expected] of [
    ['length', {}, 'length'], ['stop', {refusal: token}, 'content_filter'],
    ['stop', {tool_calls: [{arguments: providerKey}]}, 'tool_calls'],
  ]) {
    const {complete} = await setup(t, {upstream: async () => Response.json({
      choices: [{finish_reason: reason, message: {role: 'assistant', content: providerKey, ...extras}}],
    })});
    const response = await complete();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {choices: [{finish_reason: expected, message: {role:'assistant', content:null}}], usage:null});
  }
});

test('rejects credentials in plain text, decoded evaluation JSON values or keys, and unexpected model metadata', async t => {
  for (const credential of [providerKey, token]) {
    const encoded = [...credential].map(char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join('');
    for (const [content, model, structured] of [
      [credential, 'gpt-4o-mini', false],
      ['{"items":[{"comment":"' + encoded + '"}]}', 'gpt-4o-mini', true],
      ['{"' + encoded + '":123}', 'gpt-4o-mini', true],
      ['{}', credential, true],
    ]) {
      const {complete} = await setup(t, {upstream: async () => Response.json({model,
        choices: [{finish_reason: 'stop', message: {role:'assistant', content}}]})});
      const request = structured ? {...body, response_format: {type: 'json_schema'}} : body;
      const response = await complete({body: JSON.stringify(request)});
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {error: 'UPSTREAM_FAILED'});
    }
  }
});
