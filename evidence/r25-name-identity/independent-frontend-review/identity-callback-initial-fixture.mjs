import fs from 'node:fs';import vm from 'node:vm';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {createCloudWorkflow} from '/workspace/tcl-r25-name-login/experiments/r25/tcl-v352-asr-r25-qa/cloud-workflow.mjs';
const root='/workspace/tcl-r25-name-login/experiments/r25/tcl-v352-asr-r25-qa',app=fs.readFileSync(root+'/app.js','utf8');
const from=app.indexOf('function currentCloudCheckpointReady(){'),to=app.indexOf('async function initializeCloudWorkflow()',from);assert.ok(from>=0&&to>from);
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const results=[];
for(const phase of ['db-read','checkpoint-read'])for(const event of [false,true]){
 let nativeUid=null,listener;const reached=deferred(),release=deferred(),renders=[],errors=[];
 const context=vm.createContext({console,Promise,Error,Object,Map,document:{getElementById:()=>({})},localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
  cloudPartitionName:(env,uid)=>env+':'+uid,cloudbaseConfig:{envId:'env'},localDB:null,localPartitionName:'signed-out',userName:'',userRole:'',memoryFallback:false,
  checkpointCursor:{key:'',known:false},draftKey:uid=>'draft:'+uid,saveCurrentTypedAnswer:()=>{},persistSessionCheckpoint:async()=>false,checkpointWriteChain:Promise.resolve(),
  restoreSessionEpoch:0,savedSessionCandidate:null,cloudTrainingAttempts:new Map(),cloudWorkspace:{invalidate:()=>{}},invalidateImportPreview:()=>{},uploadedFileName:'',librarySearch:'',assignmentSearch:'',cloud:{},
  resetRunState:()=>{},stopScene:()=>{},discardVideoArchive:()=>{},lastSessionSnapshot:null,lastTrainingLogId:'',activeAssignmentId:'',memStores:{},localEntries:[],localRecords:[],localAssignments:[],localAssignmentJoins:[],localTrainingLogs:[],localSubmissions:[],
  dbOpen:async()=>({close:()=>{}}),dbAll:async store=>{if(store==='records'&&nativeUid==='A'&&phase==='db-read'){reached.resolve();await release.promise;}return store==='records'?[{id:'A-private',answer:'A-private answer'}]:[];},
  loadPrefs:async()=>[],prefGet:(prefs,key,fallback)=>fallback,barrageIntervalMs:60000,pendingRole:'',page:'home',asrGlossary:null,parseDocumentFile:()=>{},r6WhisperRunning:false,oneShotAsrJob:null,transcriptBusy:false,speechRecognizer:null,
  initGlossaryUI:()=>({destroy:()=>{}}),updateMode:()=>{},render:()=>{renders.push({userName:context.userName,records:context.localRecords});},
  findSavedSession:async()=>{if(nativeUid==='A'&&phase==='checkpoint-read'){reached.resolve();await release.promise;}context.checkpointCursor={key:'draft:'+context.userName,known:true};}
 });vm.runInContext(app.slice(from,to),context);
 const client=createCloudWorkflow({config:{enabled:true,envId:'env',functionName:'r25wf_api'},nameIdentity:{resolve:async()=>({state:'ready',username:'native-A',uid:'A'})},sdkFactory:async()=>({__r25Auth:{getSession:async()=>nativeUid?{uid:nativeUid}:null,signIn:async()=>{nativeUid='A';},signOut:async()=>{nativeUid=null;},subscribe:callback=>{listener=callback;return()=>{};}}}),operationStoreFactory:()=>({close:async()=>{}}),onIdentityChange:context.loadCloudLocalPartition,businessTransport:async()=>({ok:true,data:{user:{uid:'A',role:'anchor',displayName:'甲'},capabilities:{privateMedia:false}}})});context.cloudWorkflow=client;
 await client.initialize(); // Ensures auth events are enabled, as in an initialized application.
 const task=client.signIn('甲','unchanged-password').catch(error=>{errors.push({code:error.code,message:error.message});});await reached.promise;
 nativeUid='B';if(event)listener('SIGNED_IN',{uid:'B'});release.resolve();await task;
 assert.equal(client.user,null);assert.equal(renders.some(row=>row.userName==='A'),false);assert.equal(context.userName,'');assert.equal(context.localRecords.some(row=>row.id==='A-private'),false);
 assert.ok(errors.some(row=>row.code==='STALE_SESSION'));
 results.push({phase,event,status:'PASS',nativeUid,workflowUid:client.user?.uid||null,finalLocalUser:context.userName,renderedA:renders.some(row=>row.userName==='A'),errors});
}
const result={scope:'Actual app partition/checkpoint functions and workflow with synthetic IDB/Auth/PG; no cloud or product writes.',status:'PASS',cases:results,sha256:Object.fromEntries(['name-identity.mjs','cloud-workflow.mjs','cloud-workspace.mjs','app.js'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(root+'/'+file)).digest('hex')]))};fs.writeFileSync('/workspace/r25-name-frontend-audit/identity-callback-after-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
