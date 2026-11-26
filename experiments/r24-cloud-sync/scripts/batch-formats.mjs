import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAssignmentDraftResponse } from '../overlay/assignment-drafts.mjs';
import { assertExcelOneRowPerQuestion, validateExcelQuestions } from '../backend/vendor/assignment-excel.mjs';

const headers = ['题目', '参考话术', '评分要点', '型号', '品类', '平台'];
const writer = fileURLToPath(new URL('./batch-xlsx.py', import.meta.url));

function check(ok, message) {
  if (!ok) throw new Error(message);
}

function cell(value, max, optional = false) {
  check(typeof value === 'string' && value.length <= max, '文本字段类型或长度无效。');
  // Flat cells must survive XML 1.0, Excel and TSV clipboard import unchanged.
  check(!/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029\ufffe\uffff]/u.test(value), '单元格含控制字符或不支持的字符。');
  const text = value.trim();
  check(optional || text.length > 0, '必填文本不能为空。');
  check(!/^[=+@-]/u.test(text.normalize('NFKC').trimStart()), '单元格以电子表格公式标记开头。');
  check(!/(?:sk[-_]|authorization\s*[:：]|bearer\s+\S+)/iu.test(text), '单元格含疑似凭证。');
  return text;
}

function safeMetadata(meta) {
  const { dryRun, model, platform, requestedCount, httpStatus, retryCount, usage } = meta;
  check(typeof dryRun === 'boolean' && ['gpt-4o', 'gpt-4o-mini'].includes(model), '运行模式或模型无效。');
  check(['京东', '天猫', '抖音'].includes(platform), '平台无效。');
  const category = cell(meta.category, 100);
  check(Number.isInteger(requestedCount) && requestedCount >= 1 && requestedCount <= 50, '题数须为 1–50。');
  check(dryRun ? httpStatus === null && retryCount === 0 : httpStatus === 200 && [0, 1].includes(retryCount),
    '运行结果与上游状态不一致。');
  let safeUsage = null;
  if (usage !== null && usage !== undefined) {
    const { prompt_tokens, completion_tokens, total_tokens } = usage;
    check([prompt_tokens, completion_tokens, total_tokens].every(n => Number.isSafeInteger(n) && n >= 0)
      && prompt_tokens + completion_tokens === total_tokens && (!dryRun || total_tokens === 0), '上游用量无效。');
    safeUsage = { prompt_tokens, completion_tokens, total_tokens };
  }
  return { timestamp: new Date().toISOString(), dryRun, model, category, platform, requestedCount,
    httpStatus, retryCount, usage: safeUsage };
}

function projectRows(raw, meta) {
  check(Array.isArray(raw) && raw.length === meta.requestedCount, '模型题数与请求不一致。');
  const rows = raw.map(row => {
    check(row && typeof row === 'object' && !Array.isArray(row)
      && Object.keys(row).every(k => ['question', 'answer', 'keyPoints', 'model'].includes(k)), '题目字段无效。');
    const question = cell(row.question, 500);
    const answer = cell(row.answer, 3000);
    check(Array.isArray(row.keyPoints) && row.keyPoints.length >= 1 && row.keyPoints.length <= 12, '每题须含 1–12 项评分要点。');
    const keyPoints = row.keyPoints.map(point => {
      const text = cell(point, 200);
      check(!/[、；;,，]/u.test(text), '单条评分要点中含导入分隔符。');
      return text;
    });
    const model = Object.hasOwn(row, 'model') ? cell(row.model, 200, true) : '';
    // Reuse the draft editor's three-field contract without its per-paste item
    // and byte budgets truncating a long batch. Keep Excel metadata separately.
    const validated = readAssignmentDraftResponse(JSON.stringify({questions: [{question, answer, keyPoints}]}));
    return { ...validated[0], model };
  });
  // Check duplicate identities across all rows, including distant duplicates.
  const validated = validateExcelQuestions(rows, { category: meta.category, platform: meta.platform });
  return validated.map(({question, answer, keyPoints, model}) => ({question, answer, keyPoints, model}));
}

function formatTsv(rows) {
  const quote = s => s.includes('"') ? '"' + s.replaceAll('"', '""') + '"' : s;
  return rows.map(row => row.map(quote).join('\t')).join('\n') + '\n';
}

async function checkDestination(path) {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  check(stat.isDirectory() && (await readdir(path)).length === 0, '输出目录须为空或尚未创建。');
}

export async function exportBatch(outputDir, rawQuestions, metadata) {
  const meta = safeMetadata(metadata);
  const questions = projectRows(rawQuestions, meta);
  const table = [headers, ...questions.map(q => [
    q.question, q.answer, q.keyPoints.join('；'), q.model, meta.category, meta.platform,
  ])];
  const block = {kind: 'table', rows: table.map(cells => ({cells}))};
  assertExcelOneRowPerQuestion({blocks: [block]});

  const destination = resolve(outputDir);
  await mkdir(dirname(destination), {recursive: true});
  await checkDestination(destination);
  const staging = await mkdtemp(join(dirname(destination), '.r24-export-'));
  try {
    execFileSync('python3', ['-I', writer, join(staging, 'questions.xlsx')], {
      input: JSON.stringify(table), stdio: ['pipe', 'ignore', 'ignore'], timeout: 30_000,
      env: { PATH: process.env.PATH },
    });
    await writeFile(join(staging, 'questions.tsv'), formatTsv(table));
    await writeFile(join(staging, 'questions.json'), JSON.stringify({ questions }, null, 2) + '\n');
    const sha256 = {};
    for (const name of ['questions.xlsx', 'questions.tsv', 'questions.json']) {
      sha256[name] = createHash('sha256').update(await readFile(join(staging, name))).digest('hex');
    }
    const summary = { ...meta, exportedCount: questions.length, sha256 };
    await writeFile(join(staging, 'run-summary.json'), JSON.stringify(summary, null, 2) + '\n');
    await rename(staging, destination);
    return summary;
  } catch {
    throw new Error('无法生成或保存完整题库，请检查 Python 和输出目录。');
  } finally {
    await rm(staging, {recursive: true, force: true});
  }
}
