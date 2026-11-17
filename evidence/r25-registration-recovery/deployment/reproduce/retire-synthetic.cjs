'use strict';
// Scope-checked retirement only. Never deletes immutable submissions or accounts.
// Default is zero network; --plan reads exact generated scope; --execute blocks it.
const fs=require('node:fs'),path=require('node:path');
const {management,pg}=require('./accept-cloud.cjs');
const b64=s=>Buffer.from(String(s)).toString('base64');
const textSQL=s=>"convert_from(decode('"+b64(s)+"','base64'),'UTF8')";
const fail=()=>{throw Object.assign(Error(),{code:'SYNTHETIC_SCOPE_MISMATCH'});};
async function main(args=process.argv.slice(2)){
 if(args.length===0){process.stdout.write('{"status":"DRY_RUN_ZERO_NETWORK","cleanup":"no deletion; exact generated UID/username/marker-verified deactivation only"}\n');return;}
 if(args.length!==2||!['--plan','--execute'].includes(args[0]))fail();
 const file=path.join(path.resolve(args[1]),'fixture.json'),stat=fs.statSync(file);if(!stat.isFile()||(stat.mode&0o077))fail();const f=JSON.parse(fs.readFileSync(file));
 if(f.envId!=='unknown-roadrunner-d7cap6e21f517'||!f.testOnly||!f.executionApproved||!/^recovery-[a-z0-9]+$/.test(f.fixtureId)||f.accounts.length!==5)fail();
 const manager=await management(),verified=[];
 // Verify every target before performing any mutation.
 for(const a of f.accounts){
  if(!a.uid||!a.username||!a.name.startsWith('R25恢复验收'+f.fixtureId.slice(9)+'_'))fail();
  const row=await pg(manager,"SELECT jsonb_build_object('uid',uid,'username',native_username,'marker',native_marker,'name',display_name,'role',role,'state',state)::text AS result FROM public.r25wf_name_registrations WHERE operation_id="+textSQL(a.operationId));
  if(String(row.uid)!==String(a.uid)||row.username!==a.username||row.name!==a.name||row.role!==a.role||row.state!=='ready'||!/^r25wf-name-v1:[a-f0-9-]{36}$/.test(row.marker))fail();
  const reply=await manager.user.describeUserList({name:a.username,pageNo:1,pageSize:100}),rows=reply?.Data?.UserList?.filter(x=>x.Name===a.username);
  if(!rows||rows.length!==1||String(rows[0].Uid)!==String(a.uid)||rows[0].Description!==row.marker||rows[0].Type!=='externalUser')fail();
  verified.push(a);
 }
 if(args[0]==='--execute')for(const a of verified){
  const reply=await manager.user.modifyUser({uid:String(a.uid),userStatus:'BLOCKED'});if(reply?.Data?.Success!==true)fail();
  const sql="WITH changed AS (UPDATE public.r25wf_users SET active=false WHERE uid="+textSQL(a.uid)+' AND display_name='+textSQL(a.name)+' AND role='+textSQL(a.role)+" RETURNING uid) SELECT jsonb_build_object('count',count(*))::text AS result FROM changed";
  const result=await pg(manager,sql);if(Number(result.count)!==1)fail();
 }
 process.stdout.write(JSON.stringify({status:args[0]==='--execute'?'SYNTHETIC_ACCOUNTS_RETIRED':'EXACT_SYNTHETIC_SCOPE_VERIFIED',accounts:verified.length,deletedRows:0})+'\n');
}
if(require.main===module)main().catch(()=>{process.stdout.write('{"status":"FAIL","error":"Controlled scope/operation failure; no raw diagnostics emitted"}\n');process.exitCode=1;});
