import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudWorkflow} from '../tcl-v352-asr-r25-qa/cloud-workflow.mjs';
function fixture(result,profileRole){
 let uid=null;const registers=[],auth=[];
 const client=createCloudWorkflow({config:{enabled:true,envId:'test',functionName:'api'},nameIdentity:{register:async v=>{registers.push(v);return result;}},
 sdkFactory:async()=>({__r25Auth:{signIn:async(name,password)=>{auth.push({name,password});uid='original-uid';},getSession:async()=>uid?{uid}:null}}),
 operationStoreFactory:()=>({close:async()=>{}}),businessTransport:async()=>({ok:true,data:{user:{uid:'original-uid',role:profileRole,displayName:'原姓名'}}})});
 return{client,registers,auth};
}
test('operator choice reaches registration and native profile must match it',async()=>{
 const f=fixture({username:'opaque',uid:'original-uid'},'operator');await f.client.register({name:'运营甲',password:'Abc12345',role:'operator'});
 assert.deepEqual(f.registers,[{name:'运营甲',password:'Abc12345',role:'operator'}]);assert.equal(f.client.user.role,'operator');assert.equal(f.auth.length,1);
 const wrong=fixture({username:'opaque',uid:'original-uid'},'anchor');await assert.rejects(wrong.client.register({name:'运营甲',password:'Abc12345',role:'operator'}),e=>e.code==='IDENTITY_MISMATCH');assert.equal(wrong.client.user,null);
});
test('legacy recovery preserves backend original role despite different new UI choice',async()=>{
 const f=fixture({username:'opaque',uid:'original-uid',role:'operator',legacyRecovery:true},'operator');
 await f.client.register({name:'原姓名',password:'Abc12345',role:'anchor'});assert.equal(f.client.user.role,'operator');assert.equal(f.client.user.uid,'original-uid');
});
test('admin signup rejected before identity broker or native auth',async()=>{
 const f=fixture({},'admin');await assert.rejects(f.client.register({name:'管理员',password:'Abc12345',role:'admin'}),e=>e.code==='INVALID_ROLE');assert.equal(f.registers.length,0);assert.equal(f.auth.length,0);
});
