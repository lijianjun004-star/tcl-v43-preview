import { execFileSync } from 'node:child_process';
import { appendFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectMaterials } from './inbox-materials.mjs';
import { detectSensitive } from './inbox-format.mjs';
import { runBatch } from './batch-questions-export.mjs';

const main = 'refs/heads/main';
const weeklySchedule = '0 1 * * 1';
const safeCode = /^(?:INBOX_[A-Z0-9_]{1,64}|OPENAI_HTTP_[1-5][0-9]{2}|OPENAI_(?:INVALID_USAGE|INVALID_RESPONSE|TIMEOUT|TRANSPORT)|MISSING_BATCH_CREDENTIAL|INVALID_(?:MATERIAL|BATCH_DRAFT)|BATCH_VALIDATION_OR_EXPORT_FAILED)$/u;
function fail(code) {
  throw Object.assign(new Error(code), {code});
}

// Generation starts only after the collector has validated the complete set.
// Stage all packages together so a later failed response cannot publish a partial batch.
export async function runPrepared(records, {outputDir, dryRun = false, apiKey, fetchImpl}) {
  if (!records.length) return [];
  try {
    if (!(await lstat(outputDir)).isDirectory() || (await readdir(outputDir)).length) fail('INBOX_OUTPUT_NOT_EMPTY');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(outputDir), {recursive: true});
  const staging = await mkdtemp(join(dirname(outputDir), '.r24-packages-'));
  try {
    const rows = [];
    for (const {path, ...options} of records) {
      const directory = String(rows.length + 1).padStart(2, '0');
      const summary = await runBatch({...options, dryRun}, {
        outputDir: join(staging, directory), apiKey, fetchImpl, materialLimit: 102400,
      });
      rows.push({path, directory, summary});
    }
    await rename(staging, outputDir);
    return rows;
  } finally {
    await rm(staging, {recursive: true, force: true});
  }
}

export async function runInbox(selection, options) {
  return runPrepared(await collectMaterials(selection), options);
}

// Encode punctuation instead of interpolating operator text into Markdown links, HTML or mentions.
function markdownText(text) {
  return text.replace(/[^\p{L}\p{M}\p{N} ]/gu, value => '&#' + value.codePointAt(0) + ';');
}

function summaryTable(rows) {
  const lines = ['| 资料文件 | 包内目录 | 品类 | 平台 | 题数 | 模型 | Tokens | XLSX SHA-256 |',
    '| --- | --- | --- | --- | ---: | --- | ---: | --- |'];
  for (const {path, directory, summary: s} of rows) {
    lines.push('| ' + [markdownText(path), directory, markdownText(s.category), s.platform, s.exportedCount,
      s.model, s.usage?.total_tokens ?? 0, s.sha256['questions.xlsx']].join(' | ') + ' |');
  }
  lines.push('', '| 包内目录 | TSV SHA-256 | JSON SHA-256 |', '| --- | --- | --- |');
  for (const {directory, summary: s} of rows) {
    lines.push('| ' + [directory, s.sha256['questions.tsv'], s.sha256['questions.json']].join(' | ') + ' |');
  }
  return lines.join('\n') + '\n';
}

async function readEvent(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_RUN_ATTEMPT !== '1' ||
      env.GITHUB_REF !== main || !/^[0-9a-f]{40}$/u.test(env.GITHUB_SHA ?? '')) fail('INBOX_INVALID_EVENT');
  const payload = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const after = env.GITHUB_SHA;
  if (env.GITHUB_EVENT_NAME === 'push' && payload.ref === main && payload.after === after &&
      !payload.forced && !payload.created && !payload.deleted && /^[0-9a-f]{40}$/u.test(payload.before ?? '')) {
    return {before: payload.before, after};
  }
  if (env.GITHUB_EVENT_NAME === 'schedule' && payload.schedule === weeklySchedule) return {after};
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch' && typeof payload.inputs?.file === 'string') {
    const {file, dry_run: dry = false} = payload.inputs;
    if (!file || ![true, false, 'true', 'false'].includes(dry)) fail('INBOX_INVALID_EVENT');
    return {after, selectedFile: file, dryRun: dry === true || dry === 'true'};
  }
  fail('INBOX_INVALID_EVENT');
}

async function weeklyIndex(env, event) {
  if (env.GITHUB_EVENT_NAME !== 'schedule') fail('INBOX_INVALID_EVENT');
  // The runner prints step environment values. Only pass the selected number into
  // the next step. The configured filename never becomes a step environment value.
  const names = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', event.after, '--', 'materials-inbox'],
    {stdio: ['ignore', 'pipe', 'ignore']}).toString('utf8').split('\0').filter(name => name && /\.(?:txt|md|csv|tsv|xlsx)$/iu.test(name) &&
      name.toLowerCase() !== 'materials-inbox/readme.md' &&
      !name.split('/').some(part => part.startsWith('.')) &&
      !/[\p{Cc}\p{Cf}\uFFFD\\]/u.test(name) && !detectSensitive(name));
  const lookup = Object.create(null);
  const seen = new Map();
  for (const [index, name] of names.entries()) {
    // Actions map keys compare case-insensitively. Don't choose between two such paths.
    const key = name.toLowerCase();
    if (seen.has(key)) lookup[seen.get(key)] = 'ambiguous';
    else { seen.set(key, name); lookup[name] = String(index + 1); }
  }
  await writeFile(join(env.RUNNER_TEMP, 'r24-weekly.json'), JSON.stringify(names), {flag: 'wx', mode: 0o600});
  await appendFile(env.GITHUB_OUTPUT, 'lookup=' + JSON.stringify(lookup) + '\n');
}

async function mainEntry(env, command) {
  const event = await readEvent(env);
  const prepared = join(env.RUNNER_TEMP, 'r24-inbox-prepared.json');
  if (command === 'weekly-index') return weeklyIndex(env, event);
  if (command === 'prepare') {
    if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' && env.R24_INBOX_AUTO_ENABLED !== 'true') {
      await appendFile(env.GITHUB_STEP_SUMMARY, '自动出题总开关未启用，模型请求为 0。\n');
      return;
    }
    if (env.GITHUB_EVENT_NAME === 'schedule') {
      const names = JSON.parse(await readFile(join(env.RUNNER_TEMP, 'r24-weekly.json'), 'utf8'));
      if (!/^[1-9]\d*$/u.test(env.R24_WEEKLY_INDEX ?? '')) fail('INBOX_INVALID_WEEKLY_FILE');
      event.selectedFile = names[Number(env.R24_WEEKLY_INDEX) - 1];
      if (!event.selectedFile) fail('INBOX_INVALID_WEEKLY_FILE');
    }
    const records = await collectMaterials({cwd: process.cwd(), ...event});
    if (!records.length) {
      await appendFile(env.GITHUB_STEP_SUMMARY, '本次没有新增或修改的受支持资料，模型请求为 0。\n');
      return;
    }
    const mode = event.dryRun ? 'dry' : 'live';
    await writeFile(prepared, JSON.stringify({sha: event.after, mode, records}), {encoding: 'utf8', flag: 'wx', mode: 0o600});
    await appendFile(env.GITHUB_OUTPUT, 'mode=' + mode + '\n');
  } else if (command === 'dry' || command === 'live') {
    const {sha, mode, records} = JSON.parse(await readFile(prepared, 'utf8'));
    if (sha !== event.after || command !== mode || (command === 'dry') !== Boolean(event.dryRun)) fail('INBOX_INVALID_EVENT');
    const rows = await runPrepared(records, {outputDir: join(env.RUNNER_TEMP, 'r24-inbox-review'),
      dryRun: command === 'dry', apiKey: env.BATCH_API_TOKEN});
    await appendFile(env.GITHUB_STEP_SUMMARY, summaryTable(rows));
  } else {
    fail('INBOX_INVALID_EVENT');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await mainEntry(process.env, process.argv[2]);
  } catch (error) {
    const code = safeCode.test(error?.code) ? error.code : 'INBOX_EXPORT_FAILED';
    // The collector alone sets safePath and redacts names carrying sensitive data.
    console.error(error?.safePath ? code + ' ' + JSON.stringify(error.safePath) : code);
    process.exitCode = 1;
  }
}
