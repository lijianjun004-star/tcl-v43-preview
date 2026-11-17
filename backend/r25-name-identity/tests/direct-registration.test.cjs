'use strict';
// Actual PostgreSQL via PGlite, mocked auth claims/native Auth only. No cloud calls.
// NODE_PATH=/path/to/installed/node_modules node --test tests/direct-registration.test.cjs
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const {createIdentityService,createHttpHandler}=require('../handler.cjs');
const root=path.resolve(__dirname,'..');
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const md5=v=>crypto.createHash('md5').update(v).digest('hex');
const migration=fs.readFileSync(path.join(root,'002-direct-registration.sql'),'utf8');
const recoveryMigration=fs.readFileSync(path.join(root,'003-registration-recovery.sql'),'utf8');
let db,legacyReservation,legacySnapshot,legacyInvite,service;
const users=new Map(),calls=[],dbCalls=[];
let serial=0,createBehavior=null,finalizeFailure=false;
function request(name,role='anchor') {return {action:'register',name,role,password:'LocalTest123!',operationId:crypto.randomUUID(),operationSecret:crypto.randomBytes(32).toString('base64url')};}
function proof(req) {return {operationId:req.operationId,operationProof:sha(req.operationSecret)};}
function status(req) {return {action:'status',name:req.name,role:req.role,operationId:req.operationId,operationSecret:req.operationSecret};}
function expectError(r,code) {assert.equal(r.ok,false,JSON.stringify(r));assert.equal(r.error.code,code,JSON.stringify(r));}
async function sqlCall(action,payload={}) {
 await db.exec('SET ROLE service_role');
 try {return (await db.query('SELECT public.r25wf_name_identity_service($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;}
 finally {await db.exec('RESET ROLE');}
}
async function invite(role='anchor') {
 const code=crypto.randomBytes(16).toString('hex'),id=crypto.randomUUID();
 await db.query("INSERT INTO public.r25wf_invites(id,code_hash,role,created_by,expires_at) VALUES($1,$2,$3,'legacy-admin',clock_timestamp()+interval '48 hours')",[id,md5(code),role]);
 return {code,id};
}
const provider={
 async dbCall(action,payload) {
  dbCalls.push({action,payload});
  if(action==='finalize'&&finalizeFailure){finalizeFailure=false;throw Error('Synthetic unavailable');}
  return sqlCall(action,payload);
 },
 async findNativeUser(username) {calls.push({method:'find',username});return users.get(username)||null;},
 async createNativeUser({username,password,displayName,marker}) {
  calls.push({method:'create',username,passwordPresent:!!password});
  if(createBehavior==='fail-before'){createBehavior=null;throw Error('Synthetic unavailable');}
  const row={uid:'new-native-'+(++serial),username,description:marker,status:'ACTIVE'};
  assert.equal(users.has(username),false,'native username must not be recreated');users.set(username,row);
  if(createBehavior==='fail-after'){createBehavior=null;throw Error('Synthetic timeout after commit');}
  return {uid:row.uid,username};
 }
};
before(async()=>{
 db=new PGlite('memory://',{extensions:{pgcrypto}});await db.waitReady;
 await db.exec(`CREATE EXTENSION pgcrypto;
 CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;
 CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon')$$;
 GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION auth.uid(),auth.role() TO anon,authenticated,service_role;
 CREATE SCHEMA storage;CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb);`);
 await db.exec(fs.readFileSync(path.join(root,'../r25-cloudbase/schema.sql'),'utf8'));
 await db.exec("INSERT INTO public.r25wf_users(uid,role,display_name) VALUES('legacy-admin','admin','已有管理员'),('legacy-anchor','anchor','旧主播'),('legacy-operator','operator','旧运营')");
 await db.exec(fs.readFileSync(path.join(root,'001-name-identity.sql'),'utf8'));
 await sqlCall('backfill',{identities:[{uid:'legacy-anchor',nativeUsername:'Old.Native'},{uid:'legacy-operator',nativeUsername:'Old.Operator'},{uid:'legacy-admin',nativeUsername:'Old.Admin'}]});
 users.set('Old.Native',{uid:'legacy-anchor',username:'Old.Native',description:null,status:'ACTIVE'});
 users.set('Old.Admin',{uid:'legacy-admin',username:'Old.Admin',description:null,status:'ACTIVE'});
 legacyInvite=await invite();legacyReservation=request('升级前未完成');delete legacyReservation.role;legacyReservation.inviteCode=legacyInvite.code;
 const old=await sqlCall('reserve',{...proof(legacyReservation),name:legacyReservation.name,inviteHash:md5(legacyInvite.code)});assert.equal(old.ok,true,JSON.stringify(old));
 legacySnapshot=(await db.query("SELECT row_to_json(r) row FROM public.r25wf_name_registrations r WHERE operation_id=$1",[legacyReservation.operationId])).rows[0].row;
 await db.exec(migration);await db.exec(recoveryMigration);service=createIdentityService({provider});
});
after(async()=>{await db?.close();});
test('upgrade and rerun preserve legacy users, aliases and original invite reservation',async()=>{
 assert.deepEqual((await db.query("SELECT row_to_json(r) row FROM public.r25wf_name_registrations r WHERE operation_id=$1",[legacyReservation.operationId])).rows[0].row,legacySnapshot);
 await db.exec(migration);await db.exec(recoveryMigration);
 assert.deepEqual((await db.query("SELECT uid,role,display_name FROM public.r25wf_users ORDER BY uid")).rows,[{uid:'legacy-admin',role:'admin',display_name:'已有管理员'},{uid:'legacy-anchor',role:'anchor',display_name:'旧主播'},{uid:'legacy-operator',role:'operator',display_name:'旧运营'}]);
 assert.equal((await db.query('SELECT count(*)::int n FROM public.r25wf_name_aliases')).rows[0].n,3);
});
test('direct anchor and operator registration need no invitation and return bound role',async()=>{
 for(const role of ['anchor','operator']){
  const req=request('直接注册'+role,role),r=await service.handle(req);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.data.role,role);
  assert.equal(r.data.state,'ready');assert.match(r.data.username,/^r25n_[a-f0-9]{24}$/);
  const row=(await db.query('SELECT * FROM public.r25wf_name_registrations WHERE operation_id=$1',[req.operationId])).rows[0];
  assert.equal(row.invite_id,null);assert.equal(row.invite_hash,null);assert.equal(row.operation_proof,sha(req.operationSecret));
  assert.equal((await db.query('SELECT role FROM public.r25wf_users WHERE uid=$1',[r.data.uid])).rows[0].role,role);
  const count=calls.filter(x=>x.method==='create').length;
  assert.deepEqual(await service.handle({...req,password:'Different123!'}),r,'ready replay retains UID without resetting native password');
  assert.deepEqual(await service.handle(status(req)),r);assert.equal(calls.filter(x=>x.method==='create').length,count);
  expectError(await service.handle({...req,role:role==='anchor'?'operator':'anchor'}),'REGISTRATION_CONFLICT');
  assert.deepEqual(await service.handle({...status(req),role:undefined}),r,'proof-authenticated status learns canonical role without changing it');
  expectError(await service.handle({...status(req),role:role==='anchor'?'operator':'anchor'}),'REGISTRATION_CONFLICT');
 }
});
test('role whitelist and privileged fields fail before any native account creation',async()=>{
 const count=calls.filter(x=>x.method==='create').length;
 for(const role of ['admin','ADMIN','operator ',null,{},0,undefined])expectError(await service.handle({...request('拒绝管理员'),role}),'INVALID_ROLE');
 for(const field of ['uid','providerUid','username','nativeUsername','marker','active'])expectError(await service.handle({...request('拒绝字段'),[field]:'forged'}),'INVALID_REQUEST');
 expectError(await service.handle({...request('混合注册'),inviteCode:legacyInvite.code}),'INVALID_REQUEST');
 expectError(await sqlCall('reserve',{...proof(request('管理员')),name:'管理员',role:'admin'}),'INVALID_ROLE');
 assert.equal(calls.filter(x=>x.method==='create').length,count);
});
test('wrong secret/name/role cannot query or adopt pending native identity',async()=>{
 const req=request('待完成身份','operator');createBehavior='fail-before';expectError(await service.handle(req),'NATIVE_CREATION_FAILED');
 const r=await service.handle(status(req));assert.deepEqual(r,{ok:true,data:{state:'reserved',requiresPassword:true,role:'operator'}});
 expectError(await service.handle({...status(req),operationSecret:crypto.randomBytes(32).toString('base64url')}),'INVALID_OPERATION_SECRET');
 expectError(await service.handle({...status(req),name:'其他姓名'}),'REGISTRATION_CONFLICT');
 expectError(await service.handle({...status(req),role:'anchor'}),'REGISTRATION_CONFLICT');
 assert.equal((await service.handle(req)).ok,true);
});
test('native create timeout and finalization outage recover same UID without password replay',async()=>{
 const timed=request('原生超时恢复');createBehavior='fail-after';const ready=await service.handle(timed);assert.equal(ready.ok,true,JSON.stringify(ready));
 const req=request('数据库超时恢复','operator');finalizeFailure=true;expectError(await service.handle(req),'PROVIDER_UNAVAILABLE');
 const count=calls.filter(x=>x.method==='create').length;const recovered=await service.handle(status(req));assert.equal(recovered.ok,true,JSON.stringify(recovered));assert.equal(recovered.data.role,'operator');
 assert.equal(calls.filter(x=>x.method==='create').length,count);
});
test('native marker mismatch blocks finalization; existing native UID cannot be adopted',async()=>{
 const req=request('标记冲突');createBehavior='fail-before';expectError(await service.handle(req),'NATIVE_CREATION_FAILED');
 const row=(await db.query('SELECT native_username FROM public.r25wf_name_registrations WHERE operation_id=$1',[req.operationId])).rows[0];
 users.set(row.native_username,{uid:'unrelated-native',username:row.native_username,description:'different-marker',status:'ACTIVE'});
 expectError(await service.handle(status(req)),'NATIVE_IDENTITY_CONFLICT');
 assert.equal((await db.query("SELECT count(*)::int n FROM public.r25wf_users WHERE uid='unrelated-native'")).rows[0].n,0);
 const req2=request('禁止接管');const reserved=await sqlCall('reserve',{...proof(req2),name:req2.name,role:req2.role});assert.equal(reserved.ok,true);
 expectError(await sqlCall('finalize',{...proof(req2),role:req2.role,providerUid:'legacy-admin',nativeUsername:reserved.data.username,marker:reserved.data.marker}),'NATIVE_IDENTITY_CONFLICT');
 assert.equal((await db.query("SELECT role FROM public.r25wf_users WHERE uid='legacy-admin'")).rows[0].role,'admin');
});
test('legacy invitation reservation survives upgrade and resumes without role',async()=>{
 const pending=await service.handle(status(legacyReservation));assert.equal(pending.ok,true);assert.equal(pending.data.requiresPassword,true);
 expectError(await service.handle({...legacyReservation,role:'anchor',inviteCode:undefined}),'REGISTRATION_CONFLICT');
 const r=await service.handle(legacyReservation);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.data.role,'anchor');
 assert.equal((await db.query('SELECT consumed_by FROM public.r25wf_invites WHERE id=$1',[legacyInvite.id])).rows[0].consumed_by,r.data.uid);
 assert.deepEqual(await service.handle(status(legacyReservation)),r);
 const inv=await invite('operator'),req=request('旧客户端仍可开通');delete req.role;req.inviteCode=inv.code;assert.equal((await service.handle(req)).data.role,'operator');
});
test('legacy reservation cannot convert to direct role or bypass revoked inviter',async()=>{
 const inv=await invite(),req=request('旧预约不转换');delete req.role;req.inviteCode=inv.code;
 createBehavior='fail-before';expectError(await service.handle(req),'NATIVE_CREATION_FAILED');
 const direct={...req,role:'operator'};delete direct.inviteCode;expectError(await service.handle(direct),'REGISTRATION_CONFLICT');
 await db.exec("UPDATE public.r25wf_users SET active=false WHERE uid='legacy-admin'");
 expectError(await service.handle(req),'ROLE_BINDING_BLOCKED');
 await db.exec("UPDATE public.r25wf_users SET active=true WHERE uid='legacy-admin'");
 assert.equal((await service.handle(status(req))).ok,true);
});
test('normalized name and legacy username namespaces stay unique',async()=>{
 const first=await service.handle(request('Ａｌｐｈａ User'));assert.equal(first.ok,true,JSON.stringify(first));
 expectError(await service.handle(request(' alpha user ')),'NAME_TAKEN');
 expectError(await service.handle(request('old.native')),'NAME_TAKEN');
 expectError(await service.handle(request('Old.Native')),'NAME_TAKEN');
 expectError(await service.handle(request('旧主播')),'NAME_TAKEN');
 const login=await service.handle({action:'resolve',name:'Old.Native'});assert.equal(login.data.uid,'legacy-anchor');assert.equal(login.data.legacy,true);
 const admin=await service.handle({action:'resolve',name:'Old.Admin'});assert.equal(admin.data.uid,'legacy-admin');
 const before=(await db.query('SELECT count(*)::int n FROM public.r25wf_users')).rows[0].n;
 expectError(await service.handle(request('隐藏\u200b姓名')),'INVALID_NAME');
 assert.equal((await db.query('SELECT count(*)::int n FROM public.r25wf_users')).rows[0].n,before);
});
test('service-only function and private tables reject anon and authenticated',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec(`SET ROLE ${role}`);
  try {
   await assert.rejects(db.query("SELECT public.r25wf_name_identity_service('status','{}')"),e=>e.code==='42501');
   await assert.rejects(db.query('SELECT * FROM public.r25wf_name_registrations'),e=>e.code==='42501');
  } finally {await db.exec('RESET ROLE');}
 }
 for(const secret of ['password','operationSecret','inviteCode'])expectError(await sqlCall('reserve',{[secret]:'must-not-persist'}),'INVALID_REQUEST');
 for(const c of dbCalls){assert.equal('password' in c.payload,false);assert.equal('operationSecret' in c.payload,false);assert.equal('inviteCode' in c.payload,false);}
});
test('persistent registration quotas enforce per-source and global ceilings',async()=>{
 await db.exec('DELETE FROM public.r25wf_name_rates');
 const rateKey=sha('rate-source');for(let i=0;i<50;i++)assert.equal((await sqlCall('limit',{rateKey,bucket:'register'})).ok,true);
 expectError(await sqlCall('limit',{rateKey,bucket:'register'}),'RATE_LIMITED');
 for(let i=0;i<150;i++)assert.equal((await sqlCall('limit',{rateKey:sha('global-'+i),bucket:'register'})).ok,true);
 expectError(await sqlCall('limit',{rateKey:sha('over-global'),bucket:'register'}),'RATE_LIMITED');
 await db.exec('DELETE FROM public.r25wf_name_rates');
});
test('HTTP rejects untrusted origins and maps invalid role without leaking secrets',async()=>{
 const http=createHttpHandler({provider});
 const denied=await http({httpMethod:'POST',headers:{origin:'https://attacker.invalid'},body:JSON.stringify(request('跨域'))});assert.equal(denied.statusCode,403);
 const req=request('HTTP管理员','admin');const bad=await http({httpMethod:'POST',headers:{origin:'https://lijianjun004-star.github.io'},body:JSON.stringify(req)});assert.equal(bad.statusCode,400);expectError(JSON.parse(bad.body),'INVALID_ROLE');
 assert.equal(bad.body.includes(req.password),false);assert.equal(bad.body.includes(req.operationSecret),false);
});
