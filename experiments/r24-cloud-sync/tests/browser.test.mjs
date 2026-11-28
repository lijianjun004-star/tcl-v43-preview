import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';
import { createAiGatewayClient, createHunyuanClient } from '../backend/ai-gateway-client.mjs';
import { startTestSite, identities } from './test-site.mjs';

const fixtureScript = new URL('./fixtures.py', import.meta.url);
const executablePath = process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium';
const operator = identities.operator;
const anchor = identities.anchor;
const assignmentTitle = '合成跨设备三题作业';
const questions = [1, 2, 3].map(index => `请介绍 TEST-A${index} 的合成测试功能？`);
const answers = [1, 2, 3].map(index => `人工回答第${index}题：TEST-A${index} 为合成型号，信息仅用于流程测试。`);

async function browserFixture(t, options) {
  const work = await mkdtemp(join(tmpdir(), 'tcl-sync-browser-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const excel = join(work, 'three-questions.xlsx');
  await promisify(execFile)('python3', [fixtureScript.pathname, excel]);

  const server = await startTestSite(options);
  t.after(() => server.close());
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  t.after(() => browser.close());

  async function newPage(path = '/sync/', width = 390, {useClock = false} = {}) {
    const context = await browser.newContext({
      viewport: { width, height: width === 375 ? 812 : 844 }, acceptDownloads: true,
    });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin === server.origin ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    if (useClock) await page.clock.install();
    page.setDefaultTimeout(12_000);
    const errors = [];
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    const dialogs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => {
      dialogs.push(dialog.type());
      return dialog.accept();
    });
    await page.goto(server.origin + path, { waitUntil: 'domcontentloaded' });
    return { context, page, errors, consoleErrors, dialogs };
  }
  return { server, excel, newPage };
}

const activationPath = '/api/tcl-r24-sync/device/activate';
const draftPath = '/api/tcl-r24-sync/assignments/draft';
const draftResponse = (method, response) => response.request().method() === method &&
  new URL(response.url()).pathname === draftPath;
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

async function makeCapacityFixtures(excel) {
  const directory = dirname(excel);
  const largest = join(directory, 'expanded-xlsx-limit.xlsx');
  const beyond = join(directory, 'above-xlsx-limit.xlsx');
  const entryBeyond = join(directory, 'above-xlsx-single-entry-limit.xlsx');
  // Reuse the valid worksheet from the normal fixture. Additional XML parts
  // make the workbook exercise the exact byte caps without retaining binaries.
  await promisify(execFile)('python3', ['-c', `
from base64 import b64encode
from pathlib import Path
from random import Random
from sys import argv
from zipfile import ZipFile, ZIP_DEFLATED

mib = 1024 * 1024
with ZipFile(argv[1]) as src:
    workbook = [(entry.filename, src.read(entry)) for entry in src.infolist()]

def make_xlsx(path, sizes):
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        for name, content in workbook:
            archive.writestr(name, content)
        noise = Random(316)
        for index, size in enumerate(sizes):
            opening = b'<synthetic-fixture>'
            closing = b'</synthetic-fixture>'
            sample = b64encode(noise.randbytes(256 * 1024))
            archive.writestr(f'customXml/item{index}.xml',
                opening + sample + b' ' * (size - len(opening) - len(closing) - len(sample)) + closing)

base = sum(len(content) for _, content in workbook)
for path, total in [(argv[2], 50 * mib), (argv[3], 50 * mib + 1)]:
    full, rest = divmod(total - base, 8 * mib)
    make_xlsx(path, [8 * mib] * full + [rest])
    with ZipFile(path) as archive:
        entries = archive.infolist()
        assert sum(entry.file_size for entry in entries) == total
        assert Path(path).stat().st_size < 15 * mib
        assert all(entry.file_size <= 12 * mib and entry.file_size / entry.compress_size <= 120 for entry in entries)
make_xlsx(argv[4], [12 * mib + 1])
`, excel, largest, beyond, entryBeyond]);
  return { largest, beyond, entryBeyond };
}

async function startTextPractice(page, enter) {
  if (enter) await enter();
  const start = page.locator('#startScene');
  await start.waitFor();
  const textMode = page.locator('#prepQuickText');
  if (await textMode.isVisible()) await textMode.click();
  await start.click();
}

async function textPractice(page, enter, {finishWithBlankAnswer = false} = {}) {
  await startTextPractice(page, enter);
  for (const [index, question] of questions.entries()) {
    await page.locator('#liveQText').filter({ hasText: question }).waitFor();
    if (finishWithBlankAnswer && index === questions.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 710));
      await page.locator('#focusNext').filter({hasText: '结束并核对'}).click();
      await page.locator('#tclEndYes').click();
      await page.locator('#reviewDetails').waitFor();
      return;
    }
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

async function checkFinalActionSpacing(page) {
  const [next, mic] = await Promise.all([
    page.locator('#focusNext').boundingBox(),
    page.locator('#focusMic').boundingBox(),
  ]);
  assert.ok(next && mic, 'Both final question controls must be visible');
  const overlaps = next.x < mic.x + mic.width && mic.x < next.x + next.width &&
    next.y < mic.y + mic.height && mic.y < next.y + next.height;
  assert.equal(overlaps, false, 'Final controls overlap: ' + JSON.stringify({next, mic}));
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

test('assignment XLSX accepts 50 MiB unpacked and keeps both the default and single-entry limits', { timeout: 60_000 }, async t => {
  const { server, excel, newPage } = await browserFixture(t);
  const { largest, beyond, entryBeyond } = await makeCapacityFixtures(excel);
  const { page, errors } = await newPage();
  await signIn(page, operator);
  await fillAssignment(page, largest);

  const input = page.locator('#assignmentExcelFile');
  const normalImport = await input.evaluate(async field => {
    const { parseDocumentFile } = await import(new URL('./lib/parser.js', document.baseURI));
    try {
      await parseDocumentFile(field.files[0]);
      return null;
    } catch (error) {
      return error.message;
    }
  });
  assert.match(normalImport, /文档解压后总容量超过/);

  const cases = [
    [beyond, /文档解压后总容量超过/],
    [entryBeyond, /文档内部单文件体积过大/]
  ];
  for (const [file, error] of cases) {
    await input.setInputFiles(file);
    await page.locator('#assignmentExcelPreviewBtn').click();
    await page.locator('#assignmentExcelPreview').filter({ hasText: error }).waitFor();
    await page.locator('#publishAssignment').click();
    await page.locator('#toast').filter({ hasText: '请先上传Excel并完成预览' }).waitFor();
  }
  assert.equal(server.requests.filter(req => req.method === 'POST' && req.path.endsWith('/assignments')).length, 0);

  await fillAssignment(page, largest);
  const publishing = page.waitForResponse(resp => resp.request().method() === 'POST' && resp.url().endsWith('/assignments'));
  await page.locator('#publishAssignment').click();
  const published = await publishing;
  assert.equal(published.status(), 201);
  const { assignment } = await published.json();
  assert.deepEqual(assignment.questions.map(row => row.question), questions);
  assert.deepEqual(errors, []);
});

test('operator reviews an AI draft made from text or Excel before sharing its barrage with an anchor', { timeout: 60_000 }, async t => {
  const { server, excel, newPage } = await browserFixture(t, {
    draftGeneration: {
      canGenerate: () => false,
      async generate() { assert.fail('an operator outside the model allowlist must stay on the manual flow'); },
    },
  });
  const { page, context, errors } = await newPage();
  const title = '合成安装场景：AI 草稿转作业';
  const sourceText = '合成资料：电视到货前需要确认包装尺寸和安装位置。';
  const exampleReply = {
    questions: [
      { question: '电视能搬进电梯吗？', answer: '先核对包装尺寸和电梯门净宽。', keyPoints: ['包装尺寸', '电梯门净宽'] },
      { question: '挂装前需要确认什么？', answer: '先确认墙面和插座位置。', keyPoints: ['墙面', '插座'] },
      { question: '送货前需要准备什么？', answer: '先预留通道并确认入户时间。', keyPoints: ['预留通道'] },
    ],
  };
  const firstEdit = '电梯门很窄，怎么确认电视能搬进家？';
  const finalQuestion = '电梯门很窄，电视外箱该量哪几个尺寸？';
  const assignmentPosts = () => server.requests.filter(req =>
    req.method === 'POST' && req.path.endsWith('/assignments')).length;

  await signIn(page, operator);
  await page.locator('[data-ops-tab="publish"]').click();
  await page.locator('#assignmentBoard').selectOption('01');
  await page.locator('#assignmentPlatform').selectOption('京东');
  const panel = page.locator('#assignmentDraftPanel');
  const [availability] = await Promise.all([
    page.waitForResponse(response => draftResponse('GET', response)),
    panel.locator('summary').click(),
  ]);
  assert.deepEqual(await availability.json(), { available: false });
  assert.equal(await panel.locator('#assignmentDraftGenerate').isVisible(), false);
  await checkNoOverflow(page);

  await panel.locator('#assignmentDraftSourceMode').selectOption('text');
  await panel.locator('#assignmentDraftCount').selectOption('3');
  const source = panel.locator('#assignmentDraftSourceText');
  await source.fill(sourceText);
  const titleField = page.locator('#assignmentTitle');
  assert.equal(await titleField.inputValue(), '');
  await Promise.all([
    page.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith('/assignments')),
    page.locator('#syncRefresh').click(),
  ]);
  await page.locator('#syncRefresh:not([disabled])').waitFor();
  assert.equal(await panel.evaluate(details => details.open), true);
  assert.equal(await source.inputValue(), sourceText);
  await titleField.fill(title);

  await panel.locator('#assignmentDraftBuildPrompt').click();
  const prompt = panel.locator('#assignmentDraftPrompt');
  const fromText = await prompt.inputValue();
  assert.ok(fromText.includes(sourceText));
  assert.match(fromText, /"questions"/);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await panel.locator('#assignmentDraftCopyPrompt').click();
  await page.waitForFunction(async text => await navigator.clipboard.readText() === text, fromText);

  await panel.locator('#assignmentDraftSourceMode').selectOption('table');
  await panel.locator('#assignmentDraftSourceFile').setInputFiles(excel);
  await panel.locator('#assignmentDraftBuildPrompt').click();
  await page.waitForFunction(question =>
    document.querySelector('#assignmentDraftPrompt')?.value.includes(question), questions[0]);
  const fromTable = await prompt.inputValue();
  assert.doesNotMatch(fromTable, /合成资料：电视到货前/);
  assert.ok(fromTable.includes(questions[2]));

  // A synthetic response stands in for the copy sent to an AI tool and pasted back by the operator.
  await panel.locator('#assignmentDraftResponse').fill(JSON.stringify(exampleReply));
  await panel.locator('#assignmentDraftReadResponse').click();
  const rows = panel.locator('[data-assignment-draft-row]');
  await rows.nth(2).waitFor();
  const question = rows.first().locator('[data-draft-field="question"]');
  await question.fill(firstEdit);
  await panel.locator('#assignmentDraftConfirm').click();
  const preview = page.locator('#assignmentExcelPreview');
  await preview.filter({ hasText: firstEdit }).waitFor();
  assert.equal(assignmentPosts(), 0);

  await question.fill(finalQuestion);
  assert.doesNotMatch(await preview.textContent(), /电梯门很窄，怎么确认电视能搬进家/);
  await page.locator('#publishAssignment').click();
  await page.locator('#toast').filter({ hasText: /确认草稿/ }).waitFor();
  assert.equal(assignmentPosts(), 0);

  await panel.locator('#assignmentDraftConfirm').click();
  await preview.filter({ hasText: finalQuestion }).waitFor();
  const [published] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/assignments')),
    page.locator('#publishAssignment').click(),
  ]);
  assert.equal(published.status(), 201);
  assert.equal(assignmentPosts(), 1);
  const { assignment } = await published.json();
  assert.equal(assignment.title, title);
  assert.deepEqual(assignment.questions.map(row => row.question), [
    finalQuestion, ...exampleReply.questions.slice(1).map(row => row.question),
  ]);
  assert.equal(assignment.questions[0].answer, exampleReply.questions[0].answer);
  assert.deepEqual(assignment.questions[0].keyPoints, exampleReply.questions[0].keyPoints);
  const posted = JSON.stringify(published.request().postDataJSON());
  assert.ok(!posted.includes(sourceText));
  assert.ok(!posted.includes(questions[0]));

  const trainee = await newPage();
  await signIn(trainee.page, anchor);
  await trainee.page.locator('#assignmentFold summary').click();
  await trainee.page.locator('#assignmentSearch').fill(operator.displayName);
  await trainee.page.locator('#syncRefresh').click();
  await startTextPractice(trainee.page,
    () => trainee.page.locator(`#assignmentSearchResults [data-join-assignment="${assignment.id}"]`).click());
  await trainee.page.locator('#liveQText').filter({ hasText: finalQuestion }).waitFor();
  assert.deepEqual([...errors, ...trainee.errors], []);
});

test('one-click cloud drafts use text and Excel, discard stale results, and publish only after review', { timeout: 60_000 }, async t => {
  const firstStarted = Promise.withResolvers();
  const releaseFirst = Promise.withResolvers();
  const calls = [];
  const staleQuestion = '这道已换资料的题目不应出现在编辑器中。';
  const textQuestion = '电视配送前应该量哪些位置？';
  const tableQuestion = '送装前应提前核对哪些合成型号资料？';
  const finalQuestion = '安装前我应该核对哪些资料和型号？';
  const exampleAnswer = '请对照商品页核对产品型号、包装尺寸和安装环境。';
  const examplePoints = ['产品型号', '包装尺寸', '安装环境'];
  const { server, excel, newPage } = await browserFixture(t, {
    draftGeneration: {
      canGenerate: principal => principal.id === operator.id,
      async generate(principal, prompt) {
        calls.push({ principal: principal.id, prompt });
        const number = calls.length;
        if (number === 1) {
          firstStarted.resolve();
          await releaseFirst.promise;
        }
        const question = [staleQuestion, textQuestion, tableQuestion][number - 1];
        return { questions: [{ question, answer: exampleAnswer, keyPoints: examplePoints }], httpStatus: 200, retryCount: 0, usage: null };
      },
    },
  });
  const { page, errors } = await newPage();
  const title = '合成一键出题作业';
  const sourceText = '合成电视送装资料：先核对入户门和电梯空间。';
  const newerSource = '合成电视配送资料：核对包装尺寸、入户门及楼道宽度。';
  const assignmentPosts = () => server.requests.filter(req =>
    req.method === 'POST' && req.path.endsWith('/assignments')).length;

  try {
    await signIn(page, operator);
    await page.locator('[data-ops-tab="publish"]').click();
    await page.locator('#assignmentTitle').fill(title);
    await page.locator('#assignmentBoard').selectOption('01');
    await page.locator('#assignmentPlatform').selectOption('京东');
    const panel = page.locator('#assignmentDraftPanel');
    const [capability] = await Promise.all([
      page.waitForResponse(response => draftResponse('GET', response)),
      panel.locator('summary').click(),
    ]);
    assert.deepEqual(await capability.json(), { available: true });
    const generate = panel.locator('#assignmentDraftGenerate');
    await generate.waitFor();
    await panel.locator('#assignmentDraftCount').selectOption('3');
    const source = panel.locator('#assignmentDraftSourceText');
    await source.fill(sourceText);
    await generate.click();
    await firstStarted.promise;
    assert.equal(await generate.isDisabled(), true);
    await generate.dispatchEvent('click');
    await source.fill(newerSource);
    releaseFirst.resolve();
    await panel.locator('#assignmentDraftGenerate:not([disabled])').waitFor();
    const rows = panel.locator('[data-assignment-draft-row]');
    assert.equal(server.requests.filter(req => req.method === 'POST' && req.path === draftPath).length, 1);
    assert.equal(await rows.count(), 0);
    assert.equal(assignmentPosts(), 0);

    const [fromText] = await Promise.all([
      page.waitForResponse(response => draftResponse('POST', response)),
      generate.click(),
    ]);
    assert.equal(fromText.status(), 200);
    const textResult = await fromText.json();
    assert.equal(textResult.source, 'openai_gateway');
    assert.equal(textResult.degraded, false);
    await panel.locator('#assignmentDraftOrigin').filter({ hasText: textResult.requestId }).waitFor();
    assert.match(await panel.locator('#assignmentDraftOrigin').textContent(), /AI 出题草稿 · OpenAI/);
    assert.deepEqual(fromText.request().postDataJSON(), {
      material: newerSource, boardId: '01', platform: '京东', count: 3,
    });
    const question = rows.first().locator('[data-draft-field="question"]');
    await page.waitForFunction(expected =>
      document.querySelector('[data-draft-field="question"]')?.value === expected, textQuestion);

    await panel.locator('#assignmentDraftSourceMode').selectOption('table');
    await panel.locator('#assignmentDraftSourceFile').setInputFiles(excel);
    const [fromTable] = await Promise.all([
      page.waitForResponse(response => draftResponse('POST', response)),
      generate.click(),
    ]);
    assert.equal(fromTable.status(), 200);
    const { material, ...settings } = fromTable.request().postDataJSON();
    assert.deepEqual(settings, { boardId: '01', platform: '京东', count: 3 });
    assert.ok(material.includes(questions[0]) && material.includes(questions[2]));
    assert.equal(material.includes(newerSource), false);
    assert.deepEqual(calls.map(call => call.principal), [operator.id, operator.id, operator.id]);
    assert.ok(calls[0].prompt.includes(sourceText));
    assert.ok(calls[1].prompt.includes(newerSource));
    assert.ok(calls[2].prompt.includes(questions[2]));
    await page.waitForFunction(expected =>
      document.querySelector('[data-draft-field="question"]')?.value === expected, tableQuestion);

    await question.fill(finalQuestion);
    await page.locator('#publishAssignment').click();
    await page.locator('#toast').filter({ hasText: /确认草稿/ }).waitFor();
    assert.equal(assignmentPosts(), 0);
    await panel.locator('#assignmentDraftConfirm').click();
    await page.locator('#assignmentExcelPreview').filter({ hasText: finalQuestion }).waitFor();
    const [published] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/assignments')),
      page.locator('#publishAssignment').click(),
    ]);
    assert.equal(published.status(), 201);
    assert.equal(assignmentPosts(), 1);
    const { assignment } = await published.json();
    assert.equal(assignment.title, title);
    assert.equal(assignment.questions.length, 1);
    assert.equal(assignment.questions[0].question, finalQuestion);
    assert.equal(assignment.questions[0].answer, exampleAnswer);
    assert.deepEqual(assignment.questions[0].keyPoints, examplePoints);
    assert.equal(JSON.stringify(published.request().postDataJSON()).includes(material), false);

    const trainee = await newPage();
    await signIn(trainee.page, anchor);
    await trainee.page.locator('#assignmentFold summary').click();
    await trainee.page.locator('#assignmentSearch').fill(operator.displayName);
    await trainee.page.locator('#syncRefresh').click();
    await startTextPractice(trainee.page,
      () => trainee.page.locator(`#assignmentSearchResults [data-join-assignment="${assignment.id}"]`).click());
    await trainee.page.locator('#liveQText').filter({ hasText: finalQuestion }).waitFor();
    assert.deepEqual([...errors, ...trainee.errors], []);
  } finally {
    releaseFirst.resolve();
  }
});

test('operator can distinguish a gateway failure and a local fallback through editing, confirmation and publishing', { timeout: 60_000 }, async t => {
  const { newPage, server } = await browserFixture(t, {
    draftGeneration: {
      canGenerate: principal => principal.id === operator.id,
      fallbackEnabled: true,
      async generate() {
        throw Object.assign(new Error('mock upstream details'), {code: 'GATEWAY_HTTP_502', httpStatus: 502, retryCount: 1});
      },
    },
  });
  const { page, errors } = await newPage();
  await signIn(page, operator);
  await page.locator('[data-ops-tab="publish"]').click();
  await page.locator('#assignmentTitle').fill('合成兜底练习');
  const panel = page.locator('#assignmentDraftPanel');
  await panel.locator('summary').click();
  const generate = panel.locator('#assignmentDraftGenerate');
  const material = panel.locator('#assignmentDraftSourceText');
  const origin = panel.locator('#assignmentDraftOrigin');
  const status = panel.locator('#assignmentDraftCloudStatus');
  const draft = {question: '大屏电视送到前要量什么？', answer: '请测量通道净宽并核对包装尺寸。', keyPoints: ['通道净宽', '包装尺寸']};
  const postDraft = async () => {
    const [response] = await Promise.all([
      page.waitForResponse(r => draftResponse('POST', r)), generate.click(),
    ]);
    await panel.locator('#assignmentDraftGenerate:not([disabled])').waitFor();
    return response;
  };

  await material.fill('只有背景资料，没有现成的答案。');
  const failure = await postDraft();
  const failed = await failure.json();
  assert.equal(failure.ok(), false);
  await status.filter({ hasText: failed.requestId }).waitFor();
  assert.match(await status.textContent(), /GATEWAY_HTTP_502.*已重试 1 次/);
  assert.doesNotMatch(await status.textContent(), /mock upstream details/);
  assert.equal(await panel.locator('[data-assignment-draft-row]').count(), 0);

  // A mixed-version or malformed HTTP success must not label arbitrary questions as AI output.
  for (const metadata of [
    {source: 'fallback', degraded: false},
    {source: 'openai_gateway', model: 'hy3-preview', degraded: false},
    {source: 'cloudbase_hunyuan', model: 'gpt-4o-mini', degraded: false},
  ]) {
    await page.route('**' + draftPath, route => route.fulfill({
      json: {questions: [draft], ...metadata},
    }), {times: 1});
    await postDraft();
    await status.filter({hasText: 'INVALID_AI_JSON'}).waitFor();
    assert.equal(await panel.locator('[data-assignment-draft-row]').count(), 0);
  }

  await material.fill(JSON.stringify({questions: [draft]}));
  const fallback = await (await postDraft()).json();
  assert.equal(fallback.source, 'fallback');
  await origin.filter({hasText: fallback.requestId}).waitFor();
  assert.match(await origin.textContent(), /本地兜底草稿.*GATEWAY_HTTP_502.*已重试 1 次/);
  assert.doesNotMatch(await status.textContent(), /草稿已生成/);
  await checkNoOverflow(page);
  await panel.locator('[data-draft-field="question"]').fill('电视送到家前需要准备什么？');
  await origin.filter({hasText: fallback.requestId}).waitFor();
  const points = panel.locator('[data-draft-field="keyPoints"]');
  await points.fill('');
  await panel.locator('#assignmentDraftConfirm').click();
  await panel.locator('#assignmentDraftStatus').filter({hasText: '至少需要一条评分要点'}).waitFor();
  await points.fill(draft.keyPoints.join('\n'));
  const platform = page.locator('#assignmentPlatform');
  const originalPlatform = await platform.inputValue();
  await platform.selectOption({index: 1});
  await panel.locator('#assignmentDraftConfirm').click();
  await panel.locator('#assignmentDraftStatus').filter({hasText: '请按当前范围重新出题'}).waitFor();
  await platform.selectOption(originalPlatform);
  await panel.locator('#assignmentDraftConfirm').click();
  await page.locator('#assignmentExcelPreview').filter({hasText: '本地兜底草稿已确认'}).waitFor();
  await origin.filter({hasText: fallback.requestId}).waitFor();
  assert.equal(server.requests.filter(req => req.method === 'POST' && req.path.endsWith('/assignments')).length, 0);
  const [published] = await Promise.all([
    page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/assignments')),
    page.locator('#publishAssignment').click(),
  ]);
  assert.equal(published.status(), 201);
  assert.match((await published.json()).assignment.questions[0].source, /本地兜底草稿/);
  assert.deepEqual(errors, []);
});

test('a new browser requires a valid code and a different role on a bound browser requires explicit confirmation', { timeout: 45_000 }, async t => {
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
  const useBoundRole = primary.page.getByRole('button', { name: '以直播运营身份进入', exact: true });
  await useBoundRole.waitFor();
  assert.equal(await primary.page.locator('#syncRole').inputValue(), 'anchor');
  assert.match(await primary.page.locator('#syncDeviceCodeEntryGuide').textContent(), /已登记为【直播运营】/);
  assert.equal(await identityBar(primary.page).count(), 0);
  assert.equal(activationPosts(server), binds);
  await primary.page.reload();
  await primary.page.locator('#syncDisplayName').waitFor();
  assert.equal(await identityBar(primary.page).count(), 0);
  await submitName(primary.page, operator.displayName);
  await useBoundRole.click();
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
  assert.equal(usedCode.status(), 409);
  assert.equal((await usedCode.json()).errorCode, 'CODE_USED');
  assert.equal(await identityBar(unknownDevice.page).count(), 0);
  assert.deepEqual([...primary.errors, ...unknownDevice.errors], []);
});

test('login validates the 28-character R24 format and normalizes real clipboard paste', { timeout: 45_000 }, async t => {
  const { server, newPage } = await browserFixture(t);
  const { page, context, errors } = await newPage();
  const shortVersion = 'R24-20261124.13-shared.1';
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
  await mode.filter({ hasText: /^云同步试点\s*·\s*已绑定（直播运营 · 合成验收运营）$/ }).waitFor();

  const deviceTools = page.locator('#syncDeviceTools');
  await deviceTools.locator('summary').click();
  await deviceTools.getByText(shortVersion, { exact: false }).first().waitFor();
  await deviceTools.getByText(/28\s*个字符/).first().waitFor();
  assert.deepEqual(errors, []);
});

const deviceCodePath = '/api/tcl-r24-sync/device/code';

async function generateCode(page, button = page.locator('#syncGenerateDeviceCode')) {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === deviceCodePath &&
      response.request().method() === 'POST'),
    button.click(),
  ]);
  assert.ok(response.ok(), `Issue code returned HTTP ${response.status()}`);
  const result = await response.json();
  assert.match(result.code, /^R24-[a-f0-9]{24}$/);
  const remainingMinutes = (Date.parse(result.expiresAt) - Date.now()) / 60_000;
  assert.ok(remainingMinutes >= 29 && remainingMinutes <= 31);
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
  assert.equal(saved, earlierCode);

  const generator = first.page.locator('#syncGenerateDeviceCode');
  const confirmation = first.page.getByRole('dialog', { name: '重新生成设备码？', exact: true });
  const issuePostsBefore = server.requests.filter(req => req.path === deviceCodePath).length;
  await generator.click();
  await confirmation.waitFor();
  assert.equal(server.requests.filter(req => req.path === deviceCodePath).length, issuePostsBefore);
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await confirmation.waitFor({ state: 'hidden' });
  assert.equal(await first.page.locator('#syncGeneratedDeviceCode').inputValue(), earlierCode);
  await generator.click();
  const currentCode = await generateCode(first.page, confirmation.getByRole('button', { name: '确认重新生成', exact: true }));
  assert.notEqual(currentCode, earlierCode);
  assert.deepEqual(first.dialogs, []);

  const second = await newPage();
  await submitName(second.page, operator.displayName);
  const stale = await submitCode(second.page, earlierCode);
  assert.equal(stale.status(), 401);
  assert.equal((await stale.json()).errorCode, 'CODE_EXPIRED');
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
  assert.equal(spent.status(), 409);
  assert.equal((await spent.json()).errorCode, 'CODE_USED');
  assert.equal(await identityBar(third.page).count(), 0);

  await first.page.route('**' + deviceCodePath, async route => {
    await first.page.locator('#syncDeviceCodeStatus').filter({ hasText: '正在生成设备码' }).waitFor();
    assert.equal(await generator.isDisabled(), true);
    await route.fulfill({ status: 503, json: { error: { message: '暂时无法签发' } } });
  }, { times: 1 });
  await generator.click();
  await confirmation.getByRole('button', { name: '确认重新生成', exact: true }).click();
  await first.page.locator('#syncDeviceCodeStatus').filter({ hasText: '暂时无法签发' })
    .filter({ hasText: '旧码状态未确认' }).waitFor();
  assert.equal(await first.page.locator('#syncDeviceCodeResult').isVisible(), false);
  assert.equal(await generator.isEnabled(), true);
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
  await guide.filter({ hasText: '请填写已绑定的姓名' }).waitFor();
  await page.waitForFunction(() => document.activeElement?.id === 'syncDisplayName');
  assert.equal(await name.inputValue(), '');
  assert.deepEqual(apiRequests(), []);
  assert.equal(await page.locator('#syncActivationCode').isVisible(), false);

  await name.fill(operator.displayName);
  await openCodeTools.click();
  await guide.filter({ hasText: '生成设备码需要已绑定的设备' }).waitFor();
  assert.equal(await identityBar(page).count(), 0);
  assert.equal(await page.locator('#syncDeviceTools').count(), 0);
  assert.deepEqual(apiRequests(), []);
  assert.equal(await page.locator('#syncActivationCode').isVisible(), false);

  await submitName(page, operator.displayName);
  const bound = await submitCode(page, operator.code);
  assert.ok(bound.ok());
  await identityBar(page).filter({ hasText: operator.displayName }).waitFor();
  const activationBefore = activationPosts(server);
  const issueBefore = codePosts();

  await page.locator('#switchIdentity').click();
  await name.fill(operator.displayName);
  const [verification] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/tcl-r24-sync/me'),
    openCodeTools.click(),
  ]);
  assert.ok(verification.ok());
  await page.getByRole('button', { name: '以直播运营身份打开生成器', exact: true }).click();
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

test('reload restores the cloud workspace and saved review even while assignments are loading', { timeout: 60_000 }, async t => {
  const { excel, newPage } = await browserFixture(t);
  const ops = await newPage();
  const { page, errors } = await newPage();
  await ops.page.locator('#syncRole').selectOption('operator');
  await signIn(ops.page, operator);
  await fillAssignment(ops.page, excel);
  await ops.page.locator('#publishAssignment').click();
  await ops.page.locator('#ops-tracking').getByText(assignmentTitle, { exact: true }).waitFor({ state: 'attached' });

  await signIn(page, anchor);
  const count = page.locator('.r2-stats div').filter({ hasText: '待完成作业' }).locator('b');
  await count.filter({ hasText: '1' }).waitFor();
  await page.locator('#freePractice').click();
  await page.locator('#prepQuickText').click();
  await page.locator('#startScene').click();
  await page.locator('#focusMic').click();
  const answer = '刷新后仍可恢复这段合成回答';
  await page.locator('#liveTextAnswer').fill(answer);
  await page.locator('#liveTextSave').click();
  await page.locator('#focusClose').click();
  await page.getByRole('button', { name: '结束并进入复盘', exact: true }).click();
  await page.locator('#localSessionSaveStatus[data-status="saved"]').waitFor();
  await page.locator('#reviewHome').click();
  await page.locator('[data-resume-review]').filter({ hasText: '上一场还没提交' }).waitFor();

  const configGate = Promise.withResolvers(), assignmentGate = Promise.withResolvers();
  try {
    await page.route('**/sync/app-config.json', async route => {
      await configGate.promise;
      await route.continue();
    }, { times: 1 });
    await page.route('**/api/tcl-r24-sync/assignments', async route => {
      await assignmentGate.promise;
      await route.continue();
    }, { times: 1 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const firstMode = await page.locator('#modeText').textContent();
    const firstContent = await page.locator('#view').textContent();
    configGate.resolve();
    await page.locator('#modeText').filter({ hasText: '云同步试点 · 已绑定' }).waitFor();
    const whileLoadingCount = await count.textContent();
    const pendingReview = page.locator('#restoreLocalSession');
    const checkpointBeforeCloud = await pendingReview.textContent({ timeout: 1000 }).catch(() => '');

    // Recreate the home DOM while the original automatic request is still awaiting its result.
    await page.locator('[data-quick-page="progress"]').click();
    await page.locator('[data-quick-page="home"]').click();
    assignmentGate.resolve();
    assert.match(firstMode, /云同步试点 · 正在连接/);
    assert.match(firstContent, /正在加载练播房/);
    assert.equal(whileLoadingCount, '—');
    assert.match(checkpointBeforeCloud, /上一场还没提交/);
    await count.filter({ hasText: '1' }).waitFor();
    await pendingReview.click();
    await page.locator('#reviewDetails').click();
    await page.locator('#questionSummary').getByText(answer, { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    configGate.resolve();
    assignmentGate.resolve();
  }
});

const practiceDraft = [
  { question: '送电视前要量什么尺寸？', answer: '请对照包装尺寸测量电梯门和入户通道。', keyPoints: ['包装尺寸', '通道净宽'] },
  { question: '怎样比较球赛中的运动画面？', answer: '用同一段回放对比球的轨迹和球衣号码。', keyPoints: ['同一片源', '运动细节'] },
  { question: '挂架和基础安装都包含吗？', answer: '分别核对挂架和基础安装项目，以订单说明为准。', keyPoints: ['核对挂架', '订单说明'] },
];
const practiceReplies = ['先看外包装的长宽高。', '可以拿同一个比赛片段来比。', '下单前先核对这款电视的挂架。'];
const improvedScripts = ['先核对外包装尺寸，再量电梯门和入户通道的净宽。', '播放同一段比赛，同时观察球的运动轨迹和球衣号码。', '先核对挂架与安装服务项目，再以订单说明确认费用。'];
const assistedScores = [80, 70, 75];
const evaluationFixture = {
  overallScore: 75, grade: '良好',
  items: practiceDraft.map(({keyPoints}, questionIndex) => ({
    questionIndex, score: assistedScores[questionIndex], matchedPoints: [keyPoints[0]], missedPoints: [keyPoints[1]],
    comment: '已提及' + keyPoints[0] + '，可以补充' + keyPoints[1] + '。', suggestedScript: improvedScripts[questionIndex],
  })),
};

async function captureMobile(page, width, name) {
  const measure = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.equal(measure[1], width);
  assert.ok(measure[0] <= measure[1], name + ' overflows: ' + measure);
  const target = process.env.TCL_EVAL_SCREENSHOTS;
  if (target) {
    await page.waitForFunction(() => {
      const toast = document.getElementById('toast');
      return !toast || !toast.textContent.trim() || (!toast.classList.contains('show') && Number(getComputedStyle(toast).opacity) < 0.01);
    });
    await mkdir(target, {recursive: true});
    await page.screenshot({path: join(target, width + '-' + name + '.png'), animations: 'disabled'});
  }
}

async function openAndCloseDrawer(page, width, buttonId, sheetId, closeId) {
  const button = page.locator('#' + buttonId), sheet = page.locator('#' + sheetId);
  await button.click();
  await sheet.waitFor();
  const close = sheet.getByRole('button', {name: '关闭', exact: true});
  assert.equal(await close.getAttribute('id'), closeId);
  assert.equal((await close.innerText()).trim(), '×');
  const inside = await close.evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim() !== '×') continue;
      const style = getComputedStyle(node.parentElement), bounds = el.getBoundingClientRect();
      const text = document.createRange();
      text.selectNodeContents(node);
      const box = text.getBoundingClientRect();
      return Number(style.opacity) > 0 && style.visibility === 'visible' && parseFloat(style.fontSize) >= 12 &&
        box.width > 4 && box.height > 4 && box.left >= bounds.left && box.right <= bounds.right &&
        box.top >= bounds.top && box.bottom <= bounds.bottom;
    }
    return false;
  });
  assert.equal(inside, true, 'Close glyph must be painted inside its control');
  await captureMobile(page, width, sheetId);
  await close.click();
  await sheet.waitFor({state: 'hidden'});
}

async function autoEnter(page, role, name) {
  await page.locator('#syncRole').selectOption(role);
  const completed = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/device/auto-enroll'));
  await submitName(page, name);
  assert.equal((await completed).status(), 200);
  await identityBar(page).filter({hasText: name}).waitFor();
}

async function verifyEvaluation(panel) {
  const header = panel.locator('.eval-result-head');
  await header.getByText(evaluationFixture.grade, {exact:true}).waitFor();
  assert.equal(await header.locator('strong').innerText(), '总分 ' + evaluationFixture.overallScore + ' / 100');
  const questions = panel.locator('.eval-item');
  assert.equal(await questions.count(), evaluationFixture.items.length);
  for (const item of evaluationFixture.items) {
    const row = questions.nth(item.questionIndex);
    assert.equal(await row.locator('h4').innerText(), '第 ' + (item.questionIndex + 1) + ' 题 · ' + item.score + ' 分');
    await row.getByText(practiceDraft[item.questionIndex].question, {exact:true}).waitFor();
    for (const [label, points] of [['命中要点', item.matchedPoints], ['遗漏要点', item.missedPoints]]) {
      const group = row.locator('.eval-points').filter({hasText:label});
      assert.deepEqual(await group.locator('.eval-point').allInnerTexts(), points);
    }
    assert.equal(await row.locator('p').filter({hasText:'评语'}).innerText(), '评语 ' + item.comment);
    assert.equal(await row.locator('p').filter({hasText:'改进口播话术'}).innerText(), '改进口播话术 ' + item.suggestedScript);
  }
}

async function scrollBelowHeader(panel) {
  await panel.evaluate(el => {
    el.scrollIntoView({block:'start', behavior:'instant'});
    const topBar = document.querySelector('.topbar');
    const offset = topBar ? topBar.getBoundingClientRect().height + 10 : 10;
    for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.scrollTop > 0) {
        ancestor.scrollTop -= offset;
        break;
      }
    }
  });
}

function simulatedModelClient(source, vendorCalls, usage) {
  if (source === 'cloudbase_hunyuan') {
    const model = {
      async generateText(options) {
        assert.equal(options.model, 'hy3');
        vendorCalls.push(options.model);
        if (vendorCalls.length === 1) {
          throw new Error('AI+ 请求出错，错误码：EXCEED_TOKEN_QUOTA_LIMIT，错误信息：Token usage exceeded quota limit.');
        }
        const content = JSON.stringify({questions: practiceDraft});
        return {text: content, rawResponses: [{
          choices: [{finish_reason: 'stop', message: {role: 'assistant', content}}], usage,
        }]};
      },
    };
    const cloudApp = {ai: () => ({createModel(provider) {
      assert.equal(provider, 'cloudbase');
      return model;
    }})};
    return createHunyuanClient({cloudApp, env: {
      TCL_R24_SYNC_AI_MODEL_PROVIDER: 'cloudbase', TCL_R24_SYNC_AI_MODEL_ID: 'hy3',
    }});
  }
  return createAiGatewayClient({
    env: {AI_GATEWAY_URL: 'https://evaluation.invalid', AI_GATEWAY_TOKEN: 'test-transport-only', AI_GATEWAY_MODEL: 'gpt-4o-mini'},
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://evaluation.invalid/v1/chat/completions');
      const body = JSON.parse(options.body);
      vendorCalls.push(body.response_format.type);
      if (vendorCalls.length === 1) return Response.json({}, {status: 401});
      const content = {questions: practiceDraft};
      return Response.json({choices: [{finish_reason: 'stop', message: {role: 'assistant', content: JSON.stringify(content)}}], usage});
    },
  });
}

for (const [width, source] of [[375, 'openai_gateway'], [390, 'openai_gateway'], [393, 'cloudbase_hunyuan']]) {
  test('mobile post-submission review at ' + width + 'px uses readback and no model request (' + source + ')', {timeout: 90000}, async t => {
    const vendorCalls = [];
    const simulatedUsage = {prompt_tokens: 100, completion_tokens: 50, total_tokens: 150};
    const gateway = simulatedModelClient(source, vendorCalls, simulatedUsage);
    const hunyuan = source === 'cloudbase_hunyuan';
    const modelName = hunyuan ? 'hy3' : 'gpt-4o-mini';
    const label = hunyuan ? '腾讯混元 · hy3' : 'OpenAI · gpt-4o-mini';
    let repositoryReview = {status:'waiting'};
    const evaluation = {...evaluationFixture, model:'gpt-6.1-terra', source:'openai_offline', degraded:false};
    let legacyEvaluation;
    const {newPage, server} = await browserFixture(t, {
      draftGeneration: {canGenerate: actor => actor.role === 'operator', fallbackEnabled: true, model: gateway.model, source,
        generate: (_actor, prompt) => gateway.generate(prompt)},
      repositoryReviews: async (_assignmentId, _principal, ids) => repositoryReview
        ? ids.map(id => ({id,repository_review:repositoryReview})) : [],
      legacyEvaluation: () => legacyEvaluation,
    });
    const delayedScore = width === 375;
    const operatorView = await newPage('/sync/', width);
    const anchorView = await newPage('/sync/', width, {useClock: delayedScore});
    const ops = operatorView.page, trainee = anchorView.page;
    await autoEnter(ops, 'operator', '演示运营');
    await autoEnter(trainee, 'anchor', '演示主播');

    await ops.locator('[data-ops-tab="publish"]').click();
    await ops.locator('#assignmentTitle').fill('大屏电视 · 直播话术练习');
    await ops.locator('#assignmentBoard').selectOption('01');
    await ops.locator('#assignmentPlatform').selectOption('京东');
    const draft = ops.locator('#assignmentDraftPanel');
    await draft.locator('summary').click();
    await draft.locator('#assignmentDraftCount').selectOption('3');
    const material = draft.locator('#assignmentDraftSourceText');
    const generate = draft.locator('#assignmentDraftGenerate');
    await material.fill(JSON.stringify({questions: practiceDraft}));
    const draftRequest = () => Promise.all([ops.waitForResponse(resp => draftResponse('POST', resp)), generate.click()]);
    const [fallback] = await draftRequest();
    const failed = await fallback.json();
    assert.equal(failed.degraded, true);
    assert.equal(failed.errorCode, hunyuan ? 'HUNYUAN_TOKEN_QUOTA_EXCEEDED' : 'GATEWAY_HTTP_401');
    await draft.locator('#assignmentDraftOrigin').filter({hasText: failed.requestId}).waitFor();
    assert.ok((await draft.locator('#assignmentDraftOrigin').innerText()).includes(failed.errorCode));
    if (hunyuan) await draft.locator('#assignmentDraftOrigin').filter({hasText: '上海试点的腾讯云模型额度已用完'}).waitFor();
    await scrollBelowHeader(draft.locator('#assignmentDraftOrigin'));
    await captureMobile(ops, width, 'draft-fallback');
    await material.fill('顾客关心电视入户的包装尺寸、球赛中的运动表现和安装范围。参考依据包括通道净宽、对照片源以及订单说明。');
    const [generated] = await draftRequest();
    const drafted = await generated.json();
    assert.equal(generated.status(), 200);
    assert.equal(drafted.source, source);
    assert.equal(drafted.model, modelName);
    await draft.locator('#assignmentDraftOrigin').filter({hasText: label}).waitFor();
    await draft.locator('#assignmentDraftConfirm').click();
    await ops.locator('#assignmentExcelPreview').filter({hasText: practiceDraft[0].question}).waitFor();
    assert.equal(server.requests.filter(r => r.method === 'POST' && r.path.endsWith('/assignments')).length, 0);
    const [published] = await Promise.all([
      ops.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/assignments')),
      ops.locator('#publishAssignment').click(),
    ]);
    assert.equal(published.status(), 201);
    const {assignment} = await published.json();
    await trainee.locator('#assignmentFold summary').click();
    await trainee.locator('#assignmentSearch').fill('演示运营');
    await trainee.locator('#syncRefresh').click();
    await trainee.locator('#assignmentSearchResults [data-join-assignment="' + assignment.id + '"]').click();
    await openAndCloseDrawer(trainee, width, 'prepMore', 'prepMoreSheet', 'prepMoreClose');
    await startTextPractice(trainee);
    await openAndCloseDrawer(trainee, width, 'focusReview', 'liveMoreSheet', 'liveMoreClose');
    const submissions = '/assignments/' + encodeURIComponent(assignment.id) + '/submissions';
    const submissionCount = () => server.requests.filter(r => r.method === 'POST' && r.path.endsWith(submissions)).length;
    for (const [index, {question}] of practiceDraft.entries()) {
      await trainee.locator('#liveQText').filter({hasText: question}).waitFor();
      if (index === practiceDraft.length - 1) await checkFinalActionSpacing(trainee);
      await trainee.locator('#focusMic').click();
      if (delayedScore && index === practiceDraft.length - 1) {
        assert.equal(await trainee.locator('#liveTextFinishSubmit').isVisible(), false);
        await trainee.locator('#liveTextAnswer').fill('待修订的回答');
        await trainee.locator('#liveTextClose').click();
        assert.equal(submissionCount(), 0);
        await trainee.locator('#focusMic').click();
        assert.equal(await trainee.locator('#liveTextAnswer').inputValue(), '待修订的回答');
      }
      await trainee.locator('#liveTextAnswer').fill(practiceReplies[index]);
      if (index === practiceDraft.length - 1) await checkFinalActionSpacing(trainee);
      if (delayedScore && index === practiceDraft.length - 1) break;
      if (index < practiceDraft.length - 1) {
        assert.equal(await trainee.locator('#liveTextFinishSubmit').isVisible(), false);
      }
      await trainee.locator('#liveTextSave').click();
      if (index < practiceDraft.length - 1) {
        if (index) await new Promise(resolve => setTimeout(resolve, 710));
        await trainee.locator('#focusNext').click();
      }
    }
    assert.equal(submissionCount(), 0, 'Editing answers does not submit the practice');
    let confirm;
    let originalSubmissionId;
    if (delayedScore) {
      confirm = trainee.locator('#liveTextFinishSubmit').filter({hasText: '完成并提交'});
      await confirm.waitFor();
      await captureMobile(trainee, width, 'anchor-finish-and-submit');
    } else if (width === 393) {
      await new Promise(resolve => setTimeout(resolve, 710));
      // The first submit commits on the server, but its acknowledgement is lost.
      await trainee.route('**' + submissions, async route => {
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        originalSubmissionId = (await response.json()).submission.id;
        await route.fulfill({status: 200, json: {}});
      }, {times: 1});
      await trainee.locator('#focusNext').filter({hasText: '完成并提交'}).click();
      await trainee.locator('#toast').filter({hasText: '未收到云端确认'}).waitFor();
      assert.equal(submissionCount(), 1);
      confirm = trainee.locator('#submitSession');
    } else {
      await trainee.locator('#focusClose').click();
      await trainee.getByRole('button', {name: '结束并进入复盘', exact: true}).click();
      await trainee.locator('#reviewDetails').click();
      assert.equal(await trainee.locator('#reviewAiEvaluate').count(), 0);
      assert.equal(await trainee.locator('#reviewAiEvaluation').isVisible(), false);
      await trainee.locator('#reviewDetailsBack').click();
      confirm = trainee.locator('#submitSession');
    }
    const [sent] = await Promise.all([
      trainee.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(submissions)),
      delayedScore ? confirm.dblclick() : confirm.click(),
    ]);
    const receipt = await sent.json();
    assert.equal(sent.status(), originalSubmissionId ? 200 : 201, JSON.stringify(receipt));
    if (originalSubmissionId) {
      assert.equal(receipt.submission.id, originalSubmissionId);
      assert.equal(receipt.replayed, true);
    }
    assert.deepEqual(Object.keys(sent.request().postDataJSON()), ['snapshot']);
    assert.deepEqual(receipt.submission.turns.map(turn => turn.answer), practiceReplies);
    assert.deepEqual(receipt.submission.repositoryReview, {status:'waiting'});
    const reviewPanel = trainee.locator('#reviewAiEvaluation');
    await reviewPanel.getByText('等待后台 AI 评选', {exact:true}).waitFor();
    await scrollBelowHeader(reviewPanel);
    await captureMobile(trainee, width, 'anchor-review-waiting');

    await ops.locator('[data-ops-tab="lookup"]').click();
    await ops.locator('#syncRecordsAssignment').selectOption(assignment.id);
    await ops.locator('#syncAnchorLookup').fill('演示主播');
    const operatorRecord = ops.locator('#syncAnchorRecords details').filter({hasText:'演示主播'});
    await operatorRecord.locator('summary').click();
    await operatorRecord.locator('[data-ai-eval-status]').filter({hasText:'等待后台 AI 评选'}).waitFor();
    repositoryReview = {status:'processing'};
    const mySubmissionsPath = '/assignments/' + assignment.id + '/my-submissions';
    const advanceToRead = async () => {
      const [response] = await Promise.all([
        trainee.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith(mySubmissionsPath)),
        trainee.clock.fastForward(60_000),
      ]);
      assert.equal(response.status(), 200);
      await response.finished();
      await reviewPanel.locator('#reviewAiRefresh:enabled').waitFor();
    };
    if (delayedScore) {
      // The worker may still be running after the original four polling intervals.
      for (let read = 0; read < 5; read++) await advanceToRead();
    } else {
      await reviewPanel.locator('#reviewAiRefresh').click();
    }
    await reviewPanel.getByText('正在后台 AI 评选', {exact:true}).waitFor();
    await operatorRecord.locator('[data-ai-eval-status]').filter({hasText:'正在后台 AI 评选'}).waitFor();
    repositoryReview = {status:'pending_review',evaluation};
    if (delayedScore) await advanceToRead();

    const displayed = reviewPanel.locator('[data-ai-eval-result]');
    await verifyEvaluation(displayed);
    await displayed.locator('[data-ai-model]').filter({hasText: 'OpenAI · gpt-6.1-terra'}).waitFor();
    await reviewPanel.getByText('待运营复核', {exact:true}).waitFor();
    if (delayedScore) {
      const anchorReads = () => server.requests.filter(r => r.method === 'GET' && r.path.endsWith(mySubmissionsPath)).length;
      const finishedReads = anchorReads();
      await trainee.clock.fastForward(15 * 60_000);
      assert.equal(anchorReads(), finishedReads, 'Readback stops when the score has arrived');
    }
    await scrollBelowHeader(displayed);
    await captureMobile(trainee, width, 'anchor-evaluation');
    const received = operatorRecord.locator('[data-ai-eval-result]');
    await verifyEvaluation(received);
    await received.locator('[data-ai-model]').filter({hasText: 'OpenAI · gpt-6.1-terra'}).waitFor();
    assert.equal(await received.locator('input,textarea,select,[contenteditable="true"]').count(), 0);
    await scrollBelowHeader(received);
    await captureMobile(ops, width, 'operator-evaluation');
    if (width===390) {
      await trainee.locator('#reviewHome').click();
      await trainee.locator('#syncDeviceTools summary').click();
      const code = await generateCode(trainee);
      const other = await newPage('/sync/', width);
      await submitName(other.page, '演示主播');
      await other.page.locator('#syncActivationCode').waitFor();
      assert.equal((await submitCode(other.page, code)).status(), 200);
      await other.page.locator('#assignmentFold summary').click();
      await other.page.locator('[data-my-submissions="' + assignment.id + '"]').click();
      const transcript = other.page.locator('#syncMySubmissions details');
      await transcript.locator('summary').click();
      const secondDeviceResult = transcript.locator('[data-ai-eval-result]');
      await verifyEvaluation(secondDeviceResult);
      await scrollBelowHeader(secondDeviceResult);
      await captureMobile(other.page, width, 'anchor-second-device-evaluation');
      assert.deepEqual(other.errors, []);

      await ops.locator('[data-ops-tab="tracking"]').click();
      await ops.locator('[data-sync-submissions="' + assignment.id + '"]').click();
      const tracking = ops.locator('#syncInbox details');
      await tracking.locator('summary').click();
      await verifyEvaluation(tracking.locator('[data-ai-eval-result]'));

      // Present an earlier stored score through the same read-only route.
      repositoryReview = undefined;
      legacyEvaluation = {...evaluationFixture, overallScore: 91, grade: '优秀',
        model:'hy3', source:'cloudbase_hunyuan', degraded:false};
      await ops.locator('[data-sync-inbox-refresh]').click();
      await tracking.locator('summary').click();
      const previousResult = tracking.locator('[data-ai-eval-result]');
      await previousResult.getByText('总分 91 / 100', {exact:true}).waitFor();
      await previousResult.locator('[data-ai-model]').filter({hasText:'腾讯混元 · hy3'}).waitFor();
      assert.equal(await tracking.locator('[data-ai-eval-status]').count(), 0);
      await scrollBelowHeader(previousResult);
      await captureMobile(ops, width, 'operator-historical-evaluation');
    }
    assert.deepEqual(vendorCalls, hunyuan ? ['hy3', 'hy3'] : ['json_object', 'json_object']);
    assert.equal(submissionCount(), originalSubmissionId ? 2 : 1);
    assert.equal(server.requests.filter(r=>r.path.endsWith('/assignments/evaluate')).length, 0);
    assert.deepEqual([...operatorView.errors, ...anchorView.errors], []);
    assert.deepEqual([...operatorView.consoleErrors, ...anchorView.consoleErrors], []);
    t.diagnostic('Isolated browser sessions, read-only asynchronous review states, no synchronous score request, and three preserved scored answers.');
  });
}

for (const status of [undefined, 'needs_attention']) {
  test('confirmed submissions show only the queue status provided by the server (' + (status || 'absent') + ')', {timeout: 60000}, async t => {
    const repositoryReviews = async (_assignmentId, _principal, ids) => status
      ? ids.map(id => ({id,repository_review:{status}}))
      : [];
    const {excel, newPage, server} = await browserFixture(t, {repositoryReviews});
    const operatorView = await newPage('/sync/', 375), anchorView = await newPage('/sync/', 375);
    const ops = operatorView.page, trainee = anchorView.page;
    await autoEnter(ops, 'operator', '演示运营');
    await autoEnter(trainee, 'anchor', '演示主播');
    await fillAssignment(ops, excel);
    const [published] = await Promise.all([
      ops.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/assignments')),
      ops.locator('#publishAssignment').click(),
    ]);
    assert.equal(published.status(), 201);
    const {assignment} = await published.json();
    await trainee.locator('#assignmentFold summary').click();
    await trainee.locator('#assignmentSearch').fill('演示运营');
    await trainee.locator('#syncRefresh').click();
    await textPractice(trainee, () => trainee.locator('#assignmentSearchResults [data-join-assignment="' + assignment.id + '"]').click(),
      {finishWithBlankAnswer: !status});
    if (!status) {
      assert.equal(server.requests.filter(r => r.method === 'POST' && r.path.endsWith('/submissions')).length, 0,
        'Completing a cloud exercise with a missing answer opens review without submitting');
      await trainee.locator('#reviewDetails').click();
      const missing = trainee.locator('#questionSummary tr').filter({has: trainee.locator('textarea')}).last();
      await missing.locator('textarea').fill(answers.at(-1));
      await missing.getByRole('button', {name: '保存本题修改', exact: true}).click();
      await trainee.locator('#reviewDetailsBack').click();
    }
    assert.equal(await trainee.locator('#reviewAiEvaluate').count(), 0);
    assert.equal(await trainee.locator('#reviewAiEvaluation').isVisible(), false);
    const [submitted] = await Promise.all([
      trainee.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/' + assignment.id + '/submissions')),
      trainee.locator('#submitSession').click(),
    ]);
    assert.equal(submitted.status(), 201);
    const {submission} = await submitted.json();
    assert.deepEqual(submission.turns.map(turn => turn.answer), answers);
    assert.deepEqual(Object.keys(submitted.request().postDataJSON()), ['snapshot']);
    assert.equal(Object.hasOwn(submission, 'evaluation'), false);
    assert.deepEqual(submission.repositoryReview, status ? {status} : undefined);

    const label = status ? '需要运营处理' : '未生成 AI 评选';
    const anchorPanel = trainee.locator('#reviewAiEvaluation');
    await anchorPanel.getByText(label, {exact:true}).waitFor();
    assert.equal(await anchorPanel.getByText(/等待后台|正在后台/).count(), 0);
    await ops.locator('[data-ops-tab="lookup"]').click();
    await ops.locator('#syncRecordsAssignment').selectOption(assignment.id);
    await ops.locator('#syncAnchorLookup').fill('演示主播');
    const record = ops.locator('#syncAnchorRecords details').filter({hasText:'演示主播'});
    await record.locator('summary').click();
    await record.locator('[data-cloud-evaluation]').getByText(label, {exact:true}).waitFor();
    assert.equal(await record.locator('[data-ai-eval-result]').count(), 0);
    assert.equal(server.requests.filter(r => r.path.endsWith('/assignments/evaluate')).length, 0);
    const anchorReads = () => server.requests.filter(r => r.method==='GET' && r.path.endsWith('/my-submissions')).length;
    assert.equal(anchorReads(),status ? 0 : 1);
    await new Promise(resolve => setTimeout(resolve,1600));
    assert.equal(anchorReads(),status ? 0 : 1,'An absent or terminal queue state must not start a polling loop');
    assert.deepEqual([...operatorView.errors, ...anchorView.errors], []);
    assert.deepEqual([...operatorView.consoleErrors, ...anchorView.consoleErrors], []);
  });
}

test('ordinary assignments retain explicit .12 scoring and save the score with the answers', {timeout:60000}, async t => {
  let modelCalls=0;
  const evaluated={...evaluationFixture,model:'hy3',source:'cloudbase_hunyuan',httpStatus:200};
  const {newPage,excel,server}=await browserFixture(t,{
    canAutoScore: async () => false,
    evaluationGeneration:{source:'cloudbase_hunyuan',model:'hy3',async evaluate(items){
      modelCalls++;
      return {...evaluated,items:evaluated.items.map((item,index)=>({...item, matchedPoints:items[index].keyPoints,missedPoints:[]}))};
    }},
  });
  const {page:ops}=await newPage(),{page:trainee}=await newPage();
  await autoEnter(ops,'operator','演示运营');
  await autoEnter(trainee,'anchor','演示主播');
  await fillAssignment(ops,excel);
  const [published]=await Promise.all([ops.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/assignments')),ops.locator('#publishAssignment').click()]);
  const {assignment}=await published.json();
  await trainee.locator('#assignmentFold summary').click();
  await trainee.locator('#assignmentSearch').fill('演示运营');
  await trainee.locator('#syncRefresh').click();
  await textPractice(trainee,()=>trainee.locator('#assignmentSearchResults [data-join-assignment="'+assignment.id+'"]').click());
  assert.equal(modelCalls,0);
  await trainee.locator('#reviewDetails').click();
  const [response]=await Promise.all([trainee.waitForResponse(r=>r.url().endsWith('/assignments/evaluate')),trainee.locator('#reviewAiEvaluate').click()]);
  const result=await response.json();
  assert.equal(response.status(),200,JSON.stringify(result));
  await trainee.locator('#legacyAiEvaluation [data-ai-eval-result]').waitFor();
  await trainee.locator('#reviewDetailsBack').click();
  const [saved]=await Promise.all([trainee.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/submissions')),trainee.locator('#submitSession').click()]);
  assert.equal(saved.status(),201);
  assert.equal(saved.request().postDataJSON().evaluationId,result.evaluationId);
  assert.deepEqual((await saved.json()).submission.evaluation,result.evaluation);
  assert.equal(modelCalls,1);
  assert.equal(server.requests.filter(r=>r.path.endsWith('/assignments/evaluate')).length,1);
});
