import assert from 'node:assert/strict';
import test from 'node:test';
import {createCloudBaseAudio} from '../cloudbase-audio.mjs';

const path = `submissions/${'a'.repeat(64)}/${'b'.repeat(64)}.wav`;
const mimeType = 'audio/wav';
const bytes = Buffer.from('RIFF0000WAVE synthetic');
const env = 'synthetic-env';
const storageBase = `https://${env}.api.tcloudbasegateway.com/v1/storages/object`;
const bucket = 'tcl-r24-sync-v2-audio';

test('CloudBase audio sends raw bytes and uses runtime credentials on private upload and playback', async () => {
  const credentials = [{access_token: 'synthetic-write'}, 'synthetic-read'];
  const requests = [];
  const cloudApp = {
    auth: () => ({getClientCredential: async () => credentials.shift()}),
  };
  const fetchStub = async (url, options) => {
    const headers = new Headers(options.headers);
    requests.push([options.method, url, headers.get('authorization')]);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    if (options.method === 'POST') {
      assert.equal(headers.get('content-type'), mimeType);
      assert.equal(headers.get('content-length'), String(bytes.length));
      assert.equal(headers.get('cache-control'), 'max-age=0');
      assert.equal(headers.has('x-upsert'), false);
      assert.deepEqual(options.body, bytes);
      return Response.json({Id: 'synthetic-object', Key: `${bucket}/${path}`}, {status: 201});
    }
    assert.equal(headers.get('cache-control'), 'no-store');
    assert.equal(options.body, undefined);
    return new Response(bytes, {headers: {'Content-Type': mimeType}});
  };

  const audio = createCloudBaseAudio(cloudApp, env, fetchStub, {});
  assert.equal(await audio.put(path, mimeType, bytes), undefined);
  assert.deepEqual(await audio.get(path), bytes);
  assert.deepEqual(requests, [
    ['POST', `${storageBase}/${bucket}/${path}`, 'Bearer synthetic-write'],
    ['GET', `${storageBase}/authenticated/${bucket}/${path}`, 'Bearer synthetic-read'],
  ]);
});

test('CloudBase audio rejects invalid paths and missing credentials before opening storage', async () => {
  const cloudApp = {
    auth: () => ({getClientCredential: async () => ({access_token: 'synthetic invalid'})}),
  };

  assert.throws(() => createCloudBaseAudio(cloudApp, 'unsafe.test'), /Invalid CloudBase storage environment/);
  const audio = createCloudBaseAudio(cloudApp, env, () => assert.fail('invalid request must not open storage'), {});
  await assert.rejects(audio.get('different-bucket/recording.wav'), {message: 'Invalid pilot audio object path'});
  await assert.rejects(audio.put(path, mimeType, Buffer.alloc(524_289)), {message: 'Invalid pilot audio size'});
  await assert.rejects(audio.get(path), {storageOperation: 'credential-response'});
});

test('CloudBase audio accepts insert-only replay and bounds downloaded data without Content-Length', async () => {
  const cloudApp = {auth: () => ({getClientCredential: async () => 'synthetic-token'})};
  const responses = [
    Response.json({error: 'Duplicate'}, {status: 409}),
    new Response(Buffer.alloc(524_289)),
  ];
  const audio = createCloudBaseAudio(cloudApp, env, async () => responses.shift(), {});
  await audio.put(path, mimeType, bytes);
  await assert.rejects(audio.get(path), {message: 'Invalid CloudBase audio response size'});
});

test('CloudBase audio exchanges a trusted SCF session for a service token at the fixed gateway', async () => {
  const runtime = {
    TENCENTCLOUD_SECRETID: 'synthetic-iam-id',
    TENCENTCLOUD_SECRETKEY: 'synthetic-iam-key',
    TENCENTCLOUD_SESSIONTOKEN: 'synthetic-session-token',
  };
  const cloudApp = {
    getCloudbaseContext: () => runtime,
    auth: () => assert.fail('public SDK wrapper should not be called with a temporary IAM session'),
  };
  let exchanges = 0;
  const audio = createCloudBaseAudio(cloudApp, env, async (url, options) => {
    const headers = new Headers(options.headers);
    const host = `${env}.api.tcloudbasegateway.com`;
    if (url === `https://${host}/auth/v1/token/clientCredential`) {
      exchanges++;
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(headers.get('host'), host);
      assert.deepEqual(JSON.parse(options.body), {grant_type: 'client_credentials'});
      assert.match(headers.get('authorization'), /^TC3-HMAC-SHA256 Credential=synthetic-iam-id\/.*\/tcb\/tc3_request, SignedHeaders=content-type;host, Signature=[0-9a-f]{64}, Timestamp=[0-9]+, Token=synthetic-session-token$/);
      return Response.json({access_token: 'synthetic-service-token'});
    }
    assert.equal(url, `${storageBase}/authenticated/${bucket}/${path}`);
    assert.equal(headers.get('authorization'), 'Bearer synthetic-service-token');
    assert.equal(headers.has('host'), false);
    return new Response(bytes);
  }, {});
  assert.deepEqual(await audio.get(path), bytes);
  assert.equal(exchanges, 1);
});

test('when SCF credentials are unavailable, storage can reuse the Node SDK RDB exchange', async () => {
  const cloudApp = {
    request: {reqClass: {async getClientCredential({origin}) {
      assert.equal(origin, `https://${env}.api.tcloudbasegateway.com`);
      return 'synthetic-rdb-service-token';
    }}},
    auth: () => assert.fail('public SDK wrapper should not be called after successful RDB exchange'),
  };
  const audio = createCloudBaseAudio(cloudApp, env, async (url, options) => {
    assert.equal(url, `${storageBase}/authenticated/${bucket}/${path}`);
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer synthetic-rdb-service-token');
    return new Response(bytes);
  }, {});
  assert.deepEqual(await audio.get(path), bytes);
});
