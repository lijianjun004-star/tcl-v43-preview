import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const scope = ['synthetic-team', 'synthetic-assignment', 'synthetic-anchor'];
const snapshotSha256 = 'e'.repeat(64);
const question = {id: 'frozen-question', question: '合成问题', answer: '参考回答', keyPoints: ['要点']};
const confirmedTurn = {questionId: question.id, answer: '主播确认文字', transcript: '未校正文字'};

test('repository scoring outbox in PostgreSQL', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  async function scalar(query, params = []) {
    const {rows} = await db.query(query, params);
    return Object.values(rows[0])[0];
  }
  const claim = lease => scalar('select r24_repo_scoring.claim($1)', [lease]);
  const start = (id, lease) => scalar('select r24_repo_scoring.start_attempt($1,$2)', [id, lease]);
  const hold = (id, lease, reason) => scalar('select r24_repo_scoring.hold($1,$2,$3)', [id, lease, reason]);
  const ack = (id, lease) => scalar('select r24_repo_scoring.ack($1,$2)', [id, lease]);
  const save = (id, lease, receipt) => scalar('select r24_repo_scoring.save_result($1,$2,$3,$4)',
    [id, lease, JSON.stringify({comment:'私有意见'}), JSON.stringify(receipt)]);
  const expire = id => db.query("update r24_repo_scoring.jobs set lease_until=now()-interval '6 minutes' where job_id=$1", [id]);
  const allow = () => db.query('insert into r24_repo_scoring.allowlist(team_id,assignment_id,anchor_id) values ($1,$2,$3)', scope);

  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for (const filename of ['schema-postgresql.sql','schema-repository-scoring.sql']) {
    const migration = await readFile(new URL('../cloudbase/' + filename, import.meta.url), 'utf8');
    await db.exec(migration);
  }
  const [teamId, assignmentId, anchorId] = scope;
  const assignment = {id: assignmentId, teamId, assignment: {snapshotSha256, questions: [question]}};
  await db.query('insert into public.tcl_r24_sync_v1_assignments values ($1,$2,$3)',
    [assignmentId, teamId, JSON.stringify(assignment)]);
  async function submit(character, extra = {}) {
    const id = character.repeat(64);
    const payload = {id, teamId, assignmentId, anchorId, snapshotSha256, turns: [confirmedTurn], ...extra};
    await db.query('insert into public.tcl_r24_sync_v1_submissions values ($1,$2,$3,$4,now(),$5)',
      [id, teamId, assignmentId, payload.anchorId, JSON.stringify(payload)]);
    return id;
  }
  function makeReceipt(jobId, origin) {
    return {schemaVersion: 1, jobId, origin, reviewStatus: 'pending_review', model: 'synthetic',
      overallScore: 90, grade: '优秀', items: [{questionIndex: 0, score: 90, matched: [1], missed: []}]};
  }
  await t.test('only new committed submissions for the exact approved scope enqueue jobs', async () => {
    await submit('0');
    await allow();
    await submit('1', {anchorId:'other-synthetic-anchor'});
    assert.equal(await claim(randomUUID()), null);
    await db.exec('begin');
    await submit('2');
    await db.exec('rollback');
    assert.equal(await claim(randomUUID()), null);
    assert.equal(await scalar('select count(*) from r24_repo_scoring.jobs'), 0);
  });

  await t.test('only the worker can claim; the worker cannot read source tables, the allowlist or queue', async () => {
    for (const role of ['anon','authenticated','service_role']) {
      await db.exec('set role ' + role);
      await assert.rejects(claim(randomUUID()), {code:'42501'});
      await db.exec('reset role');
    }
    await db.exec('set role r24_scoring_worker');
    for (const table of ['public.tcl_r24_sync_v1_submissions','public.tcl_r24_sync_v1_assignments',
      'r24_repo_scoring.jobs','r24_repo_scoring.allowlist']) {
      await assert.rejects(db.query('select * from ' + table), {code:'42501'});
    }
    assert.equal(await claim(randomUUID()), null);
    await db.exec('reset role');
  });

  await t.test('only confirmed text is claimed; retries never repeat a started model call', async () => {
    const id = await submit('3');
    const lease = randomUUID(), other = randomUUID();
    const receipt = makeReceipt(id, 'openai_review');
    const expectedItem = {question: question.question, referenceAnswer: question.answer,
      keyPoints: question.keyPoints, answerText: confirmedTurn.answer};
    await db.exec('set role r24_scoring_worker');
    assert.deepEqual(await claim(lease), {jobId:id, state:'ready', items:[expectedItem], existingEvaluation:null});
    assert.equal(await claim(other), null);
    assert.equal(await save(id, lease, makeReceipt(id,'submission')), false);
    assert.equal(await start(id, other), false);
    assert.equal(await start(id, lease), true);
    assert.equal(await start(id, lease), false);
    await db.exec('reset role');
    await expire(id);
    await db.exec('set role r24_scoring_worker');
    assert.equal(await claim(other), null);
    assert.equal(await save(id, lease, {...receipt,jobId:'0'.repeat(64)}), false);
    assert.equal(await save(id, lease, receipt), true);
    await db.exec('reset role');
    await expire(id);
    await db.exec('set role r24_scoring_worker');
    assert.deepEqual(await claim(other), {jobId:id,state:'scored',receipt});
    assert.equal(await start(id, other), false);
    assert.equal(await ack(id, lease), false);
    assert.equal(await ack(id, other), true);
    await db.exec('reset role');
  });

  await t.test('previously attached scoring uses no model attempt', async () => {
    const existing = {overallScore:90, grade:'优秀', items:[], model:'hy3', source:'cloudbase_hunyuan'};
    const id = await submit('4', {evaluation:{...existing, requestId:'synthetic-private',usage:{total_tokens:300}}});
    const lease = randomUUID();
    const job = await claim(lease);
    assert.deepEqual(job.existingEvaluation, existing);
    assert.equal(await start(id, lease), false);
    assert.equal(await save(id, lease, makeReceipt(id,'openai_review')), false);
    assert.equal(await save(id, lease, makeReceipt(id,'submission')), true);
    assert.equal(await ack(id, lease), true);
  });

  await t.test('before sending, a lease may expire; a stale worker cannot claim the result or freeze it', async () => {
    const id = await submit('5');
    const oldLease = randomUUID(), newLease = randomUUID();
    await claim(oldLease);
    await expire(id);
    assert.equal((await claim(newLease)).jobId, id);
    assert.equal(await start(id, oldLease), false);
    assert.equal(await hold(id, oldLease, 'STALE'), false);
    assert.equal(await hold(id, newLease, 'a full diagnostic with personal details'), false);
    assert.equal(await hold(id, newLease, 'INVALID_INPUT'), true);
    assert.equal(await claim(randomUUID()), null);
  });

  await t.test('revocation stops pending and leased jobs; a later grant only covers new submissions', async () => {
    const id = await submit('6');
    const lease = randomUUID();
    await claim(lease);
    await db.exec("update r24_repo_scoring.allowlist set anchor_id='another-anchor'");
    assert.equal(await start(id, lease), false);
    await expire(id);
    assert.equal(await claim(randomUUID()), null);
    await db.exec('delete from r24_repo_scoring.allowlist');
    await allow();
    assert.equal(await claim(randomUUID()), null);
    const newId = await submit('7');
    assert.equal((await claim(randomUUID())).jobId, newId);
  });
});
