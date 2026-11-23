/** Local assignment snapshots and manual exchange; hashes are NOT authentication. */
export const ASSIGNMENT_SCHEMA = 'tcl-r24-excel-assignment/v1';
export const RECEIPT_SCHEMA = 'tcl-r24-assignment-receipt/v1';
export const MANUAL_RECEIPT_WARNING = '手动传递的回执未经服务端身份认证，运营必须人工复核';

const MAX_QUESTIONS = 100;
const MAX_PACKAGE_BYTES = 900_000;
const PLATFORMS = ['京东', '天猫', '抖音'];
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;
const HASH = /^[a-f0-9]{64}$/u;
const QUESTION_KEYS = ['question', '题目', '作业题目', '问题', '弹幕内容', '弹幕', '提问', '用户提问', '顾客提问', '话术问题', '用户问题', '问'];
const ANSWER_KEYS = ['answer', '参考答案', '答案', '回答', '优秀回答', '参考回答', '参考话术', '话术', '主播话术', '标准回答', '标准解答', '解答', '合理回答', '老主播回答', '运营回答', '成熟回答', '答'];
const POINT_KEYS = ['keypoints', '评分点', '知识点', '关键点', '要点', '评分要点'];
const MODEL_KEYS = ['model', 'product_model', 'productModel', '型号', '产品型号', '商品型号'];
const SKU_KEYS = ['sku', 'SKU', '商品SKU', '产品SKU'];
const ASSIGNMENT_KEYS = ['schema', 'id', 'title', 'operatorName', 'boardId', 'platform', 'deadline', 'createdAt', 'assignedTo', 'questions', 'version', 'snapshotSha256'];
const ROW_KEYS = ['id', 'question', 'answer', 'keyPoints', 'pointKeywords', 'model', 'sku', 'category', 'platform', 'source', 'sourceRef', 'sourceLocators', 'kind', 'stage'];
const RECEIPT_KEYS = ['schema', 'assignmentId', 'assignmentVersion', 'snapshotSha256', 'operatorName', 'boardId', 'platform', 'anchorName', 'sessionId', 'submittedAt', 'turns', 'warning'];
const RECEIPT_TURN_KEYS = ['questionId', 'question', 'answer', 'transcript', 'model', 'sku', 'asrStatus'];
const check = (ok, message) => { if (!ok) throw new Error(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const norm = value => value.normalize('NFKC').toLowerCase().replace(/\s+/gu, '').replace(/[?!。]+$/u, '');
const header = value => value.normalize('NFKC').trim().toLowerCase().replace(/[\s\(\)（）、]/gu, '');

function text(value, label, max, { empty = false, numeric = false } = {}) {
  if (empty && (value === null || value === undefined)) return '';
  if (numeric && typeof value === 'number') {
    check(Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)), `${label}数值超出安全范围，请在原表改为文本`);
    value = String(value);
  }
  check(typeof value === 'string', `${label}须为文字`);
  const result = value.trim();
  check((empty || result.length > 0) && result.length <= max, `${label}缺失或超过${max}字`);
  check(!CONTROL.test(result), `${label}包含不可用控制字符`);
  return result;
}

function exactText(value, label, max, options) {
  const result = text(value, label, max, options);
  check(value === result, `${label}格式不规范，请重新导出原作业`);
  return result;
}

function personName(value, label, exact = false) {
  const result = exact ? exactText(value, label, 40) : text(value, label, 40);
  check(!/[\t\r\n]/u.test(result), `${label}不能包含换行或制表符`);
  return result;
}

function identifier(value, label) {
  const result = exactText(value, label, 128);
  check(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(result), `${label}格式无效`);
  return result;
}

function keys(value, allowed, label) {
  check(record(value), `${label}须为对象`);
  check(Object.keys(value).every(key => allowed.includes(key)), `${label}含未支持字段，请重新导出原版本`);
}

function timestamp(value, label, empty = false) {
  const result = exactText(value, label, 40, { empty });
  if (empty && result === '') return result;
  check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(result) && Number.isFinite(Date.parse(result)), `${label}须为有效UTC时间`);
  const expected = new Date(result).toISOString();
  check(expected.slice(0, 19) === result.slice(0, 19), `${label}日期无效`);
  return result;
}

function canonicalJSON(value, depth = 0) {
  check(depth <= 10, '作业数据嵌套过深');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { check(Number.isFinite(value), '作业含无效数值'); return JSON.stringify(value); }
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) { check(Object.hasOwn(value, i), '作业数组不完整'); parts.push(canonicalJSON(value[i], depth + 1)); }
    return '[' + parts.join(',') + ']';
  }
  check(record(value), '作业含不可交换的数据类型');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJSON(value[key], depth + 1)).join(',') + '}';
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function sizeBound(value, label) {
  check(new TextEncoder().encode(canonicalJSON(value)).byteLength <= MAX_PACKAGE_BYTES, `${label}内容超过交换大小上限，请拆分为多个作业`);
}

function validNames(names, { dedupe = false } = {}) {
  check(Array.isArray(names) && names.length >= 1 && names.length <= 100, '必须指定至少一名主播，最多100名');
  const result = names.map(value => personName(value, '主播姓名'));
  const seen = new Set();
  const unique = [];
  for (const value of result) {
    const key = value.normalize('NFKC');
    if (seen.has(key)) { check(dedupe && unique.includes(value), '接收主播姓名重复或存在全半角歧义'); continue; }
    seen.add(key); unique.push(value);
  }
  return unique;
}

export function parseRecipients(value) {
  const source = text(value ?? '', '接收主播名单', 4200, { empty: true });
  if (!source) return [];
  return validNames(source.split(/[\n,，;；、]+/u).map(x => x.trim()).filter(Boolean), { dedupe: true });
}

const platformFits = (source, dest) => !source || source === dest || source === '全部平台'
  || ['京东/天猫', '天猫/京东'].includes(source) && ['京东', '天猫'].includes(dest);

function findColumn(headers, aliases, excluded = []) {
  const names = aliases.map(header);
  let result = headers.findIndex((value, i) => !excluded.includes(i) && names.includes(value));
  if (result >= 0) return result;
  result = headers.findIndex((value, i) => !excluded.includes(i) && value.length > 0 && value.length <= 16
    && !/[?？。！!；;]/u.test(value) && names.some(name => name.length >= 2 && (value.includes(name) || name.includes(value))));
  return result;
}

/** Validate raw rows before extractQA can skip or combine them. Returns expected row count. */
export function assertExcelOneRowPerQuestion(parsed, { max = MAX_QUESTIONS } = {}) {
  check(record(parsed) && Array.isArray(parsed.blocks), '未读取到Excel表格');
  check(Number.isInteger(max) && max >= 1 && max <= MAX_QUESTIONS, '作业题目上限无效');
  const seen = new Set();
  let count = 0;
  for (const block of parsed.blocks) {
    if (block?.kind !== 'table') continue;
    check(Array.isArray(block.rows), 'Excel工作表行格式无效');
    if (!block.rows.length) continue;
    const cellText = (value, label) => text(value, label, 10000, { empty: true, numeric: true });
    const rows = block.rows;
    check(Array.isArray(rows[0]?.cells), 'Excel表头格式无效');
    if (!rows.some(row => Array.isArray(row?.cells) && row.cells.some(value => cellText(value, 'Excel单元格')))) continue;
    const headers = rows[0].cells.map(value => header(cellText(value, 'Excel表头')));
    const qi = findColumn(headers, QUESTION_KEYS);
    check(qi >= 0, `${rows[0].locator || 'Excel'}：未找到题目列，请保留题目/问题等表头`);
    const pi = findColumn(headers, POINT_KEYS, [qi]);
    const ai = findColumn(headers, ANSWER_KEYS, [qi, pi]);
    const special = headers[qi] === '弹幕内容';
    const answerColumns = special ? headers.map((value, index) => index !== qi
      && /^(案例话术|参考话术|话术|优秀回答|参考回答|回答|答案)\d*$/u.test(value) ? index : -1).filter(i => i >= 0) : [ai].filter(i => i >= 0);
    check(answerColumns.length > 0, `${rows[0].locator || 'Excel'}：未找到可读取的参考答案列`);
    const mi = headers.findIndex(value => MODEL_KEYS.map(header).includes(value));
    const si = headers.findIndex(value => SKU_KEYS.map(header).includes(value));
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i], location = row?.locator || `Excel第${i + 1}行`;
      check(Array.isArray(row?.cells), `${location}：行格式无效`);
      const cells = row.cells.map(value => cellText(value, `${location}单元格`));
      if (!cells.some(Boolean)) continue;
      const question = cells[qi] || '';
      check(question.length >= (special ? 2 : 3) && question.length <= 500, `${location}：题目缺失、过短或超过500字，不能静默略过此行`);
      check(answerColumns.some(index => (cells[index] || '').length >= 2), `${location}：参考答案缺失或过短`);
      const key = JSON.stringify([norm(question), norm(mi >= 0 ? cells[mi] || '' : ''), si >= 0 ? (cells[si] || '').normalize('NFKC').trim() : '']);
      check(!seen.has(key), `${location}：同一问题/型号/SKU出现多行。请合并到一行后再上传作业`);
      seen.add(key); count++;
      check(count <= max, `本次作业最多${max}题，不能截断Excel后发布`);
    }
  }
  check(count > 0, 'Excel中没有完整题目');
  return count;
}

export function assertExcelExtractionComplete(expectedCount, rows) {
  check(Number.isInteger(expectedCount) && expectedCount > 0 && expectedCount <= MAX_QUESTIONS
    && Array.isArray(rows) && rows.length === expectedCount, 'Excel原始行数与解析题数不一致，请检查空题、合并行或表头；未发布任何作业');
  return rows;
}

/** Raw extractQA results become a private, canonical assignment pool, never public items. */
export function validateExcelQuestions(rows, { category, platform, max = MAX_QUESTIONS } = {}) {
  const targetCategory = text(category, '作业品类', 100);
  check(PLATFORMS.includes(platform), '作业平台无效');
  check(Number.isInteger(max) && max >= 1 && max <= MAX_QUESTIONS, '作业题目上限无效');
  check(Array.isArray(rows) && rows.length >= 1 && rows.length <= max, `本次作业须有1–${max}道完整题目，超出时请拆分Excel`);
  const seen = new Set();
  return rows.map((row, i) => {
    check(record(row), `第${i + 1}题格式无效`);
    const location = text(row.locator ?? row.sourceLocators?.[0] ?? `第${i + 2}行`, '来源位置', 1000);
    const question = text(row.question, `${location}题目`, 500);
    const answer = text(row.answer, `${location}参考答案`, 3000);
    check(question.length >= 2 && answer.length >= 2, `${location}：题目或参考答案过短`);
    const model = text(row.model, `${location}型号`, 200, { empty: true, numeric: true });
    const sku = text(row.sku, `${location}SKU`, 200, { empty: true, numeric: true });
    const sourceCategory = text(row.category, `${location}品类`, 100, { empty: true });
    const sourcePlatform = text(row.platform, `${location}平台`, 50, { empty: true });
    check(!sourceCategory || norm(sourceCategory).replace(/^tcl/u, '') === norm(targetCategory).replace(/^tcl/u, ''), `${location}：品类与这份作业不一致`);
    check(platformFits(sourcePlatform, platform), `${location}：平台与这份作业不一致`);
    const key = JSON.stringify([norm(question), norm(model), sku.normalize('NFKC')]);
    check(!seen.has(key), `${location}：发现重复题目、型号和SKU，请在源Excel中核对`); seen.add(key);
    let points = row.keyPoints ?? [];
    if (typeof points === 'string') points = points.split(/[;,，、；\n]+/u).map(value => value.trim()).filter(Boolean);
    check(Array.isArray(points) && points.length <= 12, `${location}：评分要点格式无效或超过12条`);
    points = points.map(value => text(value, `${location}评分要点`, 200));
    const locators = row.sourceLocators ?? (row.locator ? [row.locator] : []);
    check(Array.isArray(locators) && locators.length <= 20, `${location}：来源位置格式无效或超过20项`);
    const sourceLocators = locators.map(value => text(value, `${location}来源位置`, 1000));
    return { id: `excel-${i + 1}`, question, answer, keyPoints: points, pointKeywords: [], model, sku,
      category: targetCategory, platform, source: text(row.source ?? '运营Excel作业', `${location}来源`, 200),
      sourceRef: text(row.sourceRef, `${location}来源链接`, 2000, { empty: true }), sourceLocators,
      kind: 'assignment-excel', stage: '运营作业' };
  });
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(typeof value === 'string' ? value : canonicalJSON(value));
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function assignmentContent(a) {
  return { schema: a.schema, id: a.id, title: a.title, operatorName: a.operatorName, boardId: a.boardId,
    platform: a.platform, deadline: a.deadline, createdAt: a.createdAt, assignedTo: a.assignedTo,
    questions: a.questions, version: a.version };
}

function assignmentStructure(a, { hashRequired = true, board } = {}) {
  keys(a, ASSIGNMENT_KEYS, '作业');
  check(a.schema === ASSIGNMENT_SCHEMA && a.version === 1, '不是当前版本的R24 Excel作业包');
  identifier(a.id, '作业ID'); exactText(a.title, '作业名称', 120); personName(a.operatorName, '发布运营姓名', true);
  check(typeof a.boardId === 'string' && /^(0[1-9]|1[0-6])$/u.test(a.boardId), '作业板块无效');
  check(PLATFORMS.includes(a.platform), '作业平台无效');
  timestamp(a.createdAt, '发布时间'); timestamp(a.deadline, '截止时间', true);
  const recipients = validNames(a.assignedTo);
  check(recipients.every((name, i) => name === a.assignedTo[i]), '接收主播姓名格式不规范');
  check(Array.isArray(a.questions) && a.questions.length >= 1 && a.questions.length <= MAX_QUESTIONS, '作业题目数量无效');
  for (const row of a.questions) keys(row, ROW_KEYS, '作业题目');
  const canonicalRows = validateExcelQuestions(a.questions, { category: a.questions[0]?.category, platform: a.platform });
  check(canonicalJSON(canonicalRows) === canonicalJSON(a.questions), '作业题目ID、元数据或顺序格式无效，请重新导出原版本');
  if (board !== undefined) {
    check(record(board) && board.id === a.boardId && Array.isArray(board.platforms)
      && board.platforms.includes(a.platform) && board.category === a.questions[0].category, '作业与本站训练板块、品类或平台不匹配');
  }
  if (hashRequired) check(typeof a.snapshotSha256 === 'string' && HASH.test(a.snapshotSha256), '作业版本哈希无效');
  sizeBound(assignmentContent(a), '作业包');
  return a;
}

export async function makeAssignment({ id, title, operatorName, boardId, platform, deadline = '', assignedTo, questions, createdAt }) {
  const names = Array.isArray(assignedTo) ? validNames(assignedTo, { dedupe: true }) : validNames(parseRecipients(assignedTo));
  check(Array.isArray(questions) && questions.length > 0, '必须先预览Excel题目');
  const a = { schema: ASSIGNMENT_SCHEMA, id: text(id, '作业ID', 128), title: text(title, '作业名称', 120),
    operatorName: personName(operatorName, '发布运营姓名'), boardId: text(boardId, '作业板块', 2), platform,
    deadline: text(deadline, '截止时间', 40, { empty: true }), createdAt: createdAt ?? new Date().toISOString(),
    assignedTo: names, questions: validateExcelQuestions(questions, { category: questions[0]?.category, platform }), version: 1 };
  assignmentStructure(a, { hashRequired: false });
  a.snapshotSha256 = await sha256Hex(assignmentContent(a));
  return deepFreeze(a);
}

export function isAssigned(a, anchorName) {
  if (typeof anchorName !== 'string' || !anchorName.trim()) return false;
  if (a?.schema) return a.schema === ASSIGNMENT_SCHEMA && a.version === 1
    && Array.isArray(a.assignedTo) && a.assignedTo.includes(anchorName.trim());
  // Existing non-Excel assignments retain their historical visibility rules.
  return !!a && (!Array.isArray(a.assignedTo) || a.assignedTo.includes(anchorName.trim()));
}

export function questionsForAssignment(a) {
  assignmentStructure(a);
  return structuredClone(a.questions);
}

export async function verifyAssignment(a, options = {}) {
  const candidate = structuredClone(a);
  assignmentStructure(candidate, options);
  check(await sha256Hex(assignmentContent(candidate)) === candidate.snapshotSha256, '作业包校验失败，内容已改变');
  return deepFreeze(candidate);
}

export function toExchangePackage(a) {
  assignmentStructure(a);
  return { schema: ASSIGNMENT_SCHEMA, notice: '仅供手动传递的本机练播作业；姓名不是身份认证。私有Excel只在本机读取，不应提交到公开仓库。', assignment: structuredClone(a) };
}

function completeTurns(turns, assignment) {
  check(Array.isArray(turns) && turns.length === assignment.questions.length, '必须完成原作业的全部题目后再提交，不能缺题或重复答题');
  const seen = new Set();
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i], expected = assignment.questions[i];
    check(record(turn), `第${i + 1}题回答格式无效`);
    check(typeof turn.questionId === 'string' && !seen.has(turn.questionId) && turn.questionId === expected.id,
      `第${i + 1}题ID、顺序不匹配或重复，不能提交为已完成`);
    seen.add(turn.questionId);
    check(turn.question === expected.question && (turn.model ?? '') === expected.model && (turn.sku ?? '') === expected.sku,
      `第${i + 1}题与原作业的题目、型号或SKU不一致`);
    check(turn.manualCleared !== true && typeof turn.answer === 'string' && turn.answer.trim().length > 0,
      `第${i + 1}题尚未完成回答，旧转写不能替代已清空的答案`);
    text(turn.answer, `第${i + 1}题回答`, 10000);
    text(turn.transcript, `第${i + 1}题转写`, 20000, { empty: true });
    text(turn.asrStatus, `第${i + 1}题识别状态`, 300, { empty: true });
  }
  return turns;
}

function snapshotStructure(assignment, snapshot) {
  check(record(snapshot), '本场练播记录无效');
  check(snapshot.assignmentId === assignment.id, '提交记录不属于这份作业');
  check(snapshot.assignmentVersion === assignment.version && snapshot.assignmentSnapshotSha256 === assignment.snapshotSha256,
    '作业版本与本场冻结版本不一致，请使用原作业重新练习');
  check(snapshot.operatorName === assignment.operatorName && snapshot.boardId === assignment.boardId && snapshot.platform === assignment.platform,
    '本场作业发布人、板块或平台不匹配');
  personName(snapshot.anchorName, '提交主播姓名', true);
  check(isAssigned(assignment, snapshot.anchorName), '提交的主播不在这份作业的分配名单');
  identifier(snapshot.id, '练播场次ID');
  completeTurns(snapshot.turns, assignment);
  return true;
}

/** Call before persisting a submission. The session must retain its start-time version. */
export async function verifyAssignmentSnapshot(assignment, snapshot, options = {}) {
  const frozen = await verifyAssignment(assignment, options);
  return snapshotStructure(frozen, snapshot);
}

export function toReceipt(assignment, snapshot) {
  assignmentStructure(assignment);
  snapshotStructure(assignment, snapshot);
  const receipt = { schema: RECEIPT_SCHEMA, assignmentId: assignment.id, assignmentVersion: assignment.version,
    snapshotSha256: assignment.snapshotSha256, operatorName: assignment.operatorName,
    boardId: assignment.boardId, platform: assignment.platform, anchorName: snapshot.anchorName,
    sessionId: snapshot.id, submittedAt: new Date().toISOString(),
    turns: snapshot.turns.map(turn => ({ questionId: turn.questionId, question: turn.question, answer: turn.answer,
      transcript: turn.transcript ?? '', model: turn.model ?? '', sku: turn.sku ?? '', asrStatus: turn.asrStatus ?? '' })),
    warning: MANUAL_RECEIPT_WARNING };
  sizeBound(receipt, '提交回执');
  return receipt;
}

/** Validate manual receipt structure; await verifyAssignment(assignment) before importing. */
export function verifyReceipt(receipt, assignment) {
  assignmentStructure(assignment);
  keys(receipt, RECEIPT_KEYS, '提交回执');
  check(receipt.schema === RECEIPT_SCHEMA && receipt.assignmentVersion === 1, '回执文件版本不支持');
  check(receipt.assignmentId === assignment.id && receipt.snapshotSha256 === assignment.snapshotSha256, '回执对应的作业版本不一致');
  check(receipt.operatorName === assignment.operatorName && receipt.boardId === assignment.boardId
    && receipt.platform === assignment.platform && isAssigned(assignment, receipt.anchorName), '回执接收人、主播、板块或平台不匹配');
  personName(receipt.anchorName, '回执主播姓名', true); identifier(receipt.sessionId, '回执场次ID'); timestamp(receipt.submittedAt, '回执提交时间');
  check(receipt.warning === MANUAL_RECEIPT_WARNING, '回执须保留待人工核实说明');
  check(Array.isArray(receipt.turns), '回执题目格式无效');
  for (const turn of receipt.turns) keys(turn, RECEIPT_TURN_KEYS, '回执题目');
  completeTurns(receipt.turns, assignment);
  sizeBound(receipt, '提交回执');
  return true;
}
