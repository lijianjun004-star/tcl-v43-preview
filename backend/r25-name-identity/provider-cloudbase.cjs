'use strict';
// Official control-plane adapter. Never log credentials, passwords, payloads or
// raw SDK errors. Requires STS credentials supplied by the function runtime.
// Dependency: @cloudbase/manager-node@5.10.4. No CLI credential/file fallback.
const ENV_ID='unknown-roadrunner-d7cap6e21f517';
class ProviderError extends Error {
  constructor(code,details={}){super(code);this.name='ProviderError';this.code=code;Object.assign(this,details);}
}
function safeCode(error){const code=String(error?.code||'PROVIDER_REQUEST_FAILED');return /^[A-Za-z0-9_.-]{1,96}$/.test(code)?code:'PROVIDER_REQUEST_FAILED';}
function safeRequestId(error){const value=String(error?.requestId||error?.RequestId||'');return /^[A-Za-z0-9_-]{1,96}$/.test(value)?value:undefined;}
function sanitized(error){if(error instanceof ProviderError)return error;return new ProviderError(safeCode(error),{requestId:safeRequestId(error)});}
function runtimeCredentials(){
  // Read per request/call, never at module initialization: STS rotates.
  const secretId=process.env.TENCENTCLOUD_SECRETID;
  const secretKey=process.env.TENCENTCLOUD_SECRETKEY;
  const token=process.env.TENCENTCLOUD_SESSIONTOKEN;
  if(!secretId||!secretKey||!token)throw new ProviderError('RUNTIME_STS_CREDENTIALS_UNAVAILABLE');
  return {secretId,secretKey,token};
}
function credentialPresence(){return {
  secretIdPresent:!!process.env.TENCENTCLOUD_SECRETID,
  secretKeyPresent:!!process.env.TENCENTCLOUD_SECRETKEY,
  sessionTokenPresent:!!process.env.TENCENTCLOUD_SESSIONTOKEN,
};}
function checkedUsername(value){if(typeof value!=='string'||!/^r25n_[a-f0-9]{24}$/.test(value))throw new ProviderError('INVALID_NATIVE_USERNAME');return value;}
function checkedReadUsername(value){if(typeof value!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$/.test(value))throw new ProviderError('INVALID_NATIVE_USERNAME');return value;}
function checkedNewPassword(value){
  const kinds=typeof value==='string'?[/[a-z]/,/[A-Z]/,/[0-9]/,/[()!@#$%^&*|?><_-]/].filter(pattern=>pattern.test(value)).length:0;
  if(typeof value!=='string'||value.length<8||value.length>32||!/^[A-Za-z0-9]/.test(value)||kinds<3||/[\u0000-\u001f\u007f]/u.test(value))throw new ProviderError('INVALID_NATIVE_PASSWORD');
  return value;
}
function checkedUid(value){
  if(typeof value==='number'&&!Number.isSafeInteger(value))throw new ProviderError('NATIVE_UID_PRECISION_UNSAFE');
  if((typeof value!=='string'&&typeof value!=='number')||!String(value)||String(value).length>64)throw new ProviderError('NATIVE_UID_MISSING');
  return String(value);
}
function rejectSecretPayload(value,depth=0){
  if(depth>12)throw new ProviderError('INVALID_SERVICE_PAYLOAD');
  if(!value||typeof value!=='object')return;
  for(const [key,entry] of Object.entries(value)){
    if(/password|^(?:operationSecret|inviteCode)$/i.test(key.replace(/[_-]/g,'')))throw new ProviderError('SECRET_FORBIDDEN_IN_PG_PAYLOAD');
    rejectSecretPayload(entry,depth+1);
  }
}
function serviceSql(action,payload){
  if(typeof action!=='string'||!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(action))throw new ProviderError('INVALID_SERVICE_ACTION');
  rejectSecretPayload(payload);
  let json;try{json=JSON.stringify(payload??{});}catch{throw new ProviderError('INVALID_SERVICE_PAYLOAD');}
  if(typeof json!=='string'||Buffer.byteLength(json)>65536)throw new ProviderError('INVALID_SERVICE_PAYLOAD');
  // All dynamic input is base64 literal data. No name, invite, marker or raw
  // operation secret is ever concatenated as SQL syntax. SQL API has no params.
  const a=Buffer.from(action,'utf8').toString('base64');
  const p=Buffer.from(json,'utf8').toString('base64');
  return "SELECT public.r25wf_name_identity_service(convert_from(decode('"+a+"','base64'),'UTF8'),convert_from(decode('"+p+"','base64'),'UTF8')::jsonb)::text AS result";
}
function firstJsonCell(response){
  let r=response?.Response??response;
  for(let i=0;i<3&&!Array.isArray(r?.Rows)&&r?.Data&&typeof r.Data==='object';i++)r=r.Data;
  if(!Array.isArray(r?.Rows)||r.Rows.length!==1)throw new ProviderError('INVALID_PG_SERVICE_RESPONSE');
  let row;try{row=typeof r.Rows[0]==='string'?JSON.parse(r.Rows[0]):r.Rows[0];}catch{throw new ProviderError('INVALID_PG_SERVICE_RESPONSE');}
  if(!Array.isArray(row)||row.length!==1)throw new ProviderError('INVALID_PG_SERVICE_RESPONSE');
  let cell=row[0];
  for(let i=0;i<3&&typeof cell==='string';i++){try{cell=JSON.parse(cell);}catch{throw new ProviderError('INVALID_PG_SERVICE_RESPONSE');}}
  if(!cell||typeof cell!=='object'||Array.isArray(cell))throw new ProviderError('INVALID_PG_SERVICE_RESPONSE');
  return cell;
}
function createProvider(options={}){
  const envId=options.envId||ENV_ID,region=options.region||'ap-shanghai';
  if(envId!==ENV_ID||region!=='ap-shanghai')throw new ProviderError('PROVIDER_ENV_SCOPE_MISMATCH');
  const manager=()=>{
    const creds=(options.credentialProvider||runtimeCredentials)();
    if(!creds?.secretId||!creds?.secretKey||!creds?.token)throw new ProviderError('RUNTIME_STS_CREDENTIALS_UNAVAILABLE');
    const config={envId,region,secretId:creds.secretId,secretKey:creds.secretKey,token:creds.token};
    if(options.managerFactory)return options.managerFactory(config); // Local tests only, not HTTP input.
    const Manager=require('@cloudbase/manager-node');return new Manager(config);
  };
  return {
    async dbCall(action,payload={}){
      const Sql=serviceSql(action,payload);
      try{return firstJsonCell(await manager().database.executePGSql({Sql,Role:'service_role'}));}
      catch(error){throw sanitized(error);}
    },
    async createNativeUser({username,password,displayName,marker}){
      checkedUsername(username);
      checkedNewPassword(password);
      if(typeof marker!=='string'||!/^r25wf-name-v1:[A-Za-z0-9_-]{8,80}$/.test(marker))throw new ProviderError('INVALID_NATIVE_MARKER');
      if(typeof displayName!=='string'||!displayName.trim()||[...displayName].length>40)throw new ProviderError('INVALID_DISPLAY_NAME');
      const native={name:username,type:'externalUser',userStatus:'ACTIVE',password,description:marker};
      // PG's40-codepoint name can exceed native's64-codeunit nickname bound.
      // Omit unsupported native nickname lengths; never falsify/truncate alias.
      if([...displayName].length>=2&&displayName.length<=64)native.nickName=displayName;
      try{
        const reply=await manager().user.createUser(native);
        return {uid:checkedUid(reply?.Data?.Uid),username};
      }catch(error){throw sanitized(error);}
    },
    async findNativeUser(username){
      checkedReadUsername(username); // Read-only legacy ASCII account lookup; never rename/reset it.
      try{
        const client=manager();
        for(let pageNo=1;pageNo<=5;pageNo++){
          // Name is FUZZY in the official API. Never trust the first item.
          const reply=await client.user.describeUserList({name:username,pageNo,pageSize:100});
          const rows=reply?.Data?.UserList;
          if(!Array.isArray(rows))throw new ProviderError('INVALID_NATIVE_LOOKUP_RESPONSE');
          const exact=rows.filter(row=>row.Name===username);
          if(exact.length>1)throw new ProviderError('NATIVE_NAME_NOT_UNIQUE');
          if(exact.length===1){
            const row=exact[0];
            if(row.Type!=='externalUser'||!['ACTIVE','BLOCKED'].includes(row.UserStatus))throw new ProviderError('NATIVE_ACCOUNT_UNVERIFIED');
            return {uid:checkedUid(row.Uid),username:row.Name,status:row.UserStatus,
              description:typeof row.Description==='string'?row.Description:null};
          }
          if(rows.length<100||pageNo*100>=Number(reply.Data.Total))return null;
        }
        throw new ProviderError('NATIVE_LOOKUP_PAGE_LIMIT');
      }catch(error){throw sanitized(error);}
    },
    async probeReadOnly(){
      const result={credentialPresence:credentialPresence(),nativeCreatePermission:'NOT_TESTED_READONLY',nativeLookup:null,pgSelect:null};
      let client;try{client=manager();}catch(error){result.runtimeCode=safeCode(error);return result;}
      try{
        const name='r25_probe_no_user_'+require('node:crypto').randomBytes(12).toString('hex');
        const reply=await client.user.describeUserList({name,pageNo:1,pageSize:1});
        if(!Array.isArray(reply?.Data?.UserList))throw new ProviderError('INVALID_NATIVE_LOOKUP_RESPONSE');
        result.nativeLookup={ok:true,requestId:reply.RequestId,matchedCount:reply.Data.UserList.length};
      }catch(error){result.nativeLookup={ok:false,code:safeCode(error),requestId:safeRequestId(error)};}
      try{
        const reply=await client.database.executePGSql({Sql:'SELECT 1 AS ok,current_user AS role',Role:'service_role'});
        const row=Array.isArray(reply?.Rows)&&reply.Rows.length===1?JSON.parse(reply.Rows[0]):null;
        if(!Array.isArray(row)||String(row[0])!=='1'||String(row[1])!=='service_role')throw new ProviderError('INVALID_PG_PROBE_RESPONSE');
        result.pgSelect={ok:true,requestId:reply.RequestId,role:'service_role'};
      }catch(error){result.pgSelect={ok:false,code:safeCode(error),requestId:safeRequestId(error)};}
      return result;
    },
  };
}
module.exports={createProvider,credentialPresence,ProviderError,_test:{serviceSql,firstJsonCell}};
