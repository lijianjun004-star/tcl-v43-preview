/** Local actual HTTP business handler + actual PG RPC, simulated official native provider. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {loadDatabase,databaseTransport,nativeFixture,seedFixtures,seedInvite,sha,writeReport} from './harness.mjs';
const require=createRequire(import.meta.url),SOURCE=process.env.IDENTITY_HANDLER||'/workspace/tcl-r25-name-login/backend/r25-name-identity/identity-service.cjs';
const report={scope:'localPGmock-auth+mock-official-native-provider',checks:[],cloudCalls:0,productModified:false};
const check=(name,ok,detail)=>{report.checks.push({name,pass:!!ok,...(detail===undefined?{}:{detail})});assert.ok(ok,name+': '+JSON.stringify(detail))};
const ok=(name,v)=>{check(name,v?.ok===true,v);return v.data};
const err=(name,v,code)=>{check(name,v?.ok===false&&(!code||v.error?.code===code),v);return v.error};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
let db;
try{
 const {createIdentityService}=require(SOURCE);const source=await fs.readFile(SOURCE);report.handlerShaBefore=sha(source);
 const loaded=await loadDatabase();db=loaded.db;report.serviceSha=loaded.serviceSha;await seedFixtures(db);const native=nativeFixture(),baseTransport=databaseTransport(db),sqlCalls=[];
 let failFinalize=false;
 const provider={...native,dbCall:async(action,payload)=>{
   sqlCalls.push({action,payload:structuredClone(payload)});
   if(action==='finalize'&&failFinalize){failFinalize=false;const e=new Error('synthetic finalize transport failure');e.code='SIMULATED_FINALIZE_FAILURE';throw e}
   return baseTransport(action,payload);
 }};
 const service=()=>createIdentityService({provider});let handler=service();const handle=(body,h=handler)=>h.handle(body,{rateKey:sha('local-rate-key')});
 const newRequest=async(name)=>{const code=crypto.randomBytes(16).toString('hex');await seedInvite(db,{code});return{action:'register',name,password:'Synthetic123',inviteCode:code,operationId:crypto.randomUUID(),operationSecret:crypto.randomBytes(32).toString('hex')}};
 const initial=await db.query('SELECT * FROM public.r25wf_users ORDER BY uid');
 const bad=await newRequest('额外角色拒绝');err('client_role_extra_field_rejected',await handle({...bad,role:'admin'}),'INVALID_REQUEST');check('extra_role_never_reserves',(await db.query('SELECT count(*)::int n FROM public.r25wf_name_registrations')).rows[0].n===0);
 const badInvite={...bad,inviteCode:crypto.randomBytes(16).toString('hex')};err('invalid_invite_handler_rejected',await handle(badInvite),'INVALID_INVITE');check('invalid_invite_never_calls_native_create',native.calls.filter(x=>x.method==='createNativeUser').length===0);
 for(const [label,password]of [['two_classes','abc12345'],['leading_symbol','!Pass123'],['nonofficial_symbol_not_counted','abc1234+']]){
  const invalid=await newRequest('密码拒绝'+label),beforeNative=native.calls.filter(x=>x.method==='createNativeUser').length;
  err('password_policy_'+label,await handle({...invalid,password}),'INVALID_PASSWORD');
  check('password_rejection_creates_no_reservation_'+label,(await db.query('SELECT count(*)::int n FROM public.r25wf_name_registrations WHERE operation_id=$1',[invalid.operationId])).rows[0].n===0);
  check('password_rejection_does_not_consume_invite_'+label,(await db.query('SELECT consumed_by FROM public.r25wf_invites WHERE code_hash=md5($1)',[invalid.inviteCode])).rows[0].consumed_by===null);
  check('password_rejection_never_calls_native_'+label,native.calls.filter(x=>x.method==='createNativeUser').length===beforeNative);
 }
 const normal=await newRequest('测试成员甲');const ready=ok('normal_register_finalizes_account',await handle(normal));check('ready_has_native_uid',ready.state==='ready'&&ready.uid?.startsWith('local-created-')&&/^r25n_[a-f0-9]{24}$/.test(ready.username),ready);
 const calls=native.calls.filter(x=>x.method==='createNativeUser').length;const retry=ok('same_operation_register_retry',await handle({...normal,password:'Different456'}));check('retry_keeps_native_uid_username',retry.uid===ready.uid&&retry.username===ready.username,retry);check('retry_never_creates_or_resets_native_password',native.calls.filter(x=>x.method==='createNativeUser').length===calls);
 const status=ok('status_recovers_ready_without_password',await handle({action:'status',name:normal.name,operationId:normal.operationId,operationSecret:normal.operationSecret}));check('status_same_native_identity',status.uid===ready.uid&&status.username===ready.username);
 err('wrong_secret_cannot_recover',await handle({action:'status',operationId:normal.operationId,operationSecret:crypto.randomBytes(32).toString('hex')}),'INVALID_OPERATION_SECRET');
 const resolved=ok('resolve_registered_name',await handle({action:'resolve',name:normal.name}));check('resolve_uses_alias_uid',resolved.uid===ready.uid&&resolved.username===ready.username);
 const wire=JSON.stringify(sqlCalls);check('password_and_raw_secrets_never_enter_sql',!wire.includes(normal.password)&&!wire.includes(normal.inviteCode)&&!wire.includes(normal.operationSecret));
 check('public_response_hides_internal_reservation_fields',!('marker'in ready)&&!('role'in ready)&&!('reservationId'in ready)&&!('operationProof'in ready),ready);
 // Crash after native creation and before persistent finalize. Fresh handler instance must recover via marker.
 const crash=await newRequest('崩溃恢复成员');failFinalize=true;const failed=await handle(crash);err('native_created_finalize_failure_not_ready',failed);const beforeRecovery=native.calls.filter(x=>x.method==='createNativeUser').length;
 handler=service();const recovered=ok('status_recovers_native_created_before_finalize',await handle({action:'status',name:crash.name,operationId:crash.operationId,operationSecret:crash.operationSecret}));check('status_recovery_creates_no_second_native_account',native.calls.filter(x=>x.method==='createNativeUser').length===beforeRecovery);check('status_recovery_returns_ready_uid',recovered.state==='ready'&&!!recovered.uid,recovered);
 // Two interleaved handlers cannot both create the same name. Actual SQL is serialized by PG client.
 const one=await newRequest('争抢姓名成员'),two=await newRequest('争抢姓名成员');const gate=deferred(),created=deferred();const originalCreate=provider.createNativeUser;
 provider.createNativeUser=async fields=>{created.resolve();await gate.promise;return originalCreate(fields)};
 const first=handle(one);await created.promise;err('second_operation_same_name_blocked_during_native_create',await handle(two),'NAME_PENDING');gate.resolve();ok('first_name_contender_finalizes',await first);provider.createNativeUser=originalCreate;
 const losingInvite=(await db.query('SELECT consumed_by FROM public.r25wf_invites WHERE code_hash=md5($1)',[two.inviteCode])).rows[0];check('losing_name_contender_own_invite_not_consumed',losingInvite.consumed_by===null);
 // Two names, same invitation, with first native creation suspended.
 const invOne=await newRequest('争抢邀请成员甲'),invTwo={...invOne,name:'争抢邀请成员乙',operationId:crypto.randomUUID(),operationSecret:crypto.randomBytes(32).toString('hex')};const gate2=deferred(),entered2=deferred();provider.createNativeUser=async fields=>{entered2.resolve();await gate2.promise;return originalCreate(fields)};
 const first2=handle(invOne);await entered2.promise;err('second_operation_same_invite_blocked_during_native_create',await handle(invTwo),'INVALID_INVITE');gate2.resolve();ok('first_invite_contender_finalizes',await first2);provider.createNativeUser=originalCreate;
 // A foreign native account bearing the reserved username cannot be recovered by name alone.
 const foreign=await newRequest('禁止冒领原生账号');const origFind=provider.findNativeUser;provider.findNativeUser=async name=>({uid:'legacy-one',username:name,description:'unrelated-existing-native-marker',status:'ACTIVE'});
 err('foreign_native_marker_not_adopted',await handle(foreign),'NATIVE_IDENTITY_CONFLICT');provider.findNativeUser=origFind;
 const reservedForeign=ok('foreign_uid_fixture_status',await baseTransport('status',{operationId:foreign.operationId,operationProof:sha(foreign.operationSecret)}));
 provider.findNativeUser=async name=>({uid:'legacy-one',username:name,description:reservedForeign.marker,status:'ACTIVE'});
 err('correct_marker_cannot_adopt_existing_business_uid',await handle({action:'status',operationId:foreign.operationId,operationSecret:foreign.operationSecret}),'NATIVE_IDENTITY_CONFLICT');provider.findNativeUser=origFind;
 // CreateUser committed, but its response was lost. Exact native marker recovery reuses that account.
 const lost=await newRequest('原生回复丢失成员'),beforeLost=native.users.size;native.failAfterNextCreate('SIMULATED_NATIVE_REPLY_LOST');
 const lostReady=ok('native_create_reply_lost_recovers_exact_marker',await handle(lost));check('lost_reply_creates_one_native_identity',native.users.size===beforeLost+1&&!!lostReady.uid);
 // Two simultaneous retries of one operation can reach official CreateUser together; native uniqueness + marker must converge.
 const same=await newRequest('同操作并发成员'),sameGate=deferred(),bothEntered=deferred();let enteredCount=0;
 provider.createNativeUser=async fields=>{if(++enteredCount===2)bothEntered.resolve();await sameGate.promise;return originalCreate(fields)};
 const beforeSame=native.users.size,same1=handle(same),same2=handle({...same});await bothEntered.promise;sameGate.resolve();const sameReplies=await Promise.all([same1,same2]);provider.createNativeUser=originalCreate;
 const sameReady1=ok('same_operation_parallel_first_ready',sameReplies[0]),sameReady2=ok('same_operation_parallel_second_ready',sameReplies[1]);
 check('same_operation_parallel_retries_converge_on_one_uid',sameReady1.uid===sameReady2.uid&&sameReady1.username===sameReady2.username&&native.users.size===beforeSame+1,sameReplies);
 const allWire=JSON.stringify(sqlCalls);check('all_secret_fields_never_enter_sql',![normal,crash,one,two,invOne,invTwo,foreign,lost,same].some(req=>[req.password,req.inviteCode,req.operationSecret].some(secret=>allWire.includes(secret))));
 const legacyAfter=await db.query("SELECT * FROM public.r25wf_users WHERE uid LIKE 'legacy-%' ORDER BY uid");const legacyBefore=initial.rows.filter(x=>x.uid.startsWith('legacy-'));check('all_legacy_uid_roles_names_unchanged',JSON.stringify(legacyAfter.rows)===JSON.stringify(legacyBefore));
 report.handlerShaAfter=sha(await fs.readFile(SOURCE));check('handler_source_unchanged',report.handlerShaAfter===report.handlerShaBefore);report.status='PASS';
}catch(e){report.status='FAIL';report.error={message:e.message,code:e.code,stack:e.stack}}
finally{if(db)await db.close();await writeReport('handler-result.json',report);console.log(JSON.stringify(report,null,2))}
if(report.status!=='PASS')process.exitCode=1;
