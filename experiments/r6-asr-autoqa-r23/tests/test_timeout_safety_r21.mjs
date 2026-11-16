import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalWhisper as original } from '../reference/gemini-r2-original-whisper-bridge.mjs';
import { createLocalWhisper as hardened } from '../site/tcl-v352-asr-autoqa-r23/whisper-bridge.mjs';
const sleep=t=>new Promise(r=>setTimeout(r,t));
function mocks() {
 globalThis.AudioContext=class { decodeAudioData(){return Promise.resolve({duration:1,sampleRate:16000,length:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(16000).fill(.2)})}async close(){} };
 globalThis.OfflineAudioContext=class {constructor(c,l,r){this.length=l;this.destination={}}createBufferSource(){return {buffer:null,connect(){},start(){}}}async startRendering(){return {getChannelData:()=>new Float32Array(this.length).fill(.2)}}};
 return new Blob([new Uint8Array(256)]);
}
test('original Gemini R2 reproduced: timeout permits overlapping inference',async()=>{
 const b=mocks();let running=0,max=0;
 const engine=original({inferTimeoutMs:60,pipelineFactory:async()=>async()=>{running++;max=Math.max(max,running);await sleep(220);running--;return{text:'test'}}});
 await assert.rejects(engine(b),/超时/);
 await assert.rejects(engine(b),/超时/);
 await sleep(240);
 assert.equal(max,2,'Prove failure without patch');
});
test('hardened R2: late inference is not re-entered after timeout',async()=>{
 const b=mocks();let running=0,max=0,calls=0;
 const engine=hardened({inferTimeoutMs:60,pipelineFactory:async()=>async()=>{running++;calls++;max=Math.max(max,running);await sleep(220);running--;return{text:'test'}}});
 await assert.rejects(engine(b),/超时/);
 await assert.rejects(engine(b),/已超时|停用|禁止/);
 await sleep(240);
 assert.equal(calls,1);
 assert.equal(max,1);
});
test('hardened R2: timed-out model loader fails closed, no second load',async()=>{
 const b=mocks();let calls=0;
 const engine=hardened({loadTimeoutMs:60,pipelineFactory:async()=>{calls++;await sleep(200);return async()=>({text:'late loaded'})}});
 await assert.rejects(engine(b),/超时/);
 await assert.rejects(engine(b),/已超时|停用/);
 await sleep(220);
 assert.equal(calls,1);
 await assert.rejects(engine(b),/已超时|停用/);
});
test('hardened R2: clean sequential recognitions still work',async()=>{
 const b=mocks();let calls=0;
 const engine=hardened({inferTimeoutMs:2000,pipelineFactory:async()=>async()=>{calls++;await sleep(30);return{text:'OK'+calls}}});
 const results=await Promise.all([engine(b),engine(b)]);
 assert.equal(results.length,2);
 assert.equal(results[0].text,'OK1');
 assert.equal(results[1].text,'OK2');
});