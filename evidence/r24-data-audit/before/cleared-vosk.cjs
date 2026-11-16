const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const path='/workspace/tcl-v43-preview/experiments/r24/tcl-v352-asr-r24-qa/app.js',s=fs.readFileSync(path,'utf8');
const code=s.slice(s.indexOf('async function transcribeQuestion('),s.indexOf('\nfunction closeMenu(',s.indexOf('async function transcribeQuestion(')));
const c=vm.createContext({console,setTimeout,clearTimeout});
vm.runInContext(`
const r6WhisperEngine={isResourceBusy:()=>false},voskModel={};let runId='run',selectedBoard='01',activePlatform='京东',activeTurn=null,recorderPending=false,recorderFinalizing=false,currentRecorder=null,oneShotAsrJob=null,audioDecodeJob=null,asrInferJob=null,transcriptBusy=false,r6WhisperRunning=false;
const turn={id:'q1',runId:'run',boardId:'01',platform:'京东',answer:'',transcript:'旧转写',manualEdited:true,manualCleared:true,keyPoints:['清晰'],pointKeywords:[['清晰']],pointsHit:[],compliance:[]};
const audio={},perQuestionAudio=new Map([['q1',audio]]),sessionTurns=[turn],questionAsrQueue=[],saved=[];
const window={},ELEM=()=>null,toast=()=>{},isRunPage=()=>true,renderTurnStatus=()=>{},renderQuestionSummary=()=>{},r6WhisperDrain=()=>{},drainQuestionAsrQueue=()=>{},preloadVoskModel=()=>{},saveCurrentTypedAnswer=()=>{};
const decodeAudioCopy=async()=>new Float32Array(16000),awaitBounded=p=>p,trimAsrSilence=pcm=>({pcm,hasSpeech:true}),recognizeVosk=async()=>({text:'清晰的屏幕'}),assessAsrText=text=>({text,warnings:[]}),normalizeSpokenNumbers=text=>({text,changes:0});
const complianceHints=()=>[],fuzzyPoint=(point,text)=>text.includes(point),saveTurn=async t=>saved.push(JSON.parse(JSON.stringify(t)));
`+code,c);
(async()=>{await vm.runInContext("transcribeQuestion('q1')",c);const saved=vm.runInContext('saved[0]',c);const result={mode:'actual app transcribeQuestion in Node VM; mocked decoder/Vosk and persistence, not speech or browser evidence',sha256:crypto.createHash('sha256').update(s).digest('hex'),saved,confirmed:saved.manualCleared===true&&saved.answer===''&&saved.pointsHit.length===1};fs.writeFileSync('/workspace/scratch/r24-data-audit/cleared-vosk.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));})();
