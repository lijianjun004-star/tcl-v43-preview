import assert from 'node:assert/strict';
import {createLocalWhisper} from '/workspace/tcl-r25-verify/experiments/r25/tcl-v352-asr-r25-qa/whisper-bridge.mjs';
const audio=()=>({data:new Float32Array(16000).fill(.1),sampleRate:16000,duration:1});
for(const stage of ['init','load','infer']){
 const workers=[];let reached;const target=new Promise(r=>reached=r);
 globalThis.Worker=class{listeners=new Map();constructor(){workers.push(this)}addEventListener(t,l){this.listeners.set(t,l)}postMessage(m){if(m.type===stage){reached();return}queueMicrotask(()=>this.listeners.get('message')({data:{id:m.id,type:'result',result:null}}))}terminate(){this.terminated=true}};
 const engine=createLocalWhisper({loadTimeoutMs:1000,inferTimeoutMs:1000}),controller=new AbortController();
 const result=engine.transcribePreparedAudio(audio(),{signal:controller.signal});await target;controller.abort();await assert.rejects(result,/cancelled/);
 assert.equal(workers.length,1);assert.equal(workers[0].terminated,true);assert.equal(engine.isResourceBusy(),false);await assert.rejects(engine.transcribePreparedAudio(audio()),/停用|禁止/);
 console.log(stage+': AbortSignal rejected, Worker terminated, fallback unlocked, subsequent Whisper rejected');
}
