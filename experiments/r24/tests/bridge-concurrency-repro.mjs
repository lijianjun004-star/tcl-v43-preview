/** Actual historical bridge vs current source. Audio decode is a synthetic fixture. */
import fs from 'node:fs';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
const root=new URL('../../../',import.meta.url);
const file='experiments/r24/tcl-v352-asr-r24-qa/whisper-bridge.mjs';
const baseline='d4d8057f74d93be897b1bb034b3e1d348c9e7562';
class Context{decodeAudioData(_,done){const p={duration:1,length:16000,numberOfChannels:1,sampleRate:16000};done(p);return Promise.resolve(p);}close(){return Promise.resolve();}}
class Offline{createBufferSource(){return {buffer:null,connect(){},start(){}};}startRendering(){return Promise.resolve({getChannelData:()=>new Float32Array(16000).fill(.1)});}}
globalThis.AudioContext=Context;globalThis.OfflineAudioContext=Offline;
const old=execFileSync('git',['show',`${baseline}:${file}`],{cwd:root,encoding:'utf8'});
const current=fs.readFileSync(new URL(file,root),'utf8');
const results=[];
for(const [version,source] of [['baseline',old],['candidate',current]]){
 const {createLocalWhisper}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 let active=0,maxActive=0,calls=0,loads=0;
 const engine=createLocalWhisper({pipelineFactory:async()=>{loads++;return async()=>{active++;maxActive=Math.max(maxActive,active);calls++;await new Promise(r=>setTimeout(r,15));active--;return{text:'mock'};};}});
 await Promise.all([1,2,3].map(()=>engine(new Blob(['synthetic bytes']))));
 results.push({version,source_sha256:crypto.createHash('sha256').update(source).digest('hex'),loads,calls,max_concurrent_inferences:maxActive,status:maxActive===1?'PASS':'FAIL_REPRODUCED'});
}
const report={scope:'Actual exported bridge and 3 simultaneous callers; model/decode are deterministic mocks, no real speech accuracy claim',baseline_commit:baseline,results};
fs.mkdirSync(new URL('evidence/r24-delivery/audio/',root),{recursive:true});
fs.writeFileSync(new URL('evidence/r24-delivery/audio/concurrency-before-after.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(results[0].max_concurrent_inferences!==2||results[1].max_concurrent_inferences!==1)process.exitCode=1;
