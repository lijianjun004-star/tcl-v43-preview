'use strict';
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {manager,sql,first,save,sha,ENV,PRIVATE}=require('./cloud-utils.cjs');
const ROOT='/workspace/tcl-r25-fix';const PKG='/workspace/r25-delivery/TCL-R25-Registration-Recovery-20261117';
const NAME='r25wf_name_identity';
const tables=['r25wf_users','r25wf_settings','r25wf_invites','r25wf_assignments','r25wf_joins','r25wf_training','r25wf_submissions','r25wf_submission_media','r25wf_feedback','r25wf_idempotency','r25wf_native_identities','r25wf_name_aliases','r25wf_name_conflicts','r25wf_name_registrations'];
async function snapshot(m){const pairs=[];for(const table of tables)pairs.push(`'${table}',(SELECT coalesce(jsonb_agg(md5(row_to_json(t)::text) ORDER BY md5(row_to_json(t)::text)),'[]'::jsonb) FROM public.${table} t)`);return first(await sql(m,'SELECT jsonb_build_object('+pairs.join(',')+')::text AS result'));}
async function preflight(m){
 assert.ok(!fs.existsSync(path.join(PRIVATE,'function-before.json')),'Preflight snapshot already exists; preserve baseline and review before resuming');
 const detail=await m.functions.getFunctionDetail(NAME);save('function-before.json',detail);
 const config={};for(const k of ['FunctionName','Runtime','Timeout','MemorySize','Handler','Role','Type','Status','CodeSha256','Environment'])if(k in detail)config[k]=detail[k];
 assert.equal(detail.FunctionName,NAME);assert.equal(detail.Handler,'index.main');assert.ok(/Nodejs20/i.test(detail.Runtime));assert.ok(detail.Type==='Event'||detail.Type==='EVENT');assert.ok(detail.Status==='Active'||detail.Status==='ACTIVE');
 const state=first(await sql(m,`SELECT jsonb_build_object('inviteColumns',(SELECT jsonb_object_agg(column_name,is_nullable) FROM information_schema.columns WHERE table_schema='public' AND table_name='r25wf_name_registrations' AND column_name IN ('invite_id','invite_hash')),'recoveryInstalled',to_regprocedure('public.r25wf_name_recovery_rotate(jsonb)') IS NOT NULL)::text AS result`));
 save('schema-before.json',state);save('original-business-hashes.json',await snapshot(m));
 const backup=path.join(PRIVATE,'function-before-code');fs.mkdirSync(backup,{mode:0o700});
 await m.functions.downloadFunctionCode({destPath:backup,envId:ENV,functionName:NAME});
 save('code-before-hashes.json',Object.fromEntries(['index.js','handler.cjs','provider-cloudbase.cjs'].map(n=>[n,sha(fs.readFileSync(path.join(backup,n)))])));
 save('preflight-complete.json',{complete:true,envId:ENV,functionName:NAME,completedAt:new Date().toISOString()});
 console.log(JSON.stringify({preflight:'PASS',envId:ENV,functionName:NAME,runtime:detail.Runtime,status:detail.Status,privateBackup:true,schema:state}));
}
async function migrate(m){
 assert.ok(fs.existsSync(path.join(PRIVATE,'preflight-complete.json')),'Run complete preflight first');
 // Read LIVE schema on each invocation; a saved preflight cannot decide migration state.
 const state=first(await sql(m,`SELECT jsonb_build_object('inviteColumns',(SELECT jsonb_object_agg(column_name,is_nullable) FROM information_schema.columns WHERE table_schema='public' AND table_name='r25wf_name_registrations' AND column_name IN ('invite_id','invite_hash')),'recoveryInstalled',to_regprocedure('public.r25wf_name_recovery_rotate(jsonb)') IS NOT NULL,'identityBodyMd5',(SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.r25wf_name_identity_service(text,jsonb)')))::text AS result`));
 assert.deepEqual(Object.keys(state.inviteColumns||{}).sort(),['invite_hash','invite_id']);
 const sources=['001-name-identity.sql','002-direct-registration.sql','003-registration-recovery.sql'].map(n=>fs.readFileSync(path.join(ROOT,'backend/r25-name-identity',n),'utf8'));
 const crypto=require('node:crypto');
 const bodyHash=text=>crypto.createHash('md5').update(text.split('AS $name_api$')[1].split('$name_api$;')[0]).digest('hex');
 assert.ok(sources.map(bodyHash).includes(state.identityBodyMd5),'Unknown deployed identity implementation; review before replacing');
 if(!state.recoveryInstalled && (state.inviteColumns.invite_id==='NO'||state.inviteColumns.invite_hash==='NO')){
  await m.database.executePGSql({Sql:fs.readFileSync(path.join(PKG,'backend/002-direct-registration.sql'),'utf8')});console.log('MIGRATION_002_EXECUTED');
 }
 // Safe to repeat 003; never repeat 002 after 003 has been installed.
 await m.database.executePGSql({Sql:fs.readFileSync(path.join(PKG,'backend/003-registration-recovery.sql'),'utf8')});console.log('MIGRATION_003_EXECUTED');
 const bodyAfter=first(await sql(m,`SELECT jsonb_build_object('identityBodyMd5',(SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.r25wf_name_identity_service(text,jsonb)')))::text AS result`));
 assert.equal(bodyAfter.identityBodyMd5,bodyHash(sources[2]),'Identity body mismatch after migration');
 const result=first(await sql(m,`SELECT jsonb_build_object('nullable',(SELECT bool_and(is_nullable='YES') FROM information_schema.columns WHERE table_schema='public' AND table_name='r25wf_name_registrations' AND column_name IN ('invite_id','invite_hash')),'anon',has_function_privilege('anon','public.r25wf_name_identity_service(text,jsonb)','EXECUTE'),'authenticated',has_function_privilege('authenticated','public.r25wf_name_identity_service(text,jsonb)','EXECUTE'),'service',has_function_privilege('service_role','public.r25wf_name_identity_service(text,jsonb)','EXECUTE'),'recoveryAnon',has_function_privilege('anon','public.r25wf_name_recovery_rotate(jsonb)','EXECUTE'),'recoveryAuthenticated',has_function_privilege('authenticated','public.r25wf_name_recovery_rotate(jsonb)','EXECUTE'),'recoveryService',has_function_privilege('service_role','public.r25wf_name_recovery_rotate(jsonb)','EXECUTE'))::text AS result`));
 assert.deepEqual(result,{nullable:true,anon:false,authenticated:false,service:true,recoveryAnon:false,recoveryAuthenticated:false,recoveryService:true});save('schema-after.json',result);console.log('MIGRATION_PERMISSIONS_PASS');
}
async function code(m){
 assert.ok(fs.existsSync(path.join(PRIVATE,'schema-after.json')),'Run migration first');
 // SDK default COS transfer; packed production dependencies are already present.
 await m.functions.updateFunctionCode({func:{name:NAME,runtime:'Nodejs20.19',handler:'index.main',installDependency:false},functionPath:'/workspace/r25-review/final-package-backend',deployMode:'cos'});
 console.log('FUNCTION_CODE_UPLOAD_REQUEST_ACCEPTED');
 await m.functions.waitFunctionActive(NAME);
 console.log('FUNCTION_ACTIVE');
}
async function verify(m){
 const before=JSON.parse(fs.readFileSync(path.join(PRIVATE,'function-before.json'))),after=await m.functions.getFunctionDetail(NAME);save('function-after.json',after);
 for(const k of ['Runtime','Timeout','MemorySize','Handler','Role','Type','Environment'])assert.deepEqual(after[k],before[k],'Changed config '+k);
 assert.ok(after.Status==='Active'||after.Status==='ACTIVE');
 const backup=path.join(PRIVATE,'function-after-code');fs.mkdirSync(backup,{mode:0o700});await m.functions.downloadFunctionCode({destPath:backup,envId:ENV,functionName:NAME});
 for(const n of ['index.js','handler.cjs','provider-cloudbase.cjs'])assert.equal(sha(fs.readFileSync(path.join(backup,n))),sha(fs.readFileSync(path.join(ROOT,'backend/r25-name-identity',n))),'Code differs '+n);
 const originals=JSON.parse(fs.readFileSync(path.join(PRIVATE,'original-business-hashes.json'))),current=await snapshot(m);
 for(const [table,hashes] of Object.entries(originals)){for(const h of hashes)assert.ok(current[table].includes(h),'Original business row changed '+table);}
 save('verify-backend.json',{codeSha256:after.CodeSha256,status:after.Status,configurationUnchanged:true,originalBusinessRowsPreserved:true});console.log('BACKEND_CODE_CONFIG_ORIGINAL_DATA_PASS');
}
(async()=>{try{const m=await manager();const action=process.argv[2];if(!['preflight','migrate','code','verify'].includes(action))throw Error('INVALID_STEP');await({preflight,migrate,code,verify}[action])(m);}catch(e){save('last-deployment-error.json',{step:process.argv[2],code:e.code||e.name,message:String(e.message||'').slice(0,5000)});console.error(JSON.stringify({status:'FAILED',step:process.argv[2],code:e.code||e.name,message:/OFFICIAL_LOGIN_REQUIRED|INVALID_STEP|Run.*first/.test(e.message)?e.message:'Check private deployment diagnostics; no credentials printed'}));process.exitCode=1;}})();
