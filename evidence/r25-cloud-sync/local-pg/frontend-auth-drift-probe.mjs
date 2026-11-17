/** Preflight/request race in current workflow. Actual module, synthetic SDK session switch. */
import assert from 'node:assert/strict';
import {createCloudWorkflow} from '/workspace/tcl-r25-cloud/experiments/r25/tcl-v352-asr-r25-qa/cloud-workflow.mjs';
let nativeUid='B',armed=false;const sent=[],rows=new Map();
const workflow=createCloudWorkflow({config:{enabled:true,envId:'local-only',functionName:'r25wf_api'},
 sdkFactory:async()=>({__r25Auth:{getSession:async()=>{const uid=nativeUid;if(armed){armed=false;queueMicrotask(()=>nativeUid='A')}return {uid}},signIn:async uid=>nativeUid=uid,signOut:async()=>nativeUid=null}}),
 operationStoreFactory:()=>({get:async id=>rows.get(id),put:async row=>rows.set(row.id,structuredClone(row)),close:async()=>{},list:async()=>[...rows.values()]}),
 businessTransport:async event=>{if(event.action==='me')return{ok:true,data:{registered:true,user:{uid:nativeUid,role:'anchor',active:true}}};sent.push({actor:nativeUid,payload:event.payload});return{ok:true,data:{receiptId:event.payload.id,submission:{id:event.payload.id,submittedAt:'synthetic',anchorUid:nativeUid}}}}
});
await workflow.initialize();assert.equal(workflow.user.uid,'B');armed=true;
let error;try{await workflow.durableWrite('submissions.create',{id:'B-private',snapshot:{turns:[{answer:'B synthetic private content'}]}},'B-private')}catch(e){error=e}
assert.equal(sent[0].actor,'A');assert.equal(error.code,'STALE_SESSION');
console.log(JSON.stringify({scope:'localSDKmock-preflight-race',status:'REPRODUCED',requestAlreadySent:sent[0],laterClientError:error.code,localOutboxStatus:rows.get('submissions.create:B-private').status},null,2));
