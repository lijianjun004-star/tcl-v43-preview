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
    && identity.displayName.length > 0 && identity.displayName.length <= 40
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

async function readJson(request) {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') problem(415, 'JSON_REQUIRED', '请求须使用 application/json');
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
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
      if (bytes > MAX_BODY_BYTES) {
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

function cleanSubmission(record) {
  const { id, assignmentId, assignmentVersion, snapshotSha256, anchorId, anchorName,
    sessionId, submittedAt, late, turns } = record;
  return { id, assignmentId, assignmentVersion, snapshotSha256, anchorId, anchorName,
    sessionId, submittedAt, late, turns };
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

function submissionResponse(record, payloadHash, replayed) {
  if (!record) problem(503, 'WRITE_PENDING', '暂未读到提交写入结果，请用同一场次重试');
  if (record.payloadHash !== payloadHash) {
    problem(409, 'SUBMISSION_CONFLICT', '本场练播已提交，不能替换已保存的回答');
  }
  return { status: replayed ? 200 : 201, body: { submission: cleanSubmission(record), replayed } };
}

async function submit(request, assignmentId, principal, { store, now }) {
  anchorOnly(principal);
  const assignmentRecord = await store.getAssignment(assignmentId);
  assertVisible(assignmentRecord, principal);
  const { snapshot } = await readJson(request);
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
  if (current) return submissionResponse(current, payloadHash, true);

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
  };
  if (await store.createSubmission(submission)) return submissionResponse(submission, payloadHash, false);
  return submissionResponse(await store.getSubmission(id), payloadHash, true);
}

async function assignmentPage(store, principal, url) {
  const records = (await store.listAssignments(principal.teamId)).filter(record => canAccess(record, principal));
  if (principal.role === 'operator') return page(records, cleanAssignment, 'publishedAt', url, 'assignments');

  const latest = new Map();
  const statuses = await store.listAnchorSubmissionStatuses(principal.teamId, principal.id);
  for (const { assignmentId, submittedAt } of statuses) {
    const old = latest.get(assignmentId);
    if (!old || submittedAt > old) latest.set(assignmentId, submittedAt);
  }
  const view = record => ({
    ...cleanAssignment(record),
    submitted: latest.has(record.id),
    lastSubmittedAt: latest.get(record.id) ?? null,
  });
  return page(records, view, 'publishedAt', url, 'assignments');
}

async function route(request, url, path, principal, dependencies) {
  const { store, directory } = dependencies;
  if (request.method === 'GET' && path === '/me') {
    const { id, role, displayName } = principal;
    return { body: { principal: { id, role, displayName } } };
  }
  if (request.method === 'GET' && path === '/recipients') {
    operatorOnly(principal);
    const recipients = (await directory.listAnchors(principal.teamId))
      .filter(anchor => assignableAnchor(anchor, principal.teamId))
      .map(({ id, displayName }) => ({ id, displayName }));
    return { body: { recipients } };
  }
  if (path === '/assignments') {
    if (request.method === 'POST') return publish(request, principal, dependencies);
    if (request.method === 'GET') {
      return { body: await assignmentPage(store, principal, url) };
    }
  }
  const match = /^\/assignments\/([^/]+)\/submissions$/u.exec(path);
  if (match) {
    let assignmentId;
    try {
      assignmentId = decodeURIComponent(match[1]);
    } catch {
      problem(400, 'ASSIGNMENT_ID_INVALID', '作业 ID 格式无效');
    }
    if (!ASSIGNMENT_ID.test(assignmentId)) problem(400, 'ASSIGNMENT_ID_INVALID', '作业 ID 格式无效');
    if (request.method === 'POST') return submit(request, assignmentId, principal, dependencies);
    if (request.method === 'GET') {
      operatorOnly(principal);
      const assignment = await store.getAssignment(assignmentId);
      assertVisible(assignment, principal);
      const submissions = (await store.listSubmissions(assignmentId, principal.teamId))
        .filter(s => s.assignmentId === assignmentId && s.teamId === principal.teamId);
      return { body: page(submissions, cleanSubmission, 'submittedAt', url, 'submissions') };
    }
  }
  return problem(404, 'ROUTE_NOT_FOUND', '找不到请求的接口');
}

export function createApi({
  authenticate,
  directory,
  store,
  now = () => new Date(),
  boards = boardDefinitions,
  allowedOrigins = [],
  basePath = '',
  onError = () => {},
}) {
  const dependencies = {
    directory, store, now,
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
    try {
      const token = /^Bearer ([^\s,]{1,8192})$/iu.exec(request.headers.get('authorization') ?? '')?.[1];
      if (!token) problem(401, 'AUTH_REQUIRED', '请先登录');
      const principal = await authenticate(token);
      if (!validIdentity(principal)) problem(401, 'AUTH_REQUIRED', '登录已过期或帐号未授权');
      const url = new URL(request.url);
      if (basePath && !url.pathname.startsWith(basePath + '/')) {
        problem(404, 'ROUTE_NOT_FOUND', '找不到请求的接口');
      }
      const result = await route(request, url, url.pathname.slice(basePath.length), principal, dependencies);
      return jsonResponse(result.body, result.status ?? 200, cors);
    } catch (error) {
      if (error instanceof ApiProblem) {
        return jsonResponse({ error: { code: error.code, message: error.message } }, error.status, cors);
      }
      onError(error);
      return jsonResponse({ error: { code: 'SERVICE_ERROR', message: '服务暂不可用，请稍后重试' } }, 500, cors);
    }
  };
}
