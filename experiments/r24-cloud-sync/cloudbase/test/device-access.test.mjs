import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {createDeviceAccess, normalizeEnrollmentName} from '../device-access.mjs';
import {createDeviceGrantStore} from '../device-grants-store.mjs';
import {createGatewayHandler} from '../gateway.mjs';

const origin = 'https://test-r24.example';
const timestamp = Date.parse('2026-11-24T12:00:00Z');
const expiry = new Date(timestamp + 30 * 60_000).toISOString();
const account = {_id:'uid-anchor', role:'anchor', teamId:'r24-pilot', displayName:'主播 É', active:true};
const code = 'R24-' + 'a'.repeat(24);
const token = 'r24d_' + '1'.repeat(64);
const other = 'r24d_' + '2'.repeat(64);
const digest = data => createHash('sha256').update(data).digest('hex');
const match = {id:account._id, name:account.displayName, role:account.role, deviceId:'device-1'};

function fixture(handlers = {}, row = account) {
  const calls = [];
  const db = {
    async rpc(name, params) {
      const action = name.replace(/^tcl_r24_sync_v1_/, '');
      calls.push({action, params});
      if (handlers[action]) return handlers[action](params);
      if (action === 'count_device_attempt') return {data:{allowed:true, retryAfter:60}};
      assert.fail('Unexpected RPC ' + action);
    },
    from() {
      const chain = {
        select: () => chain,
        eq(key, value) {
          assert.equal(key, 'device_digest');
          return {limit: async () => ({
            data: value === digest(token)
              ? [{enrollment_id:account._id, used_at:expiry, device_digest:value, device_expires_at:expiry}]
              : [],
          })};
        },
      };
      return chain;
    },
  };
  const access = createDeviceAccess({
    grants: createDeviceGrantStore(db,'tcl_r24_sync_v1'),
    getEnrollment: async id => id === row?._id ? row : null,
    authenticateNative: async value => value === 'native-user-token' ? row : null,
    allowedOrigins: [origin],
    now: () => timestamp,
  });
  const fallback = () => new Response(null,{status:204});
  const run = (path, value, {bearer, requestOrigin = origin, clientIp, method = 'POST'} = {}) => {
    const headers = {origin:requestOrigin,'content-type':'application/json'};
    if (bearer) headers.authorization = 'Bearer ' + bearer;
    return access.handleDeviceRequest(new Request(origin + path,{
      method, headers, body: method === 'POST' ? JSON.stringify(value) : undefined,
    }),fallback,{clientIp});
  };
  return {access, calls, run};
}

test('name validation normalizes NFKC, rejects controls, and counts Unicode points', () => {
  assert.equal(normalizeEnrollmentName('　主播 ＡＥ\u0301　'), '主播 AÉ');
  assert.equal(normalizeEnrollmentName('𠀀'.repeat(30)), '𠀀'.repeat(30));
  for (const value of ['一', ' ', '𠀀'.repeat(31), ' \\t主播', '\u200b主播', '主播\ud800']) {
    const actual = value.replace('\\t', '\t');
    assert.equal(normalizeEnrollmentName(actual),'');
  }
});

test('auto enrollment persists only the credential digest and returns explicit role and device identity', async () => {
  const {run, calls} = fixture({
    auto_enroll_device: p => {
      assert.equal(p.p_name, '主播 É');
      assert.equal(p.p_role, 'anchor');
      assert.equal(p.p_device_digest, digest(token));
      assert.match(p.p_internal_digest, /^[a-f0-9]{64}$/);
      return {data:{...match, status:'enrolled'}};
    },
  });
  const response = await run('/device/auto-enroll', {
    name:' 主播 Ｅ\u0301 ', role:'anchor', deviceCredential:token,
  }, {clientIp:'192.0.2.1'});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{
    status:'enrolled',name:'主播 É',role:'anchor',deviceId:'device-1',
    principal:{id:account._id, displayName:'主播 É', role:'anchor'},
  });
  assert.deepEqual(calls.map(row=>row.action),['count_device_attempt','auto_enroll_device']);
  assert.equal(calls[0].params.p_shared,false);
  assert.equal(JSON.stringify(calls).includes(token),false);
});

test('existing enrolled identity supplies only registered role and rejects unauthenticated role escalation', async () => {
  const {run,calls} = fixture({auto_enroll_device:()=>({data:{status:'exists',registeredRole:'anchor'}})});
  const rejected = await run('/device/auto-enroll',{name:'主播 É',role:'operator',deviceCredential:other});
  assert.equal(rejected.status,409);
  const data=await rejected.json();
  assert.equal(data.errorCode,'ALREADY_ENROLLED');
  assert.equal(data.registeredRole,'anchor');
  assert.equal(data.principal,undefined);
  assert.equal(calls[0].params.p_shared,true);
  assert.equal((await run('/device/auto-enroll',{name:'主播 É',role:'admin',deviceCredential:other})).status,400);
  assert.equal((await run('/device/auto-enroll',{name:'主播 É',role:'anchor',deviceCredential:token+'\n'})).status,400);
  assert.equal(calls.filter(x=>x.action==='auto_enroll_device').length,1);
});

test('activation accepts current and legacy payload field names and reports distinguishable errors', async () => {
  const {run,calls} = fixture({activate_device:p=>{
    assert.equal(p.p_name,'主播 É');
    assert.match(p.p_code_digest,/^[0-9a-f]{64}$/);
    if (p.p_role==='operator') return {data:{errorCode:'CODE_MISMATCH',registeredRole:'anchor'}};
    if (p.p_device_digest===digest(other)) return {data:{errorCode:'CODE_USED'}};
    if (p.p_code_digest!==digest(code)) return {data:{errorCode:'CODE_EXPIRED'}};
    return {data:match};
  }});
  const legacy = {displayName:' 主播 E\u0301 ',code,deviceToken:token};
  assert.equal((await run('/device/activate',legacy)).status,200);
  const modern = {name:' 主播 É ',role:'anchor',code,deviceCredential:token};
  assert.equal((await run('/device/activate',modern)).status,200);
  for (const [changed, status, errorCode] of [
    [{role:'operator'},401,'CODE_MISMATCH'],
    [{deviceCredential:other},409,'CODE_USED'],
    [{code:'R24-'+'d'.repeat(24)},401,'CODE_EXPIRED'],
    [{code:'invalid'},401,'CODE_MISMATCH'],
  ]) {
    const response = await run('/device/activate',{...modern,...changed});
    assert.equal(response.status,status);
    const body = await response.json();
    assert.equal(body.errorCode,errorCode);
    assert.equal(body.error.code,errorCode);
    if (changed.role) assert.equal(body.registeredRole,'anchor');
  }
  assert.equal(calls.filter(x=>x.action==='activate_device').length,5);
  assert.equal(JSON.stringify(calls).includes(token),false);
});

test('gateway metadata drives the rate bucket; headers alone never establish a caller IP', async () => {
  const {access,calls} = fixture({count_device_attempt:()=>({data:{allowed:false,retryAfter:45}})});
  const handler = createGatewayHandler((request,context)=>
    access.handleDeviceRequest(request,()=>assert.fail('unexpected fallback'),context));
  const event = {
    path:'/device/auto-enroll', httpMethod:'POST',
    headers:{'Content-Type':'application/json',origin,'x-forwarded-for':'198.51.100.1'},
    body:JSON.stringify({name:'试点用户',role:'anchor',deviceCredential:token}),
  };
  const shared = await handler(event);
  assert.equal(shared.statusCode,429);
  assert.equal(shared.headers['retry-after'],'45');
  assert.equal(JSON.parse(shared.body).errorCode,'RATE_LIMITED');
  assert.equal(calls[0].params.p_shared,true);
  await handler({...event,requestContext:{identity:{sourceIp:'2001:0db8::1'}}});
  await handler({...event,requestContext:{identity:{sourceIp:'2001:db8::1'}}});
  assert.equal(calls[1].params.p_shared,false);
  assert.equal(calls[1].params.p_client_key,calls[2].params.p_client_key);
  assert.notEqual(calls[0].params.p_client_key,calls[1].params.p_client_key);
  assert.equal(calls.every(call=>call.action==='count_device_attempt'),true);
});

test('device authentication checks current enrollment; existing native tokens stay compatible', async () => {
  const row = {...account};
  const {access} = fixture({},row);
  assert.equal((await access.authenticate(token)).role,'anchor');
  assert.equal(await access.authenticate(other),null);
  assert.equal((await access.authenticate('native-user-token')).role,'anchor');
  row.active = false;
  assert.equal(await access.authenticate(token),null);
});

test('only registered device bearers issue private 28-character codes', async () => {
  const {run,calls} = fixture({
    issue_device_code: p => ({data:p.p_issuer_device_digest===digest(token)
      ? {expiresAt:expiry,name:'主播 É',role:'anchor'} : {expiresAt:null}}),
  });
  assert.equal((await run('/device/code',{})).status,401);
  assert.equal((await run('/device/code',{role:'operator'},{bearer:token})).status,400);
  assert.equal((await run('/device/code',{},{bearer:token,requestOrigin:'https://wrong.example'})).status,403);
  assert.equal((await run('/device/code',{},{bearer:'native-user-token'})).status,401);
  assert.equal(calls.length,0);
  assert.equal((await run('/device/code',{},{bearer:other})).status,401);
  const response = await run('/device/code',{},{bearer:token});
  const issued = await response.json();
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'),origin);
  assert.match(issued.code,/^R24-[0-9a-f]{24}$/);
  assert.equal(issued.expiresAt,expiry);
  assert.equal(issued.name,'主播 É');
  assert.equal(issued.role,'anchor');
  assert.deepEqual(calls[1].params,{p_issuer_device_digest:digest(token),p_code_digest:digest(issued.code)});
  assert.equal(JSON.stringify(calls).includes(issued.code),false);
});
