import { WorkflowError } from './cloud-workflow.mjs';

// The fixed official SDK is bundled locally. No password is sent to the business RPC.
export async function createOfficialCloudBaseAdapter(config) {
  const { default: cloudbase } = await import('./vendor/cloudbase/cloudbase-sdk.mjs');
  const app = cloudbase.init({ env: config.envId, region: config.region || 'ap-shanghai',timeout:120000, ...(config.accessKey ? { accessKey: config.accessKey } : {}) });
  const auth = app.auth();
  const check = result => {
    if (result?.error) throw new WorkflowError(result.error.code || 'AUTH_ERROR', result.error.message || '账号验证未完成');
    return result?.data;
  };
  const session = async () => {
    const data = check(await auth.getSession());
    const value = data?.session;
    const uid = value?.user?.id ?? value?.user?.uid;
    return uid != null ? { uid: String(uid) } : null;
  };
  return {
    callFunction: options => app.callFunction(options),
    rpc: async event => {
      const result = await app.rdb().rpc(config.functionName || 'r25wf_api', { action: event.action, payload: event.payload || {}, operation_id: event.operationId || null });
      if (result.error) throw new WorkflowError(result.error.code || 'TRANSPORT_ERROR', result.error.message || '云端请求未成功');
      return result.data;
    },
    __r25Media: {
      upload: async(path,blob,mime)=>{
        const result=await app.storage.from(config.mediaBucket||'r25wf-private').upload(path,blob,{contentType:mime,upsert:false});
        if(result.error)throw new WorkflowError(result.error.code||'UPLOAD_FAILED',result.error.message||'附件上传未确认成功，原文件仍在本机');
        if(result.data?.path!==path)throw new WorkflowError('UPLOAD_FAILED','附件回执路径不一致，未加入提交');
        return result.data;
      },
      download: async path=>{
        const result=await app.storage.from(config.mediaBucket||'r25wf-private').download(path);
        if(result.error)throw new WorkflowError(result.error.code||'DOWNLOAD_FAILED',result.error.message||'无法读取已授权附件');
        return result.data;
      }
    },
    __r25Auth: {
      getSession: session,
      subscribe: callback=>{const result=auth.onAuthStateChange((event,current)=>{const id=current?.user?.id??current?.user?.uid;callback(event,id!=null?{uid:String(id)}:null);});return ()=>result.data.subscription.unsubscribe();},
      signIn: async (username, password) => check(await auth.signInWithPassword({ username, password })),
      signOut: async () => check(await auth.signOut()),
      changePassword: async (oldPassword, newPassword) => check(await auth.resetPasswordForOld({ old_password: oldPassword, new_password: newPassword }))
    }
  };
}
export const cloudbaseRpcTransport = (event, app) => app.rpc(event);
