import { createHash, randomUUID } from 'node:crypto';
import { startDraftCall, finishDraftCall, generateAssignmentDraft } from './assignment-draft-service.mjs';
import { isHunyuanModel } from './ai-gateway-client.mjs';
import { validateEvaluationInput, validateEvaluationResult } from './evaluation-schema.mjs';
import { buildAssignmentDraftPrompt } from '../overlay/assignment-drafts.mjs';
import {
  isReceiptLate,
  sha256Hex,
  toReceipt,
  verifyAssignment,
} from './vendor/assignment-excel.mjs';
import { boardDefinitions } from './vendor/qa3-boards.mjs';

const MAX_BODY_BYTES = 1_000_000;
const MAX_PAGE_BYTES = 1_000_000;
const MAX_PAGE_ROWS = 20;
const MAX_DRAFT_BODY_BYTES = 128 * 1024;
const MAX_DRAFT_QUESTIONS = 15;
const DRAFT_FIELDS = ['material', 'boardId', 'platform', 'count'];
export const MAX_AUDIO_BYTES = 512 * 1024;
const HEX_SHA256 = /^[a-f0-9]{64}$/u;
const audioTypes = new Map([
  ['audio/webm', 'webm'], ['audio/ogg', 'ogg'], ['audio/mp4', 'm4a'],
  ['audio/wav', 'wav'], ['audio/x-wav', 'wav'], ['audio/mpeg', 'mp3'],
  ['audio/aac', 'aac'], ['audio/x-m4a', 'm4a'],
]);
const ASSIGNMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SNAPSHOT_CONTEXT = [
  'assignmentId', 'assignmentVersion', 'assignmentSnapshotSha256',
  'operatorName', 'boardId', 'platform', 'anchorName', 'id',
];
const TURN_FIELDS = [
  'questionId', 'question', 'answer', 'transcript', 'model', 'sku',
  'asrStatus', 'manualCleared',
];

class ApiProblem extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function problem(status, code, message) {
  throw new ApiProblem(status, code, message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function selectFields(value, names) {
  return Object.fromEntries(names.filter(name => Object.hasOwn(value, name)).map(name => [name, value[name]]));
}

function validIdentity(identity) {
  return identity?.active === true
    && ['operator', 'anchor'].includes(identity.role)
    && typeof identity.id === 'string' && identity.id.length > 0 && identity.id.length <= 128
    && typeof identity.teamId === 'string' && identity.teamId.length > 0 && identity.teamId.length <= 128
    && typeof identity.displayName === 'string' && identity.displayName === identity.displayName.trim()
    && identity.displayName.length > 0 && [...identity.displayName].length <= 40
    && !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(identity.displayName);
}

function operatorOnly(principal) {
  if (principal.role !== 'operator') problem(403, 'OPERATOR_REQUIRED', '此操作仅限运营人员');
}

function anchorOnly(principal) {
  if (principal.role !== 'anchor') problem(403, 'ANCHOR_REQUIRED', '此操作仅限主播');
}

function canAccess(record, principal) {
  if (record?.teamId !== principal.teamId) return false;
  if (principal.role === 'operator') return record.operatorId === principal.id;
  return record.recipients.length === 0 || record.recipients.some(({ id }) => id === principal.id);
}

function assertVisible(record, principal) {
  if (!canAccess(record, principal)) problem(404, 'ASSIGNMENT_NOT_FOUND', '找不到可访问的作业');
}

function jsonResponse(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') problem(415, 'JSON_REQUIRED', '请求须使用 application/json');
  if (Number(request.headers.get('content-length')) > maxBytes) {
    problem(413, 'PAYLOAD_TOO_LARGE', '请求内容过大');
  }
  if (!request.body) problem(400, 'JSON_INVALID', '请求缺少 JSON 对象');

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        problem(413, 'PAYLOAD_TOO_LARGE', '请求内容过大');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    const parsed = JSON.parse(chunks.join(''));
    if (!isRecord(parsed)) problem(400, 'JSON_INVALID', '请求须为 JSON 对象');
    return parsed;
  } catch (error) {
    if (error instanceof ApiProblem) throw error;
    problem(400, 'JSON_INVALID', '请求 JSON 格式无效');
  } finally {
    reader.releaseLock();
  }
}

function cleanAssignment(record) {
  return { assignment: record.assignment, publishedAt: record.publishedAt };
}

function publicAudio({ questionId, mimeType, bytes }) {
  return { questionId, mimeType, bytes };
}

function cleanSubmission(record, audio) {
  const { id, assignmentId, assignmentVersion, snapshotSha256, anchorId, anchorName,
    sessionId, submittedAt, late, turns } = record;
  return { id, assignmentId, assignmentVersion, snapshotSha256, anchorId, anchorName,
    sessionId, submittedAt, late, turns, ...(record.evaluation ? {evaluation: record.evaluation} : {}), ...(audio ? { audio } : {}) };
}

function descending(a, b) {
  return a === b ? 0 : a > b ? -1 : 1;
}

function parseCursor(raw) {
  if (raw === null) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,500}$/u.test(raw)) throw new Error();
    const fields = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(fields) || fields.length !== 2) throw new Error();
    const [time, id] = fields;
    if (typeof time !== 'string' || !Number.isFinite(Date.parse(time))
        || new Date(time).toISOString() !== time || typeof id !== 'string'
        || !ASSIGNMENT_ID.test(id)) throw new Error();
    return { time, id };
  } catch {
    return problem(400, 'CURSOR_INVALID', '分页游标无效');
  }
}

function page(records, transform, timeField, url, key) {
  const cursor = parseCursor(url.searchParams.get('cursor'));
  const compare = (a, b) => descending(a[timeField], b[timeField]) || descending(a.id, b.id);
  const sorted = records.sort(compare);
  const rows = [];
  let usedBytes = 0;
  let nextCursor = null;
  let last;
  for (const row of sorted) {
    if (cursor && compare(row, { [timeField]: cursor.time, id: cursor.id }) <= 0) continue;
    const publicRow = transform(row);
    const bytes = Buffer.byteLength(JSON.stringify(publicRow), 'utf8');
    if (last && (rows.length === MAX_PAGE_ROWS || usedBytes + bytes > MAX_PAGE_BYTES)) {
      nextCursor = Buffer.from(JSON.stringify([last[timeField], last.id]), 'utf8').toString('base64url');
      break;
    }
    rows.push(publicRow);
    usedBytes += bytes;
    last = row;
  }
  return { [key]: rows, nextCursor };
}

function assignableAnchor(candidate, teamId) {
  return validIdentity(candidate) && candidate.role === 'anchor' && candidate.teamId === teamId;
}

function validateRecipientIds(ids) {
  if (!Array.isArray(ids) || ids.length > 100
      || ids.some(id => typeof id !== 'string' || !id || id.length > 128)
      || new Set(ids).size !== ids.length) {
    problem(422, 'RECIPIENTS_INVALID', '接收主播名单格式无效');
  }
  return ids;
}

async function resolveRecipients(directory, teamId, ids) {
  if (!ids.length) return [];
  const anchors = new Map(
    (await directory.listAnchors(teamId))
      .filter(anchor => assignableAnchor(anchor, teamId))
      .map(anchor => [anchor.id, anchor.displayName]),
  );
  return ids.map(id => {
    const displayName = anchors.get(id);
    if (!displayName) problem(422, 'RECIPIENTS_INVALID', '接收主播必须是本团队启用的帐号');
    return { id, displayName };
  });
}

function boardFor(boards, boardId) {
  const board = boards.get(boardId);
  if (!board) problem(422, 'BOARD_INVALID', '作业板块无效');
  return board;
}

async function assignmentDraft(request, principal, { boards, draftGeneration, draftAudit }) {
  operatorOnly(principal);
  const available = draftGeneration?.canGenerate(principal) === true;
  if (request.method === 'GET') return { body: { available } };
  if (!available) problem(403, 'AI_DRAFT_UNAVAILABLE', '当前账号未开通一键出题');

  const body = await readJson(request, MAX_DRAFT_BODY_BYTES);
  if (Object.keys(body).length !== DRAFT_FIELDS.length || !DRAFT_FIELDS.every(field => Object.hasOwn(body, field))
      || !Number.isInteger(body.count) || body.count < 1 || body.count > MAX_DRAFT_QUESTIONS) {
    problem(422, 'AI_DRAFT_INPUT_INVALID', '请提供作业板块、平台和资料，并选择 1–15 道题');
  }
  const board = boardFor(boards, body.boardId);
  const { category } = board;
  const { material, platform, count } = body;
  if (!board.platforms.includes(platform)) problem(422, 'AI_DRAFT_INPUT_INVALID', '所选平台与作业板块不匹配');

  let prompt;
  try {
    prompt = buildAssignmentDraftPrompt(material, { category, platform, count });
  } catch {
    problem(422, 'AI_DRAFT_INPUT_INVALID', '出题资料格式无效或超过 20000 字，请整理后重试');
  }

  return generateAssignmentDraft({
    draftGeneration, principal, prompt, material, context: {category, platform, count}, audit: draftAudit,
  });
}

async function assignmentOf(body, boards) {
  const board = boardFor(boards, body.assignment?.boardId);
  try {
    return await verifyAssignment(body.assignment, { board });
  } catch (error) {
    problem(422, 'ASSIGNMENT_INVALID', error.message);
  }
}

function assignmentResponse(record, teamId, operatorId, payloadHash, replayed) {
  if (!record) problem(503, 'WRITE_PENDING', '暂未读到作业写入结果，请用同一作业重试');
  if (record.teamId !== teamId || record.operatorId !== operatorId || record.payloadHash !== payloadHash) {
    problem(409, 'ASSIGNMENT_CONFLICT', '作业 ID 已被使用，不能替换已发布版本');
  }
  return { status: replayed ? 200 : 201, body: { ...cleanAssignment(record), replayed } };
}

async function publish(request, principal, { store, directory, boards, now }) {
  operatorOnly(principal);
  const body = await readJson(request);
  const assignment = await assignmentOf(body, boards);
  const recipientIds = validateRecipientIds(body.recipientIds);
  const payloadHash = await sha256Hex({
    snapshotSha256: assignment.snapshotSha256,
    recipientIds,
  });
  const current = await store.getAssignment(assignment.id);
  if (current) return assignmentResponse(current, principal.teamId, principal.id, payloadHash, true);
  if (assignment.operatorName !== principal.displayName) {
    problem(422, 'PUBLISHER_MISMATCH', '作业发布人须与登录运营帐号一致');
  }

  const recipients = await resolveRecipients(directory, principal.teamId, recipientIds);
  if (recipients.length !== assignment.assignedTo.length
      || recipients.some(({ displayName }, index) => displayName !== assignment.assignedTo[index])) {
    problem(422, 'RECIPIENTS_MISMATCH', '作业名单须与接收帐号一致');
  }

  const record = {
    id: assignment.id,
    teamId: principal.teamId,
    operatorId: principal.id,
    assignment,
    recipients,
    publishedAt: now().toISOString(),
    payloadHash,
  };
  if (await store.createAssignment(record)) return assignmentResponse(record, principal.teamId, principal.id, payloadHash, false);
  const existing = await store.getAssignment(record.id);
  return assignmentResponse(existing, principal.teamId, principal.id, payloadHash, true);
}

function buildReceipt(record, principal, incoming, previous) {
  if (!isRecord(incoming) || !Array.isArray(incoming.turns)
      || incoming.turns.length !== record.assignment.questions.length
      || incoming.turns.some(turn => !isRecord(turn))) {
    problem(422, 'SUBMISSION_INVALID', '提交须包含原作业的完整答题记录');
  }
  const projection = selectFields(incoming, SNAPSHOT_CONTEXT);
  const assignedName = previous?.anchorName
    ?? record.recipients.find(({ id }) => id === principal.id)?.displayName
    ?? principal.displayName;
  if (projection.anchorName !== assignedName) {
    problem(422, 'SUBMITTER_MISMATCH', '提交主播须与已授权的主播帐号一致');
  }
  try {
    return toReceipt(record.assignment, {
      ...projection,
      anchorName: assignedName,
      turns: incoming.turns.map(turn => selectFields(turn, TURN_FIELDS)),
    });
  } catch (error) {
    problem(422, 'SUBMISSION_INVALID', error.message);
  }
}

function evaluationMismatch() {
  problem(409, 'AI_EVALUATION_MISMATCH', '评选与当前场次或回答不匹配，请重新评选或仅提交文字');
}

function evaluationKey(sessionKey, receipt) {
  return sha256Hex(['evaluation-v1', sessionKey, receipt.snapshotSha256,
    receipt.turns.map(turn => [turn.questionId, turn.answer, turn.transcript])]);
}

function evaluationFailure(code) {
  const errors = {
    GATEWAY_CONFIG_MISSING: [503, '评选网关尚未配置，请联系管理员'],
    GATEWAY_CONFIG_INVALID: [503, '评选网关配置无效，请联系管理员'],
    GATEWAY_TIMEOUT: [504, '评选网关超时，可稍后重试'],
    GATEWAY_NETWORK_ERROR: [503, '评选网关暂时无法连接'],
    GATEWAY_NETWORK_RESET: [503, '评选网关连接中断'],
    HUNYUAN_TOKEN_QUOTA_EXCEEDED: [503, '腾讯云混元模型额度已用完，请联系管理员核查模型额度'],
    INVALID_AI_JSON: [502, '模型结果不完整或格式异常，本次未评分'],
    AI_EVALUATION_INPUT_INVALID: [422, '评选需要 1–15 道完整题目和有效回答，且须符合内容长度上限'],
    AI_EVALUATION_LIMIT: [429, '今天的 AI 调用额度已用完'],
    AI_EVALUATION_DISABLED: [403, '试点尚未启用 AI 评选'],
    AI_EVALUATION_QUOTA_UNAVAILABLE: [503, '暂时无法核实评选额度'],
  };
  if (typeof code === 'string' && /^GATEWAY_HTTP_[45]\d\d$/u.test(code)) {
    problem(code === 'GATEWAY_HTTP_429' || code === 'GATEWAY_HTTP_503' ? 503 : 502, code,
      '评选网关返回 HTTP ' + code.slice(-3) + '，请凭请求编号核查');
  }
  if (Object.hasOwn(errors, code)) problem(errors[code][0], code, errors[code][1]);
  problem(503, 'AI_EVALUATION_FAILED', '暂时无法完成 AI 评选，可以继续提交文字');
}

async function evaluateAssignment(request, principal, {store, evaluationGeneration, evaluationRequestId}) {
  anchorOnly(principal);
  const body = await readJson(request, 128 * 1024);
  const snapshot = body.snapshot;
  if (Object.keys(body).length !== 1 || !isRecord(snapshot) || typeof snapshot.assignmentId !== 'string' ||
      !ASSIGNMENT_ID.test(snapshot.assignmentId) || typeof snapshot.id !== 'string' || !ASSIGNMENT_ID.test(snapshot.id) ||
      !Array.isArray(snapshot.turns) || snapshot.turns.length < 1 || snapshot.turns.length > 15) {
    evaluationFailure('AI_EVALUATION_INPUT_INVALID');
  }
  const assignmentRecord = await store.getAssignment(snapshot.assignmentId);
  assertVisible(assignmentRecord, principal);
  // The canonical answer is the reviewed text. Never resurrect a deliberately cleared answer.
  const turns = snapshot.turns.map(turn => isRecord(turn) && !Object.hasOwn(turn, 'answer')
    ? {...turn, answer: turn.answerText ?? turn.transcript} : turn);
  const receipt = buildReceipt(assignmentRecord, principal, {...snapshot, turns});
  let items;
  try {
    items = validateEvaluationInput(assignmentRecord.assignment.questions.map((q, index) => ({
      question: q.question, referenceAnswer: q.answer, keyPoints: q.keyPoints, answerText: receipt.turns[index].answer,
    })));
  } catch { evaluationFailure('AI_EVALUATION_INPUT_INVALID'); }

  if (!evaluationGeneration) evaluationFailure('GATEWAY_CONFIG_MISSING');
  const sessionKey = await sha256Hex([principal.teamId, principal.id, snapshot.assignmentId, snapshot.id]);
  const id = await evaluationKey(sessionKey, receipt);
  const submitted = await store.getSubmission(sessionKey);
  if (submitted) {
    if (submitted.evaluationId === id && submitted.evaluation) {
      return {body: {evaluationId: id, evaluation: submitted.evaluation}};
    }
    problem(409, 'AI_EVALUATION_ALREADY_SUBMITTED', '这场练播已经提交，已提交记录只支持查看');
  }
  const existing = await store.getEvaluation(id);
  if (existing) return {body: {evaluationId: id, evaluation: existing.evaluation}};
  let result;
  try {
    result = await evaluationGeneration.evaluate(items);
  } catch (error) { evaluationFailure(error?.code); }

  let scoring;
  const source = evaluationGeneration.source ?? 'openai_gateway';
  try {
    const validModel = source === 'openai_gateway' ? ['gpt-4o-mini', 'gpt-4o'].includes(result?.model) :
      source === 'cloudbase_hunyuan' && isHunyuanModel(result?.model) && evaluationGeneration.model === result.model;
    if (!validModel || result.httpStatus !== 200) {
      throw new Error('Invalid upstream result');
    }
    scoring = validateEvaluationResult({overallScore: result.overallScore, grade: result.grade, items: result.items}, items);
  } catch { evaluationFailure('INVALID_AI_JSON'); }
  const usage = Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens']
    .filter(key => Number.isSafeInteger(result.usage?.[key]) && result.usage[key] >= 0)
    .map(key => [key, result.usage[key]]));
  const evaluation = {...scoring, model: result.model, usage: Object.keys(usage).length ? usage : null,
    requestId: evaluationRequestId, source, degraded: false};
  const record = {id, assignmentId: snapshot.assignmentId, teamId: principal.teamId, anchorId: principal.id, evaluation};
  // Insert-only storage makes concurrent completions converge on the same authoritative score.
  const confirmed = await store.createEvaluation(record) ? record : await store.getEvaluation(id);
  if (!confirmed) problem(503, 'WRITE_PENDING', '评选结果尚未确认，请用同一场次重试');
  return {body: {evaluationId: id, evaluation: confirmed.evaluation}};
}

function submissionResponse(record, payloadHash, replayed, evaluationId) {
  if (!record) problem(503, 'WRITE_PENDING', '暂未读到提交写入结果，请用同一场次重试');
  if (record.payloadHash !== payloadHash || (evaluationId !== undefined && record.evaluationId !== evaluationId)) {
    problem(409, 'SUBMISSION_CONFLICT', '本场练播已提交，不能替换已保存的回答');
  }
  return { status: replayed ? 200 : 201, body: { submission: cleanSubmission(record), replayed } };
}

async function submit(request, assignmentId, principal, { store, now }) {
  anchorOnly(principal);
  const assignmentRecord = await store.getAssignment(assignmentId);
  assertVisible(assignmentRecord, principal);
  const { snapshot, evaluationId } = await readJson(request);
  if (evaluationId !== undefined && (typeof evaluationId !== 'string' || !HEX_SHA256.test(evaluationId))) {
    problem(422, 'AI_EVALUATION_ID_INVALID', '评选编号无效');
  }
  const sessionId = snapshot?.id;
  if (typeof sessionId !== 'string' || !ASSIGNMENT_ID.test(sessionId)) {
    problem(422, 'SUBMISSION_INVALID', '练播场次 ID 格式无效');
  }
  const id = await sha256Hex([principal.teamId, principal.id, assignmentId, sessionId]);
  const current = await store.getSubmission(id);
  const receipt = buildReceipt(assignmentRecord, principal, snapshot, current);
  const payloadHash = await sha256Hex({
    snapshotSha256: receipt.snapshotSha256,
    turns: receipt.turns,
  });
  if (current) return submissionResponse(current, payloadHash, true, evaluationId);

  let evaluation;
  if (evaluationId !== undefined) {
    const expectedId = await evaluationKey(id, receipt);
    if (expectedId !== evaluationId) evaluationMismatch();
    evaluation = (await store.getEvaluation(evaluationId))?.evaluation;
    if (!evaluation) evaluationMismatch();
  }

  const submittedAt = now().toISOString();
  const submission = {
    id,
    teamId: principal.teamId,
    assignmentId,
    assignmentVersion: receipt.assignmentVersion,
    snapshotSha256: receipt.snapshotSha256,
    anchorId: principal.id,
    anchorName: receipt.anchorName,
    sessionId: receipt.sessionId,
    submittedAt,
    late: isReceiptLate({ submittedAt }, assignmentRecord.assignment),
    turns: receipt.turns,
    payloadHash,
    ...(evaluation ? {evaluationId, evaluation} : {}),
  };
  if (await store.createSubmission(submission)) return submissionResponse(submission, payloadHash, false, evaluationId);
  return submissionResponse(await store.getSubmission(id), payloadHash, true, evaluationId);
}

async function assignmentPage(store, principal, url) {
  const records = (await store.listAssignments(principal.teamId)).filter(record => canAccess(record, principal));
  if (principal.role === 'operator') return page(records, cleanAssignment, 'publishedAt', url, 'assignments');

  const latest = new Map();
  const [statuses, claims] = await Promise.all([
    store.listAnchorSubmissionStatuses(principal.teamId, principal.id),
    store.listAnchorClaims(principal.teamId, principal.id),
  ]);
  const claimedByAssignment = new Map(claims.map(claim => [claim.assignmentId, claim.claimedAt]));
  for (const { assignmentId, submittedAt } of statuses) {
    const old = latest.get(assignmentId);
    if (!old || submittedAt > old) latest.set(assignmentId, submittedAt);
  }
  const view = record => ({
    ...cleanAssignment(record),
    claimedAt: claimedByAssignment.get(record.id) ?? null,
    submitted: latest.has(record.id),
    lastSubmittedAt: latest.get(record.id) ?? null,
  });
  return page(records, view, 'publishedAt', url, 'assignments');
}

function resourceId(encoded, label, pattern = ASSIGNMENT_ID) {
  let value;
  try {
    value = decodeURIComponent(encoded);
  } catch {
    problem(400, label + '_ID_INVALID', '记录 ID 格式无效');
  }
  if (!pattern.test(value)) problem(400, label + '_ID_INVALID', '记录 ID 格式无效');
  return value;
}

async function claim(request, assignmentId, principal, { store, now }) {
  anchorOnly(principal);
  const body = await readJson(request);
  if (Object.keys(body).length) problem(400, 'CLAIM_INVALID', '领取作业无需填写额外字段');
  const assignment = await store.getAssignment(assignmentId);
  assertVisible(assignment, principal);
  const id = await sha256Hex([principal.teamId, principal.id, assignmentId]);
  const existing = await store.getClaim(id);
  if (existing) return { body: { claimedAt: existing.claimedAt, replayed: true } };
  const deadline = assignment.assignment.deadline;
  if (deadline && now().getTime() >= Date.parse(deadline)) {
    problem(409, 'ASSIGNMENT_CLOSED', '该作业已截止，无法首次领取');
  }
  const record = {
    id, assignmentId, teamId: principal.teamId, anchorId: principal.id,
    anchorName: principal.displayName, claimedAt: now().toISOString(),
  };
  if (await store.createClaim(record)) return { status: 201, body: { claimedAt: record.claimedAt, replayed: false } };
  const confirmed = await store.getClaim(id);
  if (!confirmed) problem(503, 'WRITE_PENDING', '暂未读到领取结果，请重试');
  return { body: { claimedAt: confirmed.claimedAt, replayed: true } };
}

async function progress(assignmentId, url, principal, store) {
  operatorOnly(principal);
  assertVisible(await store.getAssignment(assignmentId), principal);
  const [claims, submissions] = await Promise.all([
    store.listClaims(assignmentId, principal.teamId),
    store.listAssignmentSubmissionStatuses(assignmentId, principal.teamId),
  ]);
  const byAnchor = new Map(claims.map(row => [row.anchorId, {
    anchorId: row.anchorId, anchorName: row.anchorName, claimedAt: row.claimedAt, submittedAt: null,
  }]));
  for (const { anchorId, anchorName, submittedAt } of submissions) {
    const row = byAnchor.get(anchorId) ?? { anchorId, anchorName, claimedAt: null, submittedAt: null };
    if (!row.submittedAt || submittedAt > row.submittedAt) row.submittedAt = submittedAt;
    byAnchor.set(anchorId, row);
  }
  const rows = [...byAnchor.values()].map(row => ({ ...row, id: row.anchorId, updatedAt: row.submittedAt ?? row.claimedAt }));
  const view = ({ id, updatedAt, ...publicRow }) => publicRow;
  return { body: page(rows, view, 'updatedAt', url, 'claims') };
}

async function submissionPage(assignmentId, url, principal, store, own) {
  const assignment = await store.getAssignment(assignmentId);
  if (own) anchorOnly(principal);
  else operatorOnly(principal);
  assertVisible(assignment, principal);
  const anchorId = own ? principal.id : undefined;
  const cursor = parseCursor(url.searchParams.get('cursor'));
  const headers = await store.listSubmissionHeaders(assignmentId, principal.teamId, anchorId, cursor, MAX_PAGE_ROWS + 1);
  const rows = [];
  let bytes = 0;
  const batchSize = 4;
  for (let offset = 0; offset < Math.min(headers.length, MAX_PAGE_ROWS); offset += batchSize) {
    const ids = headers.slice(offset, Math.min(offset + batchSize, MAX_PAGE_ROWS)).map(row => row.id);
    const [submissions, audio] = await Promise.all([
      store.listSubmissions(assignmentId, principal.teamId, anchorId, ids),
      store.listSubmissionAudio(assignmentId, principal.teamId, anchorId, ids),
    ]);
    const byId = new Map(submissions.map(row => [row.id, row]));
    for (const id of ids) {
      const row = byId.get(id);
      if (!row || row.assignmentId !== assignmentId || row.teamId !== principal.teamId || (own && row.anchorId !== anchorId)) {
        throw new Error('Inconsistent submission page');
      }
      const view = cleanSubmission(row, audio.filter(a => a.readyAt && a.submissionId === id &&
        a.anchorId === row.anchorId && a.teamId === row.teamId && a.assignmentId === row.assignmentId).map(publicAudio));
      const rowBytes = Buffer.byteLength(JSON.stringify(view));
      if (rows.length && bytes + rowBytes > MAX_PAGE_BYTES) break;
      bytes += rowBytes;
      rows.push(view);
    }
    if (rows.length < offset + ids.length) break;
  }
  const last = rows.at(-1);
  const nextCursor = last && rows.length < headers.length
    ? Buffer.from(JSON.stringify([last.submittedAt, last.id])).toString('base64url') : null;
  return {body: {submissions: rows, nextCursor}};
}

const digestBytes = bytes => createHash('sha256').update(bytes).digest('hex');

function matchesAudioFormat(bytes, extension) {
  const first = bytes.subarray(0, 4);
  const head = first.toString('ascii');
  switch (extension) {
    case 'webm': return first.equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    case 'ogg': return head === 'OggS';
    case 'm4a': return bytes.subarray(4, 8).toString('ascii') === 'ftyp';
    case 'wav': return head === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE';
    case 'mp3': return head.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    case 'aac': return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
    default: return false;
  }
}

function audioPayload(body) {
  const { questionId, mimeType, base64 } = body;
  if (typeof questionId !== 'string' || !ASSIGNMENT_ID.test(questionId)) {
    problem(422, 'AUDIO_QUESTION_INVALID', '题目编号无效');
  }
  const normalizedType = typeof mimeType === 'string' && mimeType.length <= 128
    ? mimeType.split(';', 1)[0].trim().toLowerCase() : '';
  const extension = audioTypes.get(normalizedType);
  if (!extension) problem(415, 'AUDIO_FORMAT_INVALID', '不支持此录音格式');
  if (typeof base64 !== 'string' || !base64 || base64.length % 4 !== 0) {
    problem(422, 'AUDIO_INVALID', '录音编码无效');
  }
  if (base64.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4) {
    problem(413, 'AUDIO_TOO_LARGE', '每段录音最多 512 KiB');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > MAX_AUDIO_BYTES) problem(413, 'AUDIO_TOO_LARGE', '每段录音最多 512 KiB');
  if (!bytes.length || bytes.toString('base64') !== base64 || !matchesAudioFormat(bytes, extension)) {
    problem(422, 'AUDIO_INVALID', '录音编码或内容与格式不符');
  }
  return { questionId, mimeType: normalizedType, extension, bytes, sha256: digestBytes(bytes) };
}

async function audioParent(assignmentId, submissionId, principal, store) {
  const assignment = await store.getAssignment(assignmentId);
  assertVisible(assignment, principal);
  const record = await store.getSubmission(submissionId);
  if (!record || record.assignmentId !== assignmentId || record.teamId !== principal.teamId ||
      (principal.role === 'anchor' && record.anchorId !== principal.id)) {
    problem(404, 'SUBMISSION_NOT_FOUND', '找不到可访问的作业提交');
  }
  return record;
}

function assertAudioQuestion(submission, questionId) {
  if (!submission.turns.some(turn => turn.questionId === questionId)) {
    problem(404, 'AUDIO_QUESTION_INVALID', '提交中没有这道题');
  }
}

function assertAudioAvailable(media) {
  if (!media) problem(503, 'AUDIO_UNAVAILABLE', '音频服务暂不可用，文字记录已保留');
}

function checkedAudioBytes(bytes, record) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== record.bytes || digestBytes(bytes) !== record.sha256) {
    problem(503, 'AUDIO_UNAVAILABLE', '录音未能通过校验，请稍后重试');
  }
  return bytes;
}

async function audioDownload(assignmentId, submissionId, url, principal, { store, media }) {
  const submission = await audioParent(assignmentId, submissionId, principal, store);
  const questionId = url.searchParams.get('questionId');
  assertAudioQuestion(submission, questionId);
  const id = await sha256Hex([submission.id, questionId]);
  const record = await store.getAudio(id);
  if (!record?.readyAt) problem(404, 'AUDIO_NOT_FOUND', '这道题还没有可播放的云端录音');
  assertAudioAvailable(media);
  let bytes;
  try {
    bytes = await media.get(record.objectPath);
  } catch {
    problem(503, 'AUDIO_UNAVAILABLE', '云端录音暂时无法读取，请重试');
  }
  return { body: { mimeType: record.mimeType, base64: checkedAudioBytes(bytes, record).toString('base64') } };
}

async function audioUpload(request, assignmentId, submissionId, principal, { store, media, now }) {
  anchorOnly(principal);
  const submission = await audioParent(assignmentId, submissionId, principal, store);
  assertAudioAvailable(media);
  const recording = audioPayload(await readJson(request));
  const { questionId, mimeType, extension, bytes, sha256 } = recording;
  assertAudioQuestion(submission, questionId);
  const id = await sha256Hex([submission.id, questionId]);
  const pending = {
    id, submissionId, assignmentId, questionId, mimeType, bytes: bytes.length, sha256,
    teamId: submission.teamId, anchorId: submission.anchorId,
    objectPath: `submissions/${submission.id}/${id}.${extension}`, readyAt: null,
  };
  let record = await store.getAudio(id);
  const inserted = !record && await store.createAudio(pending);
  if (!record) record = inserted ? pending : await store.getAudio(id);
  if (!record) problem(503, 'WRITE_PENDING', '录音状态尚未确认，文字记录已保留，请重试');
  if (record.sha256 !== sha256 || record.mimeType !== mimeType || record.bytes !== bytes.length) {
    problem(409, 'AUDIO_CONFLICT', '本题已有另一段录音，请重试上传原录音');
  }
  if (record.readyAt) return { body: { audio: publicAudio(record), replayed: true } };
  try {
    await media.put(record.objectPath, mimeType, bytes);
    // Check the object before making its metadata available. This also verifies
    // an insert-only replay after any interrupted upload.
    checkedAudioBytes(await media.get(record.objectPath), record);
    const ready = await store.markAudioReady(record.id, now().toISOString());
    if (!ready?.readyAt) throw new Error('Audio readiness not confirmed');
    return { status: inserted ? 201 : 200, body: { audio: publicAudio(ready), replayed: !inserted } };
  } catch (error) {
    const failure = { code: 'AUDIO_UPLOAD_PENDING', message: '文字记录已提交，录音尚未确认，可重试上传' };
    if (['credential-request','credential-response','upload-request','upload-response','upload-confirmation',
      'download-request','download-response'].includes(error?.storageOperation)) {
      failure.stage = error.storageOperation;
      if (Number.isInteger(error.storageStatus) && error.storageStatus >= 400 && error.storageStatus < 600) {
        failure.upstreamStatus = error.storageStatus;
      }
    }
    return { status: 503, body: { error: failure } };
  }
}

async function route(request, url, path, principal, dependencies) {
  const { store, directory } = dependencies;
  const { method } = request;
  if (method === 'GET' && path === '/me') {
    const { id, role, displayName } = principal;
    return { body: { principal: { id, role, displayName } } };
  }
  if (method === 'GET' && path === '/recipients') {
    operatorOnly(principal);
    const recipients = (await directory.listAnchors(principal.teamId))
      .filter(anchor => assignableAnchor(anchor, principal.teamId))
      .map(({ id, displayName }) => ({ id, displayName }));
    return { body: { recipients } };
  }
  if (path === '/assignments') {
    if (method === 'POST') return publish(request, principal, dependencies);
    if (method === 'GET') return { body: await assignmentPage(store, principal, url) };
  }
  if (method === 'POST' && path === '/assignments/evaluate') return evaluateAssignment(request, principal, dependencies);
  if (path === '/assignments/draft' && (method === 'GET' || method === 'POST')) {
    return assignmentDraft(request, principal, dependencies);
  }
  const match = /^\/assignments\/([^/]+)\/(claim|progress|submissions|my-submissions)(?:\/([^/]+)\/audio)?$/u.exec(path);
  if (!match) return problem(404, 'ROUTE_NOT_FOUND', '找不到请求的接口');
  const [, rawId, action, rawSubmission] = match;
  const assignmentId = resourceId(rawId, 'ASSIGNMENT');
  if (rawSubmission && action === 'submissions') {
    const submissionId = resourceId(rawSubmission, 'SUBMISSION', HEX_SHA256);
    if (method === 'POST') return audioUpload(request, assignmentId, submissionId, principal, dependencies);
    if (method === 'GET') return audioDownload(assignmentId, submissionId, url, principal, dependencies);
  } else if (!rawSubmission) {
    if (action === 'claim' && method === 'POST') return claim(request, assignmentId, principal, dependencies);
    if (action === 'progress' && method === 'GET') return progress(assignmentId, url, principal, store);
    if (action === 'submissions' && method === 'POST') return submit(request, assignmentId, principal, dependencies);
    if ((action === 'submissions' || action === 'my-submissions') && method === 'GET') {
      return submissionPage(assignmentId, url, principal, store, action === 'my-submissions');
    }
  }
  return problem(404, 'ROUTE_NOT_FOUND', '找不到请求的接口');
}

export function createApi({
  authenticate,
  authenticateEvaluation = authenticate,
  directory,
  store,
  media,
  draftGeneration,
  evaluationGeneration,
  now = () => new Date(),
  boards = boardDefinitions,
  allowedOrigins = [],
  basePath = '',
  onError = () => {},
  logDraft = entry => console.info(JSON.stringify(entry)),
}) {
  const dependencies = {
    directory, store, now, media, draftGeneration, evaluationGeneration,
    boards: new Map(boards.map(board => [board.id, board])),
  };
  const origins = new Set(allowedOrigins);
  return async function handle(request) {
    const origin = request.headers.get('origin');
    const cors = { Vary: 'Origin' };
    if (origin && origins.has(origin)) cors['Access-Control-Allow-Origin'] = origin;
    if (request.method === 'OPTIONS') {
      if (!origin || !origins.has(origin)) {
        return jsonResponse({ error: { code: 'ORIGIN_DENIED', message: '来源未获授权' } }, 403, cors);
      }
      return new Response(null, { status: 204, headers: {
        ...cors,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'Authorization, Content-Type',
        'access-control-max-age': '600',
      } });
    }
    const url = new URL(request.url);
    const evaluationRequestId = request.method === 'POST' && url.pathname === basePath + '/assignments/evaluate' ? randomUUID() : null;
    const draftAudit = request.method === 'POST' && url.pathname === basePath + '/assignments/draft'
      ? startDraftCall(draftGeneration?.model) : null;
    const respond = (body, status) => {
      const result = draftAudit ? finishDraftCall(draftAudit, body, status, logDraft) : body;
      return jsonResponse(evaluationRequestId ? {...result, requestId: evaluationRequestId} : result, status, cors);
    };
    try {
      const token = /^Bearer ([^\s,]{1,8192})$/iu.exec(request.headers.get('authorization') ?? '')?.[1];
      if (!token) problem(401, 'AUTH_REQUIRED', '请先登录');
      const principal = await (evaluationRequestId ? authenticateEvaluation(token) : authenticate(token));
      if (!validIdentity(principal)) problem(401, 'AUTH_REQUIRED', '登录已过期或帐号未授权');
      if (basePath && !url.pathname.startsWith(basePath + '/')) {
        problem(404, 'ROUTE_NOT_FOUND', '找不到请求的接口');
      }
      const result = await route(request, url, url.pathname.slice(basePath.length), principal, {...dependencies, draftAudit, evaluationRequestId});
      return respond(result.body, result.status ?? 200);
    } catch (error) {
      if (error instanceof ApiProblem) {
        return respond({ error: { code: error.code, message: error.message } }, error.status);
      }
      if (!draftAudit && !evaluationRequestId) onError(error);
      return respond({ error: { code: 'SERVICE_ERROR', message: '服务暂不可用，请稍后重试' } }, 500);
    }
  };
}
