// Cross-layer local integration: real client + handler + SQL, synthetic Native Auth.
// No cloud calls or user data. This does not replace real CloudBase acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createNameIdentityClient } from '../tcl-v352-asr-r25-qa/name-identity.mjs';
const require=createRequire(import.meta.url);
const { PGlite }=require(process.env.R25_PGLITE_PACKAGE || '@electric-sql/pglite');
const { createIdentityService }=require('../../../backend/r25-name-identity/handler.cjs');
const { prepare, ENV_ID }=require('../../../backend/r25-name-identity/prepare-registration-recovery.cjs');
const base=new URL('../../../',import.meta.url);
function storage() {
 const rows=new Map();
 return {rows,get:async k=>structuredClone(rows.get(k)),reserve:async(k,v)=>{
  const existing=rows.has(k);if(!existing)rows.set(k,structuredClone(v));return{existing,value:structuredClone(rows.get(k))};
 },save:async(k,v,expected)=>{const c=rows.get(k);if(expected===null?c!==undefined:c?.operationId!==expected.operationId||c?.operationSecret!==expected.operationSecret)return false;rows.set(k,structuredClone(v));return true;}};
}
test('lost browser recovers original reservation before or after native creation; offline role correction stays one operation',async()=>{
 const db=new PGlite();await db.waitReady;
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS text LANGUAGE sql AS $$SELECT 'synthetic'::text$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'authenticated'::text$$;`);
 for(const f of ['backend/r25-cloudbase/schema.sql','backend/r25-name-identity/001-name-identity.sql','backend/r25-name-identity/002-direct-registration.sql','backend/r25-name-identity/003-registration-recovery.sql'])await db.exec(await fs.readFile(new URL(f,base),'utf8'));
 const native=new Map();let mode='',created=0,offline=false;
 const service=createIdentityService({provider:{
  dbCall:async(a,p)=>{
   if(a==='finalize'&&mode==='after-native')throw Error('synthetic finalize unavailable');
   return (await db.query('SELECT public.r25wf_name_identity_service($1,$2::jsonb) r',[a,JSON.stringify(p)])).rows[0].r;
  },findNativeUser:async name=>native.get(name)||null,
  createNativeUser:async v=>{if(mode==='before-native')throw Error('synthetic create unavailable');assert.equal(native.has(v.username),false);const row={uid:'native-'+(++created),username:v.username,description:v.marker,status:'ACTIVE',password:v.password};native.set(v.username,row);return row;}
 }});
 const client=s=>createNameIdentityClient({envId:ENV_ID,config:{enabled:true,endpoint:'https://synthetic.invalid/'},storage:s,fetchImpl:async(_u,o)=>{if(offline)throw Error('offline');const r=await service.handle(JSON.parse(o.body));return{ok:r.ok,json:async()=>r};}});
 for(const [scenario,role] of [['before-native','anchor'],['after-native','operator']]){
  mode=scenario;const name='整链恢复-'+scenario,firstStore=storage(),first=client(firstStore),join={name,password:'Original123!',role};
  await assert.rejects(first.register(join));
  const before=(await db.query('SELECT * FROM public.r25wf_name_registrations WHERE display_name=$1',[name])).rows[0];
  const prepared=prepare({envId:ENV_ID,reservationId:before.id,operationId:before.operation_id,name,role,operationProof:before.operation_proof});
  const codeData=JSON.parse(Buffer.from(prepared.code.slice(8),'base64url').toString());
  const sqlResult=await db.exec(prepared.sql);assert.equal(sqlResult[1].rows[0].recovery_result.ok,true);
  // A brand-new browser has no old operation secret at all.
  const freshStore=storage(),fresh=client(freshStore);mode='';
  const restored=await fresh.restoreRecovery(prepared.code);assert.equal(restored.role,role);
  const result=await fresh.register(join);const after=(await db.query('SELECT * FROM public.r25wf_name_registrations WHERE id=$1',[before.id])).rows[0];
  assert.equal(after.native_username,before.native_username);assert.equal(after.native_marker,before.native_marker);assert.equal(after.role,before.role);assert.equal(after.operation_id,before.operation_id);assert.equal(after.state,'ready');assert.equal(result.uid,after.uid);
  assert.equal(native.get(after.native_username).password,join.password);assert.equal([...freshStore.rows.values()][0].operationSecret,codeData.operationSecret);
  await assert.rejects(first.register(join),e=>e.code==='INVALID_OPERATION_SECRET');
 }
 assert.equal(created,2);
 const store=storage(),c=client(store),join={name:'整链离线改选',password:'Original123!',role:'anchor'};
 offline=true;await assert.rejects(c.register(join));const original=[...store.rows.values()][0];offline=false;
 await c.register({...join,role:'operator'});const saved=[...store.rows.values()][0];
 assert.equal(saved.operationId,original.operationId);assert.equal(saved.operationSecret,original.operationSecret);assert.equal(saved.role,'operator');assert.equal(created,3);
 }finally{await db.close();}
});
