/** localPGmock-auth: real PostgreSQL RPC/RLS, synthetic auth claims/storage metadata. No CloudBase SDK/network. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import {createDatabase,withIdentity,scope} from './bootstrap.mjs';
const schemaPath=process.env.R25_SCHEMA||'/workspace/tcl-r25-cloud/backend/r25-cloudbase/schema.sql';
const root=path.dirname(new URL(import.meta.url).pathname);
const report={scope,startedAt:new Date().toISOString(),checks:[],errors:[],productModified:false,cloudCalls:0};
const checks=report.checks;
let db;
function check(name, ok, detail){checks.push({name,pass:!!ok,...(detail===undefined?{}:{detail})});assert.ok(ok,name+': '+JSON.stringify(detail));}
const identities={admin:'local-admin',opA:'local-operator-A',opB:'local-operator-B',a:'000123',b:'local-anchor-B',pending:'not-bound'};
let seq=0;
async function rpc(uid,action,payload={},key=undefined){
 const op=key===undefined?'local-op-'+(++seq):key;
 return withIdentity(db,{uid,role:'authenticated'},async()=>{
  const result=await db.query('SELECT public.r25wf_api($1,$2::jsonb,$3) AS result',[action,JSON.stringify(payload),op]);
  return result.rows[0].result;
 });
}
function success(name,value){check(name,value?.ok===true,value);return value.data;}
function error(name,value,code){check(name,value?.ok===false&&(!code||value.error?.code===code),value);return value.error;}
async function invite(admin,role,targetUid,name){const out=success('invite_'+name,await rpc(admin,'invites.create',{role,targetUid,displayName:name}));return out.invite.code;}
try{
 const sql=await fs.readFile(schemaPath,'utf8');report.schemaSha256=crypto.createHash('sha256').update(sql).digest('hex');
 const dataDir=path.join(root,'pg-data');
 await fs.rm(dataDir,{recursive:true,force:true});
 db=await createDatabase(dataDir);await db.exec(sql);check('schema_applies',true);
 await db.query("INSERT INTO public.r25wf_users(uid,role,display_name,active) VALUES ($1,'admin','本地管理员',true)",[identities.admin]);
 success('admin_me',await rpc(identities.admin,'me'));
 const pending=success('pending_me',await rpc(identities.pending,'me'));check('pending_has_no_role',pending.user.role==='pending'&&pending.registered===false,pending);
 error('pending_cannot_create',await rpc(identities.pending,'assignments.create',{title:'bad',boardId:'01',platform:'京东'}),'NOT_REGISTERED');
 for(const k of ['opA','opB']){const code=await invite(identities.admin,'operator',identities[k],k);success('redeem_'+k,await rpc(identities[k],'invites.redeem',{code}));}
 for(const k of ['a','b']){const code=await invite(identities.opA,'anchor',identities[k],k);success('redeem_'+k,await rpc(identities[k],'invites.redeem',{code}));}
 const aMe=success('numeric_uid_me',await rpc(identities.a,'me'));check('numeric_uid_is_text',aMe.user.uid==='000123',aMe);
 error('operator_cannot_invite_operator',await rpc(identities.opA,'invites.create',{role:'operator'}),'FORBIDDEN');
 error('admin_cannot_invite_admin',await rpc(identities.admin,'invites.create',{role:'admin'}));
 error('missing_operation_id',await rpc(identities.opA,'assignments.create',{id:'missing-op',title:'bad',boardId:'01',platform:'京东'},null),'OPERATION_ID_REQUIRED');
 const assignmentPayload={id:'assignment-main',title:'本地跨设备作业',boardId:'01',platform:'京东'};
 const created=await rpc(identities.opA,'assignments.create',assignmentPayload,'assignment-key');
 const assignment=success('assignment_create',created).assignment;
 assert.deepEqual(await rpc(identities.opA,'assignments.create',assignmentPayload,'assignment-key'),created);check('same_idempotency_response',true);
 error('idempotency_body_conflict',await rpc(identities.opA,'assignments.create',{...assignmentPayload,title:'changed'},'assignment-key'),'IDEMPOTENCY_CONFLICT');
 const beforeJoin=success('anchor_assignments_before_join',await rpc(identities.a,'assignments.list'));check('anchor_sees_only_joined',beforeJoin.items.length===0,beforeJoin);
 const joined=success('anchor_join',await rpc(identities.a,'assignments.join',{joinCode:assignment.joinCode}));check('join_owner_from_auth',joined.join.anchorUid===identities.a,joined);
 success('rejoin_own_assignment',await rpc(identities.a,'assignments.join',{assignmentId:assignment.id}));
 error('foreign_operator_progress',await rpc(identities.opB,'assignments.progress',{assignmentId:assignment.id}),'FORBIDDEN');
 const trainingPayload={id:'training-A',assignmentId:assignment.id,boardId:'01',platform:'京东',durationSeconds:25};
 success('record_training',await rpc(identities.a,'training.record',trainingPayload));
 error('training_id_immutable',await rpc(identities.a,'training.record',{...trainingPayload,durationSeconds:99}));
 error('unjoined_anchor_training_rejected',await rpc(identities.b,'training.record',{...trainingPayload,id:'training-B'}),'NOT_JOINED');
 const snapshot={anchorName:'伪造姓名',turns:[{id:'turn1',prompt:'介绍型号',answer:'这是本地人工答案',model:'Q10',sku:'001',sourceRef:'本地行1'},{id:'turn2',prompt:'安装',answer:'人工回答2'}]};
 error('assignment_rejects_spoofed_receiver',await rpc(identities.a,'submissions.create',{id:'spoofed-receiver',assignmentId:assignment.id,sessionId:'training-A',operatorId:identities.opB,snapshot}),'FORBIDDEN');
 const submissionPayload={id:'submission-A',assignmentId:assignment.id,sessionId:'training-A',operatorId:identities.opA,snapshot};
 const receipt=success('submit_assignment',await rpc(identities.a,'submissions.create',submissionPayload));
 check('server_locks_actor_receiver',receipt.submission.anchorUid===identities.a&&receipt.submission.operatorUid===identities.opA,receipt);
 const got=success('receiver_reads_submission',await rpc(identities.opA,'submissions.get',{id:'submission-A'}));check('snapshot_metadata_roundtrip',got.submission.snapshot.turns[0].sku==='001'&&got.submission.snapshot.turns[0].sourceRef==='本地行1',got);
 error('other_operator_no_submission',await rpc(identities.opB,'submissions.get',{id:'submission-A'}));
 error('other_anchor_no_submission',await rpc(identities.b,'submissions.get',{id:'submission-A'}));
 success('operator_feedback',await rpc(identities.opA,'feedback.create',{id:'feedback-A',submissionId:'submission-A',body:'请把型号讲清楚'}));
 const f=success('anchor_reads_feedback',await rpc(identities.a,'feedback.list',{submissionId:'submission-A'}));check('feedback_visible_to_anchor',f.items.length===1&&f.items[0].body==='请把型号讲清楚',f);
 error('anchor_cannot_write_feedback',await rpc(identities.a,'feedback.create',{submissionId:'submission-A',body:'forged'}),'FORBIDDEN');
 error('foreign_operator_cannot_write_feedback',await rpc(identities.opB,'feedback.create',{submissionId:'submission-A',body:'forged'}),'FORBIDDEN');
 const progress=success('operator_progress_metadata',await rpc(identities.opA,'assignments.progress',{assignmentId:assignment.id}));check('progress_has_no_answers',!JSON.stringify(progress).includes('本地人工答案'),progress);
 error('empty_snapshot_rejected',await rpc(identities.a,'submissions.create',{id:'empty',operatorId:identities.opA,snapshot:{turns:[]}}));
 error('too_many_turns_rejected',await rpc(identities.a,'submissions.create',{id:'many',operatorId:identities.opA,snapshot:{turns:Array.from({length:201},(_,i)=>({id:String(i),answer:'a'}))}}));
 error('not_uploaded_media_rejected',await rpc(identities.a,'submissions.create',{id:'not-uploaded',operatorId:identities.opA,snapshot,media:[{path:'000123/absent.wav',mime:'audio/wav',size:20}]}));
 let bypassRejected=false;
 try{await withIdentity(db,{uid:identities.a},()=>db.query('SELECT * FROM public.r25wf_submissions'));}catch(e){bypassRejected=e.code==='42501';}
 if(!bypassRejected){const rows=await withIdentity(db,{uid:identities.a},()=>db.query('SELECT * FROM public.r25wf_submissions'));bypassRejected=rows.rows.length===0;}
 check('direct_table_bypass_blocked',bypassRejected);
 let anonBlocked=false;try{const v=await withIdentity(db,{role:'anon'},()=>db.query("SELECT public.r25wf_api('me','{}','anon-key') as result"));anonBlocked=v.rows[0].result?.ok===false;}catch(e){anonBlocked=e.code==='42501';}check('anon_rpc_blocked',anonBlocked);
 error('auth_actor_assertion_blocks_wrong_write',await rpc(identities.opA,'assignments.create',{id:'must-not-exist',title:'wrong actor',boardId:'01',platform:'京东',expectedActorUid:identities.opB}),'STALE_SESSION');
 const blockedRows=await db.query("SELECT count(*)::int AS n FROM public.r25wf_assignments WHERE id='must-not-exist'");check('wrong_actor_assertion_writes_zero_rows',blockedRows.rows[0].n===0,blockedRows.rows);
 error('me_rejects_wrong_actor_assertion',await rpc(identities.a,'me',{expectedActorUid:identities.b}),'STALE_SESSION');
 assert.deepEqual(await rpc(identities.opA,'assignments.create',{...assignmentPayload,expectedActorUid:identities.opA},'assignment-key'),created);check('correct_actor_assertion_does_not_change_old_idempotency_body',true);
 const guardedPayload={id:'guarded-new',title:'correct actor',boardId:'01',platform:'京东',expectedActorUid:identities.opA};
 const guarded=await rpc(identities.opA,'assignments.create',guardedPayload,'guarded-key');success('correct_actor_assertion_new_write_succeeds',guarded);
 const stripped={...guardedPayload};delete stripped.expectedActorUid;assert.deepEqual(await rpc(identities.opA,'assignments.create',stripped,'guarded-key'),guarded);check('assertion_stripped_before_idempotency_storage',true);
 await db.close();db=new PGlite(path.join(root,'pg-data'),{extensions:{pgcrypto}});await db.waitReady;
 const reopened=success('reopen_persistent_submission',await rpc(identities.opA,'submissions.get',{id:'submission-A'}));check('data_survives_pg_restart',reopened.submission.snapshot.turns[0].sku==='001',reopened);
 assert.deepEqual(await rpc(identities.opA,'assignments.create',assignmentPayload,'assignment-key'),created);check('idempotency_survives_pg_restart',true);
 report.status='PASS';
}catch(e){report.status='FAIL';report.errors.push({message:e.message,code:e.code,stack:e.stack});}
finally{
 if(db)await db.close();report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(root,'workflow-result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
if(report.status!=='PASS')process.exitCode=1;
