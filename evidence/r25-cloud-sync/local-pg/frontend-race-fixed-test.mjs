/** localPGmock-auth + actual workflow: independent regression for auth and partition races. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {withIdentity} from './bootstrap.mjs';
const modulePath='/workspace/tcl-r25-cloud/experiments/r25/tcl-v352-asr-r25-qa/cloud-workflow.mjs';
const hash=async()=>crypto.createHash('sha256').update(await fs.readFile(modulePath)).digest('hex');
const report={scope:'localPGmock-auth+mockSDK',moduleShaBefore:await hash(),checks:[],cloudCalls:0};
const {createCloudWorkflow}=await import(modulePath);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
const tick=()=>new Promise(r=>setTimeout(r,0));
const check=(name,ok,detail)=>{report.checks.push({name,pass:!!ok,...(detail===undefined?{}:{detail})});assert.ok(ok,name+': '+JSON.stringify(detail))};
const makeStore=()=>{const rows=new Map();return{rows,get:async id=>rows.get(id),put:async row=>rows.set(row.id,structuredClone(row)),close:async()=>{},list:async()=>[...rows.values()]}};
const config={enabled:true,envId:'local-only',functionName:'r25wf_api'};
let db;
try{
 // A slow native login cannot run concurrently with the later B login.
 {
  let uid=null,partition=null;const starts={A:deferred(),B:deferred()},finishes={A:deferred(),B:deferred()};let startedB=false;
  const workflow=createCloudWorkflow({config,sdkFactory:async()=>({__r25Auth:{getSession:async()=>uid?{uid}:null,signIn:async name=>{if(name==='B')startedB=true;starts[name].resolve();await finishes[name].promise;uid=name},signOut:async()=>uid=null}}),operationStoreFactory:makeStore,businessTransport:async()=>({ok:true,data:{registered:true,user:{uid,role:'anchor',active:true}}}),onIdentityChange:async next=>partition=next?.uid||null});
  const a=workflow.signIn('A','synthetic').catch(e=>e);await starts.A.promise;const b=workflow.signIn('B','synthetic');await tick();check('second_native_login_waits_for_first',!startedB);
  finishes.A.resolve();await starts.B.promise;finishes.B.resolve();await b;const aResult=await a;
  check('stale_login_rejected',aResult.code==='STALE_SESSION');check('final_sdk_identity_matches_local_user',uid==='B'&&workflow.user.uid==='B'&&partition==='B',{uid,user:workflow.user.uid,partition});
 }
 // Slow A partition callback must finish or be invalidated before B applies.
 {
  let uid=null,partition=null,bDone=false;const entered=deferred(),release=deferred();
  const workflow=createCloudWorkflow({config,sdkFactory:async()=>({__r25Auth:{getSession:async()=>uid?{uid}:null,signIn:async name=>uid=name,signOut:async()=>uid=null}}),operationStoreFactory:makeStore,businessTransport:async()=>({ok:true,data:{registered:true,user:{uid,role:'anchor',active:true}}}),onIdentityChange:async next=>{if(next?.uid==='A'){entered.resolve();await release.promise}partition=next?.uid||null}});
  const a=workflow.signIn('A','synthetic').catch(e=>e);await entered.promise;const b=workflow.signIn('B','synthetic').then(v=>{bDone=true;return v});await tick();check('new_partition_cannot_finish_before_old_callback',!bDone);release.resolve();await Promise.all([a,b]);
  check('late_partition_cannot_replace_new_user_partition',workflow.user.uid==='B'&&partition==='B',{user:workflow.user.uid,partition});
 }
 // Native session drifts after preflight: actual SQL expectedActorUid guard rejects prior to business insert.
 {
  db=new PGlite('./pg-data',{extensions:{pgcrypto}});await db.waitReady;let uid='000123',armed=false;const store=makeStore(),events=[];
  const workflow=createCloudWorkflow({config,sdkFactory:async()=>({__r25Auth:{getSession:async()=>{const captured=uid;if(armed){armed=false;queueMicrotask(()=>uid='local-anchor-B')}return{uid:captured}},signIn:async name=>uid=name,signOut:async()=>uid=null}}),operationStoreFactory:()=>store,businessTransport:async event=>{events.push({actor:uid,event:structuredClone(event)});return withIdentity(db,{uid},async()=>(await db.query('SELECT public.r25wf_api($1,$2::jsonb,$3) AS result',[event.action,JSON.stringify(event.payload),event.operationId||null])).rows[0].result)}});
  await workflow.initialize();check('real_sql_initializes_expected_local_actor',workflow.user?.uid==='000123');armed=true;
  let error;try{await workflow.durableWrite('submissions.create',{id:'race-must-not-commit',operatorId:'local-operator-A',sessionId:'race-session',snapshot:{turns:[{answer:'synthetic private content'}]}},'race-must-not-commit')}catch(e){error=e}
  check('drift_returns_stale_session',error?.code==='STALE_SESSION',{code:error?.code});
  const event=events.find(x=>x.event.action==='submissions.create');check('wire_retains_original_actor_assertion',event?.actor==='local-anchor-B'&&event.event.payload.expectedActorUid==='000123',event);
  const rows=await db.query("SELECT count(*)::int AS n FROM public.r25wf_submissions WHERE id='race-must-not-commit'");check('drift_writes_zero_business_rows',rows.rows[0].n===0,rows.rows);
  check('wrong_actor_never_gets_confirmed_outbox_receipt',store.rows.get('submissions.create:race-must-not-commit').status==='pending');
 }
 report.moduleShaAfter=await hash();check('source_unchanged_during_probes',report.moduleShaAfter===report.moduleShaBefore);report.status='PASS';
}catch(e){report.status='FAIL';report.error={message:e.message,stack:e.stack}}
finally{if(db)await db.close();await fs.writeFile('frontend-race-fixed-result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))}
if(report.status!=='PASS')process.exitCode=1;
