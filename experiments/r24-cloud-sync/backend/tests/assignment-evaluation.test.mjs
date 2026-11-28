import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../api.mjs';
import {createMemoryStore} from '../memory-store.mjs';
import {makeAssignment, sha256Hex} from '../vendor/assignment-excel.mjs';
import {createHunyuanClient} from '../ai-gateway-client.mjs';
import {createCloudBaseDraftGeneration} from '../../cloudbase/ai-draft-provider.mjs';

const path = '/assignments/evaluate';
const prefix = 'tcl_r24_sync_test';
const env = {TCL_R24_SYNC_AI_ENABLED:'true', TCL_R24_SYNC_AI_OPERATOR_IDS:'o1',
  TCL_R24_SYNC_AI_MODEL_PROVIDER:'cloudbase', TCL_R24_SYNC_AI_MODEL_ID:'hy3'};
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

async function fixture({keyPoints = ['核对尺寸', '咨询配送'], store = createMemoryStore(), draftEnv = env, manual = false} = {}) {
  const counters = {legacyEvalCalls:0, cloudModelCalls:0, quotaReservations:0};
  const client = createHunyuanClient({env:draftEnv, cloudApp:{ai:() => ({createModel:() => ({
    generateText() {
      counters.cloudModelCalls++;
      const content=JSON.stringify({questions:[{question:'电视如何入户？',answer:'请核对包装尺寸及通道宽度。',keyPoints:['核对尺寸']}]});
      return {rawResponses:[{choices:[{finish_reason:'stop',message:{role:'assistant',content}}]}]};
    },
  })})}});
  const db = {rpc() {counters.quotaReservations++; return {data: true};}};
  const draftGeneration = createCloudBaseDraftGeneration({client,db,prefix,env:draftEnv});
  const api = createApi({store,draftGeneration,logDraft:()=>{},
    evaluationGeneration:{source:'cloudbase_hunyuan',model:'hy3',evaluate(){
      counters.legacyEvalCalls++;
      if (!manual) throw Error('unexpected manual evaluation');
      return {...score,httpStatus:200,model:'hy3',usage};
    }},
    authenticate: async t => t === 'native-user' ? accounts.anchor : accounts[t],
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
  return {store, snapshot, counters, call, q, base,
    evaluate: (s = snapshot, token = 'anchor') => call('POST', path, token, {snapshot: s}),
    submit: (s = snapshot, evaluationId, token = 'anchor') => call('POST', base + '/submissions', token, {snapshot: s, evaluationId})};
}

function assertNoScoringCalls(f) {
  assert.deepEqual(f.counters,{legacyEvalCalls:0,cloudModelCalls:0,quotaReservations:0});
}

async function seedHistorical(f, model) {
  const sessionKey = await sha256Hex(['pilot','a1',f.snapshot.assignmentId,f.snapshot.id]);
  const evaluationId = await sha256Hex(['evaluation-v1',sessionKey,f.snapshot.assignmentSnapshotSha256,
    f.snapshot.turns.map(t => [t.questionId,t.answer,t.transcript])]);
  const evaluation = {...score, requestId:'frozen-history', model,
    source:model==='hy3'?'cloudbase_hunyuan':'openai_gateway', usage, degraded:false};
  await f.store.createEvaluation({id:evaluationId, teamId:'pilot', anchorId:'a1', assignmentId:f.snapshot.assignmentId, evaluation});
  return {evaluationId, evaluation};
}

test('bound anchor reads immutable historical results and can attach only a matching evaluation', async () => {
  const f = await fixture();
  const scored = await seedHistorical(f, 'hy3');
  assert.deepEqual((await f.evaluate()).evaluation, scored.evaluation);
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
  assertNoScoringCalls(f);
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
  assertNoScoringCalls(f);
});

test('upgraded clients omit the old evaluation ID; one exact trusted candidate is attached on concurrent submit', async () => {
  const f = await fixture({draftEnv:{}});
  const historical = await seedHistorical(f, 'hy3');
  const responses = await Promise.all([f.submit(), f.submit()]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200,201]);
  for (const response of responses) {
    assert.deepEqual(response.submission.evaluation, historical.evaluation);
  }
  const persisted = await f.store.getSubmission(responses[0].submission.id);
  assert.equal(persisted.evaluationId, historical.evaluationId);
  assert.deepEqual((await f.evaluate()).evaluation, historical.evaluation);
  assertNoScoringCalls(f);
});

test('an altered answer, transcript, session or account cannot reuse another historical candidate', async () => {
  for (const field of ['answer','transcript','session','account']) {
    const f = await fixture();
    await seedHistorical(f,'hy3');
    const snapshot = structuredClone(f.snapshot);
    if (field === 'session') snapshot.id = 'other-session';
    else if (field === 'account') snapshot.anchorName = accounts.second.displayName;
    else snapshot.turns[0][field] = '请实际测量电梯门和通道。';
    const response = await f.submit(snapshot, undefined, field === 'account' ? 'second' : 'anchor');
    assert.equal(response.status,201);
    assert.equal(response.submission.evaluation,undefined);
    assertNoScoringCalls(f);
  }
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
  assertNoScoringCalls(f);
  const emptyRubric = await fixture({keyPoints: []});
  assert.equal((await emptyRubric.evaluate()).error.code, 'AI_EVALUATION_INPUT_INVALID');
  assertNoScoringCalls(emptyRubric);
});

test('new legacy requests consistently direct users to submit; draft generation still works independently', async t => {
  const f = await fixture();
  const calls = await Promise.all([f.evaluate(),f.evaluate()]);
  for (const res of calls) {
    assert.equal(res.status,409);
    assert.equal(res.error.code,'AI_EVALUATION_AFTER_SUBMIT');
    assert.match(res.error.message,/提交后自动评分/);
    assert.ok(res.requestId);
    assert.equal(res.evaluation,undefined);
  }
  const legacy = structuredClone(f.snapshot);
  delete legacy.turns[0].answer;
  assert.equal((await f.evaluate(legacy)).error.code,'AI_EVALUATION_AFTER_SUBMIT');
  assert.equal((await f.submit()).status,201);
  assertNoScoringCalls(f);
  t.diagnostic('After two concurrent evaluation requests, a transcript-only request and submission: ' + JSON.stringify(f.counters));
  const published = await f.call('POST','/assignments/draft','operator',{
    boardId:'01',platform:'京东',material:'合成资料，电视包装需要先核对尺寸。',count:1,
  });
  assert.equal(published.status,200);
  assert.equal(published.source,'cloudbase_hunyuan');
  assert.deepEqual(f.counters,{legacyEvalCalls:0,cloudModelCalls:1,quotaReservations:1});
  t.diagnostic('After one authorized operator draft with the same adapter: ' + JSON.stringify(f.counters));
});

test('existing OpenAI cache remains readable with cloud generation disabled and no model configured', async () => {
  const f=await fixture({draftEnv:{}});
  assert.equal((await f.call('GET','/assignments/draft','operator')).available,false);
  const original=await seedHistorical(f,'gpt-4o-mini');
  assert.deepEqual((await f.evaluate()).evaluation,original.evaluation);
  assertNoScoringCalls(f);
});

test('storage failure, malformed payload and revoked identity never activate a provider fallback', async t => {
  const store=createMemoryStore();
  const readHistory=store.getEvaluation;
  store.getEvaluation=async()=>{throw Error('private database detail');};
  const f=await fixture({store});
  const cacheFailure=await f.evaluate();
  assert.equal(cacheFailure.status,503);
  assert.equal(cacheFailure.error.code,'AI_EVALUATION_HISTORY_UNAVAILABLE');
  assert.ok(!JSON.stringify(cacheFailure).includes('private database detail'));
  assert.equal((await f.call('POST',path,'anchor',{snapshot:null})).status,422);
  assert.equal((await f.evaluate(f.snapshot,'revoked')).status,401);
  assert.equal((await f.submit()).error.code,'AI_EVALUATION_HISTORY_UNAVAILABLE');
  assert.deepEqual((await f.call('GET',f.base+'/submissions','operator')).submissions,[]);
  store.getEvaluation=readHistory;
  const previous=await seedHistorical(f,'hy3');
  const retry=await f.submit();
  assert.equal(retry.status,201);
  assert.deepEqual(retry.submission.evaluation,previous.evaluation);
  assertNoScoringCalls(f);
  t.diagnostic('After temporary history failure 503, malformed snapshot 422, revoked credential 401 and recovered submission: ' + JSON.stringify(f.counters));
});

test('mixed enrollment is resolved using the authenticated tuple before invoking the legacy model', async () => {
  const observed=[];
  const store=createMemoryStore();
  let enabled=false;
  store.canAutoScore=async (assignmentId,principal)=>{
    observed.push([assignmentId,principal.teamId,principal.id]);
    return enabled;
  };
  const f=await fixture({store,manual:true});
  const list=await f.call('GET','/assignments','anchor');
  assert.equal(list.assignments[0].autoScore,false);
  const legacy=await f.evaluate();
  assert.equal(legacy.status,200);
  assert.equal(legacy.evaluation.model,'hy3');
  assert.equal(f.counters.legacyEvalCalls,1);
  enabled=true;
  const fresh={...f.snapshot,id:'another-session'};
  assert.equal((await f.evaluate(fresh)).error.code,'AI_EVALUATION_AFTER_SUBMIT');
  store.canAutoScore=async()=>{throw Error('unavailable')};
  assert.equal((await f.evaluate(fresh)).status,500);
  assert.equal(f.counters.legacyEvalCalls,1);
  assert.ok(observed.length>=3);
  assert.ok(observed.every(([id,team,anchor])=>id===f.snapshot.assignmentId&&team===accounts.anchor.teamId&&anchor===accounts.anchor.id));
});
