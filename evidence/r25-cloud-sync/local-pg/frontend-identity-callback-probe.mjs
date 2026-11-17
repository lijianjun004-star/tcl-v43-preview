/** Actual workflow; mocked identity-partition callback delay, no real login. */
import assert from 'node:assert/strict';
import {createCloudWorkflow} from '/workspace/tcl-r25-cloud/experiments/r25/tcl-v352-asr-r25-qa/cloud-workflow.mjs';
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:()=>resolve()}};
const enteredA=deferred(),releaseA=deferred();let nativeUid=null,partition=null;
const workflow=createCloudWorkflow({config:{enabled:true,envId:'local-only',functionName:'rpc'},sdkFactory:async()=>({__r25Auth:{getSession:async()=>nativeUid?{uid:nativeUid}:null,signIn:async uid=>nativeUid=uid,signOut:async()=>nativeUid=null}}),operationStoreFactory:()=>({close:async()=>{}}),businessTransport:async()=>({ok:true,data:{registered:true,user:{uid:nativeUid,role:'anchor',active:true}}}),onIdentityChange:async next=>{if(next?.uid==='A'){enteredA.resolve();await releaseA.promise}partition=next?.uid||null}});
const a=workflow.signIn('A','synthetic');await enteredA.promise;
await workflow.signIn('B','synthetic');assert.equal(partition,'B');releaseA.resolve();await a;
assert.equal(workflow.user.uid,'B');assert.equal(partition,'A');
console.log(JSON.stringify({scope:'localSDKmock-identity-callback',status:'REPRODUCED',localIdentity:workflow.user.uid,lastAppliedPartition:partition},null,2));
