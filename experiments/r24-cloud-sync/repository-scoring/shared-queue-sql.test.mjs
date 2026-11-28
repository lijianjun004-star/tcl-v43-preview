import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL('../cloudbase/' + name, import.meta.url), 'utf8');
const shared = await migration('schema-repository-scoring-shared.sql');

test('shared and direct installs retain the same queue transitions and score projection', async () => {
  const direct = await migration('schema-repository-scoring.sql');
  const readback = await migration('schema-repository-score-readback.sql');
  const queue = (sql, end) => sql.slice(sql.indexOf('-- Exact staff/assignment grants'), sql.indexOf(end)).trim();
  const sharedBody = queue(shared, '-- The web API authenticates').replaceAll('  perform r24_repo_scoring.require_service();\n', '');
  assert.equal(sharedBody, queue(direct, '-- Default privileges'));
  const projection = readback.slice(readback.indexOf('select s.id,'), readback.indexOf('\n$$;'));
  assert.ok(shared.includes(projection));
});

test('shared queue RPCs check the actual service identity and keep pilot data scoped', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create role pilot_owner;
    grant create on schema public to pilot_owner;
    do $$ begin execute format('grant create on database %I to pilot_owner', current_database()); end $$;
    set role pilot_owner;
  `);
  await db.exec(await migration('schema-postgresql.sql'));
  await db.exec(shared);
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const id = 'a'.repeat(64), otherId = 'b'.repeat(64);
  const team = 'team', assignment = 'assignment', anchor = 'anchor';
  const scope = [team, assignment, anchor];
  const scalar = async (sql, args = []) => (await query(sql,args))[0].value;
  const claim = lease => scalar('select * from public.tcl_r24_sync_v1_worker_claim($1)', [lease]);
  const eligibility = (...args) => scalar('select * from public.tcl_r24_sync_v1_can_auto_score($1,$2,$3)', args);
  const read = (role,viewer) => query('select * from public.tcl_r24_sync_v1_read_repository_reviews($1,$2,$3,$4,$5)',[assignment,team,viewer,role,[id]]);
  const start = lease => scalar('select * from public.tcl_r24_sync_v1_worker_start_attempt($1,$2)', [id,lease]);
  const ack = lease => scalar('select * from public.tcl_r24_sync_v1_worker_ack($1,$2)', [id,lease]);
  const hold = (lease,reason) => scalar('select * from public.tcl_r24_sync_v1_worker_hold($1,$2,$3)', [id,lease,reason]);
  const item = {questionIndex:0,score:91,matchedPoints:['point'],missedPoints:[],comment:'test',suggestedScript:'test'};
  const result = {source:'openai_offline',model:'test-model',overallScore:91,grade:'A',items:[item]};
  const receipt = {jobId:id,schemaVersion:1,reviewStatus:'pending_review',origin:'openai_review',items:[]};
  const save = lease => scalar('select * from public.tcl_r24_sync_v1_worker_save_result($1,$2,$3,$4)', [id,lease,result,receipt]);
  const actor = async (role, claims = {}) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
    await db.exec('set role ' + role);
  };
  async function submit(jobId, anchorId) {
    const payload = {id:jobId,teamId:team,assignmentId:assignment,anchorId,snapshotSha256:'hash',turns:[{questionId:'q',answer:'confirmed'}]};
    await db.query('insert into public.tcl_r24_sync_v1_submissions values ($1,$2,$3,$4,now(),$5)', [jobId,team,assignment,anchorId,payload]);
  }
  const question = {id:'q',question:'q?',answer:'answer',keyPoints:['point']};
  await db.query('insert into public.tcl_r24_sync_v1_assignments values ($1,$2,$3)', [assignment,team,
    {id:assignment,teamId:team,operatorId:'operator',recipients:[{id:anchor}],assignment:{snapshotSha256:'hash',questions:[question]}}]);
  await db.query('insert into r24_repo_scoring.allowlist(team_id,assignment_id,anchor_id) values ($1,$2,$3)', scope);
  await submit(id,anchor);
  await submit(otherId,'other');
  assert.deepEqual(await query('select job_id from r24_repo_scoring.jobs'), [{job_id:id}]);
  // Reapplying an installer over a live queue cannot erase or duplicate a job.
  await assert.rejects(db.exec(shared), {code:'42P06'});
  const lease = randomUUID(), wrong = randomUUID();
  const denied = {code:'42501'};

  for (const role of ['anon','authenticated']) {
    await actor(role, {role});
    await assert.rejects(claim(lease), denied);
    await assert.rejects(read('operator','operator'), denied);
  }
  await actor('service_role', {role:'authenticated'});
  await assert.rejects(claim(lease), denied);

  // Simulate a gateway that does not enforce function EXECUTE privilege. In
  // this isolated database the function-body guard still denies every RPC.
  await actor('pilot_owner');
  await db.exec(`grant usage on schema r24_repo_scoring to anon, authenticated;
    grant execute on all functions in schema r24_repo_scoring to anon, authenticated;
    grant execute on all functions in schema public to anon, authenticated;`);
  for (const role of ['anon','authenticated']) {
    await actor(role, {role:'service_role'});
    for (const call of [() => claim(lease),() => start(lease),() => save(lease),() => ack(lease),
      () => hold(lease,'invalid'),() => eligibility(...scope),() => read('operator','operator')]) {
      await assert.rejects(call(), denied);
    }
  }

  await actor('service_role', {role:'service_role'});
  for (const table of ['jobs','allowlist'])
    await assert.rejects(query('select * from r24_repo_scoring.' + table), denied);
  assert.equal(await eligibility(...scope), true);
  assert.equal(await eligibility(team,assignment,'other'), false);
  assert.deepEqual(await read('anchor',anchor), [{id,repository_review:{status:'waiting'}}]);
  assert.deepEqual(await read('anchor','other'), []);
  assert.deepEqual(await read('operator','other'), []);
  assert.equal((await claim(lease)).items[0].answerText, 'confirmed');
  assert.equal(await claim(wrong), null);
  assert.equal(await hold(wrong,'held'), false);
  assert.equal(await start(wrong), false);
  assert.equal(await start(lease), true);
  assert.equal(await start(lease), false);
  assert.deepEqual(await read('anchor',anchor), [{id,repository_review:{status:'processing'}}]);
  assert.equal(await save(lease), true);
  assert.equal(await ack(lease), true);
  assert.equal(await ack(lease), false);
  assert.equal(await claim(wrong), null);
  const scored = [{id,repository_review:{status:'pending_review',evaluation:{...result,degraded:false}}}];
  assert.deepEqual(await read('anchor',anchor), scored);
  assert.deepEqual(await read('operator','operator'), scored);
});
