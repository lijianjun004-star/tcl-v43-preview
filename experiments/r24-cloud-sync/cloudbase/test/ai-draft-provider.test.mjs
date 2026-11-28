import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAiGatewayClient} from '../../backend/ai-gateway-client.mjs';
import {createCloudBaseDraftGeneration} from '../ai-draft-provider.mjs';

const prefix = 'tcl_r24_sync_test';
const operator = {id: 'uid-operator', role: 'operator', active: true};
const prompt = '请按 JSON 格式生成一题。';
const enabled = {
  TCL_R24_SYNC_AI_ENABLED: 'true',
  TCL_R24_SYNC_AI_OPERATOR_IDS: 'uid-operator, uid-other',
  TCL_R24_SYNC_AI_DAILY_LIMIT: '5',
  AI_GATEWAY_URL: 'https://gateway.example.invalid',
  AI_GATEWAY_TOKEN: 'fixture-value-for-local-tests',
};
const row = {question: '入户前需要测量什么？', answer: '请测量电梯门和走廊转角。', keyPoints: ['核对包装尺寸']};

function accepted() {
  return Response.json({
    choices: [{finish_reason: 'stop', message: {role: 'assistant', content: JSON.stringify({questions: [row]})}}],
  });
}

function setup({env = enabled, reserve = () => ({data: true}), respond = accepted} = {}) {
  const calls = [];
  const client = createAiGatewayClient({
    env,
    fetchImpl: async () => {
      calls.push('fetch');
      return respond();
    },
    sleep: async ms => { calls.push(['wait', ms]); },
  });
  const db = {rpc(name, args) {
    calls.push([name, args]);
    return reserve();
  }};
  return {calls, generation: createCloudBaseDraftGeneration({client, db, prefix, env})};
}

const reservation = [prefix + '_reserve_ai_draft', {p_daily_limit: 5}];

test('pilot generation is disabled without a valid opt-in, daily limit, and exact operator list', () => {
  for (const partial of [
    {TCL_R24_SYNC_AI_ENABLED: undefined}, {TCL_R24_SYNC_AI_ENABLED: 'false'},
    {TCL_R24_SYNC_AI_OPERATOR_IDS: undefined}, {TCL_R24_SYNC_AI_OPERATOR_IDS: '*,uid-operator'},
    {TCL_R24_SYNC_AI_OPERATOR_IDS: '**'}, {TCL_R24_SYNC_AI_OPERATOR_IDS: ' '},
    {TCL_R24_SYNC_AI_OPERATOR_IDS: 'uid-operator,uid-operator'}, {TCL_R24_SYNC_AI_OPERATOR_IDS: 'uid-operator,'},
    {TCL_R24_SYNC_AI_DAILY_LIMIT: '0'}, {TCL_R24_SYNC_AI_DAILY_LIMIT: '10001'},
    {TCL_R24_SYNC_AI_DAILY_LIMIT: '05'}, {TCL_R24_SYNC_AI_DAILY_LIMIT: 'unlimited'},
  ]) {
    assert.equal(setup({env: {...enabled, ...partial}}).generation, undefined);
  }
});

test('only exact active operators with valid prompts can reach quota and transport', async () => {
  const {generation, calls} = setup();
  assert.equal(generation.canGenerate(operator), true);
  assert.equal(generation.canGenerate({...operator, id: 'uid-other'}), true);
  for (const principal of [null, {...operator, role: 'anchor'}, {...operator, active: false},
    {...operator, id: 'UID-operator'}, {...operator, id: 'different', displayName: operator.id}]) {
    assert.equal(generation.canGenerate(principal), false);
    await assert.rejects(generation.generate(principal, prompt), {code: 'AI_DRAFT_UNAVAILABLE'});
  }
  for (const input of [null, '\n ', '中'.repeat(44_000)]) {
    await assert.rejects(generation.generate(operator, input), {code: 'AI_DRAFT_INPUT_INVALID'});
  }
  assert.deepEqual(calls, []);
});

test('"*" opens generation to every active operator but never to anchors or inactive accounts', async () => {
  const {generation, calls} = setup({env: {...enabled, TCL_R24_SYNC_AI_OPERATOR_IDS: ' * '}});
  for (const id of ['uid-operator', 'self-enrolled_operator', 'x']) {
    assert.equal(generation.canGenerate({...operator, id}), true);
  }
  for (const principal of [null, {...operator, role: 'anchor'}, {...operator, active: false},
    {...operator, id: ''}, {...operator, id: 'has space'}, {...operator, id: undefined}]) {
    assert.equal(generation.canGenerate(principal), false);
    await assert.rejects(generation.generate(principal, prompt), {code: 'AI_DRAFT_UNAVAILABLE'});
  }
  assert.deepEqual(calls, []);
  const result = await generation.generate({...operator, id: 'self-enrolled_operator'}, prompt);
  assert.deepEqual(result.questions, [row]);
  assert.deepEqual(calls, [reservation, 'fetch']);
});

test('an unset or empty daily limit sends requests without reserving quota', async () => {
  for (const value of [undefined, '', '  ']) {
    const {generation, calls} = setup({env: {...enabled, TCL_R24_SYNC_AI_DAILY_LIMIT: value}});
    const result = await generation.generate(operator, prompt);
    assert.deepEqual(result.questions, [row]);
    assert.deepEqual(calls, ['fetch']);
  }
});

test('a numeric daily limit above 20 is passed to the quota store unchanged', async () => {
  for (const value of ['21', '500', '10000']) {
    const {generation, calls} = setup({env: {...enabled, TCL_R24_SYNC_AI_DAILY_LIMIT: value}});
    await generation.generate(operator, prompt);
    assert.deepEqual(calls, [[prefix + '_reserve_ai_draft', {p_daily_limit: Number(value)}], 'fetch']);
  }
});

test('missing gateway fields surface a typed error to an eligible operator without spending quota', async () => {
  for (const field of ['AI_GATEWAY_URL', 'AI_GATEWAY_TOKEN']) {
    const {generation, calls} = setup({env: {...enabled, [field]: undefined}});
    assert.equal(generation.canGenerate(operator), true);
    assert.equal(generation.fallbackEnabled, true);
    await assert.rejects(generation.generate(operator, prompt), {code: 'GATEWAY_CONFIG_MISSING'});
    assert.deepEqual(calls, []);
  }
  for (const value of ['false', '', 'invalid']) {
    assert.equal(setup({env: {...enabled, AI_FALLBACK_ENABLED: value}}).generation.fallbackEnabled, false);
  }
});

test('generation forwards validated questions after reserving an attempt', async () => {
  const {generation, calls} = setup();
  assert.equal(generation.model, 'gpt-4o-mini');
  const result = await generation.generate(operator, prompt);
  assert.deepEqual(result.questions, [row]);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.retryCount, 0);
  assert.deepEqual(calls, [reservation, 'fetch']);
});

test('unavailable quota storage and daily limit deny transport', async () => {
  for (const [reserve, code] of [
    [() => ({data: false}), 'AI_DRAFT_LIMIT'],
    [() => ({data: true, error: {message: 'unexpected storage detail'}}), 'AI_DRAFT_QUOTA_UNAVAILABLE'],
    [() => ({data: 'true'}), 'AI_DRAFT_QUOTA_UNAVAILABLE'],
    [() => { throw new Error('unexpected storage detail'); }, 'AI_DRAFT_QUOTA_UNAVAILABLE'],
  ]) {
    const {generation, calls} = setup({env: {...enabled, TCL_R24_SYNC_AI_DAILY_LIMIT: '20'}, reserve});
    await assert.rejects(generation.generate(operator, prompt), {code});
    assert.deepEqual(calls, [[prefix + '_reserve_ai_draft', {p_daily_limit: 20}]]);
  }
});

test('retry reserves a second attempt after the backoff', async () => {
  let sent = 0;
  const {generation, calls} = setup({respond: () => ++sent === 1 ? new Response(null, {status: 502}) : accepted()});
  const result = await generation.generate(operator, prompt);
  assert.equal(result.retryCount, 1);
  assert.deepEqual(calls, [reservation, 'fetch', ['wait', 1500], reservation, 'fetch']);
});

test('quota exhausted after a transient failure prevents the second HTTP request', async () => {
  let reservations = 0;
  const {generation, calls} = setup({
    reserve: () => ({data: ++reservations === 1}), respond: () => new Response(null, {status: 503}),
  });
  await assert.rejects(generation.generate(operator, prompt), {code: 'AI_DRAFT_LIMIT'});
  assert.deepEqual(calls, [reservation, 'fetch', ['wait', 1500], reservation]);
});
