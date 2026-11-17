const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'../tcl-v352-asr-r25-qa/app.js'),'utf8');
const code=s.slice(s.indexOf('async function transcribeQuestion('),s.indexOf('\nfunction closeMenu(',s.indexOf('async function transcribeQuestion(')));
const save=s.slice(s.indexOf('function saveCurrentTypedAnswer('),s.indexOf('function enqueueRecordedQuestions('));
const event=s.slice(s.indexOf('  rec.onresult=e=>{'),s.indexOf('  rec.onerror=e=>{'));
const c=vm.createContext({console,setTimeout,clearTimeout});
vm.runInContext(`
const r6WhisperEngine={isResourceBusy:()=>false},voskModel={};let runId='run',selectedBoard='01',activePlatform='京东',recorderPending=false,recorderFinalizing=false,currentRecorder=null,oneShotAsrJob=null,audioDecodeJob=null,asrInferJob=null,transcriptBusy=false,r6WhisperRunning=false,page='training',roomPhase='live';
const turn={id:'q1',runId:'run',boardId:'01',platform:'京东',answer:'',transcript:'旧转写',manualEdited:true,manualCleared:true,keyPoints:['清晰'],pointKeywords:[['清晰']],pointsHit:[],compliance:[]};let activeTurn=turn;
const audio={},perQuestionAudio=new Map([['q1',audio]]),sessionTurns=[turn],questionAsrQueue=[],saved=[];
const target={value:'',isConnected:true},visible={value:''},status={},rec={};let speechRecognizer=rec,hadTextResult=false;const valid=()=>true;
const window={},ELEM=id=>id==='answerText'?target:id==='liveTextAnswer'?visible:id==='textAnswerSheet'?{hidden:false}:null,toast=()=>{},isRunPage=()=>true,renderTurnStatus=()=>{},renderQuestionSummary=()=>{},r6WhisperDrain=()=>{},drainQuestionAsrQueue=()=>{},preloadVoskModel=()=>{};
const decodeAudioCopy=async()=>new Float32Array(16000),awaitBounded=p=>p,trimAsrSilence=pcm=>({pcm,hasSpeech:true}),recognizeVosk=async()=>({text:'清晰的屏幕'}),assessAsrText=text=>({text,warnings:[]}),normalizeSpokenNumbers=text=>({text,changes:0});
const complianceHints=text=>text?['test-risk']:[],fuzzyPoint=(point,text)=>text.includes(point),saveTurn=async t=>saved.push(JSON.parse(JSON.stringify(t)));
`+save+code+event,c);
(async()=>{
 await vm.runInContext("transcribeQuestion('q1')",c);
 let row=vm.runInContext('saved.at(-1)',c);assert.equal(row.answer,'');assert.equal(row.manualCleared,true);assert.equal(row.pointsHit.length,0);assert.equal(row.compliance.length,0);assert.equal(row.rawTranscript,'清晰的屏幕');
 vm.runInContext("turn.answer='清晰的屏幕';turn.transcript='清晰的屏幕';turn.manualCleared=false;turn.pointsHit=['清晰'];turn.compliance=['test-risk'];target.value='';saveCurrentTypedAnswer();",c);
 row=vm.runInContext('saved.at(-1)',c);assert.equal(row.manualCleared,true);assert.equal(row.pointsHit.length,0);assert.equal(row.compliance.length,0);
 vm.runInContext("rec.onresult({results:[[{transcript:'清晰的屏幕'}]]});",c);
 assert.equal(vm.runInContext('target.value',c),'');assert.equal(vm.runInContext('visible.value',c),'');row=vm.runInContext('saved.at(-1)',c);assert.equal(row.answer,'');assert.equal(row.manualCleared,true);assert.equal(row.pointsHit.length,0);assert.equal(row.rawTranscript,'清晰的屏幕');
 console.log(JSON.stringify({status:'PASS',checks:3,mode:'actual app live-clear/Vosk/browser-result functions in Node VM; mocked model, decoder and persistence'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
