import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createCloudBaseDraftGeneration} from '../ai-draft-provider.mjs';

const prefix = 'tcl_r24_sync_test';
const operator = {id: 'uid-operator', role: 'operator', active: true};
const prompt = '请根据资料生成题目。';
const enabled = {
  TCL_R24_SYNC_AI_ENABLED: 'true',
  TCL_R24_SYNC_AI_MODEL_PROVIDER: 'cloudbase',
  TCL_R24_SYNC_AI_MODEL_ID: 'hy3',
  TCL_R24_SYNC_AI_OPERATOR_IDS: 'uid-operator, uid-other',
};

function setup({env = enabled, reserve = async () => ({data: true}),
  run = async () => ({text: '{"questions":[]}'})} = {}) {
  const calls = [];
  const cloudApp = {
    ai() {
      return {
        createModel(provider) {
          calls.push(['provider', provider]);
          return {
            generateText(input) {
              calls.push(['model', input]);
              return run();
            },
          };
        },
      };
    },
  };
  const db = {rpc(name, args) {
    calls.push(['reserve', name, args]);
    return reserve(args);
  }};
  return {calls, generation: createCloudBaseDraftGeneration({cloudApp, db, prefix, env})};
}

test('model capability is off by default and invalid opt-in cannot activate it', () => {
  assert.equal(setup({env: {}}).generation, undefined);
  for (const partial of [
    {TCL_R24_SYNC_AI_ENABLED: 'false'},
    {TCL_R24_SYNC_AI_MODEL_PROVIDER: 'vendor-proxy'},
    {TCL_R24_SYNC_AI_MODEL_ID: undefined},
    {TCL_R24_SYNC_AI_MODEL_ID: 'https://example.invalid/model'},
    {TCL_R24_SYNC_AI_OPERATOR_IDS: undefined},
    {TCL_R24_SYNC_AI_OPERATOR_IDS: '*'},
    {TCL_R24_SYNC_AI_OPERATOR_IDS: 'uid-operator,uid-operator'},
    {TCL_R24_SYNC_AI_OPERATOR_IDS: 'uid-operator,'},
    {TCL_R24_SYNC_AI_DAILY_LIMIT: ''},
    {TCL_R24_SYNC_AI_DAILY_LIMIT: '0'},
    {TCL_R24_SYNC_AI_DAILY_LIMIT: '21'},
  ]) {
    assert.equal(setup({env: {...enabled, ...partial}}).generation, undefined);
  }
});

test('only exact active operator IDs can reserve quota or invoke the model', async () => {
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

test('the model starts after a single successful quota reservation with bounded generation parameters', async () => {
  const {generation, calls} = setup();
  assert.equal(await generation.generate(operator, prompt), '{"questions":[]}');
  assert.deepEqual(calls, [
    ['reserve', 'tcl_r24_sync_test_reserve_ai_draft', {p_daily_limit: 5}],
    ['provider', 'cloudbase'],
    ['model', {
      model: 'hy3', messages: [{role: 'user', content: prompt}], maxSteps: 1, max_tokens: 4096,
    }],
  ]);
});

test('quota denial and database failures never initialize or call the model', async () => {
  for (const [reserve, code] of [
    [async () => ({data: false}), 'AI_DRAFT_LIMIT'],
    [async () => ({data: true, error: {message: 'private storage error'}}), 'AI_DRAFT_QUOTA_UNAVAILABLE'],
    [async () => ({data: 'true'}), 'AI_DRAFT_QUOTA_UNAVAILABLE'],
    [async () => { throw new Error('private storage error'); }, 'AI_DRAFT_QUOTA_UNAVAILABLE'],
  ]) {
    const {generation, calls} = setup({env: {...enabled, TCL_R24_SYNC_AI_DAILY_LIMIT: '20'}, reserve});
    await assert.rejects(generation.generate(operator, prompt), {code, message: code});
    assert.deepEqual(calls, [['reserve', 'tcl_r24_sync_test_reserve_ai_draft', {p_daily_limit: 20}]]);
  }
});

test('model failures and unbounded or unusable responses never expose upstream details', async () => {
  for (const [run, code] of [
    [async () => { throw new Error('private provider error'); }, 'AI_DRAFT_PROVIDER_UNAVAILABLE'],
    [async () => ({text: prompt, error: 'private provider error'}), 'AI_DRAFT_PROVIDER_INVALID_RESPONSE'],
    [async () => ({text: '\n '}), 'AI_DRAFT_PROVIDER_INVALID_RESPONSE'],
    [async () => ({text: 'x'.repeat(150_001)}), 'AI_DRAFT_PROVIDER_INVALID_RESPONSE'],
  ]) {
    const {generation} = setup({run});
    await assert.rejects(generation.generate(operator, prompt), {code, message: code});
  }
});

test('a provider that never responds hits the local deadline without refunding quota', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const {generation, calls} = setup({run: () => {
    signalStarted();
    return new Promise(() => {});
  }});
  const failed = assert.rejects(generation.generate(operator, prompt), {code: 'AI_DRAFT_TIMEOUT'});
  await started;
  t.mock.timers.tick(24_000);
  await failed;
  assert.equal(calls.filter(([stage]) => stage === 'reserve').length, 1);
  assert.equal(calls.filter(([stage]) => stage === 'model').length, 1);
});
