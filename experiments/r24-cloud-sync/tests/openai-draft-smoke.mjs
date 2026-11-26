import assert from 'node:assert/strict';
import { createApi } from '../backend/api.mjs';
import { createOpenAIDraftGenerator } from '../backend/openai-assignment-draft.mjs';

// A fixed synthetic case for an in-process acceptance test. No HTTP listener or user input.
const operator = { id: 'synthetic', teamId: 'test', role: 'operator', displayName: '合成运营', active: true };
const generate = createOpenAIDraftGenerator({
  apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4.1-mini', maxOutputTokens: 512,
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
    material: '合成练习：顾客想买大屏电视，担心过不了电梯转角。请围绕入户前要确认的尺寸生成一道题。没有提供具体安装费用或商品参数。',
  }),
}));
const result = await response.json();
assert.equal(response.status, 200, result.error?.code);
assert.equal(calls, 1);
assert.equal(result.questions.length, 1);
const [draft] = result.questions;
assert.ok(draft.answer.length && draft.keyPoints.length);
console.log('Validated customer question:', JSON.stringify(draft.question));
console.log('Validated scoring points:', draft.keyPoints.length);
