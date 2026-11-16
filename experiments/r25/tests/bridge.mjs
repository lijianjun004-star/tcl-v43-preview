import assert from 'node:assert/strict';
import {createLocalWhisper, prepareAudio} from '../tcl-v352-asr-r25-qa/whisper-bridge.mjs';
let amplitude=0.1;
class Context {
 decodeAudioData(_bytes, done) {const pcm={duration:1,length:16000,numberOfChannels:1,sampleRate:16000};done(pcm);return Promise.resolve(pcm);}
 close(){return Promise.resolve();}
}
class Offline {
 createBufferSource(){return {buffer:null,connect(){},start(){}};}
 startRendering(){return Promise.resolve({getChannelData:()=>new Float32Array(16000).fill(amplitude)});}
}
globalThis.AudioContext=Context;globalThis.OfflineAudioContext=Offline;
const blob=new Blob(['synthetic bytes']);
await assert.rejects(()=>prepareAudio(new Blob()),/empty/);
await assert.rejects(()=>prepareAudio({size:49*1024*1024,arrayBuffer(){throw Error('must not read');}}),/48 MiB/);
let loaded=0;
const events=[];
const engine=createLocalWhisper({pipelineFactory:async()=>{loaded++;return async()=>({text:'這台電視'});},onDiagnostic:e=>events.push(e)});
amplitude=0;assert.equal((await engine(blob)).text,'');assert.equal(loaded,0);
amplitude=.1;assert.equal((await engine(blob)).text,'這台電視');assert.equal(loaded,1);
assert.ok(events.some(x=>x.stage==='model-ready'));
assert.ok(events.every(x=>!('text' in x)));
let loads=0;
const blocked=createLocalWhisper({loadTimeoutMs:50,pipelineFactory:()=>{loads++;return new Promise(()=>{});}});
await assert.rejects(()=>blocked(blob),/超时/);
await assert.rejects(()=>blocked(blob),/停用/);assert.equal(loads,1);
console.log('PASS: empty/oversize/silence, diagnostic metadata, timeout prevents model reentry (synthetic AudioContext)');
