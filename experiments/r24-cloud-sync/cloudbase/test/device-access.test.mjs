import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {createDeviceAccess} from '../device-access.mjs';
import {createDeviceGrantStore} from '../device-grants-store.mjs';

const origin = 'https://test-r24.example';
const stamp = Date.parse('2026-11-24T12:00:00Z');
const code = 'R24-' + 'a'.repeat(24);
const token = 'r24d_' + '1'.repeat(64);
const alternateToken = 'r24d_' + '2'.repeat(64);
const digest = data => createHash('sha256').update(data).digest('hex');

function fixture(overrides = {}) {
  let currentTime = stamp;
  const account = {_id: 'uid-anchor', role: 'anchor', teamId: 'pilot', displayName: '主播 É', active: true};
  const grant = {
    code_digest: digest(code), enrollment_id: account._id, activation_expires_at: new Date(stamp + 60_000).toISOString(),
    used_at: null, device_digest: null, device_expires_at: null, revoked_at: null, ...overrides,
  };
  const fakePostgrest = {
    from(table) {
      assert.equal(table, 'tcl_r24_sync_v1_device_grants');
      function query(updates) {
        const filters = [];
        let fields;
        return {
          eq(column, value) { filters.push(() => grant[column] === value); return this; },
          is(column, value) { filters.push(() => grant[column] === value); return this; },
          gt(column, value) { filters.push(() => grant[column] > value); return this; },
          limit() { return this; },
          select(value) { fields = value.split(','); return this; },
          then(resolve, reject) {
            return Promise.resolve().then(() => {
              if (!filters.every(test => test())) return {data: []};
              if (updates) Object.assign(grant, updates);
              return {data: [Object.fromEntries(fields.map(key => [key, grant[key]]))]};
            }).then(resolve, reject);
          },
        };
      }
      return {
        select: fields => query().select(fields),
        update: values => query(values),
      };
    },
  };
  const deviceAccess = createDeviceAccess({
    grants: createDeviceGrantStore(fakePostgrest, 'tcl_r24_sync_v1'),
    getEnrollment: async id => id === account._id ? account : null,
    authenticateNative: async value => value === 'native-user-token' ? account : null,
    allowedOrigins: [origin],
    now: () => currentTime,
  });
  async function activate(body = {}, requestOrigin = origin) {
    return deviceAccess.activationHandler(new Request(origin + '/device/activate', {
      method: 'POST',
      headers: {origin: requestOrigin, 'Content-Type': 'application/json'},
      body: JSON.stringify({displayName: '主播 É', code, deviceToken: token, ...body}),
    }), () => assert.fail('unexpected fallthrough'));
  }
  return {activate, account, grant, deviceAccess, advance: ms => { currentTime += ms; }};
}

test('exact registered normalized name and one-time code activate SHA-only device proof', async () => {
  const {activate, grant, deviceAccess} = fixture();
  const result = await activate({displayName: ' 主播 E\u0301 '});
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {principal: {id: 'uid-anchor', role: 'anchor', displayName: '主播 É'}});
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(grant.device_digest, digest(token));
  assert.equal(grant.code_digest, digest(code));
  assert.equal(Date.parse(grant.device_expires_at) - Date.parse(grant.used_at), 90 * 24 * 60 * 60 * 1000);
  assert.equal((await deviceAccess.authenticate(token)).role, 'anchor');
  assert.equal(await deviceAccess.authenticate(alternateToken), null);
  assert.equal((await deviceAccess.authenticate('native-user-token')).role, 'anchor');
});

test('wrong display name, code, identity or origin never consumes grant', async () => {
  const {activate, account, grant} = fixture();
  assert.equal((await activate({displayName: '别人的名字'})).status, 401);
  assert.equal((await activate({code: 'R24-' + 'd'.repeat(24)})).status, 401);
  assert.equal((await activate({deviceToken: token + '\n'})).status, 401);
  assert.equal((await activate({}, 'https://wrong-origin.test')).status, 403);
  account._id = 'different-verified-id';
  assert.equal((await activate()).status, 401);
  assert.equal(grant.used_at, null);
});

test('same token retries safely, including after activation code expiry', async () => {
  const {activate, grant, advance} = fixture();
  const first = await activate();
  assert.equal(first.status, 200);
  const originalUse = grant.used_at;
  advance(120_000);
  assert.equal((await activate()).status, 200);
  assert.equal(grant.used_at, originalUse);
  assert.equal((await activate({deviceToken: alternateToken})).status, 401);
});

test('two devices racing a code bind only one token', async () => {
  const {activate, grant, deviceAccess} = fixture();
  const result = await Promise.all([activate(), activate({deviceToken: alternateToken})]);
  assert.deepEqual(result.map(response => response.status).sort(), [200, 401]);
  const accepted = await Promise.all([deviceAccess.authenticate(token), deviceAccess.authenticate(alternateToken)]);
  assert.equal(accepted.filter(Boolean).length, 1);
  assert([digest(token), digest(alternateToken)].includes(grant.device_digest));
});

test('expired and revoked grants do not activate, and active bindings honor expiry and current enrollment', async () => {
  const expiredCode = fixture({activation_expires_at: new Date(stamp).toISOString()});
  assert.equal((await expiredCode.activate()).status, 401);
  const revokedCode = fixture({revoked_at: new Date(stamp).toISOString()});
  assert.equal((await revokedCode.activate()).status, 401);
  const active = fixture();
  assert.equal((await active.activate()).status, 200);
  active.account.active = false;
  assert.equal(await active.deviceAccess.authenticate(token), null);
  assert.equal((await active.activate()).status, 401);
  active.account.active = true;
  active.grant.revoked_at = new Date(stamp).toISOString();
  assert.equal(await active.deviceAccess.authenticate(token), null);
  active.grant.revoked_at = null;
  active.advance(90 * 24 * 60 * 60 * 1000);
  assert.equal(await active.deviceAccess.authenticate(token), null);
  assert.equal((await active.activate()).status, 401);
});

test('database reports unique device collision as no claim and refuses other write errors', async () => {
  const store = code => createDeviceGrantStore({
    from: () => ({update: () => {
      const query = {eq: () => query, is: () => query, gt: () => query, select: async () => ({error: {code}})};
      return query;
    }}),
  }, 'tcl_r24_sync_v1');
  assert.equal(await store('23505').claim({}), null);
  await assert.rejects(store('42501').claim({}), /grant claim failed/);
});
