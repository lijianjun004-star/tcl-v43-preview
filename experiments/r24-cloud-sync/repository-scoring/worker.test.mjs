import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {evaluationInstructions, evaluationResponseFormat} from '../backend/evaluation-schema.mjs';
import {createOpenAIScorer,processOne} from './worker.mjs';

const jobId = 'a'.repeat(64);
const lease = randomUUID();
const answer = '仅供源库合成回答';
const comment = '仅供源库核对的建议';
const input = [{question:'顾客的合成问题',referenceAnswer:'合成参考话术',keyPoints:['询问尺寸','核对资料'],answerText:answer}];
const item = {questionIndex:0,score:75,matchedPoints:['核对资料'],missedPoints:['询问尺寸'],comment,suggestedScript:'请告诉我具体尺寸。'};
const scoring = {overallScore:75,grade:'良好',items:[item]};
const existing = {...scoring,model:'hy3',source:'cloudbase_hunyuan'};
const openai = {...scoring,model:'gpt-4o-mini-2024-07-18',source:'openai_offline',usage:{total_tokens:140}};
const archived = {status:'archived'};
const mockLease = () => randomUUID();

function harness(extras={}) {
  const events = [], archives = [];
  let state = 'ready', evaluation = extras.existingEvaluation ?? null, receipt = null, saved = null;
  const queue = {
    claim:async() => {
      events.push('claim');
      if (state === 'ready') return {jobId,state,items:input,existingEvaluation:evaluation};
      if (state === 'scored') return {jobId,state,receipt:structuredClone(receipt)};
      return null;
    },
    startAttempt:async () => {
      events.push('start');
      if (state !== 'ready') return false;
      state='attempting'; return true;
    },
    saveResult:async (id,owner,result,redacted) => {
      assert.equal(id,jobId); assert.match(owner,/^[\da-f-]{36}$/);
      assert.equal(evaluation ? state==='ready' : state==='attempting',true);
      events.push('save'); state='scored'; saved=result; receipt=structuredClone(redacted); return true;
    },
    ack:async () => {events.push('ack'); state='done'; return true;},
    hold:async (_,__,reason) => {events.push('hold:'+reason); state='held';return true;},
  };
  const deps = {queue,lease,score:async () => {events.push('openai'); return openai;},
    archive:async r => {events.push('archive');archives.push(r);return archived;}};
  return {events,archives,deps,stored:()=>saved,getReceipt:()=>receipt,
    scoreCount:()=>events.filter(e=>e==='openai').length,
    tamper:(r)=>{receipt=r;state='scored';}, status:()=>state};
}

test('existing frozen evaluation is archived without invoking or reserving OpenAI',async()=>{
  const h=harness({existingEvaluation:existing});
  assert.deepEqual(await processOne(h.deps),{status:'archived'});
  assert.deepEqual(h.events,['claim','save','archive','ack']);
  const receipt=h.archives[0];
  assert.deepEqual(receipt,{schemaVersion:1,jobId,origin:'submission',model:'hy3',overallScore:75,grade:'良好',
    items:[{questionIndex:0,score:75,matched:[2],missed:[1]}],reviewStatus:'pending_review'});
  for(const text of [answer,comment,input[0].question,input[0].referenceAnswer,...input[0].keyPoints,item.suggestedScript]) {
    assert.ok(!JSON.stringify(receipt).includes(text));
  }
  assert.equal(h.stored().items[0].comment,comment);
  assert.deepEqual(await processOne(h.deps),{status:'empty'});
});

test('new score reserves a single attempt, stores feedback privately before archiving numeric indices',async()=>{
  const h=harness();
  assert.deepEqual(await processOne(h.deps),{status:'archived'});
  assert.deepEqual(h.events,['claim','start','openai','save','archive','ack']);
  assert.equal(h.archives[0].model,'gpt-4o-mini'); assert.equal(h.archives[0].origin,'openai_review');
  assert.equal(h.stored().items[0].suggestedScript,item.suggestedScript);
  assert.deepEqual(h.stored().usage,{total_tokens:140});
});

test('the one-way atomic guard rejects a competing worker before calling the model',async()=>{
  const h=harness();
  const both=await Promise.all([processOne(h.deps),processOne({...h.deps,lease:mockLease()})]);
  assert.equal(h.scoreCount(),1);
  assert.deepEqual(both.map(r=>r.status).sort(),['archived','lease_lost']);
});

test('provider errors and invalid responses enter hold without reattempt or raw error disclosure',async()=>{
  for (const result of [null,{...openai,model:'freeform-private-name'}, {...openai,overallScore:72}]) {
    const h=harness(); let calls=0;
    h.deps.score=async()=>{calls++;if (!result) throw new Error(answer);return result;};
    assert.deepEqual(await processOne(h.deps),{status:'held'}); assert.equal(calls,1);
    assert.equal(h.status(),'held'); assert.ok(!h.events.join().includes(answer)); assert.deepEqual(h.archives,[]);
    assert.deepEqual(await processOne(h.deps),{status:'empty'}); assert.equal(calls,1);
  }
});

test('bad inputs and bad original scores never fall back to paying for fresh scores',async()=>{
  const h=harness({existingEvaluation:{...existing,model:'unknown'}}); assert.deepEqual(await processOne(h.deps),{status:'held'});
  assert.equal(h.scoreCount(),0); assert.ok(!h.events.includes('start'));
  const invalid=harness();invalid.deps.queue.claim=async()=>({jobId,state:'ready',items:[{question:'only a question'}]});
  assert.deepEqual(await processOne(invalid.deps),{status:'held'}); assert.deepEqual(invalid.events,['hold:invalid_input']);
});

test('if archiving fails, the next claim only archives the durable receipt',async()=>{
  const h=harness(); const archive=h.deps.archive;
  h.deps.archive=async()=>{throw new Error(answer);};
  assert.deepEqual(await processOne(h.deps),{status:'archive_pending'});
  assert.equal(h.status(),'scored');assert.ok(!h.events.includes('ack'));
  h.deps.archive=archive;
  assert.deepEqual(await processOne({...h.deps,lease:mockLease()}),{status:'archived'});assert.equal(h.scoreCount(),1);
});

test('ack uncertainty retries identical receipt idempotently and never re-scores',async()=>{
  const h=harness(); const ack=h.deps.queue.ack;
  h.deps.queue.ack=async()=>{throw new Error(answer);};
  assert.deepEqual(await processOne(h.deps),{status:'ack_pending'}); assert.equal(h.scoreCount(),1);
  h.deps.queue.ack=ack;
  h.deps.archive=async r=>{assert.deepEqual(r,h.archives[0]);return {status:'already_archived'};};
  assert.deepEqual(await processOne({...h.deps,lease:mockLease()}),{status:'archived'}); assert.equal(h.scoreCount(),1);
});

test('invalid receipt, extra private fields, nonexhaustive points or another job never reach archive',async()=>{
  const source=harness(); await processOne(source.deps);
  const receipt=source.getReceipt();
  for(const altered of [
    {...receipt,jobId:'b'.repeat(64)}, {...receipt,extra:answer},
    {...receipt,items:[{...receipt.items[0],missed:[3]}]},
    {...receipt,model:'private-name'}, {...receipt,reviewStatus:'published'},
  ]) {
    const h=harness();h.tamper(altered);
    assert.deepEqual(await processOne(h.deps),{status:'held'});assert.equal(h.scoreCount(),0);
    assert.deepEqual(h.archives,[]);
  }
});

test('save and claim exceptions redact raw diagnostics; false reservation and false save never archive',async()=>{
  const h=harness(); h.deps.queue.claim=async()=>{throw new Error(answer);};
  await assert.rejects(processOne(h.deps),{message:'QUEUE_CLAIM_UNCONFIRMED'});
  const start=harness();start.deps.queue.startAttempt=async()=>false;
  assert.deepEqual(await processOne(start.deps),{status:'lease_lost'});assert.equal(start.scoreCount(),0);
  const saved=harness();saved.deps.queue.saveResult=async()=>false;
  assert.deepEqual(await processOne(saved.deps),{status:'lease_lost'});assert.deepEqual(saved.archives,[]);
  const ambiguous=harness();ambiguous.deps.queue.saveResult=async()=>{throw new Error(answer);};
  await assert.rejects(processOne(ambiguous.deps),{message:'QUEUE_SAVE_UNCONFIRMED'});assert.equal(ambiguous.scoreCount(),1);
  assert.deepEqual(await processOne(ambiguous.deps),{status:'empty'});
});

const fakeCredential='synthetic-openai-credential-long';
function validEnvelope(result=scoring) {
  return {object:'chat.completion',model:'gpt-4o-mini-2024-07-18',
    choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(result)}}],
    usage:{prompt_tokens:301,completion_tokens:66,total_tokens:367,extra:'private'}};
}

test('official request uses only the fixed rubric, original sample, strict format and least metadata',async()=>{
  let called=0;
  const score=createOpenAIScorer(fakeCredential,{fetchImpl:async(url,opts)=>{
    called++;assert.equal(url,'https://api.openai.com/v1/chat/completions');
    assert.equal(opts.method,'POST');assert.equal(opts.redirect,'error');assert.ok(opts.signal instanceof AbortSignal);
    assert.deepEqual(opts.headers,{'Content-Type':'application/json',Authorization:'Bearer '+fakeCredential});
    assert.deepEqual(JSON.parse(opts.body),{model:'gpt-4o-mini',store:false,stream:false,response_format:evaluationResponseFormat,
      max_tokens:1162,messages:[{role:'system',content:evaluationInstructions},{role:'user',content:JSON.stringify([{questionIndex:0,...input[0]}])}]});
    return Response.json(validEnvelope(),{headers:{'x-request-id':'req_synthetic'}});
  }});
  const out=await score(input);assert.equal(called,1); assert.deepEqual(out.items,scoring.items); assert.equal(out.model,'gpt-4o-mini');
  assert.deepEqual(out.usage,{prompt_tokens:301,completion_tokens:66,total_tokens:367});assert.equal(out.requestId,'req_synthetic');
  assert.ok(Number.isInteger(out.elapsedMs));
});

test('denied, limited, malformed, oversized, role/tool refusal and credential echoes stop once with sanitized errors',async()=>{
  const good=validEnvelope();
  for(const make of [
    ()=>Response.json({error:{message:fakeCredential}},{status:401}),()=>Response.json({error:{message:answer}},{status:429}),
    ()=>new Response('non-json '+answer),()=>new Response('x'.repeat(256*1024+1)),()=>Response.json({...good,model:'gpt-4o'}),
    ()=>Response.json({...good,choices:[{finish_reason:'stop',message:{role:'tool',content:'{}'}}]}),
    ()=>Response.json({...good,choices:[{finish_reason:'stop',message:{role:'assistant',content:'{}',refusal:'refused'}}]}),
    ()=>Response.json(validEnvelope({...scoring,items:[{...item,comment:fakeCredential}]})),
  ]) {
    let calls=0;
    const score=createOpenAIScorer(fakeCredential,{fetchImpl:async()=>{calls++;return make();}});
    await assert.rejects(score(input),{message:'OPENAI_REVIEW_UNCONFIRMED'});assert.equal(calls,1);
  }
});

test('missing OpenAI credentials only defer fresh scores; persisted and original scores still archive',async()=>{
  const pending=harness();pending.deps.score=null;
  assert.deepEqual(await processOne(pending.deps),{status:'needs_model'});
  assert.deepEqual(pending.events,['claim']);assert.equal(pending.status(),'ready');
  const original=harness({existingEvaluation:existing});original.deps.score=null;
  assert.deepEqual(await processOne(original.deps),{status:'archived'});
  const scored=harness();scored.tamper(original.getReceipt());scored.deps.score=undefined;
  assert.deepEqual(await processOne(scored.deps),{status:'archived'});
  assert.deepEqual(scored.events,['claim','archive','ack']);
});
