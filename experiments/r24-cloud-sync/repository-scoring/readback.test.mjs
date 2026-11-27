import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createDatabaseAdapter} from '../cloudbase/cloudbase-store.mjs';

const id='f'.repeat(64);
const team='test-team', assignment='exercise', viewer='anchor', publisher='operator';
const item={questionIndex:0,score:92,matchedPoints:['核对'],missedPoints:[],comment:'证据充分',suggestedScript:'核对资料'};
const evaluation={overallScore:92,grade:'优秀',source:'openai_offline',model:'gpt-6.1-terra',items:[item]};

test('CloudBase readback uses authenticated scope; missing optional migration allows historical reads', async () => {
  const principal={id:viewer,teamId:team,role:'anchor'};
  const db={rpc:async (name, args) => {
    assert.equal(name,'tcl_r24_sync_v1_read_repository_reviews');
    assert.deepEqual(args,{p_assignment_id:assignment,p_team_id:team,p_viewer_id:viewer,p_viewer_role:'anchor',p_ids:[id]});
    return {data:[{id,repository_review:{status:'waiting'}}]};
  }};
  const {store}=createDatabaseAdapter(db,'tcl_r24_sync_v1');
  assert.equal((await store.listRepositoryReviews(assignment,principal,[id]))[0].repository_review.status,'waiting');
  db.rpc=async()=>({error:{code:'PGRST202'}});
  assert.deepEqual(await store.listRepositoryReviews(assignment,principal,[id]),[]);
  db.rpc=async()=>({error:{code:'42501'}});
  await assert.rejects(store.listRepositoryReviews(assignment,principal,[id]),/unavailable/);
});

test('read RPC binds the viewer, team, assignment and IDs and returns only public fields before and after archive', async t => {
  const db=new PGlite();
  t.after(()=>db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls');
  for (const name of ['schema-postgresql.sql','schema-repository-scoring.sql','schema-repository-score-readback.sql'])
    await db.exec(await readFile(new URL('../cloudbase/'+name,import.meta.url),'utf8'));
  const payload={id:assignment,teamId:team,operatorId:publisher,recipients:[{id:viewer}]};
  const submit={id,teamId:team,assignmentId:assignment,anchorId:viewer};
  await db.query('insert into public.tcl_r24_sync_v1_assignments values ($1,$2,$3)',[assignment,team,payload]);
  await db.query('insert into r24_repo_scoring.allowlist(team_id,assignment_id,anchor_id) values ($1,$2,$3)',[team,assignment,viewer]);
  await db.query('insert into public.tcl_r24_sync_v1_submissions values ($1,$2,$3,$4,now(),$5)',[id,team,assignment,viewer,submit]);

  async function read(role='anchor',actor=viewer,teamId=team,assignmentId=assignment,ids=[id]) {
    return (await db.query('select * from public.tcl_r24_sync_v1_read_repository_reviews($1,$2,$3,$4,$5::text[])',
      [assignmentId,teamId,actor,role,ids])).rows;
  }
  for (const role of ['anon','authenticated','r24_scoring_worker']) {
    await db.exec('set role '+role);
    await assert.rejects(read(), {code:'42501'});
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  await assert.rejects(db.query('select * from r24_repo_scoring.jobs'),{code:'42501'});
  assert.deepEqual(await read(),[{id,repository_review:{status:'waiting'}}]);
  assert.deepEqual(await read('operator',publisher),await read());
  for (const denied of [['operator','colleague'],['anchor','other'],['anchor',viewer,'other-team'],
    ['operator',publisher,team,'other-assignment'],['anchor',viewer,team,assignment,['a'.repeat(64)]],
    ['operator',publisher,team,assignment,Array(21).fill(id)]])
    assert.deepEqual(await read(...denied),[]);
  await db.exec('reset role');

  await db.query("update r24_repo_scoring.jobs set state='attempting',lease_until=now()+interval '5 minutes' where job_id=$1",[id]);
  assert.equal((await read())[0].repository_review.status,'processing');
  await db.query("update r24_repo_scoring.jobs set lease_until=now()-interval '1 second' where job_id=$1",[id]);
  assert.equal((await read())[0].repository_review.status,'needs_attention');
  const internal={...evaluation,requestId:'internal only',usage:{private:'do not expose'},items:[{...item,internal:'never disclosed'}]};
  await db.query("update r24_repo_scoring.jobs set state='scored',result=$1, receipt=$2 where job_id=$3",
    [internal,{origin:'openai_review',secret:'no'},id]);
  const expected=[{id,repository_review:{status:'pending_review',evaluation:{...evaluation,degraded:false}}}];
  for (const state of ['scored','archived']) {
    await db.query('update r24_repo_scoring.jobs set state=$1 where job_id=$2',[state,id]);
    await db.exec('set role service_role');
    assert.deepEqual(await read(),expected);
    assert.deepEqual(await read('operator',publisher),expected);
    assert.deepEqual(await read('anchor','other'),[]);
    await db.exec('reset role');
  }
  await db.query('delete from r24_repo_scoring.allowlist where team_id=$1',[team]);
  assert.deepEqual(await read(),expected);
  await db.query("update r24_repo_scoring.jobs set state='ready' where job_id=$1",[id]);
  assert.deepEqual(await read(),[{id,repository_review:{status:'needs_attention'}}]);
  await db.query('update public.tcl_r24_sync_v1_assignments set payload=$1 where id=$2',
    [{...payload,recipients:[{id:'someone-else'}]},assignment]);
  assert.deepEqual(await read(),[]);
  await db.query('update public.tcl_r24_sync_v1_assignments set payload=$1 where id=$2',
    [{...payload,recipients:[]},assignment]);
  assert.equal((await read()).length,1);
  await db.query('update public.tcl_r24_sync_v1_submissions set payload=$1 where id=$2',
    [{...submit,evaluation:{source:'historic',overallScore:77}},id]);
  await db.query("update r24_repo_scoring.jobs set state='archived',receipt=$1 where job_id=$2",[{origin:'submission'},id]);
  assert.deepEqual(await read(),[]);
});
