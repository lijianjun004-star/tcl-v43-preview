import assert from 'node:assert/strict';
import { createApi } from '../backend/api.mjs';
import { createOpenAIDraftGenerator } from '../backend/openai-assignment-draft.mjs';

// A fixed synthetic case for an in-process acceptance test. No HTTP listener or user input.
const operator = { id: 'synthetic', teamId: 'test', role: 'operator', displayName: '合成运营', active: true };
let usage;
const generate = createOpenAIDraftGenerator({
  apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4.1-mini', maxOutputTokens: 512,
  async fetchImpl(url, options) {
    const response = await fetch(url, options);
    if (response.ok) usage = (await response.clone().json()).usage;
    return response;
  },
});
let calls = 0;
const handle = createApi({
  authenticate: async token => token === 'fixture' ? operator : null,
  draftGeneration: {
    canGenerate: actor => actor === operator,
    async generate(actor, prompt) {
      assert.equal(actor, operator);
      assert.equal(++calls, 1);
      try {
        return await generate(prompt);
      } catch (error) {
        if (Number.isInteger(error?.status)) console.error('OpenAI HTTP status:', error.status);
        throw error;
      }
    },
  },
});
const response = await handle(new Request('https://r24.test/assignments/draft', {
  method: 'POST',
  headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    boardId: '01', platform: '京东', count: 1,
    material: '合成练习：顾客买大屏电视时看到免费基础安装，想确认是否包含挂架和挂装。本练习没有给出具体活动条款。参考回答请指导顾客在哪里核对服务范围和可能的收费。',
  }),
}));
const result = await response.json();
assert.equal(response.status, 200, result.error?.code);
assert.equal(calls, 1);
assert.equal(result.questions.length, 1);
const [draft] = result.questions;
assert.ok(draft.answer.length && draft.keyPoints.length);
console.log('Validated synthetic draft:', JSON.stringify(draft));
if (usage && [usage.input_tokens, usage.output_tokens, usage.total_tokens].every(Number.isSafeInteger)) {
  console.log('OpenAI usage:', JSON.stringify({input: usage.input_tokens, output: usage.output_tokens, total: usage.total_tokens}));
}
