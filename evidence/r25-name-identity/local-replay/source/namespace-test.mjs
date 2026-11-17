/** Local actual service SQL: raw native usernames and human aliases share reserved namespace. */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {loadDatabase,databaseTransport,seedInvite,sha,md5,writeReport} from './harness.mjs';
const report={scope:'localPGmock-auth-native-namespace',checks:[],cloudCalls:0};let db;
const check=(name,pass,detail)=>{report.checks.push({name,pass:!!pass,...(detail===undefined?{}:{detail})});assert.ok(pass,name+': '+JSON.stringify(detail))};
const ok=(name,r)=>{check(name,r.ok,r);return r.data};
const reject=(name,r)=>{check(name,!r.ok,r);return r};
const request=(name,code)=>({name,operationId:crypto.randomUUID(),operationProof:sha(crypto.randomBytes(32)),inviteHash:md5(code)});
try{
 const loaded=await loadDatabase();db=loaded.db;report.serviceShaBefore=loaded.serviceSha;const service=databaseTransport(db);
 const oldUser=(await db.query("SELECT * FROM public.r25wf_users WHERE uid='legacy-one'")).rows[0];
 ok('backfill_old_raw_native_username',await service('backfill',{identities:[{uid:'legacy-one',nativeUsername:'tcl_user'}]}));
 const invite=await seedInvite(db,{code:crypto.randomBytes(16).toString('hex')});reject('casefold_native_username_blocks_human_alias_reservation',await service('reserve',request('TCL_USER',invite.code)));
 check('rejected_native_namespace_claim_does_not_consume_invite',(await db.query('SELECT consumed_by FROM public.r25wf_invites WHERE id=$1',[invite.id])).rows[0].consumed_by===null);
 check('rejected_native_namespace_claim_creates_no_registration',(await db.query("SELECT count(*)::int n FROM public.r25wf_name_registrations WHERE name_key='tcl_user'")).rows[0].n===0);
 // Create a different alias, then attempt trusted backfill of another old UID's raw username onto it.
 const aliasInvite=await seedInvite(db,{code:crypto.randomBytes(16).toString('hex')}),ap=request('ALIAS_CONFLICT',aliasInvite.code),ar=ok('new_unrelated_alias_reserves',await service('reserve',ap));
 ok('new_unrelated_alias_finalizes',await service('finalize',{operationId:ap.operationId,operationProof:ap.operationProof,providerUid:'local-alias-owner',nativeUsername:ar.username,marker:ar.marker}));
 reject('backfill_native_username_cannot_shadow_other_uid_alias',await service('backfill',{identities:[{uid:'legacy-two',nativeUsername:'alias_conflict'}]}));
 check('rejected_backfill_does_not_install_native_mapping',(await db.query("SELECT count(*)::int n FROM public.r25wf_native_identities WHERE uid='legacy-two'")).rows[0].n===0);
 check('existing_alias_owner_unchanged',(await db.query("SELECT uid FROM public.r25wf_name_aliases WHERE name_key='alias_conflict'")).rows[0].uid==='local-alias-owner');
 // A held reservation also blocks subsequent native username migration into its normalized key.
 const pendingInvite=await seedInvite(db,{code:crypto.randomBytes(16).toString('hex')}),pp=request('PENDING_CONFLICT',pendingInvite.code);ok('pending_alias_reserves',await service('reserve',pp));
 reject('backfill_native_username_cannot_shadow_pending_reservation',await service('backfill',{identities:[{uid:'legacy-two',nativeUsername:'pending_conflict'}]}));
 check('pending_backfill_failure_keeps_native_mapping_empty',(await db.query("SELECT count(*)::int n FROM public.r25wf_native_identities WHERE uid='legacy-two'")).rows[0].n===0);
 const pending=(await db.query('SELECT uid,state FROM public.r25wf_name_registrations WHERE operation_id=$1',[pp.operationId])).rows[0];check('pending_reservation_not_taken_over',pending.state==='reserved'&&pending.uid===null,pending);
 const oldNative=ok('exact_old_native_login_keeps_uid',await service('resolveLegacy',{providerUid:'legacy-one',nativeUsername:'tcl_user'}));check('old_native_uid_is_original',oldNative.uid==='legacy-one');
 check('old_business_identity_unchanged',JSON.stringify((await db.query("SELECT * FROM public.r25wf_users WHERE uid='legacy-one'")).rows[0])===JSON.stringify(oldUser));
 report.serviceShaAfter=sha(await fs.readFile('/workspace/tcl-r25-name-login/backend/r25-name-identity/001-name-identity.sql'));check('source_unchanged',report.serviceShaAfter===report.serviceShaBefore);report.status='PASS';
}catch(e){report.status='FAIL';report.error={message:e.message,code:e.code,stack:e.stack}}
finally{if(db)await db.close();await writeReport('namespace-result.json',report);console.log(JSON.stringify(report,null,2))}
if(report.status!=='PASS')process.exitCode=1;
