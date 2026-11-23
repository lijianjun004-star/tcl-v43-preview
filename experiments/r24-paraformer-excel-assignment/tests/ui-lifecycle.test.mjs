/** Controlled async-boundary tests of the generated UI functions.
 * These VM fixtures do not replace the real Chromium/XLSX end-to-end checks.
 * Run with R24_EXCEL_APP=/absolute/generated/app.js node --test this-file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as rules from '../assignment-excel.mjs';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!process.env.R24_EXCEL_APP) throw new Error('R24_EXCEL_APP must point to the generated official-pages3 candidate app.js');
const source = readFileSync(process.env.R24_EXCEL_APP, 'utf8');
function section(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `${start}: generated function boundaries`);
  return source.slice(first, last);
}
const previewSource = section('let assignmentExcelParsing=0;', '\nasync function importAssignmentPackage');
const publishSource = section('async function publishAssignment(){', '\nasync function joinAssignment');
const exchangeSource = section('async function importAssignmentPackage(ev){', '\nlet assignmentPublishPending');
const nextSource = section('function nextQuestion(){', '\nfunction showReference');
const answerAudioCleanupSource = source.includes('function clearAnswerAudio(){')
  ? section('function clearAnswerAudio(){', '\nfunction nextQuestion(){') : '';
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const rows = [{ question: '人工样例问题一', answer: '人工样例答案一', model: 'DEMO-A', sku: '001', keyPoints: ['人工要点'], category: 'TCL 电视', platform: '京东' }];
function fixture() {
  const file = { name: 'synthetic.xlsx', size: 300 }, view = {};
  const nodes = {
    view: { firstElementChild: view }, assignmentExcelFile: { files: [file], isConnected: true },
    assignmentExcelPreview: { textContent: '', innerHTML: '' }, assignmentExcelPreviewBtn: { disabled: false },
    assignmentTitle: { value: '人工合成作业' }, assignmentBoard: { value: '01' }, assignmentPlatform: { value: '京东' },
    assignmentDeadline: { value: '' }, publishAssignment: { disabled: false, isConnected: true }
  };
  const writes = [], messages = [], saved = { assignments: [], submissions: [] };
  const ctx = vm.createContext({ ...rules, structuredClone, JSON, Map, Set, Date, encodeURIComponent,
    userRole: 'operator', userName: '运营甲', page: 'home', assignmentExcelEpoch: 0, assignmentExcelPreview: null,
    assignmentPublishPending: false, localAssignments: [], localSubmissions: [], operatorActiveTab: 'publish',
    memoryFallback: false, localDB: {},
    ELEM: id => nodes[id], ESC: value => String(value), toast: message => messages.push(message),
    boardById: () => ({ id: '01', category: 'TCL 电视', platforms: ['京东', '天猫'] }),
    BOARDS: [{ id: '01', category: 'TCL 电视', platforms: ['京东', '天猫'] }],
    parseDocumentFile: async () => ({ fixture: true }), assertExcelOneRowPerQuestion: () => 1,
    extractQA: () => structuredClone(rows), uid: () => 'fixture-assignment', nowIso: () => new Date().toISOString(),
    updatePrefList: async (name, mutate) => { saved[name] = mutate(saved[name]); writes.push(name); return saved[name]; },
    operatorHome: () => {}, anchorHome: () => {}, assignmentById: id => saved.assignments.find(a => a.id === id)
  });
  vm.runInContext(previewSource + '\n' + publishSource + '\n' + exchangeSource, ctx);
  return { ctx, nodes, file, writes, messages, saved };
}

test('delayed Excel parsing cannot install a preview into a replaced operator view', async () => {
  const f = fixture(), pending = deferred(); f.ctx.parseDocumentFile = () => pending.promise;
  const work = f.ctx.previewAssignmentExcel();
  f.nodes.view.firstElementChild = {}; f.nodes.assignmentExcelFile.isConnected = false;
  pending.resolve({ fixture: true }); await work;
  assert.equal(f.ctx.assignmentExcelPreview, null); assert.equal(f.nodes.assignmentExcelPreview.innerHTML, '');
});

test('delayed parsing cannot overwrite a newer preview after file replacement', async () => {
  const f = fixture(), old = deferred(); let calls = 0;
  f.ctx.parseDocumentFile = () => ++calls === 1 ? old.promise : Promise.resolve({ fixture: true });
  const oldWork = f.ctx.previewAssignmentExcel();
  const next = { name: 'replacement.xlsx', size: 400 }; f.nodes.assignmentExcelFile.files = [next];
  f.ctx.invalidateAssignmentExcel('file changed'); await f.ctx.previewAssignmentExcel();
  const newest = f.ctx.assignmentExcelPreview; assert.equal(newest.file, next);
  old.resolve({ fixture: true }); await oldWork;
  assert.equal(f.ctx.assignmentExcelPreview, newest);
});

test('Excel row extraction loss prevents publication', async () => {
  const f = fixture(); f.ctx.assertExcelOneRowPerQuestion = () => 2;
  await f.ctx.previewAssignmentExcel(); await f.ctx.publishAssignment();
  assert.equal(f.ctx.assignmentExcelPreview, null); assert.equal(f.writes.length, 0);
  assert.match(f.nodes.assignmentExcelPreview.textContent, /原始行数与解析题数不一致/);
});

test('identity change while publication digest is pending prevents database write', async () => {
  const f = fixture(); await f.ctx.previewAssignmentExcel();
  const pending = deferred(); f.ctx.makeAssignment = () => pending.promise;
  const work = f.ctx.publishAssignment(); f.ctx.userName = '运营乙';
  pending.resolve({ id: 'fixture-assignment' }); await work;
  assert.equal(f.writes.length, 0); assert.equal(f.saved.assignments.length, 0);
});

test('form mutation without an event while digest is pending is still rejected', async () => {
  const f = fixture(); await f.ctx.previewAssignmentExcel();
  const pending = deferred(); f.ctx.makeAssignment = () => pending.promise;
  const work = f.ctx.publishAssignment(); f.nodes.assignmentDeadline.value = '2026-12-31T23:00';
  pending.resolve({ id: 'fixture-assignment' }); await work;
  assert.equal(f.writes.length, 0); assert.match(f.messages.at(-1), /已变化/);
});

test('publication rechecks identity inside the queued storage mutation', async () => {
  const f = fixture(); await f.ctx.previewAssignmentExcel();
  let stored = false;
  f.ctx.updatePrefList = async (_name, mutate) => { f.ctx.userName = '运营乙'; mutate([]); stored = true; };
  await f.ctx.publishAssignment(); assert.equal(stored, false);
});

test('the final next-question action saves the typed final answer without creating a repeated question', () => {
  let saves = 0; const messages = [];
  const ctx = vm.createContext({ recorderPending: false, liveStarted: true, currentRecorder: null, recorderFinalizing: false,
    selectedBoard: '01', boardById: () => ({}), questions: [{ id: 'a' }, { id: 'b' }], sessionTurns: [{}, {}],
    currentAssignment: () => ({ schema: 'assignment' }), saveCurrentTypedAnswer: () => { saves++; }, toast: x => messages.push(x) });
  vm.runInContext(nextSource, ctx); ctx.nextQuestion();
  assert.equal(saves, 1); assert.equal(ctx.sessionTurns.length, 2); assert.match(messages[0], /全部展示/);
});

test('switching questions cancels the preview media load before revoking its blob URL', () => {
  const events = [], revocations = [], nodes = new Map();
  let pendingLoad = true, attached = true, mediaSrc = 'blob:recorded-question';
  const player = {
    pause: () => events.push('pause'),
    removeAttribute: name => { assert.equal(name, 'src'); mediaSrc = ''; events.push('remove-src'); },
    load: () => { assert.equal(mediaSrc, ''); pendingLoad = false; events.push('cancel-load'); }
  };
  const holder = {
    querySelectorAll: selector => { assert.equal(selector, 'audio'); return attached ? [player] : []; },
    replaceChildren: () => { attached = false; events.push('detach'); }
  };
  const node = id => {
    if (id === 'audioHolder') return holder;
    if (!nodes.has(id)) nodes.set(id, { classList: { add() {} }, replaceChildren() {}, value: '' });
    return nodes.get(id);
  };
  const original = new Blob(['original recorded bytes']), audio = new Map([['question-one', original]]);
  const ctx = vm.createContext({
    recorderPending: false, liveStarted: true, currentRecorder: null, recorderFinalizing: false,
    selectedBoard: '01', boardById: () => ({}), questions: [{ question: '下一道原始作业题', kind: 'assignment-excel' }],
    sessionTurns: [], currentAssignment: () => ({ schema: 'assignment' }), nextQuestionIndex: () => 0,
    activeQuestionIndex: -1, answerAudioURL: 'blob:recorded-question', perQuestionAudio: audio,
    ELEM: node, saveCurrentTypedAnswer() {}, cancelSpeech() {}, cancelTTS() {}, cancelTranscript() {},
    updateLiveQuestionCard() {}, recordUI() {}, addChat() {}, viewerNick: () => '合成观众', scheduleChatQuestion() {},
    Math: { random: () => .5 },
    URL: { revokeObjectURL: url => { revocations.push({ url, pendingLoad, attached }); events.push('revoke'); } }
  });
  vm.runInContext(answerAudioCleanupSource + '\n' + nextSource, ctx);
  ctx.nextQuestion();
  assert.deepEqual(revocations, [{ url: 'blob:recorded-question', pendingLoad: false, attached: false }]);
  assert.ok(events.indexOf('cancel-load') < events.indexOf('revoke'));
  assert.equal(ctx.answerAudioURL, '');
  assert.equal(audio.get('question-one'), original, 'the saved original recording must remain available for review');
  assert.equal(node('currentQuestion').textContent, '下一道原始作业题');
  ctx.clearAnswerAudio();
  assert.equal(revocations.length, 1, 'repeated cleanup does not revoke another recording');
});

test('manual receipt deduplication keeps different assignments even with the same session ID', async () => {
  const f = fixture();
  const questions = rules.validateExcelQuestions(rows, { category: 'TCL 电视', platform: '京东' });
  async function make(id) { return rules.makeAssignment({ id, title: '人工合成作业', operatorName: '运营甲', boardId: '01', platform: '京东', assignedTo: ['主播甲'], questions }); }
  const first = await make('assignment-one'), second = await make('assignment-two'); f.saved.assignments = [first, second];
  const receipt = a => rules.toReceipt(a, { id: 'same-session', assignmentId: a.id, assignmentVersion: a.version,
    assignmentSnapshotSha256: a.snapshotSha256, operatorName: a.operatorName, boardId: a.boardId, platform: a.platform,
    anchorName: '主播甲', turns: a.questions.map(q => ({ questionId: q.id, question: q.question, model: q.model, sku: q.sku, answer: '主播人工回答', transcript: '', asrStatus: '手动填写' })) });
  const one = receipt(first), two = receipt(second);
  async function ingest(r) { const file = { size: 1000, text: async () => JSON.stringify(r) }, input = { files: [file], isConnected: true };
    f.nodes.assignmentReceiptImport = input; await f.ctx.importAssignmentReceipt({ currentTarget: input }); }
  await ingest(one); await ingest(two); await ingest(one);
  assert.equal(f.saved.submissions.length, 2, f.messages.join('\n'));
  await ingest({ ...one, turns: one.turns.map(t => ({ ...t, answer: '不同回答' })) });
  assert.equal(f.saved.submissions.length, 2); assert.match(f.messages.at(-1), /回执内容冲突/);
});
