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
function setup(metadata = target) {
  const calls = [];
  const fetchImpl = async (url,opts) => {
    calls.push({url,opts});
    if (url.endsWith('/access_tokens')) return Response.json({token:'synthetic-installation-token'}, {status:201});
    if (opts.method === 'GET') return Response.json(metadata);
    return new Response(null,{status:204});
  };
  return {notify:createRepositoryNotifier({env:configuration, fetchImpl}), calls};
}

test('wake requires opt-in explicit repository, installation and App identity', () => {
  for (const overrides of [{R24_REPO_WAKE_ENABLED:'false'},{R24_REPO_WAKE_APP_ID:''},
    {R24_REPO_WAKE_REPOSITORY:'test/..'}, {R24_REPO_WAKE_REPOSITORY_ID:'NaN'}]) {
    assert.equal(createRepositoryNotifier({env:{...configuration,...overrides}}), undefined);
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
