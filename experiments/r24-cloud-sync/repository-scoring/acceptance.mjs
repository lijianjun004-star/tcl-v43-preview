import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {createApi} from '../backend/api.mjs';
import {makeAssignment} from '../backend/vendor/assignment-excel.mjs';
import {createQueue} from './queue.mjs';
import {createRepositoryArchive} from './archive.mjs';
import {createOpenAIScorer, processOne} from './worker.mjs';

const repo = 'lijianjun004-star/tcl-v43-preview';
const branch = 'r24-score-receipts';
const jobId = 'e2a5786137d30c1a568e1d23589a5bc011ab9324be76edb8ce795fd0efd13207';
const path = 'score-receipts/v1/' + jobId + '.json';
const teamId = 'synthetic_repo_team';
const anchor = {role:'anchor', active:true, teamId, id:'synthetic_repo_anchor', displayName:'合成主播'};
const operator = {role:'operator', active:true, teamId, id:'synthetic_repo_operator', displayName:'合成运营'};
const question = '我家电梯能搬进大电视吗？';
const referenceAnswer = '先核对电视包装和入户通道尺寸，再请配送人员确认是否能搬入。';
const answerText = '您先量一下电梯门和转角，我核对包装尺寸后，再请配送人员确认。';
const keyPoints = ['核对包装与通道尺寸','向配送人员确认'];
const fixture = {question, referenceAnswer, answerText, keyPoints};

function liveAllowed(env) {
  return env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'push' &&
    env.GITHUB_REPOSITORY === repo && env.GITHUB_REF === 'refs/heads/feat/r24-repository-scoring' &&
    env.GITHUB_RUN_ATTEMPT === '1' && !!env.OPENAI_API_KEY;
}

// The real API writes through SQL with the pilot service role. Only the identity
// provider and production network transports are replaced by local fixtures.
function submissionStore(db) {
  function service(sql,args) {
    return db.transaction(async tx => {
      await tx.exec('set local role service_role');
      return (await tx.query(sql,args)).rows;
    });
  }
  function methods(table, cols, args) {
    return {
      get: async id => (await service('select payload from public.'+table+' where id=$1',[id]))[0]?.payload,
      create: async record => {
        const values = args(record);
        const params = values.map((_,i)=>'$'+(i+1)).join(',');
        const rows = await service('insert into public.'+table+' ('+cols+') values ('+params+
          ') on conflict do nothing returning id',values);
        return rows.length === 1;
      },
    };
  }
  const assignments = methods('tcl_r24_sync_v1_assignments','id,team_id,payload',
    r=>[r.id,r.teamId,JSON.stringify(r)]);
  const claims = methods('tcl_r24_sync_v1_claims','id,team_id,assignment_id,anchor_id,payload',
    r=>[r.id,r.teamId,r.assignmentId,r.anchorId,JSON.stringify(r)]);
  const submissions = methods('tcl_r24_sync_v1_submissions','id,team_id,assignment_id,anchor_id,submitted_at,payload',
    r=>[r.id,r.teamId,r.assignmentId,r.anchorId,r.submittedAt,JSON.stringify(r)]);
  return {
    getAssignment:assignments.get,createAssignment:assignments.create,getClaim:claims.get,createClaim:claims.create,
    getSubmission:submissions.get,createSubmission:submissions.create,
  };
}

async function initialize(db) {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);
    create table storage.objects(id text,bucket_id text);
    alter table storage.buckets enable row level security;
    alter table storage.objects enable row level security;
  `);
  for (const file of ['schema-postgresql.sql','schema-workflow-v2.sql','schema-repository-scoring.sql']) {
    await db.exec(await readFile(new URL('../cloudbase/'+file,import.meta.url),'utf8'));
  }
  for (const actor of [operator,anchor]) {
    await db.query('insert into public.tcl_r24_sync_v1_enrollments(id,team_id,role,display_name,active) values ($1,$2,$3,$4,true)',
      [actor.id,teamId,actor.role,actor.displayName]);
  }
}

// Production archive client with a local Contents API double backed by real Git
// objects. This double has no network client and only recognizes the pinned path.
async function localGitArchive(dir) {
  const metadataRepo = process.env.GITHUB_REPOSITORY || 'synthetic/offline-review';
  const base = 'https://api.github.com/repos/'+metadataRepo;
  const git = (...args) => execFileSync('git',['-c','user.name=R24 synthetic test','-c','user.email=qa@example.invalid',
    '-c','commit.gpgsign=false',...args],{cwd:dir,encoding:'utf8',env:{PATH:process.env.PATH,HOME:dir}});
  git('init','-q','-b',branch);
  git('commit','--allow-empty','-qm','Initialize synthetic receipt branch');
  const archive = createRepositoryArchive({repo:metadataRepo,token:'in-memory-test-token',
    async fetchImpl(url,options) {
      if (url===base && options.method==='GET') {
        return Response.json({full_name:metadataRepo,private:true,default_branch:'main'});
      }
      if (url===base+'/branches/'+branch && options.method==='GET') {
        return Response.json({name:branch,protected:false});
      }
      if (url===base+'/contents/'+path+'?ref='+branch && options.method==='GET') {
        if (!git('ls-files','--',path).trim()) return new Response(null,{status:404});
        const content = Buffer.from(git('show','HEAD:'+path)).toString('base64');
        return Response.json({type:'file',path,encoding:'base64',sha:git('rev-parse','HEAD:'+path).trim(),content});
      }
      if (url===base+'/contents/'+path && options.method==='PUT') {
        const input = JSON.parse(options.body);
        assert.equal(input.branch,branch);
        assert.ok(!Object.hasOwn(input,'sha'));
        const target = join(dir,path);
        await mkdir(dirname(target),{recursive:true});
        await writeFile(target,Buffer.from(input.content,'base64'),{flag:'wx'});
        git('add','--',path);
        git('commit','-qm','Add synthetic receipt');
        return Response.json({content:{type:'file',path,sha:git('rev-parse','HEAD:'+path).trim()}},{status:201});
      }
      throw new Error('Unexpected synthetic archive route');
    }});
  return {archive,git};
}

export async function runAcceptance(output, {live = false} = {}) {
  if (live && !liveAllowed(process.env)) throw new Error('Live acceptance requires the fixed first-attempt push');
  await mkdir(output,{recursive:true});
  // Refuse a second invocation in the same output folder before any paid call.
  await writeFile(join(output,'started.json'),JSON.stringify({live,startedAt:new Date().toISOString()}),{flag:'wx'});
  const db = new PGlite();
  const gitDir = await mkdtemp(join(tmpdir(),'r24-repo-scoring-'));
  const report = {mode:live?'official-openai':'offline-synthetic',sourceDatabase:'isolated PGlite',
    archiveTransport:'local Contents API double and isolated Git branch',publishedToCloudBase:false,
    providerCalls:0,workerScoreCalls:0,modelResponse:null,duplicateArchivedCommits:null,completed:false};
  try {
    await initialize(db);
    const api = createApi({store:submissionStore(db),authenticate: async token =>
      token===operator.id ? operator : token===anchor.id ? anchor : null,
      directory:{listAnchors:async ()=>[anchor]}});
    async function post(route, actor, payload) {
      const response = await api(new Request('https://training.example.invalid'+route,{method:'POST',
        headers:{'content-type':'application/json',authorization:'Bearer '+actor.id},body:JSON.stringify(payload)}));
      return {status:response.status,body:await response.json()};
    }
    const assignment = await makeAssignment({id:'r24-repo-eval',title:'合成入户配送作业',operatorName:operator.displayName,
      boardId:'01',platform:'京东',assignedTo:[],createdAt:'2026-11-24T00:00:00.000Z',deadline:'',
      questions:[{category:'TCL 电视',question,answer:referenceAnswer,keyPoints}]});
    const publish = await post('/assignments',operator,{assignment,recipientIds:[]});
    assert.equal(publish.status,201);
    const route = '/assignments/'+assignment.id;
    const claim = await post(route+'/claim',anchor,{});
    assert.equal(claim.status,201);
    const q = assignment.questions[0];
    const snapshot = {id:'synthetic-confirmed-session',assignmentId:assignment.id,assignmentVersion:assignment.version,
      assignmentSnapshotSha256:assignment.snapshotSha256,operatorName:operator.displayName,anchorName:anchor.displayName,
      boardId:assignment.boardId,platform:assignment.platform,turns:[{questionId:q.id,question,answer:answerText,
        transcript:'合成未校对语音草稿，应当排除。',model:q.model,sku:q.sku,asrStatus:'已人工核对'}]};
    const unauthorized = await post(route+'/submissions',operator,{snapshot});
    assert.equal(unauthorized.status,403);
    const earlier = await post(route+'/submissions',anchor,{snapshot:{...snapshot,id:'before-allowlist'}});
    assert.equal(earlier.status,201);
    const queue = createQueue((sql,args) => db.transaction(async tx => {
      await tx.exec('set local role r24_scoring_worker');
      return (await tx.query(sql,args)).rows[0].value;
    }));
    assert.equal(await queue.claim(randomUUID()),null);
    await db.query('insert into r24_repo_scoring.allowlist(team_id,assignment_id,anchor_id) values ($1,$2,$3)',
      [teamId,assignment.id,anchor.id]);
    assert.equal(await queue.claim(randomUUID()),null);
    const responses = await Promise.all([post(route+'/submissions',anchor,{snapshot}),post(route+'/submissions',anchor,{snapshot})]);
    report.submissionStatuses = responses.map(x=>x.status).sort();
    assert.deepEqual(report.submissionStatuses,[200,201]);
    for (const r of responses) assert.equal(r.body.submission.id,jobId);
    const changed = structuredClone(snapshot);
    changed.turns[0].answer = '这是不应覆盖原始记录的合成文字。';
    const conflict = await post(route+'/submissions',anchor,{snapshot:changed});
    assert.equal(conflict.status,409);
    report.entrypoint = {published:publish.status,claimed:claim.status,wrongRole:unauthorized.status,
      invalidReplacement:conflict.status,beforeAllowlistNotBackfilled:true};
    const {archive,git} = await localGitArchive(gitDir);
    const provider = live ? createOpenAIScorer(process.env.OPENAI_API_KEY,{async fetchImpl(url, options) {
      assert.equal(url,'https://api.openai.com/v1/chat/completions');
      assert.equal(report.providerCalls,0);
      report.providerCalls++;
      const response = await fetch(url,options);
      report.providerHttpStatus = response.status;
      return response;
    }}) : async () => ({model:'gpt-4o-mini',source:'openai_offline',overallScore:90,grade:'优秀',
      items:[{questionIndex:0,score:90,matchedPoints:[...keyPoints],missedPoints:[],
        comment:'离线模拟核对。',suggestedScript:referenceAnswer}]});
    async function score(items) {
      assert.equal(report.workerScoreCalls,0);
      report.workerScoreCalls++;
      assert.deepEqual(items,[fixture]);
      const result = await provider(items);
      if (live) report.modelResponse = {model:result.model,requestId:result.requestId,
        elapsedMs:result.elapsedMs,usage:result.usage};
      return result;
    }
    await archive.verifyDestination();
    const result = await processOne({queue,score,archive,lease:randomUUID()});
    assert.equal(result.status,'archived');
    assert.equal((await processOne({queue,score,archive,lease:randomUUID()})).status,'empty');
    const {rows} = await db.query('select state,result,receipt from r24_repo_scoring.jobs where job_id=$1',[jobId]);
    assert.equal(rows.length,1);
    const row = rows[0];
    assert.equal(row.state,'archived');
    const receiptBytes = Buffer.from(git('show','HEAD:'+path));
    const archived = JSON.parse(receiptBytes);
    assert.deepEqual(row.receipt,archived);
    assert.equal(row.result.overallScore,archived.overallScore);
    assert.equal(row.result.grade,archived.grade);
    assert.deepEqual(row.result.items.map(i=>i.score),archived.items.map(i=>i.score));
    assert.equal(archived.reviewStatus,'pending_review');
    assert.equal((await archive(archived)).status,'already_archived');
    const commitCount = Number(git('rev-list','--count','HEAD','--',path).trim());
    assert.equal(commitCount,1);
    assert.equal(report.workerScoreCalls,1);
    assert.equal(report.providerCalls,live?1:0);
    const source = (await db.query('select payload from public.tcl_r24_sync_v1_submissions where id=$1',[jobId])).rows[0];
    assert.equal(source.payload.evaluation,undefined);
    assert.equal(source.payload.turns[0].answer,answerText);
    await writeFile(join(output,'receipt.json'),receiptBytes,{flag:'wx'});
    report.duplicateArchivedCommits = commitCount-1;
    report.originalSubmissionUnchanged = true;
    report.jobState = row.state;
    report.jobId = jobId;
    report.receiptSha256 = createHash('sha256').update(receiptBytes).digest('hex');
    report.completed = true;
  } finally {
    await writeFile(join(output,'evidence.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    await db.close();
    await rm(gitDir,{recursive:true,force:true});
  }
  return report;
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length!==3) throw new Error('Usage: node acceptance.mjs OUTPUT_DIRECTORY');
  await runAcceptance(resolve(process.argv[2]),{live:process.env.TEST_LIVE_OPENAI==='true'});
}
