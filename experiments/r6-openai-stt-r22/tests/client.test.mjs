import test from 'node:test';
import assert from 'node:assert/strict';
import {configureASR,getASRSettings,transcribePreferred} from '../site/openai-asr-client.mjs';
const blob=new Blob([new Uint8Array(100)],{type:'audio/webm'});
const task={turnId:'turn-1234'};
const token='test-user-auth-code-very-long';
const endpoint='https://test-r6.workers.dev/transcribe';
test('local Whisper is default without any remote request',async()=>{
 configureASR({mode:'local'});let remote=0,local=0;
 const out=await transcribePreferred(blob,task,async()=>{local++;return {text:'本机测试'}},{fetchImpl:()=>{remote++}});
 assert.deepEqual(out,{text:'本机测试',source:'whisper-local'});
 assert.equal(remote,0);assert.equal(local,1);
});
test('paid mode requires explicit cost confirmation and secure endpoint',()=>{
 assert.throws(()=>configureASR({mode:'openai',endpoint,accessToken:token}),/确认/);
 assert.throws(()=>configureASR({mode:'openai',endpoint:'http://example.com/transcribe',accessToken:token,confirmedCosts:true}),/HTTPS/);
});
test('paid mode requires strong access code but never exposes OpenAI key',()=>{
 assert.throws(()=>configureASR({mode:'openai',endpoint,accessToken:'123',confirmedCosts:true}),/至少20位/);
 const configured=configureASR({mode:'openai',endpoint,accessToken:token,confirmedCosts:true});
 assert.deepEqual(configured,{mode:'openai',endpoint,authenticated:true});
 assert.equal(JSON.stringify(configured).includes(token),false);
});
test('remote provider handles real question id and text',async()=>{
 configureASR({mode:'openai',endpoint,accessToken:token,confirmedCosts:true});let calls=0;
 const out=await transcribePreferred(blob,task,()=>{throw Error('local fallback should not be called');},{fetchImpl:async(url,opts)=>{
    calls++;assert.equal(url,endpoint);assert.equal(opts.headers.Authorization,'Bearer '+token);
    assert.equal(opts.body.get('turnId'),'turn-1234');assert.equal(opts.credentials,'omit');
    return new Response(JSON.stringify({turnId:'turn-1234',text:'电视型号 T7M Pro',source:'openai-api'}),{status:200});
 }});
 assert.deepEqual(out,{text:'电视型号 T7M Pro',source:'openai-api'});assert.equal(calls,1);
});
test('remote wrong question ID never enters answer field',async()=>{
 await assert.rejects(()=>transcribePreferred(blob,task,()=>({text:'fallback'}),{fetchImpl:async()=>new Response(JSON.stringify({turnId:'another',text:'不属于本题'}),{status:200})}),/题目编号不匹配/);
});
test('backend not configured fails without invented transcript or paid provider',async()=>{
 await assert.rejects(()=>transcribePreferred(blob,task,()=>({text:'fallback'}),{fetchImpl:async()=>new Response(JSON.stringify({error:'not_configured'}),{status:503})}),/尚未启用/);
});
test('oversized file never calls remote provider',async()=>{
 let calls=0;const large=new Blob([new Uint8Array(8*1024*1024+1)],{type:'audio/webm'});
 await assert.rejects(()=>transcribePreferred(large,task,()=>{}, {fetchImpl:()=>{calls++}}),/8MB/);assert.equal(calls,0);
});