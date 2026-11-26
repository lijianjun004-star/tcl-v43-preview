import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {createAiGatewayClient} from '../ai-gateway-client.mjs';

const source = [{question: '如何确认安装费用？', referenceAnswer: '请核对服务范围与订单。',
  keyPoints: ['核对服务范围', '核对订单'], transcript: '我会核对订单。', accountId: 'internal-account-example'}];
const item = {questionIndex: 0, score: 70, matchedPoints: ['核对订单'], missedPoints: ['核对服务范围'],
  comment: '提到了订单，需补充服务边界。', suggestedScript: '请先查看服务范围，再核对订单。'};
const assessment = {overallScore: 70, grade: '良好', items: [item]};
const token = randomUUID();
const usage = {prompt_tokens: 19, completion_tokens: 24, total_tokens: 43};

function reply(value = assessment, finish = 'stop', reportedUsage = usage) {
  return Response.json({choices: [{finish_reason: finish,
    message: {role: 'assistant', content: typeof value === 'string' ? value : JSON.stringify(value)}}], usage: reportedUsage});
}

function setup(responses = [], config = {}) {
  const calls = [], waits = [];
  const client = createAiGatewayClient({
    env: {AI_GATEWAY_URL: 'https://gateway.example.invalid', AI_GATEWAY_TOKEN: token, ...config},
    async fetchImpl(url, options) {
      calls.push({url, options});
      const result = responses.shift();
      assert.ok(result, 'unexpected upstream request');
      return typeof result === 'function' ? result() : result;
    },
    async sleep(ms) { waits.push(ms); },
  });
  return {client, calls, waits};
}

test('evaluation uses strict JSON schema with snapshot fields only and preserves reported usage', async () => {
  const {client, calls} = setup([reply()], {AI_GATEWAY_MODEL: 'gpt-4o'});
  let reserved = 0;
  const result = await client.evaluate(source, {beforeFetch() { reserved++; }});
  assert.deepEqual(result, {...assessment, model: 'gpt-4o', httpStatus: 200, retryCount: 0, usage});
  assert.equal(reserved, 1);
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.model, 'gpt-4o');
  assert.equal(payload.stream, false);
  assert.equal(payload.store, false);
  assert.equal(payload.response_format.type, 'json_schema');
  assert.equal(payload.response_format.json_schema.strict, true);
  assert.equal(payload.response_format.json_schema.schema.properties.items.items.additionalProperties, false);
  assert.deepEqual(JSON.parse(payload.messages[1].content), [{questionIndex: 0, question: source[0].question,
    referenceAnswer: source[0].referenceAnswer, keyPoints: source[0].keyPoints, answerText: source[0].transcript}]);
});

test('successful evaluation with missing upstream usage records null', async () => {
  const {client} = setup([reply(assessment, 'stop', null)]);
  assert.deepEqual(await client.evaluate(source),
    {...assessment, model: 'gpt-4o-mini', httpStatus: 200, retryCount: 0, usage: null});
});

test('missing config or 30-second budget overflow fails before quota or transport', async () => {
  for (const [config, code] of [[{AI_GATEWAY_TOKEN: ''}, 'GATEWAY_CONFIG_MISSING'],
    [{AI_GATEWAY_TIMEOUT_MS: '30001'}, 'GATEWAY_CONFIG_INVALID']]) {
    const {client, calls} = setup([], config);
    let reserved = 0;
    await assert.rejects(client.evaluate(source, {beforeFetch() { reserved++; }}), {code});
    assert.equal(reserved, 0);
    assert.deepEqual(calls, []);
  }
});

test('empty answers, overlong material, invalid rubrics and excessive rows make zero HTTP calls', async () => {
  const {client, calls} = setup();
  for (const entries of [[], [{...source[0], transcript: ' '}], [{...source[0], transcript: '答'.repeat(4001)}],
    [{...source[0], keyPoints: []}], [{...source[0], keyPoints: [null]}], Array(16).fill(source[0]), Array(7).fill({...source[0], transcript: '答'.repeat(3000)})]) {
    await assert.rejects(client.evaluate(entries), {code: 'AI_EVALUATION_INPUT_INVALID'});
  }
  assert.deepEqual(calls, []);
});

test('truncated, invalid or ungrounded model scores never produce a scored result', async () => {
  const invalid = [
    reply('not JSON'), reply(assessment, 'length'), reply(assessment, null),
    Response.json({choices: [{message: {role: 'assistant', content: JSON.stringify(assessment)}}]}),
    reply({...assessment, extra: 1}), reply({...assessment, overallScore: 69}), reply({...assessment, grade: '优秀'}),
    reply({...assessment, items: []}),
    ...[{questionIndex: 1}, {score: 70.5}, {score: 101}, {score: -1}, {comment: ''}, {revealed: true},
      {missedPoints: ['核对订单']}, {matchedPoints: []}, {matchedPoints: ['新的要点']}, {suggestedScript: token}]
      .map(patch => reply({...assessment, items: [{...item, ...patch}]})),
  ];
  for (const response of invalid) {
    const {client, calls, waits} = setup([response]);
    await assert.rejects(client.evaluate(source), error => {
      assert.equal(error.code, 'INVALID_AI_JSON');
      assert.ok(!JSON.stringify(error).includes(token));
      return true;
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
  }
});

test('permanent evaluation failures never retry; limits never dispatch', async () => {
  for (const status of [400, 401, 403, 404]) {
    const {client, calls, waits} = setup([new Response(null, {status})]);
    await assert.rejects(client.evaluate(source), {code: 'GATEWAY_HTTP_' + status, retryCount: 0});
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
  }
  const {client, calls} = setup();
  await assert.rejects(client.evaluate(source, {beforeFetch() {
    throw Object.assign(new Error('local quota'), {code: 'AI_EVALUATION_LIMIT'});
  }}), {code: 'AI_EVALUATION_LIMIT'});
  assert.deepEqual(calls, []);
});

test('each transient HTTP evaluation failure backs off once and reserves the retry', async () => {
  for (const status of [429, 502, 503, 504]) {
    const {client, calls, waits} = setup([new Response(null, {status}), reply()]);
    const reservations = [];
    assert.equal((await client.evaluate(source, {beforeFetch() { reservations.push(calls.length); }})).retryCount, 1);
    assert.deepEqual(reservations, [0, 1]);
    assert.deepEqual(waits, [1500]);
  }
});

test('time-limited evaluation never makes a third request and returns no artificial score', async () => {
  const neverCompletes = () => new Promise(() => {});
  const {client, calls, waits} = setup([neverCompletes, neverCompletes], {AI_GATEWAY_TIMEOUT_MS: '10'});
  await assert.rejects(client.evaluate(source), error => error.code === 'GATEWAY_TIMEOUT' && error.retryCount === 1 &&
    !Object.hasOwn(error, 'overallScore'));
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({options}) => options.signal.aborted));
  assert.deepEqual(waits, [1500]);
});

test('failure to reserve the retry counts only the original HTTP attempt', async () => {
  const {client, calls, waits} = setup([new Response(null, {status: 429})]);
  let reservations = 0;
  await assert.rejects(client.evaluate(source, {beforeFetch() {
    if (++reservations === 2) throw Object.assign(new Error('quota'), {code: 'AI_EVALUATION_LIMIT'});
  }}), {code: 'AI_EVALUATION_LIMIT', retryCount: 0});
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, [1500]);
});

test('a hanging second reservation reaches the operation deadline with zero HTTP retries', {timeout: 5000}, async () => {
  const {client, calls, waits} = setup([new Response(null, {status: 503})], {AI_GATEWAY_TIMEOUT_MS: '25'});
  let reservations = 0;
  await assert.rejects(client.evaluate(source, {beforeFetch() {
    if (++reservations === 2) return new Promise(() => {});
  }}), {code: 'GATEWAY_TIMEOUT', retryCount: 0});
  assert.equal(reservations, 2);
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, [1500]);
});
