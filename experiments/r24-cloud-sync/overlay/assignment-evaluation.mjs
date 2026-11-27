import {aiModelLabel} from './ai-model-label.mjs?v=r24-sync-v2-20261124.13-async-rc1';

const offlineModels = ['gpt-6.1-terra', 'gpt-4o-mini', 'gpt-4o'];
const reviewStatusLabels = {
  waiting: '等待后台 AI 评选',
  processing: '正在后台 AI 评选',
  pending_review: '待运营复核',
  needs_attention: '需要运营处理',
};

function evaluationModelLabel(result) {
  if (result?.source === 'openai_offline' && result.degraded === false && offlineModels.includes(result.model)) {
    return 'OpenAI · ' + result.model;
  }
  return aiModelLabel(result);
}

export function repositoryReviewLabel(review) {
  return Object.hasOwn(reviewStatusLabels, review?.status) ? reviewStatusLabels[review.status] : '';
}

export function isRepositoryReviewPending(review) {
  return review?.status === 'waiting' || review?.status === 'processing';
}

const validScore = score => Number.isInteger(score) && score >= 0 && score <= 100;
const stringList = list => Array.isArray(list) && list.every(value => typeof value === 'string');
const gradeLabels = ['优秀', '良好', '待提升'];

export function validEvaluation(result, questionCount) {
  return Boolean(evaluationModelLabel(result)) &&
    validScore(result.overallScore) && gradeLabels.includes(result.grade) &&
    Array.isArray(result.items) && result.items.length === questionCount && questionCount > 0 &&
    result.items.every((item, index) => item && item.questionIndex === index && validScore(item.score) &&
      stringList(item.matchedPoints) && stringList(item.missedPoints) &&
      typeof item.comment === 'string' && item.comment.trim() &&
      typeof item.suggestedScript === 'string' && item.suggestedScript.trim());
}

export function evaluationResultHtml(result, turns, escape) {
  if (!validEvaluation(result, turns.length)) {
    return '<p class="scene-tip" data-ai-eval-empty>未生成 AI 评选</p>';
  }
  const points = (label, list) => '<div class="eval-points"><strong>' + label + '</strong>' +
    (list.length ? list.map(point => '<span class="eval-point">' + escape(point) + '</span>').join('') : '<span>无</span>') + '</div>';
  return `<section class="eval-result" data-ai-eval-result aria-label="AI 辅助评选">
    <div class="eval-result-head"><strong>总分 ${result.overallScore} / 100</strong><span class="pill">${escape(result.grade)}</span></div>
    <p class="scene-tip" data-ai-model>${escape(evaluationModelLabel(result))} 辅助评选，最终以运营复核为准。</p>
    ${result.items.map((item,index)=>`<article class="eval-item">
       <h4>第 ${index + 1} 题 · ${item.score} 分</h4>
       <p>${escape(turns[index].question || turns[index].prompt || '')}</p>
       ${points('命中要点',item.matchedPoints)}
       ${points('遗漏要点',item.missedPoints)}
       <p><strong>评语</strong> ${escape(item.comment)}</p>
       <p><strong>改进口播话术</strong> ${escape(item.suggestedScript)}</p>
    </article>`).join('')}
  </section>`;
}

export function evaluationReadbackHtml(record, escape) {
  const turns = Array.isArray(record.turns) ? record.turns : [];
  const status = repositoryReviewLabel(record.repositoryReview);
  const score = validEvaluation(record.evaluation, turns.length)
    ? record.evaluation
    : record.repositoryReview?.evaluation;
  const statusHtml = status ? '<p class="scene-tip" data-ai-eval-status>' + escape(status) + '</p>' : '';
  if (!validEvaluation(score, turns.length) && status) return statusHtml;
  return statusHtml + evaluationResultHtml(score, turns, escape);
}
