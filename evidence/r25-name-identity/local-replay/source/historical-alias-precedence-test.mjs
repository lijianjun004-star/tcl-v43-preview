/** Actual old SQL creates a historical collision; current migration/handler must preserve raw native login. */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createDatabase} from './bootstrap.mjs';
import {databaseTransport,seedFixtures,seedInvite,sha,md5,writeReport} from './harness.mjs';
const require=createRequire(import.meta.url),product='/workspace/tcl-r25-name-login/backend/r25-name-identity';
const report={scope:'localPGmock-auth-historical-collision-upgrade',checks:[],cloudCalls:0};let db;
const check=(name,ok,detail)=>{report.checks.push({name,pass:!!ok,...(detail===undefined?{}:{detail})});assert.ok(ok,name+': '+JSON.stringify(detail))};
try{
 db=await createDatabase();await db.exec(await fs.readFile('/workspace/tcl-r25-name-login/backend/r25-cloudbase/schema.sql','utf8'));await seedFixtures(db);await db.exec(await fs.readFile('./pre-casefold-001.sql','utf8'));let call=databaseTransport(db);
 check('old_native_mapping_created',(await call('backfill',{identities:[{uid:'legacy-one',nativeUsername:'tcl_user'}]})).ok);
 const invite=await seedInvite(db,{code:crypto.randomBytes(16).toString('hex')}),proof={name:'TCL_USER',operationId:crypto.randomUUID(),operationProof:sha(crypto.randomBytes(32)),inviteHash:md5(invite.code)},r=await call('reserve',proof);check('old_sql_allows_casefold_collision_fixture',r.ok);
 const f=await call('finalize',{operationId:proof.operationId,operationProof:proof.operationProof,providerUid:'historical-new-N',nativeUsername:r.data.username,marker:r.data.marker});check('old_fixture_alias_finalized',f.ok);
 const beforeUsers=(await db.query('SELECT * FROM public.r25wf_users ORDER BY uid')).rows,beforeAliases=(await db.query('SELECT * FROM public.r25wf_name_aliases ORDER BY name_key')).rows;
 const sql=await fs.readFile(product+'/001-name-identity.sql','utf8');report.serviceSha=sha(sql);await db.exec(sql);
 check('migration_does_not_rewrite_existing_users',JSON.stringify((await db.query('SELECT * FROM public.r25wf_users ORDER BY uid')).rows)===JSON.stringify(beforeUsers));
 check('migration_does_not_delete_historical_aliases',JSON.stringify((await db.query('SELECT * FROM public.r25wf_name_aliases ORDER BY name_key')).rows)===JSON.stringify(beforeAliases));
 const {createIdentityService}=require(product+'/handler.cjs');report.handlerSha=sha(await fs.readFile(product+'/handler.cjs'));const service=createIdentityService({provider:{dbCall:call,findNativeUser:async username=>username==='tcl_user'?{uid:'legacy-one',username:'tcl_user',description:'legacy-native',status:'ACTIVE'}:null,createNativeUser:async()=>{throw new Error('unexpected native creation')}}});
 const old=await service.handle({action:'resolve',name:'tcl_user'},{rateKey:sha('historical-local')});check('exact_native_username_wins_over_conflicting_historical_alias',old.ok&&old.data.uid==='legacy-one'&&old.data.username==='tcl_user',old);
 const upper=await service.handle({action:'resolve',name:'TCL_USER'},{rateKey:sha('historical-local')});check('without_exact_native_match_existing_alias_uid_not_merged',upper.ok&&upper.data.uid==='historical-new-N'&&upper.data.username===r.data.username,upper);
 report.status='PASS';
}catch(e){report.status='FAIL';report.error={message:e.message,code:e.code,stack:e.stack}}
finally{if(db)await db.close();await writeReport('historical-alias-precedence-result.json',report);console.log(JSON.stringify(report,null,2))}
if(report.status!=='PASS')process.exitCode=1;
