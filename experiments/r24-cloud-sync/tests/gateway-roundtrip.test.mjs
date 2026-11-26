import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createAiGatewayClient } from '../backend/ai-gateway-client.mjs';
import gateway from '../singapore-gateway/server.js';

test('Shanghai client and SCF handler exchange draft and evaluation over loopback HTTP', async t => {
  const token = randomBytes(32).toString('hex');
  const providerKey = randomBytes(32).toString('hex');
  const rubric = {question: '配送前要量哪里？', referenceAnswer: '请核对入户转角。', keyPoints: ['核对转角']};
  const draft = {question: rubric.question, answer: rubric.referenceAnswer, keyPoints: rubric.keyPoints};
  const score = {overallScore: 80, grade: '良好', items: [{questionIndex: 0, score: 80,
    matchedPoints: rubric.keyPoints, missedPoints: [], comment: '说出了测量位置。', suggestedScript: '先量转角宽度，再请配送员核对。'}]};
  const usage = {prompt_tokens: 12, completion_tokens: 8, total_tokens: 20};
  const accepted = [];
  const server = gateway.createGateway({token, providerKey, fetchImpl: async (_url, init) => {
    assert.ok(init.headers.Authorization === 'Bearer ' + providerKey);
    const body = JSON.parse(init.body);
    assert.equal(body.store, false);
    assert.equal(body.stream, false);
    accepted.push(body.response_format.type);
    const evaluating = body.response_format.type === 'json_schema';
    if (evaluating) {
      assert.ok(body.response_format.json_schema.strict);
      assert.deepEqual(JSON.parse(body.messages.at(-1).content), [{questionIndex: 0, ...rubric, answerText: '量入户转角。'}]);
    }
    return Response.json({model: body.model, choices: [{finish_reason: 'stop',
      message: {role: 'assistant', content: JSON.stringify(evaluating ? score : {questions: [draft]})}}], usage});
  }});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  // Route only this test's HTTPS transport to the local, unencrypted SCF listener.
  const localOrigin = 'http://127.0.0.1:' + server.address().port;
  function client(secret) {
    return createAiGatewayClient({env: {AI_GATEWAY_URL: 'https://gateway.example.invalid', AI_GATEWAY_TOKEN: secret},
      fetchImpl: (url, init) => fetch(localOrigin + new URL(url).pathname, init)});
  }
  const shanghai = client(token);
  const generated = await shanghai.generate('生成一道公开合成练习题。');
  assert.deepEqual(generated.questions, [draft]);
  const input = [{...rubric, transcript: '量入户转角。'}];
  const evaluated = await shanghai.evaluate(input);
  assert.equal(evaluated.overallScore, 80);
  assert.deepEqual(evaluated.items, score.items);
  assert.deepEqual(evaluated.usage, usage);
  await assert.rejects(client(randomBytes(32).toString('hex')).evaluate(input),
    error => error.code === 'GATEWAY_HTTP_401' && error.retryCount === 0);
  assert.deepEqual(accepted, ['json_object', 'json_schema']);
});
