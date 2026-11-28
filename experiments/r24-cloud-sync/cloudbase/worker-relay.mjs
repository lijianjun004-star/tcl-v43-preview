import {createGitHubWorkerVerifier, oidcFailureReason} from './worker-oidc.mjs';

const operations = new Map([
  ['claim', {rpc: 'claim', fields: ['lease']}],
  ['start', {rpc: 'start_attempt', fields: ['id', 'lease']}],
  ['save', {rpc: 'save_result', fields: ['id', 'lease', 'result', 'receipt']}],
  ['ack', {rpc: 'ack', fields: ['id', 'lease']}],
  ['hold', {rpc: 'hold', fields: ['id', 'lease', 'reason']}],
]);
const holdReasons = new Set(['invalid_receipt', 'invalid_input', 'score_unconfirmed', 'invalid_result']);
const hexJob = /^[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equalFields = (value, fields) => object(value) && Object.keys(value).length === fields.length &&
  fields.every(field => Object.hasOwn(value, field));

function json(body, status = 200) {
  return Response.json(body, {status, headers: {'cache-control': 'no-store'}});
}

function scoreMatches(result, receipt, id) {
  return object(result) && object(receipt) && receipt.jobId === id && receipt.schemaVersion === 1 &&
    receipt.reviewStatus === 'pending_review' && receipt.model === result.model &&
    Number.isInteger(receipt.overallScore) && receipt.overallScore >= 0 && receipt.overallScore <= 100 &&
    result.overallScore === receipt.overallScore && result.grade === receipt.grade &&
    Array.isArray(result.items) && Array.isArray(receipt.items) &&
    result.items.length >= 1 && result.items.length <= 15 && result.items.length === receipt.items.length &&
    (receipt.origin === 'submission' ||
      (receipt.origin === 'openai_review' && result.source === 'openai_offline' && result.model === 'gpt-6.1-terra'));
}

function rpcArguments(op, fields, body) {
  if (!equalFields(body, fields) || typeof body.lease !== 'string' || !uuid.test(body.lease) ||
      (op !== 'claim' && (typeof body.id !== 'string' || !hexJob.test(body.id)))) return null;
  const params = {p_lease: body.lease};
  if (op !== 'claim') params.p_job_id = body.id;
  if (op === 'hold') {
    if (!holdReasons.has(body.reason)) return null;
    params.p_reason = body.reason;
  }
  if (op === 'save') {
    if (!scoreMatches(body.result, body.receipt, body.id)) return null;
    params.p_result = body.result;
    params.p_receipt = body.receipt;
  }
  return params;
}

export function createWorkerRelay({db, envId, prefix, verifyToken}) {
  return async (request, next) => {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/worker/')) return next(request);
    const op = path.slice('/worker/'.length);
    const spec = operations.get(op);
    if (!spec || envId !== 'unknown-roadrunner-d7cap6e21f517' || prefix !== 'tcl_r24_sync_v1' ||
        request.method !== 'POST' || request.headers.has('origin')) {
      return json({error: {code: 'ROUTE_NOT_FOUND'}}, 404);
    }
    const header = request.headers.get('authorization') || '';
    const token = header.length <= 16384 && /^Bearer ([^\s,]+)$/i.exec(header)?.[1];
    if (!token) return json({error: {code: 'WORKER_AUTH_REQUIRED'}}, 401);
    try {
      verifyToken ??= createGitHubWorkerVerifier();
      if (await verifyToken(token) !== true) throw new Error('Invalid identity');
    } catch (error) {
      console.warn('R24_SCORE_WORKER_OIDC', oidcFailureReason(error));
      return json({error: {code: 'WORKER_AUTH_FAILED'}}, 401);
    }
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return json({error: {code: 'INVALID_WORKER_ARGUMENTS'}}, 400);
    }
    const body = await request.json().catch(() => null);
    const params = rpcArguments(op, spec.fields, body);
    if (!params) return json({error: {code: 'INVALID_WORKER_ARGUMENTS'}}, 400);
    try {
      const reply = await db.rpc(prefix + '_worker_' + spec.rpc, params);
      if (reply?.error || !Array.isArray(reply?.data) || reply.data.length !== 1 ||
          !equalFields(reply.data[0], ['value'])) throw new Error('Unexpected queue response');
      const {value} = reply.data[0];
      const valid = op === 'claim'
        ? (value === null || (object(value) && typeof value.jobId === 'string' && hexJob.test(value.jobId) &&
          ['ready', 'scored'].includes(value.state)))
        : typeof value === 'boolean';
      if (valid) return json({value});
    } catch { /* Service errors can contain private database data. */ }
    return json({error: {code: 'QUEUE_UNAVAILABLE'}}, 503);
  };
}
