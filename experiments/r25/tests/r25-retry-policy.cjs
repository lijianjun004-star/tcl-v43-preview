// Actual routing, Whisper queue and Vosk preload functions. Failed network/model loading
// is mocked; this verifies retry policy and preserved recordings, not speech accuracy.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=process.env.R25_DIR||path.resolve(__dirname,'../tcl-v352-asr-r25-qa');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
function slice(start,end){const a=app.indexOf(start),b=app.indexOf(end,a);assert(a>=0&&b>a);return app.slice(a,b);}
const queue=slice('const r6WhisperValid=','globalThis.r6WhisperSubmit=r6WhisperSubmit;');
const recorded=slice('function enqueueRecordedQuestions(){','const saveTurn=');
const preload=slice('async function preloadVoskModel(','async function transcribeSessionVideo(');
const tick=()=>new Promise(r=>setImmediate(r));
function make(pref){
 const ctx=vm.createContext({setTimeout,clearTimeout,console});
 vm.runInContext(`
 let runId='run',selectedBoard='b',activePlatform='p',activeTurn=null,lastSessionSnapshot=null;
 let oneShotAsrJob=null,audioDecodeJob=null,asrInferJob=null,transcriptBusy=false,r6WhisperRunning=false,r6WhisperCancelSeq=0;
 let voskModel=null,voskLoadJob=null,voskUi={state:'idle'},failLoad=true;
 const calls={load:0,enqueue:[],whisper:0,saved:[],statuses:[]};
 const window={},navigator={onLine:true},sessionTurns=[],perQuestionAudio=new Map(),r6WhisperQueue=[];
 const ELEM=()=>null,toast=()=>{},setVoskPreloadUi=()=>{},renderQuestionSummary=()=>{},renderSessionReview=()=>{};
 const isRunPage=()=>true,r6WhisperPageAlive=()=>true,renderTurnStatus=t=>calls.statuses.push(t.asrStatus),drainQuestionAsrQueue=()=>{};
 const saveTurn=async t=>{calls.saved.push(t.id);return true;};
 const normalizeWhisperChinese=t=>t,normalizeInterfaceDecimals=t=>({text:t,changes:0}),normalizeSpokenNumbers=t=>({text:t,changes:0}),assessAsrText=t=>({text:t,warnings:[]}),complianceHints=()=>[],fuzzyPoint=()=>false;
 const readR23ModelPreference=()=>${JSON.stringify(pref)};
 const awaitBounded=p=>p;
 const loadVerifiedVosk=async()=>{calls.load++;if(failLoad)throw new Error('下载失败 HTTP 503');voskModel={};return voskModel;};
 const enqueueQuestionAsr=id=>calls.enqueue.push(id);
 const r6WhisperEngine=async()=>{calls.whisper++;throw new Error('后台语音识别 Worker 无法启动');};
 r6WhisperEngine.isResourceBusy=()=>false;
 function add(id){const t={id,runId,boardId:'b',platform:'p',answer:'',transcript:'',keyPoints:[]};sessionTurns.push(t);perQuestionAudio.set(id,{size:1000});return t;}
 `+queue+recorded+preload,ctx);
 return src=>vm.runInContext(src,ctx);
}
(async()=>{
 const checks={};
 const d=make('vosk');d('r25AutoVosk()');for(let i=0;i<3;i++)await tick();
 assert.equal(d('calls.load'),1);assert.equal(d('voskUi.state'),'error');
 for(let i=0;i<3;i++){d(`r25RouteAsr(add('q${i}'),perQuestionAudio.get('q${i}'))`);await tick();}
 assert.equal(d('calls.load'),1,'new recordings must not restart a failed Vosk download');
 assert.equal(d('perQuestionAudio.size'),3);assert.equal(d('calls.whisper'),0);
 assert.equal(d('sessionTurns.every(t=>/原始录音已保存/.test(t.asrStatus)&&/重试/.test(t.asrStatus))'),true);
 checks.failed_default_download_stays_failed_and_keeps_three_recordings=true;
 d('r25AutoVosk();r25VoskWanted=true;r6WhisperDrain()');for(let i=0;i<3;i++)await tick();
 assert.equal(d('calls.load'),1,'deferred routing and re-entering training must not retry');
 checks.deferred_automatic_routes_do_not_retry=true;
 await d('failLoad=false;preloadVoskModel()');
 assert.equal(d('calls.load'),2);assert.equal(d('voskUi.state'),'ready');
 assert.deepEqual(JSON.parse(d('JSON.stringify(calls.enqueue)')),['q0','q1','q2']);
 assert.equal(d('perQuestionAudio.size'),3);
 checks.explicit_manual_retry_loads_and_enqueues_all_preserved_recordings=true;
 const w=make('base');await w('preloadVoskModel()');assert.equal(w('voskUi.state'),'error');
 w("r25RouteAsr(add('w1'),perQuestionAudio.get('w1'))");for(let i=0;i<5;i++)await tick();
 assert.equal(w('calls.whisper'),1,'explicit Whisper choice is still tried');
 assert.equal(w('calls.load'),1,'Whisper failure must not retry an already failed Vosk download');
 assert.match(w('sessionTurns[0].asrStatus'),/原始录音已保存.*重试/);
 w("r25RouteAsr(add('w2'),perQuestionAudio.get('w2'))");for(let i=0;i<3;i++)await tick();
 assert.equal(w('calls.load'),1);assert.equal(w('calls.whisper'),1);assert.equal(w('perQuestionAudio.size'),2);
 checks.explicit_whisper_failure_keeps_recordings_without_retrying_failed_fallback=true;
 await w('failLoad=false;preloadVoskModel()');
 assert.equal(w('calls.load'),2);assert.deepEqual(JSON.parse(w('JSON.stringify(calls.enqueue)')),['w1','w2']);
 checks.manual_retry_after_whisper_failure_enqueues_both_questions=true;
 console.log(JSON.stringify({status:'PASS',mode:'Actual app routing/queue/preload functions; mocked failed loader and Whisper; no network/models/speech',checks},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
