// Production progress callback + ownership predicate, simulated notifications/time.
// This measures UI callback suppression, not model inference or network speed.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const app=readFileSync(new URL('../tcl-v352-asr-r24-qa/app.js',import.meta.url),'utf8');
const sha=createHash('sha256').update(app).digest('hex');
const start=app.indexOf('const asrDiagnostics=[];'),end=app.indexOf('function r6WhisperCancelAll(',start);
assert(start>=0&&end>start);
let clock=1000,id=0,renders=[],timers=new Map(),onProgress;
const blob={},task={turnId:'synthetic-turn',runId:'synthetic-run',boardId:'01',platform:'京东',cancelSeq:0,audioRevision:1,blob};
const turn={id:task.turnId,runId:task.runId,boardId:task.boardId,platform:task.platform,audioRevision:1};
const ctx={globalThis:null,Date,JSON,URL,Blob,Math,performance:{now:()=>clock},ELEM:()=>null,readR23ModelPreference:()=> 'base',sessionTurns:[turn],runId:task.runId,perQuestionAudio:new Map([[turn.id,blob]]),isRunPage:()=>true,reviewParked:false,renderTurnStatus:t=>renders.push({at:clock,status:t.asrStatus}),createLocalWhisper:options=>{onProgress=options.onProgress;return {}},setTimeout:(fn,ms)=>{timers.set(++id,{fn,at:clock+ms});return id},clearTimeout:i=>timers.delete(i)};
ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(app.slice(start,end),ctx);ctx.syntheticTask=task;vm.runInContext('r6WhisperQueue.push(syntheticTask)',ctx);
function advance(ms){clock+=ms;for(const [i,t]of [...timers])if(t.at<=clock){timers.delete(i);t.fn();}}
const checks={};
onProgress('加载多语言 Whisper Base 模型（人工事件，不请求网络）');assert.equal(renders.length,1);checks.load_message_immediate=true;
renders=[];
for(let i=0;i<1195;i++){onProgress(`下载模型：${i+1}/1195 字节 · ${Math.floor((i+1)/1195*100)}%`);advance(1);}
advance(150);const downloadRenders=renders.length;
assert(downloadRenders>0&&downloadRenders<=10,{downloadRenders});assert(renders.at(-1).status.includes('100%'));checks.download_1195_events_coalesced=true;
const beforeTerminal=renders.length;onProgress('模型就绪，正在当前浏览器执行中文语音识别');assert.equal(renders.length,beforeTerminal+1);assert.equal(timers.size,0);checks.ready_message_immediate=true;
onProgress('下载模型：1/100 字节 · 1%');const beforeCancel=renders.length;ctx.runId='new-synthetic-run';advance(200);assert.equal(renders.length,beforeCancel);checks.stale_owner_does_not_render=true;
ctx.runId=task.runId;onProgress('下载模型：2/100 字节 · 2%');onProgress('下载模型：3/100 字节 · 3%');const beforeError=renders.length;onProgress('主源连接失败，正在切换备用镜像加载 Whisper 模型…');assert.equal(renders.length,beforeError+1);assert.equal(timers.size,0);checks.non_download_error_message_immediate=true;
const report={status:'PASS',mode:'Actual app createLocalWhisper onProgress and r6WhisperValid evaluated in Node VM; synthetic notifications and fake clock; no model/network call',app_sha256:sha,source_unchanged:createHash('sha256').update(readFileSync(new URL('../tcl-v352-asr-r24-qa/app.js',import.meta.url))).digest('hex')===sha,input_download_events:1195,rendered_download_updates:downloadRenders,checks};
assert(report.source_unchanged);
const out=resolve(process.env.R24_PROGRESS_OUT||'evidence/r24-performance/progress');mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
