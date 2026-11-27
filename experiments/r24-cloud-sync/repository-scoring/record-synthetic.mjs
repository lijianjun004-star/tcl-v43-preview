// Acceptance harness. This executable can only record the one published, synthetic fixture.
// Production calls createRepositoryArchive, which independently enforces private visibility.
import {appendFile, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateScoreReceipt} from './archive.mjs';

const repo = 'lijianjun004-star/tcl-v43-preview';
const branch = 'qa/r24-synthetic-score-receipts';
const jobId = 'e2a5786137d30c1a568e1d23589a5bc011ab9324be76edb8ce795fd0efd13207';
const file = 'score-receipts/synthetic-terra-v1/' + jobId + '.json';
async function main() {
  const env = process.env;
  if (env.GITHUB_REPOSITORY !== repo || env.GITHUB_REF !== 'refs/heads/feat/r24-openai-async-terra' ||
      env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_RUN_ATTEMPT !== '1' || !env.GITHUB_TOKEN) throw new Error();
  const receipt = validateScoreReceipt(JSON.parse(await readFile(process.argv[2], 'utf8')));
  const item = receipt.items[0];
  if (receipt.jobId !== jobId || receipt.origin !== 'openai_review' || receipt.model !== 'gpt-6.1-terra' ||
      receipt.items.length !== 1 || item.matched.length + item.missed.length !== 2) throw new Error();
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
  const sha = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  const url = 'https://api.github.com/repos/' + repo + '/contents/' + file;
  const headers = {Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'};
  async function present() {
    const r = await fetch(url + '?ref=' + encodeURIComponent(branch), {headers,redirect:'error',signal:AbortSignal.timeout(15000)});
    if (r.status === 404) return false;
    if (!r.ok) throw new Error();
    const data = await r.json();
    if (data.type !== 'file' || data.path !== file || data.sha !== sha || data.encoding !== 'base64' ||
        typeof data.content !== 'string' || data.content.replace(/[\r\n]/g,'') !== bytes.toString('base64')) throw new Error();
    return true;
  }
  let status = 'already_present';
  if (!await present()) {
    const response = await fetch(url, {headers,method:'PUT',redirect:'error',signal:AbortSignal.timeout(15000),
      body:JSON.stringify({branch, message:'Record verified synthetic Terra R24 score receipt',content:bytes.toString('base64')})});
    if (![201,409,422].includes(response.status) || !await present()) throw new Error();
    status = response.status === 201 ? 'created' : 'already_present';
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  const evidence = {status,repo,branch,file,verifiedAt:new Date().toISOString(),readbackHttp:200,sha256:hash,gitBlobSha:sha};
  console.log(JSON.stringify(evidence));
  if (env.GITHUB_STEP_SUMMARY) {
    await appendFile(env.GITHUB_STEP_SUMMARY, 'Synthetic QA receipt verified from GitHub (HTTP 200).\n\n' +
      '- [' + file + '](https://github.com/' + repo + '/blob/' + branch + '/' + file + ')\n' +
      '- SHA-256 `' + hash + '`\n');
  }
}
main().catch(() => { console.error('The fixed synthetic receipt could not be verified on the QA branch.'); process.exitCode = 1; });
