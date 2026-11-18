'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {ENV_ID,prepare,decode,devicePassword,verifyAndApply}=require('../prepare-device-recovery.cjs');
const base={envId:ENV_ID,name:'设备恢复测试',role:'anchor',uid:'exact-original-uid',username:'r25n_'+'a'.repeat(24),nativeMarker:'r25wf-name-v1:'+crypto.randomUUID()};
function fixture(s=base){
 const prepared=prepare(s),calls=[];
 const db={uid:s.uid,name:s.name,role:s.role,active:true,username:s.username,markers:/^r25n_/.test(s.username)?[s.nativeMarker]:[]};
 const native={Uid:s.uid,Name:s.username,Type:'externalUser',UserStatus:'ACTIVE',Description:s.nativeMarker};
 let result=true;
 const manager={database:{executePGSql:async request=>{calls.push({kind:'read-db',request});return {Rows:[JSON.stringify([JSON.stringify(db)])]};}},user:{describeUserList:async request=>{calls.push({kind:'read-native',request});return{Data:{UserList:[native]}};},modifyUser:async request=>{calls.push({kind:'reset',request});return{Data:{Success:result}};}}};
 return {prepared,calls,db,native,manager,setSuccess:v=>{result=v;}};
}
test('portable recovery code derives exact native device credential without altering original UID',()=>{
 const p=prepare(base,{randomBytes:()=>Buffer.alloc(32,0xab)}),body=decode(p.code,base);
 assert.equal(body.deviceKey,'ab'.repeat(32));assert.deepEqual(Object.keys(body).sort(),['version','envId','name','role','uid','username','deviceKey'].sort());
 assert.equal(devicePassword(body.deviceKey),'Aa1!'+crypto.createHash('sha256').update('TCL-R25-device-v1:'+body.deviceKey).digest('hex').slice(0,28));assert.equal(devicePassword(body.deviceKey).length,32);assert.equal(body.uid,base.uid);
});
test('verified management apply targets exactly original UID and password, never other native fields',async()=>{
 const f=fixture();const result=await verifyAndApply({snapshot:base,code:f.prepared.code,manager:f.manager});assert.equal(result.applied,true);assert.equal(result.uid,base.uid);
 const reset=f.calls.filter(x=>x.kind==='reset');assert.equal(reset.length,1);assert.deepEqual(Object.keys(reset[0].request).sort(),['password','uid']);assert.equal(reset[0].request.uid,base.uid);assert.equal(reset[0].request.password,devicePassword(decode(f.prepared.code,base).deviceKey));
 assert.deepEqual(f.calls.find(x=>x.kind==='read-native').request,{uidList:[base.uid],pageNo:1,pageSize:100});
 assert.equal(f.calls.find(x=>x.kind==='read-db').request.Sql.includes(base.name),false,'exact UID base64 data; no name-based lookup');
});
test('any native UID/name/type/status/marker mismatch prevents password reset',async()=>{
 for(const changes of [{Uid:'another-uid'},{Name:'other-login'},{Type:'internalUser'},{UserStatus:'BLOCKED'},{Description:'wrong-marker'}]){
  const f=fixture();Object.assign(f.native,changes);await assert.rejects(verifyAndApply({snapshot:base,code:f.prepared.code,manager:f.manager}),e=>e.code==='NATIVE_IDENTITY_MISMATCH');assert.equal(f.calls.some(x=>x.kind==='reset'),false);
 }
});
test('database UID/profile role/active/name/mapping/marker mismatch prevents native reset',async()=>{
 for(const changes of [{uid:'another-uid'},{role:'admin'},{role:'operator'},{active:false},{name:'其他姓名'},{username:'other-login'},{markers:[]},{markers:[base.nativeMarker,'another']}]){
  const f=fixture();Object.assign(f.db,changes);await assert.rejects(verifyAndApply({snapshot:base,code:f.prepared.code,manager:f.manager}));assert.equal(f.calls.some(x=>x.kind==='reset'),false);
 }
});
test('legacy exact UID/mapping can recover, while admin and unsupported snapshot fields fail closed',async()=>{
 const s={...base,username:'Old.Native',nativeMarker:null},f=fixture(s);assert.equal((await verifyAndApply({snapshot:s,code:f.prepared.code,manager:f.manager})).uid,s.uid);
 const withDescription={...s,nativeMarker:'verified old account description'},fd=fixture(withDescription);assert.equal((await verifyAndApply({snapshot:withDescription,code:fd.prepared.code,manager:fd.manager})).uid,s.uid);
 for(const bad of [{role:'admin'},{envId:'other'},{nativeMarker:null},{username:'r25n_corrupt'},{password:'must-not-accept'},{uid:10}])assert.throws(()=>prepare({...base,...bad}));
});
test('code tampering and unconfirmed reset cannot report successful recovery',async()=>{
 const f=fixture();await assert.rejects(verifyAndApply({snapshot:{...base,uid:'different-uid'},code:f.prepared.code,manager:f.manager}),e=>e.code==='DEVICE_CODE_SNAPSHOT_MISMATCH');assert.equal(f.calls.length,0);
 f.setSuccess(false);await assert.rejects(verifyAndApply({snapshot:base,code:f.prepared.code,manager:f.manager}),e=>e.code==='NATIVE_RECOVERY_UNCONFIRMED');
 assert.throws(()=>decode('R25DEVICE1.bad',base));
});
test('offline CLI has zero network default, creates private files, and emits neither code nor credential',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'r25-device-recovery-')),cli=path.resolve(__dirname,'../prepare-device-recovery.cjs');
 try{
  const before=execFileSync(process.execPath,[cli],{encoding:'utf8'});assert.match(before,/DRY_RUN_ZERO_NETWORK/);
  const input=path.join(root,'snapshot.json'),out=path.join(root,'private');fs.writeFileSync(input,JSON.stringify(base),{mode:0o600});
  const stdout=execFileSync(process.execPath,[cli,'--plan',input,out],{encoding:'utf8'}),code=fs.readFileSync(path.join(out,'recovery-code.txt'),'utf8').trim(),body=decode(code,base);
  for(const secret of [code,body.deviceKey,devicePassword(body.deviceKey)])assert.equal(stdout.includes(secret),false);
  assert.equal(fs.statSync(out).mode&0o777,0o700);for(const file of fs.readdirSync(out)){assert.equal(fs.statSync(path.join(out,file)).mode&0o777,0o600);assert.equal(fs.readFileSync(path.join(out,file),'utf8').includes(devicePassword(body.deviceKey)),false);}
  assert.throws(()=>execFileSync(process.execPath,[cli,'--plan',input,out],{stdio:'pipe'}),'no overwrite');
  assert.throws(()=>execFileSync(process.execPath,[cli,'--apply',out],{stdio:'pipe'}),'no cloud path without explicit verified-applicant flag');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
