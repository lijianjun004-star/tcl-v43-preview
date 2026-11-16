import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveWhisperModel, SUPPORTED_WHISPER_MODELS,createLocalWhisper} from '../site/tcl-v352-asr-autoqa-r23/whisper-bridge.mjs';

function audio() {
  globalThis.AudioContext = class {
    decodeAudioData(){return Promise.resolve({duration:0.5,sampleRate:16000,length:8000,numberOfChannels:1,getChannelData:()=>new Float32Array(8000).fill(.15)})}
    async close(){}
  };
  globalThis.OfflineAudioContext = class {
    constructor(c,n,s){this.n=n;this.destination={}}
    createBufferSource(){return {buffer:null,connect(){},start(){}}}
    async startRendering(){return {getChannelData:()=>new Float32Array(this.n).fill(.2)}}
  };
  return new Blob([new Uint8Array(500)],{type:'audio/wav'});
}
test('R23-01 only multilingual open-source tiny/base allowlisted',()=>{
 assert.equal(resolveWhisperModel('tiny'),'onnx-community/whisper-tiny');
 assert.equal(resolveWhisperModel('base'),'onnx-community/whisper-base');
 assert.equal(Object.isFrozen(SUPPORTED_WHISPER_MODELS),true);
 for(const x of ['base.en','medium','gpt-transcribe',null,{},'tiny;evil'])assert.throws(()=>resolveWhisperModel(x),/unsupported/);
});
test('R23-02 enhanced mode really selects Whisper Base engine',async()=>{
 const b=audio();let seen=[];
 const e=createLocalWhisper({modelPreset:'base',pipelineFactory:async model=>{seen.push(model);return async()=>({text:'空调有新风功能'})}});
 const a=await e(b);assert.equal(a.text,'空调有新风功能');assert.equal(a.model,SUPPORTED_WHISPER_MODELS.base);
 assert.deepEqual(seen,['onnx-community/whisper-base']);
});
test('R23-03 lightweight mode still works independently',async()=>{
 const b=audio();let seen=[];
 const e=createLocalWhisper({modelPreset:'tiny',pipelineFactory:async model=>{seen.push(model);return async()=>({text:'电视 HDMI 二点一'})}});
 const a=await e(b);assert.equal(a.model,SUPPORTED_WHISPER_MODELS.tiny);
 assert.deepEqual(seen,['onnx-community/whisper-tiny']);
});
test('R23-04 invalid mode fails before model or any network access',()=>{
 let calls=0;
 assert.throws(()=>createLocalWhisper({modelPreset:'openai',pipelineFactory:()=>{calls++;}}),/unsupported/);
 assert.equal(calls,0);
});
test('R23-05 Base load timeout blocks a second attempt (no concurrent mobile WASM)',async()=>{
 const b=audio();let n=0;
 const e=createLocalWhisper({modelPreset:'base',loadTimeoutMs:55,pipelineFactory:async()=>{n++;await new Promise(r=>setTimeout(r,160));return async()=>({text:'late'})}});
 await assert.rejects(e(b),/超时/);await assert.rejects(e(b),/停用|超时/);await new Promise(r=>setTimeout(r,170));assert.equal(n,1);
});
test('R23-06 no paid API or audio network upload in deliverable',async()=>{
 const fs=await import('node:fs/promises');
 const base=new URL('../site/tcl-v352-asr-autoqa-r23/',import.meta.url);
 const app=await fs.readFile(new URL('app.js',base),'utf8');
 const bridge=await fs.readFile(new URL('whisper-bridge.mjs',base),'utf8');
 const ui=await fs.readFile(new URL('r23-model-choice.js',base),'utf8');
 assert.equal(/api\.openai\.com|gpt-transcribe|Authorization:\s*Bearer/.test(app+'\n'+bridge+'\n'+ui),false);
 assert.equal(/fetch\([^)]*(?:blob|audio|record|formdata)/i.test(bridge),false);
 assert.match(app,/tcl-specialty-v352-asr-autoqa-r23/);
 assert.doesNotMatch(app,/var r6WhisperSubmit=globalThis/);
});

test('R23-07 default model is Base for the experimental upgrade',async()=>{
 const b=audio();let selected='';const engine=createLocalWhisper({pipelineFactory:async id=>{selected=id;return async()=>({text:'简短口播'})}});
 const r=await engine(b);assert.equal(selected,SUPPORTED_WHISPER_MODELS.base);assert.equal(r.model,SUPPORTED_WHISPER_MODELS.base);
});