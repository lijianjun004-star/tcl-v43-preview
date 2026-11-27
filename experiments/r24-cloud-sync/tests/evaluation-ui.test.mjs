import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evaluationReadbackHtml, evaluationResultHtml, isRepositoryReviewPending, repositoryReviewLabel, validEvaluation} from '../overlay/assignment-evaluation.mjs';

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

test('the original immutable evaluation takes priority over a later readback evaluation', () => {
  const newer = {...result,model:'gpt-6.1-terra',source:'openai_offline',overallScore:0};
  const html = evaluationReadbackHtml({evaluation:result,turns,repositoryReview:{status:'pending_review',evaluation:newer}},escape);
  assert.match(html,/待运营复核/);
  assert.match(html,/75 \/ 100/);
  assert.match(html,/OpenAI 网关/);
  assert.doesNotMatch(html,/gpt-6\.1-terra/);
});

test('pending and terminal labels are limited to the server states', () => {
  for (const [status,label,pending] of [
    ['waiting','等待后台 AI 评选',true],
    ['processing','正在后台 AI 评选',true],
    ['pending_review','待运营复核',false],
    ['needs_attention','需要运营处理',false],
  ]) {
    const repositoryReview = {status};
    assert.equal(repositoryReviewLabel(repositoryReview), label);
    assert.equal(isRepositoryReviewPending(repositoryReview), pending);
    const html = evaluationReadbackHtml({turns,repositoryReview},escape);
    assert.ok(html.includes(label));
    assert.doesNotMatch(html,/未生成 AI 评选|总分/);
  }
  for (const repositoryReview of [undefined,{}, {status:'<script>'}, {status:'toString'}]) {
    assert.equal(repositoryReviewLabel(repositoryReview),'');
    assert.equal(isRepositoryReviewPending(repositoryReview),false);
    assert.match(evaluationReadbackHtml({turns,repositoryReview},escape),/未生成 AI 评选/);
  }
});

test('review displays the saved provider and model for Hunyuan and both generations of OpenAI records', () => {
  for (const [source, model, label] of [
    ['cloudbase_hunyuan', 'hy3', '腾讯混元 · hy3'],
    ['cloudbase_hunyuan', 'hy3-preview', '腾讯混元 · hy3-preview'],
    ['openai_gateway', 'gpt-4o-mini', 'OpenAI · gpt-4o-mini'],
    ['openai_gateway', 'gpt-4o', 'OpenAI · gpt-4o'],
    ['openai_gateway', undefined, 'OpenAI 网关'],
    ['openai_offline', 'gpt-6.1-terra', 'OpenAI · gpt-6.1-terra'],
    ['openai_offline', 'gpt-4o-mini', 'OpenAI · gpt-4o-mini'],
  ]) {
    const record = {...result, source, model};
    assert.equal(validEvaluation(record, turns.length), true);
    assert.ok(evaluationResultHtml(record, turns, escape).includes(label));
  }
});
