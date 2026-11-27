import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRepositoryArchive, validateScoreReceipt} from './archive.mjs';

const repo = process.env.GITHUB_REPOSITORY || 'synthetic-org/private-scores';
const branch = 'r24-score-receipts';
const token = 'unit-test-only-value';
const jobId = 'a'.repeat(64);
const path = 'score-receipts/v1/' + jobId + '.json';
const receipt = () => ({schemaVersion: 1, jobId, origin: 'submission', model: 'hy3',
  overallScore: 70, grade: '良好', items: [{questionIndex: 0, score: 70, matched: [3, 1], missed: [2]}],
  reviewStatus: 'pending_review'});
const canonical = Buffer.from(JSON.stringify(validateScoreReceipt(receipt()), null, 2) + '\n');
const sha = createHash('sha1').update('blob ' + canonical.length + '\0').update(canonical).digest('hex');
const content = canonical.toString('base64');
const file = {type: 'file', path, encoding: 'base64', content: content.match(/.{1,60}/g).join('\n'), sha};
const created = {content: {type: 'file', path, sha}};
const metadata = [200, {private: true, visibility: 'private', full_name: repo, default_branch: 'main'}];
const branchInfo = [200, {name: branch, protected: false}];
function script(responses = []) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url, ...options});
    const action = responses[calls.length - 1];
    if (!action) throw new Error('Unexpected request');
    const [status, body] = action;
    return new Response(JSON.stringify(body), {status});
  };
  return {calls, archive: createRepositoryArchive({repo, token, fetchImpl})};
}

test('archives canonical receipt with create-only semantics to the dedicated private branch', async () => {
  const {archive, calls} = script([metadata, branchInfo, [404, {}], [201, created]]);
  const saved = await archive(receipt());
  assert.deepEqual(saved, {status: 'archived', path, branch, sha});
  const base = 'https://api.github.com/repos/' + repo;
  assert.deepEqual(calls.map(c => [c.method, c.url]), [
    ['GET', base], ['GET', base + '/branches/' + branch], ['GET', base + '/contents/' + path + '?ref=' + branch],
    ['PUT', base + '/contents/' + path],
  ]);
  const put = JSON.parse(calls[3].body);
  assert.deepEqual(Object.keys(put).sort(), ['branch', 'content', 'message']);
  assert.equal(put.content, content);
  assert.equal(put.branch, branch);
  assert.ok(!put.message.includes(token));
  assert.ok(calls.every(c => c.redirect === 'error' && c.headers.Authorization === 'Bearer ' + token));
});

test('destination can be checked before paying for a model call', async () => {
  const {archive, calls} = script([metadata, branchInfo]);
  assert.deepEqual(await archive.verifyDestination(), {repo, branch, protected: false});
  assert.equal(calls.length, 2);
});

test('enterprise-internal and missing visibility fail on metadata alone', async () => {
  for (const visibility of ['internal', undefined]) {
    const {archive, calls} = script([[200, {...metadata[1], private: true, visibility}]]);
    await assert.rejects(archive.verifyDestination(), {code: 'ARCHIVE_UNSAFE_DESTINATION'});
    assert.deepEqual(calls.map(c => [c.method, c.url]), [['GET', 'https://api.github.com/repos/' + repo]]);
  }
});

test('identical existing bytes are accepted without writing, even for a differently ordered input', async () => {
  const {archive, calls} = script([metadata, branchInfo, [200, file]]);
  const sameData = {...receipt(), items: [{score: 70, questionIndex: 0, matched: [1, 3], missed: [2]}]};
  assert.equal((await archive(sameData)).status, 'already_archived');
  assert.ok(calls.every(c => c.method === 'GET'));
});

test('409/422 races only perform a single follow-up read and accept exactly the same content', async () => {
  for (const status of [409, 422]) {
    const {archive, calls} = script([metadata, branchInfo, [404, {}], [status, {}], [200, file]]);
    assert.equal((await archive(receipt())).status, 'already_archived');
    assert.deepEqual(calls.map(c => c.method), ['GET', 'GET', 'GET', 'PUT', 'GET']);
    for (const followup of [[404, {}], [200, {...file, sha: '0'.repeat(40)}]]) {
      const concurrent = script([metadata, branchInfo, [404, {}], [status, {}], followup]);
      await assert.rejects(concurrent.archive(receipt()), {code: followup[0] === 404 ?
        'ARCHIVE_GITHUB_HTTP_' + status : 'ARCHIVE_RECEIPT_CONFLICT'});
      assert.equal(concurrent.calls.filter(c => c.method === 'PUT').length, 1);
    }
  }
});

test('any different blob or content is rejected without overwriting', async () => {
  for (const altered of [{...file, content: 'b3RoZXI='}, {...file, sha: 'b'.repeat(40)}]) {
    const {archive, calls} = script([metadata, branchInfo, [200, altered]]);
    await assert.rejects(archive(receipt()), {code: 'ARCHIVE_RECEIPT_CONFLICT'});
    assert.equal(calls.length, 3);
  }
});

test('public, redirected identity, default-branch target, absent branch and mismatched branch stop before contents', async () => {
  const cases = [
    [[200, {...metadata[1], private: false}]], [[200, {...metadata[1], full_name: 'somewhere/else'}]],
    [[200, {...metadata[1], default_branch: branch}]], [metadata, [404, {}]],
    [metadata, [200, {name: 'main'}]], [[301, {}]],
  ];
  for (const responses of cases) {
    const {archive, calls} = script(responses);
    await assert.rejects(archive(receipt()), /ARCHIVE_/);
    assert.ok(calls.every(c => !c.url.includes('/contents/')));
  }
});

test('invalid paths and branch configuration never create an HTTP client', () => {
  for (const bad of ['/x/y', 'user/../main', 'x/..', 'x/.', 'x/y?ref=main', 'x/y#x', 'https://api.github.com/owner/x']) {
    assert.throws(() => createRepositoryArchive({repo: bad, token}), {code: 'ARCHIVE_INVALID_DESTINATION'});
  }
  for (const bad of ['main', 'tags/any', '', 'r24-score-receipts/other']) {
    assert.throws(() => createRepositoryArchive({repo, token, branch: bad}), {code: 'ARCHIVE_INVALID_DESTINATION'});
  }
});

test('private data, unknown fields/models, non-numeric point values and invalid grades are rejected before requests', async () => {
  const sample = receipt();
  const badValues = [
    {...sample, name: '合成人'}, {...sample, items: [{...sample.items[0], answerText: '内容'}]},
    {...sample, model: 'unapproved-label'}, {...sample, origin: 'any'}, {...sample, reviewStatus: 'accepted'},
    {...sample, overallScore: 85, grade: '优秀'}, {...sample, grade: '优秀'}, {...sample, jobId: '../x'},
    ...[{questionIndex: 1}, {score: 1000}, {matched: ['文字']}, {matched: [1,2]}, {missed: [12]}]
      .map(change => ({...sample, items: [{...sample.items[0], ...change}]})),
  ];
  const {archive, calls} = script();
  for (const bad of badValues) await assert.rejects(archive(bad), {code: 'ARCHIVE_INVALID_RECEIPT'});
  assert.equal(calls.length, 0);
});

test('transport exceptions and response error bodies are never echoed', async () => {
  const archive = createRepositoryArchive({repo, token, fetchImpl: async () => {throw new Error(token);}});
  await assert.rejects(archive(receipt()), {message: 'ARCHIVE_NETWORK_ERROR', code: 'ARCHIVE_NETWORK_ERROR'});
  const {archive: denied} = script([[403, {message: token}]]);
  await assert.rejects(denied(receipt()), {message: 'ARCHIVE_GITHUB_HTTP_403'});
});

test('a fake success for the wrong file is rejected, never updated or retried', async () => {
  const {archive, calls} = script([metadata, branchInfo, [404, {}], [201, {content: {...created.content, path: 'different'}}]]);
  await assert.rejects(archive(receipt()), {code: 'ARCHIVE_INVALID_RESPONSE'});
  assert.equal(calls.length, 4);
});

test('OpenAI review receipts require Terra; recovery separately admits known historical OpenAI receipts', async()=>{
  const fresh={...receipt(),origin:'openai_review',model:'gpt-6.1-terra'};
  assert.equal(validateScoreReceipt(fresh).model,'gpt-6.1-terra');
  for (const name of ['gpt-4o','gpt-4o-mini','hy3','hy3-preview']) {
    const legacy={...fresh,model:name};
    assert.throws(()=>validateScoreReceipt(legacy),{code:'ARCHIVE_INVALID_RECEIPT'});
    assert.equal(validateScoreReceipt({...legacy,origin:'submission'}).model,name);
    if (name.startsWith('gpt-')) assert.equal(validateScoreReceipt(legacy,{historical:true}).model,name);
    else {
      const {archive,calls}=script();
      await assert.rejects(archive(legacy,{historical:true}),{code:'ARCHIVE_INVALID_RECEIPT'});
      assert.equal(calls.length,0);
    }
  }
});
