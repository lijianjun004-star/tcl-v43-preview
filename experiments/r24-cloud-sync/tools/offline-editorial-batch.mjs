import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createOpenAIDraftGenerator } from '../backend/openai-assignment-draft.mjs';
import { buildAssignmentDraftPrompt, readAssignmentDraftResponse } from '../overlay/assignment-drafts.mjs';
import { validateExcelQuestions } from '../backend/vendor/assignment-excel.mjs';

const model = 'gpt-4.1-mini';
const count = 5;
const maxOutputTokens = 2400;
const context = {category: 'TCL 电视', platform: '京东', count};
const material = [
  '合成顾客想给客厅换一台大屏电视。家里常看电影和球赛，也会接游戏机；收货要经过电梯和入户转角。',
  '围绕以下五个不同的顾客关注点，各拟一条顾客弹幕、一段可口播的回答和二至四条简短评分要点。',
  '一、怎样根据观看距离、墙面尺寸和摆放余量选择大屏尺寸。',
  '二、看足球时能否看清快速运动；如何用同一片源和观看条件体验差异。',
  '三、怎样判断现有游戏机与客厅影音设备能否兼容；指导顾客核对接口与设备说明。',
  '四、大屏包装能否通过电梯、门框和转角；区分包装与裸机尺寸，请送装团队复核路线。',
  '五、如何从对应商品页和订单核实基础安装、挂架、挂装及额外收费，安装前取得费用明细。',
  '材料没有具体型号、售价、折扣、硬件参数或服务承诺。请勿编造，答案每段二到三句即可。',
].join('\n');

const outputArg = process.argv[2];
let failure = 'Expected a single output directory argument.';
try {
  if (process.argv.length !== 3 || !outputArg) throw new Error();
  const destination = resolve(outputArg);
  failure = 'Output directory must be new or empty.';
  let entries;
  try {
    entries = await readdir(destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (entries?.length) throw new Error();
  await mkdir(dirname(destination), {recursive: true});

  failure = 'OpenAI credential missing or draft configuration invalid.';
  let responseCopy;
  const generate = createOpenAIDraftGenerator({
    apiKey: process.env.OPENAI_API_KEY, model, maxOutputTokens,
    async fetchImpl(url, options) {
      const response = await fetch(url, options);
      if (response.ok) responseCopy = response.clone();
      return response;
    },
  });
  failure = 'OpenAI draft request failed or returned incomplete output.';
  const text = await generate(buildAssignmentDraftPrompt(material, context));

  failure = 'Draft failed R24 validation or did not contain five complete questions.';
  const rows = validateExcelQuestions(readAssignmentDraftResponse(text), {...context, max: count});
  if (rows.length !== count || rows.some(row => row.keyPoints.length < 1)) throw new Error();
  const questions = rows.map(({question, answer, keyPoints}) => ({question, answer, keyPoints}));

  failure = 'Completed response did not include valid model and token usage.';
  const {model: actualModel, usage} = await responseCopy.json();
  if (typeof actualModel !== 'string' || !/^gpt-4\.1-mini(?:-\d{4}-\d{2}-\d{2})?$/.test(actualModel)) throw new Error();
  const {input_tokens, output_tokens, total_tokens} = usage;
  if (![input_tokens, output_tokens, total_tokens].every(n => Number.isSafeInteger(n) && n > 0)
      || output_tokens > maxOutputTokens || input_tokens + output_tokens !== total_tokens) throw new Error();
  const receipt = {model: actualModel, count, usage: {input_tokens, output_tokens, total_tokens}};

  failure = 'Could not save complete draft and token usage together.';
  const staging = await mkdtemp(join(dirname(destination), '.r24-editorial-'));
  try {
    await writeFile(join(staging, 'questions.json'), JSON.stringify({questions}, null, 2) + '\n', {mode: 0o600});
    await writeFile(join(staging, 'usage.json'), JSON.stringify(receipt, null, 2) + '\n', {mode: 0o600});
    await rename(staging, destination);
  } finally {
    await rm(staging, {recursive: true, force: true});
  }
  console.log(JSON.stringify(receipt));
} catch (error) {
  const status = Number.isInteger(error.status) ? ' HTTP ' + error.status : '';
  console.error(failure + status);
  process.exitCode = 1;
}
