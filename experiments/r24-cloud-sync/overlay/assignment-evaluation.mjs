import {aiModelLabel} from './ai-model-label.mjs?v=r24-sync-v2-20261124.12';

// Keep the receipt for this exact set of saved answers. Only the server's opaque ID
// is used at submission; a local rendering of a score never becomes a cloud score.
export function evaluationInputKey(snapshot) {
  return JSON.stringify([snapshot.id, snapshot.assignmentId, snapshot.assignmentSnapshotSha256,
    snapshot.turns.map(turn => [turn.questionId, turn.answer || '', turn.transcript || '', Boolean(turn.manualCleared)])]);
}

const validScore = score => Number.isInteger(score) && score >= 0 && score <= 100;
const stringList = list => Array.isArray(list) && list.every(value => typeof value === 'string');
const gradeLabels = ['优秀', '良好', '待提升'];

export function validEvaluation(result, questionCount) {
  return Boolean(aiModelLabel(result)) &&
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
    <p class="scene-tip" data-ai-model>${escape(aiModelLabel(result))} 辅助评选，最终以运营复核为准。</p>
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

const errorMessages = {
  GATEWAY_CONFIG_MISSING: 'AI 评选服务尚未配置，请联系管理员。',
  GATEWAY_CONFIG_INVALID: 'AI 评选配置无效，请联系管理员。',
  GATEWAY_HTTP_401: 'AI 评选服务鉴权失败，请联系管理员。',
  GATEWAY_HTTP_403: 'AI 评选服务拒绝了请求，请联系管理员。',
  GATEWAY_HTTP_429: '评选服务繁忙，请稍后重试。',
  GATEWAY_NETWORK_ERROR: '暂时无法连接评选服务，请稍后重试。',
  GATEWAY_NETWORK_RESET: '评选服务连接中断，请重试。',
  HUNYUAN_TOKEN_QUOTA_EXCEEDED: '上海试点的腾讯云模型额度已用完，请联系管理员补充额度后再评选。',
  GATEWAY_TIMEOUT: '服务等待模型响应超时，请稍后重试。',
  INVALID_AI_JSON: '模型返回的评选不完整，请重试。',
  AI_EVALUATION_INPUT_INVALID: '每次评选须含 1–15 道完整题目和有效回答，参考资料与回答合计最多 20,000 字符。',
  AI_EVALUATION_LIMIT: '今天的 AI 调用额度已用完，请稍后再试。',
  AI_EVALUATION_QUOTA_UNAVAILABLE: '暂时无法确认评选额度，请稍后重试。',
  AI_EVALUATION_ALREADY_SUBMITTED: '本场已提交，请打开云端提交记录查看。',
  AI_EVALUATION_DISABLED: '试点尚未启用 AI 评选。',
  SUBMISSION_INVALID: '作业版本、题目或回答不完整，请核对逐题内容。',
  AUTH_REQUIRED: '当前设备登录已失效，请重新进入练播房。',
  ASSIGNMENT_NOT_FOUND: '该作业已无法访问，请重新打开作业。',
  AI_EVALUATION_MISMATCH: '本场回答或作业已变化，请重新评选。',
  CLIENT_TIMEOUT: '等待评选结果超时，请稍后重试。',
  CLIENT_NETWORK_ERROR: '网络连接失败，请检查网络。',
};

export function evaluationFailure(error) {
  const code = error?.code;
  const upstream = typeof code === 'string' && /^GATEWAY_HTTP_([45]\d{2})$/u.exec(code);
  const reason = Object.hasOwn(errorMessages,code) ? errorMessages[code] :
    upstream ? '评选服务返回 HTTP ' + upstream[1] + '，请凭请求编号联系运营。' : '云端未生成有效评选，请稍后重试或联系运营。';
  const id = typeof error?.requestId === 'string' && /^[A-Za-z0-9._:-]{1,96}$/u.test(error.requestId)
    ? '请求编号 '+error.requestId : '未收到服务端请求编号';
  return reason + ' ' + id + '。仍可提交本场回答。';
}
