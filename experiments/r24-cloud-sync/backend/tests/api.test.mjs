import test from 'node:test';
import assert from 'node:assert/strict';

import { createApi } from '../api.mjs';
import { createMemoryStore } from '../memory-store.mjs';
import { makeAssignment } from '../vendor/assignment-excel.mjs';

const allowedOrigin = 'https://preview.example.test';
const identities = {
  publisher: { id: 'o1', teamId: 't1', role: 'operator', displayName: '李运营', active: true },
  peer: { id: 'o2', teamId: 't1', role: 'operator', displayName: '李运营', active: true },
  anchor: { id: 'a1', teamId: 't1', role: 'anchor', displayName: '陈主播', active: true },
  otherAnchor: { id: 'a2', teamId: 't1', role: 'anchor', displayName: '李主播', active: true },
  outside: { id: 'a3', teamId: 't2', role: 'anchor', displayName: '陈主播', active: true },
  disabled: { id: 'a4', teamId: 't1', role: 'anchor', displayName: '陈主播', active: false },
};

function fixture(media, notifyRepositoryQueue) {
  const store = createMemoryStore();
  const accounts = structuredClone(identities);
  let now = '2026-11-24T11:00:00.000Z';
  const handle = createApi({
    authenticate: async token => accounts[token] ?? null,
    directory: { listAnchors: async () => Object.values(accounts) },
    store, media, notifyRepositoryQueue,
    now: () => new Date(now),
    allowedOrigins: [allowedOrigin],
    basePath: '/qa-sync',
  });

  async function call(method, pathname, token, body, headers = {}) {
    const request = new Request('https://service.example.test/qa-sync' + pathname, {
      method,
      headers: {
        ...token && { Authorization: 'Bearer ' + token },
        ...body !== undefined && { 'Content-Type': 'application/json' },
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await handle(request);
    return { status: response.status, headers: response.headers, data: response.status === 204 ? null : await response.json() };
  }
  return { handle, accounts, call, store, setTime: value => { now = value; } };
}

async function make(overrides = {}) {
  return makeAssignment({
    id: 'qa3-test-a',
    title: '运营练播任务',
    operatorName: identities.publisher.displayName,
    boardId: '01',
    platform: '京东',
    deadline: '2026-11-24T12:00:00.000Z',
    createdAt: '2026-11-20T12:00:00.000Z',
    assignedTo: [],
    questions: [
      { category: 'TCL 电视', question: '怎样选择电视尺寸？', answer: '结合家庭观看距离推荐尺寸。', model: 'Q10', sku: '0001' },
      { category: 'TCL 电视', question: '这是什么技术？', answer: '它通过分区调节亮度改善电视对比度。' },
    ],
    ...overrides,
  });
}

function practice(assignment, overrides = {}) {
  return {
    id: 'session-a',
    assignmentId: assignment.id,
    assignmentVersion: assignment.version,
    assignmentSnapshotSha256: assignment.snapshotSha256,
    operatorName: assignment.operatorName,
    boardId: assignment.boardId,
    platform: assignment.platform,
    anchorName: identities.anchor.displayName,
    submittedAt: '1970-01-01T00:00:00.000Z',
    turns: assignment.questions.map(({ id, question, model, sku }) => ({
      questionId: id,
      question,
      answer: '会考虑家庭情况给出推荐。',
      transcript: '会考虑家庭情况给出推荐。',
      asrStatus: '识别成功',
      model,
      sku,
      score: 100,
    })),
    ...overrides,
  };
}

function submissionsPath(assignment) {
  return '/assignments/' + encodeURIComponent(assignment.id) + '/submissions';
}

test('authenticator controls identity, team, role, and activation', async () => {
  const { call } = fixture();
  assert.equal((await call('GET', '/me')).status, 401);
  assert.equal((await call('GET', '/me', 'disabled')).status, 401);
  assert.deepEqual((await call('GET', '/me', 'anchor')).data, {
    principal: { id: 'a1', role: 'anchor', displayName: '陈主播' },
  });
  assert.equal((await call('POST', '/assignments', 'anchor', { role: 'operator' })).status, 403);
  assert.equal((await call('GET', '/recipients', 'anchor')).status, 403);
  assert.deepEqual((await call('GET', '/recipients', 'publisher')).data, {
    recipients: [{ id: 'a1', displayName: '陈主播' }, { id: 'a2', displayName: '李主播' }],
  });
});

test('public publishing validates QA3 hash, board and publisher; visibility stays within team', async () => {
  const { call } = fixture();
  const assignment = await make();
  const tampered = { ...assignment, title: '变更内容' };
  assert.equal((await call('POST', '/assignments', 'publisher', { assignment: tampered, recipientIds: [] })).data.error.code,
    'ASSIGNMENT_INVALID');
  const wrongBoard = await make({ boardId: '02' });
  assert.equal((await call('POST', '/assignments', 'publisher', { assignment: wrongBoard, recipientIds: [] })).status, 422);
  const wrongPublisher = await make({ operatorName: '别人姓名' });
  assert.equal((await call('POST', '/assignments', 'publisher', { assignment: wrongPublisher, recipientIds: [] })).data.error.code,
    'PUBLISHER_MISMATCH');
  const response = await call('POST', '/assignments', 'publisher', { assignment, recipientIds: [] });
  assert.equal(response.status, 201);
  assert.deepEqual(response.data.assignment, assignment);
  assert.equal(response.data.publishedAt, '2026-11-24T11:00:00.000Z');
  assert.equal((await call('GET', '/assignments', 'anchor')).data.assignments[0].submitted, false);
  assert.equal((await call('GET', '/assignments', 'otherAnchor')).data.assignments.length, 1);
  assert.equal((await call('GET', '/assignments', 'outside')).data.assignments.length, 0);
  assert.equal((await call('GET', '/assignments', 'peer')).data.assignments.length, 0);
});

test('named assignment uses IDs from trusted directory instead of same-name or out-of-team actors', async () => {
  const { call } = fixture();
  const assignment = await make({ assignedTo: ['陈主播'] });
  assert.equal((await call('POST', '/assignments', 'publisher', { assignment, recipientIds: ['a3'] })).status, 422);
  assert.equal((await call('POST', '/assignments', 'publisher', { assignment, recipientIds: ['a2'] })).status, 422);
  assert.equal((await call('POST', '/assignments', 'publisher', { assignment, recipientIds: ['a1'] })).status, 201);
  assert.equal((await call('GET', '/assignments', 'anchor')).data.assignments.length, 1);
  assert.equal((await call('GET', '/assignments', 'otherAnchor')).data.assignments.length, 0);
  assert.equal((await call('POST', submissionsPath(assignment), 'outside', { snapshot: practice(assignment) })).status, 404);
});

test('parallel publish is idempotent and cannot overwrite an existing snapshot, including after a name change', async () => {
  const { call, accounts, setTime } = fixture();
  const assignment = await make();
  const body = { assignment, recipientIds: [] };
  const original = await Promise.all([
    call('POST', '/assignments', 'publisher', body),
    call('POST', '/assignments', 'publisher', body),
  ]);
  assert.deepEqual(original.map(row => row.status).sort(), [200, 201]);
  setTime('2026-11-25T11:00:00.000Z');
  accounts.publisher.displayName = '运营改名';
  const replay = await call('POST', '/assignments', 'publisher', body);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.publishedAt, '2026-11-24T11:00:00.000Z');
  assert.equal((await call('POST', '/assignments', 'peer', body)).status, 409);
  const changed = await make({ title: '变更内容', operatorName: accounts.publisher.displayName });
  assert.equal((await call('POST', '/assignments', 'publisher', { ...body, assignment: changed })).status, 409);
  assert.deepEqual((await call('GET', '/assignments', 'publisher')).data.assignments[0].assignment, assignment);
});

test('complete submission binds actor ID and frozen assignment and records server receipt time', async () => {
  const { call, setTime } = fixture();
  const assignment = await make();
  await call('POST', '/assignments', 'publisher', { assignment, recipientIds: [] });
  const path = submissionsPath(assignment);
  const snapshot = practice(assignment);
  assert.equal((await call('POST', path, 'publisher', { snapshot })).status, 403);
  assert.equal((await call('POST', path, 'otherAnchor', { snapshot })).data.error.code, 'SUBMITTER_MISMATCH');
  assert.equal((await call('POST', path, 'anchor', { snapshot: { ...snapshot, assignmentSnapshotSha256: 'x'.repeat(64) } })).status, 422);
  assert.equal((await call('POST', path, 'anchor', { snapshot: { ...snapshot, turns: snapshot.turns.toReversed() } })).status, 422);
  assert.equal((await call('POST', path, 'anchor', { snapshot: { ...snapshot, turns: [] } })).status, 422);
  const cleared = { ...snapshot, turns: [{ ...snapshot.turns[0], manualCleared: true }, snapshot.turns[1]] };
  assert.equal((await call('POST', path, 'anchor', { snapshot: cleared })).status, 422);

  setTime('2026-11-24T12:00:00.000Z');
  const receipt = await call('POST', path, 'anchor', { snapshot, anchorId: 'spoof-id' });
  assert.equal(receipt.status, 201);
  assert.equal(receipt.data.submission.anchorId, 'a1');
  assert.equal(receipt.data.submission.anchorName, '陈主播');
  assert.equal(receipt.data.submission.submittedAt, '2026-11-24T12:00:00.000Z');
  assert.equal(receipt.data.submission.late, true);
  assert.equal(Object.hasOwn(receipt.data.submission, 'payloadHash'), false);
  assert.equal(Object.hasOwn(receipt.data.submission.turns[0], 'score'), false);
  assert.equal((await call('GET', path, 'anchor')).status, 403);
  assert.equal((await call('GET', path, 'peer')).status, 404);
  assert.deepEqual((await call('GET', path, 'publisher')).data.submissions, [{...receipt.data.submission, audio: []}]);
  const state = (await call('GET', '/assignments', 'anchor')).data.assignments[0];
  assert.equal(state.submitted, true);
  assert.equal(state.lastSubmittedAt, '2026-11-24T12:00:00.000Z');
  assert.equal((await call('GET', '/assignments', 'otherAnchor')).data.assignments[0].submitted, false);
});

test('retry does not duplicate a submission or change its server time; second anchor can have same practice session ID', async () => {
  const { call, accounts, setTime } = fixture();
  const assignment = await make();
  await call('POST', '/assignments', 'publisher', { assignment, recipientIds: [] });
  const path = submissionsPath(assignment);
  const snapshot = practice(assignment);
  const original = await Promise.all([
    call('POST', path, 'anchor', { snapshot }),
    call('POST', path, 'anchor', { snapshot }),
  ]);
  assert.deepEqual(original.map(row => row.status).sort(), [200, 201]);
  setTime('2026-11-25T10:12:00.000Z');
  accounts.anchor.displayName = '主播改名';
  const replay = await call('POST', path, 'anchor', { snapshot });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(replay.data.submission, original[0].data.submission);
  const edited = { ...snapshot, turns: [{ ...snapshot.turns[0], answer: '改为另一份作业回答' }, snapshot.turns[1]] };
  assert.equal((await call('POST', path, 'anchor', { snapshot: edited })).status, 409);
  const other = { ...snapshot, anchorName: accounts.otherAnchor.displayName };
  assert.equal((await call('POST', path, 'otherAnchor', { snapshot: other })).status, 201);
  assert.equal((await call('GET', path, 'publisher')).data.submissions.length, 2);
});

test('limits on content type, body size, CORS and invalid cursors', async () => {
  const { call, handle } = fixture();
  const origin = await call('OPTIONS', '/me', null, undefined, { Origin: allowedOrigin });
  assert.equal(origin.status, 204);
  assert.equal(origin.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
  const unlisted = await call('OPTIONS', '/me', null, undefined, { Origin: 'https://other.example.test' });
  assert.equal(unlisted.status, 403);
  assert.equal(unlisted.headers.get('Access-Control-Allow-Origin'), null);
  const response = await call('GET', '/me', 'publisher', undefined, { Origin: allowedOrigin });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await call('POST', '/assignments', 'publisher', {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await call('POST', '/assignments', 'publisher', { extra: '多'.repeat(335_000) })).status, 413);
  assert.equal((await call('GET', '/assignments?cursor=bad', 'anchor')).status, 400);
  assert.equal((await handle(new Request('https://service.example.test/me', { headers: { Authorization: 'Bearer publisher' } }))).status, 404);
});

test('pagination does not skip same-time assignments and stays viewer scoped', async () => {
  const { call } = fixture();
  for (let i = 0; i < 21; i++) {
    const assignment = await make({ id: 'p-' + String(i).padStart(2, '0') });
    assert.equal((await call('POST', '/assignments', 'publisher', { assignment, recipientIds: [] })).status, 201);
  }
  const { data: first } = await call('GET', '/assignments', 'anchor');
  assert.equal(first.assignments.length, 20);
  assert.ok(first.nextCursor);
  const { data: second } = await call('GET', '/assignments?cursor=' + first.nextCursor, 'anchor');
  assert.equal(second.assignments.length, 1);
  assert.equal(second.assignments[0].assignment.id, 'p-00');
  assert.equal(second.nextCursor, null);
  const { data: outside } = await call('GET', '/assignments?cursor=' + first.nextCursor, 'outside');
  assert.deepEqual(outside, { assignments: [], nextCursor: null });
});

test('claim and operator progress are identity-scoped and retries keep the same timestamp', async () => {
  const {call, setTime} = fixture();
  const assignment = await make();
  await call('POST', '/assignments', 'publisher', {assignment, recipientIds: []});
  const prefix='/assignments/'+assignment.id;
  assert.equal((await call('POST',prefix+'/claim','outside',{})).status,404);
  assert.equal((await call('POST',prefix+'/claim','publisher',{})).status,403);
  const first=await call('POST',prefix+'/claim','anchor',{});
  assert.equal(first.status,201);
  setTime('2026-11-24T11:40:00.000Z');
  const repeat=await call('POST',prefix+'/claim','anchor',{});
  assert.deepEqual(repeat.data,{claimedAt:first.data.claimedAt,replayed:true});
  assert.equal((await call('GET',prefix+'/progress','peer')).status,404);
  const p=(await call('GET',prefix+'/progress','publisher')).data.claims;
  assert.deepEqual(p,[{anchorId:'a1',anchorName:'陈主播',claimedAt:first.data.claimedAt,submittedAt:null}]);
  assert.equal((await call('GET','/assignments','anchor')).data.assignments[0].claimedAt,first.data.claimedAt);
});

test('private audio is separately retried, verified, size-limited and restricted to owner or author', async () => {
  let fail=true;
  const objects=new Map();
  const {call}=fixture({
    async put(key,mime,bytes){if(fail)throw new Error('storage offline');objects.set(key,Buffer.from(bytes));},
    async get(key){return objects.get(key);},
  });
  const assignment=await make();
  await call('POST','/assignments','publisher',{assignment,recipientIds:[]});
  const path=submissionsPath(assignment);
  const saved=(await call('POST',path,'anchor',{snapshot:practice(assignment)})).data.submission;
  const upload=path+'/'+saved.id+'/audio';
  const questionId=saved.turns[0].questionId;
  const waveform=Buffer.from('524946460000000057415645','hex');
  const body={questionId,mimeType:'audio/wav',base64:waveform.toString('base64')};
  assert.equal((await call('POST',upload,'otherAnchor',body)).status,404);
  assert.equal((await call('POST',upload,'publisher',body)).status,403);
  assert.equal((await call('POST',upload,'anchor',{...body,base64:Buffer.alloc(524289).toString('base64')})).status,413);
  assert.equal((await call('POST',upload,'anchor',{...body,mimeType:'audio/webm'})).status,422);
  assert.equal((await call('POST',upload,'anchor',body)).data.error.code,'AUDIO_UPLOAD_PENDING');
  const waiting=(await call('GET',path,'publisher')).data.submissions;
  assert.deepEqual(waiting[0].turns,saved.turns);
  assert.deepEqual(waiting[0].audio,[]);
  fail=false;
  const retry=await call('POST',upload,'anchor',body);
  assert.equal(retry.status,200);
  assert.equal((await call('POST',upload,'anchor',body)).data.replayed,true);
  assert.equal(objects.size,1);
  const playback=upload+'?questionId='+encodeURIComponent(questionId);
  assert.equal((await call('GET',playback,'otherAnchor')).status,404);
  assert.equal((await call('GET',playback,'peer')).status,404);
  assert.deepEqual((await call('GET',playback,'publisher')).data,
    {mimeType:body.mimeType,base64:body.base64});
});

test('only a new committed waiting review wakes the repository; wake outages do not lose texts', async () => {
  let wakes = 0;
  const {call, store} = fixture(undefined, async (...args) => {
    wakes++;
    assert.deepEqual(args, []); // never send customer or assignment data to dispatch
    throw new Error('synthetic wake outage');
  });
  const assignment = await make();
  await call('POST', '/assignments', 'publisher', {assignment, recipientIds:[]});
  let status = 'waiting';
  store.listRepositoryReviews = async (assignmentId, principal, [id]) => {
    if (!status) return [];
    assert.equal(principal.id, identities.anchor.id);
    const committed = await store.getSubmission(id);
    assert.equal(committed.assignmentId, assignmentId); // never called before commit
    return [{id, repository_review:{status}}];
  };
  const snapshot = practice(assignment);
  const submit = (actor, doc=snapshot) => call('POST', submissionsPath(assignment), actor, {snapshot:doc});
  const denied = await submit('outside');
  assert.notEqual(denied.status, 201);
  assert.equal(wakes, 0);
  const duplicate = await Promise.all([submit('anchor'), submit('anchor')]);
  assert.deepEqual(duplicate.map(r=>r.status).sort(), [200,201]);
  assert.deepEqual(duplicate.map(r=>r.data.submission.repositoryReview.status), ['waiting','waiting']);
  assert.equal(wakes,1);
  assert.equal((await submit('anchor', {...snapshot, turns:snapshot.turns.map(t=>({...t,answer:'不同的作答'}))})).status,409);
  status = null;
  const unenrolled = await submit('anchor', {...snapshot,id:'new-session-unenrolled'});
  assert.equal(unenrolled.status,201);
  assert.equal(unenrolled.data.submission.repositoryReview,undefined);
  store.listRepositoryReviews = async () => {throw new Error('projection outage');};
  assert.equal((await submit('anchor',{...snapshot,id:'new-session-timeout'})).status,201);
  assert.equal(wakes,1);
});
