import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createCloudWorkflow} from '/workspace/tcl-r25-name-login/experiments/r25/tcl-v352-asr-r25-qa/cloud-workflow.mjs';
let nativeUid=null,resolveMe,meStarted;
const started=new Promise(resolve=>meStarted=resolve),applied=[];
const client=createCloudWorkflow({config:{enabled:true,envId:'mock-env',functionName:'r25wf_api'},
 nameIdentity:{resolve:async()=>({state:'ready',username:'native-A',uid:'A'})},
 sdkFactory:async()=>({__r25Auth:{signIn:async()=>{nativeUid='A';},getSession:async()=>({uid:nativeUid}),signOut:async()=>{nativeUid=null;}}}),
 operationStoreFactory:()=>({close:async()=>{},get:async()=>null,put:async()=>{},list:async()=>[]}),
 onIdentityChange:async identity=>{applied.push(identity?.uid||null);},
 businessTransport:async event=>{assert.equal(event.action,'me');assert.equal(event.payload.expectedActorUid,'A');meStarted();return new Promise(resolve=>resolveMe=resolve);}
});
const task=client.signIn('主播A','not-logged');await started;
nativeUid='B'; // Another tab signs in after the me request was authorized as A.
resolveMe({ok:true,data:{user:{uid:'A',displayName:'主播A',role:'anchor'},capabilities:{privateMedia:false}}});
let status,error;try{await task;status='resolved';}catch(e){status='rejected';error={code:e.code,message:e.message};}
const root='/workspace/tcl-r25-name-login/experiments/r25/tcl-v352-asr-r25-qa';
const result={scope:'Local mock official adapter and business reply. No cloud request or product mutation.',status,error,nativeUid,workflowUid:client.user?.uid||null,appliedIdentities:applied,wrongIdentityInstalled:nativeUid!==client.user?.uid&&!!client.user,sha256:Object.fromEntries(['name-identity.mjs','cloud-workflow.mjs','cloud-workspace.mjs','app.js'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(root+'/'+file)).digest('hex')]))};
fs.writeFileSync('/workspace/r25-name-frontend-audit/post-me-drift-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
assert.equal(result.wrongIdentityInstalled,true,'reproduction should demonstrate mismatch');
