// Fixed, synthetic acceptance. It never accepts free-form prompts, a model override, or uploads.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createOpenAIScorer} from './worker.mjs';

const repo = 'lijianjun004-star/tcl-v43-preview';
const ref = 'refs/heads/feat/r24-openai-async-terra';
const endpoint = 'https://api.openai.com/v1/chat/completions';
const model = 'gpt-6.1-terra';
const fixtureHash = '6281ecedc4f4ad171d63c5b16de521dfaf78f2beb8be13c8231b82357beba5d7';
const schemaHash = 'e08ce2888e6ce5cf544caa6da8a9a121307557a5a4c29bc80d0a80ab1be342ec';
const baselineRequests = {
  A:'cfa4831e1879f69c7be9c4d8f3a6787604f630305f24d48e3d763edce0143bfd',
  B:'a02a692f57cfa2aa56dab6098e8ef98e84cb22d82b53832796583d94f941b3c8',
  C:'8bde24e822c823e7fc0a0adef5d9a27d6ab46c05648c50cabbffb6ce7f67c7eb',
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const put = (path, value) => writeFile(path, value, {flag:'wx',mode:0o600});
const json = value => JSON.stringify(value,null,2)+'\n';
const now = () => new Date().toISOString();
const count = n => Number.isSafeInteger(n) && n >= 0 ? n : null;

function assertOldRule(label, url, options) {
  assert.equal(url,endpoint);
  assert.equal(options.method,'POST');
  assert.equal(options.redirect,'error');
  const b=JSON.parse(options.body);
  assert.deepEqual(Object.keys(b).sort(),
    ['max_completion_tokens','messages','model','reasoning_effort','response_format','store','stream']);
  assert.equal(b.model,model);
  assert.equal(b.reasoning_effort,'low');
  assert.equal(b.max_completion_tokens,8192);
  const asOld={model:'gpt-4o-mini',stream:b.stream,store:b.store,response_format:b.response_format,
    max_tokens:1162,messages:b.messages};
  // These digests are the three original, recorded POST bodies from run 45936199747.
  assert.equal(digest(JSON.stringify(asOld)),baselineRequests[label]);
}

function sensitive(text,token) {
  return text.includes(token) || /\b(?:sk[-_][\w*.-]+|Bearer\s+[a-z\d.*_/-]+|github_pat_\w+)/i.test(text);
}

function liveGate(env) {
  return env.GITHUB_ACTIONS==='true' && env.GITHUB_EVENT_NAME==='push' && env.GITHUB_REPOSITORY===repo &&
    env.GITHUB_REF===ref && env.GITHUB_RUN_ATTEMPT==='1' && /^\d+$/.test(env.GITHUB_RUN_ID??'') &&
    /^[0-9a-f]{40}$/.test(env.GITHUB_SHA??'') && env.TERRA_FIRST_PASS==='authorized-synthetic' &&
    typeof env.OPENAI_API_KEY==='string' && env.OPENAI_API_KEY.trim().length>0;
}

async function readProviderBytes(response) {
  if (!response.body) return Buffer.alloc(0);
  const chunks=[];
  let size=0;
  for await (const chunk of response.body) {
    size+=chunk.byteLength;
    if (size>2*1024*1024) throw new Error('RESPONSE_EVIDENCE_LIMIT');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,size);
}

function captureUsage(envelope) {
  const u=envelope?.usage;
  if (!u) return null;
  return {prompt_tokens:count(u.prompt_tokens),completion_tokens:count(u.completion_tokens),
    total_tokens:count(u.total_tokens),reasoning_tokens:count(u.completion_tokens_details?.reasoning_tokens)};
}

async function run(mode,root,env) {
  const live=mode==='--live';
  if (!live && mode!=='--prepare') throw new Error('INVALID_MODE');
  if (live && !liveGate(env)) throw new Error('UNAUTHORIZED_CONTEXT');
  const sourceBytes=await readFile(new URL('./terra-round1.json',import.meta.url));
  assert.equal(digest(sourceBytes),fixtureHash);
  assert.equal(digest(await readFile(new URL('../backend/evaluation-schema.mjs',import.meta.url))),schemaHash);
  const frozen=JSON.parse(sourceBytes);
  await mkdir(root,{recursive:true});
  const start={mode:live?'official-openai':'offline-request-parity',endpoint,requestedModel:model,
    rubricVersion:'r24-evaluation-v1',schemaModuleSha256:schemaHash,fixtureSha256:fixtureHash,
    reasoning_effort:'low',max_completion_tokens:8192,startedAt:now(),retryCount:0,fallbackCount:0,
    sourceCommit:env.GITHUB_SHA??null,runUrl:live?'https://github.com/'+repo+'/actions/runs/'+env.GITHUB_RUN_ID:null};
  await put(join(root,'started.json'),json(start));
  for (const subdir of ['requests','raw','meta','parsed']) await mkdir(join(root,subdir));
  const token=live?env.OPENAI_API_KEY:'offline-comparison-fixture';
  const metaRows=[];
  let shouldStop=false;
  for (const label of Object.keys(baselineRequests)) {
    const meta={sample:label,startedAt:null,endedAt:null,elapsedMs:null,httpStatus:null,requestId:null,
      requestSha256:null,responseSha256:null,rawRedacted:false,requestedModel:model,returnedModel:null,
      usage:null,outcome:'not_sent',providerCalls:0,retries:0,baselineRequestSha256:baselineRequests[label]};
    metaRows.push(meta);
    if (shouldStop) {
      await put(join(root,'meta',label+'.json'),json(meta));
      continue;
    }
    let intercepted=false;
    const begin=performance.now();
    meta.startedAt=now();
    try {
      const score=createOpenAIScorer(token,{timeoutMs:90000,async fetchImpl(url,options) {
        if (intercepted) throw new Error('SECOND_ATTEMPT_FORBIDDEN');
        assertOldRule(label,url,options);
        intercepted=true;
        if(sensitive(options.body,token)) throw new Error('REQUEST_EVIDENCE_REJECTED');
        await put(join(root,'requests',label+'.json'),options.body);
        meta.requestSha256=digest(options.body);
        if (!live) return new Response(null,{status:418});
        meta.providerCalls=1;
        meta.outcome='request_sent_no_response';
        const response=await fetch(url,options);
        meta.httpStatus=response.status;
        const header=response.headers.get('x-request-id');
        if (header && /^[\w-]{1,150}$/.test(header) && !sensitive(header,token)) meta.requestId=header;
        const bytes=await readProviderBytes(response);
        const text=bytes.toString('utf8');
        let envelope=null;
        try {envelope=JSON.parse(text);} catch {}
        // Authentication errors can echo a partially masked key. Preserve status and error code only.
        const unsafe=response.status===401 || envelope?.error?.code==='invalid_api_key' ||
          sensitive(text,token) || (envelope && sensitive(JSON.stringify(envelope),token));
        meta.rawRedacted=!!unsafe;
        const file=unsafe?Buffer.from(json({redacted:true,status:response.status,
          error:response.status===401?'authentication-error':'credential-pattern'})):bytes;
        await put(join(root,'raw',label+'.body'),file);
        meta.responseSha256=digest(file);
        if (!unsafe) {
          meta.usage=captureUsage(envelope);
          if (typeof envelope?.model==='string' && /^[a-zA-Z0-9._-]{1,100}$/.test(envelope.model))
            meta.returnedModel=envelope.model;
        }
        meta.outcome=unsafe?'redacted_response':response.ok?'invalid_response':'http_error';
        // Return a fresh Response because we already consumed the exact upstream bytes.
        return new Response(file,{status:response.status,headers:response.headers});
      }});
      const result=await score([{question:frozen.question,referenceAnswer:frozen.answer,keyPoints:frozen.points,
        answerText:frozen.samples[label]}]);
      await put(join(root,'parsed',label+'.json'),json(result));
      meta.outcome='valid_response';
    } catch {
      if (!live && intercepted && meta.requestSha256) meta.outcome='offline_body_verified';
      else if (!intercepted || !meta.requestSha256) {meta.outcome='preflight_failed'; shouldStop=true;}
      else if (meta.httpStatus!==200 || meta.rawRedacted) shouldStop=true;
    } finally {
      meta.endedAt=now(); meta.elapsedMs=Math.round(performance.now()-begin);
      await put(join(root,'meta',label+'.json'),json(meta));
    }
  }
  const summary={...start,endedAt:now(),providerCalls:metaRows.reduce((n,m)=>n+m.providerCalls,0),samples:metaRows};
  await put(join(root,'first-pass.json'),json(summary));
  const expected=live?'valid_response':'offline_body_verified';
  // Semantic errors remain visible. Technical failures fail CI after preserving the evidence.
  if (metaRows.some(m=>m.outcome!==expected)) throw new Error('TECHNICAL_ACCEPTANCE_INCOMPLETE');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const [mode,dir,...other]=process.argv.slice(2);
  if (!dir || other.length) process.exitCode=2;
  else run(mode,resolve(dir),process.env).catch(()=>{console.error('Fixed first pass stopped; inspect the evidence artifact.');process.exitCode=1;});
}
