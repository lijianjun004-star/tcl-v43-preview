import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const path=process.env.R24_APP_SOURCE||new URL('../tcl-v352-asr-r24-qa/app.js',import.meta.url);
const app=fs.readFileSync(path,'utf8');
const extract=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
const bounded=extract('async function awaitBounded(','async function decodeAudioCopy(');
const decode=extract('async function decodeAudioCopy(','async function decodeAudioCopyInternal(');
const load=extract('async function loadVerifiedVosk(','async function recognizeVosk(');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('decoder timeout keeps actual resource locked until native promise resolves',async()=>{
 let calls=0,finish;
 const context=vm.createContext({setTimeout,clearTimeout,window:{__ASR_DECODE_TIMEOUT_MS:25},ensureDecodeBudget(){},decodeAudioCopyInternal(){calls++;return new Promise(resolve=>{finish=resolve;});}});
 vm.runInContext('let audioDecodeJob=null;'+bounded+decode,context);
 const run=()=>vm.runInContext("decodeAudioCopy({size:1})",context);
 await assert.rejects(run,/超时/);assert.equal(calls,1);
 await assert.rejects(run,/上一项音频解码/);assert.equal(calls,1);
 finish(new Float32Array(1));await tick();
 const next=run();assert.equal(calls,2);finish(new Float32Array(1));await next;
});

test('Vosk initialization timeout retains worker job and its blob URL; no duplicate initialization',async()=>{
 let calls=0,finish,revoked=0;
 const context=vm.createContext({setTimeout,clearTimeout,Blob,Uint8Array,
  window:{__ASR_LOAD_TIMEOUT_MS:50,Vosk:{createModel(){calls++;return new Promise(resolve=>{finish=resolve;});}}},
  URL:{createObjectURL(){return 'blob:test';},revokeObjectURL(){revoked++;}},
  ensureVoskScript:async()=>{},verifiedVoskFile:async()=>new Uint8Array([1,2]),sha256Hex:async()=> 'verified',clearCachedVoskParts:async()=>{},
  asrActive(valid){if(!valid())throw Error('cancelled');},VOSK_PART_NAMES:['part'],VOSK_MODEL_TOTAL_BYTES:2,VOSK_MODEL_FULL_SHA256:'verified'
 });
 vm.runInContext('let voskModel=null,voskLoadJob=null;'+bounded+load,context);
 const run=()=>vm.runInContext('loadVerifiedVosk()',context);
 await assert.rejects(run,/超时/);assert.equal(calls,1);assert.equal(revoked,0);
 await assert.rejects(run,/超时/);assert.equal(calls,1);assert.equal(revoked,0);
 const model={KaldiRecognizer(){}};finish(model);await tick();
 assert.equal(await run(),model);assert.equal(calls,1);assert.equal(revoked,1);
});

test('quiet Vosk recovery rechecks a copy without changing normal input or admitting stationary samples',()=>{
 const context=vm.createContext({Float32Array});
 const trim=vm.runInContext(extract('function trimAsrSilence(','function calcChineseRatio(')+'\ntrimAsrSilence',context);
 const wave=Float32Array.from({length:48000},(_,i)=>i>=8000&&i<40000?.004*Math.sin(i*.14):0);
 const before=wave.slice();
 assert.equal(trim(wave).hasSpeech,false);
 assert.equal(trim(wave,16000,{recoverQuiet:true}).hasSpeech,true);
 assert.deepEqual(wave,before);
 const normal=wave.map(value=>value*10);
 assert.deepEqual(trim(normal,16000,{recoverQuiet:true}).pcm,trim(normal).pcm);
 const stationary=Float32Array.from({length:48000},(_,i)=>.004*Math.sin(i*.14));
 assert.equal(trim(stationary,16000,{recoverQuiet:true}).hasSpeech,false);
 assert.equal(trim(new Float32Array(48000),16000,{recoverQuiet:true}).hasSpeech,false);
});
