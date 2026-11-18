// Real app function bodies, mocked engines and PCM; no real speech/device claim.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../tcl-v352-asr-r24-qa/app.js',import.meta.url),'utf8');
const between=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
const bounded=between('async function awaitBounded(','async function decodeAudioCopy(');
const queue=between('const r6WhisperValid=','globalThis.r6WhisperSubmit=');
const vosk=between('async function transcribeQuestion(','function closeMenu(');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
for(const outcome of ['resolve','reject'])test(`pending Whisper wakes after timed-out Vosk raw job ${outcome}s`,async()=>{
 const c=vm.createContext({setTimeout,clearTimeout,console,Float32Array});
 vm.runInContext(`
 let runId='run',selectedBoard='b',activePlatform='p',activeTurn=null,lastSessionSnapshot=null;
 let oneShotAsrJob=null,audioDecodeJob=null,asrInferJob=null,transcriptBusy=false,r6WhisperRunning=false,voskLoadJob=null,voskModel={},r6WhisperCancelSeq=0;
 let recorderPending=false,recorderFinalizing=false,currentRecorder=null,finishVosk,failVosk,whisperCalls=0;
 const window={__ASR_INFER_TIMEOUT_MS:25},sessionTurns=[],perQuestionAudio=new Map(),r6WhisperQueue=[],questionAsrQueue=[];
 const toast=()=>{},ELEM=()=>null,isRunPage=()=>true,r6WhisperPageAlive=()=>true,renderTurnStatus=()=>{},renderQuestionSummary=()=>{},drainQuestionAsrQueue=()=>{},saveTurn=async()=>true;
 const decodeAudioCopy=async()=>new Float32Array(16000),trimAsrSilence=pcm=>({hasSpeech:true,pcm}),recognizeVosk=()=>new Promise((resolve,reject)=>{finishVosk=resolve;failVosk=reject;});
 const normalizeWhisperChinese=text=>text,normalizeSpokenNumbers=text=>({text,changes:0}),assessAsrText=text=>({text,warnings:[]}),complianceHints=()=>[],saveCurrentTypedAnswer=()=>{};
 const usesSenseVoice=false,asrModelLabel='Whisper Base',releaseVoskForSenseVoice=()=>{};
 const r6WhisperEngine=async()=>{whisperCalls++;return {text:'新题文字'}};r6WhisperEngine.isResourceBusy=()=>false;
 function add(id){sessionTurns.push({id,runId,boardId:'b',platform:'p',answer:'',transcript:'',keyPoints:[]});perQuestionAudio.set(id,{id,size:1000});}
 add('old');add('new');
 `+bounded+queue+vosk,c);
 const run=source=>vm.runInContext(source,c);
 const job=run("transcribeQuestion('old')");await tick();
 assert.equal(run('typeof finishVosk'),'function');
 run("r6WhisperSubmit('new',perQuestionAudio.get('new'))");
 assert.equal(run('whisperCalls'),0,'must not overlap raw Vosk inference');
 await job;
 assert.equal(run('oneShotAsrJob'),null);
 assert.notEqual(run('asrInferJob'),null,'raw job still holds its lock after wrapper timeout');
 assert.equal(run('whisperCalls'),0);
 if(outcome==='resolve')run("finishVosk({text:'迟到结果'})");
 else run("failVosk(new Error('late engine failure'))");
 await tick();await tick();
 assert.equal(run('whisperCalls'),1,'raw settlement must wake the pending Whisper queue');
 assert.equal(run('sessionTurns[1].answer'),'新题文字');
 assert.equal(run('sessionTurns[0].answer'),'','timed-out Vosk output must not write later');
 assert.equal(run('r6WhisperQueue.length'),0);
});
