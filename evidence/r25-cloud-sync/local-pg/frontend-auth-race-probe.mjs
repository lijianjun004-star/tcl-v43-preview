/** Real cloud-workflow module; mocked SDK/outbox only. No credentials or cloud calls. */
import assert from 'node:assert/strict';
import {createCloudWorkflow} from '/workspace/tcl-r25-cloud/experiments/r25/tcl-v352-asr-r25-qa/cloud-workflow.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const starts={A:deferred(),B:deferred()},finishes={A:deferred(),B:deferred()};
let nativeUid=null;
const stores=new Map(),sent=[];
const workflow=createCloudWorkflow({config:{enabled:true,envId:'local-only',functionName:'r25wf_api'},
 sdkFactory:async()=>({__r25Auth:{getSession:async()=>nativeUid?{uid:nativeUid}:null,signIn:async uid=>{starts[uid].resolve();await finishes[uid].promise;nativeUid=uid},signOut:async()=>{nativeUid=null}}}),
 operationStoreFactory:({uid})=>{let store=stores.get(uid);if(!store){const rows=new Map();store={rows,get:async id=>rows.get(id),put:async row=>rows.set(row.id,structuredClone(row)),list:async()=>[...rows.values()],close:async()=>{}};stores.set(uid,store)}return store},
 businessTransport:async event=>{if(event.action==='me')return {ok:true,data:{registered:true,user:{uid:nativeUid,role:'anchor',active:true}}};sent.push({sdkActor:nativeUid,event});return {ok:true,data:{receiptId:event.payload.id,submission:{id:event.payload.id,submittedAt:new Date().toISOString(),anchorUid:nativeUid}}}}
});
const a=workflow.signIn('A','synthetic').catch(e=>e);await starts.A.promise;
const b=workflow.signIn('B','synthetic');await starts.B.promise;
finishes.B.resolve();await b;assert.equal(workflow.user.uid,'B');
finishes.A.resolve();const aResult=await a;assert.equal(aResult.code,'STALE_SESSION');assert.equal(nativeUid,'A');assert.equal(workflow.user.uid,'B');
const receipt=await workflow.durableWrite('submissions.create',{id:'synthetic-B-private',snapshot:{turns:[{answer:'synthetic content owned by B'}]}},'synthetic-B-private');
assert.equal(receipt.submission.anchorUid,'A');assert.equal(sent[0].sdkActor,'A');assert.equal(stores.get('B').rows.get('submissions.create:synthetic-B-private').status,'confirmed');
console.log(JSON.stringify({scope:'localSDKmock-auth-race',status:'REPRODUCED',localUser:workflow.user.uid,nativeSdkUser:nativeUid,actualRequestActor:sent[0].sdkActor,payload:sent[0].event.payload,confirmedOutboxOwner:'B',staleSignIn:aResult.code},null,2));
