import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evaluationFailure, evaluationInputKey, evaluationResultHtml, validEvaluation} from '../overlay/assignment-evaluation.mjs';

const turns = [{questionId: 'q1', question:'如何介绍配送？', answer:'先核实通道', transcript:''}];
const result = {source:'openai_gateway', degraded:false, grade:'良好', overallScore:75, items:[
  {questionIndex:0, score:75, matchedPoints:['核实通道'], missedPoints:['查看包装尺寸'],
    comment:'已提及通道。', suggestedScript:'请先核对包装尺寸和可用通道。'},
]};
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

test('records without a complete gateway result display the legacy no-evaluation state', () => {
  for (const value of [null, undefined, {}, {...result,degraded:true}, {...result,source:'local'},
    {...result,source:'cloudbase_hunyuan'}, {...result,source:'cloudbase_hunyuan',model:'gpt-4o-mini'},
    {...result,model:'hy3-preview'}, {...result,overallScore:101}, {...result,items:[]}, {...result,items:[{...result.items[0],questionIndex:1}]}]) {
    assert.equal(Boolean(validEvaluation(value,turns.length)),false);
    assert.match(evaluationResultHtml(value,turns,escape),/未生成 AI 评选/);
    assert.doesNotMatch(evaluationResultHtml(value,turns,escape),/总分/);
  }
});

test('read-only evaluation includes both groups of points, comments, suggestions, and escaped text', () => {
  const modified = {...result,items:[{...result.items[0],comment:'<标签> 或 <script>'}]};
  const html = evaluationResultHtml(modified,turns,escape);
  for (const text of ['75 / 100','良好','命中要点','核实通道','遗漏要点','查看包装尺寸','&lt;标签&gt;','改进口播话术','最终以运营复核为准']) assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/<script>|<button|<input/);
});

test('cached results are bound to session, assignment snapshot, order and saved answers', () => {
  const snapshot = {id:'session',assignmentId:'task',assignmentSnapshotSha256:'frozen',turns};
  const key = evaluationInputKey(snapshot);
  assert.equal(evaluationInputKey(structuredClone(snapshot)),key);
  for (const changed of [{id:'other'}, {assignmentId:'other'}, {assignmentSnapshotSha256:'revised'},
    {turns:[{...turns[0],questionId:'other'}]}, {turns:[{...turns[0],answer:'补充过的回答'}]},
    {turns:[{...turns[0],transcript:'新的转写'}]}, {turns:[{...turns[0],manualCleared:true}]}]) {
    assert.notEqual(evaluationInputKey({...snapshot,...changed}),key);
  }
});

test('errors show a safe localized explanation and the returned trace ID', () => {
  const failed = evaluationFailure({code:'GATEWAY_CONFIG_MISSING',requestId:'trace-123',message:'private raw details'});
  assert.match(failed,/尚未配置/);assert.match(failed,/trace-123/);assert.doesNotMatch(failed,/private raw/);
  assert.match(evaluationFailure({code:'CLIENT_TIMEOUT'}),/未收到服务端请求编号/);
  assert.doesNotMatch(evaluationFailure({requestId:'<invalid>'}),/<invalid>/);
  const quota = evaluationFailure({code:'HUNYUAN_TOKEN_QUOTA_EXCEEDED',requestId:'hy-quota-1'});
  assert.match(quota,/上海试点的腾讯云模型额度已用完/);
  assert.match(quota,/hy-quota-1.*仍可提交本场回答/);
});

test('review displays the saved provider and model for Hunyuan and both generations of OpenAI records', () => {
  for (const [source, model, label] of [
    ['cloudbase_hunyuan', 'hy3', '腾讯混元 · hy3'],
    ['cloudbase_hunyuan', 'hy3-preview', '腾讯混元 · hy3-preview'],
    ['openai_gateway', 'gpt-4o-mini', 'OpenAI · gpt-4o-mini'],
    ['openai_gateway', 'gpt-4o', 'OpenAI · gpt-4o'],
    ['openai_gateway', undefined, 'OpenAI 网关'],
  ]) {
    const record = {...result, source, model};
    assert.equal(validEvaluation(record, turns.length), true);
    assert.ok(evaluationResultHtml(record, turns, escape).includes(label));
  }
});
