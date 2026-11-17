'use strict';
// Public boundary. Passwords exist only in request memory and the official Auth
// create call. Do not add console/request-body/error-object logging here.
const crypto=require('node:crypto');
const {createProvider}=require('./provider-cloudbase.cjs');
class IdentityError extends Error {
 constructor(code,message){super(message);this.name='IdentityError';this.code=code;}
}
const fail=(code,message)=>{throw new IdentityError(code,message);};
const digest=(algorithm,value)=>crypto.createHash(algorithm).update(value,'utf8').digest('hex');
const nativeName=/^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$/;
function normalizeName(value,{legacy=false}={}){
 if(typeof value!=='string')fail('INVALID_NAME','请填写姓名');
 const name=value.normalize('NFKC').trim();
 const limit=legacy&&nativeName.test(name)?64:40;
 if(!name||[...name].length>limit||/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(name))fail('INVALID_NAME','姓名须1至40字，不得包含隐藏控制字符');
 return name;
}
function operation(body){
 if(typeof body.operationId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(body.operationId))fail('INVALID_REQUEST','缺少原开户操作编号');
 if(typeof body.operationSecret!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(body.operationSecret))fail('INVALID_REQUEST','缺少原设备保存的开户凭据');
 return {operationId:body.operationId,operationProof:digest('sha256',body.operationSecret)};
}
function checkedPassword(value){
 const kinds=typeof value==='string'?[ /[a-z]/, /[A-Z]/, /[0-9]/, /[()!@#$%^&*|?><_-]/ ].filter(pattern=>pattern.test(value)).length:0;
 if(typeof value!=='string'||value.length<8||value.length>32||!/^[A-Za-z0-9]/.test(value)||kinds<3||/[\u0000-\u001f\u007f]/u.test(value))fail('INVALID_PASSWORD','首次密码须8至32位，首位为字母或数字，并含大写、小写、数字、指定符号中至少三类；建议大小写字母加数字');
 return value;
}
function publicReady(row){
 if(row?.state!=='ready'||typeof row.username!=='string'||!row.username||typeof row.uid!=='string'||!row.uid)fail('PROVIDER_UNAVAILABLE','开户状态尚未确认完成，请重试原尝试');
 return {state:'ready',username:row.username,uid:row.uid,displayName:row.displayName||'',...(['anchor','operator'].includes(row.role)?{role:row.role}:{})};
}
function createIdentityService({provider=createProvider()}={}){
 async function db(action,payload){
  let reply;try{reply=await provider.dbCall(action,payload);}catch{fail('PROVIDER_UNAVAILABLE','身份服务暂不可用，请保留原尝试后重试');}
  if(!reply||reply.ok!==true){
   const e=reply?.error;
   if(e&&typeof e.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(e.code)&&typeof e.message==='string')throw new IdentityError(e.code,e.message.slice(0,180));
   fail('PROVIDER_UNAVAILABLE','身份服务未确认完成，请重试原尝试');
  }
  return reply.data;
 }
 async function find(username){
  let user;try{user=await provider.findNativeUser(username);}catch{fail('PROVIDER_UNAVAILABLE','官方账号服务暂不可用，请保留原尝试后重试');}
  if(!user)return null;
  if(user.username!==username||typeof user.uid!=='string'||!user.uid)fail('NATIVE_IDENTITY_CONFLICT','官方账号核对结果不一致，未绑定任何角色');
  if(user.status!=='ACTIVE')fail('ACCOUNT_DISABLED','账号已停用，请联系管理员');
  return user;
 }
 async function recoverNative(row){
  const user=await find(row.username);
  if(user&&user.description!==row.marker)fail('NATIVE_IDENTITY_CONFLICT','该原生账号不属于本次开户，未绑定任何角色');
  return user;
 }
 async function finish(row,proof,user){
  const final=await db('finalize',{...proof,providerUid:user.uid,nativeUsername:row.username,marker:row.marker,role:row.role});
  return publicReady(final);
 }
 async function handle(body,context={}){
  try{
   if(!body||typeof body!=='object'||Array.isArray(body))fail('INVALID_REQUEST','请求必须为JSON对象');
   const allowed={resolve:['action','name'],register:['action','name','password','role','inviteCode','operationId','operationSecret'],status:['action','name','role','operationId','operationSecret']}[body.action];
   if(!allowed||Object.keys(body).some(key=>!allowed.includes(key)))fail('INVALID_REQUEST','不支持的身份请求字段');
   const rateKey=typeof context.rateKey==='string'&&/^[a-f0-9]{64}$/.test(context.rateKey)?context.rateKey:digest('sha256','shared-unknown-source');
   // Persistent platform-independent abuse accounting. No raw IP is stored.
   await db('limit',{rateKey,bucket:body.action});
   if(body.action==='resolve'){
    const name=normalizeName(body.name,{legacy:true});
    // Exact legacy native login names take precedence over casefold human
    // aliases. An alias must never reroute an existing username to a new UID.
    if(nativeName.test(name)){
     const native=await find(name);
     if(native){
      const row=await db('resolveLegacy',{providerUid:native.uid,nativeUsername:native.username});
      return {ok:true,data:{...publicReady(row),legacy:true}};
     }
    }
    if([...name].length<=40){
     const row=await db('resolve',{name});return {ok:true,data:publicReady(row)};
    }
    fail('NOT_FOUND','未找到姓名，请核对姓名或首次注册');
   }
   const proof=operation(body);
   if(body.role!==undefined&&!['anchor','operator'].includes(body.role))fail('INVALID_ROLE','注册身份仅支持主播或运营');
   if(body.action==='status'){
    // A verified operation secret may discover its immutable server role.
    // SQL 003 still rejects any explicit wrong role and finalize uses row.role.
    const row=await db('status',{...proof,...(body.name===undefined?{}:{name:normalizeName(body.name)}),...(body.role===undefined?{}:{role:body.role})});
    if(row.state==='ready')return {ok:true,data:publicReady(row)};
    const native=await recoverNative(row);
    return {ok:true,data:native?await finish(row,proof,native):{state:'reserved',requiresPassword:true,role:row.role}};
   }
   const name=normalizeName(body.name),password=checkedPassword(body.password);
   // Old cached clients may finish invite-based operations. New registrations
   // choose only a non-admin role; never silently reinterpret an old operation.
   const direct=body.role!==undefined;
   if(direct&&body.inviteCode!==undefined)fail('INVALID_REQUEST','直接注册无需邀请码');
   if(!direct){
    if(body.inviteCode===undefined)fail('INVALID_ROLE','请选择主播或运营身份');
    if(typeof body.inviteCode!=='string'||!/^[a-f0-9]{32}$/i.test(body.inviteCode.trim()))fail('INVALID_INVITE','邀请码无效');
   }
   // A human alias must not shadow an existing native login name. No adoption
   // or password reset is attempted for any pre-existing native account.
   if(nativeName.test(name)){
    const old=await find(name);
    if(old)fail('NAME_TAKEN','姓名已存在，请直接用原密码登录，或加部门/编号');
   }
   const row=await db('reserve',{...proof,name,...(direct?{role:body.role}:{inviteHash:digest('md5',body.inviteCode.trim().toLowerCase())})});
   if(row.state==='ready')return {ok:true,data:publicReady(row)};
   let native=await recoverNative(row);
   if(!native){
    try{
     const created=await provider.createNativeUser({username:row.username,password,displayName:row.displayName,marker:row.marker});
     if(typeof created?.uid!=='string'||!created.uid||created.username!==row.username)fail('NATIVE_IDENTITY_CONFLICT','官方开户回执不一致，未绑定角色');
     native=created;
    }catch(error){
     // A timeout/duplicate reply may arrive after native creation committed.
     // Exactly query the reserved username and marker; never guess a UID or
     // repeat creation with another username. Never change an existing password.
     native=await recoverNative(row);
     if(!native){
      if(error instanceof IdentityError)throw error;
      fail('NATIVE_CREATION_FAILED','官方账号服务未确认开户完成，请保留原尝试并重试');
     }
    }
   }
   return {ok:true,data:await finish(row,proof,native)};
  }catch(error){
   if(error instanceof IdentityError)return {ok:false,error:{code:error.code,message:error.message}};
   return {ok:false,error:{code:'PROVIDER_UNAVAILABLE',message:'身份服务暂不可用，请保留原尝试后重试'}};
  }
 }
 return {handle};
}
function httpStatus(reply){
 if(reply.ok)return 200;
 if(reply.error.code==='RATE_LIMITED')return 429;
 if(['PROVIDER_UNAVAILABLE','NATIVE_CREATION_FAILED'].includes(reply.error.code))return 503;
 if(['NAME_CONFLICT','NAME_TAKEN','NAME_PENDING','REGISTRATION_CONFLICT','NATIVE_IDENTITY_CONFLICT'].includes(reply.error.code))return 409;
 if(reply.error.code==='NOT_FOUND')return 404;
 return 400;
}
function parseEvent(event){
 if(typeof event?.body==='object'&&event.body!==null)return event.body;
 if(typeof event?.body!=='string')fail('INVALID_REQUEST','缺少JSON请求体');
 if(Buffer.byteLength(event.body)>24576)fail('INVALID_REQUEST','请求内容过大');
 const raw=event.isBase64Encoded?Buffer.from(event.body,'base64').toString('utf8'):event.body;
 if(Buffer.byteLength(raw)>16384)fail('INVALID_REQUEST','请求内容超过16KiB');
 try{return JSON.parse(raw);}catch{fail('INVALID_REQUEST','请求必须为有效JSON');}
}
function createHttpHandler(options={}){
 const service=options.service||createIdentityService(options);
 const origins=options.allowedOrigins||String(process.env.R25_ALLOWED_ORIGINS||'https://lijianjun004-star.github.io').split(',').map(x=>x.trim()).filter(Boolean);
 return async function main(event={}){
  const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),String(v)]));
  const origin=headers.origin;
  const cors={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
  if(origin&&origins.includes(origin))cors['Access-Control-Allow-Origin']=origin;
  if(origin&&!origins.includes(origin))return {statusCode:403,headers:cors,body:JSON.stringify({ok:false,error:{code:'FORBIDDEN_ORIGIN',message:'当前来源不允许使用身份入口'}})};
  const method=String(event.httpMethod||event.requestContext?.http?.method||'POST').toUpperCase();
  if(method==='OPTIONS')return {statusCode:204,headers:cors,body:''};
  if(method!=='POST')return {statusCode:405,headers:cors,body:JSON.stringify({ok:false,error:{code:'INVALID_REQUEST',message:'请使用POST JSON'}})};
  let body;try{body=parseEvent(event);}catch(error){return {statusCode:400,headers:cors,body:JSON.stringify({ok:false,error:{code:'INVALID_REQUEST',message:error.message||'请求无效'}})};}
  // Only a platform-injected source address is used, never payload or spoofable
  // x-forwarded-for. Missing source information shares a conservative quota.
  const source=event.requestContext?.identity?.sourceIp||event.requestContext?.http?.sourceIp||event.clientIP||'unknown';
  const reply=await service.handle(body,{rateKey:digest('sha256',String(source))});
  return {statusCode:httpStatus(reply),headers:cors,body:JSON.stringify(reply)};
 };
}
module.exports={createIdentityService,createHttpHandler,IdentityError,_test:{normalizeName,checkedPassword,operation,publicReady,parseEvent}};
