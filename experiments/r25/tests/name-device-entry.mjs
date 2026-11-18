// Focused synthetic regression checks. No CloudBase/Auth/PG calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createNameIdentityClient} from '../tcl-v352-asr-r25-qa/name-identity.mjs';
import {createCloudWorkflow} from '../tcl-v352-asr-r25-qa/cloud-workflow.mjs';

const ENV = 'test-device-env';
const NAME = '设备测试运营';
const NATIVE = 'r25n_device_user';
const UID = 'device-native-123';
const ready = (role = 'operator') => ({state:'ready', username:NATIVE, uid:UID, role});
const notFound = () => ({ok:false,error:{code:'NOT_FOUND',message:'synthetic missing'}});
const keyFor = name => `r25-name-join:${encodeURIComponent(ENV)}:${createHash('sha256').update(name.toLowerCase()).digest('hex')}`;
const clone = value => value === undefined ? undefined : structuredClone(value);
const deviceCode = overrides => 'R25DEVICE1.' + Buffer.from(JSON.stringify({
  version:1, envId:ENV, name:NAME, role:'operator', uid:UID, username:NATIVE,
  deviceKey:'a'.repeat(64), ...overrides
})).toString('base64url');
function deferred() {let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no;}); return {promise,resolve,reject};}

function identityFixture(handler) {
  const rows = new Map(), requests = [], writes = [], events = [];
  const storage = {
    async get(key) {return clone(rows.get(key));},
    async reserve(key,value) {
      const existing=rows.has(key);
      if(!existing) {rows.set(key,clone(value));writes.push(clone(value));events.push('reserve');}
      return {value:clone(rows.get(key)),existing};
    },
    async save(key,value,expected) {
      const current=rows.get(key);
      const same=current && current.operationId===expected?.operationId &&
        current.operationSecret===expected?.operationSecret && current.deviceKey===expected?.deviceKey;
      if(expected===null ? current!==undefined : !same) return false;
      rows.set(key,clone(value));writes.push(clone(value));events.push('save');return true;
    }
  };
  const client=createNameIdentityClient({envId:ENV,config:{enabled:true,endpoint:'https://identity.invalid/name'},storage,
    fetchImpl:async(_url,options)=>{
      const body=JSON.parse(options.body);requests.push(body);events.push('http:'+body.action);
      const response=await handler(body,{rows,writes,events,requests});
      return {ok:response.ok,json:async()=>response};
    }
  });
  return {client,rows,requests,writes,events,storage};
}
function workflowFixture(identity,{sessionUid=UID,profile,me,signIn}={}) {
  let currentUid=null;
  const auth=[],rpc=[],accepted=[];
  const workflow=createCloudWorkflow({config:{enabled:true,envId:ENV,functionName:'r25wf_api'},nameIdentity:identity,
    sdkFactory:async()=>({__r25Auth:{
      async signIn(username,password) {auth.push({action:'signIn',username,password});if(signIn)await signIn();currentUid=sessionUid;},
      async getSession() {auth.push({action:'getSession'});return currentUid?{uid:currentUid}:null;},
      async signOut() {auth.push({action:'signOut'});currentUid=null;}
    }}),
    operationStoreFactory:()=>({close:async()=>{}}),
    onIdentityChange:async user=>accepted.push(clone(user)),
    businessTransport:async event=>{
      rpc.push(event);
      if(me)return me(event);
      return {ok:true,data:{registered:true,user:profile||{uid:currentUid,role:'operator',displayName:NAME,active:true}}};
    }
  });
  return {workflow,auth,rpc,accepted,get sessionUid(){return currentUid;}};
}

test('name-only enrollment stores random device key before registration, without persisting password or transmitting key',async()=>{
  let wirePassword;
  const f=identityFixture(async(body,{rows,writes})=>{
    if(body.action==='resolve')return notFound();
    assert.equal(body.action,'register');
    const row=rows.get(keyFor(NAME));
    assert.match(row.deviceKey,/^[a-f0-9]{64}$/);
    assert.ok(writes.length>0,'device key was committed before network creation');
    assert.equal('deviceKey'in body,false);
    assert.equal(JSON.stringify(body).includes(row.deviceKey),false);
    assert.match(body.password,/^Aa1![a-f0-9]{28}$/);
    assert.notEqual(row.deviceKey,row.operationSecret);
    wirePassword=body.password;
    return {ok:true,data:ready()};
  });
  const result=await f.client.enterWithName({name:NAME,role:'operator'});
  assert.equal(result.password,wirePassword);
  assert.equal(result.uid,UID);assert.equal(result.role,'operator');
  assert.equal(f.rows.get(keyFor(NAME)).state,'ready');
  assert.equal(JSON.stringify(f.writes).includes(wirePassword),false);
  for(const value of f.writes)assert.equal('password'in value,false);
  assert.deepEqual(f.requests.map(row=>row.action),['resolve','register']);
});

test('another browser cannot claim an existing or pending name or obtain a native credential',async()=>{
  for(const response of [{ok:true,data:ready()},{ok:false,error:{code:'NAME_PENDING',message:'synthetic pending'}}]){
    const f=identityFixture(async()=>response);
    await assert.rejects(f.client.enterWithName({name:NAME}),error=>error.code==='DEVICE_VERIFICATION_REQUIRED');
    assert.equal(f.rows.size,0);assert.equal(f.writes.length,0);
    assert.deepEqual(f.requests,[{action:'resolve',name:NAME}]);
  }
});

test('same-device re-entry restores the exact original native UID, credential and server role',async()=>{
  const f=identityFixture(async body=>body.action==='resolve'?notFound():{ok:true,data:ready()});
  const first=await f.client.enterWithName({name:NAME,role:'operator'});
  const firstRecord=clone(f.rows.get(keyFor(NAME))),requestCount=f.requests.length;
  const second=await f.client.enterWithName({name:NAME,role:'anchor'});
  assert.equal(second.password,first.password);assert.equal(second.uid,first.uid);
  assert.equal(second.role,'operator');assert.equal(second.username,NATIVE);
  assert.equal(f.requests.length,requestCount,'remembered device needs no public resolve/create');
  assert.deepEqual(f.rows.get(keyFor(NAME)),firstRecord);
  const w=workflowFixture(f.client);
  await w.workflow.enterWithName({name:NAME,role:'anchor'});
  assert.equal(w.workflow.user.uid,UID);assert.equal(w.workflow.user.role,'operator');
  assert.equal(w.workflow.getState().deviceCredential,true);
  assert.equal(w.auth.find(row=>row.action==='signIn').password,first.password);
  assert.equal(w.rpc[0].payload.expectedActorUid,UID);
});

test('lost successful registration response resumes the original operation and random credential',async()=>{
  let original;
  const f=identityFixture(async body=>{
    if(body.action==='resolve')return notFound();
    if(body.action==='register'){original=clone(body);throw Error('synthetic lost commit response');}
    assert.equal(body.action,'status');
    assert.equal(body.operationId,original.operationId);assert.equal(body.operationSecret,original.operationSecret);
    assert.equal('password'in body,false);
    return {ok:true,data:ready()};
  });
  await assert.rejects(f.client.enterWithName({name:NAME,role:'operator'}),e=>e.code==='IDENTITY_NETWORK');
  const key=f.rows.get(keyFor(NAME)).deviceKey;
  const resumed=await f.client.enterWithName({name:NAME,role:'anchor'});
  assert.equal(resumed.password,original.password);assert.equal(resumed.uid,UID);assert.equal(resumed.role,'operator');
  assert.equal(f.rows.get(keyFor(NAME)).deviceKey,key);
  assert.deepEqual(f.requests.map(row=>row.action),['resolve','register','status']);
});

test('a request that never reached the server retries with the same operation and device credential',async()=>{
  const registrations=[];
  const f=identityFixture(async body=>{
    if(['resolve','status'].includes(body.action))return notFound();
    registrations.push(clone(body));
    if(registrations.length===1)throw Error('synthetic offline before create');
    return {ok:true,data:ready()};
  });
  await assert.rejects(f.client.enterWithName({name:NAME,role:'operator'}));
  const firstKey=f.rows.get(keyFor(NAME)).deviceKey;
  await f.client.enterWithName({name:NAME,role:'operator'});
  assert.equal(registrations.length,2);
  assert.equal(registrations[0].password,registrations[1].password);
  assert.equal(registrations[0].operationId,registrations[1].operationId);
  assert.equal(registrations[0].operationSecret,registrations[1].operationSecret);
  assert.equal(f.rows.get(keyFor(NAME)).deviceKey,firstKey);
});

test('legacy local password accounts cannot be silently recast into device credentials',async()=>{
  const f=identityFixture(async()=>{throw Error('network must not run');});
  const original={name:NAME,role:'operator',state:'ready',uid:UID,username:NATIVE,operationId:'old-operation',operationSecret:'b'.repeat(64)};
  f.rows.set(keyFor(NAME),clone(original));
  await assert.rejects(f.client.enterWithName({name:NAME}),e=>e.code==='DEVICE_VERIFICATION_REQUIRED');
  assert.equal(f.requests.length,0);assert.deepEqual(f.rows.get(keyFor(NAME)),original);
});

test('admin cannot enroll, bind, or authenticate through the name-only path',async()=>{
  const f=identityFixture(async()=>notFound());
  await assert.rejects(f.client.enterWithName({name:NAME,role:'admin'}),e=>e.code==='INVALID_ROLE');
  assert.equal(f.requests.filter(row=>row.action==='register').length,0);assert.equal(f.rows.size,0);
  const w=workflowFixture({enterWithName:async()=>({username:NATIVE,uid:UID,role:'admin',password:'Synthetic123!'})});
  await assert.rejects(w.workflow.enterWithName({name:NAME}),e=>e.code==='IDENTITY_MISMATCH');
  assert.equal(w.auth.length,0);assert.equal(w.workflow.user,null);
  const valid=identityFixture(async()=>{throw Error('identity network must not run');});
  const binding=workflowFixture(valid.client);
  await assert.rejects(binding.workflow.bindDevice(deviceCode({role:'admin'})),e=>e.code==='INVALID_DEVICE_CODE');
  assert.equal(binding.auth.length,0);assert.equal(valid.writes.length,0);
});

test('invalid device codes fail before native SDK, identity network or local writes',async()=>{
  const invalid=['', 'not-a-code', 'R25DEVICE1.%%%%', 'R25DEVICE1.'+'a'.repeat(4096),
    deviceCode({envId:'other-env'}),deviceCode({version:2}),deviceCode({deviceKey:'short'}),
    deviceCode({uid:''}),deviceCode({name:' '+NAME}),deviceCode({unexpected:true})];
  for(const code of invalid){
    const f=identityFixture(async()=>{throw Error('network must not run');}),w=workflowFixture(f.client);
    await assert.rejects(w.workflow.bindDevice(code),e=>e.code==='INVALID_DEVICE_CODE');
    assert.equal(f.requests.length,0);assert.equal(w.auth.length,0);assert.equal(w.rpc.length,0);assert.equal(f.writes.length,0);
  }
});

test('device binding saves only after official SDK UID, server role and name have been verified',async()=>{
  const f=identityFixture(async()=>{throw Error('public name broker must not run');});
  let sessionChecked=false,profileChecked=false;
  const w=workflowFixture(f.client,{signIn:async()=>{assert.equal(f.rows.size,0);},me:async event=>{
    assert.equal(event.action,'me');assert.equal(event.payload.expectedActorUid,UID);
    assert.equal(f.rows.size,0,'no binding saved before authoritative profile');
    profileChecked=true;
    return {ok:true,data:{registered:true,user:{uid:UID,role:'operator',displayName:NAME,active:true}}};
  }});
  const rawSave=f.storage.save;
  f.storage.save=async(...args)=>{
    sessionChecked=w.auth.some(row=>row.action==='getSession');
    assert.equal(sessionChecked,true);assert.equal(profileChecked,true);
    return rawSave(...args);
  };
  await w.workflow.bindDevice(deviceCode());
  const row=f.rows.get(keyFor(NAME));
  assert.equal(row.uid,UID);assert.equal(row.role,'operator');assert.equal(row.deviceKey,'a'.repeat(64));
  assert.equal(row.state,'ready');assert.equal('password'in row,false);
  assert.equal(w.workflow.user.uid,UID);assert.equal(w.workflow.user.displayName,NAME);
  assert.equal(f.requests.length,0);
});

test('mismatched native UID, business UID, role, name or disabled profile never stores a device binding',async()=>{
  const cases=[
    {sessionUid:'other-native-uid'},
    {profile:{uid:'other-business-uid',role:'operator',displayName:NAME,active:true}},
    {profile:{uid:UID,role:'anchor',displayName:NAME,active:true}},
    {profile:{uid:UID,role:'operator',displayName:'其他姓名',active:true}},
    {profile:{uid:UID,role:'operator',displayName:NAME,active:false}},
    {profile:{uid:UID,role:'admin',displayName:NAME,active:true}}
  ];
  for(const overrides of cases){
    const f=identityFixture(async()=>{throw Error('name broker must not run');}),w=workflowFixture(f.client,overrides);
    await assert.rejects(w.workflow.bindDevice(deviceCode()),e=>['IDENTITY_MISMATCH','ACCOUNT_DISABLED'].includes(e.code));
    assert.equal(f.writes.length,0);assert.equal(f.rows.size,0);assert.equal(w.workflow.user,null);
    assert.equal(w.accepted.filter(Boolean).length,0,'failed binding must not expose an accepted profile');
  }
});

test('delayed device binding cannot overwrite a newer locally verified device key',async()=>{
  const f=identityFixture(async()=>{throw Error('name broker must not run');});
  const original={name:NAME,role:'operator',state:'ready',uid:UID,username:NATIVE,deviceKey:'b'.repeat(64)};
  f.rows.set(keyFor(NAME),clone(original));
  const started=deferred(),finish=deferred();
  const w=workflowFixture(f.client,{me:async()=>{
    started.resolve();await finish.promise;
    return {ok:true,data:{registered:true,user:{uid:UID,role:'operator',displayName:NAME,active:true}}};
  }});
  const binding=w.workflow.bindDevice(deviceCode());
  await started.promise;
  const newer={...original,deviceKey:'c'.repeat(64)};f.rows.set(keyFor(NAME),clone(newer));
  finish.resolve();
  await assert.rejects(binding,e=>e.code==='REGISTRATION_STORAGE_CHANGED');
  assert.deepEqual(f.rows.get(keyFor(NAME)),newer);assert.equal(f.writes.length,0);
  assert.equal(w.workflow.user,null);assert.equal(w.sessionUid,null);
  assert.equal(w.auth.filter(row=>row.action==='signOut').length,1);
});

test('forgetting this browser clears only its device key and requires verification to return', async () => {
  const f = identityFixture(async body => body.action === 'resolve' ? notFound() : { ok: true, data: ready() });
  const w = workflowFixture(f.client);
  await w.workflow.enterWithName({ name: NAME, role: 'operator' });
  const original = f.rows.get(keyFor(NAME));
  await w.workflow.forgetDevice();
  await w.workflow.signOut();
  const { deviceKey, ...retained } = original;
  assert.deepEqual(f.rows.get(keyFor(NAME)), retained);
  const before = f.requests.length;
  await assert.rejects(w.workflow.enterWithName({ name: NAME }), error => error.code === 'DEVICE_VERIFICATION_REQUIRED');
  assert.equal(f.requests.length, before);
  assert.equal(w.workflow.user, null);
  assert.equal(w.sessionUid, null);
});
