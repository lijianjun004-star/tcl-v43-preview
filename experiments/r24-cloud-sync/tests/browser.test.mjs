import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import { startTestSite, identities } from './test-site.mjs';

const fixtureScript = new URL('./fixtures.py', import.meta.url);
const executablePath = process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium';
const operator = identities.operator;
const anchor = identities.anchor;
const assignmentTitle = '合成跨设备三题作业';
const questions = [1, 2, 3].map(index => `请介绍 TEST-A${index} 的合成测试功能？`);
const answers = [1, 2, 3].map(index => `人工回答第${index}题：TEST-A${index} 为合成型号，信息仅用于流程测试。`);

async function browserFixture(t) {
  const work = await mkdtemp(join(tmpdir(), 'tcl-sync-browser-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const excel = join(work, 'three-questions.xlsx');
  await promisify(execFile)('python3', [fixtureScript.pathname, excel]);

  const server = await startTestSite();
  t.after(() => server.close());
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  t.after(() => browser.close());

  async function newPage(path = '/sync/') {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === server.origin ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(server.origin + path, { waitUntil: 'domcontentloaded' });
    return { page, errors };
  }
  return { server, excel, newPage };
}

async function signIn(page, name, password = 'fixture-account-password') {
  await page.locator('#syncUsername').fill(name);
  await page.locator('#syncPassword').fill(password);
  await page.locator('#syncLoginForm button[type="submit"]').click();
}

async function signInLocally(page, role, name) {
  await page.locator(`[data-role-pick="${role}"]`).click();
  await page.locator('#simpleName').fill(name);
  await page.locator('#simpleLogin').click();
  await page.locator('#switchIdentity').waitFor();
}

async function fillAssignment(page, excel) {
  await page.locator('[data-ops-tab="publish"]').click();
  await page.locator('#assignmentTitle').fill(assignmentTitle);
  await page.locator('#assignmentBoard').selectOption('01');
  await page.locator('#assignmentPlatform').selectOption('京东');
  await page.locator('#assignmentExcelFile').setInputFiles(excel);
  await page.locator('#assignmentExcelPreviewBtn').click();
  await page.locator('#assignmentExcelPreview').getByText('3 道', { exact: false }).waitFor();
}

async function textPractice(page, enter) {
  await enter();
  const start = page.locator('#startScene');
  await start.waitFor();
  const textMode = page.locator('#prepQuickText');
  if (await textMode.isVisible()) await textMode.click();
  await start.click();
  for (const [index, question] of questions.entries()) {
    await page.locator('#liveQText').filter({ hasText: question }).waitFor();
    await page.locator('#focusMic').click();
    await page.locator('#liveTextAnswer').fill(answers[index]);
    await page.locator('#liveTextSave').click();
    if (index === questions.length - 1) break;
    if (index > 0) {
      // The app intentionally ignores "next" clicks less than 700 ms apart.
      await new Promise(resolve => setTimeout(resolve, 710));
    }
    await page.locator('#focusNext').click();
  }
  await page.locator('#focusClose').click();
  await page.getByRole('button', { name: '结束并进入复盘', exact: true }).click();
  await page.locator('#submitSession').waitFor();
}

async function checkNoOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
}

test('two independent browsers: publish a real XLSX, claim, submit, operator reads exact answers', { timeout: 90_000 }, async t => {
  const { server, excel, newPage } = await browserFixture(t);
  const ops = await newPage();
  const trainee = await newPage();
  await signIn(ops.page, operator.username);
  await signIn(trainee.page, anchor.username);
  await ops.page.locator('#switchIdentity').waitFor();
  await trainee.page.locator('#assignmentFold').waitFor();
  await checkNoOverflow(ops.page);
  await checkNoOverflow(trainee.page);
  assert.equal(await trainee.page.locator('#assignmentTitle').count(), 0);
  assert.equal(await ops.page.locator('#assignmentRecipients').count(), 0);

  await fillAssignment(ops.page, excel);
  assert.equal(server.requests.filter(r => r.method === 'POST' && r.path.endsWith('/assignments')).length, 0);
  const publishing = ops.page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/assignments'));
  await ops.page.locator('#publishAssignment').click();
  const published = await publishing;
  const publishedBody = await published.json();
  assert.ok(published.ok(), JSON.stringify(publishedBody));
  const assignment = publishedBody.assignment;
  assert.deepEqual(assignment.questions.map(q => q.question), questions);
  assert.deepEqual(assignment.assignedTo, []);
  assert.equal(assignment.questions[0].sku, '000001');

  const fold = trainee.page.locator('#assignmentFold');
  await fold.locator('summary').click();
  await trainee.page.locator('#assignmentSearch').fill(operator.displayName);
  await trainee.page.locator('#syncRefresh').click();
  const eligible = trainee.page.locator('#assignmentSearchResults [data-join-assignment]').first();
  await eligible.waitFor();
  assert.equal(await eligible.getAttribute('data-join-assignment'), assignment.id);

  await textPractice(trainee.page, () => eligible.click());
  const postPath = `/assignments/${encodeURIComponent(assignment.id)}/submissions`;
  let lostResponse;
  await trainee.page.route('**' + postPath, async route => {
    const response = await route.fetch();
    lostResponse = { status: response.status(), body: await response.json() };
    await route.abort('failed');
  }, { times: 1 });
  await trainee.page.locator('#submitSession').click();
  await trainee.page.locator('#toast').filter({ hasText: '未收到云端确认' }).waitFor();
  assert.equal(lostResponse.status, 201);
  assert.equal(lostResponse.body.replayed, false);
  assert.match(await trainee.page.locator('#submitSession').textContent(), /提交到云端/);
  assert.doesNotMatch(await trainee.page.locator('#submitSession').textContent(), /已提交到云端/);

  const submission = trainee.page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(postPath));
  await trainee.page.locator('#submitSession').click();
  const submitted = await submission;
  const submittedBody = await submitted.json();
  assert.equal(submitted.status(), 200, JSON.stringify(submittedBody));
  assert.equal(submittedBody.replayed, true);
  assert.equal(submittedBody.submission.id, lostResponse.body.submission.id);
  await trainee.page.locator('#submitSession').filter({ hasText: /已提交到云端|已送达运营/ }).waitFor();
  assert.deepEqual(submittedBody.submission.turns.map(turn => turn.answer), answers);

  await ops.page.locator('[data-ops-tab="tracking"]').click();
  await ops.page.locator('#syncRefresh').click();
  await ops.page.locator('#syncRefreshStatus').filter({ hasText: '已读取 1 份云端作业' }).waitFor();
  const inboxButton = ops.page.locator(`[data-sync-submissions="${assignment.id}"]`);
  const getting = ops.page.waitForResponse(r => r.request().method() === 'GET' && r.url().includes(postPath));
  await inboxButton.click();
  const response = await getting;
  const inbox = await response.json();
  assert.ok(response.ok(), JSON.stringify(inbox));
  assert.equal(inbox.submissions.length, 1);
  assert.equal(inbox.submissions[0].anchorName, anchor.displayName);
  await ops.page.locator('#syncInbox details summary').click();
  for (const answer of answers) {
    await ops.page.locator('#syncInbox').getByText(answer, { exact: true }).waitFor();
  }

  const sameAnchorElsewhere = await newPage();
  await signIn(sameAnchorElsewhere.page, anchor.username);
  await sameAnchorElsewhere.page.locator('#assignmentFold summary').click();
  await sameAnchorElsewhere.page.locator('#assignmentSearch').fill(operator.displayName);
  await sameAnchorElsewhere.page.locator('#assignmentSearchResults .assignment-row')
    .filter({ hasText: '已提交到云端' }).waitFor();

  const foreign = await newPage();
  await signIn(foreign.page, identities.foreign.username);
  await foreign.page.locator('#assignmentFold').waitFor();
  await foreign.page.locator('#assignmentFold summary').click();
  await foreign.page.locator('#syncRefresh').click();
  await foreign.page.locator('#syncRefreshStatus').filter({ hasText: '已读取 0 份云端作业' }).waitFor();
  await foreign.page.locator('#assignmentSearch').fill(operator.displayName);
  assert.equal(await foreign.page.locator('#assignmentSearchResults [data-join-assignment]').count(), 0);
  assert.deepEqual([...ops.errors, ...trainee.errors, ...sameAnchorElsewhere.errors, ...foreign.errors], []);
});

test('local fallback uses the original XLSX/JSON path and labels only local save', { timeout: 90_000 }, async t => {
  const { server, excel, newPage } = await browserFixture(t);
  const ops = await newPage('/local/');
  const trainee = await newPage('/local/');
  await signInLocally(ops.page, 'operator', operator.displayName);
  await fillAssignment(ops.page, excel);
  await ops.page.locator('#publishAssignment').click();
  const exported = ops.page.waitForEvent('download');
  await ops.page.locator('[data-export-assignment]').click();
  const assignmentPackage = await exported;

  await signInLocally(trainee.page, 'anchor', anchor.displayName);
  await trainee.page.locator('#assignmentFold summary').click();
  await trainee.page.locator('#assignmentPackageImport').setInputFiles(await assignmentPackage.path());
  await trainee.page.locator('#toast').filter({ hasText: '作业包已导入本机' }).waitFor();
  if (!await trainee.page.locator('#assignmentFold').getAttribute('open') &&
      !await trainee.page.locator('#assignmentSearch').isVisible()) {
    await trainee.page.locator('#assignmentFold summary').click();
  }
  const eligible = trainee.page.locator('#assignmentSearchResults [data-join-assignment]').first();
  await textPractice(trainee.page, () => eligible.click());
  const receiptPromise = trainee.page.waitForEvent('download');
  await trainee.page.locator('#submitSession').click();
  const receipt = await receiptPromise;
  assert.match(receipt.suggestedFilename(), /作业提交回执/);
  await trainee.page.locator('#submitSession').filter({ hasText: /本机/ }).waitFor();
  assert.equal(server.requests.filter(r => r.path.startsWith('/api/') || r.path === '/test-auth').length, 0);
  assert.deepEqual([...ops.errors, ...trainee.errors], []);
});
