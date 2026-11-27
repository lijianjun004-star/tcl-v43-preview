import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../api.mjs';
import {createMemoryStore} from '../memory-store.mjs';
import {makeAssignment} from '../vendor/assignment-excel.mjs';
import {createAiGatewayClient, createHunyuanClient} from '../ai-gateway-client.mjs';
import {createCloudBaseEvaluationGeneration} from '../../cloudbase/ai-draft-provider.mjs';

const path = '/assignments/evaluate';
const prefix = 'tcl_r24_sync_test';
const env = {
  TCL_R24_SYNC_AI_ENABLED: 'true',
  AI_GATEWAY_URL: 'https://gateway.example.invalid',
  AI_GATEWAY_TOKEN: 'test-proxy-credential',
};
const accounts = Object.fromEntries([
  ['anchor', 'a1', 'anchor', '合成主播'], ['second', 'a2', 'anchor', '另一主播'],
  ['operator', 'o1', 'operator', '合成运营'], ['peer', 'o2', 'operator', '另一运营'],
  ['outside', 'a3', 'anchor', '合成主播'],
].map(([token, id, role, displayName]) => [token, {id, role, displayName, teamId: token === 'outside' ? 'other' : 'pilot', active: true}]));
const score = {
  overallScore: 75, grade: '良好',
  items: [{questionIndex: 0, score: 75, matchedPoints: ['核对尺寸'], missedPoints: ['咨询配送'],
    comment: '提到了测量，尚未说明需向配送人员确认。', suggestedScript: '请先核对包装和入户尺寸，再请配送人员确认。'}],
};
const usage = {prompt_tokens: 80, completion_tokens: 90, total_tokens: 170};

function reply(content = JSON.stringify(score), finish = 'stop', stats = usage) {
  return Response.json({choices: [{message: {role: 'assistant', content}, finish_reason: finish}], usage: stats});
}

async function fixture({configuration = env, reserve = () => ({data: true}), receive = () => reply(),
  nativeReceive, keyPoints = ['核对尺寸', '咨询配送']} = {}) {
  const store = createMemoryStore();
  const calls = [];
  const reservations = [];
  const waits = [];
  const client = nativeReceive ? createHunyuanClient({env: configuration, cloudApp: {
    ai: () => ({createModel: () => ({generateText(options) { calls.push(options); return nativeReceive(); }})}),
  }}) : createAiGatewayClient({env: configuration,
    fetchImpl: async (url, options) => { calls.push(JSON.parse(options.body)); return receive(calls.length, options); },
    sleep: async ms => { waits.push(ms); },
  });
  const db = {rpc(name, args) { reservations.push([name, args]); return reserve(reservations.length); }};
  const evaluationGeneration = createCloudBaseEvaluationGeneration({client, db, prefix, env: configuration});
  const api = createApi({store, evaluationGeneration, authenticate: async t => t === 'native-user' ? accounts.anchor : accounts[t],
    authenticateEvaluation: async t => accounts[t],
    directory: {listAnchors: async () => Object.values(accounts).filter(a => a.role === 'anchor')}});
  async function call(method = 'POST', pathname = path, token = 'anchor', body) {
    const res = await api(new Request('https://training.example.invalid' + pathname, {method,
      headers: {'content-type': 'application/json', ...(token ? {authorization: 'Bearer ' + token} : {})},
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
    return {status: res.status, ...await res.json()};
  }
  const frozen = await makeAssignment({id: 'eval-demo', title: '合成入户问答', operatorName: accounts.operator.displayName,
    boardId: '01', platform: '京东', assignedTo: [],
    questions: [{category: 'TCL 电视', question: '电视能否搬进电梯？', answer: '核对包装和通道尺寸后请配送人员确认。', keyPoints}],
    createdAt: '2026-11-24T00:00:00.000Z', deadline: ''});
  assert.equal((await call('POST', '/assignments', 'operator', {assignment: frozen, recipientIds: []})).status, 201);
  const q = frozen.questions[0];
  const snapshot = {id: 'fixture-session', assignmentId: frozen.id, assignmentVersion: frozen.version,
    assignmentSnapshotSha256: frozen.snapshotSha256, operatorName: frozen.operatorName,
    boardId: frozen.boardId, platform: frozen.platform, anchorName: accounts.anchor.displayName,
    turns: [{questionId: q.id, question: q.question, answer: '请测量电梯门的宽度。', transcript: '请测量电梯门的宽度。',
      model: q.model, sku: q.sku, asrStatus: '已人工核对'}]};
  const base = '/assignments/' + frozen.id;
  return {store, snapshot, calls, reservations, waits, call, q, base,
    evaluate: (s = snapshot, token = 'anchor') => call('POST', path, token, {snapshot: s}),
    submit: (s = snapshot, evaluationId, token = 'anchor') => call('POST', base + '/submissions', token, {snapshot: s, evaluationId})};
}

test('bound anchor grades against frozen rubric, persists immutable result only with matching submitted answers', async () => {
  const f = await fixture();
  // Untrusted local hints are not the assignment rubric.
  f.snapshot.turns[0].keyPoints = ['客户合成伪造内容'];
  f.snapshot.turns[0].referenceAnswer = '客户合成伪造内容';
  const scored = await f.evaluate();
  assert.equal(scored.status, 200);
  assert.match(scored.evaluationId, /^[a-f0-9]{64}$/);
  assert.match(scored.requestId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(scored.evaluation, {...score, requestId: scored.requestId, model: 'gpt-4o-mini',
    source: 'openai_gateway', degraded: false, usage});
  assert.equal(JSON.stringify(f.calls[0]).includes('客户合成伪造内容'), false);
  assert.equal(JSON.stringify(f.calls[0]).includes(f.snapshot.anchorName), false);
  assert.equal(JSON.stringify(f.calls[0]).includes(f.q.answer), true);
  assert.deepEqual(f.reservations, [[prefix + '_reserve_ai_draft', {p_daily_limit: 5}]]);
  assert.deepEqual((await f.call('GET', f.base + '/submissions', 'operator')).submissions, []);
  assert.deepEqual((await f.evaluate()).evaluation, scored.evaluation);
  assert.equal(f.calls.length, 1);

  const wrong = structuredClone(f.snapshot);
  wrong.turns[0].answer = '修改了本次最终回答。';
  assert.equal((await f.submit(wrong, scored.evaluationId)).error.code, 'AI_EVALUATION_MISMATCH');
  const impersonation = {...f.snapshot, anchorName: accounts.second.displayName};
  assert.equal((await f.submit(impersonation, scored.evaluationId, 'second')).error.code, 'AI_EVALUATION_MISMATCH');
  assert.equal((await f.submit({...f.snapshot, id: 'other-session'}, scored.evaluationId)).error.code, 'AI_EVALUATION_MISMATCH');
  assert.equal((await f.submit(f.snapshot, 'bad')).status, 422);
  const submitted = await f.submit(f.snapshot, scored.evaluationId);
  assert.equal(submitted.status, 201);
  assert.deepEqual(submitted.submission.evaluation, scored.evaluation);
  assert.equal((await f.submit(f.snapshot, scored.evaluationId)).replayed, true);
  assert.deepEqual((await f.evaluate()).evaluation, scored.evaluation);
  assert.equal((await f.evaluate(wrong)).error.code, 'AI_EVALUATION_ALREADY_SUBMITTED');
  assert.equal(f.calls.length, 1);
  const log = await f.call('GET', f.base + '/submissions', 'operator');
  assert.deepEqual(log.submissions[0].evaluation, scored.evaluation);
  assert.deepEqual((await f.call('GET', f.base + '/my-submissions', 'anchor')).submissions[0].evaluation, scored.evaluation);
  assert.equal((await f.call('GET', f.base + '/submissions', 'peer')).status, 404);
});

test('legacy unscored submission and client-supplied scores cannot manufacture or append an AI result', async () => {
  const f = await fixture();
  const submission = await f.call('POST', f.base + '/submissions', 'anchor',
    {snapshot: {...f.snapshot, evaluation: score}, evaluation: score});
  assert.equal(submission.status, 201);
  assert.ok(!Object.hasOwn(submission.submission, 'evaluation'));
  assert.ok(!Object.hasOwn((await f.call('GET', f.base + '/submissions', 'operator')).submissions[0], 'evaluation'));
  assert.equal((await f.evaluate()).error.code, 'AI_EVALUATION_ALREADY_SUBMITTED');
  assert.equal(f.calls.length, 0);
});

test('auth, rubric, frozen context and input bounds reject invalid evaluation before spending quota', async () => {
  const f = await fixture();
  assert.equal((await f.call('GET', '/me', 'native-user')).status, 200);
  for (const [token, status] of [['', 401], ['native-user', 401], ['operator', 403], ['outside', 404]]) {
    const failure = await f.evaluate(f.snapshot, token);
    assert.equal(failure.status, status);
    assert.ok(failure.requestId);
  }
  for (const changes of [
    {turns: []}, {turns: Array(16).fill(f.snapshot.turns[0])},
    {turns: [{...f.snapshot.turns[0], answer: ''}]},
    {turns: [{...f.snapshot.turns[0], manualCleared: true}]},
    {turns: [{...f.snapshot.turns[0], answer: '甲乙'.repeat(2001)}]},
    {assignmentSnapshotSha256: '0'.repeat(64)}, {anchorName: accounts.second.displayName},
    {turns: [{...f.snapshot.turns[0], question: '不是原题'}]},
  ]) {
    const failure = await f.evaluate({...f.snapshot, ...changes});
    assert.equal(failure.status, 422);
    assert.equal(failure.evaluation, undefined);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.reservations.length, 0);
  const emptyRubric = await fixture({keyPoints: []});
  assert.equal((await emptyRubric.evaluate()).error.code, 'AI_EVALUATION_INPUT_INVALID');
  assert.equal(emptyRubric.calls.length, 0);
});

test('missing gateway yields request ID, quota denial uses zero HTTP, and text submission remains available', async () => {
  for (const [settings, code, status, quotaCount] of [
    [{configuration: {...env, AI_GATEWAY_URL: ''}}, 'GATEWAY_CONFIG_MISSING', 503, 0],
    [{configuration: {...env, TCL_R24_SYNC_AI_ENABLED: 'false'}}, 'AI_EVALUATION_DISABLED', 403, 0],
    [{reserve: () => ({data: false})}, 'AI_EVALUATION_LIMIT', 429, 1],
    [{reserve: () => ({error: {message: 'private internal detail'}})}, 'AI_EVALUATION_QUOTA_UNAVAILABLE', 503, 1],
  ]) {
    const f = await fixture(settings);
    const fail = await f.evaluate();
    assert.equal(fail.status, status);
    assert.equal(fail.error.code, code);
    assert.ok(fail.requestId && !fail.evaluation);
    assert.equal(JSON.stringify(fail).includes('private internal detail'), false);
    assert.equal(f.calls.length, 0);
    assert.equal(f.reservations.length, quotaCount);
    assert.equal((await f.submit()).status, 201);
  }
});

test('empty and truncated results fail closed; a completed score with missing usage retains null', async () => {
  for (const receive of [() => reply('{}'), () => reply('{invalid'), () => reply(JSON.stringify(score), 'length')]) {
    const f = await fixture({receive});
    const failure = await f.evaluate();
    assert.equal(failure.status, 502);
    assert.equal(failure.error.code, 'INVALID_AI_JSON');
    assert.equal(failure.evaluation, undefined);
    assert.equal(f.calls.length, 1);
    assert.equal((await f.submit()).submission.evaluation, undefined);
  }
  const f = await fixture({receive: () => reply(JSON.stringify(score), 'stop', null)});
  const snapshot = structuredClone(f.snapshot);
  delete snapshot.turns[0].answer; // An ASR-only caller supplies transcript.
  assert.equal((await f.evaluate(snapshot)).evaluation.usage, null);
});

test('401 is terminal; 429, 502 and a timeout use one 1500ms backoff and one reservation per attempt', async () => {
  const auth = await fixture({receive: () => new Response(null, {status: 401})});
  assert.equal((await auth.evaluate()).error.code, 'GATEWAY_HTTP_401');
  assert.deepEqual(auth.waits, []);
  assert.equal(auth.calls.length, 1);
  for (const fail of [429, 502, 'timeout']) {
    const f = await fixture({configuration: {...env, AI_GATEWAY_TIMEOUT_MS: '25'},
      receive: (n, options) => {
        if (n === 2) return reply();
        if (fail === 'timeout') return new Promise((_, reject) =>
          options.signal.addEventListener('abort', () => reject(new Error('timeout')), {once: true}));
        return new Response(null, {status: fail});
      }});
    assert.equal((await f.evaluate()).status, 200);
    assert.equal(f.calls.length, 2);
    assert.equal(f.reservations.length, 2);
    assert.deepEqual(f.waits, [1500]);
  }
});

test('native Shanghai scores keep model provenance through submission, retries and operator replay', async () => {
  const configuration = {TCL_R24_SYNC_AI_ENABLED: 'true', TCL_R24_SYNC_AI_MODEL_PROVIDER: 'cloudbase', TCL_R24_SYNC_AI_MODEL_ID: 'hy3'};
  const nativeReceive = async () => ({rawResponses: [await reply().json()]});
  const f = await fixture({configuration, nativeReceive});
  const scored = await f.evaluate();
  assert.equal(scored.status, 200);
  assert.deepEqual(scored.evaluation, {...score, model: 'hy3', source: 'cloudbase_hunyuan',
    requestId: scored.requestId, usage, degraded: false});
  assert.deepEqual((await f.submit(f.snapshot, scored.evaluationId)).submission.evaluation, scored.evaluation);
  assert.deepEqual((await f.call('GET', f.base + '/submissions', 'operator')).submissions[0].evaluation, scored.evaluation);
  assert.deepEqual((await f.evaluate()).evaluation, scored.evaluation);
  assert.equal(f.calls.length, 1);
  assert.equal(f.reservations.length, 1);

  const exhausted = await fixture({configuration, nativeReceive() {
    throw new Error('AI+ 请求出错，错误码：EXCEED_TOKEN_QUOTA_LIMIT，错误信息：private-diagnostic');
  }});
  const denied = await exhausted.evaluate();
  assert.equal(denied.status, 503);
  assert.equal(denied.error.code, 'HUNYUAN_TOKEN_QUOTA_EXCEEDED');
  assert.match(denied.error.message, /腾讯云混元模型额度/);
  assert.match(denied.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(denied.evaluation, undefined);
  assert.equal(JSON.stringify(denied).includes('private-diagnostic'), false);
  assert.equal((await exhausted.submit()).submission.evaluation, undefined);
  assert.equal(exhausted.calls.length, 1);
});
