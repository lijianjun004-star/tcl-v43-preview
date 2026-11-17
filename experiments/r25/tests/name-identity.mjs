import test from 'node:test';
import assert from 'node:assert/strict';
import {createNameIdentityClient,normalizePersonName,validateJoinPassword} from '../tcl-v352-asr-r25-qa/name-identity.mjs';
const ready={state:'ready',username:'r25n_opaque',uid:'native-123'};
function fixture(handler,{enabled=true,endpoint='https://identity.example/name'}={}){
 const rows=new Map(),requests=[],writes=[];
 const storage={reserve:async(key,candidate)=>{const existing=rows.has(key);if(!existing){rows.set(key,structuredClone(candidate));writes.push(structuredClone(candidate));}return{value:structuredClone(rows.get(key)),existing};},put:async(key,value)=>{rows.set(key,structuredClone(value));writes.push(structuredClone(value));}};
 const client=createNameIdentityClient({config:{enabled,endpoint},envId:'test',storage,fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body);requests.push({url,body,credentials:options.credentials,redirect:options.redirect});
  const response=await handler(body,requests.length,rows);if(response instanceof Error)throw response;
  return {ok:response.ok,json:async()=>response};
 }});return {client,rows,requests,writes};
}
const join={name:'主播甲',password:'Joinpass123!',inviteCode:'invite-private'};
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
 const persisted=JSON.stringify(f.writes);assert.equal(persisted.includes(join.password),false);assert.equal(persisted.includes(join.inviteCode),false);
 assert.deepEqual(Object.keys(f.requests[0].body).sort(),['action','inviteCode','name','operationId','operationSecret','password'].sort());
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
