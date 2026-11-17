// R2.5 routing: real app.js function bodies in a Node VM; engines, Vosk loader and storage are mocked. No speech.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = process.env.R25_DIR || path.resolve(__dirname, '../tcl-v352-asr-r25-qa');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const s = app.indexOf('const r6WhisperValid='), e = app.indexOf('globalThis.r6WhisperSubmit=r6WhisperSubmit;');
assert.ok(s > 0 && e > s && app.slice(s, e).includes('function r25RouteAsr('), 'R2.5 block not found');
const block = app.slice(s, e);
const tick = () => new Promise(r => setImmediate(r));
function make({ pref, voskReady = false, whisper }) {
  const c = vm.createContext({ setTimeout, clearTimeout, console, Float32Array, queueMicrotask });
  vm.runInContext(`
  let runId='run',selectedBoard='b',activePlatform='p',activeTurn=null,lastSessionSnapshot=null,page='training',userRole='anchor',userName='x';
  let oneShotAsrJob=null,audioDecodeJob=null,asrInferJob=null,transcriptBusy=false,r6WhisperRunning=false,voskLoadJob=null,r6WhisperCancelSeq=0;
  let voskModel=${voskReady ? '{}' : 'null'},voskUi={state:'idle'};
  const calls={preload:[],enqueue:[],whisper:0};
  const window={},sessionTurns=[],perQuestionAudio=new Map(),questionAsrQueue=[],r6WhisperQueue=[];
  const toast=()=>{},ELEM=()=>null,isRunPage=()=>true,r6WhisperPageAlive=()=>true,renderTurnStatus=()=>{},renderQuestionSummary=()=>{},drainQuestionAsrQueue=()=>{},saveTurn=async()=>true;
  const normalizeWhisperChinese=t=>t,normalizeInterfaceDecimals=t=>({text:t,changes:0}),normalizeSpokenNumbers=t=>({text:t,changes:0}),assessAsrText=t=>({text:t,warnings:[]}),complianceHints=()=>[],fuzzyPoint=()=>false;
  const readR23ModelPreference=()=>${JSON.stringify(pref)};
  const preloadVoskModel=async(o)=>{calls.preload.push(o);};
  const enqueueQuestionAsr=id=>{calls.enqueue.push(id);};
  const r6WhisperEngine=async()=>{calls.whisper++;${whisper === 'fail' ? "throw new Error('下载/初始化 Whisper 模型超时（45秒）');" : whisper === 'audiofail' ? "if(calls.whisper===1)throw new Error('invalid or overlong audio');return {text:'第二题文字'};" : "return {text:'这款电视画质很好'};"}};
  r6WhisperEngine.isResourceBusy=()=>false;
  function add(id){const t={id,runId,boardId:'b',platform:'p',answer:'',transcript:'',keyPoints:[]};sessionTurns.push(t);perQuestionAudio.set(id,{size:1000});return t;}
  ` + block, c);
  return src => vm.runInContext(src, c);
}
(async () => {
  let n = 0;
  { const run = make({ pref: 'vosk', voskReady: true }); run("r25RouteAsr(add('q1'),perQuestionAudio.get('q1'))"); await tick();
    assert.equal(run('JSON.stringify(calls.enqueue)'), JSON.stringify(['q1'])); assert.equal(run('calls.whisper'), 0); n++; }
  { const run = make({ pref: 'vosk', voskReady: false }); run("r25RouteAsr(add('q1'),perQuestionAudio.get('q1'))"); await tick();
    assert.equal(run('calls.whisper'), 0); assert.equal(run('calls.preload.length'), 1); assert.equal(run('calls.preload[0].silent'), true);
    assert.match(run('sessionTurns[0].asrStatus'), /正在准备本机中文识别模型/); n++; }
  { const run = make({ pref: 'vosk', voskReady: false }); run("voskUi.state='loading'"); run("r25RouteAsr(add('q1'),perQuestionAudio.get('q1'))"); await tick();
    assert.equal(run('calls.preload.length'), 0, 'no second download while one is running'); n++; }
  { const run = make({ pref: 'base', whisper: 'ok' }); run("r25RouteAsr(add('q1'),perQuestionAudio.get('q1'))"); for (let i = 0; i < 6; i++) await tick();
    assert.equal(run('calls.whisper'), 1); assert.equal(run('sessionTurns[0].answer'), '这款电视画质很好'); assert.equal(run('calls.preload.length'), 0); n++; }
  { const run = make({ pref: 'base', whisper: 'fail', voskReady: false }); run("r25RouteAsr(add('q1'),perQuestionAudio.get('q1'))"); for (let i = 0; i < 6; i++) await tick();
    assert.equal(run('calls.whisper'), 1); assert.equal(run('calls.preload.length'), 1, 'Whisper failure must start the Vosk download');
    assert.match(run('sessionTurns[0].asrStatus'), /已自动改用本机中文识别/);
    run("r25RouteAsr(add('q2'),perQuestionAudio.get('q2'))"); await tick();
    assert.equal(run('calls.whisper'), 1, 'after a failure later questions skip Whisper'); n++; }
  { const run = make({ pref: 'base', whisper: 'fail', voskReady: true }); run("r25RouteAsr(add('q1'),perQuestionAudio.get('q1'))"); for (let i = 0; i < 6; i++) await tick();
    assert.equal(run('JSON.stringify(calls.enqueue)'), JSON.stringify(['q1']), 'ready Vosk takes over immediately'); n++; }
  { const run = make({ pref: 'vosk', voskReady: false }); run("voskUi.state='error'"); run('r25AutoVosk()'); assert.equal(run('calls.preload.length'), 0, 'no automatic retry loop after a failed download'); 
    run("voskUi.state='idle'"); run('r25AutoVosk()'); assert.equal(run('calls.preload.length'), 1); n++; }
  { const run = make({ pref: 'vosk', voskReady: true }); run("const t=add('q1');t.runId='old'"); run("r25RouteAsr(sessionTurns[0],{size:1000})"); assert.equal(run('JSON.stringify(calls.enqueue)'), JSON.stringify([]), 'turn from an old run is ignored'); n++; }
  { const run = make({ pref: 'base', whisper: 'audiofail', voskReady: false }); run("r25RouteAsr(add('q1'),perQuestionAudio.get('q1'))"); for (let i = 0; i < 6; i++) await tick();
    assert.equal(run('calls.preload.length'), 1, 'a bad recording still gets a Vosk attempt');
    run("r25RouteAsr(add('q2'),perQuestionAudio.get('q2'))"); for (let i = 0; i < 6; i++) await tick();
    assert.equal(run('calls.whisper'), 2, 'a per-recording error must not disable Whisper for the page'); assert.equal(run('sessionTurns[1].answer'), '第二题文字'); n++; }
  console.log(JSON.stringify({ status: 'PASS', checks: n, mode: 'real app.js R2.5 routing block in Node VM; mocked engines/loader; no speech' }));
})().catch(e => { console.error(e); process.exit(1); });
