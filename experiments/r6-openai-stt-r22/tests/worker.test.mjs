import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from '../worker/index.mjs';
const ORIGIN='https://lijianjun004-star.github.io';
const ACCESS='private-test-access-token-at-least20';
const SECRET='sk-test-server-only-never-publish';
const kv=new Map();
const makeEnv=(extras={})=>({ALLOWED_ORIGIN:ORIGIN,ASR_ACCESS_TOKEN:ACCESS,OPENAI_API_KEY:SECRET,ASR_BILLING_ENABLED:'true',DAILY_MAX_REQUESTS:'5',ASR_USAGE_KV:{get:async(k)=>kv.get(k)||null,put:async(k,v)=>kv.set(k,v)},...extras});
function request({token=ACCESS,origin=ORIGIN,type='audio/webm',turnId='turn-12',bytes=24,method='POST'}={}){
 if(method==='OPTIONS')return new Request('https://qa.example.workers.dev/transcribe',{method,headers:{origin,'access-control-request-method':'POST'}});
 const f=new FormData();f.set('audio',new File([new Uint8Array(bytes)],'turn.webm',{type}));f.set('turnId',turnId);
 return new Request('https://qa.example.workers.dev/transcribe',{method,headers:{origin,authorization:'Bearer '+token},body:f});
}
test('disabled by default; does not touch paid provider',async()=>{
 let calls=0;const res=await handleRequest(request(),makeEnv({ASR_BILLING_ENABLED:'false'}),{fetchImpl:async()=>{calls++}});
 assert.equal(res.status,503);assert.equal(calls,0);
});
test('origin denied before body and backend call',async()=>{
 let calls=0;const res=await handleRequest(request({origin:'https://evil.invalid'}),makeEnv(),{fetchImpl:async()=>{calls++}});
 assert.equal(res.status,403);assert.equal(calls,0);assert.equal(res.headers.get('access-control-allow-origin'),null);
});
test('missing authentication denied',async()=>{
 let calls=0;const res=await handleRequest(request({token:'wrong'}),makeEnv(),{fetchImpl:async()=>{calls++}});
 assert.equal(res.status,401);assert.equal(calls,0);
});
test('unsupported audio MIME rejected',async()=>{
 let calls=0;const res=await handleRequest(request({type:'text/html'}),makeEnv(),{fetchImpl:async()=>{calls++}});
 assert.equal(res.status,415);assert.equal(calls,0);
});
test('invalid turn id rejected',async()=>{
 const res=await handleRequest(request({turnId:'../../outside'}),makeEnv());assert.equal(res.status,400);
});
test('CORS preflight exact origin and no billing',async()=>{
 let calls=0;const res=await handleRequest(request({method:'OPTIONS'}),makeEnv(),{fetchImpl:async()=>{calls++}});
 assert.equal(res.status,204);assert.equal(res.headers.get('access-control-allow-origin'),ORIGIN);assert.equal(calls,0);
});
test('real OpenAI request is server-only, JSON echoes immutable turn id',async()=>{
 kv.clear();let called=0;
 const res=await handleRequest(request(),makeEnv(),{fetchImpl:async(url,opts)=>{
   called++;assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');
   assert.equal(opts.headers.Authorization,'Bearer '+SECRET);
   assert.equal(opts.body.get('model'),'gpt-transcribe');
   assert.match(opts.body.get('prompt'),/T7M Pro/);
   assert.equal(opts.body.get('file').size,24);
   return new Response(JSON.stringify({text:'这款电视支持 HDMI 2.1。'}),{status:200,headers:{'content-type':'application/json'}});
 }});
 assert.equal(res.status,200);assert.equal(called,1);
 assert.deepEqual(await res.json(),{turnId:'turn-12',text:'这款电视支持 HDMI 2.1。',source:'openai-api',model:'gpt-transcribe'});
 assert.equal(res.headers.get('cache-control'),'no-store');
});
test('quota exhaustion blocks paid requests',async()=>{
 kv.clear();let called=0;
 const env=makeEnv({DAILY_MAX_REQUESTS:'1'});
 const mock={fetchImpl:async()=>{called++;return new Response('{"text":"测试"}',{status:200})}};
 assert.equal((await handleRequest(request(),env,mock)).status,200);
 assert.equal((await handleRequest(request(),env,mock)).status,429);
 assert.equal(called,1);
});
test('upstream failure redacted: no provider response or token leak',async()=>{
 kv.clear();const env=makeEnv();const res=await handleRequest(request(),env,{fetchImpl:async()=>new Response(`secret ${SECRET}`,{status:400})});
 assert.equal(res.status,502);const body=await res.text();assert.doesNotMatch(body,/sk-test|secret/);
});
test('missing quota binding fails closed',async()=>{
 let calls=0;const env=makeEnv({ASR_USAGE_KV:null});
 const res=await handleRequest(request(),env,{fetchImpl:async()=>{calls++}});
 assert.equal(res.status,503);assert.equal(calls,0);
});