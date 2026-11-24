import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAuthenticator} from '../cloudbase-identity.mjs';
import {createDatabaseAdapter} from '../cloudbase-store.mjs';
import {createGatewayHandler} from '../gateway.mjs';
import {createApi} from '../../backend/api.mjs';
import {makeAssignment} from '../../backend/vendor/assignment-excel.mjs';

const enrollment = {
  _id: 'uid-alice', teamId: 'pilot', displayName: '主播甲', role: 'anchor', active: true,
};

test('live provider verification determines UID, and enrollment alone determines the app role', async () => {
  let checked;
  const authenticate = createAuthenticator({
    envId: 'r24-isolated-test',
    getEnrollment: async id => (checked = id, enrollment),
    fetcher: async (url, options) => {
      assert.equal(url.href, 'https://r24-isolated-test.api.tcloudbasegateway.com/auth/v1/user/me');
      assert.equal(options.headers.Authorization, 'Bearer example-user-token');
      assert.equal(options.redirect, 'error');
      return Response.json({user_id: 'uid-alice', sub: 'uid-alice', status: 'ACTIVE', roles: ['operator']});
    },
  });
  assert.deepEqual(await authenticate('example-user-token'), {
    id: 'uid-alice', teamId: 'pilot', displayName: '主播甲', role: 'anchor', active: true,
  });
  assert.equal(checked, 'uid-alice');
});

test('invalid, anonymous, disabled, and unenrolled accounts cannot operate', async () => {
  const rejected = [
    [new Response(null, {status: 403}), enrollment],
    [Response.json({user_id: 'uid-alice', status: 'BANNED'}), enrollment],
    [Response.json({user_id: 'uid-alice', status: 'ACTIVE', is_anonymous: true}), enrollment],
    [Response.json({user_id: 'uid-alice', status: 'ACTIVE', sub: 'different'}), enrollment],
    [Response.json({user_id: 'uid-alice', status: 'ACTIVE'}), null],
    [Response.json({user_id: 'uid-alice', status: 'ACTIVE'}), {...enrollment, active: false}],
    [Response.json({user_id: 'uid-alice', status: 'ACTIVE'}), {...enrollment, _id: 'different'}],
  ];
  for (const [response, row] of rejected) {
    const authenticate = createAuthenticator({
      envId: 'r24-isolated-test', getEnrollment: async () => row, fetcher: async () => response,
    });
    assert.equal(await authenticate('example-user-token'), null);
  }
});

test('identity provider failure remains distinguishable from rejected credentials', async () => {
  const authenticate = createAuthenticator({
    envId: 'r24-isolated-test',
    getEnrollment: async () => { throw new Error('must not read database'); },
    fetcher: async () => new Response(null, {status: 500}),
  });
  await assert.rejects(authenticate('example-user-token'), /identity service unavailable/);
});

function fakeDatabase() {
  const namedCollections = new Map();
  const gt = value => ({greaterThan: value});
  return {
    command: {gt, in: values => ({in: values})},
    collection(name) {
      if (!namedCollections.has(name)) namedCollections.set(name, new Map());
      const documents = namedCollections.get(name);
      return {
        async add(record) {
          if (documents.has(record._id)) throw Object.assign(new Error('duplicate'), {
            code: 'DATABASE_DUPLICATE_WRITE',
          });
          documents.set(record._id, structuredClone(record));
          return {id: record._id};
        },
        where(filter) {
          let count = Infinity;
          let order;
          let projection;
          return {
            orderBy(field, direction) { order = [field, direction]; return this; },
            limit(value) { count = value; return this; },
            field(fields) { projection = fields; return this; },
            async get() {
              const result = Array.from(documents.values()).filter(record =>
                Object.entries(filter).every(([key, value]) =>
                  (value?.greaterThan !== undefined) ? record[key] > value.greaterThan :
                    Array.isArray(value?.in) ? value.in.includes(record[key]) : record[key] === value));
              if (order) result.sort((a, b) => a[order[0]] > b[order[0]] ? 1 : -1);
              const page = result.slice(0, count).map(record => projection
                ? Object.fromEntries(Object.entries(record).filter(([key]) => projection[key]))
                : record);
              return {data: structuredClone(page)};
            },
          };
        },
      };
    },
  };
}

test('competing retries use insert-only unique IDs and preserve the first payload', async () => {
  const {store} = createDatabaseAdapter(fakeDatabase(), 'tcl_r24_sync_test');
  const original = {id: 'stable-id', teamId: 'pilot', payloadHash: 'first'};
  assert.deepEqual(await Promise.all([
    store.createAssignment(original),
    store.createAssignment({...original, payloadHash: 'second'}),
  ]), [true, false]);
  assert.deepEqual(await store.getAssignment(original.id), original);
  assert.equal(await store.getAssignment('missing'), null);
});

test('keyset pages stay in the given team, and anchor status only returns status fields', async () => {
  const {store} = createDatabaseAdapter(fakeDatabase(), 'tcl_r24_sync_test');
  await Promise.all(Array.from({length: 62}, (_, i) => store.createAssignment({
    id: String(i), teamId: i < 56 ? 'pilot' : 'other',
  })));
  assert.equal((await store.listAssignments('pilot')).length, 56);
  await store.createSubmission({
    id: 's1', teamId: 'pilot', anchorId: 'uid-alice', assignmentId: 'assignment',
    submittedAt: '2026-11-24T00:00:00.000Z', turns: [{answer: 'not status data'}],
  });
  await store.createSubmission({
    id: 's2', teamId: 'other', anchorId: 'uid-alice', assignmentId: 'assignment',
  });
  assert.deepEqual(await store.listAnchorSubmissionStatuses('pilot', 'uid-alice'), [{
    assignmentId: 'assignment', submittedAt: '2026-11-24T00:00:00.000Z',
  }]);
  assert.equal((await store.listSubmissions('assignment', 'pilot')).length, 1);
});

test('gateway carries path, query, auth and UTF-8/base64 payload to portable API', async () => {
  const handler = createGatewayHandler(async request => {
    assert.equal(new URL(request.url).pathname, '/assignments');
    assert.equal(new URL(request.url).searchParams.get('limit'), '5');
    assert.equal(request.headers.get('authorization'), 'Bearer present');
    assert.equal(request.headers.get('x-forged-uid'), null);
    assert.deepEqual(await request.json(), {answer: '中文内容'});
    return Response.json({created: true}, {status: 201});
  });
  const response = await handler({
    path: '/assignments', httpMethod: 'POST', queryStringParameters: {limit: '5'},
    headers: {Authorization: 'Bearer present', 'Content-Type': 'application/json', 'X-Forged-UID': 'operator'},
    body: Buffer.from(JSON.stringify({answer: '中文内容'})).toString('base64'), isBase64Encoded: true,
  });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(JSON.parse(response.body), {created: true});
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('gateway prevents oversized payloads and rejects non-HTTP-style events before API routing', async () => {
  const handler = createGatewayHandler(() => assert.fail('should not be routed'));
  assert.equal((await handler({path: '//malicious.invalid/me', httpMethod: 'GET'})).statusCode, 400);
  assert.equal((await handler({path: '/assignments', httpMethod: 'POST', body: 'a'.repeat(1048577)})).statusCode, 413);
});

test('two CloudBase identities round-trip a published assignment and a submission through the gateway adapter', async () => {
  const db = fakeDatabase();
  const pilot = 'tcl_r24_sync_test';
  const operator = {...enrollment, _id: 'uid-operator', displayName: '运营乙', role: 'operator'};
  await db.collection(pilot + '_enrollments').add(enrollment);
  await db.collection(pilot + '_enrollments').add(operator);

  const {getEnrollment, directory, store} = createDatabaseAdapter(db, pilot);
  const authenticate = createAuthenticator({
    envId: 'r24-isolated-test',
    getEnrollment,
    fetcher: async (_, options) => {
      const uid = options.headers.Authorization.slice(7);
      return Response.json({user_id: uid, status: 'ACTIVE'});
    },
  });
  const api = createApi({authenticate, directory, store, now: () => new Date('2026-11-24T11:00:00Z')});
  const handle = createGatewayHandler(api);
  async function call(actor, method, path, body) {
    const response = await handle({
      path, httpMethod: method,
      headers: {authorization: 'Bearer ' + actor, 'content-type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {status: response.statusCode, body: JSON.parse(response.body)};
  }

  const task = await makeAssignment({
    id: 'gateway-fixture', title: '电视题目试点', operatorName: operator.displayName,
    boardId: '01', platform: '京东', deadline: '2026-11-25T12:00:00.000Z',
    createdAt: '2026-11-24T10:00:00Z', assignedTo: [],
    questions: [{category: 'TCL 电视', question: '电视尺寸如何选择？', answer: '结合观看距离选择。'}],
  });
  assert.equal((await call(operator._id, 'POST', '/assignments', {assignment: task, recipientIds: []})).status, 201);
  const list = await call(enrollment._id, 'GET', '/assignments');
  assert.equal(list.body.assignments[0].assignment.id, task.id);
  assert.equal(list.body.assignments[0].submitted, false);
  const path = '/assignments/gateway-fixture/submissions';
  const answer = '可以先询问使用者客厅的观看距离。';
  const snapshot = {
    id: 'device-two-session', assignmentId: task.id, assignmentVersion: task.version,
    assignmentSnapshotSha256: task.snapshotSha256, operatorName: operator.displayName,
    boardId: task.boardId, platform: task.platform, anchorName: enrollment.displayName,
    turns: task.questions.map(({id, question, model, sku}) => ({questionId: id, question, answer, model, sku})),
  };
  assert.equal((await call(enrollment._id, 'POST', path, {snapshot})).status, 201);
  assert.equal((await call(enrollment._id, 'POST', path, {snapshot})).status, 200);
  assert.equal((await call(enrollment._id, 'GET', '/assignments')).body.assignments[0].submitted, true);
  assert.equal((await call(enrollment._id, 'GET', path)).status, 403);
  const receipts = await call(operator._id, 'GET', path);
  assert.equal(receipts.body.submissions.length, 1);
  assert.equal(receipts.body.submissions[0].turns[0].answer, answer);
});

test('large database results fail closed instead of returning an incomplete list', async () => {
  const {store} = createDatabaseAdapter(fakeDatabase(), 'tcl_r24_sync_test');
  for (let index = 0; index < 9; index++) {
    await store.createAssignment({id: 'large-' + index, teamId: 'pilot', text: '数据'.repeat(165000)});
  }
  await assert.rejects(store.listAssignments('pilot'), /pilot size limit/);
});
