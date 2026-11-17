'use strict';
// Prepared only. No requests unless --execute or --verify-baseline is explicit.
// Never print credential/request/error objects. Keep the private directory private.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT='/workspace/tcl-r25-fix';
const MODULES='/workspace/r25-review/final-package-backend/node_modules';
const ENV='unknown-roadrunner-d7cap6e21f517',REGION='ap-shanghai';
const fetch=require(MODULES+'/node-fetch');
const HttpsProxyAgent=require(MODULES+'/https-proxy-agent');
const ENDPOINT='https://unknown-roadrunner-d7cap6e21f517-1519058345.ap-shanghai.app.tcloudbase.com/r25-name-identity';
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const encoded=s=>Buffer.from(JSON.stringify(s)).toString('base64');
const jsonSQL=s=>"convert_from(decode('"+encoded(s)+"','base64'),'UTF8')::jsonb";
const password=()=> 'A'+crypto.randomBytes(10).toString('hex')+'9z!';
const safeError=e=>({code:/^[A-Za-z0-9_.-]{1,96}$/.test(String(e?.code||''))?String(e.code):'CONTROLLED_FAILURE'});
async function management(){
 const {AuthSupervisor}=require(MODULES+'/@cloudbase/toolbox');
 const c=await new AuthSupervisor({throwError:true,timeout:20000,proxy:process.env.HTTPS_PROXY}).getLoginState();
 if(!c?.secretId||!c?.secretKey||!c?.token)throw Object.assign(Error(),{code:'OFFICIAL_LOGIN_REQUIRED'});
 const Manager=require(MODULES+'/@cloudbase/manager-node');
 return new Manager({envId:ENV,region:REGION,secretId:c.secretId,secretKey:c.secretKey,token:c.token,proxy:process.env.HTTPS_PROXY});
}
function parseCell(reply){return require(ROOT+'/backend/r25-name-identity/provider-cloudbase.cjs')._test.firstJsonCell(reply);}
async function pg(manager,sql){return parseCell(await manager.database.executePGSql({Sql:sql,Role:'service_role'}));}
async function identity(manager,action,payload){return pg(manager,'SELECT public.r25wf_name_identity_service('+"convert_from(decode('"+Buffer.from(action).toString('base64')+"','base64'),'UTF8'),"+jsonSQL(payload)+')::text AS result');}
async function broker(payload){
 const r=await fetch(ENDPOINT,{method:'POST',agent:process.env.HTTPS_PROXY?new HttpsProxyAgent(process.env.HTTPS_PROXY):undefined,redirect:'error',headers:{'Content-Type':'application/json',Origin:'https://lijianjun004-star.github.io'},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});
 const value=await r.json();if(typeof value?.ok!=='boolean')throw Object.assign(Error(),{code:'INVALID_ENVELOPE'});return value;
}
function check(report,label,ok,detail){report.checks.push({label,pass:!!ok,...(detail?{detail}:{})});if(!ok)throw Object.assign(Error(),{code:'CHECK_FAILED'});}
const requireOk=(report,label,r)=>{check(report,label,r?.ok===true,r?.error?{code:r.error.code}:undefined);return r.data;};
const expectError=(report,label,r,code)=>check(report,label,r?.ok===false&&r.error?.code===code,{code:r?.error?.code||'NONE'});
const pending=r=>({operationId:r.operationId,operationProof:hash(r.operationSecret),name:r.name,role:r.role});
const status=r=>({action:'status',name:r.name,operationId:r.operationId,operationSecret:r.operationSecret});
function fixture(run){
 const newAccount=(alias,role)=>({alias,name:'R25恢复验收'+run+'_'+alias,role,password:password(),operationId:crypto.randomUUID(),operationSecret:crypto.randomBytes(32).toString('hex')});
 return {version:1,envId:ENV,region:REGION,fixtureId:'recovery-'+run,executionApproved:true,testOnly:true,registrationEndpoint:ENDPOINT,browserUrl:'https://lijianjun004-star.github.io/tcl-v43-preview/',createdAt:new Date().toISOString(),submissionId:'recovery-'+crypto.randomUUID(),accounts:[newAccount('operator','operator'),newAccount('anchor','anchor'),newAccount('outsider','operator'),newAccount('noNative','anchor'),newAccount('hasNative','anchor')]};
}
function savePrivate(dir,name,value){fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});}
function readPrivate(dir,name){const f=path.join(dir,name),s=fs.statSync(f);if(!s.isFile()||(s.mode&0o077))throw Object.assign(Error(),{code:'PRIVATE_FILE_REQUIRED'});return JSON.parse(fs.readFileSync(f,'utf8'));}
async function baseline(manager,f){
 const accounts=[...f.accounts,...(f.extraAccounts||[])];
 const names=accounts.map(x=>x.name),ops=accounts.map(x=>x.operationId).filter(Boolean),uids=accounts.map(x=>x.uid).filter(Boolean);
 const submissionIds=[f.submissionId,...(f.extraSubmissionIds||[])];
 const list=x=>'(SELECT jsonb_array_elements_text('+jsonSQL(x)+'))';
 const tables={r25wf_users:'display_name NOT IN '+list(names),r25wf_name_aliases:'display_name NOT IN '+list(names),r25wf_name_registrations:'operation_id NOT IN '+list(ops),r25wf_native_identities:'uid NOT IN '+list(uids),r25wf_name_conflicts:'true',r25wf_settings:'true',r25wf_invites:'true',r25wf_assignments:'true',r25wf_joins:'true',r25wf_training:'true',r25wf_submissions:'id NOT IN '+list(submissionIds),r25wf_submission_media:'submission_id NOT IN '+list(submissionIds),r25wf_feedback:'submission_id NOT IN '+list(submissionIds),r25wf_idempotency:'actor_uid NOT IN '+list(uids)};
 const out={};for(const [table,where] of Object.entries(tables)){out[table]=await pg(manager,`SELECT jsonb_build_object('count',count(*),'digest',md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')))::text AS result FROM public.${table} t WHERE ${where}`);}return out;
}
async function run(dir){
 fs.mkdirSync(dir,{mode:0o700});const f=fixture(Date.now().toString(36)+crypto.randomBytes(2).toString('hex'));
 const report={suite:'REAL_CLOUDBASE_REGISTRATION_RECOVERY',startedAt:new Date().toISOString(),status:'RUNNING',checks:[],notRun:['Native Auth login and submissions ACL: run accept-browser.py separately','Private media upload/download','Real phone and China mainland network','Multi-connection PostgreSQL contention'],cloudMutationsExpected:'only exact synthetic fixture accounts, their reservations, roles and later scoped test submission; no deletion'};
 savePrivate(dir,'fixture.json',f);savePrivate(dir,'result.json',report);
 let manager;
 try{
  manager=await management();
  const scope=await pg(manager,"SELECT jsonb_build_object('count',count(*))::text AS result FROM public.r25wf_users WHERE display_name IN (SELECT jsonb_array_elements_text("+jsonSQL(f.accounts.map(x=>x.name))+'))');
  check(report,'synthetic_name_scope_empty_before_writes',Number(scope.count)===0);
  const before=await baseline(manager,f);savePrivate(dir,'baseline-before.json',before);
  for(const a of f.accounts.slice(0,3)){
   const result=requireOk(report,a.alias+'_direct_register',await broker({action:'register',...a,alias:undefined}));
   // JSON omits undefined alias; request fields otherwise exact whitelist.
   check(report,a.alias+'_ready_role',result.state==='ready'&&result.role===a.role&&!!result.uid);
   Object.assign(a,{uid:result.uid,username:result.username});savePrivate(dir,'fixture.json',f);
   const resolved=requireOk(report,a.alias+'_name_resolves',await broker({action:'resolve',name:a.name}));check(report,a.alias+'_same_uid',resolved.uid===a.uid&&resolved.username===a.username);
  }
  const denied=f.accounts[1];expectError(report,'admin_public_signup_rejected',await broker({action:'register',name:denied.name+'admin',role:'admin',password:denied.password,operationId:crypto.randomUUID(),operationSecret:crypto.randomBytes(32).toString('hex')}),'INVALID_ROLE');
  for(const a of f.accounts.slice(3)){
   const reserved=requireOk(report,a.alias+'_trusted_reserve',await identity(manager,'reserve',pending(a)));a.username=reserved.username;a.marker=reserved.marker;a.reservationId=reserved.reservationId;
   // Actual service JSON uses reservationId; fall back to authoritative SELECT only.
   if(!a.reservationId){const snapshot=await pg(manager,"SELECT jsonb_build_object('id',id)::text AS result FROM public.r25wf_name_registrations WHERE operation_id="+"convert_from(decode('"+Buffer.from(a.operationId).toString('base64')+"','base64'),'UTF8')");a.reservationId=snapshot.id;}
   savePrivate(dir,'fixture.json',f);
   if(a.alias==='hasNative'){
    const reply=await manager.user.createUser({name:a.username,type:'externalUser',userStatus:'ACTIVE',password:a.password,description:a.marker,nickName:a.name});const nativeUid=reply?.Data?.Uid;check(report,'hasNative_uid_precision_safe',typeof nativeUid!=='number'||Number.isSafeInteger(nativeUid));a.expectedNativeUid=String(nativeUid||'');check(report,'hasNative_official_create_receipt',!!a.expectedNativeUid);savePrivate(dir,'fixture.json',f);
   }else{const s=requireOk(report,'noNative_original_status_reserved',await broker(status(a)));check(report,'noNative_requires_password',s.state==='reserved'&&s.requiresPassword===true);}
   const original={...a},newSecret=crypto.randomBytes(32).toString('hex');
   const rotate={reservationId:a.reservationId,operationId:a.operationId,name:a.name,role:a.role,expectedProof:hash(a.operationSecret),newProof:hash(newSecret)};
   const rotated=await pg(manager,'SELECT public.r25wf_name_recovery_rotate('+jsonSQL(rotate)+')::text AS result');requireOk(report,a.alias+'_trusted_proof_rotation',rotated);
   a.operationSecret=newSecret;savePrivate(dir,'fixture.json',f);
   expectError(report,a.alias+'_old_proof_rejected',await broker(status(original)),'INVALID_OPERATION_SECRET');
   let ready=requireOk(report,a.alias+'_new_status',await broker(status(a)));
   check(report,a.alias+'_canonical_role',ready.role===a.role);
   if(a.alias==='noNative'){check(report,'noNative_reserved_after_rotation',ready.state==='reserved');ready=requireOk(report,'noNative_continue_register',await broker({action:'register',name:a.name,role:a.role,password:a.password,operationId:a.operationId,operationSecret:a.operationSecret}));}
   check(report,a.alias+'_same_native_username',ready.state==='ready'&&ready.username===a.username&&!!ready.uid);
   if(a.expectedNativeUid)check(report,'hasNative_same_uid_no_recreate',String(ready.uid)===a.expectedNativeUid);
   a.uid=ready.uid;savePrivate(dir,'fixture.json',f);
   expectError(report,a.alias+'_ready_cannot_rotate',await pg(manager,'SELECT public.r25wf_name_recovery_rotate('+jsonSQL({...rotate,expectedProof:hash(newSecret),newProof:hash(crypto.randomBytes(32).toString('hex'))})+')::text AS result'),'RECOVERY_NOT_PENDING');
  }
  const after=await baseline(manager,f);savePrivate(dir,'baseline-after-registration.json',after);check(report,'existing_business_rows_preserved',JSON.stringify(before)===JSON.stringify(after));
  report.status='PASS_WITH_NOT_RUN';
 }catch(e){report.status='FAIL';report.error=safeError(e);process.exitCode=1;}
 finally{report.finishedAt=new Date().toISOString();savePrivate(dir,'fixture.json',f);savePrivate(dir,'result.json',report);process.stdout.write(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error||null,privateOutput:dir})+'\n');}
}
async function main(args=process.argv.slice(2)){
 if(args.length===0){process.stdout.write(JSON.stringify({status:'DRY_RUN_ZERO_NETWORK',prepared:true,requires:'--execute NEW_PRIVATE_DIRECTORY after migrations/function deployment; --verify-baseline EXISTING_PRIVATE_DIRECTORY; --readonly requires official login',cloudCalls:0})+'\n');return;}
 if(args[0]==='--execute'&&args.length===2)return run(path.resolve(args[1]));
 if(args[0]==='--verify-baseline'&&args.length===2){const dir=path.resolve(args[1]),f=readPrivate(dir,'fixture.json'),before=readPrivate(dir,'baseline-before.json'),after=await baseline(await management(),f);savePrivate(dir,'baseline-after-browser.json',after);const ok=JSON.stringify(before)===JSON.stringify(after);process.stdout.write(JSON.stringify({status:ok?'BASELINE_PRESERVED':'BASELINE_CHANGED'})+'\n');if(!ok)process.exitCode=1;return;}
 if(args[0]==='--readonly'&&args.length===1){const r=await pg(await management(),"SELECT jsonb_build_object('databaseRole',current_user,'recoveryFunctionInstalled',to_regprocedure('public.r25wf_name_recovery_rotate(jsonb)') IS NOT NULL)::text AS result");process.stdout.write(JSON.stringify(r)+'\n');return;}
 throw Object.assign(Error(),{code:'INVALID_ARGUMENTS'});
}
if(require.main===module)main().catch(e=>{process.stdout.write(JSON.stringify({status:'FAIL',error:safeError(e)})+'\n');process.exitCode=1;});
module.exports={management,pg,baseline,main};
