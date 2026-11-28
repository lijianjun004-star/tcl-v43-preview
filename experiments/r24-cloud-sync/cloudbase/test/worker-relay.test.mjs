import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPair, exportJWK, SignJWT} from 'jose';
import {createGitHubWorkerVerifier, oidcFailureReason} from '../worker-oidc.mjs';
import {createWorkerRelay} from '../worker-relay.mjs';

const envId = 'unknown-roadrunner-d7cap6e21f517';
const prefix = 'tcl_r24_sync_v1';
const lease = '00000000-0000-4000-8000-000000000001';
const id = 'a'.repeat(64);
const next = () => { throw new Error('unexpected route'); };
const credentials = {authorization: 'Bearer test', 'content-type': 'application/json'};
const request = (op, body, headers = credentials) =>
  new Request('https://example.invalid/worker/' + op, {method: 'POST', headers, body: JSON.stringify(body)});
const baseScore = {model: 'gpt-6.1-terra', grade: '良好', overallScore: 80, items: [{}]};
const receipt = {...baseScore, jobId: id, origin: 'openai_review', reviewStatus: 'pending_review', schemaVersion: 1};
const result = {...baseScore, source: 'openai_offline'};

test('all queue operations use dedicated RPC names and server-side argument bindings', async () => {
  const calls = [];
  const db = {rpc: async (name, params) => {
    calls.push([name, params]);
    return {data: [{value: name.endsWith('_claim') ? {jobId: id, state: 'ready'} : false}]};
  }};
  const relay = createWorkerRelay({db, prefix, envId, verifyToken: async token => token === 'test'});
  const args = {id, lease};
  for (const [op, body, fn, params] of [
    ['claim', {lease}, 'claim', {p_lease: lease}],
    ['start', args, 'start_attempt', {p_job_id: id, p_lease: lease}],
    ['save', {...args, result, receipt}, 'save_result', {p_job_id: id, p_lease: lease, p_result: result, p_receipt: receipt}],
    ['ack', args, 'ack', {p_job_id: id, p_lease: lease}],
    ['hold', {...args, reason: 'invalid_input'}, 'hold', {p_job_id: id, p_lease: lease, p_reason: 'invalid_input'}],
  ]) {
    const response = await relay(request(op, body), next);
    assert.equal(response.status, 200);
    assert.deepEqual(calls.at(-1), [prefix + '_worker_' + fn, params]);
    assert.deepEqual(await response.json(), {value: op === 'claim' ? {jobId: id, state: 'ready'} : false});
  }
});

test('expected queue and SDK reply shapes, including empty queue, propagate without exposing database errors', async () => {
  for (const [reply, status] of [
    [{data: [{value: null}]}, 200], [{data: null}, 503], [{data: []}, 503],
    [{data: [{value: {jobId: id, state: 'hidden'}}]}, 503], [{data: [{value: null, extra: 1}]}, 503],
    [{error: 'private detail'}, 503],
  ]) {
    const relay = createWorkerRelay({envId, prefix, db: {rpc: async () => reply}, verifyToken: async () => true});
    const response = await relay(request('claim', {lease}), next);
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /private detail|hidden/);
  }
});

test('browser API passes through and unauthorized worker requests never reach database', async () => {
  const db = {rpc: () => assert.fail('should not access queue')};
  const relay = createWorkerRelay({envId, prefix, db, verifyToken: async token => token === 'test'});
  const existing = new Request('https://example.invalid/me');
  assert.equal(await relay(existing, async req => req), existing);
  const requests = [
    [request('claim', {lease}, {}), 401],
    [request('claim', {lease}, {...credentials, authorization: 'Bearer wrong'}), 401],
    [request('claim', {lease}, {...credentials, origin: 'https://example.invalid'}), 404],
    [request('any-rpc', {lease}), 404], [request('claim', {lease, id}), 400],
    [request('ack', {lease, id: 'not-a-digest'}), 400], [request('claim', {lease: 'not-uuid'}), 400],
    [request('hold', {id, lease, reason: 'unapproved_reason'}), 400],
    [request('save', {id, lease, result, receipt: {...receipt, overallScore: 70}}), 400],
  ];
  for (const [req, status] of requests) assert.equal((await relay(req, next)).status, status);
  const other = createWorkerRelay({envId: 'another-env', prefix, db, verifyToken: async () => true});
  assert.equal((await other(request('claim', {lease}), next)).status, 404);
});

test('only GitHub signatures for the exact private production workflow on main authorize a worker', async () => {
  const key = await generateKeyPair('RS256');
  const jwk = {...await exportJWK(key.publicKey), kid: 'active', alg: 'RS256'};
  let loads = 0;
  const verifier = createGitHubWorkerVerifier({fetchImpl: async (url, opts) => {
    assert.equal(String(url), 'https://token.actions.githubusercontent.com/.well-known/jwks');
    assert.equal(opts.redirect, 'error');
    loads++;
    return Response.json({keys: [jwk]});
  }});
  const repository = 'lijianjun004-star/tcl-r24-score-archive';
  const ref = 'refs/heads/main';
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: 'https://token.actions.githubusercontent.com', aud: 'r24-sh-score-main-v1',
    repository, repository_visibility: 'private', repository_id: '1474053872', ref,
    sha: 'a'.repeat(40), workflow_sha: 'a'.repeat(40), workflow_ref: repository + '/.github/workflows/r24-private-score-archive.yml@' + ref,
    run_attempt: '1', run_id: '9001', sub: 'repo:' + repository + ':ref:' + ref, jti: 'test',
    event_name: 'schedule', iat: now, nbf: now, exp: now + 300,
  };
  const sign = (overrides = {}) => new SignJWT({...claims, ...overrides})
    .setProtectedHeader({alg: 'RS256', kid: 'active'}).sign(key.privateKey);
  assert.equal(await verifier(await sign()), true);
  assert.equal(await verifier(await sign({event_name: 'workflow_dispatch'})), true);
  for (const override of [
    {repository: 'a/different-repo'}, {repository_id: '1'}, {repository_visibility: 'public'},
    {workflow_ref: 'canary'}, {workflow_sha: 'b'.repeat(40)}, {ref: 'refs/heads/feature'}, {run_attempt: '2'},
    {iss: 'https://example.invalid'}, {aud: 'r24-sh-score-can1'}, {aud: [claims.aud, 'another']}, {event_name: 'pull_request'},
    {iat: now - 10000, exp: now - 9000}, {exp: now + 9999},
  ]) await assert.rejects(verifier(await sign(override)));
  assert.equal(loads, 1);
  const unavailable = createGitHubWorkerVerifier({fetchImpl: async () => new Response('', {status: 503})});
  await assert.rejects(unavailable(await sign()), error => oidcFailureReason(error) === 'JWKS_HTTP_ERROR');
  const offline = createGitHubWorkerVerifier({fetchImpl: async () => { throw new Error('private network details'); }});
  await assert.rejects(offline(await sign()), error => oidcFailureReason(error) === 'JWKS_UNREACHABLE');
  await assert.rejects(verifier(await sign({workflow_ref: 'other'})), error => oidcFailureReason(error) === 'WORKFLOW_IDENTITY_MISMATCH');
  await assert.rejects(verifier(await sign({aud: 'different'})), error => oidcFailureReason(error) === 'CLAIMS_INVALID');
  const unsignedParts = (await sign()).split('.');
  unsignedParts[2] = (unsignedParts[2][0] === 'A' ? 'B' : 'A') + unsignedParts[2].slice(1);
  await assert.rejects(verifier(unsignedParts.join('.')), error => oidcFailureReason(error) === 'SIGNATURE_INVALID');
  assert.equal(oidcFailureReason(new Error('sensitive input')), 'VERIFICATION_FAILED');
});

test('native Shanghai JWKS client fetches only from GitHub over verified TLS and handles IPv4 fallback', async () => {
  const {EventEmitter} = await import('node:events');
  const {Readable} = await import('node:stream');
  const {createIssuerFetch, jwksUrl} = await import('../worker-jwks.mjs');
  const parentSignal = AbortSignal.timeout(12000);
  const options = {method: 'GET', headers: {'accept': 'application/json'}, signal: parentSignal};
  const response = ({body, status = 200, code}, req, cb) => {
    queueMicrotask(() => {
      if (code) { req.emit('error', Object.assign(new Error('private'), {code})); return; }
      const res = Readable.from([Buffer.from(body ?? '')]);
      res.statusCode = status;
      cb(res);
    });
  };
  function fixture(replies) {
    const calls = [], logs = [];
    const fetch = createIssuerFetch({log: (...args) => logs.push(args), getImpl: (url, opts, cb) => {
      assert.equal(url, jwksUrl);
      assert.equal(opts.rejectUnauthorized, true);
      assert.equal(opts.headers.accept, 'application/json');
      calls.push(opts);
      const req = new EventEmitter();
      response(replies.shift(), req, cb);
      return req;
    }});
    return {calls, logs, fetch};
  }
  const first = fixture([{body: '{"keys":[]}'}]);
  assert.deepEqual(await (await first.fetch(jwksUrl, options)).json(), {keys: []});
  assert.deepEqual(first.calls.map(c => c.family), [4]);
  assert.deepEqual(first.logs, [['R24_SCORE_WORKER_JWKS', 'FETCHED_IPV4']]);
  const retry = fixture([{code: 'ETIMEDOUT'}, {body: 'fresh'}]);
  assert.equal(await (await retry.fetch(jwksUrl, options)).text(), 'fresh');
  assert.deepEqual(retry.calls.map(c => c.family), [4, undefined]);
  assert.equal(retry.calls[1].signal, parentSignal);
  assert.deepEqual(retry.logs, [['R24_SCORE_WORKER_JWKS', 'FETCHED_DEFAULT_FAMILY']]);
  const redirect = fixture([{status: 302}]);
  assert.equal((await redirect.fetch(jwksUrl, options)).status, 302);
  assert.equal(redirect.calls.length, 1);
  const large = fixture([{body: 'x'.repeat(65537)}]);
  await assert.rejects(large.fetch(jwksUrl, options));
  assert.equal(large.calls.length, 1);
  const badCertificate = fixture([{code: 'CERT_HAS_EXPIRED'}]);
  await assert.rejects(badCertificate.fetch(jwksUrl, options));
  assert.equal(badCertificate.calls.length, 1);
  await assert.rejects(first.fetch('https://example.invalid/jwks', options));
});
