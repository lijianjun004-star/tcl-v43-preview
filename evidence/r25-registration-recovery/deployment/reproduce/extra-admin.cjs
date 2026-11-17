'use strict';
// Optional synthetic-only admin fixture. No cloud calls without --execute/--retire.
// This does not create an admin through public signup or touch original accounts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {management,pg}=require('./accept-cloud.cjs');
const ENV='unknown-roadrunner-d7cap6e21f517';
const fail=code=>{throw Object.assign(Error(),{code});};
const text=s=>"convert_from(decode('"+Buffer.from(String(s)).toString('base64')+"','base64'),'UTF8')";
function load(dir){
 const file=path.join(dir,'fixture.json'),s=fs.lstatSync(file);
 if(s.isSymbolicLink()||!s.isFile()||(s.mode&0o077))fail('PRIVATE_FIXTURE_REQUIRED');
 const f=JSON.parse(fs.readFileSync(file,'utf8'));
 if(f.envId!==ENV||f.testOnly!==true||f.executionApproved!==true||!/^recovery-[a-z0-9]+$/.test(f.fixtureId)||f.accounts?.length!==5)fail('SYNTHETIC_FIXTURE_REQUIRED');
 return f;
}
function save(dir,file,value){const target=path.join(dir,file);if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())fail('SYMLINK_REJECTED');fs.writeFileSync(target,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.chmodSync(target,0o600);}
async function exactNative(manager,a){
 const response=await manager.user.describeUserList({name:a.username,pageNo:1,pageSize:100});
 const rows=response?.Data?.UserList?.filter(x=>x.Name===a.username);
 if(!rows||rows.length!==1||a.uid&&String(rows[0].Uid)!==String(a.uid)||rows[0].Description!==a.marker||rows[0].Type!=='externalUser')fail('SYNTHETIC_NATIVE_SCOPE_MISMATCH');
 return rows[0];
}
async function main(args=process.argv.slice(2)){
 if(!args.length){process.stdout.write('{"status":"DRY_RUN_ZERO_NETWORK","requires":"--execute PRIVATE_FIXTURE_DIR or --retire PRIVATE_FIXTURE_DIR","scope":"one generated test-only admin; no deletion"}\n');return;}
 if(args.length!==2||!['--execute','--retire'].includes(args[0]))fail('INVALID_ARGUMENTS');
 const dir=path.resolve(args[1]),f=load(dir);let manager;
 if(args[0]==='--execute'){
  if((f.extraAccounts||[]).length)fail('EXTRA_FIXTURE_ALREADY_PLANNED_NO_AUTOMATIC_RETRY');
  const a={alias:'syntheticAdmin',role:'admin',name:'R25恢复验收'+f.fixtureId.slice(9)+'_admin',username:'r25qa_admin_'+crypto.randomBytes(12).toString('hex'),password:'A'+crypto.randomBytes(14).toString('hex')+'9z!',marker:'r25wf-acceptance-admin:'+f.fixtureId,testOnly:true};
  // Persist intent before even querying/create. A failure must never lose the native scope.
  f.extraAccounts=[a];save(dir,'fixture.json',f);
  manager=await management();
  const scope=await pg(manager,"SELECT jsonb_build_object('count',count(*))::text AS result FROM public.r25wf_users WHERE display_name="+text(a.name));
  if(Number(scope.count)!==0)fail('SYNTHETIC_NAME_ALREADY_EXISTS');
  const existing=await manager.user.describeUserList({name:a.username,pageNo:1,pageSize:100});
  if(!Array.isArray(existing?.Data?.UserList)||existing.Data.UserList.some(x=>x.Name===a.username))fail('SYNTHETIC_USERNAME_NOT_EMPTY');
  const created=await manager.user.createUser({name:a.username,type:'externalUser',userStatus:'ACTIVE',password:a.password,description:a.marker,nickName:a.name});
  const uid=created?.Data?.Uid;if(!uid||(typeof uid==='number'&&!Number.isSafeInteger(uid)))fail('NATIVE_UID_UNVERIFIED');
  a.uid=String(uid);a.nativeCreated=true;save(dir,'fixture.json',f);
  await exactNative(manager,a);
  const createdRow=await pg(manager,"WITH profile AS (INSERT INTO public.r25wf_users(uid,role,display_name,active) VALUES("+text(a.uid)+",'admin',"+text(a.name)+",true) RETURNING uid) INSERT INTO public.r25wf_native_identities(uid,native_username) SELECT uid,"+text(a.username)+" FROM profile RETURNING jsonb_build_object('uid',uid,'username',native_username)::text AS result");
  if(String(createdRow.uid)!==a.uid||createdRow.username!==a.username)fail('SYNTHETIC_ADMIN_PROFILE_UNVERIFIED');
  a.businessCreated=true;save(dir,'fixture.json',f);
  process.stdout.write('{"status":"SYNTHETIC_ADMIN_CREATED","accounts":1,"publicAdminSignup":false}\n');return;
 }
 if(f.extraAccounts?.length!==1)fail('EXTRA_ADMIN_SCOPE_MISSING');
 const a=f.extraAccounts[0];
 if(a.testOnly!==true||a.alias!=='syntheticAdmin'||a.role!=='admin'||!/^r25qa_admin_[a-f0-9]{24}$/.test(a.username)||a.marker!=='r25wf-acceptance-admin:'+f.fixtureId||a.name!=='R25恢复验收'+f.fixtureId.slice(9)+'_admin' )fail('EXTRA_ADMIN_SCOPE_MISMATCH');
 manager=await management();const observed=await exactNative(manager,a);
 if(!a.uid){if(!observed.Uid||(typeof observed.Uid==='number'&&!Number.isSafeInteger(observed.Uid)))fail('NATIVE_UID_UNVERIFIED');a.uid=String(observed.Uid);a.nativeCreated=true;save(dir,'fixture.json',f);}
 const snapshot=await pg(manager,"SELECT jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('uid',uid,'role',role,'name',display_name)),'[]'))::text AS result FROM public.r25wf_users WHERE uid="+text(a.uid));
 if(snapshot.items.length>1||snapshot.items.some(x=>String(x.uid)!==a.uid||x.role!=='admin'||x.name!==a.name))fail('SYNTHETIC_ADMIN_PROFILE_SCOPE_MISMATCH');
 if(a.businessCreated&&snapshot.items.length!==1)fail('SYNTHETIC_ADMIN_PROFILE_MISSING');
 const blocked=await manager.user.modifyUser({uid:a.uid,userStatus:'BLOCKED'});if(blocked?.Data?.Success!==true)fail('SYNTHETIC_ADMIN_BLOCK_NOT_CONFIRMED');
 if(snapshot.items.length){
  const update=await pg(manager,"WITH changed AS (UPDATE public.r25wf_users SET active=false WHERE uid="+text(a.uid)+" AND role='admin' AND display_name="+text(a.name)+" RETURNING uid) SELECT jsonb_build_object('count',count(*))::text AS result FROM changed");
  if(Number(update.count)!==1)fail('SYNTHETIC_ADMIN_DEACTIVATION_NOT_CONFIRMED');
 }
 a.retiredAt=new Date().toISOString();save(dir,'fixture.json',f);save(dir,'extra-admin-retirement.json',{status:'SYNTHETIC_ADMIN_BLOCKED_AND_DEACTIVATED',accounts:1,deletedRows:0,finishedAt:a.retiredAt});
 process.stdout.write('{"status":"SYNTHETIC_ADMIN_BLOCKED_AND_DEACTIVATED","accounts":1,"deletedRows":0}\n');
}
if(require.main===module)main().catch(e=>{process.stdout.write(JSON.stringify({status:'FAIL',code:/^[A-Z_]{1,80}$/.test(String(e?.code||''))?e.code:'CONTROLLED_EXTRA_ADMIN_FAILURE',rawDiagnosticsOmitted:true})+'\n');process.exitCode=1;});
