/** Native localhost PostgreSQL18.6, separate connections and actual overlapping transactions. */
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
const dir='/workspace/r25-name-identity-tests';
const migrationPath='/workspace/tcl-r25-name-login/backend/r25-name-identity/001-name-identity.sql';
const sha=v=>crypto.createHash('sha256').update(v).digest('hex'),md5=v=>crypto.createHash('md5').update(v).digest('hex');
const report={scope:'native-localhost-PostgreSQL-two-transaction-concurrency+mock-auth',checks:[],cloudCalls:0};
const check=(name,ok,detail)=>{report.checks.push({name,pass:!!ok,...(detail===undefined?{}:{detail})});assert.ok(ok,name+': '+JSON.stringify(detail))};
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
await fs.mkdir(dir+'/socket',{recursive:true});await fs.rm(dir+'/concurrency-pg-data',{recursive:true,force:true});
const logs=[],pg=new EmbeddedPostgres({databaseDir:dir+'/concurrency-pg-data',user:'postgres',password:'local-only-synthetic',port,persistent:true,autoRehydrateSymlinks:true,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-c','listen_addresses=127.0.0.1','-c','unix_socket_directories='+dir+'/socket'],onLog:m=>logs.push(String(m)),onError:m=>logs.push(String(m))});
let admin,A,B;
const bootstrap=`CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN;CREATE SCHEMA auth;CREATE FUNCTION auth.uid() RETURNS text LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')$$;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon')$$;GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION auth.uid(),auth.role() TO anon,authenticated,service_role;CREATE SCHEMA storage;CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb);`;
const service=async(client,action,payload)=>(await client.query('SELECT public.r25wf_name_identity_service($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;
const redeem=async(client,code,name)=>(await client.query("SELECT public.r25wf_api('invites.redeem',$1::jsonb,$2) result",[JSON.stringify({code,displayName:name}),crypto.randomUUID()])).rows[0].result;
async function tx(client,role,uid=''){await client.query('BEGIN');await client.query(`SET LOCAL ROLE ${role}`);await client.query("SELECT set_config('request.jwt.claim.role',$1,true),set_config('request.jwt.claim.sub',$2,true)",[role,uid]);}
const seedInvite=async()=>{const code=crypto.randomBytes(16).toString('hex'),id=crypto.randomUUID();await admin.query("INSERT INTO public.r25wf_invites(id,code_hash,role,created_by,expires_at)VALUES($1,$2,'anchor','local-admin',clock_timestamp()+interval'48 hours')",[id,md5(code)]);return{id,code}};
const reservation=(name,code)=>({name,operationId:crypto.randomUUID(),operationProof:sha(crypto.randomBytes(32)),inviteHash:md5(code)});
async function waiting(pid,name){
 for(let attempt=0;attempt<100;attempt++){
  const state=(await admin.query('SELECT wait_event_type,wait_event,state FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
  if(state?.wait_event_type==='Lock'){check(name,true,state);return}
  await new Promise(r=>setTimeout(r,10));
 }
 check(name,false,{message:'other connection never entered a database Lock wait'});
}
try{
 await pg.initialise();await pg.start();admin=pg.getPgClient();A=pg.getPgClient();B=pg.getPgClient();await Promise.all([admin.connect(),A.connect(),B.connect()]);
 await admin.query(bootstrap);await admin.query(await fs.readFile('/workspace/tcl-r25-name-login/backend/r25-cloudbase/schema.sql','utf8'));
 await admin.query("INSERT INTO public.r25wf_users(uid,role,display_name)VALUES('local-admin','admin','本地管理员'),('legacy-one','anchor','原有重复姓名'),('legacy-two','anchor','原有重复姓名')");
 const oldRows=(await admin.query("SELECT * FROM public.r25wf_users WHERE uid LIKE 'legacy-%' ORDER BY uid")).rows;
 const migration=await fs.readFile(migrationPath,'utf8');report.migrationShaBefore=sha(migration);await admin.query(migration);
 check('migration_keeps_preexisting_duplicate_rows_unchanged',JSON.stringify((await admin.query("SELECT * FROM public.r25wf_users WHERE uid LIKE 'legacy-%' ORDER BY uid")).rows)===JSON.stringify(oldRows));
 const pids=[(await A.query('SELECT pg_backend_pid() pid')).rows[0].pid,(await B.query('SELECT pg_backend_pid() pid')).rows[0].pid];report.backendPids=pids;report.version=(await admin.query('SELECT version()')).rows[0].version;check('genuinely_distinct_postgres_backend_connections',pids[0]!==pids[1]);await A.query("SET statement_timeout='4s'");await B.query("SET statement_timeout='4s'");
 // New reserve holds name. Old RPC's different invitation reaches name trigger and must wait, then reject.
 {
  const x=await seedInvite(),y=await seedInvite(),p=reservation('双连接新路先锁',x.code);await tx(A,'service_role');const r=await service(A,'reserve',p);check('new_reserve_succeeds_before_legacy_contender',r.ok,r);
  await tx(B,'authenticated','native-B-one');const pending=redeem(B,y.code,p.name);await waiting(pids[1],'legacy_redeem_actually_waits_on_new_reserved_name');await A.query('COMMIT');const old=await pending;check('legacy_redeem_rejects_reserved_name_after_wait',!old.ok&&['NAME_PENDING','NAME_TAKEN','NAME_CONFLICT'].includes(old.error.code),old);await B.query('COMMIT');
  check('rejected_legacy_redeem_does_not_consume_other_invite',(await admin.query('SELECT consumed_by FROM public.r25wf_invites WHERE id=$1',[y.id])).rows[0].consumed_by===null);
  await tx(A,'service_role');const final=await service(A,'finalize',{operationId:p.operationId,operationProof:p.operationProof,providerUid:'native-A-one',nativeUsername:r.data.username,marker:r.data.marker});check('reserved_native_uid_can_finalize_through_guard',final.ok,final);await A.query('COMMIT');
  check('cross_entrypoint_has_single_active_uid',(await admin.query('SELECT count(*)::int n FROM public.r25wf_users WHERE active AND public.r25wf_name_key(display_name)=public.r25wf_name_key($1)',[p.name])).rows[0].n===1);
 }
 // Old redeem holds name. New reserve uses another invite, waits, then sees newly committed active UID.
 {
  const x=await seedInvite(),y=await seedInvite(),p=reservation('双连接旧路先锁',x.code);await tx(B,'authenticated','native-B-two');const old=await redeem(B,y.code,p.name);check('legacy_redeem_can_claim_free_name_first',old.ok,old);
  await tx(A,'service_role');const pending=service(A,'reserve',p);await waiting(pids[0],'new_reserve_actually_waits_on_legacy_name_guard');await B.query('COMMIT');const r=await pending;check('new_reserve_rejects_legacy_committed_name',!r.ok&&['NAME_TAKEN','NAME_CONFLICT'].includes(r.error.code),r);await A.query('COMMIT');check('rejected_new_reserve_keeps_own_invite_unconsumed',(await admin.query('SELECT consumed_by FROM public.r25wf_invites WHERE id=$1',[x.id])).rows[0].consumed_by===null);
 }
 // Same invitation and name: old invitation row first, new must wait on row (no inverse name lock/deadlock).
 {
  const x=await seedInvite(),p=reservation('相同邀请旧路先锁',x.code);await tx(B,'authenticated','native-B-three');check('legacy_same_invite_first_succeeds',(await redeem(B,x.code,p.name)).ok);await tx(A,'service_role');const pending=service(A,'reserve',p);await waiting(pids[0],'new_same_invite_waits_before_name_lock');await B.query('COMMIT');const r=await pending;check('same_invite_legacy_wins_without_deadlock',!r.ok&&r.error.code==='INVALID_INVITE',r);await A.query('COMMIT');
 }
 // Reverse same invitation order.
 {
  const x=await seedInvite(),p=reservation('相同邀请新路先锁',x.code);await tx(A,'service_role');check('new_same_invite_first_succeeds',(await service(A,'reserve',p)).ok);await tx(B,'authenticated','native-B-four');const pending=redeem(B,x.code,p.name);await waiting(pids[1],'legacy_same_invite_waits_on_new_reserve');await A.query('COMMIT');const old=await pending;check('same_invite_new_reserve_wins_without_deadlock',!old.ok&&old.error.code==='INVALID_INVITE',old);await B.query('COMMIT');
 }
 report.migrationShaAfter=sha(await fs.readFile(migrationPath));check('migration_source_unchanged_during_concurrency_tests',report.migrationShaAfter===report.migrationShaBefore);report.status='PASS';
}catch(e){report.status='FAIL';report.error={message:e.message,code:e.code,stack:e.stack}}
finally{for(const c of[A,B,admin])if(c){try{await c.query('ROLLBACK')}catch{}await c.end().catch(()=>{})}await pg.stop().catch(()=>{});await fs.writeFile(dir+'/real-pg-concurrency-result.json',JSON.stringify(report,null,2)+'\n');await fs.writeFile(dir+'/real-pg-concurrency-server.log',logs.join('\n'));console.log(JSON.stringify(report,null,2))}
if(report.status!=='PASS')process.exitCode=1;
