import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL('../cloudbase/' + name, import.meta.url), 'utf8');
const shared = await migration('schema-repository-scoring-shared.sql');
const open = await migration('schema-repository-scoring-open.sql');

// The open migration rewrites the queue functions; only the grant check may differ.
test('open migration keeps every queue function body apart from the grant check', () => {
  const body = (sql, name) => {
    const start = sql.search(new RegExp('function r24_repo_scoring\\.' + name + '\\('));
    assert.ok(start > 0, name);
    return sql.slice(start, sql.indexOf('\n$$;', start));
  };
  const fragments = [
    ' join r24_repo_scoring.allowlist g on g.grant_id=j.grant_id and g.team_id=s.team_id and g.assignment_id=s.assignment_id and g.anchor_id=s.anchor_id',
    ', r24_repo_scoring.allowlist g',
    ' and g.grant_id=j.grant_id and g.team_id=s.team_id and g.assignment_id=s.assignment_id and g.anchor_id=s.anchor_id',
    ' and r24_repo_scoring.grant_active(j.grant_id, s.team_id, s.assignment_id, s.anchor_id)',
  ];
  const normal = text => fragments.reduce((all, part) => all.replaceAll(part, ''), text.replace(/\s+/g, ' ').trim());
  for (const name of ['claim', 'start_attempt', 'save_result'])
    assert.equal(normal(body(open, name)), normal(body(shared, name)), name);
});

test('a team-wide grant scores every anchor of that team and can be closed again', async t => {
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
  await db.exec(open);
  await assert.rejects(db.exec(open), {code:'42P07'});

  const team = 'r24-pilot', otherTeam = 'elsewhere', assignment = 'assignment', otherAssignment = 'assignment-elsewhere';
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const scalar = async (sql, args = []) => (await query(sql, args))[0].value;
  const owner = async () => { await db.exec('reset role'); await db.exec('set role pilot_owner'); };
  const service = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({role:'service_role'})]);
    await db.exec('set role service_role');
  };
  const claim = lease => scalar('select * from public.tcl_r24_sync_v1_worker_claim($1)', [lease]);
  const eligibility = (...args) => scalar('select * from public.tcl_r24_sync_v1_can_auto_score($1,$2,$3)', args);
  const start = (id, lease) => scalar('select * from public.tcl_r24_sync_v1_worker_start_attempt($1,$2)', [id, lease]);
  const ack = (id, lease) => scalar('select * from public.tcl_r24_sync_v1_worker_ack($1,$2)', [id, lease]);
  const read = (role, viewer, ids, teamId = team) => query(
    'select * from public.tcl_r24_sync_v1_read_repository_reviews($1,$2,$3,$4,$5)', [assignment, teamId, viewer, role, ids]);
  const item = {questionIndex:0,score:88,matchedPoints:['point'],missedPoints:[],comment:'ok',suggestedScript:'ok'};
  const result = {source:'openai_offline',model:'test-model',overallScore:88,grade:'良好',items:[item]};
  const save = (id, lease) => scalar('select * from public.tcl_r24_sync_v1_worker_save_result($1,$2,$3,$4)',
    [id, lease, result, {jobId:id,schemaVersion:1,reviewStatus:'pending_review',origin:'openai_review',items:[]}]);
  const question = {id:'q',question:'q?',answer:'answer',keyPoints:['point']};
  const assignmentOf = teamId => teamId === team ? assignment : otherAssignment;
  for (const teamId of [team, otherTeam])
    await db.query('insert into public.tcl_r24_sync_v1_assignments values ($1,$2,$3)', [assignmentOf(teamId), teamId,
      {id:assignmentOf(teamId),teamId,operatorId:'operator',recipients:[],assignment:{snapshotSha256:'hash',questions:[question]}}]);
  const restricted = 'anchor-only-assignment';
  await db.query('insert into public.tcl_r24_sync_v1_assignments values ($1,$2,$3)', [restricted,team,
    {id:restricted,teamId:team,operatorId:'operator',recipients:[{id:'any-new-anchor'}],
      assignment:{snapshotSha256:'hash',questions:[question]}}]);
  for (const [account, teamId, role, active] of [
    ['any-new-anchor',team,'anchor',true], ['late-anchor',team,'anchor',true],
    ['inactive',team,'anchor',false], ['operator',team,'operator',true],
    ['outsider',otherTeam,'anchor',true],
  ]) {
    await db.query('insert into public.tcl_r24_sync_v1_enrollments(id,team_id,display_name,role,active) values ($1,$2,$1,$3,$4)',
      [account,teamId,role,active]);
  }
  const submit = async (jobId, anchorId, teamId = team, assignmentId = assignmentOf(teamId)) => db.query(
    'insert into public.tcl_r24_sync_v1_submissions values ($1,$2,$3,$4,now(),$5)', [jobId, teamId, assignmentId, anchorId,
      {id:jobId,teamId,assignmentId,anchorId,snapshotSha256:'hash',turns:[{questionId:'q',answer:'confirmed'}]}]);
  // The scorer accepts 1-15 questions; larger assignments are not opened team-wide.
  const sized = count => 'assignment-' + count + '-questions';
  for (const count of [15, 16])
    await db.query('insert into public.tcl_r24_sync_v1_assignments values ($1,$2,$3)', [sized(count), team,
      {id:sized(count),teamId:team,operatorId:'operator',recipients:[],assignment:{snapshotSha256:'hash',
        questions:Array.from({length:count}, (_, i) => ({...question, id:'q' + i}))}}]);
  const jobs = async () => { await owner(); return (await query('select job_id from r24_repo_scoring.jobs order by job_id')).map(r => r.job_id); };
  const id = n => String(n).repeat(64);

  // Installed closed: no team is eligible and nothing is queued.
  await service();
  assert.equal(await eligibility(team, assignment, 'new-anchor'), false);
  await owner();
  await submit(id(1), 'before-open');
  assert.deepEqual(await jobs(), []);

  // The runtime cannot read the grant table or call the helper directly.
  await service();
  await assert.rejects(query('select * from r24_repo_scoring.open_grants'), {code:'42501'});
  await assert.rejects(query("select r24_repo_scoring.grant_active(gen_random_uuid(),'a','b','c')"), {code:'42501'});

  // Opening the team makes any anchor eligible, only within that team.
  await owner();
  await db.query('insert into r24_repo_scoring.open_grants(team_id) values ($1)', [team]);
  await service();
  assert.equal(await eligibility(team, assignment, 'any-new-anchor'), true);
  assert.equal(await eligibility(otherTeam, otherAssignment, 'any-new-anchor'), false);
  for (const excluded of ['missing','inactive','operator','outsider']) {
    assert.equal(await eligibility(team,assignment,excluded), false, excluded);
  }
  assert.equal(await eligibility(team,restricted,'any-new-anchor'), true);
  assert.equal(await eligibility(team,restricted,'late-anchor'), false);
  assert.equal(await eligibility(team, sized(15), 'any-new-anchor'), true);
  assert.equal(await eligibility(team, sized(16), 'any-new-anchor'), false);
  assert.equal(await eligibility(team, 'no-such-assignment', 'any-new-anchor'), false);
  await owner();
  for (const [i, excluded] of ['missing','inactive','operator','outsider'].entries()) {
    await submit(i.toString(16).padStart(64,'a'), excluded);
  }
  await submit('e'.repeat(64), 'late-anchor', team, restricted);
  await submit(id(2), 'any-new-anchor');
  await submit(id(3), 'outsider', otherTeam);
  await submit('c'.repeat(64), 'any-new-anchor', team, sized(16));
  assert.deepEqual(await jobs(), [id(2)]);
  await submit('d'.repeat(64), 'any-new-anchor', team, sized(15));
  assert.deepEqual(await jobs(), [id(2), 'd'.repeat(64)]);
  await db.query('delete from r24_repo_scoring.jobs where job_id=$1', ['d'.repeat(64)]);

  // The full worker transition works for the open grant and both roles read the result.
  await service();
  assert.deepEqual(await read('anchor', 'any-new-anchor', [id(2)]), [{id:id(2),repository_review:{status:'waiting'}}]);
  const lease = randomUUID();
  const claimed = await claim(lease);
  assert.equal(claimed.jobId, id(2));
  assert.equal(claimed.items[0].answerText, 'confirmed');
  assert.equal(await start(id(2), lease), true);
  assert.deepEqual(await read('anchor', 'any-new-anchor', [id(2)]), [{id:id(2),repository_review:{status:'processing'}}]);
  assert.equal(await save(id(2), lease), true);
  assert.equal(await ack(id(2), lease), true);
  const scored = [{id:id(2),repository_review:{status:'pending_review',evaluation:{...result,degraded:false}}}];
  assert.deepEqual(await read('anchor', 'any-new-anchor', [id(2)]), scored);
  assert.deepEqual(await read('operator', 'operator', [id(2)]), scored);
  assert.deepEqual(await read('anchor', 'someone-else', [id(2)]), []);

  // Revalidate team eligibility between submission, claiming and the billable call.
  await owner();
  await submit('f'.repeat(64), 'late-anchor');
  await db.query("update public.tcl_r24_sync_v1_enrollments set active=false where id='late-anchor'");
  await service();
  assert.equal(await claim(randomUUID()), null);
  await owner();
  await db.query("update public.tcl_r24_sync_v1_enrollments set active=true where id='late-anchor'");
  const restrictedLease = randomUUID();
  await service();
  assert.equal((await claim(restrictedLease)).jobId, 'f'.repeat(64));
  await owner();
  await db.query("update public.tcl_r24_sync_v1_assignments set payload=jsonb_set(payload,'{recipients}',$2::jsonb) where id=$1",
    [assignment,JSON.stringify([{id:'any-new-anchor'}])]);
  await service();
  assert.equal(await start('f'.repeat(64), restrictedLease), false);
  assert.deepEqual(await read('anchor','any-new-anchor',[id(2)]), scored);

  await owner();
  await db.query("update public.tcl_r24_sync_v1_assignments set payload=jsonb_set(payload,'{recipients}','[]') where id=$1", [assignment]);
  await service();
  assert.equal(await start('f'.repeat(64), restrictedLease), true);
  await owner();
  await db.query("update public.tcl_r24_sync_v1_enrollments set active=false where id='late-anchor'");
  await service();
  assert.equal(await save('f'.repeat(64), restrictedLease), false);
  await owner();
  await db.query("update public.tcl_r24_sync_v1_enrollments set active=true where id='late-anchor'");
  // Closing the team stops pending work; reopening issues a new grant and cannot revive it.
  await owner();
  await submit(id(4), 'late-anchor');
  await db.query('delete from r24_repo_scoring.open_grants where team_id=$1', [team]);
  await service();
  assert.equal(await eligibility(team, assignment, 'late-anchor'), false);
  assert.equal(await claim(randomUUID()), null);
  assert.deepEqual(await read('anchor', 'late-anchor', [id(4)]), [{id:id(4),repository_review:{status:'needs_attention'}}]);
  await owner();
  await db.query('insert into r24_repo_scoring.open_grants(team_id) values ($1)', [team]);
  await submit(id(5), 'late-anchor');
  await service();
  assert.equal((await claim(randomUUID())).jobId, id(5));
  assert.deepEqual(await read('anchor', 'late-anchor', [id(4)]), [{id:id(4),repository_review:{status:'needs_attention'}}]);

  // An exact allowlist grant still works on its own and wins for new jobs.
  await owner();
  await db.query('delete from r24_repo_scoring.open_grants where team_id=$1', [team]);
  await db.query('insert into r24_repo_scoring.allowlist(team_id,assignment_id,anchor_id) values ($1,$2,$3)', [team, assignment, 'listed']);
  await submit(id(6), 'listed');
  await submit(id(7), 'not-listed');
  assert.deepEqual((await jobs()).filter(job => [id(6), id(7)].includes(job)), [id(6)]);
  await service();
  assert.equal(await eligibility(team, assignment, 'listed'), true);
  assert.equal(await eligibility(team, assignment, 'not-listed'), false);
  assert.equal((await claim(randomUUID())).jobId, id(6));
});
