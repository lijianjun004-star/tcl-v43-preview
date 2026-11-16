// Run the actual whole-session handler with decoded PCM/model mocks. Compare its
// displayed model to the actual createLocalWhisper preset expression in app.js.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=process.env.R25_DIR||path.resolve(__dirname,'../tcl-v352-asr-r25-qa');
const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
const a=app.indexOf('async function transcribeSessionVideo('),b=app.indexOf('async function submitAnswer(',a);
const preset=app.match(/modelPreset: ([^,]+),onProgress:/)?.[1];assert(a>=0&&b>a&&preset);
(async()=>{
 const checks={};
 for(const pref of ['vosk','tiny','base']){
  const ctx=vm.createContext({Float32Array,console});
  vm.runInContext(`
   const readR23ModelPreference=()=>${JSON.stringify(pref)},configuredPreset=${preset};
   const window={},nodes={transcribeStatus:{},transcribeVideoBtn:{},transcribeWhisperBtn:{},postTranscript:{}};
   const ELEM=id=>nodes[id]||null,toast=()=>{},ensureDecodeBudget=()=>{},awaitBounded=p=>p;
   const decodeAudioCopy=async()=>new Float32Array(16000).fill(.1),trimAsrSilence=pcm=>({hasSpeech:true,pcm});
   const assessAsrText=text=>({text,warnings:[]}),normalizeSpokenNumbers=text=>({text,changes:0});
   const r6WhisperEngine={isResourceBusy:()=>false,transcribePreparedAudio:async()=>({text:'整场测试文字'})};
   const isRunPage=()=>true,asrActive=valid=>{if(!valid())throw new Error('cancelled')},r6WhisperDrain=()=>{},enqueueRecordedQuestions=()=>{},persistSessionCheckpoint=()=>{};
   let transcriptBusy=false,oneShotAsrJob=null,r6WhisperRunning=false,r6WhisperQueue=[],audioDecodeJob=null,asrInferJob=null,voskLoadJob=null,voskModel=null;
   let sessionVideoBlob={},videoRecorderFinalizing=false,selectedBoard='b',activePlatform='p',transcriptSeq=0,lastSessionSnapshot=null,runId='run';
  `+app.slice(a,b),ctx);
  await vm.runInContext("transcribeSessionVideo('whisper')",ctx);
  const actual=vm.runInContext('configuredPreset',ctx),label=vm.runInContext('nodes.transcribeStatus.textContent',ctx);
  assert.match(label,new RegExp('引擎：Whisper '+(actual==='base'?'Base':'Tiny')+' 本机模型'),pref+' mode must display its configured Whisper engine');
  assert.equal(vm.runInContext('nodes.postTranscript.value',ctx),'整场测试文字');
  checks[pref]={configured:actual,label_matches:true};
 }
 console.log(JSON.stringify({status:'PASS',mode:'Actual whole-session handler and actual model preset expression; mocked audio/model, no speech or network',checks},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
