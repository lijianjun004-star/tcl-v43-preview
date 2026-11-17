// Test-only official SDK adapter. Never export Auth tokens or log SDK internals.
import cloudbase from '@cloudbase/js-sdk';
const safeCode = e => {
  const s=String(e?.code||e?.error_code||e?.statusCode||e?.name||'TRANSPORT_ERROR');
  return /^[A-Za-z0-9_:-]{1,80}$/.test(s)?s:'TRANSPORT_ERROR';
};
const fail=e=>{
  const status=Number(e?.status||e?.statusCode||e?.httpStatus);
  return {ok:false,errorCode:safeCode(e),...(Number.isInteger(status)&&status>=100&&status<=599?{status}:{}),
    transportFailure:/TypeError|NetworkError|Timeout|StorageUnknownError/.test(String(e?.name||'')),
    providerMessage:String(e?.message||'').replace(/https?:\/\/[^\s"']+/gi,'[URL_REDACTED]')
      .replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]')
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g,'[JWT_REDACTED]').slice(0,600)};
};
const bytes=b64=>Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
const hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
export function createClient(config){
  const app=cloudbase.init({...config.clientConfig,debug:false});
  const auth=app.auth(config.authOptions||{persistence:'local'});
  const bucket=()=>app.storage.from('r25wf-private');
  const session=async()=>{const r=await auth.getSession();if(r.error)throw r.error;return r.data.session;};
  const normalized=async result=>{
    if(result?.error)return fail(result.error);
    const body=result?.data;
    if(body instanceof Blob){const data=await body.arrayBuffer();return {ok:true,bytes:data.byteLength,sha256:await hash(data),mime:body.type};}
    return {ok:true};
  };
  const fetchSummary=async(url,headers={})=>{
    const response=await fetch(url,{headers,cache:'no-store'});
    const data=await response.arrayBuffer();
    return {ok:response.ok,status:response.status,bytes:data.byteLength,sha256:await hash(data),
      contentRange:response.headers.get('content-range'),acceptRanges:response.headers.get('accept-ranges'),
      contentType:response.headers.get('content-type')};
  };
  return {
    async login(credentials){try{const r=await auth.signInWithPassword(credentials);if(r.error)return fail(r.error);const s=await session();return s?{ok:true,uid:String(s.user.id||s.user.uid||'')}:{ok:false,errorCode:'NO_SESSION'};}catch(e){return fail(e);}},
    async logout(){try{return await normalized(await auth.signOut());}catch(e){return fail(e);}},
    async call(action,payload={},operation_id=null){try{
      const r=await app.rdb().rpc('r25wf_api',{action,payload,operation_id});
      if(r.error)return fail(r.error);
      let data=r.data;if(typeof data==='string')data=JSON.parse(data);
      return data?.ok?{ok:true,data:data.data}:{ok:false,errorCode:safeCode(data?.error)};
    }catch(e){return fail(e);}},
    async upload({path,base64,mime,upsert=false}){try{return await normalized(await bucket().upload(path,new Blob([bytes(base64)],{type:mime}),{contentType:mime,upsert}));}catch(e){return fail(e);}},
    async download(path){try{return await normalized(await bucket().download(path));}catch(e){return fail(e);}},
    async info(path){try{
      const r=await bucket().info(path);if(r.error)return fail(r.error);
      const d=r.data;return {ok:true,info:{availableKeys:Object.keys(d).sort(),size:d.size??null,
        contentType:d.contentType??null,metadata:d.metadata?{availableKeys:Object.keys(d.metadata).sort(),
          size:d.metadata.size??null,mimetype:d.metadata.mimetype??null,contentType:d.metadata.contentType??null}:null,
        ownerUidSha256:d.owner_id?await hash(new TextEncoder().encode(String(d.owner_id))):null}};
    }catch(e){return fail(e);}},
    async remove(path){try{const r=await bucket().remove([path]);return r.error?fail(r.error):{ok:true,removedCount:Array.isArray(r.data)?r.data.length:null};}catch(e){return fail(e);}},
    async sign(path){try{
      const r=await bucket().createSignedUrl(path,60);
      return r.error?fail(r.error):{ok:true,privateURL:r.data.fullSignedURL};
    }catch(e){return fail(e);}},
    async fetchPrivateURL(privateURL){try{return await fetchSummary(privateURL);}catch(e){return fail(e);}},
    async range(path){try{
      const s=await session();if(!s)return {ok:false,errorCode:'NO_SESSION'};
      const url=`https://${config.clientConfig.env}.api.tcloudbasegateway.com/v1/storages/object/r25wf-private/${path.split('/').map(encodeURIComponent).join('/')}`;
      return await fetchSummary(url,{Authorization:`Bearer ${s.access_token}`,Range:'bytes=0-99'});
    }catch(e){return fail(e);}},
    async invalidSession(path){try{
      const url=`https://${config.clientConfig.env}.api.tcloudbasegateway.com/v1/storages/object/r25wf-private/${path.split('/').map(encodeURIComponent).join('/')}`;
      return await fetchSummary(url,{Authorization:'Bearer r25-intentionally-invalid-test-token'});
    }catch(e){return fail(e);}},
    async withoutSession(path){try{
      const url=`https://${config.clientConfig.env}.api.tcloudbasegateway.com/v1/storages/object/r25wf-private/${path.split('/').map(encodeURIComponent).join('/')}`;
      return await fetchSummary(url);
    }catch(e){return fail(e);}},
    async forgeStorageRow({path,owner,mime,size}){try{
      const s=await session();if(!s)return {ok:false,errorCode:'NO_SESSION'};
      const r=await fetch(`https://${config.clientConfig.env}.api.tcloudbasegateway.com/v1/rdb/rest/objects`,{
        method:'POST',headers:{Authorization:`Bearer ${s.access_token}`,'Content-Type':'application/json',
          'Content-Profile':'storage','Accept-Profile':'storage',Prefer:'return=representation'},
        body:JSON.stringify({bucket_id:'r25wf-private',name:path,owner_id:owner,metadata:{mimetype:mime,size}}),
      });
      let data;try{data=await r.json();}catch{}
      return {ok:r.ok,status:r.status,errorCode:r.ok?null:safeCode(data)};
    }catch(e){return fail(e);}},
  };
}
