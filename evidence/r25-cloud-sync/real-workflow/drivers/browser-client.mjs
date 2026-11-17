// Test-only adapter. Uses the installed official CloudBase SDK and real Auth/PG requests.
// It never creates users and never exports credentials, session tokens or SDK internals.
import cloudbase from '@cloudbase/js-sdk';

export function createClient(config) {
  const app = cloudbase.init({...config.clientConfig, debug:false});
  const auth = app.auth(config.authOptions || {persistence:'local'});
  const audit=[];
  const code = error => String(error?.code || error?.error_code || error?.name || 'TRANSPORT_ERROR');
  const outcome = (ok, data, error) => ok ? {ok:true,data} : {ok:false,error:{code:code(error),message:'CloudBase operation was not confirmed'}};
  const currentUid = async () => {
    const result=await auth.getSession();
    if(result?.error)return null;
    const user=result?.data?.user||result?.data?.session?.user||result?.user||result?.session?.user;
    return user ? String(user.id || user.uid || user.user_id || '') : null;
  };
  return {
    async signIn({username,password}) {
      try {
        const result=await auth.signInWithPassword({username,password});
        if(result?.error)return outcome(false,null,result.error);
        const uid=await currentUid();
        if(!uid)return outcome(false,null,{code:'AUTH_SESSION_MISSING'});
        return outcome(true,{uid});
      } catch(error){return outcome(false,null,error)}
    },
    async session(){try{return outcome(true,{uid:await currentUid()})}catch(error){return outcome(false,null,error)}},
    async signOut(){try{const result=await auth.signOut();return result?.error?outcome(false,null,result.error):outcome(true,{signedOut:true})}catch(error){return outcome(false,null,error)}},
    async call(action,payload={},operationId=null){
      const start=performance.now();let result;
      try {
        if(typeof app.rdb!=='function')throw Object.assign(new Error('Official SDK PG client unavailable'),{code:'PG_ADAPTER_UNAVAILABLE'});
        const reply=await app.rdb(config.rdbOptions||{}).rpc(config.rpcName||'r25wf_api',{
          action,payload,operation_id:operationId
        });
        if(reply?.error)result=outcome(false,null,reply.error);
        else {
          let envelope=reply?.data;
          // json/jsonb functions normally return their JSON object directly.
          if(typeof envelope==='string'){try{envelope=JSON.parse(envelope)}catch{}}
          if(!envelope || typeof envelope.ok!=='boolean')result=outcome(false,null,{code:'INVALID_ENVELOPE'});
          else result=envelope.ok?outcome(true,envelope.data):outcome(false,null,envelope.error||{code:'BUSINESS_ERROR'});
        }
      }catch(error){result=outcome(false,null,error)}
      audit.push({action,operationId,ok:result.ok,errorCode:result.error?.code||null,elapsedMs:Math.round(performance.now()-start)});
      return result;
    },
    async tableRead(table){
      try {const reply=await app.rdb(config.rdbOptions||{}).from(table).select('*').limit(3);return reply?.error?outcome(false,null,reply.error):outcome(true,reply.data)}
      catch(error){return outcome(false,null,error)}
    },
    async gatewayMetadata(){
      const endpoint=await app.getEndPointWithKey('GATEWAY');
      return {type:typeof endpoint,keys:endpoint&&typeof endpoint==='object'?Object.keys(endpoint):[],BASE_URL:endpoint?.BASE_URL,PROTOCOL:endpoint?.PROTOCOL};
    },
    async gatewayRPCUrl(){
      const endpoint=await app.getEndPointWithKey('GATEWAY');
      let base=typeof endpoint==='string'?endpoint:String(endpoint?.BASE_URL||'');
      if(!base)throw Object.assign(new Error('Official gateway metadata has no BASE_URL'),{code:'GATEWAY_METADATA_MISSING'});
      if(!/^https?:\/\//.test(base)){const protocol=String(endpoint.PROTOCOL||'https').replace(/[:/]+$/,'');base=base.startsWith('//')?protocol+':'+base:protocol+'://'+base;}
      return base.replace(/\/$/,'')+'/rdb/rest/rpc/'+encodeURIComponent(config.rpcName||'r25wf_api');
    },
    audit(){return audit.map(row=>({...row}))}
  };
}
