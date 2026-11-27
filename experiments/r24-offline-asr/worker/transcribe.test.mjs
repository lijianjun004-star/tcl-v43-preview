import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {run} from './transcribe.mjs';

const hash = b => createHash('sha256').update(b).digest('hex');
const credential = 'synthetic-worker-test-only';
const wording = '你好，我来核对一下。';
const json = async path => JSON.parse(await readFile(path, 'utf8'));

function wav(value) {
  const b = Buffer.alloc(48);
  b.write('RIFF'); b.writeUInt32LE(b.length-8,4); b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(1,22);
  b.writeUInt32LE(16000,24); b.writeUInt32LE(32000,28); b.writeUInt16LE(2,32);
  b.writeUInt16LE(16,34); b.write('data',36); b.writeUInt32LE(4,40); b.writeInt16LE(value,44);
  return b;
}

async function setup(t, count=1) {
  const path = await mkdtemp(join(tmpdir(),'r24-asr-test-'));
  t.after(() => rm(path,{recursive:true,force:true}));
  const input = join(path,'input'), output = join(path,'output');
  await mkdir(input);
  const manifest = join(input,'manifest.json'), samples = [];
  for (let i=0;i<count;i++) {
    const id = String.fromCharCode(65+i), bytes=wav(i), file=id+'.wav';
    await writeFile(join(input,file),bytes);
    samples.push({id,file,sha256:hash(bytes)});
  }
  await writeFile(manifest,JSON.stringify({samples}));
  return {input,output,manifest,samples};
}

test('preflight and live upload use the same hashed source and strict multipart form', async t => {
  const {manifest,output} = await setup(t);
  await run({mode:'--prepare',manifest,output,fetchImpl:() => assert.fail('unexpected fetch')});
  let count=0;
  await run({mode:'--live',manifest,output,token:credential,fetchImpl: async (url,options) => {
    count++;
    assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(options.method,'POST'); assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization, 'Bearer '+credential);
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual([...options.body.keys()],['model','language','response_format','file']);
    assert.equal(options.body.get('model'),'gpt-transcribe');
    assert.equal(options.body.get('language'),'zh'); assert.equal(options.body.get('response_format'),'json');
    const file=options.body.get('file'); assert.equal(file.name,'clip.wav'); assert.equal(file.type,'audio/wav');
    assert.deepEqual(Buffer.from(await file.arrayBuffer()),wav(0));
    return Response.json({text:wording,usage:{type:'tokens',input_tokens:20,output_tokens:7,total_tokens:27,
      input_token_details:{audio_tokens:17,text_tokens:3},unknown_field:credential}},{headers:{'x-request-id':'req_r24'}});
  }});
  assert.equal(count,1);
  assert.equal(await readFile(join(output,'transcripts/A.txt'),'utf8'),wording);
  const meta=await json(join(output,'meta/A.json'));
  assert.equal(meta.requestId,'req_r24'); assert.equal(meta.httpStatus,200); assert.equal(meta.returnedModel,null);
  assert.equal(meta.transcriptSha256,hash(wording)); assert.equal(meta.usage.total_tokens,27);
  assert.deepEqual(meta.usage.input_token_details,{audio_tokens:17,text_tokens:3});
  assert.ok(!JSON.stringify(meta).includes(credential)); assert.equal(meta.outcome,'transcribed');
  assert.deepEqual((await readdir(output)).sort(),['meta','preflight.json','provenance.json','transcripts']);
  await assert.rejects(run({mode:'--live',manifest,output,token:credential,fetchImpl:()=>assert.fail()}),/ALREADY_USED/);
});

test('sequential batch; missing usage, duration metering and request ID absence remain explicit', async t => {
  const {manifest,output} = await setup(t,2);
  let count=0, inFlight=false;
  await run({mode:'--live',manifest,output,token:credential,fetchImpl:async (_, {body})=>{
    assert.equal(inFlight,false); inFlight=true; count++;
    const bytes=Buffer.from(await body.get('file').arrayBuffer()); assert.deepEqual(bytes,wav(count-1));
    inFlight=false;
    return Response.json(count===1?{text:wording}:{text:wording,usage:{type:'duration',seconds:2.5}});
  }});
  const a=await json(join(output,'meta/A.json')), b=await json(join(output,'meta/B.json'));
  assert.equal(a.usage,null); assert.equal(a.requestId,null); assert.deepEqual(b.usage,{type:'duration',seconds:2.5});
  const ledger=await json(join(output,'provenance.json')); assert.equal(ledger.attempts,2);
  assert.equal(ledger.retryCount,0); assert.equal(ledger.fallbackCount,0);
});

for (const status of [401,429,500]) test('HTTP '+status+' stops and suppresses provider credential/audio echo', async t => {
  const {manifest,output} = await setup(t,2); let calls=0;
  await assert.rejects(run({mode:'--live',manifest,output,token:credential,fetchImpl:async()=>{
    calls++; return Response.json({error:{code:'test_error',type:'bad_request',message:'PRIVATE_AUDIO '+credential}},
                                  {status,headers:{'x-request-id':'req_err'}});
  }}),/SAMPLE_A_HTTP_FAILURE/);
  assert.equal(calls,1); assert.deepEqual(await readdir(join(output,'transcripts')),[]);
  const raw=await readFile(join(output,'meta/A.json'),'utf8'); assert.ok(!raw.includes('PRIVATE_AUDIO'));
  assert.ok(!raw.includes(credential)); const meta=JSON.parse(raw); assert.equal(meta.httpStatus,status);
  assert.equal(meta.errorCode,'test_error'); assert.equal(meta.requestId,'req_err');
  assert.equal((await json(join(output,'provenance.json'))).outcome,'stopped');
});

test('empty text and echoed credentials are withheld', async t=>{
  for (const text of ['  ',credential,'sk-test00000123456789']) {
    const {manifest,output}=await setup(t);
    await assert.rejects(run({mode:'--live',manifest,output,token:credential,fetchImpl:async()=>Response.json({text})}),/INVALID_RESPONSE/);
    assert.deepEqual(await readdir(join(output,'transcripts')),[]);
  }
});

test('invalid second audio prevents even the first upload', async t=>{
  const {manifest,input,output}=await setup(t,2);
  await writeFile(join(input,'B.wav'),wav(20));
  await assert.rejects(run({mode:'--live',manifest,output,token:credential,fetchImpl:()=>assert.fail()}),/AUDIO_HASH_MISMATCH/);
});

test('rejects oversized, empty, extension mismatch, unsupported, traversal, duplicate and symlinked audio', async t=>{
  const {manifest,input,output,samples}=await setup(t);
  const prepare=() => run({mode:'--prepare',manifest,output,fetchImpl:()=>assert.fail()});
  for (const [file,bytes,err] of [
    ['large.wav',Buffer.alloc(512*1024+1),/AUDIO_SIZE/], ['empty.wav',Buffer.alloc(0),/AUDIO_SIZE/],
    ['wrong.wav',Buffer.from('text'),/FORMAT_MISMATCH/], ['a.docx',wav(0),/UNSUPPORTED/],
    ['wrong.mp3',Buffer.from('fff15080000fffff000000','hex'),/FORMAT_MISMATCH/],
  ]) {
    await writeFile(join(input,file),bytes);
    await writeFile(manifest,JSON.stringify({samples:[{id:'A',file,sha256:hash(bytes)}]}));
    await assert.rejects(prepare,err);
  }
  for(const rows of [[{...samples[0],file:'../A.wav'}],[samples[0],samples[0]]]){
    await writeFile(manifest,JSON.stringify({samples:rows})); await assert.rejects(prepare,/INVALID_SAMPLE/);
  }
  await symlink(join(input,'A.wav'),join(input,'link.wav'));
  await writeFile(manifest,JSON.stringify({samples:[{...samples[0],file:'link.wav'}]})); await assert.rejects(prepare);
});

test('missing credentials, output containing inputs, and foreign output files prevent fetch',async t=>{
  const {manifest,input,output}=await setup(t);
  await assert.rejects(run({mode:'--live',manifest,output,fetchImpl:()=>assert.fail()}),/MISSING_OPENAI_CREDENTIAL/);
  await assert.rejects(run({mode:'--prepare',manifest,output:input}),/OUTPUT_CONTAINS_INPUT/);
  await mkdir(output); await writeFile(join(output,'private-audio.wav'),wav(0));
  await assert.rejects(run({mode:'--live',manifest,output,token:credential,fetchImpl:()=>assert.fail()}),/ALREADY_USED/);
});
