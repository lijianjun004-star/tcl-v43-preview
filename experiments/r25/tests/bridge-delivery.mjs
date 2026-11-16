import assert from 'node:assert/strict';
import { test } from 'node:test';
import {createLocalWhisper, prepareAudio, WHISPER_REVISIONS} from '../tcl-v352-asr-r25-qa/whisper-bridge.mjs';
const audio = () => ({data:new Float32Array(16000).fill(.1),sampleRate:16000,duration:1});
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));

test('three callers share one pipeline and never overlap actual inference', async()=>{
  let loads=0, active=0, maxActive=0, calls=0;
  const engine=createLocalWhisper({pipelineFactory:async()=>{
    loads++;
    await delay(5);
    return async()=>{active++;maxActive=Math.max(maxActive,active);const id=++calls;await delay(15);active--;return {text:`result ${id}`};};
  }});
  const results=await Promise.all([1,2,3].map(()=>engine.transcribePreparedAudio(audio())));
  assert.equal(loads,1);assert.equal(maxActive,1);assert.equal(calls,3);
  assert.equal(engine.isResourceBusy(),false);
  assert.deepEqual(results.map(x=>x.text),['result 1','result 2','result 3']);
});

test('timed-out raw inference remains locked; waiting and future callers cannot enter', async()=>{
  let calls=0,finish;
  const engine=createLocalWhisper({inferTimeoutMs:50,pipelineFactory:async()=>async()=>{
    calls++;return new Promise(resolve=>{finish=resolve;});
  }});
  const results=await Promise.allSettled([engine.transcribePreparedAudio(audio()),engine.transcribePreparedAudio(audio())]);
  assert.ok(results.every(x=>x.status==='rejected'));
  assert.equal(calls,1);
  assert.equal(engine.isResourceBusy(),true);
  finish({text:'late'});await delay(2);
  await assert.rejects(()=>engine.transcribePreparedAudio(audio()),/禁止|停用/);
  assert.equal(calls,1);
  assert.equal(engine.isResourceBusy(),true); // page stays disabled, requiring reload
});

test('cancelled waiter does not start inference or cancel owner', async()=>{
  let calls=0,finish;
  const engine=createLocalWhisper({pipelineFactory:async()=>async()=>{
    calls++;if(calls===1)return new Promise(resolve=>{finish=resolve;});return {text:'next'};
  }});
  const first=engine.transcribePreparedAudio(audio());await delay(5);
  const controller=new AbortController();
  const waiting=engine.transcribePreparedAudio(audio(),{signal:controller.signal});
  controller.abort();await assert.rejects(()=>waiting,/cancelled/);
  assert.equal(calls,1);finish({text:'first'});await first;
  assert.equal((await engine.transcribePreparedAudio(audio())).text,'next');
  assert.equal(calls,2);
});

test('silence avoids model download; malformed and overlong PCM fail before loading', async()=>{
  let loads=0;
  const engine=createLocalWhisper({pipelineFactory:async()=>{loads++;return async()=>({text:'bad'});}});
  assert.equal((await engine.transcribePreparedAudio({...audio(),data:new Float32Array(16000)})).text,'');
  for(const bad of [{...audio(),sampleRate:48000},{...audio(),duration:181},{...audio(),data:new Float32Array([NaN])},{...audio(),data:new Float32Array()}]){
    await assert.rejects(()=>engine.transcribePreparedAudio(bad),/invalid/);
  }
  assert.equal(loads,0);
});

test('valid 180-second prepared audio is supported and models have immutable revisions', async()=>{
  const engine=createLocalWhisper({pipelineFactory:async()=>async data=>({text:String(data.length)})});
  const result=await engine.transcribePreparedAudio({data:new Float32Array(180*16000).fill(.1),sampleRate:16000,duration:180});
  assert.equal(result.text,'2880000');
  for(const sha of Object.values(WHISPER_REVISIONS))assert.match(sha,/^[a-f0-9]{40}$/);
});

test('pre-aborted audio decode does not allocate AudioContext', async()=>{
  let allocations=0;globalThis.AudioContext=class{constructor(){allocations++;}};
  globalThis.OfflineAudioContext=class{};
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>prepareAudio(new Blob(['x']),{signal:controller.signal}),/cancelled/);
  assert.equal(allocations,0);
});
