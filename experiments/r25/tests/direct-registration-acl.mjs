// Real PostgreSQL-in-WASM execution; Auth claims and Storage rows are synthetic.
// This script makes zero network/cloud calls and uses an isolated in-memory DB.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const packageOverride=process.env.R25_PGLITE_PACKAGE;
const {PGlite}=require(packageOverride || require.resolve('@electric-sql/pglite'));
const {pgcrypto}=require(packageOverride
  ? path.join(packageOverride,'dist/contrib/pgcrypto.cjs')
  : require.resolve('@electric-sql/pglite/contrib/pgcrypto'));
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const output=path.resolve(process.env.R25_ACL_RESULT||path.join(repo,'evidence/r25-direct-registration/acl-result.json'));
const report={scope:'Actual PGlite PostgreSQL/RLS execution with synthetic Auth claims and Storage metadata; not real CloudBase/Auth/Storage API acceptance',cloudCalls:0,actualNativeAuth:false,actualStorageApi:false,startedAt:new Date().toISOString(),checks:[],sourceSha256:{}};
let db,seq=0;
function check(name,value,detail){report.checks.push({name,pass:!!value,...(detail===undefined?{}:{detail})});assert.ok(value,name+': '+JSON.stringify(detail));}
function ok(name,value){check(name,value?.ok===true,value?.error);return value.data;}
function fail(name,value,code){check(name,value?.ok===false&&(!code||value.error?.code===code),value);}
async function sqlFile(relative){const text=await fs.readFile(path.join(repo,relative),'utf8');report.sourceSha256[relative]=crypto.createHash('sha256').update(text).digest('hex');await db.exec(text);}
async function as(uid,fn,role='authenticated'){
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[uid,role]);
  assert.ok(['authenticated','anon','service_role'].includes(role));await db.exec('SET ROLE '+role);
  try{return await fn();}finally{await db.exec('RESET ROLE');}
}
async function rpc(uid,action,payload={},operation='acl-'+(++seq)){return as(uid,async()=>(await db.query('SELECT public.r25wf_api($1,$2::jsonb,$3) AS result',[action,JSON.stringify({...payload,expectedActorUid:uid}),operation])).rows[0].result);}
async function identity(action,payload){return as('',async()=>(await db.query('SELECT public.r25wf_name_identity_service($1,$2::jsonb) AS result',[action,JSON.stringify(payload)])).rows[0].result,'service_role');}
async function denied(name,fn){let error;try{await fn();}catch(e){error=e;}check(name,!!error,error?{code:error.code,message:error.message}:undefined);}
const proof=label=>({operationId:'acl-register-'+label,operationProof:crypto.createHash('sha256').update(label).digest('hex')});
async function register(uid,name,role){const p={...proof(uid),name,role};const row=ok('reserve_'+uid,await identity('reserve',p));const ready=ok('finalize_'+uid,await identity('finalize',{...p,providerUid:uid,nativeUsername:row.username,marker:row.marker}));check('bound_role_'+uid,ready.role===role&&ready.uid===uid);return ready;}
const A='anchor-A',B='anchor-B',O='operator-A',P='operator-B',ADMIN='admin-existing';
const snap={turns:[{prompt:'型号介绍',answer:'仅授权接收者可见的答案',model:'Q10',sku:'001'}]};
try{
 db=new PGlite('memory://',{extensions:{pgcrypto}});await db.waitReady;
 await db.exec(`CREATE EXTENSION IF NOT EXISTS pgcrypto;
 CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'') $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon') $$;
 GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION auth.uid(),auth.role() TO anon,authenticated,service_role;
 CREATE SCHEMA storage;
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb DEFAULT '{}',path_tokens text[] GENERATED ALWAYS AS(string_to_array(name,'/')) STORED,UNIQUE(bucket_id,name));
 ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY; ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 GRANT USAGE ON SCHEMA storage TO anon,authenticated;
 GRANT SELECT,INSERT,UPDATE,DELETE ON storage.buckets,storage.objects TO anon,authenticated;
 CREATE POLICY fixture_legacy_bucket ON storage.buckets FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
 CREATE POLICY fixture_legacy_object ON storage.objects FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);`);
 await sqlFile('backend/r25-cloudbase/schema.sql');
 // Duplicate legacy profiles must precede the name uniqueness trigger.
 await db.exec(`INSERT INTO public.r25wf_users(uid,role,display_name) VALUES
 ('admin-existing','admin','管理员'),('legacy-duplicate-1','operator','同名运营'),('legacy-duplicate-2','operator','同名运营');`);
 await sqlFile('backend/r25-name-identity/001-name-identity.sql');
 const invite=ok('legacy_invite_create',await rpc(ADMIN,'invites.create',{role:'anchor'})).invite;
 const legacyProof=proof('legacy-pending');
 const legacy=ok('legacy_pending_before_migration',await identity('reserve',{...legacyProof,name:'旧预约主播',inviteHash:crypto.createHash('md5').update(invite.code.toLowerCase()).digest('hex')}));
 const before=(await db.query('SELECT uid,role,display_name FROM public.r25wf_users ORDER BY uid')).rows;
 await sqlFile('backend/r25-name-identity/002-direct-registration.sql');
 // Migration must also be safe to replay during a recovered deployment.
 await sqlFile('backend/r25-name-identity/002-direct-registration.sql');
 check('migration_preserves_existing_profiles',JSON.stringify(before)===JSON.stringify((await db.query('SELECT uid,role,display_name FROM public.r25wf_users ORDER BY uid')).rows));
 ok('legacy_pending_status_after_migration',await identity('status',legacyProof));
 const legacyReady=ok('legacy_pending_finalize_after_migration',await identity('finalize',{...legacyProof,providerUid:'legacy-pending',nativeUsername:legacy.username,marker:legacy.marker}));
 check('legacy_pending_preserves_invited_role',legacyReady.role==='anchor');
 for(const [uid,name,role] of [[O,'运营甲','operator'],[P,'运营乙','operator'],[A,'主播甲','anchor'],[B,'主播乙','anchor']])await register(uid,name,role);
 fail('public_admin_role_rejected',await identity('reserve',{...proof('forged-admin'),name:'伪造管理员',role:'admin'}),'INVALID_ROLE');
 check('admin_role_failure_reserves_nothing',(await db.query("SELECT count(*)::int n FROM public.r25wf_name_registrations WHERE operation_id='acl-register-forged-admin'")).rows[0].n===0);
 const pending=ok('direct_pending_reserved',await identity('reserve',{...proof('direct-pending'),name:'待恢复主播',role:'anchor'}));
 fail('pending_role_cannot_change',await identity('reserve',{...proof('direct-pending'),name:'待恢复主播',role:'operator'}),'REGISTRATION_CONFLICT');
 fail('status_role_cannot_change',await identity('status',{...proof('direct-pending'),role:'operator'}),'REGISTRATION_CONFLICT');
 fail('finalize_role_cannot_change',await identity('finalize',{...proof('direct-pending'),role:'operator',providerUid:'changed-role',nativeUsername:pending.username,marker:pending.marker}),'REGISTRATION_CONFLICT');
 fail('wrong_secret_cannot_recover',await identity('status',{...proof('direct-pending'),operationProof:'f'.repeat(64),role:'anchor'}),'INVALID_OPERATION_SECRET');
 const backfill=ok('duplicate_legacy_backfill',await identity('backfill',{identities:[{uid:'legacy-duplicate-1',nativeUsername:'legacy.op.1'},{uid:'legacy-duplicate-2',nativeUsername:'legacy.op.2'}]}));
 check('duplicate_legacy_not_merged',backfill.conflicts===2);
 fail('duplicate_legacy_name_does_not_resolve',await identity('resolve',{name:'同名运营'}),'NAME_CONFLICT');
 fail('duplicate_legacy_name_cannot_reregister',await identity('reserve',{...proof('duplicate-name'),name:'同名运营',role:'operator'}),'NAME_CONFLICT');
 const operators=ok('anchor_reads_authoritative_operators',await rpc(A,'operators.list')).items;
 check('duplicate_legacy_options_remain_ambiguous',operators.filter(x=>x.displayName==='同名运营').length===2);
 check('active_operators_have_stable_uid',operators.some(x=>x.uid===O)&&operators.some(x=>x.uid===P));
 check('anchors_not_offered_as_recipients',!operators.some(x=>[A,B].includes(x.uid)));
 fail('anchor_uid_cannot_receive',await rpc(A,'submissions.create',{id:'to-anchor',operatorId:B,snapshot:snap}),'INVALID_PAYLOAD');
 await db.query('UPDATE public.r25wf_users SET active=false WHERE uid=$1',[P]);
 fail('disabled_recipient_rejected',await rpc(A,'submissions.create',{id:'to-disabled',operatorId:P,snapshot:snap}),'INVALID_PAYLOAD');
 check('disabled_operator_omitted',!ok('disabled_operator_list',await rpc(A,'operators.list')).items.some(x=>x.uid===P));
 await db.query('UPDATE public.r25wf_users SET active=true WHERE uid=$1',[P]);
 await sqlFile('backend/r25-cloudbase/media-storage.sql');
 await sqlFile('backend/r25-cloudbase/media-storage-insert-compat.sql');
 await db.exec(`UPDATE public.r25wf_settings SET value='{"enabled":true}' WHERE key='private_media'`);
 const mediaPath=A+'/private.wav';
 await as(A,()=>db.query("INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('r25wf-private',$1,$2,$3::jsonb)",[mediaPath,A,JSON.stringify({size:20,mimetype:'audio/wav'})]));
 const mediaRows=uid=>as(uid,async()=>(await db.query("SELECT name FROM storage.objects WHERE bucket_id='r25wf-private' AND name=$1",[mediaPath])).rows);
 check('unsubmitted_media_denied_to_operator',(await mediaRows(O)).length===0);
 check('unsubmitted_media_denied_to_admin',(await mediaRows(ADMIN)).length===0);
 const submit={id:'submission-A',operatorId:O,sessionId:'session-A',snapshot:snap,media:[{path:mediaPath,mime:'audio/wav',size:20}]};
 const receipt=ok('anchor_submits_to_operator_A',await rpc(A,'submissions.create',submit,'receipt-A'));
 check('receipt_stores_auth_anchor_and_receiver',receipt.submission.anchorUid===A&&receipt.submission.operatorUid===O);
 ok('anchor_B_submits_to_operator_B',await rpc(B,'submissions.create',{id:'submission-B',operatorId:P,sessionId:'session-B',snapshot:snap}));
 const expected={[A]:['submission-A'],[B]:['submission-B'],[O]:['submission-A'],[P]:['submission-B'],[ADMIN]:['submission-A','submission-B']};
 for(const [uid,ids] of Object.entries(expected)){const data=ok('list_'+uid,await rpc(uid,'submissions.list'));check('default_list_scope_'+uid,JSON.stringify(data.items.map(x=>x.id).sort())===JSON.stringify(ids));check('list_omits_snapshot_'+uid,data.items.every(x=>x.snapshot===null));}
 for(const uid of [A,O,ADMIN]){const data=ok('get_authorized_'+uid,await rpc(uid,'submissions.get',{id:'submission-A'}));check('get_keeps_content_'+uid,data.submission.snapshot.turns[0].sku==='001');check('media_authorized_'+uid,(await mediaRows(uid)).length===1);}
 for(const uid of [B,P]){fail('get_denied_'+uid,await rpc(uid,'submissions.get',{id:'submission-A'}),'FORBIDDEN');fail('feedback_read_denied_'+uid,await rpc(uid,'feedback.list',{submissionId:'submission-A'}),'FORBIDDEN');fail('feedback_write_denied_'+uid,await rpc(uid,'feedback.create',{submissionId:'submission-A',body:'越权'}),'FORBIDDEN');check('media_denied_'+uid,(await mediaRows(uid)).length===0);}
 ok('receiver_feedback',await rpc(O,'feedback.create',{id:'feedback-operator',submissionId:'submission-A',body:'运营反馈'}));
 ok('admin_feedback_for_another_receiver',await rpc(ADMIN,'feedback.create',{id:'feedback-admin',submissionId:'submission-A',body:'管理员反馈'}));
 for(const uid of [A,O,ADMIN])check('feedback_visible_'+uid,ok('feedback_list_'+uid,await rpc(uid,'feedback.list',{submissionId:'submission-A'})).items.length===2);
 fail('anchor_cannot_write_feedback',await rpc(A,'feedback.create',{submissionId:'submission-A',body:'主播伪造反馈'}),'FORBIDDEN');
 fail('retry_cannot_change_receiver',await rpc(A,'submissions.create',{...submit,operatorId:P},'receipt-A'),'IDEMPOTENCY_CONFLICT');
 await denied('even_privileged_update_cannot_change_receiver',()=>db.query('UPDATE public.r25wf_submissions SET operator_uid=$1 WHERE id=$2',[P,'submission-A']));
 check('stored_receiver_unchanged',(await db.query("SELECT operator_uid FROM public.r25wf_submissions WHERE id='submission-A'")).rows[0].operator_uid===O);
 for(const table of ['users','submissions','submission_media','feedback','name_registrations','name_aliases'])await denied('authenticated_direct_table_denied_'+table,()=>as(A,()=>db.query('SELECT * FROM public.r25wf_'+table)));
 await denied('authenticated_identity_admin_rpc_denied',()=>as(A,()=>db.query("SELECT public.r25wf_name_identity_service('reserve','{}')")));
 await denied('anon_business_rpc_denied',()=>as('',()=>db.query("SELECT public.r25wf_api('me','{}',NULL)"),'anon'));
 check('anon_private_media_denied',(await as('',async()=>(await db.query("SELECT name FROM storage.objects WHERE bucket_id='r25wf-private'")).rows,'anon')).length===0);
 await db.query('UPDATE public.r25wf_users SET active=false WHERE uid=$1',[O]);
 fail('disabled_receiver_business_denied',await rpc(O,'submissions.get',{id:'submission-A'}),'ACCOUNT_DISABLED');
 check('disabled_receiver_media_denied',(await mediaRows(O)).length===0);
 await db.query('UPDATE public.r25wf_users SET active=true WHERE uid=$1',[O]);
 const assignment=ok('operator_assignment_create',await rpc(O,'assignments.create',{id:'assignment-A',title:'指定运营作业',boardId:'tv',platform:'京东'})).assignment;
 ok('anchor_assignment_join',await rpc(A,'assignments.join',{joinCode:assignment.joinCode}));
 fail('assignment_cannot_redirect_to_other_operator',await rpc(A,'submissions.create',{id:'redirect-assignment',assignmentId:assignment.id,operatorId:P,snapshot:snap}),'FORBIDDEN');
 const fixed=ok('assignment_uses_original_publisher',await rpc(A,'submissions.create',{id:'assignment-submission',assignmentId:assignment.id,snapshot:snap}));
 check('assignment_receiver_is_server_set',fixed.submission.operatorUid===O);
 report.status='PASS';
}catch(error){report.status='FAIL';report.error={message:error.message,code:error.code,stack:error.stack};}
finally{if(db)await db.close();report.finishedAt=new Date().toISOString();report.passed=report.checks.filter(x=>x.pass).length;report.total=report.checks.length;await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,passed:report.passed,total:report.total,output,error:report.error},null,2));}
if(report.status!=='PASS')process.exitCode=1;
