import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, test} from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {runBatch} from '../scripts/batch-questions-export.mjs';
import {assertExcelExtractionComplete, assertExcelOneRowPerQuestion, validateExcelQuestions} from '../backend/vendor/assignment-excel.mjs';

const filenames = ['questions.json', 'questions.tsv', 'questions.xlsx', 'run-summary.json'];
const headers = ['题目', '参考话术', '评分要点', '型号', '品类', '平台'];
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const cli = fileURLToPath(new URL('../scripts/batch-questions-export.mjs', import.meta.url));
const release = 'experiments/r24-paraformer-excel-release/site-only.zip';
const fakeKey = ['sk', 'SyntheticOnlyForOfflineUnitTests'].join('-');
const input = {material: '直播示例：根据对应商品页核对安装服务范围。', category: '电视', platform: '京东',
  count: 1, model: 'gpt-4o-mini', dryRun: false};
const question = {question: '这个型号如何确认是否含安装？', answer: '查看对应型号的"安装服务"栏目。', keyPoints: ['确认具体型号', '以订单说明为准'], model: '示例甲'};
const usage = {prompt_tokens: 17, completion_tokens: 28, total_tokens: 45};
let scratch, parseDocumentFile, extractQA;

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'r24-batch-tests-'));
  // Load the shipped browser parser even in sparse Git checkouts. Only extract these named files.
  const zip = execFileSync('git', ['show', 'HEAD:' + release], {cwd: repo, maxBuffer: 4 * 1024 * 1024});
  execFileSync('python3', ['-c', [
    'import io, pathlib, sys, zipfile',
    'target = pathlib.Path(sys.argv[1])',
    'with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:',
    '    for name in ("parser", "qa-import", "zip", "xls", "pdf"):',
    '        (target / (name + ".js")).write_bytes(z.read("lib/" + name + ".js"))',
  ].join('\n'), scratch], {input: zip});
  await writeFile(join(scratch, 'package.json'), '{"type":"module"}');
  ({parseDocumentFile} = await import(pathToFileURL(join(scratch, 'parser.js'))));
  ({extractQA} = await import(pathToFileURL(join(scratch, 'qa-import.js'))));
});
after(() => scratch && rm(scratch, {recursive: true, force: true}));

function reply(content, finish = 'stop', tokenUsage = usage) {
  return Response.json({model: 'gpt-4o-mini', choices: [{index: 0, finish_reason: finish,
    message: {role: 'assistant', content}}], usage: tokenUsage});
}

function ok(rows = [question]) {
  return reply(JSON.stringify({questions: rows}));
}

async function directory() {
  const parent = await mkdtemp(join(scratch, 'case-'));
  return join(parent, 'output');
}

function options(outputDir, fetchImpl, extra = {}) {
  return {outputDir, apiKey: fakeKey, fetchImpl, ...extra};
}

async function auditFiles(outputDir, expected) {
  assert.deepEqual((await readdir(outputDir)).sort(), filenames);
  const summary = JSON.parse(await readFile(join(outputDir, 'run-summary.json'), 'utf8'));
  for (const [k, v] of Object.entries(expected)) assert.deepEqual(summary[k], v, k);
  assert.ok(Number.isFinite(Date.parse(summary.timestamp)));
  assert.deepEqual(Object.keys(summary.sha256).sort(), filenames.slice(0, 3));

  const buffers = {};
  for (const file of filenames) {
    buffers[file] = await readFile(join(outputDir, file));
    assert.equal(buffers[file].includes(Buffer.from(fakeKey)), false, 'credential in uncompressed artifact');
    if (file !== 'run-summary.json') {
      assert.equal(summary.sha256[file], createHash('sha256').update(buffers[file]).digest('hex'));
    }
  }
  const {questions} = JSON.parse(buffers['questions.json']);
  assert.equal(questions.length, expected.requestedCount);
  assert.ok(questions.every(row => row.keyPoints.length && row.keyPoints.every(point => typeof point === 'string' && point.trim())));
  for (const format of ['xlsx', 'tsv']) {
    const name = 'questions.' + format;
    const doc = await parseDocumentFile(new File([buffers[name]], name), {assignmentExcel: true});
    assert.equal(doc.blocks.length, 1);
    const cells = doc.blocks[0].rows.map(row => row.cells);
    assert.deepEqual(cells[0], headers);
    assert.deepEqual(cells.slice(1), questions.map(q => [
      q.question, q.answer, q.keyPoints.join('；'), q.model, expected.category, expected.platform,
    ]));
    const count = assertExcelOneRowPerQuestion(doc);
    const extracted = assertExcelExtractionComplete(count, extractQA(doc));
    const rows = validateExcelQuestions(extracted, {category: expected.category, platform: expected.platform});
    assert.deepEqual(rows.map(({question, answer, keyPoints, model}) => ({question, answer, keyPoints, model})), questions);
  }
  return {questions, summary};
}

test('dry run makes zero requests and all 50 rows survive shipped XLSX and TSV import', async () => {
  const outputDir = await directory();
  let calls = 0;
  await runBatch({...input, platform: '抖音', count: 50, dryRun: true}, options(outputDir, () => { calls++; throw new Error(); }));
  assert.equal(calls, 0);
  await auditFiles(outputDir, {category: input.category, platform: '抖音', dryRun: true, model: input.model,
    requestedCount: 50, exportedCount: 50, retryCount: 0, httpStatus: null, usage: null});
});

test('mock 200 uses a non-streaming JSON request and exports exact headers, model, usage and hashes', async () => {
  const outputDir = await directory();
  let calls = 0;
  await runBatch(input, options(outputDir, async (url, init) => {
    calls++;
    const endpoint = new URL(url);
    assert.equal(endpoint.protocol, 'https:');
    assert.equal(endpoint.pathname, '/v1/chat/completions');
    assert.equal(init.method, 'POST');
    assert.ok(init.signal instanceof AbortSignal);
    assert.ok(new Headers(init.headers).get('authorization') === 'Bearer ' + fakeKey);
    const body = JSON.parse(init.body);
    assert.equal(body.model, input.model);
    assert.equal(body.stream, false);
    assert.deepEqual(body.response_format, {type: 'json_object'});
    assert.ok(body.messages.some(m => m.role === 'system' && m.content.includes('keyPoints')));
    assert.ok(body.messages.some(m => m.role === 'user' && m.content.includes(input.material)));
    return ok();
  }));
  assert.equal(calls, 1);
  const artifact = await auditFiles(outputDir, {category: input.category, platform: input.platform, dryRun: false,
    model: input.model, requestedCount: 1, exportedCount: 1, httpStatus: 200, retryCount: 0, usage});
  assert.deepEqual(artifact.questions, [question]);
});

test('invalid CLI results exit nonzero, leave no files, and never disclose credentials in stdout/stderr', async t => {
  const preload = join(scratch, 'mock-fetch.mjs');
  await writeFile(preload, `globalThis.fetch = async () => new Response(process.env.MOCK_RESPONSE, {status: Number(process.env.MOCK_STATUS)})`);
  const failures = [
    ['truncated questions JSON', reply('{"questions":[')],
    ['empty question array', ok([])],
    ['empty scoring points', ok([{...question, keyPoints: []}])],
    ['missing scoring points', ok([{question: question.question, answer: question.answer, model: ''}])],
    ['incomplete completion', reply(JSON.stringify({questions: [question]}), 'length')],
    ['contaminated provider error body', new Response('Bearer ' + fakeKey, {status: 401})],
    ['contaminated model answer', ok([{...question, answer: '凭据 ' + fakeKey}])],
    ['missing usage', reply(JSON.stringify({questions: [question]}), 'stop', null)],
  ];
  for (const [label, response] of failures) await t.test(label, async () => {
    const outputDir = await directory();
    const r = spawnSync(process.execPath, ['--import', preload, cli, outputDir], {encoding: 'utf8', timeout: 7_000,
      env: {PATH: process.env.PATH, MOCK_RESPONSE: await response.text(), MOCK_STATUS: String(response.status),
        BATCH_MATERIAL: input.material, BATCH_CATEGORY: input.category, BATCH_PLATFORM: input.platform,
        BATCH_MODEL: input.model, BATCH_COUNT: '1', BATCH_DRY_RUN: 'false', BATCH_API_TOKEN: fakeKey}});
    assert.ifError(r.error);
    assert.ok(Number.isInteger(r.status) && r.status !== 0);
    const logs = r.stdout + r.stderr;
    for (const sensitive of [fakeKey, 'Authorization:', 'Bearer ', '    at ']) assert.ok(!logs.includes(sensitive));
    assert.deepEqual(await readdir(join(outputDir, '..')), []);
  });
});

test('global checks reject duplicate questions across chunks, formula cells and unstable scoring point delimiters', async () => {
  const repeated = Array.from({length: 24}, (_, i) => ({...question, question: '第' + i + '个选购问题如何回答？'}));
  repeated[23] = repeated[0];
  for (const rows of [repeated, [{...question, model: '=BAD()'}], [{...question, keyPoints: ['尺寸；价格']}]]) {
    const outputDir = await directory();
    await assert.rejects(runBatch({...input, count: rows.length}, options(outputDir, async () => ok(rows))));
    assert.deepEqual(await readdir(join(outputDir, '..')), []);
  }
});

test('invalid inputs fail before fetch and an existing complete output is preserved', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return ok(); };
  for (const change of [{count: 0}, {count: 51}, {count: 1.5}, {material: '　'}, {material: '文'.repeat(20001)},
    {category: '　'}, {platform: '其他平台'}, {model: 'unknown-model'}, {dryRun: 'maybe'}]) {
    const outputDir = await directory();
    await assert.rejects(runBatch({...input, ...change}, options(outputDir, fetchImpl)));
    assert.deepEqual(await readdir(join(outputDir, '..')), []);
  }
  assert.equal(calls, 0);
  const outputDir = await directory();
  await mkdir(outputDir);
  await writeFile(join(outputDir, 'questions.xlsx'), 'previous reviewed workbook');
  await assert.rejects(runBatch({...input, dryRun: true}, options(outputDir, fetchImpl)));
  assert.deepEqual(await readdir(outputDir), ['questions.xlsx']);
  assert.equal(await readFile(join(outputDir, 'questions.xlsx'), 'utf8'), 'previous reviewed workbook');
});

test('401 fails immediately; only the specified transient statuses are retried once after 1500 ms', async () => {
  for (const status of [400, 401, 403, 500, 429, 502, 503, 504]) {
    const outputDir = await directory(), sleeps = [];
    let calls = 0;
    const fetchImpl = async () => ++calls === 1 ? new Response('upstream', {status}) : ok();
    const run = runBatch(input, options(outputDir, fetchImpl, {sleep: async ms => { sleeps.push(ms); }}));
    if ([429, 502, 503, 504].includes(status)) {
      await run;
      const receipt = JSON.parse(await readFile(join(outputDir, 'run-summary.json'), 'utf8'));
      assert.equal(receipt.retryCount, 1);
      assert.equal(receipt.httpStatus, 200);
      assert.deepEqual(sleeps, [1500]);
      assert.equal(calls, 2);
    } else {
      await assert.rejects(run, {code: 'OPENAI_HTTP_' + status});
      assert.equal(calls, 1);
      assert.deepEqual(sleeps, []);
      assert.deepEqual(await readdir(join(outputDir, '..')), []);
    }
  }
});

test('two aborted attempts end with a sanitized timeout and no files', async () => {
  const outputDir = await directory();
  const sleeps = [];
  let calls = 0;
  const fetchImpl = async (_url, {signal}) => {
    calls++;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
  };
  await assert.rejects(runBatch(input, options(outputDir, fetchImpl,
    {timeoutMs: 20, sleep: async ms => { sleeps.push(ms); }})), {code: 'OPENAI_TIMEOUT'});
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [1500]);
  assert.deepEqual(await readdir(join(outputDir, '..')), []);
});

test('CLI reads the manual dispatch payload, including a literal false, without logging material', async () => {
  const event = join(scratch, 'dispatch.json');
  const confidential = '仅供本地测试的合成培训资料';
  const inputs = {material: confidential + '\n说明中包含 "双引号"。', category: '电视', platform: '天猫',
    count: '1', model: 'gpt-4o-mini', dry_run: true};
  const env = {PATH: process.env.PATH, BATCH_INPUT_FILE: event};
  await writeFile(event, JSON.stringify({inputs}));
  const outputDir = await directory();
  const r = spawnSync(process.execPath, [cli, outputDir], {env, encoding: 'utf8'});
  assert.ifError(r.error);
  assert.equal(r.status, 0);
  assert.ok(!(r.stdout + r.stderr).includes(confidential));
  await auditFiles(outputDir, {category: '电视', platform: '天猫', requestedCount: 1, exportedCount: 1, dryRun: true});

  await writeFile(event, JSON.stringify({inputs: {...inputs, dry_run: 'false'}}));
  const noKeyOutput = await directory();
  const liveWithoutKey = spawnSync(process.execPath, [cli, noKeyOutput], {env, encoding: 'utf8'});
  assert.ifError(liveWithoutKey.error);
  assert.notEqual(liveWithoutKey.status, 0);
  assert.ok(!(liveWithoutKey.stdout + liveWithoutKey.stderr).includes(confidential));
  assert.deepEqual(await readdir(join(noKeyOutput, '..')), []);
});
