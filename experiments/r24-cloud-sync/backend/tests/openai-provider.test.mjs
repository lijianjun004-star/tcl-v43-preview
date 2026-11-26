import assert from 'node:assert/strict';
import test from 'node:test';
import {createOpenAIDraftGenerator} from '../openai-assignment-draft.mjs';
import {buildAssignmentDraftPrompt, readAssignmentDraftResponse} from '../../overlay/assignment-drafts.mjs';

const options = {model: 'test-model', apiKey: 'unit-test-fixture'};
const question = {question: '电视能挂在墙上吗？', answer: '需要测量墙体与机身。', keyPoints: ['核实墙体条件']};
const text = JSON.stringify({questions: [question]});
const message = {
  type: 'message', role: 'assistant', status: 'completed', content: [{type: 'output_text', text}],
};

test('the fixed Responses endpoint returns a draft for the existing assignment parser', async () => {
  const prompt = buildAssignmentDraftPrompt('核实墙体和机身尺寸后答复顾客。', {category: '电视', platform: '京东', count: 1});
  let calls = 0;
  const generate = createOpenAIDraftGenerator({...options, maxOutputTokens: 512, fetchImpl: async (url, request) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.Authorization, 'Bearer ' + options.apiKey);
    assert.ok(request.signal instanceof AbortSignal);
    const body = JSON.parse(request.body);
    assert.equal(body.input, prompt);
    assert.equal(body.model, options.model);
    assert.equal(body.max_output_tokens, 512);
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.deepEqual(body.text.format.schema.properties.questions.items.required, Object.keys(question));
    return Response.json({status: 'completed', output: [{type: 'reasoning'}, message]});
  }});
  assert.deepEqual(readAssignmentDraftResponse(await generate(prompt)), [question]);
  assert.equal(calls, 1);
});

test('incomplete responses, refusal, malformed JSON and oversized streams never reach the reviewer', async () => {
  const inputs = [
    Response.json({status: 'incomplete', output: [message]}),
    Response.json({status: 'completed', output: [{...message, status: 'incomplete'}]}),
    Response.json({status: 'completed', output: [{...message, content: [...message.content, {type: 'refusal'}]}]}),
    Response.json({status: 'completed', output: []}),
    new Response('bad JSON with sensitive details'),
    new Response(new Uint8Array(256 * 1024 + 1)),
  ];
  for (const response of inputs) {
    const generate = createOpenAIDraftGenerator({...options, fetchImpl: async () => response});
    await assert.rejects(generate('prompt'), {message: 'OpenAI draft response was incomplete or invalid'});
  }
});

test('provider/transport errors are sanitized and are not retried', async () => {
  for (const status of [0, 401, 429, 500]) {
    let calls = 0;
    const generate = createOpenAIDraftGenerator({...options, fetchImpl: async () => {
      calls++;
      if (!status) throw new Error('Sensitive network detail');
      return new Response('Sensitive upstream detail', {status});
    }});
    const expected = status ? `OpenAI draft request failed (HTTP ${status})` : 'OpenAI draft request failed';
    await assert.rejects(generate('合成提示'), status ? {message: expected, status} : {message: expected});
    assert.equal(calls, 1);
  }
});

test('bad configuration and prompt bounds fail before any request', async () => {
  for (const invalid of [{apiKey: ''}, {apiKey: 'bad\nkey'}, {model: ''}, {maxOutputTokens: 0}, {maxOutputTokens: 4097}]) {
    assert.throws(() => createOpenAIDraftGenerator({...options, ...invalid}), /Invalid OpenAI draft configuration/);
  }
  let calls = 0;
  const generate = createOpenAIDraftGenerator({...options, fetchImpl: () => { calls++; }});
  for (const prompt of [null, ' ', '字'.repeat(50_000)]) {
    await assert.rejects(generate(prompt), {message: 'Invalid assignment draft prompt'});
  }
  assert.equal(calls, 0);
});
