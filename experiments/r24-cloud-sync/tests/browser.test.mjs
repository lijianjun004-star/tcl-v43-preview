import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, acceptDownloads: true,
    });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === server.origin ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    const errors = [];
    const dialogs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => {
      dialogs.push(dialog.type());
      return dialog.accept();
    });
    await page.goto(server.origin + path, { waitUntil: 'domcontentloaded' });
    return { context, page, errors, dialogs };
  }
  return { server, excel, newPage };
}

const activationPath = '/api/tcl-r24-sync/device/activate';
const activationPosts = server => server.requests.filter(req =>
  req.path === activationPath && req.method === 'POST').length;
const identityBar = page => page.locator('.identity-bar');

async function submitName(page, displayName) {
  await page.locator('#syncDisplayName').fill(displayName);
  await page.locator('#syncLoginForm button[type="submit"]').click();
}

async function submitCode(page, code) {
  await page.locator('#syncActivationCode').fill(code);
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === activationPath &&
      response.request().method() === 'POST'),
    page.locator('#syncLoginForm button[type="submit"]').click(),
  ]);
  return response;
}

async function signIn(page, identity) {
  await submitName(page, identity.displayName);
  const response = await submitCode(page, identity.code);
  assert.ok(response.ok(), `Binding returned HTTP ${response.status()}`);
  await identityBar(page).filter({ hasText: identity.displayName }).waitFor();
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
  await signIn(ops.page, operator);
  await signIn(trainee.page, anchor);
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

  const binds = activationPosts(server);
  await trainee.page.reload({ waitUntil: 'domcontentloaded' });
  await submitName(trainee.page, anchor.displayName);
  await identityBar(trainee.page).filter({ hasText: anchor.displayName }).waitFor();
  assert.equal(activationPosts(server), binds);
  await trainee.page.locator('#assignmentFold summary').click();
  await trainee.page.locator('#assignmentSearch').fill(operator.displayName);
  await trainee.page.locator('#assignmentSearchResults .assignment-row')
    .filter({ hasText: '已提交到云端' }).waitFor();

  const foreign = await newPage();
  await signIn(foreign.page, identities.foreign);
  await foreign.page.locator('#assignmentFold').waitFor();
  await foreign.page.locator('#assignmentFold summary').click();
  await foreign.page.locator('#syncRefresh').click();
  await foreign.page.locator('#syncRefreshStatus').filter({ hasText: '已读取 0 份云端作业' }).waitFor();
  await foreign.page.locator('#assignmentSearch').fill(operator.displayName);
  assert.equal(await foreign.page.locator('#assignmentSearchResults [data-join-assignment]').count(), 0);
  assert.deepEqual([...ops.errors, ...trainee.errors, ...foreign.errors], []);
});

test('first browser requires a valid device code, same browser later uses name only', { timeout: 45_000 }, async t => {
  const { server, newPage } = await browserFixture(t);
  const primary = await newPage();
  await submitName(primary.page, operator.displayName);
  await primary.page.locator('#syncActivationCode').waitFor();
  assert.equal(await identityBar(primary.page).count(), 0);
  assert.equal(activationPosts(server), 0);

  const invalid = await submitCode(primary.page, 'R24-ffffffffffffffffffffffff');
  assert.equal(invalid.status(), 401);
  await primary.page.locator('#syncLoginError').filter({ hasText: /\S/ }).waitFor();
  assert.equal(await identityBar(primary.page).count(), 0);
  assert.equal(await primary.page.locator('[data-ops-tab="publish"]').count(), 0);

  const bound = await submitCode(primary.page, operator.code);
  assert.ok(bound.ok());
  await identityBar(primary.page).filter({ hasText: operator.displayName }).waitFor();
  await primary.page.locator('[data-ops-tab="publish"]').waitFor();
  const binds = activationPosts(server);
  const meBefore = server.requests.filter(req => req.path.endsWith('/me')).length;

  await primary.page.locator('#switchIdentity').click();
  await submitName(primary.page, operator.displayName);
  await identityBar(primary.page).filter({ hasText: operator.displayName }).waitFor();
  assert.equal(activationPosts(server), binds);
  assert.equal(await primary.page.locator('#syncActivationCode').count(), 0);
  assert.ok(server.requests.filter(req => req.path.endsWith('/me')).length > meBefore);

  const unknownDevice = await newPage();
  await submitName(unknownDevice.page, operator.displayName);
  await unknownDevice.page.locator('#syncActivationCode').waitFor();
  assert.equal(activationPosts(server), binds);
  assert.equal(await identityBar(unknownDevice.page).count(), 0);

  const wrongRoleCode = await submitCode(unknownDevice.page, anchor.code);
  assert.equal(wrongRoleCode.status(), 401);
  await unknownDevice.page.locator('#syncLoginError').filter({ hasText: /\S/ }).waitFor();
  assert.equal(await unknownDevice.page.locator('[data-ops-tab="publish"]').count(), 0);

  const usedCode = await submitCode(unknownDevice.page, operator.code);
  assert.equal(usedCode.status(), 401);
  assert.equal(await identityBar(unknownDevice.page).count(), 0);
  assert.deepEqual([...primary.errors, ...unknownDevice.errors], []);
});

test('login validates the 28-character R24 format and normalizes real clipboard paste', { timeout: 45_000 }, async t => {
  const { server, newPage } = await browserFixture(t);
  const { page, context, errors } = await newPage();
  const shortVersion = 'R24-20261124.1';
  const mode = page.locator('#modeText');
  const field = page.locator('#syncActivationCode');
  const submit = page.locator('#syncLoginForm button[type="submit"]');
  await page.locator('#syncReleaseVersion').filter({ hasText: shortVersion }).waitFor();
  await mode.filter({ hasText: /^云同步试点\s*·\s*未绑定设备$/ }).waitFor();

  await submitName(page, operator.displayName);
  await field.fill('ABCDEF1234567890');
  const activationsBeforeInvalidCode = activationPosts(server);
  await submit.click();
  const message = page.locator('#syncLoginError');
  await message.filter({ hasText: 'R24-' }).filter({ hasText: /28\s*个字符/ }).waitFor();
  assert.equal(activationPosts(server), activationsBeforeInvalidCode);
  assert.equal(await identityBar(page).count(), 0);

  const suffix = operator.code.slice(4);
  const copied = ` Ｒ２４－${suffix.slice(0, 9)}\n ${suffix.slice(9, 17)}\u200b\u3000${suffix.slice(17)}  `;
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(text => navigator.clipboard.writeText(text), copied);
  await field.focus();
  await field.press('ControlOrMeta+A');
  await field.press('ControlOrMeta+V');
  await page.waitForFunction(code =>
    document.querySelector('#syncActivationCode')?.value === code, operator.code);
  const [activated] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === activationPath &&
      response.request().method() === 'POST'),
    submit.click(),
  ]);
  assert.ok(activated.ok());
  assert.equal(activated.request().postDataJSON().code, operator.code);
  assert.equal(activationPosts(server), activationsBeforeInvalidCode + 1);
  await identityBar(page).filter({ hasText: operator.displayName }).waitFor();
  await mode.filter({ hasText: /^云同步试点\s*·\s*已绑定$/ }).waitFor();

  const deviceTools = page.locator('#syncDeviceTools');
  await deviceTools.locator('summary').click();
  await deviceTools.getByText(shortVersion, { exact: false }).first().waitFor();
  await deviceTools.getByText(/28\s*个字符/).first().waitFor();
  assert.deepEqual(errors, []);
});

const deviceCodePath = '/api/tcl-r24-sync/device/code';

async function generateCode(page) {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === deviceCodePath &&
      response.request().method() === 'POST'),
    page.locator('#syncGenerateDeviceCode').click(),
  ]);
  assert.ok(response.ok(), `Issue code returned HTTP ${response.status()}`);
  const result = await response.json();
  assert.match(result.code, /^R24-[a-f0-9]{24}$/);
  const remainingDays = (Date.parse(result.expiresAt) - Date.now()) / (24 * 60 * 60 * 1000);
  assert.ok(remainingDays >= 89.9 && remainingDays <= 90);
  await page.waitForFunction(code =>
    document.querySelector('#syncGeneratedDeviceCode')?.value === code, result.code);
  return result.code;
}

test('bound device can generate, copy, save, and renew one-time codes for a fresh browser', { timeout: 60_000 }, async t => {
  const { server, excel, newPage } = await browserFixture(t);
  const unconfirmed = await fetch(server.origin + deviceCodePath, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(unconfirmed.status, 401);

  const first = await newPage();
  await first.context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(first.page, operator);
  await fillAssignment(first.page, excel);
  const [published] = await Promise.all([
    first.page.waitForResponse(response => response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/tcl-r24-sync/assignments'),
    first.page.locator('#publishAssignment').click(),
  ]);
  assert.ok(published.ok());
  const { assignment } = await published.json();

  await first.page.locator('#syncDeviceTools summary').click();
  const earlierCode = await generateCode(first.page);
  assert.deepEqual(first.dialogs, []);
  assert.notEqual(await first.page.locator('#syncGeneratedDeviceCode').getAttribute('readonly'), null);

  await first.page.locator('#syncCopyDeviceCode').click();
  await first.page.waitForFunction(async code =>
    await navigator.clipboard.readText() === code, earlierCode);
  const [download] = await Promise.all([
    first.page.waitForEvent('download'),
    first.page.locator('#syncSaveDeviceCode').click(),
  ]);
  const saved = await readFile(await download.path(), 'utf8');
  assert.ok(saved.includes(earlierCode));

  const currentCode = await generateCode(first.page);
  assert.notEqual(currentCode, earlierCode);
  assert.equal(first.dialogs.filter(type => type === 'confirm').length, 1);

  const second = await newPage();
  await submitName(second.page, operator.displayName);
  const stale = await submitCode(second.page, earlierCode);
  assert.equal(stale.status(), 401);
  assert.equal(await identityBar(second.page).count(), 0);
  const accepted = await submitCode(second.page, currentCode);
  assert.ok(accepted.ok());
  await identityBar(second.page).filter({ hasText: operator.displayName }).waitFor();
  await second.page.locator('[data-ops-tab="tracking"]').click();
  const sameAssignment = second.page.locator(`[data-sync-submissions="${assignment.id}"]`);
  await sameAssignment.waitFor();
  assert.equal(await sameAssignment.count(), 1);

  const third = await newPage();
  await submitName(third.page, operator.displayName);
  const spent = await submitCode(third.page, currentCode);
  assert.equal(spent.status(), 401);
  assert.equal(await identityBar(third.page).count(), 0);
  assert.deepEqual([...first.errors, ...second.errors, ...third.errors], []);
});

test('login device-code shortcut guides fresh browsers and opens the panel after verified name entry', { timeout: 45_000 }, async t => {
  const { server, newPage } = await browserFixture(t);
  const { page, errors } = await newPage();
  const openCodeTools = page.locator('#syncOpenDeviceCode');
  const name = page.locator('#syncDisplayName');
  const apiRequests = () => server.requests.filter(request => request.path.startsWith('/api/'));
  const codePosts = () => server.requests.filter(request => request.method === 'POST' &&
    request.path === deviceCodePath).length;

  const guide = page.locator('#syncDeviceCodeEntryGuide');
  await openCodeTools.click();
  await guide.filter({ hasText: '先填写姓名' }).waitFor();
  await page.waitForFunction(() => document.activeElement?.id === 'syncDisplayName');
  assert.equal(await name.inputValue(), '');
  assert.deepEqual(apiRequests(), []);
  assert.equal(await page.locator('#syncActivationCode').isVisible(), false);

  await name.fill(operator.displayName);
  await openCodeTools.click();
  await page.locator('#syncActivationCode').waitFor();
  await guide.filter({ hasText: '设备需要先绑定' }).waitFor();
  assert.equal(await identityBar(page).count(), 0);
  assert.equal(await page.locator('#syncDeviceTools').count(), 0);
  assert.deepEqual(apiRequests(), []);

  const bound = await submitCode(page, operator.code);
  assert.ok(bound.ok());
  await identityBar(page).filter({ hasText: operator.displayName }).waitFor();
  const activationBefore = activationPosts(server);
  const issueBefore = codePosts();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await name.fill(operator.displayName);
  const [verification] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/tcl-r24-sync/me'),
    openCodeTools.click(),
  ]);
  assert.ok(verification.ok());
  await page.locator('#syncDeviceTools[open] #syncGenerateDeviceCode').waitFor();
  await identityBar(page).filter({ hasText: operator.displayName }).waitFor();
  assert.equal(activationPosts(server), activationBefore);
  assert.equal(codePosts(), issueBefore);
  assert.deepEqual(errors, []);
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
  assert.equal(server.requests.filter(r => r.path.startsWith('/api/')).length, 0);
  assert.deepEqual([...ops.errors, ...trainee.errors], []);
});
