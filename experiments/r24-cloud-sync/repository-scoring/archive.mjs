import {createHash} from 'node:crypto';

const archiveBranch = 'r24-score-receipts';
const currentReviewModel = 'gpt-6.1-terra';
const historicalOpenAIModels = new Set(['gpt-4o', 'gpt-4o-mini']);
const originalSubmissionModels = new Set(['hy3', 'hy3-preview', ...historicalOpenAIModels, currentReviewModel]);
const receiptFields = ['schemaVersion', 'jobId', 'origin', 'model', 'overallScore', 'grade', 'items', 'reviewStatus'];
const itemFields = ['questionIndex', 'score', 'matched', 'missed'];
const digestPattern = /^[a-f0-9]{40}$/;
const ownerRepo = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/;

function fail(code) {
  throw Object.assign(new Error(code), {code});
}

function exactFields(value, names) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== names.length ||
      !names.every(name => Object.hasOwn(value, name))) fail('ARCHIVE_INVALID_RECEIPT');
}

function integer(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function numericList(values) {
  if (!Array.isArray(values) || values.length > 12) fail('ARCHIVE_INVALID_RECEIPT');
  // Array.from also exposes holes for validation instead of silently skipping them.
  const list = Array.from(values);
  if (!list.every(n => integer(n, 1, 12))) fail('ARCHIVE_INVALID_RECEIPT');
  return list.sort((a, b) => a - b);
}

export function validateScoreReceipt(value, {historical = false} = {}) {
  exactFields(value, receiptFields);
  if (value.schemaVersion !== 1 || typeof value.jobId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.jobId) ||
      !['submission', 'openai_review'].includes(value.origin) || !originalSubmissionModels.has(value.model) ||
      !integer(value.overallScore, 0, 100) || value.reviewStatus !== 'pending_review' ||
      !Array.isArray(value.items) || !integer(value.items.length, 1, 15)) fail('ARCHIVE_INVALID_RECEIPT');
  // The historical exception is for an already-saved OpenAI receipt being recovered.
  if (value.origin === 'openai_review' && value.model !== currentReviewModel &&
      !(historical === true && historicalOpenAIModels.has(value.model))) fail('ARCHIVE_INVALID_RECEIPT');
  const items = Array.from(value.items, (item, index) => {
    exactFields(item, itemFields);
    if (item.questionIndex !== index || !integer(item.score, 0, 100)) fail('ARCHIVE_INVALID_RECEIPT');
    const matched = numericList(item.matched);
    const missed = numericList(item.missed);
    const indices = [...matched, ...missed].sort((a, b) => a - b);
    if (!indices.length || indices.some((n, i) => n !== i + 1)) fail('ARCHIVE_INVALID_RECEIPT');
    return {questionIndex: index, score: item.score, matched, missed};
  });
  const mean = Math.round(items.reduce((total, item) => total + item.score, 0) / items.length);
  const grade = mean >= 85 ? '优秀' : mean >= 60 ? '良好' : '待提升';
  if (value.overallScore !== mean || value.grade !== grade) fail('ARCHIVE_INVALID_RECEIPT');
  return {schemaVersion: 1, jobId: value.jobId, origin: value.origin, model: value.model,
    overallScore: mean, grade, items, reviewStatus: 'pending_review'};
}

export function createRepositoryArchive({repo, token, fetchImpl = globalThis.fetch, branch = archiveBranch}) {
  const target = process.env.GITHUB_REPOSITORY;
  if (typeof repo !== 'string' || !ownerRepo.test(repo) || ['.', '..'].includes(repo.split('/')[1]) ||
      (target && target.toLowerCase() !== repo.toLowerCase()) || (process.env.GITHUB_ACTIONS === 'true' && !target) ||
      branch !== archiveBranch || typeof token !== 'string' || !token || /\s/u.test(token) ||
      typeof fetchImpl !== 'function') fail('ARCHIVE_INVALID_DESTINATION');

  const api = 'https://api.github.com/repos/' + repo;
  async function request(method, path, body) {
    try {
      return await fetchImpl(api + path, {method, redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: {Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token,
          'X-GitHub-Api-Version': '2022-11-28', ...(body ? {'Content-Type': 'application/json'} : {})},
        ...(body ? {body: JSON.stringify(body)} : {})});
    } catch {
      fail('ARCHIVE_NETWORK_ERROR');
    }
  }

  async function responseJson(response) {
    try {
      return await response.json();
    } catch {
      fail('ARCHIVE_INVALID_RESPONSE');
    }
  }

  function expectStatus(response, status) {
    if (response.status !== status) fail('ARCHIVE_GITHUB_HTTP_' + Number(response.status));
  }

  async function verifyDestination() {
    const metadata = await request('GET', '');
    expectStatus(metadata, 200);
    const info = await responseJson(metadata);
    if (info?.private !== true || typeof info.full_name !== 'string' ||
        info.full_name.toLowerCase() !== repo.toLowerCase() || !info.default_branch ||
        info.default_branch === branch) fail('ARCHIVE_UNSAFE_DESTINATION');
    const branchResponse = await request('GET', '/branches/' + branch);
    expectStatus(branchResponse, 200);
    const branchInfo = await responseJson(branchResponse);
    if (branchInfo?.name !== branch) fail('ARCHIVE_UNSAFE_DESTINATION');
    return {repo: info.full_name, branch, protected: branchInfo.protected === true};
  }

  async function archive(input, {historical = false} = {}) {
    const receipt = validateScoreReceipt(input, {historical});
    const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
    const encoded = bytes.toString('base64');
    const sha = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    const path = 'score-receipts/v1/' + receipt.jobId + '.json';
    const contentsPath = '/contents/' + path;
    const summary = status => ({status, path, branch, sha});
    await verifyDestination();

    async function readExisting() {
      const response = await request('GET', contentsPath + '?ref=' + branch);
      if (response.status === 404) return false;
      expectStatus(response, 200);
      const file = await responseJson(response);
      if (file?.type !== 'file' || file.path !== path || file.encoding !== 'base64' ||
          typeof file.content !== 'string' || !digestPattern.test(file.sha)) fail('ARCHIVE_INVALID_RESPONSE');
      if (file.sha !== sha || file.content.replace(/[\r\n]/g, '') !== encoded) fail('ARCHIVE_RECEIPT_CONFLICT');
      return true;
    }

    if (await readExisting()) return summary('already_archived');
    // Omitting sha makes the Contents API create-only; an existing file cannot be replaced.
    const created = await request('PUT', contentsPath, {branch, content: encoded,
      message: 'Archive R24 score receipt ' + receipt.jobId});
    if (created.status === 409 || created.status === 422) {
      if (await readExisting()) return summary('already_archived');
      fail('ARCHIVE_GITHUB_HTTP_' + created.status);
    }
    expectStatus(created, 201);
    const saved = (await responseJson(created))?.content;
    if (saved?.path !== path || saved.sha !== sha || saved.type !== 'file') fail('ARCHIVE_INVALID_RESPONSE');
    return summary('archived');
  }
  archive.verifyDestination = verifyDestination;
  return archive;
}
