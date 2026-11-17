import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudWorkflow, cloudPartitionName } from '../tcl-v352-asr-r25-qa/cloud-workflow.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(nameIdentity,onIdentityChange) {
  let currentUid = null, rpcOverride = null, privateMedia=false, uploadOverride=null, failConfirmedCache=false, sessionReadOverride, meOverride;
  const calls = [], authCalls = [], mediaCalls=[], partitions = new Map();
  const users = { anchor: { uid: 'anchor', displayName: '主播A', role: 'anchor' }, operator: { uid: 'operator', displayName: '运营O', role: 'operator' } };
  const officialAdapter = { __r25Media:{upload:async(path,blob,mime)=>{mediaCalls.push({path,size:blob.size,mime});if(uploadOverride)return uploadOverride(path,blob,mime);return {path};},download:async path=>new Blob(['media'],{type:'audio/webm'})}, __r25Auth: {
    getSession: async () => sessionReadOverride ? sessionReadOverride(currentUid) : currentUid ? { uid: currentUid } : null,
    signIn: async (username, password) => { authCalls.push(['signIn', username, password]); currentUid = username; },
    signOut: async () => { authCalls.push(['signOut']); currentUid = null; },
    changePassword: async (old, next) => { authCalls.push(['changePassword', old, next]); }
  } };
  const client = createCloudWorkflow({ config: { enabled: true, envId: 'test-env', functionName: 'r25wf_api' }, nameIdentity, onIdentityChange, sdkFactory: async () => officialAdapter,
    operationStoreFactory: ({ uid }) => {
      const rows = partitions.get(uid) || new Map(); partitions.set(uid, rows);
      return { get: async id => rows.get(id), put: async row => { if(failConfirmedCache&&row.status==='confirmed')throw new Error('quota');rows.set(row.id, structuredClone(row)); }, list: async () => [...rows.values()], close: async () => {} };
    },
    businessTransport: async event => {
      calls.push(structuredClone(event));
      if (event.action === 'me') return meOverride ? meOverride(event) : { ok: true, data: { user: users[currentUid], capabilities:{privateMedia} } };
      if (rpcOverride) return rpcOverride(event);
      return { ok: true, data: { items: [] } };
    }
  });
  return { client, calls, authCalls, partitions, mediaCalls,externalSession:uid=>{currentUid=uid;},setMe:fn=>{meOverride=fn;},setSessionReader:fn=>{sessionReadOverride=fn;}, setMediaEnabled:value=>{privateMedia=value;},setUpload:fn=>{uploadOverride=fn;},failConfirmedCache:()=>{failConfirmedCache=true;}, setRpc: fn => { rpcOverride = fn; }, setUser: (key, value) => { users[key] = value; } };
}

test('disabled config never initializes official auth or business transport', async () => {
  let used = false;
  const client = createCloudWorkflow({ config: { enabled: false }, sdkFactory: async () => { used = true; } });
  assert.equal((await client.initialize()).configured, false); assert.equal(used, false);
});
test('passwords go only to official adapter; role and uid are verified against session', async () => {
  const f = fixture(); await f.client.signIn('anchor', 'not-in-business-rpc');
  assert.equal(f.client.user.uid, 'anchor'); assert.equal(f.client.user.role, 'anchor');
  assert.equal(f.authCalls[0][2], 'not-in-business-rpc');
  assert.equal(JSON.stringify(f.calls).includes('not-in-business-rpc'), false);
  f.setUser('operator', { uid: 'forged', role: 'admin' });
  await assert.rejects(f.client.signIn('operator', 'password'), /身份未验证/); assert.equal(f.client.user, null);
});
test('unconfigured name registration never guesses native account creation or calls business RPC', async () => {
  const f = fixture(); await assert.rejects(f.client.register({ name: '新主播', password: 'Newpass123', inviteCode: 'invite' }), /正在准备/);
  assert.equal(f.authCalls.length, 0); assert.equal(f.calls.length, 0);
});
test('failed submission stays pending and retry reuses exact original payload and operation id', async () => {
  const f = fixture(); await f.client.signIn('anchor', 'password'); let attempts = 0;
  f.setRpc(async () => { if (++attempts === 1) throw new Error('response lost'); return { ok: true, data: { submission: { id: 's1', submittedAt: 'now' }, receiptId: 'receipt1' } }; });
  const original = { trainingId: 't1', snapshot: { answer: 'original' } };
  await assert.rejects(f.client.durableWrite('submissions.create', original, 't1'), /response lost/);
  assert.equal((await f.client.pendingOperations()).length, 1);
  await f.client.durableWrite('submissions.create', { trainingId: 't1', snapshot: { answer: 'changed' } }, 't1');
  const events = f.calls.filter(row => row.action === 'submissions.create');
  assert.equal(events.length, 2); assert.deepEqual(events[0], events[1]);
  assert.equal((await f.client.pendingOperations()).length, 0);
});
test('incomplete server receipt never marks pending submission confirmed', async () => {
  const f = fixture(); await f.client.signIn('anchor', 'password'); f.setRpc(async () => ({ ok: true, data: { submission: { id: 's1' } } }));
  await assert.rejects(f.client.durableWrite('submissions.create', { trainingId: 't' }, 't'), /回执/);
  assert.equal((await f.client.pendingOperations()).length, 1);
});
test('double click shares one in-flight durable request', async () => {
  const f = fixture(); await f.client.signIn('anchor', 'password'); const result = deferred(); f.setRpc(() => result.promise);
  const a = f.client.durableWrite('assignments.join', { assignmentId: 'a' }, 'a');
  const b = f.client.durableWrite('assignments.join', { assignmentId: 'a' }, 'a'); await tick();
  assert.equal(f.calls.filter(row => row.action === 'assignments.join').length, 1);
  result.resolve({ ok: true, data: { id: 'join1' } }); assert.deepEqual(await a, await b);
});
test('account switching prevents old responses from entering new identity and isolates outboxes', async () => {
  const f = fixture(); await f.client.signIn('anchor', 'password'); const response = deferred(); f.setRpc(() => response.promise);
  const old = f.client.call('submissions.list'); await tick(); await f.client.signOut(); await f.client.signIn('operator', 'password');
  response.resolve({ ok: true, data: { items: [{ privateAnswer: 'A only' }] } });
  await assert.rejects(old, /账号已切换/); assert.equal(f.client.user.uid, 'operator');
  assert.equal((await f.client.pendingOperations()).length, 0);
  assert.notEqual(cloudPartitionName('env', 'anchor'), cloudPartitionName('env', 'operator'));
});
test('password change uses official adapter only', async () => {
  const f = fixture(); await f.client.signIn('anchor', 'password'); await f.client.changePassword('old-secret', 'new-secret-long1');
  assert.equal(f.authCalls.some(row => row[0] === 'changePassword'), true);
  assert.equal(JSON.stringify(f.calls).includes('old-secret'), false); assert.equal(JSON.stringify(f.calls).includes('new-secret-long1'), false);
});
test('pagination must finish and never silently repeats a cursor', async () => {
  const f = fixture(); await f.client.signIn('anchor', 'password'); let calls = 0;
  f.setRpc(async () => ({ ok: true, data: ++calls === 1 ? { items: [1], nextCursor: 'next' } : { items: [2] } }));
  assert.deepEqual(await f.client.listAll('assignments.list'), [1, 2]);
  f.setRpc(async () => ({ ok: true, data: { items: [], nextCursor: 'loop' } }));
  await assert.rejects(f.client.listAll('assignments.list'), /游标重复/);
});
test('verified pending account can bind invitation but cannot read or write business data', async () => {
  const f = fixture(); f.setUser('new', { uid: 'new', displayName: '待邀请账号', role: 'pending' });
  await f.client.signIn('new', 'password'); assert.equal(f.client.user.role, 'pending');
  await assert.rejects(f.client.call('assignments.list'), /绑定管理员/);
  await assert.rejects(f.client.durableWrite('assignments.create', { title: 'cannot create' }, 'a'), /绑定管理员/);
  f.setRpc(async event => { assert.equal(event.action, 'invites.redeem'); f.setUser('new', { uid: 'new', displayName: '主播', role: 'anchor' }); return { ok: true, data: { accepted: true } }; });
  await f.client.redeemInvitation('invite-from-admin', '主播'); assert.equal(f.client.user.role, 'anchor');
});

test('private media remains disabled until backend capability and enforces file limits',async()=>{
 const f=fixture();await f.client.signIn('anchor','password');const blob=new Blob(['audio'],{type:'audio/webm;codecs=opus'});
 await assert.rejects(f.client.uploadMedia(blob),/尚未开放/);assert.equal(f.mediaCalls.length,0);
 f.setMediaEnabled(true);await f.client.initialize();const media=await f.client.uploadMedia(blob);
 assert.equal(media.mime,'audio/webm');assert.equal(media.size,5);assert.ok(media.path.startsWith('anchor/'));assert.equal(f.mediaCalls.length,1);
 await assert.rejects(f.client.uploadMedia(new Blob(['x'],{type:'text/html'})),/受支持/);
 const oversized=new Blob([new Uint8Array(50*1024*1024+1)],{type:'audio/webm'});await assert.rejects(f.client.uploadMedia(oversized),/50MiB/);assert.equal(f.mediaCalls.length,1);
});
test('late media upload result cannot attach after account logout',async()=>{
 const f=fixture();f.setMediaEnabled(true);await f.client.signIn('anchor','password');const pending=deferred();f.setUpload(()=>pending.promise);
 const task=f.client.uploadMedia(new Blob(['a'],{type:'audio/webm'}));await tick();await f.client.signOut();pending.resolve({path:'ignored'});await assert.rejects(task,/账号已切换/);
});
test('server-confirmed receipt remains confirmation when only local receipt cache fails',async()=>{
 const f=fixture();await f.client.signIn('anchor','password');f.failConfirmedCache();f.setRpc(async()=>({ok:true,data:{submission:{id:'s',submittedAt:'now'},receiptId:'r'}}));
 const result=await f.client.durableWrite('submissions.create',{id:'s'},'s');assert.equal(result.receiptId,'r');assert.match(result.clientWarning,/云端已确认/);assert.equal((await f.client.pendingOperations()).length,1);
});

test('native session switched in another tab prevents business request under stale UI identity',async()=>{
 const f=fixture();await f.client.signIn('anchor','password');f.externalSession('operator');
 await assert.rejects(f.client.call('submissions.list'),/会话已改变/);assert.equal(f.client.user,null);assert.equal(f.calls.filter(row=>row.action==='submissions.list').length,0);
});
test('native session changed while business read is in flight discards late private response',async()=>{
 const f=fixture();await f.client.signIn('anchor','password');const response=deferred();f.setRpc(()=>response.promise);
 const read=f.client.call('submissions.list');await tick();f.externalSession('operator');response.resolve({ok:true,data:{items:[{private:'old response'}]}});
 await assert.rejects(read,/会话已改变/);assert.equal(f.client.user,null);
});
test('native session changed before media request prevents upload under wrong token',async()=>{
 const f=fixture();f.setMediaEnabled(true);await f.client.signIn('anchor','password');f.externalSession('operator');
 await assert.rejects(f.client.uploadMedia(new Blob(['a'],{type:'audio/webm'})),/会话已改变/);assert.equal(f.mediaCalls.length,0);
});

test('name resolution keeps daily passwords in official Auth and retains existing UID partitions', async()=>{
 const resolveCalls=[];const f=fixture({resolve:async name=>{resolveCalls.push(name);return {username:'anchor',uid:'anchor'};}});
 await f.client.signIn('主播甲','old');assert.deepEqual(resolveCalls,['主播甲']);assert.equal(f.client.user.uid,'anchor');
 assert.deepEqual(f.authCalls[0],['signIn','anchor','old']);assert.equal(JSON.stringify(f.calls).includes('old'),false);
});
test('successful invitation registration requires official native session and matching backend role',async()=>{
 const registerCalls=[];const f=fixture({register:async value=>{registerCalls.push(value);return {username:'anchor',uid:'anchor',state:'ready'};}});
 await f.client.register({name:'主播甲',password:'Newpass123',inviteCode:'invite'});assert.equal(f.client.user.uid,'anchor');assert.equal(f.client.user.role,'anchor');
 assert.equal(registerCalls.length,1);assert.equal(f.authCalls[0][0],'signIn');assert.equal(f.authCalls[0][2],'Newpass123');
 assert.equal(JSON.stringify(f.calls).includes('Newpass123'),false);assert.equal(JSON.stringify(f.calls).includes('invite'),false);
});
test('broker success cannot install a mismatching native UID',async()=>{
 const f=fixture({register:async()=>({username:'anchor',uid:'someone-else',state:'ready'})});
 await assert.rejects(f.client.register({name:'主播甲',password:'Newpass123',inviteCode:'invite'}),error=>error.code==='IDENTITY_MISMATCH');
 assert.equal(f.client.user,null);assert.equal(f.calls.length,0);
});
test('duplicate name rejection never signs into or changes an existing account',async()=>{
 const f=fixture({register:async()=>{throw Object.assign(new Error('姓名已使用，请直接登录或加部门'),{code:'NAME_CONFLICT'});}});
 await assert.rejects(f.client.register({name:'重名主播',password:'Newpass123',inviteCode:'invite'}),error=>error.code==='NAME_CONFLICT');
 assert.equal(f.client.user,null);assert.equal(f.authCalls.length,0);assert.equal(f.calls.length,0);
});
test('native drift between resolved UID check and profile acceptance cannot install another name',async()=>{
 for(const action of ['signIn','register']){
  const f=fixture({resolve:async()=>({username:'anchor',uid:'anchor'}),register:async()=>({username:'anchor',uid:'anchor',state:'ready'})});let reads=0;
  f.setSessionReader(()=>({uid:++reads===1?'anchor':'operator'}));
  await assert.rejects(action==='signIn'?f.client.signIn('主播甲','old'):f.client.register({name:'主播甲',password:'Joinpass123',inviteCode:'invite'}),error=>error.code==='IDENTITY_MISMATCH');
  assert.equal(f.client.user,null);assert.equal(f.calls.length,0);
 }
});
test('native drift while me is pending never applies stale local identity',async()=>{
 const applied=[],f=fixture({resolve:async()=>({username:'anchor',uid:'anchor'})},async value=>applied.push(value?.uid||null)),reply=deferred();f.setMe(()=>reply.promise);
 const pending=f.client.signIn('主播甲','old');await tick();f.externalSession('operator');reply.resolve({ok:true,data:{user:{uid:'anchor',role:'anchor',displayName:'主播甲'}}});
 await assert.rejects(pending,error=>error.code==='STALE_SESSION');assert.equal(f.client.user,null);assert.equal(applied.includes('anchor'),false);
});
test('native drift during local partition callback is guarded and clears stale identity',async()=>{
 const started=deferred(),resume=deferred(),installed=[];let f;
 f=fixture({resolve:async()=>({username:'anchor',uid:'anchor'})},async(value,{isCurrent})=>{if(value){started.resolve();await resume.promise;if(!(await isCurrent()))throw Object.assign(new Error('stale partition'),{code:'STALE_SESSION'});installed.push(value.uid);}});
 const pending=f.client.signIn('主播甲','old');await started.promise;f.externalSession('operator');resume.resolve();
 await assert.rejects(pending,error=>error.code==='STALE_SESSION');assert.equal(f.client.user,null);assert.deepEqual(installed,[]);
});
