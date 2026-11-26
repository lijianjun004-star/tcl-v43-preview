import { randomUUID } from 'node:crypto';
import { readAssignmentDraftResponse } from '../overlay/assignment-drafts.mjs';
import { validateExcelQuestions } from './vendor/assignment-excel.mjs';

const errors = new Map([
  ['GATEWAY_CONFIG_MISSING', [503, '出题网关配置不完整，请联系管理员。']],
  ['GATEWAY_CONFIG_INVALID', [503, '出题网关配置无效，请联系管理员。']],
  ['GATEWAY_TIMEOUT', [504, '出题网关请求超时，请稍后重试。']],
  ['GATEWAY_NETWORK_RESET', [503, '连接出题网关时网络中断，请稍后重试。']],
  ['GATEWAY_NETWORK_ERROR', [503, '暂时无法连接出题网关，请稍后重试。']],
  ['INVALID_AI_JSON', [502, '网关返回的草稿未通过题目格式校验。']],
  ['AI_DRAFT_LIMIT', [429, '今天的一键出题次数已用完。']],
  ['AI_DRAFT_QUOTA_UNAVAILABLE', [503, '暂时无法核实出题额度，请稍后重试。']],
  ['AI_DRAFT_UNAVAILABLE', [403, '当前账号未开通一键出题。']],
  ['AI_DRAFT_FAILED', [503, '暂时无法生成草稿，请稍后重试。']],
]);

const fallbackHeaders = new Map([
  ['顾客弹幕', 'question'], ['弹幕内容', 'question'], ['问题', 'question'], ['题目', 'question'], ['question', 'question'],
  ['参考话术', 'answer'], ['案例话术1', 'answer'], ['参考答案', 'answer'], ['答案', 'answer'], ['answer', 'answer'],
  ['评分要点', 'keyPoints'], ['评分点', 'keyPoints'], ['要点', 'keyPoints'], ['keyPoints', 'keyPoints'],
  ['品类', 'category'], ['category', 'category'], ['平台', 'platform'], ['platform', 'platform'],
]);

function checkedQuestions(rows, context) {
  const validated = validateExcelQuestions(rows, { category: context.category, platform: context.platform, max: context.count });
  if (validated.some(row => !row.keyPoints.length)) throw new Error('Missing scoring points');
  return validated.map(({ question, answer, keyPoints }) => ({ question, answer, keyPoints }));
}

function localQuestions(material, context) {
  try {
    // Read only complete rows supplied for this assignment. Never interpret an upstream error as source material.
    if (/^\s*(?:\{|```)/u.test(material)) return checkedQuestions(readAssignmentDraftResponse(material), context);
    const lines = material.trim().split(/\r?\n/u);
    if (/^工作表 [^\t]+$/u.test(lines[0])) lines.shift();
    const columns = lines.shift().split('\t').map(label => fallbackHeaders.get(label.trim()));
    if (columns.includes(undefined) || new Set(columns).size !== columns.length ||
        !['question', 'answer', 'keyPoints'].every(field => columns.includes(field))) return null;
    const rows = lines.map(line => {
      const cells = line.split('\t');
      if (cells.length !== columns.length) throw new Error('Incomplete source row');
      const row = Object.fromEntries(columns.map((key, i) => [key, cells[i]]));
      // Keep empty fragments for validation, including a trailing or doubled separator.
      row.keyPoints = row.keyPoints.split(/[;,，、；]/u).map(point => point.trim());
      return row;
    });
    return checkedQuestions(rows, context);
  } catch {
    return null;
  }
}

function knownFailure(error) {
  const code = error?.code ?? error?.errorCode;
  if (errors.has(code)) return [code, ...errors.get(code)];
  if (typeof code === 'string' && /^GATEWAY_HTTP_[45]\d\d$/u.test(code)) {
    const status = Number(code.slice(-3));
    const statusForClient = status === 429 || status === 503 ? 503 : 502;
    return [code, statusForClient, `出题网关返回 HTTP ${status}，请凭请求编号核查。`];
  }
  return ['AI_DRAFT_FAILED', ...errors.get('AI_DRAFT_FAILED')];
}

function recordGatewayOutcome(audit, outcome) {
  audit.httpStatus = Number.isInteger(outcome?.httpStatus) && outcome.httpStatus >= 100 && outcome.httpStatus <= 599
    ? outcome.httpStatus : null;
  audit.retryCount = outcome?.retryCount === 1 ? 1 : 0;
  const usage = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    const value = outcome?.usage?.[key];
    if (Number.isSafeInteger(value) && value >= 0) usage[key] = value;
  }
  audit.usage = Object.keys(usage).length ? usage : null;
}

export function startDraftCall(model) {
  const safeModel = typeof model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/u.test(model) &&
    !model.includes('://') && !/^(?:sk[-_]|bearer)/iu.test(model);
  return {
    start: performance.now(), requestId: randomUUID(), model: safeModel ? model : null,
    httpStatus: null, retryCount: 0, usage: null,
  };
}

export function finishDraftCall(audit, body, status, log) {
  const { start, ...fields } = audit;
  const degraded = body.degraded === true;
  const source = body.source || 'none';
  const errorCode = body.errorCode || body.error?.code;
  const result = { ...body, requestId: audit.requestId, retryCount: audit.retryCount, degraded, source };
  if (errorCode) Object.assign(result, {errorCode, errorMessage: body.errorMessage || body.error?.message});
  try {
    log({
      ...fields, responseStatus: status, latencyMs: Math.round(performance.now() - start),
      degraded, source, errorCode: errorCode || null,
    });
  } catch { /* A logging failure must not repeat a generation or change its response. */ }
  return result;
}

function gatewayQuestions(result, context) {
  if (!Number.isInteger(result?.httpStatus) || result.httpStatus < 200 || result.httpStatus > 299 ||
      ![0, 1].includes(result.retryCount)) throw new Error('Unexpected gateway result');
  const rows = readAssignmentDraftResponse(JSON.stringify({questions: result.questions}));
  return checkedQuestions(rows, context);
}

export async function generateAssignmentDraft({draftGeneration, principal, prompt, material, context, audit}) {
  let failure;
  try {
    const result = await draftGeneration.generate(principal, prompt, {...context, requestId: audit.requestId});
    recordGatewayOutcome(audit, result);
    try {
      const questions = gatewayQuestions(result, context);
      return {body: {questions, degraded: false, source: 'openai_gateway'}};
    } catch {
      failure = {code: 'INVALID_AI_JSON'};
    }
  } catch (error) {
    recordGatewayOutcome(audit, error);
    failure = error;
  }

  const [errorCode, status, errorMessage] = knownFailure(failure);
  const mayFallback = errorCode.startsWith('GATEWAY_') || errorCode === 'INVALID_AI_JSON';
  if (mayFallback && draftGeneration.fallbackEnabled === true) {
    const questions = localQuestions(material, context);
    if (questions) return {body: {questions, degraded: true, source: 'fallback', errorCode, errorMessage}};
  }
  return {status, body: {error: {code: errorCode, message: errorMessage}}};
}
