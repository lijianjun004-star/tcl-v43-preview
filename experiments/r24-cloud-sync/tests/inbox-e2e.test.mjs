import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {after, before, test} from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {runInbox} from '../scripts/inbox-export.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const files = ['questions.json', 'questions.tsv', 'questions.xlsx', 'run-summary.json'];
const txt = 'materials-inbox/公开挂装.txt';
const xlsx = 'materials-inbox/电视_京东_3题_观看距离.xlsx';
const sha256 = data => createHash('sha256').update(data).digest('hex');
const usage = {prompt_tokens: 42, completion_tokens: 89, total_tokens: 131};
let scratch, parseDocumentFile, extractQA, validators, readerName;

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'r24-inbox-e2e-'));
  let site = process.env.R24_SHANGHAI_SITE;
  let validator;
  if (site) {
    site = resolve(site);
    const hashes = {
      'assignment-excel.mjs': 'b505c6226c15566f4a222875f75d314ba2f31e2759861a4551dee3cf9da1af1d',
      'lib/parser.js': 'dba5ba09d857f947e0608480d5a0a3921668a8b538e09293b27aeb1ef7b30aeb',
      'lib/qa-import.js': '13028e0e6e7a7368da827a4f82d882fed08a07b6831dc1b3a31a8ffc19b087a7',
      'lib/zip.js': '5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4',
      'lib/xls.js': '11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c',
      'lib/pdf.js': '3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b',
    };
    for (const [file, digest] of Object.entries(hashes)) assert.equal(sha256(await readFile(join(site, file))), digest, file);
    readerName = 'Shanghai R24-20261124.8 (six pinned modules)';
    validator = join(site, 'assignment-excel.mjs');
  } else {
    // The baseline in main includes a browser reader for routine tests on a clean checkout.
    site = join(scratch, 'site');
    await mkdir(join(site, 'lib'), {recursive: true});
    await writeFile(join(site, 'package.json'), '{"type":"module"}');
    const zip = execFileSync('git', ['show', 'HEAD:experiments/r24-paraformer-excel-release/site-only.zip'], {cwd: repo, maxBuffer: 4 * 1024 * 1024});
    execFileSync('python3', ['-I', '-c', [
      'import io, pathlib, sys, zipfile',
      'with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:',
      '    for name in ("parser", "qa-import", "zip", "xls", "pdf"):',
      '        entry = "lib/" + name + ".js"',
      '        pathlib.Path(sys.argv[1], entry).write_bytes(z.read(entry))',
    ].join('\n'), site], {input: zip});
    readerName = 'repository QA3 reader and vendored assignment validator';
    validator = join(repo, 'experiments/r24-cloud-sync/backend/vendor/assignment-excel.mjs');
  }
  ({parseDocumentFile} = await import(pathToFileURL(join(site, 'lib/parser.js'))));
  ({extractQA} = await import(pathToFileURL(join(site, 'lib/qa-import.js'))));
  validators = await import(pathToFileURL(validator));
});
after(() => scratch && rm(scratch, {recursive: true, force: true}));

async function sampleRepo() {
  const cwd = await mkdtemp(join(scratch, 'git-'));
  await mkdir(join(cwd, 'materials-inbox'));
  const git = (...args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  git('init', '--quiet');
  function commit() {
    git('add', '--all', '--', 'materials-inbox');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgSign=false',
      'commit', '--allow-empty', '-qm', 'synthetic material');
    return git('rev-parse', 'HEAD');
  }
  const write = (name, content) => writeFile(join(cwd, name), content);
  return {cwd, commit, write};
}

async function verifyPackage(directory, expected, dryRun, expectedRows) {
  assert.deepEqual((await readdir(directory)).sort(), files);
  const summary = JSON.parse(await readFile(join(directory, 'run-summary.json')));
  const {questions} = JSON.parse(await readFile(join(directory, 'questions.json')));
  for (const [key, value] of Object.entries(expected)) assert.equal(summary[key], value, key);
  assert.equal(summary.dryRun, dryRun);
  assert.equal(summary.httpStatus, dryRun ? null : 200);
  assert.deepEqual(summary.usage, dryRun ? null : usage);
  assert.equal(summary.retryCount, 0);
  assert.equal(questions.length, expected.exportedCount);
  if (expectedRows) assert.deepEqual(questions, expectedRows);
  for (const file of files.slice(0, 3)) assert.equal(sha256(await readFile(join(directory, file))), summary.sha256[file], file);
  for (const file of ['questions.xlsx', 'questions.tsv']) {
    const doc = await parseDocumentFile(new File([await readFile(join(directory, file))], file), {assignmentExcel: true});
    const {assertExcelOneRowPerQuestion, assertExcelExtractionComplete, validateExcelQuestions} = validators;
    const extracted = assertExcelExtractionComplete(assertExcelOneRowPerQuestion(doc), extractQA(doc));
    const rows = validateExcelQuestions(extracted, summary);
    assert.deepEqual(rows.map(({question, answer, keyPoints, model}) => ({question, answer, keyPoints, model})), questions);
    assert.ok(rows.every(row => row.category === expected.category && row.platform === expected.platform));
  }
}

for (const dryRun of [true, false]) {
  test((dryRun ? 'dry-run' : 'mock 200') + ' reads modified TXT and new XLSX, then round-trips each distinct package', async t => {
    const {cwd, commit, write} = await sampleRepo();
    await write(txt, '本段旧资料不能出现在出题请求中');
    await write('materials-inbox/旧资料.md', '这份未修改的资料应被忽略');
    const before = commit();
    await write(txt, 'platform: 抖音\ncount: 2\n\n询问挂装服务范围');
    const writer = join(repo, 'experiments/r24-cloud-sync/scripts/batch-xlsx.py');
    execFileSync('python3', ['-I', writer, join(cwd, xlsx)], {input: JSON.stringify([['围绕观看距离选尺寸', '', '', '', '', '']])});
    await write('materials-inbox/README.md', '上传须知');
    await write('materials-inbox/.gitkeep', '');
    const after = commit();
    const outputDir = join(cwd, 'packages');
    let httpCalls = 0;
    const modeled = new Map();
    async function fetchImpl(_url, init) {
      httpCalls++;
      assert.equal(dryRun, false);
      const request = JSON.parse(init.body);
      const prompt = JSON.parse(request.messages.find(m => m.role === 'user').content);
      const marker = prompt.platform === '抖音' ? '挂装服务' : '观看距离';
      assert.ok(prompt.material.includes(marker));
      assert.ok(!/旧资料|上传须知/u.test(prompt.material));
      assert.equal(prompt.count, prompt.platform === '抖音' ? 2 : 3);
      const questions = Array.from({length: prompt.count}, (_, i) => ({
        question: marker + '需要核对第' + (i + 1) + '项什么信息？', answer: '请核对' + marker + '相关说明。',
        keyPoints: [marker, '核对具体型号'], model: '',
      }));
      modeled.set(prompt.platform, questions);
      return Response.json({choices: [{finish_reason: 'stop', message: {role: 'assistant', content: JSON.stringify({questions})}}], usage});
    }
    const packages = await runInbox({cwd, before, after}, {outputDir, dryRun, apiKey: 'local-fixture', fetchImpl});
    assert.equal(httpCalls, dryRun ? 0 : 2);
    assert.deepEqual(packages.map(p => p.path).sort(), [txt, xlsx].sort());
    assert.equal(new Set(packages.map(p => p.directory)).size, 2);
    assert.equal((await readdir(outputDir)).length, 2);
    for (const item of packages) {
      const count = item.path === txt ? 2 : 3;
      const platform = item.path === txt ? '抖音' : '京东';
      await verifyPackage(resolve(outputDir, item.directory), {category: '电视', platform, requestedCount: count, exportedCount: count, model: 'gpt-4o-mini'}, dryRun, modeled.get(platform));
    }
    t.diagnostic(readerName + '; TXT 2 rows + XLSX 3 rows; XLSX and TSV values, points and hashes verified; HTTP calls=' + httpCalls);
    const singleDir = join(cwd, 'single');
    const selected = await runInbox({cwd, after, selectedFile: xlsx}, {outputDir: singleDir, dryRun: true, fetchImpl: async () => assert.fail('dry-run HTTP')});
    assert.deepEqual(selected.map(item => item.path), [xlsx]);
    assert.equal((await readdir(singleDir)).length, 1);
  });
}

test('rejects quota and sensitive material batches atomically, before any HTTP call or package', async t => {
  const cases = [
    ['four eligible files', 'INBOX_TOO_MANY_FILES', null],
    ['100 KiB plus one byte', 'INBOX_FILE_TOO_LARGE', Buffer.alloc(100 * 1024 + 1, 65)],
    ['phone', 'INBOX_SENSITIVE_MOBILE', ['138', '0000', '0000'].join('')],
    ['identity', 'INBOX_SENSITIVE_IDENTITY', ['110101', '19000101', '001', 'X'].join('')],
    ['email', 'INBOX_SENSITIVE_EMAIL', ['synthetic', 'example.invalid'].join('@')],
    ['key', 'INBOX_SENSITIVE_API_KEY', ['sk', 'fakeLocalTestValueOnly'].join('-')],
  ];
  for (const [name, code, value] of cases) await t.test(name, async t => {
    const {cwd, commit, write} = await sampleRepo();
    const before = commit();
    await write('materials-inbox/a.txt', '这是排序在第一位的有效资料');
    const rejected = 'materials-inbox/z.md';
    if (value === null) {
      for (const file of ['b','c','d']) await write('materials-inbox/' + file + '.md', '公开说明' + file);
    } else {
      await write(rejected, value);
    }
    const after = commit();
    const outputDir = join(cwd, 'output');
    let httpCalls = 0;
    const fetchImpl = async () => { httpCalls++; throw new Error('unexpected HTTP request'); };
    await assert.rejects(runInbox({cwd, before, after}, {outputDir, dryRun: false, apiKey: 'local-fixture', fetchImpl}), error => {
      assert.equal(error.code, code);
      if (typeof value === 'string') {
        assert.equal(error.safePath, rejected);
        assert.ok(![error.message, error.safePath, error.code].join(' ').includes(value));
      }
      return true;
    });
    assert.equal(httpCalls, 0);
    await assert.rejects(readdir(outputDir), {code: 'ENOENT'});
    t.diagnostic(code + '; HTTP calls=0; artifact directories=0');
  });
});
