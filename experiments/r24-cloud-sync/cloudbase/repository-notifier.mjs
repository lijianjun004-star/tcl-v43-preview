import {sign} from 'node:crypto';

const api = 'https://api.github.com';
const workflow = 'r24-private-score-archive.yml';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

// A workflow_dispatch signal carries no submission data. The private runner pulls
// eligible work from the committed queue using its own limited database role.
export function createRepositoryNotifier({env = process.env, fetchImpl = fetch} = {}) {
  if (env.R24_REPO_WAKE_ENABLED !== 'true') return undefined;
  const name = env.R24_REPO_WAKE_REPOSITORY;
  const id = env.R24_REPO_WAKE_REPOSITORY_ID;
  const app = env.R24_REPO_WAKE_APP_ID;
  const installation = env.R24_REPO_WAKE_INSTALLATION_ID;
  const privateKey = env.R24_REPO_WAKE_APP_PRIVATE_KEY;
  if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(name || '') ||
      ['.', '..'].includes(name.split('/')[1]) ||
      ![id, app, installation].every(value => /^[1-9]\d{0,15}$/.test(value || '') && Number.isSafeInteger(Number(value))) ||
      !privateKey) return undefined;

  return async function notify() {
    // One budget for all three control-plane requests; a notification failure
    // never rolls back the submission. The scheduled sweep processes backlog.
    const signal = AbortSignal.timeout(3000);
    const now = Math.floor(Date.now() / 1000);
    const data = encode({alg:'RS256',typ:'JWT'}) + '.' + encode({iat:now-60,exp:now+300,iss:app});
    const jwt = data + '.' + sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url');
    async function request(path, token, method, body) {
      return fetchImpl(api + path, {method, redirect:'error', signal,
        headers:{Authorization:'Bearer ' + token, Accept:'application/vnd.github+json',
          'Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
        ...(body ? {body:JSON.stringify(body)} : {})});
    }
    const grant = await request('/app/installations/' + installation + '/access_tokens', jwt, 'POST',
      {repository_ids:[Number(id)],permissions:{actions:'write'}});
    if (grant.status !== 201) return false;
    const {token} = await grant.json();
    if (typeof token !== 'string' || !token || /\s/.test(token)) return false;

    const target = await request('/repos/' + name, token, 'GET');
    if (target.status !== 200) return false;
    const metadata = await target.json();
    if (metadata.private !== true || metadata.visibility !== 'private' || metadata.id !== Number(id) ||
        metadata.full_name?.toLowerCase() !== name.toLowerCase() ||
        typeof metadata.default_branch !== 'string' || !metadata.default_branch ||
        metadata.default_branch === 'r24-score-receipts') return false;
    const sent = await request('/repos/' + name + '/actions/workflows/' + workflow + '/dispatches', token, 'POST',
      {ref:metadata.default_branch, inputs:{signal:'submission_saved'}});
    return sent.status === 204;
  };
}
