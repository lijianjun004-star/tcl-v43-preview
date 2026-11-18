'use strict';
// Trusted administrator helper, never an HTTP endpoint. No network by default.
// --plan PRIVATE_SNAPSHOT.json NEW_PRIVATE_DIRECTORY is offline preparation.
// --apply PRIVATE_DIRECTORY --verified-applicant resets only the exact UID's
// native password after management-side database/native checks. Human identity
// verification is mandatory; knowing a public name is not verification.
// Snapshot: {envId,name,role,uid,username,nativeMarker}; nativeMarker is the exact
// native Description (or null when absent). r25n_ requires r25wf-name-v1 UUID.
// Read a snapshot by exact UID through trusted management, never alias lookup.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ENV_ID='unknown-roadrunner-d7cap6e21f517',REGION='ap-shanghai';
const fail=code=>{throw Object.assign(new Error(code),{code});};
function validateSnapshot(s){
 const keys=['envId','name','role','uid','username','nativeMarker'];
 if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==keys.length||Object.keys(s).some(k=>!keys.includes(k)))fail('INVALID_SNAPSHOT');
 if(s.envId!==ENV_ID||!['anchor','operator'].includes(s.role)||typeof s.name!=='string'||s.name!==s.name.normalize('NFKC').trim()||![...s.name].length||[...s.name].length>40||/[\p{Cc}\p{Cf}]/u.test(s.name))fail('INVALID_SNAPSHOT');
 if(typeof s.uid!=='string'||!s.uid||s.uid.length>64||/[\s\p{Cc}\p{Cf}]/u.test(s.uid)||typeof s.username!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$/.test(s.username))fail('INVALID_SNAPSHOT');
 if(s.nativeMarker!==null&&(typeof s.nativeMarker!=='string'||!s.nativeMarker||s.nativeMarker.length>200||/[\p{Cc}\p{Cf}]/u.test(s.nativeMarker)))fail('INVALID_SNAPSHOT');
 if(/^r25n_/i.test(s.username)&&(!/^r25n_[a-f0-9]{24}$/.test(s.username)||typeof s.nativeMarker!=='string'||!/^r25wf-name-v1:[a-f0-9-]{36}$/.test(s.nativeMarker)))fail('INVALID_SNAPSHOT');
 return {...s};
}
function devicePassword(key){
 if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))fail('INVALID_DEVICE_KEY');
 return 'Aa1!'+crypto.createHash('sha256').update('TCL-R25-device-v1:'+key,'utf8').digest('hex').slice(0,28);
}
function prepare(snapshot,{randomBytes=crypto.randomBytes}={}){
 const s=validateSnapshot(snapshot),deviceKey=randomBytes(32).toString('hex');
 devicePassword(deviceKey);
 const body={version:1,envId:ENV_ID,name:s.name,role:s.role,uid:s.uid,username:s.username,deviceKey};
 return {snapshot:s,code:'R25DEVICE1.'+Buffer.from(JSON.stringify(body),'utf8').toString('base64url')};
}
function decode(code,snapshot){
 if(typeof code!=='string'||code.length>4096||!/^R25DEVICE1\.[A-Za-z0-9_-]+$/.test(code))fail('INVALID_DEVICE_CODE');
 let body;try{body=JSON.parse(Buffer.from(code.slice(11),'base64url').toString('utf8'));}catch{fail('INVALID_DEVICE_CODE');}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).sort().join(',')!==['version','envId','name','role','uid','username','deviceKey'].sort().join(',')||body.version!==1)fail('INVALID_DEVICE_CODE');
 for(const k of ['envId','name','role','uid','username'])if(body[k]!==snapshot[k])fail('DEVICE_CODE_SNAPSHOT_MISMATCH');
 devicePassword(body.deviceKey);return body;
}
const jsonSQL=value=>"convert_from(decode('"+Buffer.from(JSON.stringify(value),'utf8').toString('base64')+"','base64'),'UTF8')::jsonb";
function firstCell(reply){
 let r=reply?.Response??reply;for(let i=0;i<3&&!Array.isArray(r?.Rows)&&r?.Data&&typeof r.Data==='object';i++)r=r.Data;
 if(!Array.isArray(r?.Rows)||r.Rows.length!==1)fail('INVALID_MANAGEMENT_RESPONSE');
 let row;try{row=typeof r.Rows[0]==='string'?JSON.parse(r.Rows[0]):r.Rows[0];}catch{fail('INVALID_MANAGEMENT_RESPONSE');}
 if(!Array.isArray(row)||row.length!==1)fail('INVALID_MANAGEMENT_RESPONSE');let cell=row[0];
 for(let i=0;i<3&&typeof cell==='string';i++){try{cell=JSON.parse(cell);}catch{fail('INVALID_MANAGEMENT_RESPONSE');}}
 if(!cell||typeof cell!=='object'||Array.isArray(cell))fail('INVALID_MANAGEMENT_RESPONSE');return cell;
}
async function verifyAndApply({snapshot,code,manager}){
 const s=validateSnapshot(snapshot),body=decode(code.trim(),s);
 const Sql="SELECT jsonb_build_object('uid',u.uid,'name',u.display_name,'role',u.role,'active',u.active,'username',n.native_username,'markers',coalesce((SELECT jsonb_agg(r.native_marker) FROM public.r25wf_name_registrations r WHERE r.uid=u.uid AND r.state='ready'),'[]'::jsonb))::text AS result FROM public.r25wf_users u LEFT JOIN public.r25wf_native_identities n ON n.uid=u.uid WHERE u.uid=("+jsonSQL({uid:s.uid})+"->>'uid')";
 const db=firstCell(await manager.database.executePGSql({Sql,Role:'service_role'}));
 if(db.uid!==s.uid||db.name!==s.name||db.role!==s.role||db.active!==true||db.username!==s.username)fail('DATABASE_IDENTITY_MISMATCH');
 if(!Array.isArray(db.markers)||(/^r25n_/.test(s.username)?(db.markers.length!==1||db.markers[0]!==s.nativeMarker):db.markers.length!==0))fail('DATABASE_MARKER_MISMATCH');
 const reply=await manager.user.describeUserList({uidList:[s.uid],pageNo:1,pageSize:100});
 const rows=reply?.Data?.UserList;
 if(!Array.isArray(rows)||rows.length!==1)fail('NATIVE_IDENTITY_MISMATCH');
 const n=rows[0];
 if(typeof n.Uid==='number'&&!Number.isSafeInteger(n.Uid))fail('NATIVE_UID_PRECISION_UNSAFE');
 if(String(n.Uid)!==s.uid||n.Name!==s.username||n.Type!=='externalUser'||n.UserStatus!=='ACTIVE'||(typeof n.Description==='string'&&n.Description!==''?n.Description:null)!==s.nativeMarker)fail('NATIVE_IDENTITY_MISMATCH');
 // No Name, Type, UserStatus, Description or business mutation is sent.
 const applied=await manager.user.modifyUser({uid:s.uid,password:devicePassword(body.deviceKey)});
 if(applied?.Data?.Success!==true)fail('NATIVE_RECOVERY_UNCONFIRMED');
 return {applied:true,uid:s.uid,role:s.role,username:s.username};
}
function readPrivate(file){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192||(stat.mode&0o077))fail('PRIVATE_FILE_REQUIRED');return fs.readFileSync(file,'utf8');}
async function officialManager(){
 const {AuthSupervisor}=require('@cloudbase/toolbox');
 const proxy=process.env.HTTPS_PROXY||process.env.https_proxy;
 const c=await new AuthSupervisor({throwError:true,timeout:20000,proxy}).getLoginState();
 if(!c?.secretId||!c?.secretKey||!c?.token)fail('OFFICIAL_LOGIN_REQUIRED');
 const Manager=require('@cloudbase/manager-node');return new Manager({envId:ENV_ID,region:REGION,secretId:c.secretId,secretKey:c.secretKey,token:c.token,proxy});
}
const instructions=`PRIVATE DEVICE RECOVERY PLAN\n\n1. Verify the applicant offline through a trusted channel; a public name is not proof. Confirm exact original UID/profile/native username and marker in the fixed environment. Admin accounts are excluded.\n2. This plan is offline only. Do not distribute the code before apply has succeeded. Apply only after explicit authorization:\n   node prepare-device-recovery.cjs --apply PRIVATE_DIRECTORY --verified-applicant\n   Use the official management SDK/toolbox via NODE_PATH if not installed beside the helper. It rechecks exact database/native metadata and resets only the original UID's native password.\n3. Check APPLIED_PRIVATE_CODE_READY and private apply-receipt.json, then privately deliver recovery-code.txt. Import in the intended browser; the application must verify actual Auth session UID and me role before enabling business access.\n4. The old native password/device credential is replaced. Do not promise old-session revocation or call this code one-time: those semantics have not been established. The code is reusable secret device material; keep private. No password is printed or saved by this helper.\n5. If apply is interrupted, do not create an account, delete records, alter UID/role or generate a replacement blindly. Retain the same private plan, inspect official state, then retry only the same credential after identity verification. Existing native sessions may still remain valid.\n6. Never upload snapshot, code or private directory to a repository, public evidence, shared drive or chat. No application/account data is deleted by this helper.\n`;
async function main(args=process.argv.slice(2)){
 if(args.length===0){process.stdout.write('DRY_RUN_ZERO_NETWORK: use --plan PRIVATE_SNAPSHOT.json NEW_PRIVATE_DIRECTORY; privileged --apply additionally requires --verified-applicant.\n');return;}
 if(args[0]==='--plan'&&args.length===3){let snapshot;try{snapshot=JSON.parse(readPrivate(args[1]));}catch(e){if(e.code)throw e;fail('INVALID_SNAPSHOT');}const p=prepare(snapshot),dir=args[2];fs.mkdirSync(dir,{mode:0o700});fs.writeFileSync(path.join(dir,'private-snapshot.json'),JSON.stringify(p.snapshot,null,2)+'\n',{mode:0o600,flag:'wx'});fs.writeFileSync(path.join(dir,'recovery-code.txt'),p.code+'\n',{mode:0o600,flag:'wx'});fs.writeFileSync(path.join(dir,'README.txt'),instructions,{mode:0o600,flag:'wx'});process.stdout.write('PREPARED_OFFLINE_PRIVATE_PLAN: no account changed. Verify the applicant and exact original UID; do not distribute the code until apply succeeds.\n');return;}
 if(args[0]==='--apply'&&args.length===3&&args[2]==='--verified-applicant'){
  const dir=args[1],stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077))fail('PRIVATE_DIRECTORY_REQUIRED');
  const snapshot=JSON.parse(readPrivate(path.join(dir,'private-snapshot.json'))),code=readPrivate(path.join(dir,'recovery-code.txt')).trim();validateSnapshot(snapshot);decode(code,snapshot);
  await verifyAndApply({snapshot,code,manager:await officialManager()});fs.writeFileSync(path.join(dir,'apply-receipt.json'),JSON.stringify({applied:true,appliedAt:new Date().toISOString(),note:'Exact native UID password replaced. Session revocation not established; verify actual SDK session/me identity before access.'},null,2)+'\n',{mode:0o600});
  process.stdout.write('APPLIED_PRIVATE_CODE_READY: only the verified original UID native credential was replaced; deliver the code privately and verify Auth/me before business access.\n');return;
 }
 fail('INVALID_ARGUMENTS');
}
if(require.main===module)main().catch(()=>{process.stderr.write('DEVICE_RECOVERY_FAILED: check the private snapshot, official authorization and exact original identity. Raw diagnostics omitted.\n');process.exitCode=1;});
module.exports={ENV_ID,validateSnapshot,devicePassword,prepare,decode,verifyAndApply,main};
