import {
  evaluationInstructions, evaluationResponseFormat, validateEvaluationInput, validateEvaluationResult,
} from '../backend/evaluation-schema.mjs';
import {validateScoreReceipt} from './archive.mjs';

const endpoint = 'https://api.openai.com/v1/chat/completions';
const model = 'gpt-6.1-terra';
const reasoningEffort = 'low';
const maxCompletionTokens = 8192;
const rubricVersion = 'r24-evaluation-v1';
const modelIds = new Set([model, 'gpt-4o-mini', 'gpt-4o', 'hy3', 'hy3-preview']);
const usageFields = ['prompt_tokens','completion_tokens','total_tokens'];
const safeJobId = /^[a-f0-9]{64}$/;
const safeLease = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = code => {throw new Error(code);};

function safeModel(value) {
  if (modelIds.has(value)) return value;
  if (typeof value === 'string' && /^gpt-6\.1-terra-\d{4}-\d{2}-\d{2}$/.test(value)) return model;
  if (typeof value === 'string' && /^gpt-4o-mini-\d{4}-\d{2}-\d{2}$/.test(value)) return 'gpt-4o-mini';
  if (typeof value === 'string' && /^gpt-4o-\d{4}-\d{2}-\d{2}$/.test(value)) return 'gpt-4o';
  fail('INVALID_MODEL');
}

function metering(value, reportReasoning) {
  const result = {};
  for (const k of usageFields) if (Number.isSafeInteger(value?.[k]) && value[k] >= 0) result[k] = value[k];
  const reasoning = value?.completion_tokens_details?.reasoning_tokens;
  if (reportReasoning || reasoning !== undefined) {
    result.completion_tokens_details = {
      reasoning_tokens: Number.isSafeInteger(reasoning) && reasoning >= 0 ? reasoning : null,
    };
  }
  return Object.keys(result).length ? result : null;
}

function safeRequestId(id) {
  return typeof id === 'string' && /^[a-z0-9_-]{1,100}$/i.test(id) &&
    !/^sk[-_]/i.test(id) ? id : null;
}

function scoringFields(result) {
  return {overallScore:result.overallScore, grade:result.grade, items:result.items};
}

async function readEnvelope(response) {
  if (!response.body || Number(response.headers.get('content-length')) > 256 * 1024) fail('INVALID_RESPONSE');
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 256 * 1024) fail('INVALID_RESPONSE');
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks, size)));
}

export function createOpenAIScorer(apiKey, {fetchImpl = fetch, timeoutMs = 45000} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || /\s|[\x00-\x1f\x7f]/.test(apiKey)) fail('OPENAI_CREDENTIAL_REQUIRED');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 90000) fail('INVALID_TIMEOUT');
  return async items => {
    const input = validateEvaluationInput(items);
    const prompt = JSON.stringify(input.map((item, questionIndex) => ({questionIndex, ...item})));
    const body = {model, stream:false, store:false, response_format:evaluationResponseFormat,
      reasoning_effort:reasoningEffort, max_completion_tokens:maxCompletionTokens,
      messages:[{role:'system',content:evaluationInstructions},{role:'user',content:prompt}]};
    if (prompt.includes(apiKey)) fail('INPUT_CREDENTIAL_DETECTED');
    const start = performance.now();
    let response;
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      response = await fetchImpl(endpoint, {method:'POST', redirect:'error', signal,
        headers:{'Content-Type':'application/json', Authorization:'Bearer '+apiKey}, body:JSON.stringify(body)});
      if (response.status !== 200) {
        await response.body?.cancel();
        fail('OPENAI_HTTP_ERROR');
      }
      const envelope = await readEnvelope(response);
      const returnedModel = envelope?.model;
      const choice = envelope?.choices?.[0];
      if (safeModel(returnedModel) !== model || envelope.error || envelope.object !== 'chat.completion' ||
          !Array.isArray(envelope.choices) || envelope.choices.length !== 1 || choice?.finish_reason !== 'stop' ||
          choice?.message?.role !== 'assistant' || choice.message.refusal || choice.message.tool_calls ||
          choice.message.function_call || typeof choice.message.content !== 'string') fail('INVALID_RESPONSE');
      const result = validateEvaluationResult(JSON.parse(choice.message.content), input);
      const serialized = JSON.stringify(result);
      if (serialized.includes(apiKey) || /\bsk[-_][a-z0-9_-]{12,}/i.test(serialized)) fail('INVALID_RESPONSE');
      const requestId = safeRequestId(response.headers.get('x-request-id'));
      return {...result, model:returnedModel, requestedModel:model, returnedModel,
        source:'openai_offline', rubricVersion, reasoningEffort, maxCompletionTokens,
        usage:metering(envelope.usage, true),
        requestId:requestId && !requestId.includes(apiKey) ? requestId : null, elapsedMs:Math.round(performance.now()-start)};
    } catch {
      // Never forward upstream error bodies, response excerpts, exceptions or private input to runner logs.
      fail('OPENAI_REVIEW_UNCONFIRMED');
    }
  };
}

function buildResult(jobId, origin, input, raw) {
  if (!raw || typeof raw !== 'object') fail('INVALID_RESULT');
  const result = validateEvaluationResult(scoringFields(raw), input);
  const modelId = safeModel(raw.model);
  const newReview = origin === 'openai_review';
  if (newReview && (modelId !== model || raw.source !== 'openai_offline')) fail('UNEXPECTED_MODEL');
  const source = origin === 'openai_review' ? 'openai_offline' :
    (['openai_gateway','cloudbase_hunyuan','openai_offline'].includes(raw.source) ? raw.source : null);
  const stored = {...result, model:modelId, source, usage:metering(raw.usage, newReview), requestId:safeRequestId(raw.requestId),
    ...(newReview ? {requestedModel:model, returnedModel:raw.model, rubricVersion, reasoningEffort, maxCompletionTokens} : {}),
    elapsedMs:Number.isSafeInteger(raw.elapsedMs) && raw.elapsedMs >= 0 ? raw.elapsedMs : null};
  const receipt = validateScoreReceipt({
    schemaVersion:1, jobId, origin, model:modelId, overallScore:result.overallScore, grade:result.grade,
    items:result.items.map((item,index) => {
      const points = input[index].keyPoints;
      return {questionIndex:index, score:item.score, matched:item.matchedPoints.map(p=>points.indexOf(p)+1).sort((a,b)=>a-b),
        missed:item.missedPoints.map(p=>points.indexOf(p)+1).sort((a,b)=>a-b)};
    }),
    reviewStatus:'pending_review',
  });
  return {stored, receipt};
}

async function hold(queue, jobId, lease, reason) {
  try {
    return {status:await queue.hold(jobId,lease,reason) === true ? 'held' : 'lease_lost'};
  } catch {fail('QUEUE_HOLD_UNCONFIRMED');}
}

export async function processOne({queue, score, archive, lease}) {
  if (typeof lease !== 'string' || !safeLease.test(lease)) fail('INVALID_LEASE');
  let job;
  try {job = await queue.claim(lease);}
  catch {fail('QUEUE_CLAIM_UNCONFIRMED');}
  if (job === null) return {status:'empty'};
  if (!job || typeof job.jobId !== 'string' || !safeJobId.test(job.jobId)) fail('INVALID_CLAIM');
  const {jobId} = job;
  let receipt;
  if (job.state === 'scored') {
    try {
      receipt = validateScoreReceipt(job.receipt, {historical:true});
      if (receipt.jobId !== jobId) fail('RECEIPT_JOB_MISMATCH');
    } catch {return hold(queue,jobId,lease,'invalid_receipt');}
  } else if (job.state === 'ready') {
    let input;
    try {input = validateEvaluationInput(job.items);}
    catch {return hold(queue,jobId,lease,'invalid_input');}

    const reuse = job.existingEvaluation != null;
    let raw = job.existingEvaluation;
    if (!reuse) {
      if (score == null) return {status:'needs_model'};
      if (typeof score !== 'function') fail('INVALID_SCORER');
      // Only the owner which atomically acquires this durable one-way flag may contact OpenAI.
      let started;
      try {started = await queue.startAttempt(jobId,lease);}
      catch {fail('QUEUE_ATTEMPT_UNCONFIRMED');}
      if (started !== true) return {status:'lease_lost'};
      try {raw = await score(input);}
      catch {return hold(queue,jobId,lease,'score_unconfirmed');}
    }
    let stored;
    try {({stored,receipt} = buildResult(jobId,reuse?'submission':'openai_review',input,raw));}
    catch {return hold(queue,jobId,lease,'invalid_result');}
    try {
      if (await queue.saveResult(jobId,lease,stored,receipt) !== true) return {status:'lease_lost'};
    } catch {
      // The atomic save may already have committed. Never undo it or repeat a paid attempt.
      fail('QUEUE_SAVE_UNCONFIRMED');
    }
  } else {fail('INVALID_CLAIM_STATE');}

  try {
    const outcome = await archive(receipt, {historical:job.state === 'scored'});
    if (!(outcome === true || ['archived','already_archived'].includes(outcome?.status))) return {status:'archive_pending'};
  } catch {return {status:'archive_pending'};}
  try {return {status:await queue.ack(jobId,lease) === true ? 'archived' : 'ack_pending'};}
  catch {return {status:'ack_pending'};}
}
