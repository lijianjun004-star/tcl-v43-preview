'use strict';
// Real PGlite SQL with synthetic native Auth. No cloud calls or user records.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const {PGlite}=require('@electric-sql/pglite');
const {createIdentityService}=require('../handler.cjs');
const {prepare,ENV_ID}=require('../prepare-registration-recovery.cjs');
const root=path.resolve(__dirname,'..');
const hash=s=>crypto.createHash('sha256').update(s,'utf8').digest('hex');
let db,service,serial=0,createMode='normal',finalizeUnavailable=false;
const native=new Map();let createCalls=0;
const req=(name,role='anchor')=>({action:'register',name,role,password:'FirstPassword123!',operationId:crypto.randomUUID(),operationSecret:crypto.randomBytes(32).toString('hex')});
const proof=r=>({operationId:r.operationId,operationProof:hash(r.operationSecret)});
const status=r=>({action:'status',name:r.name,operationId:r.operationId,operationSecret:r.operationSecret});
const bad=(r,code)=>{assert.equal(r.ok,false,JSON.stringify(r));assert.equal(r.error.code,code,JSON.stringify(r));};
async function serviceSql(action,payload){
 await db.exec('SET ROLE service_role');
 try{return (await db.query('SELECT public.r25wf_name_identity_service($1,$2) r',[action,JSON.stringify(payload)])).rows[0].r;}finally{await db.exec('RESET ROLE');}
}
async function rotate(payload){
 await db.exec('SET ROLE service_role');
 try{return (await db.query('SELECT public.r25wf_name_recovery_rotate($1) r',[JSON.stringify(payload)])).rows[0].r;}finally{await db.exec('RESET ROLE');}
}
async function row(operationId){return (await db.query('SELECT * FROM public.r25wf_name_registrations WHERE operation_id=$1',[operationId])).rows[0];}
function plan(r){const output=prepare({envId:ENV_ID,reservationId:r.id,operationId:r.operation_id,name:r.display_name,role:r.role,operationProof:r.operation_proof});const code=JSON.parse(Buffer.from(output.code.slice(8),'base64url'));return {...output,codeData:code,payload:{reservationId:r.id,operationId:r.operation_id,name:r.display_name,role:r.role,expectedProof:r.operation_proof,newProof:hash(code.operationSecret)}};}
before(async()=>{
 db=new PGlite();await db.waitReady;
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS text LANGUAGE sql AS $$SELECT 'fixture'::text$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'authenticated'::text$$;`);
 for(const file of ['../r25-cloudbase/schema.sql','001-name-identity.sql','002-direct-registration.sql','003-registration-recovery.sql'])await db.exec(fs.readFileSync(path.join(root,file),'utf8'));
 await db.exec("INSERT INTO public.r25wf_users(uid,role,display_name) VALUES('admin-fixture','admin','测试管理员')");
 service=createIdentityService({provider:{
  async dbCall(action,payload){if(action==='finalize'&&finalizeUnavailable){finalizeUnavailable=false;throw Error('fixture outage');}return serviceSql(action,payload);},
  async findNativeUser(username){return native.get(username)||null;},
  async createNativeUser({username,marker}){createCalls++;if(createMode==='fail'){createMode='normal';throw Error('fixture fail before create');}const user={uid:'native-'+(++serial),username,description:marker,status:'ACTIVE'};assert.equal(native.has(username),false);native.set(username,user);return {uid:user.uid,username};}
 }});
});
after(async()=>{await db?.close();});
test('lost pending proof rotates once and resumes original reservation, role, native username and marker',async()=>{
 const original=req('丢失凭据待创建','operator');createMode='fail';bad(await service.handle(original),'NATIVE_CREATION_FAILED');
 const before=await row(original.operationId),p=plan(before);
 // After clearing local storage, a fresh operation cannot claim this name.
 bad(await service.handle({...req(original.name,'operator')}),'NAME_PENDING');
 assert.equal((await rotate(p.payload)).ok,true);
 const rotated=await row(original.operationId);
 assert.deepEqual({...rotated,operation_proof:before.operation_proof},before,'only proof was mutated');
 bad(await service.handle(status(original)),'INVALID_OPERATION_SECRET');
 const recovered={...original,operationSecret:p.codeData.operationSecret};
 assert.deepEqual(await service.handle(status(recovered)),{ok:true,data:{state:'reserved',requiresPassword:true,role:'operator'}});
 const ready=await service.handle(recovered);assert.equal(ready.ok,true,JSON.stringify(ready));assert.equal(ready.data.username,before.native_username);assert.equal(ready.data.role,'operator');
 const final=await row(original.operationId);assert.equal(final.id,before.id);assert.equal(final.native_marker,before.native_marker);assert.equal(final.uid,ready.data.uid);
});
test('pending native-created recovery uses same UID without recreating or resetting native password',async()=>{
 const original=req('丢失凭据已建原生');finalizeUnavailable=true;bad(await service.handle(original),'PROVIDER_UNAVAILABLE');
 const before=await row(original.operationId),p=plan(before),user=native.get(before.native_username),count=createCalls;
 assert.equal((await rotate(p.payload)).ok,true);
 const ready=await service.handle(status({...original,operationSecret:p.codeData.operationSecret}));
 assert.equal(ready.ok,true,JSON.stringify(ready));assert.equal(ready.data.uid,user.uid);assert.equal(createCalls,count);assert.equal(ready.data.role,'anchor');
 bad(await service.handle(status(original)),'INVALID_OPERATION_SECRET');
});
test('stale snapshot, wrong name/role/id and second rotation cannot replace recovery proof',async()=>{
 const original=req('严格快照恢复');createMode='fail';bad(await service.handle(original),'NATIVE_CREATION_FAILED');const before=await row(original.operationId),p=plan(before);
 for(const change of [{expectedProof:'f'.repeat(64)},{name:'另一个姓名'},{role:'operator'},{reservationId:crypto.randomUUID()}]){
  bad(await rotate({...p.payload,...change}),'RECOVERY_STALE');assert.deepEqual(await row(original.operationId),before);
 }
 assert.equal((await rotate(p.payload)).ok,true);
 bad(await rotate({...p.payload,newProof:'d'.repeat(64)}),'RECOVERY_STALE');
 assert.equal((await row(original.operationId)).operation_proof,p.payload.newProof);
});
test('a finalization winning before rotation blocks stale recovery, preserving ready account',async()=>{
 const original=req('完成先于恢复');createMode='fail';bad(await service.handle(original),'NATIVE_CREATION_FAILED');const p=plan(await row(original.operationId));
 const ready=await service.handle(original);assert.equal(ready.ok,true);
 const before=await row(original.operationId);bad(await rotate(p.payload),'RECOVERY_NOT_PENDING');assert.deepEqual(await row(original.operationId),before);
 assert.equal((await service.handle(status(original))).data.uid,ready.data.uid);
});
test('roleless status safely discovers server role, while wrong-role reserve/status/finalize stay blocked',async()=>{
 const original=req('离线误选角色竞态','operator');createMode='fail';bad(await service.handle(original),'NATIVE_CREATION_FAILED');const before=await row(original.operationId);
 assert.equal((await service.handle(status(original))).data.role,'operator');
 bad(await service.handle({...original,role:'anchor'}),'REGISTRATION_CONFLICT');
 bad(await service.handle({...status(original),role:'anchor'}),'REGISTRATION_CONFLICT');
 bad(await serviceSql('finalize',{...proof(original),nativeUsername:before.native_username,providerUid:'fake',marker:before.native_marker}),'REGISTRATION_CONFLICT');
 bad(await service.handle({...status(original),operationSecret:'f'.repeat(64)}),'INVALID_OPERATION_SECRET');
 assert.deepEqual(await row(original.operationId),before);
});
test('legacy invite reservations and ready users cannot be rotated; public roles cannot execute recovery',async()=>{
 const invite=crypto.randomUUID();await db.query("INSERT INTO public.r25wf_invites(id,code_hash,role,created_by,expires_at) VALUES($1,$2,'anchor','admin-fixture',clock_timestamp()+interval '1 day')",[invite,'a'.repeat(32)]);
 const original=req('旧邀请码待完成');assert.equal((await serviceSql('reserve',{...proof(original),name:original.name,inviteHash:'a'.repeat(32)})).ok,true);
 const before=await row(original.operationId);bad(await rotate(plan(before).payload),'RECOVERY_NOT_DIRECT');assert.deepEqual(await row(original.operationId),before);
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);try{await assert.rejects(db.query("SELECT public.r25wf_name_recovery_rotate('{}')"),e=>e.code==='42501');}finally{await db.exec('RESET ROLE');}}
 bad(await service.handle({action:'recover',...proof(original)}),'INVALID_REQUEST');
 bad(await service.handle({...status(original),newProof:'f'.repeat(64)}),'INVALID_REQUEST');
});
test('003 replay preserves all reservations and rejects raw secrets in administrative SQL payload',async()=>{
 const before=(await db.query('SELECT * FROM public.r25wf_name_registrations ORDER BY id')).rows;
 await db.exec(fs.readFileSync(path.join(root,'003-registration-recovery.sql'),'utf8'));
 assert.deepEqual((await db.query('SELECT * FROM public.r25wf_name_registrations ORDER BY id')).rows,before);
 bad(await rotate({operationSecret:'must-not-be-accepted'}),'INVALID_REQUEST');
});
test('offline preparation writes private portable code and hash-only SQL, never a secret to stdout',()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'r25-recovery-test-'));
 try{
  const snapshot={envId:ENV_ID,reservationId:crypto.randomUUID(),operationId:'local-test-op',name:"O'Reilly 测试",role:'operator',operationProof:'a'.repeat(64)};
  const input=path.join(temporary,'snapshot.json'),out=path.join(temporary,'private');fs.writeFileSync(input,JSON.stringify(snapshot),{mode:0o600});
  const stdout=execFileSync(process.execPath,[path.join(root,'prepare-registration-recovery.cjs'),input,out],{encoding:'utf8'});
  const code=fs.readFileSync(path.join(out,'recovery-code.txt'),'utf8').trim(),sql=fs.readFileSync(path.join(out,'rotate-proof.sql'),'utf8');
  const decoded=JSON.parse(Buffer.from(code.slice(8),'base64url'));assert.equal(decoded.version,1);assert.equal(decoded.envId,ENV_ID);assert.equal(decoded.name,snapshot.name);assert.match(decoded.operationSecret,/^[a-f0-9]{64}$/);
  assert.equal(stdout.includes(decoded.operationSecret),false);assert.equal(sql.includes(decoded.operationSecret),false);assert.equal(sql.includes(snapshot.name),false);
  assert.equal(fs.statSync(out).mode&0o777,0o700);for(const f of ['recovery-code.txt','rotate-proof.sql'])assert.equal(fs.statSync(path.join(out,f)).mode&0o777,0o600);
  assert.throws(()=>execFileSync(process.execPath,[path.join(root,'prepare-registration-recovery.cjs'),input,out],{stdio:'pipe'}));
  assert.throws(()=>prepare({...snapshot,envId:'wrong-env'}));assert.throws(()=>prepare({...snapshot,role:'admin'}));assert.throws(()=>prepare({...snapshot,password:'never'}));
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
});
