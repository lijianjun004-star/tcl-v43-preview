import test from 'node:test';
import assert from 'node:assert/strict';
import {createNameIdentityClient,normalizePersonName,validateJoinPassword} from '../tcl-v352-asr-r25-qa/name-identity.mjs';
const ready={state:'ready',username:'r25n_opaque',uid:'native-123'};
function fixture(handler,{enabled=true,endpoint='https://identity.example/name'}={}){
 const rows=new Map(),requests=[],writes=[];
 const storage={get:async key=>structuredClone(rows.get(key)),reserve:async(key,candidate)=>{const existing=rows.has(key);if(!existing){rows.set(key,structuredClone(candidate));writes.push(structuredClone(candidate));}return{value:structuredClone(rows.get(key)),existing};},save:async(key,value,expected)=>{const current=rows.get(key);if(expected===null?!!current:!expected||current?.operationId!==expected.operationId||current?.operationSecret!==expected.operationSecret)return false;rows.set(key,structuredClone(value));writes.push(structuredClone(value));return true;}};
 const client=createNameIdentityClient({config:{enabled,endpoint},envId:'test',storage,fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body);requests.push({url,body,credentials:options.credentials,redirect:options.redirect});
  const response=await handler(body,requests.length,rows);if(response?.data)response.data={role:'anchor',...response.data};if(response instanceof Error)throw response;
  return {ok:response.ok,json:async()=>response};
 }});return {client,rows,requests,writes,storage};
}
const join={name:'主播甲',password:'Joinpass123!',role:'anchor'};
test('normalization follows backend and rejects hidden controls and oversized names',()=>{
 assert.equal(normalizePersonName('  张三（电视） ',{registration:true}),'张三(电视)');
 assert.equal(normalizePersonName('张 三',{registration:true}),'张 三');
 assert.equal(normalizePersonName('  Alice Smith  ',{registration:true}),'Alice Smith');
 assert.throws(()=>normalizePersonName('张\u200d三',{registration:true}));
 assert.throws(()=>normalizePersonName('张'.repeat(41),{registration:true}));
 assert.equal(normalizePersonName('tcl_'+ 'a'.repeat(50)).length,54);
 assert.throws(()=>normalizePersonName('张'.repeat(41)));
});
test('first password matches official three of four classes and alphanumeric first rule',()=>{
 validateJoinPassword('Abc123!@');validateJoinPassword('A1'+'!'.repeat(30));validateJoinPassword('Abc!defg');
 for(const value of ['short1','onlyletters','12345678','abc12345','!Abc1234','A1'+'.'.repeat(30),'A1'+'!'.repeat(31)])assert.throws(()=>validateJoinPassword(value));
});
test('daily resolve sends name only and never persists a password',async()=>{
 const f=fixture(async()=>({ok:true,data:ready}));assert.deepEqual(await f.client.resolve('主播甲'),ready);
 assert.deepEqual(f.requests[0].body,{action:'resolve',name:'主播甲'});assert.equal(f.rows.size,0);assert.equal(f.requests[0].credentials,'omit');assert.equal(f.requests[0].redirect,'error');
});
test('registration persists recovery identifiers before request and never passwords or invite',async()=>{
 const f=fixture(async(body,n,rows)=>{assert.equal(rows.size,1);const row=[...rows.values()][0];assert.equal(row.operationId,body.operationId);assert.equal(row.operationSecret,body.operationSecret);return{ok:true,data:ready};});
 assert.deepEqual(await f.client.register(join),ready);const row=[...f.rows.values()][0];assert.match(row.operationSecret,/^[a-f0-9]{64}$/);assert.equal(row.state,'ready');
 const persisted=JSON.stringify(f.writes);assert.equal(persisted.includes(join.password),false);assert.equal(persisted.includes('invite-private'),false);
 assert.deepEqual(Object.keys(f.requests[0].body).sort(),['action','role','name','operationId','operationSecret','password'].sort());
});
test('response loss is resumed by status using same operation without duplicate account creation',async()=>{
 const f=fixture(async body=>body.action==='register'?new Error('response lost'):{ok:true,data:ready});
 await assert.rejects(f.client.register(join),error=>error.code==='IDENTITY_NETWORK');
 await f.client.register({...join,password:'Changed123!'});assert.deepEqual(f.requests.map(row=>row.body.action),['register','status']);
 assert.equal(f.requests[0].body.operationId,f.requests[1].body.operationId);assert.equal(f.requests[0].body.operationSecret,f.requests[1].body.operationSecret);
 assert.equal('password' in f.requests[1].body,false);assert.equal(JSON.stringify(f.writes).includes('Changed123!'),false);
});
test('reserved and missing first requests continue same durable operation with reentered password',async()=>{
 for(const status of [{ok:true,data:{state:'reserved',requiresPassword:true}},{ok:false,error:{code:'NOT_FOUND',message:'not found'}}]){
  let attempt=0;const f=fixture(async body=>body.action==='status'?status:++attempt===1?new Error('offline'):{ok:true,data:ready});
  await assert.rejects(f.client.register(join));await f.client.register(join);
  assert.deepEqual(f.requests.map(row=>row.body.action),['register','status','register']);
  assert.equal(f.requests[0].body.operationId,f.requests[2].body.operationId);assert.equal(f.requests[0].body.operationSecret,f.requests[2].body.operationSecret);
 }
});
test('case-normalized retries retain original reservation name and secret',async()=>{
 const f=fixture(async body=>body.action==='status'?{ok:true,data:ready}:new Error('offline'));
 await assert.rejects(f.client.register({...join,name:'主播ABC'}));await f.client.register({...join,name:'主播abc'});
 assert.equal(f.rows.size,1);assert.equal(f.requests[1].body.name,'主播ABC');assert.equal(f.requests[0].body.operationId,f.requests[1].body.operationId);
});
test('unavailable service preserves legacy native login but never fabricates name signup',async()=>{
 const f=fixture(()=>{throw new Error('must not call');},{enabled:false});assert.deepEqual(await f.client.resolve('tcl_old'),{username:'tcl_old'});
 await assert.rejects(f.client.resolve('主播甲'),error=>error.code==='IDENTITY_UNAVAILABLE');await assert.rejects(f.client.register(join),error=>error.code==='IDENTITY_UNAVAILABLE');assert.equal(f.requests.length,0);
});
test('name conflicts and unexpected registration states remain failures',async()=>{
 const f=fixture(async()=>({ok:false,error:{code:'NAME_CONFLICT',message:'姓名已使用，请直接登录'}}));await assert.rejects(f.client.register(join),error=>error.code==='NAME_CONFLICT');
 const malformed=fixture(async()=>({ok:true,data:{state:'reserved',username:'opaque'}}));await assert.rejects(malformed.client.register(join));
 const missingUid=fixture(async()=>({ok:true,data:{state:'ready',username:'opaque'}}));await assert.rejects(missingUid.client.register(join),error=>error.code==='INVALID_IDENTITY_RESPONSE');
});
test('weak provider password fails before persisting or sending an invitation registration',async()=>{
 const f=fixture(async()=>({ok:true,data:ready}));await assert.rejects(f.client.register({...join,password:'abc12345'}),error=>error.code==='INVALID_PASSWORD');
 assert.equal(f.rows.size,0);assert.equal(f.requests.length,0);
});

test('operator registration keeps role and rejects admin before storage or request',async()=>{
 const f=fixture(async()=>({ok:true,data:{...ready,role:'operator'}}));await f.client.register({...join,role:'operator'});
 assert.equal(f.requests[0].body.role,'operator');assert.equal([...f.rows.values()][0].role,'operator');
 const denied=fixture(async()=>({ok:true,data:ready}));await assert.rejects(denied.client.register({...join,role:'admin'}),e=>e.code==='INVALID_ROLE');assert.equal(denied.requests.length,0);assert.equal(denied.rows.size,0);
});
test('offline retry cannot change role without a definitive server NOT_FOUND',async()=>{
 const f=fixture(async()=>new Error('offline'));await assert.rejects(f.client.register({...join,role:'operator'}));
 await assert.rejects(f.client.register(join),e=>e.code==='IDENTITY_NETWORK');assert.equal(f.requests.length,2);assert.equal(f.requests[1].body.action,'status');assert.equal('role' in f.requests[1].body,false);assert.equal([...f.rows.values()][0].role,'operator');
});
test('server role mismatch never reports direct registration success',async()=>{
 const f=fixture(async()=>({ok:true,data:{...ready,role:'operator'}}));await assert.rejects(f.client.register(join),e=>e.code==='REGISTRATION_CONFLICT');
});

test('legacy ready operation uses its original proof and actual role without recasting',async()=>{
 const f=fixture(async()=>({ok:true,data:{...ready,role:'operator'}}));
 // Seed a durable old invitation operation through a failed direct attempt, then remove only new role metadata.
 const seed=fixture(async()=>new Error('offline'));
 await assert.rejects(seed.client.register(join));
 const [key,row]=[...seed.rows][0];delete row.role;f.rows.set(key,row);
 const result=await f.client.register(join);assert.equal(result.uid,ready.uid);assert.equal(result.role,'operator');assert.equal(result.legacyRecovery,true);
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].body.action,'status');assert.equal('role'in f.requests[0].body,false);assert.equal(f.requests[0].body.operationSecret,row.operationSecret);
});
test('legacy reserved or unknown operation remains intact for administrator recovery',async()=>{
 for(const response of [{ok:true,data:{state:'reserved',requiresPassword:true}},{ok:false,error:{code:'NOT_FOUND'}}]){
  const f=fixture(async()=>response),seed=fixture(async()=>new Error('offline'));await assert.rejects(seed.client.register(join));
  const [key,row]=[...seed.rows][0];delete row.role;f.rows.set(key,row);
  await assert.rejects(f.client.register(join),e=>e.code==='LEGACY_REGISTRATION_PENDING');assert.equal(f.requests.length,1);assert.deepEqual(f.rows.get(key),row);
 }
});

const recoveryPayload=(overrides={})=>({version:1,envId:'test',name:join.name,role:'anchor',operationId:'recovery-operation',operationSecret:'c'.repeat(64),...overrides});
const recoveryCode=value=>'R25REC1.'+Buffer.from(JSON.stringify(value)).toString('base64url');
const errorReply=code=>({ok:false,error:{code,message:code}});
test('unsent role correction keeps operation and secret after authoritative NOT_FOUND',async()=>{
 let registers=0;
 const f=fixture(async body=>body.action==='status'?errorReply('NOT_FOUND'):++registers===1?new Error('offline'):{ok:true,data:{...ready,role:body.role}});
 await assert.rejects(f.client.register(join));const original=structuredClone([...f.rows.values()][0]);
 await f.client.register({...join,role:'operator'});
 const [first,status,retry]=f.requests.map(r=>r.body);
 assert.equal(status.action,'status');assert.equal('role' in status,false);
 assert.equal(first.operationId,retry.operationId);assert.equal(first.operationSecret,retry.operationSecret);assert.equal(retry.role,'operator');
 assert.equal([...f.rows.values()][0].role,'operator');assert.equal([...f.rows.values()][0].operationId,original.operationId);
});
test('canonical server role rejects attempted change and repairs stale local role',async()=>{
 let attempt=0;
 const f=fixture(async body=>body.action==='register'&&++attempt===1?new Error('offline'):{ok:true,data:{state:'reserved',requiresPassword:true,role:'operator'}});
 await assert.rejects(f.client.register(join));
 await assert.rejects(f.client.register(join),e=>e.code==='REGISTRATION_CONFLICT'&&e.message.includes('运营'));
 assert.equal([...f.rows.values()][0].role,'operator');assert.deepEqual(f.requests.map(r=>r.body.action),['register','status']);
});
test('late old-role commit after NOT_FOUND is recovered without allocating another operation',async()=>{
 let registers=0,statuses=0;
 const f=fixture(async body=>{
  if(body.action==='register'){registers++;return new Error(registers===1?'offline before request':'response lost after race');}
  return ++statuses===1?errorReply('NOT_FOUND'):{ok:true,data:{...ready,role:'anchor'}};
 });
 await assert.rejects(f.client.register(join));
 await assert.rejects(f.client.register({...join,role:'operator'}),e=>e.code==='IDENTITY_NETWORK');
 assert.equal([...f.rows.values()][0].role,'operator');
 await assert.rejects(f.client.register({...join,role:'operator'}),e=>e.code==='REGISTRATION_CONFLICT');
 assert.equal([...f.rows.values()][0].role,'anchor');
 assert.deepEqual(await f.client.register(join),ready);
 assert.equal(registers,2);assert.equal(new Set(f.requests.map(r=>r.body.operationId)).size,1);
 assert.equal(new Set(f.requests.map(r=>r.body.operationSecret)).size,1);
});
test('recovery code is validated by server before replacing a failed local attempt',async()=>{
 let allow=false;const value=recoveryPayload({role:'operator'});
 const f=fixture(async(body,n,rows)=>{
  if(body.action==='register')return new Error('offline');
  assert.equal([...rows.values()][0].operationSecret===value.operationSecret,allow);
  return {ok:true,data:{state:'reserved',requiresPassword:true,role:value.role}};
 });
 await assert.rejects(f.client.register(join));
 const original=structuredClone([...f.rows.values()][0]);
 assert.deepEqual(await f.client.restoreRecovery(recoveryCode(value)),{name:join.name,role:'operator',state:'reserved'});
 const restored=[...f.rows.values()][0];assert.equal(restored.operationId,value.operationId);assert.equal(restored.operationSecret,value.operationSecret);assert.notEqual(restored.operationId,original.operationId);
 assert.deepEqual(f.requests[1].body,{action:'status',name:value.name,operationId:value.operationId,operationSecret:value.operationSecret});
 assert.equal(JSON.stringify(f.writes).includes(join.password),false);
});
test('invalid, wrong-environment and admin recovery codes fail without requests or storage writes',async()=>{
 for(const code of ['bad','R25REC1.???',recoveryCode(recoveryPayload({envId:'other'})),recoveryCode(recoveryPayload({role:'admin'})),recoveryCode(recoveryPayload({name:'  name'})),recoveryCode(recoveryPayload({operationSecret:'short'})),recoveryCode({...recoveryPayload(),password:'forbidden'}),recoveryCode({...recoveryPayload(),version:2})]){
  const f=fixture(async()=>{throw new Error('must not call');});
  await assert.rejects(f.client.restoreRecovery(code),e=>e.code==='INVALID_RECOVERY_CODE');assert.equal(f.requests.length,0);assert.equal(f.rows.size,0);
 }
});
test('recovery status rejection, network errors and storage failure preserve original local record',async()=>{
 for(const reply of [errorReply('INVALID_OPERATION_SECRET'),new Error('offline'),{ok:true,data:{state:'reserved',requiresPassword:true}}]){
  let first=true;const f=fixture(async()=>{if(first){first=false;return new Error('offline');}return reply;});
  await assert.rejects(f.client.register(join));const before=structuredClone([...f.rows]);
  const code=recoveryCode(recoveryPayload(reply?.ok?{role:'operator'}:{}));
  await assert.rejects(f.client.restoreRecovery(code));assert.deepEqual([...f.rows],before);
 }
 const f=fixture(async body=>body.action==='register'?new Error('offline'):{ok:true,data:{state:'reserved',requiresPassword:true}});
 await assert.rejects(f.client.register(join));const before=structuredClone([...f.rows]);f.storage.save=async()=>{throw new Error('synthetic storage failure');};
 await assert.rejects(f.client.restoreRecovery(recoveryCode(recoveryPayload())));assert.deepEqual([...f.rows],before);
});
test('ready recovery requires an actual UID and matching canonical role',async()=>{
 for(const data of [{state:'ready',username:'opaque'}, {...ready,role:'operator'}, {state:'reserved',role:'anchor',requiresPassword:false}, {state:'unknown',role:'anchor'}]){
  const f=fixture(async()=>({ok:true,data}));await assert.rejects(f.client.restoreRecovery(recoveryCode(recoveryPayload())));assert.equal(f.rows.size,0);
 }
 const f=fixture(async()=>({ok:true,data:ready}));assert.equal((await f.client.restoreRecovery(recoveryCode(recoveryPayload()))).state,'ready');assert.equal(f.rows.size,1);
});
test('late old-tab registration response cannot overwrite imported rotated proof',async()=>{
 let release;const reply=new Promise(resolve=>{release=resolve;});
 const f=fixture(async body=>body.action==='register'?reply:{ok:true,data:{state:'reserved',requiresPassword:true}});
 const old=f.client.register(join);const rejected=assert.rejects(old,e=>e.code==='REGISTRATION_STORAGE_CHANGED');
 while(f.requests.length===0)await new Promise(resolve=>setImmediate(resolve));
 const original=structuredClone([...f.rows.values()][0]);const value=recoveryPayload({operationId:original.operationId});
 await f.client.restoreRecovery(recoveryCode(value));
 release({ok:true,data:ready});await rejected;
 assert.equal([...f.rows.values()][0].operationSecret,value.operationSecret);assert.equal([...f.rows.values()][0].state,'reserved');
});
test('delayed older code import cannot overwrite a newer validated recovery import',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});const oldCode=recoveryPayload({operationSecret:'a'.repeat(64)}),newCode=recoveryPayload({operationSecret:'b'.repeat(64)});
 const f=fixture(async body=>body.operationSecret===oldCode.operationSecret?pending:{ok:true,data:{state:'reserved',requiresPassword:true}});
 const old=f.client.restoreRecovery(recoveryCode(oldCode));const rejected=assert.rejects(old,e=>e.code==='REGISTRATION_STORAGE_CHANGED');
 while(f.requests.length===0)await new Promise(resolve=>setImmediate(resolve));
 await f.client.restoreRecovery(recoveryCode(newCode));
 release({ok:true,data:{state:'reserved',requiresPassword:true}});await rejected;
 assert.equal([...f.rows.values()][0].operationSecret,newCode.operationSecret);
 assert.equal(f.writes.length,1);
});
