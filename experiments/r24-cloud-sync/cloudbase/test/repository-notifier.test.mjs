import assert from 'node:assert/strict';
import {generateKeyPairSync, verify} from 'node:crypto';
import test from 'node:test';
import {createRepositoryNotifier} from '../repository-notifier.mjs';

const {privateKey,publicKey} = generateKeyPairSync('rsa',{modulusLength:2048});
const repo = 'synthetic/review-only';
const configuration = {
  R24_REPO_WAKE_ENABLED:'true', R24_REPO_WAKE_REPOSITORY:repo, R24_REPO_WAKE_REPOSITORY_ID:'42',
  R24_REPO_WAKE_APP_ID:'4', R24_REPO_WAKE_INSTALLATION_ID:'24', R24_REPO_WAKE_APP_PRIVATE_KEY:privateKey,
};
const target = {private:true,visibility:'private',id:42,full_name:repo,default_branch:'main'};
function setup(metadata = target, env = configuration, secretResponse) {
  const calls = [];
  const fetchImpl = async (url,opts) => {
    calls.push({url,opts});
    if (url === 'https://ssm.tencentcloudapi.com/') return secretResponse();
    if (url.endsWith('/access_tokens')) return Response.json({token:'synthetic-installation-token'}, {status:201});
    if (opts.method === 'GET') return Response.json(metadata);
    return new Response(null,{status:204});
  };
  return {notify:createRepositoryNotifier({env, fetchImpl}), calls};
}

test('wake requires opt-in explicit repository, installation and App identity', () => {
  for (const overrides of [{R24_REPO_WAKE_ENABLED:'false'},{R24_REPO_WAKE_APP_ID:''},
    {R24_REPO_WAKE_REPOSITORY:'test/..'}, {R24_REPO_WAKE_REPOSITORY_ID:'NaN'}]) {
    assert.equal(createRepositoryNotifier({env:{...configuration,...overrides}}), undefined);
  }
});

const namedSecret = 'r24-shanghai-github-wake';
const managedConfiguration = {
  ...configuration, R24_REPO_WAKE_APP_PRIVATE_KEY: undefined, R24_REPO_WAKE_APP_PRIVATE_KEY_SECRET_NAME: namedSecret,
  TENCENTCLOUD_SECRETID:'test-role-id', TENCENTCLOUD_SECRETKEY:'test-role-secret', TENCENTCLOUD_SESSIONTOKEN:'test-role-token',
};

test('Shanghai reads the current key with the SCF session and signs one data-free GitHub wake', async t => {
  t.mock.method(Date, 'now', () => 1700000000000);
  const pem = privateKey.export({type:'pkcs1', format:'pem'});
  const secretResponse = () => Response.json({Response:{SecretName:namedSecret,SecretString:pem}});
  const {notify,calls} = setup(target, managedConfiguration, secretResponse);
  assert.equal(await notify(), true);
  const [lookup, grant] = calls;
  assert.equal(calls.length, 4);
  assert.deepEqual(JSON.parse(lookup.opts.body), {SecretName:namedSecret,VersionStage:'Stage_Current'});
  assert.equal(lookup.opts.headers['X-TC-Token'], 'test-role-token');
  assert.equal(lookup.opts.headers['X-TC-Action'], 'GetSecretValue');
  assert.equal(lookup.opts.headers['X-TC-Region'], 'ap-shanghai');
  assert.equal(lookup.opts.headers['X-TC-Version'], '2019-09-23');
  // Reproduced independently with Tencent's official Node SDK sign3 for these synthetic inputs.
  assert.equal(lookup.opts.headers.Authorization, 'TC3-HMAC-SHA256 Credential=test-role-id/2023-11-14/ssm/tc3_request, SignedHeaders=content-type;host, Signature=77b58f50179400ed212f3f7c3ae26a1e4404f69017eb3c00ad21d58b907f62f5');
  assert.ok(calls.every(({opts}) => opts.signal === lookup.opts.signal && opts.redirect === 'error'));
  const [head,claims,signature] = grant.opts.headers.Authorization.slice(7).split('.');
  assert.ok(verify('RSA-SHA256', Buffer.from(head+'.'+claims), publicKey, Buffer.from(signature,'base64url')));
});

test('a pinned SSM version uses only VersionId and must match the returned version', async () => {
  const env = {...managedConfiguration, R24_REPO_WAKE_APP_PRIVATE_KEY_SECRET_VERSION:'v1'};
  const SecretString = privateKey.export({type:'pkcs1', format:'pem'});
  for (const VersionId of ['v1', 'v2', undefined]) {
    const secretResponse = () => Response.json({Response:{SecretName:namedSecret,VersionId,SecretString}});
    const {notify,calls} = setup(target, env, secretResponse);
    assert.equal(await notify(), VersionId === 'v1');
    assert.deepEqual(JSON.parse(calls[0].opts.body), {SecretName:namedSecret,VersionId:'v1'});
    assert.equal(calls.length, VersionId === 'v1' ? 4 : 1);
  }
  for (const version of ['', ' v1', 'v1\n', '-1', 'v/1', 'x'.repeat(65)]) {
    assert.equal(createRepositoryNotifier({env:{...env,R24_REPO_WAKE_APP_PRIVATE_KEY_SECRET_VERSION:version}}), undefined);
  }
  assert.equal(createRepositoryNotifier({env:{...configuration,R24_REPO_WAKE_APP_PRIVATE_KEY_SECRET_VERSION:'v1'}}), undefined);
});

test('managed key access fails closed before GitHub without the exact name, session, or usable current key', async () => {
  for (const overrides of [{R24_REPO_WAKE_APP_PRIVATE_KEY:privateKey},{R24_REPO_WAKE_APP_PRIVATE_KEY_SECRET_NAME:'other'}]) {
    assert.equal(createRepositoryNotifier({env:{...managedConfiguration,...overrides}}), undefined);
  }
  for (const credential of ['TENCENTCLOUD_SECRETID','TENCENTCLOUD_SECRETKEY','TENCENTCLOUD_SESSIONTOKEN']) {
    const {notify,calls} = setup(target, {...managedConfiguration,[credential]:undefined});
    assert.equal(await notify(), false);
    assert.equal(calls.length, 0);
  }
  for (const reply of [
    () => {throw new Error('synthetic network error');},
    () => new Response(null,{status:403}),
    () => Response.json({Response:{Error:{Code:'UnauthorizedOperation'}}}),
    () => Response.json({Response:{SecretName:'other',SecretString:'unexpected'}}),
    () => Response.json({Response:{SecretName:namedSecret,SecretString:'malformed'}}),
  ]) {
    const {notify,calls} = setup(target, managedConfiguration, reply);
    assert.equal(await notify(), false);
    assert.deepEqual(calls.map(({url})=>url), ['https://ssm.tencentcloudapi.com/']);
  }
});

test('App authenticates to GitHub, verifies the private repository and sends a data-free workflow wake', async () => {
  const {notify,calls} = setup();
  assert.equal(await notify(),true);
  assert.deepEqual(calls.map(c=>c.url),[
    'https://api.github.com/app/installations/24/access_tokens', 'https://api.github.com/repos/'+repo,
    'https://api.github.com/repos/'+repo+'/actions/workflows/r24-private-score-archive.yml/dispatches']);
  const [grant,metadata,dispatch] = calls.map(c=>c.opts);
  assert.deepEqual(JSON.parse(grant.body),{repository_ids:[42],permissions:{actions:'write'}});
  const jwt = grant.headers.Authorization.slice(7).split('.');
  assert.ok(verify('RSA-SHA256',Buffer.from(jwt[0]+'.'+jwt[1]),publicKey,Buffer.from(jwt[2],'base64url')));
  assert.equal(JSON.parse(Buffer.from(jwt[1],'base64url')).iss,'4');
  assert.equal(metadata.headers.Authorization, 'Bearer synthetic-installation-token');
  assert.deepEqual(JSON.parse(dispatch.body),{ref:'main',inputs:{signal:'submission_saved'}});
  assert.ok(calls.every(c=>c.opts.redirect==='error' && c.opts.signal===grant.signal));
});

test('public, different or invalid destinations never receive a workflow dispatch', async () => {
  for (const data of [{...target,private:false},{...target,id:10},{...target,full_name:'synthetic/other'}, {...target,default_branch:'r24-score-receipts'}]) {
    const {notify,calls} = setup(data);
    assert.equal(await notify(),false);
    assert.equal(calls.length,2);
  }
});

test('enterprise-internal and missing visibility cannot wake a worker', async () => {
  for (const visibility of ['internal', undefined]) {
    const {notify,calls} = setup({...target,private:true,visibility});
    assert.equal(await notify(),false);
    assert.deepEqual(calls.map(c => c.opts.method), ['POST', 'GET']);
    assert.ok(calls.every(c => !c.url.endsWith('/dispatches')));
  }
});
