import assert from 'node:assert/strict';
import test from 'node:test';
import {createHunyuanClient} from '../../backend/ai-gateway-client.mjs';
import {createCloudBaseDraftGeneration} from '../ai-draft-provider.mjs';

const prefix = 'tcl_r24_sync_test';
const actor = {id: 'demo_operator', role: 'operator', active: true};
const env = {TCL_R24_SYNC_AI_ENABLED: 'true', TCL_R24_SYNC_AI_OPERATOR_IDS: actor.id,
  TCL_R24_SYNC_AI_MODEL_PROVIDER: 'cloudbase', TCL_R24_SYNC_AI_MODEL_ID: 'hy3'};
const draft = {questions: [{question: '安装前要测量什么？', answer: '请先测量通道。', keyPoints: ['测量通道']}]};
const stats = {completion_tokens: 12, prompt_tokens: 20, total_tokens: 32};
const denied = 'AI+ 请求出错，错误码：EXCEED_TOKEN_QUOTA_LIMIT，错误信息：redacted-provider-message';

function envelope(output) {
  return {choices: [{finish_reason: 'stop', message: {role: 'assistant', content: JSON.stringify(output)}}]};
}
function harness(receive, configuration = env, reserve = () => true) {
  const calls = [];
  const reservations = [];
  const cloudApp = {ai: () => ({createModel(group) {
    return {async generateText(options) {
      calls.push({group, options});
      const raw = await receive();
      return {text: 'SDK convenience value', usage: {total_tokens: 0}, rawResponses: [raw]};
    }};
  }})};
  const client = createHunyuanClient({cloudApp, env: configuration});
  const db = {rpc: (name, args) => {reservations.push([name, args]); return {data: reserve()};}};
  return {calls, reservations, client,
    drafts: createCloudBaseDraftGeneration({env: configuration, client, db, prefix})};
}

test('both Shanghai groups expose draft generation only; a valid draft reserves exactly once', async () => {
  for (const [group, model] of [['cloudbase', 'hy3'], ['hunyuan-v3', 'hy3-preview']]) {
    const h = harness(() => ({...envelope(draft),usage:{...stats,internal:'ignored'}}),
      {...env, TCL_R24_SYNC_AI_MODEL_PROVIDER: group, TCL_R24_SYNC_AI_MODEL_ID: model});
    assert.equal(h.client.evaluate, undefined);
    assert.equal(h.drafts.source, 'cloudbase_hunyuan');
    assert.deepEqual(await h.drafts.generate(actor, '生成安装练习题。'), {...draft, model, retryCount: 0, httpStatus: 200, usage: stats});
    assert.equal(h.calls.length, 1);
    const [{group: calledGroup, options}] = h.calls;
    assert.equal(calledGroup, group);
    assert.equal(options.model, model);
    assert.equal(options.maxSteps, 1);
    assert.deepEqual(options.thinking, {type: 'disabled'});
    assert.deepEqual(options.response_format, {type: 'json_object'});
    assert.deepEqual(h.reservations, [[prefix + '_reserve_ai_draft', {p_daily_limit: 5}]]);
  }
});

test('invalid Hunyuan configuration fails closed before quota or SDK, including a misspelled group', async () => {
  for (const [group, model] of [['cloudbase', ''], ['cloudbase', 'hy3-preview'], ['hunyuan-v3', 'hy3'], ['unknown', 'hy3']]) {
    const h = harness(() => envelope(draft), {...env, TCL_R24_SYNC_AI_MODEL_PROVIDER: group, TCL_R24_SYNC_AI_MODEL_ID: model});
    await assert.rejects(h.drafts.generate(actor, '生成安装练习题。'), {code: model ? 'GATEWAY_CONFIG_INVALID' : 'GATEWAY_CONFIG_MISSING'});
    assert.equal(h.calls.length, 0);
    assert.equal(h.reservations.length, 0);
  }
});

test('upstream token exhaustion, ordinary rate limiting and local quota remain distinct with no model retry', async () => {
  for (const [receive, reserve, code, count] of [
    [() => {throw new Error(denied);}, () => true, 'HUNYUAN_TOKEN_QUOTA_EXCEEDED', 1],
    [() => {throw Object.assign(new Error('redacted-provider-message'), {status: 429});}, () => true, 'GATEWAY_HTTP_429', 1],
    [() => {throw new Error('untrusted raw text EXCEED_TOKEN_QUOTA_LIMIT');}, () => true, 'GATEWAY_NETWORK_ERROR', 1],
    [() => envelope(draft), () => false, 'AI_DRAFT_LIMIT', 0],
  ]) {
    const h = harness(receive, env, reserve);
    await assert.rejects(h.drafts.generate(actor, '生成安装练习题。'), error => {
      assert.equal(error.code, code);
      assert.equal(error.retryCount, 0);
      assert.doesNotMatch(JSON.stringify(error), /redacted-provider-message|untrusted raw text/);
      return true;
    });
    assert.equal(h.reservations.length, 1);
    assert.equal(h.calls.length, count);
  }
});

test('native draft rejects truncated or malformed responses', async () => {
  for (const raw of [
    null, {choices: []}, {choices: [envelope(draft).choices[0], envelope(draft).choices[0]]},
    {choices: [{...envelope(draft).choices[0], finish_reason:'length'}]},
    {choices: [{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(draft),refusal:'拒答'}}]},
    {...envelope(draft),model:'different-model'}, envelope({questions:[]}),
    envelope({value:'a'.repeat(256*1024)}),
  ]) {
    const h = harness(() => raw);
    await assert.rejects(h.drafts.generate(actor, '生成安装练习题。'), {code:'INVALID_AI_JSON',retryCount:0});
    assert.equal(h.calls.length,1);
  }
});

test('native generation honors the operator allowlist and feature gate', async () => {
  const h = harness(() => envelope(draft));
  await assert.rejects(h.drafts.generate({...actor, id: 'other'}, '生成题目。'), {code: 'AI_DRAFT_UNAVAILABLE'});
  assert.equal(h.calls.length, 0);
  const disabled = harness(() => envelope(draft), {...env, TCL_R24_SYNC_AI_ENABLED: 'false'});
  assert.equal(disabled.drafts, undefined);
  assert.equal(disabled.client.evaluate, undefined);
  assert.equal(disabled.reservations.length, 0);
});
