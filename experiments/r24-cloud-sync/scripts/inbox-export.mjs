import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectMaterial } from './inbox-materials.mjs';
import { runBatch } from './batch-questions-export.mjs';

const env = process.env;
const main = 'refs/heads/main';
const weeklySchedule = '0 1 * * 1';
const safeCode = /^(?:INBOX_[A-Z_]{1,48}|OPENAI_HTTP_[1-5][0-9]{2}|OPENAI_(?:INVALID_USAGE|INVALID_RESPONSE|TIMEOUT|TRANSPORT)|MISSING_BATCH_CREDENTIAL|INVALID_(?:MATERIAL|BATCH_DRAFT)|BATCH_VALIDATION_OR_EXPORT_FAILED)$/u;

function invalidEvent() {
  throw Object.assign(new Error(), {code: 'INBOX_INVALID_EVENT'});
}

async function eventRange() {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_RUN_ATTEMPT !== '1' ||
      env.GITHUB_REF !== main || !/^[0-9a-f]{40}$/u.test(env.GITHUB_SHA ?? '')) invalidEvent();
  const payload = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  if (env.GITHUB_EVENT_NAME === 'push' && payload.ref === main && payload.after === env.GITHUB_SHA &&
      !payload.forced && !payload.created && !payload.deleted && /^[0-9a-f]{40}$/u.test(payload.before ?? '')) {
    return {before: payload.before, after: payload.after};
  }
  if (env.GITHUB_EVENT_NAME === 'schedule' && payload.schedule === weeklySchedule) {
    return {after: env.GITHUB_SHA, weeklyFile: env.R24_WEEKLY_FILE ?? ''};
  }
  invalidEvent();
}

try {
  const event = await eventRange();
  const prepared = join(env.RUNNER_TEMP, 'r24-inbox-material.txt');
  const mode = process.argv[2];
  if (mode === 'prepare') {
    const batch = collectMaterial({cwd: process.cwd(), ...event});
    if (batch) await writeFile(prepared, batch.material, {encoding: 'utf8', flag: 'wx', mode: 0o600});
    await appendFile(env.GITHUB_OUTPUT, `ready=${Boolean(batch)}\n`);
    const note = batch ? `本批包含 ${batch.files.length} 份资料。\n` : '没有符合条件的新资料，本次未调用模型。\n';
    await appendFile(env.GITHUB_STEP_SUMMARY, note);
  } else if (mode === 'generate') {
    // This file exists only if the preceding step validated the committed sources.
    const material = await readFile(prepared, 'utf8');
    const summary = await runBatch({material}, {
      outputDir: join(env.RUNNER_TEMP, 'r24-inbox-review'), apiKey: env.BATCH_API_TOKEN,
    });
    await appendFile(env.GITHUB_STEP_SUMMARY,
      `已生成 ${summary.exportedCount} 道待运营审核的题目。本次成功响应报告 ${summary.usage.total_tokens} tokens。\n`);
  } else {
    invalidEvent();
  }
} catch (error) {
  // Report only known categories. Paths, input text, provider errors and credentials stay out of logs.
  console.error(safeCode.test(error?.code) ? error.code : 'INBOX_EXPORT_FAILED');
  process.exitCode = 1;
}
