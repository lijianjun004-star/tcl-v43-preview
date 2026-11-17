import { createNameIdentityClient, validateJoinPassword } from './name-identity.mjs';
// CloudBase credentials stay inside the official SDK. Business calls never contain passwords.
const copy = value => JSON.parse(JSON.stringify(value));
export class WorkflowError extends Error {
  constructor(code, message) { super(message || '云端操作未完成'); this.name = 'WorkflowError'; this.code = code || 'CLOUD_ERROR'; }
}
const fail = (code, message) => { throw new WorkflowError(code, message); };
export const isCloudConfigured = config => config?.enabled === true;
export const cloudPartitionName = (envId, uid) => `tcl-specialty-v352-asr-r25-qa:cloud:${encodeURIComponent(envId)}:${encodeURIComponent(uid)}`;

export function createOperationStore({ envId, uid, indexedDB = globalThis.indexedDB }) {
  let ready;
  const db = () => ready ||= new Promise((resolve, reject) => {
    if (!indexedDB) return reject(new WorkflowError('LOCAL_STORAGE', '无法保存待发送记录，请先下载文字备份'));
    const request = indexedDB.open(`r25-cloud-outbox:${envId}:${uid}`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('operations', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new WorkflowError('LOCAL_STORAGE', '本机待发送记录被其他页面占用'));
  });
  async function transact(mode, operation) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('operations', mode); let value;
      const request = operation(transaction.objectStore('operations'));
      request.onsuccess = () => { value = request.result; };
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(transaction.error || new WorkflowError('LOCAL_STORAGE', '待发送记录未保存'));
      transaction.onerror = () => {};
    });
  }
  return {
    get: id => transact('readonly', store => store.get(id)),
    put: row => transact('readwrite', store => store.put(copy(row))),
    list: () => transact('readonly', store => store.getAll()),
    close: async () => {try{if(ready)(await ready).close();}catch{}finally{ready=null;} }
  };
}

export function createCloudWorkflow({ config = {}, sdkFactory, operationStoreFactory = createOperationStore, businessTransport, nameIdentity, onIdentityChange = async () => {} } = {}) {
  let sdkApp, sdkReady, user = null, session = null, identityEpoch = 0, operationStore;
  const personIdentity=nameIdentity||createNameIdentityClient({config:config.nameIdentity||{},envId:config.envId});
  const activeWrites = new Map();let nativeAuthChain=Promise.resolve(),nativeMutationDepth=0,authSubscription;
  const mutateNativeAuth=task=>{const execute=async()=>{nativeMutationDepth++;try{return await task();}finally{nativeMutationDepth--;}};const run=nativeAuthChain.then(execute,execute);nativeAuthChain=run.then(()=>{},()=>{});return run;};
  const state = { configured: isCloudConfigured(config), user: null, error: '', initialized: false, capabilities: { media: false } };
  function snapshot() { return { ...state, user: user ? { ...user } : null }; }
  async function sdk() {
    if (!state.configured) fail('DISABLED', '当前为本机体验');
    if (!config.envId || !config.functionName) fail('CONFIGURATION', '云端配置不完整，请联系管理员');
    if (!sdkApp) {
      if (!sdkFactory) fail('SDK_UNAVAILABLE', '账号组件尚未就绪，请稍后重试');
      if(!sdkReady)sdkReady=Promise.resolve().then(()=>sdkFactory(config));
      try{sdkApp=await sdkReady;if(!authSubscription&&sdkApp.__r25Auth.subscribe)authSubscription=sdkApp.__r25Auth.subscribe(onNativeAuthEvent);}catch(error){sdkReady=null;throw error;}
    }
    return sdkApp;
  }
  async function raw(action, payload = {}, operationId, expectedActorUid=user?.uid||session?.uid) {
    const app = await sdk();
    const event = { action, payload:{...payload,...(expectedActorUid?{expectedActorUid}:{})}, ...(operationId ? { operationId } : {}) };
    const response = businessTransport ? await businessTransport(event, app) : await app.callFunction({ name: config.functionName, data: event });
    let envelope = businessTransport ? response : response?.result;
    if (typeof envelope === 'string') { try { envelope = JSON.parse(envelope); } catch { fail('INVALID_RESPONSE', '云端返回内容无法确认，请保留本机记录后重试'); } }
    if (!envelope || envelope.ok !== true) {
      const error = envelope?.error;
      fail(error?.code || 'CLOUD_ERROR', error?.message || '云端操作未确认成功，请重试');
    }
    return envelope.data;
  }
  function onNativeAuthEvent(event,next){
    if(!state.initialized||!user)return;
    if(event!=='SIGNED_OUT'&&(!next?.uid||next.uid===user.uid))return;
    const owner=user.uid,epoch=identityEpoch;
    // Events can be delivered late after this page's own login. Re-read before clearing a newer session.
    void readSession().then(async actual=>{
      if(epoch!==identityEpoch||user?.uid!==owner)return;
      if(!actual||actual.uid!==owner){++identityEpoch;activeWrites.clear();await setIdentity(null,null,'账号会话已在其他页面改变，请重新登录');}
    }).catch(()=>{});
  }
  async function readSession() {
    // SDK-specific response normalization belongs in the official adapter.
    return sdkApp.__r25Auth.getSession();
  }
  async function setIdentity(next, currentSession, errorMessage = '') {
    const old = user?.uid, oldRole = user?.role, epoch = identityEpoch;
    user = next; session = currentSession || null; state.user = next; state.error = errorMessage;if(!next)state.capabilities={media:false};
    if (old !== next?.uid || oldRole !== next?.role) {
      if (operationStore) await operationStore.close?.();
      operationStore = next ? operationStoreFactory({ envId: config.envId, uid: next.uid }) : null;
      const isCurrent=async()=>{
        if(epoch!==identityEpoch||user?.uid!==next?.uid)return false;
        if(!next)return true;
        const actual=await readSession();
        return epoch===identityEpoch&&user?.uid===next.uid&&actual?.uid===next.uid;
      };
      try { await onIdentityChange(next ? { ...next } : null,{isCurrent}); }
      catch(error){if(next&&epoch===identityEpoch&&user?.uid===next.uid){++identityEpoch;await setIdentity(null,null,error.message||'姓名登录会话已改变，请重新登录');}throw error;}
    }
  }
  async function acceptSession(epoch, expectedUid) {
    const current = await readSession();
    if (epoch !== identityEpoch) fail('STALE_SESSION', '登录状态已改变');
    if (expectedUid && current?.uid !== expectedUid) fail('IDENTITY_MISMATCH', '姓名对应的登录身份尚未确认，请重新登录');
    if (!current?.uid) { await setIdentity(null, null); return null; }
    const data = await raw('me',{},undefined,current.uid); const profile = data?.user ? { ...data.user } : null;
    if (profile && data.registered === false && profile.role == null) profile.role = 'pending';
    if (profile?.active === false && profile.role !== 'pending') fail('ACCOUNT_DISABLED', '此账号已停用，请联系管理员');
    if (!profile?.uid || !['anchor', 'operator', 'admin', 'pending'].includes(profile.role) || String(profile.uid) !== current.uid) {
      fail('IDENTITY_MISMATCH', '云端账号身份未验证，请退出后重新登录');
    }
    if (epoch !== identityEpoch) fail('STALE_SESSION', '登录状态已改变');
    await verifyAcceptedSession(current.uid,epoch);
    state.capabilities={media:data.capabilities?.privateMedia===true};
    await setIdentity({ ...profile, uid:String(profile.uid), displayName: profile.displayName || profile.username || '已登录用户' }, current);
    await verifyAcceptedSession(current.uid,epoch);
    if(epoch!==identityEpoch||user?.uid!==current.uid)fail('STALE_SESSION','登录状态已改变，旧身份应用结果已忽略');
    return user;
  }
  async function verifyAcceptedSession(owner,epoch){
    const actual=await readSession();
    if(epoch!==identityEpoch)fail('STALE_SESSION','登录状态已改变，旧身份结果已忽略');
    if(actual?.uid!==owner){const message='姓名登录会话已在其他页面改变，请重新登录';++identityEpoch;activeWrites.clear();await setIdentity(null,null,message);fail('STALE_SESSION',message);}
  }
  async function initialize() {
    if (!state.configured) { state.initialized = true; return snapshot(); }
    const epoch = ++identityEpoch;
    try { await mutateNativeAuth(async()=>{await sdk();if(epoch!==identityEpoch)fail('STALE_SESSION','登录状态已改变');await acceptSession(epoch);}); }
    catch (error) { if(epoch===identityEpoch)state.error = error?.message || '云端连接未完成'; }
    state.initialized = true; return snapshot();
  }
  async function signIn(username, password) {
    if (!username?.trim() || !password) fail('CREDENTIALS_REQUIRED', '请输入姓名和密码');
    const epoch = ++identityEpoch;activeWrites.clear();
    await setIdentity(null, null);
    return mutateNativeAuth(async()=>{
      if(epoch!==identityEpoch)fail('STALE_SESSION','登录请求已被新的账号操作替代');
      const resolved=await personIdentity.resolve(username.trim());
      if(epoch!==identityEpoch)fail('STALE_SESSION','登录请求已被新的姓名操作替代');
      await sdk();await sdkApp.__r25Auth.signIn(resolved.username,password);
      if(epoch!==identityEpoch)fail('STALE_SESSION','登录请求已被新的账号操作替代');
      if(resolved.uid&&(await readSession())?.uid!==resolved.uid)fail('IDENTITY_MISMATCH','姓名对应的登录身份尚未确认，请重新登录');
      return acceptSession(epoch,resolved.uid);
    });
  }
  async function register({name,username,password,role='anchor'}={}) {
    if(!['anchor','operator'].includes(role))fail('INVALID_ROLE','请选择主播或运营注册');
    const epoch=++identityEpoch;activeWrites.clear();await setIdentity(null,null);
    return mutateNativeAuth(async()=>{
      if(epoch!==identityEpoch)fail('STALE_SESSION','加入请求已被新的操作替代');
      const registered=await personIdentity.register({name:name||username,password,role});
      if(epoch!==identityEpoch)fail('STALE_SESSION','加入结果已保留，请使用刚才的姓名和密码登录');
      await sdk();await sdkApp.__r25Auth.signIn(registered.username,password);
      if(epoch!==identityEpoch)fail('STALE_SESSION','登录状态已改变');
      const current=await readSession();
      if(!current?.uid||(registered.uid&&current.uid!==registered.uid))fail('IDENTITY_MISMATCH','加入后的身份尚未确认，请使用刚才的姓名和密码重新登录');
      const profile=await acceptSession(epoch,registered.uid);
      if(profile?.role==='pending')fail('ACCOUNT_PENDING','姓名已建立，但账号角色尚未确认，请联系管理员');
      const expectedRole=registered.legacyRecovery===true?registered.role:role;
      if(profile?.role!==expectedRole){await setIdentity(null,null);fail('IDENTITY_MISMATCH','注册身份与云端角色不一致，请联系管理员');}
      return profile;
    });
  }
  async function redeemInvitation(code, displayName) {
    await sdk(); const current = await readSession();
    if (!current?.uid) fail('AUTH_REQUIRED', '请先使用正式账号登录');
    const codeKey = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code.trim()))),byte=>byte.toString(16).padStart(2,'0')).join('');
    await durableWrite('invites.redeem', { code: code.trim(), displayName: displayName?.trim() || '' },codeKey);
    return acceptSession(identityEpoch);
  }
  async function changePassword(oldPassword, newPassword) {
    if (!user || !session) fail('AUTH_REQUIRED', '请先登录正式账号');
    if (!oldPassword) fail('PASSWORD_REQUIRED', '请填写原密码');validateJoinPassword(newPassword);
    const epoch = identityEpoch;
    return mutateNativeAuth(async()=>{await verifyNativeSession(user.uid,epoch);await sdkApp.__r25Auth.changePassword(oldPassword,newPassword);return acceptSession(epoch);});
  }
  async function signOut() {
    ++identityEpoch; activeWrites.clear();
    await setIdentity(null, null);
    if (sdkApp) await mutateNativeAuth(()=>sdkApp.__r25Auth.signOut());
  }
  async function verifyNativeSession(owner,epoch) {
    const actual=await readSession();
    if(epoch!==identityEpoch||owner!==user?.uid)fail('STALE_SESSION','账号已切换，旧请求已取消');
    if(!actual||actual.uid!==owner){
      ++identityEpoch;await setIdentity(null,null);state.error='正式账号会话已在其他页面改变，请重新登录';
      fail('STALE_SESSION','正式账号会话已改变，旧账号请求结果不会显示或保存');
    }
  }
  async function call(action, payload = {}, operationId) {
    if (!user || !session) fail('AUTH_REQUIRED', '请先登录正式账号');
    if (user.role === 'pending' && !['me', 'invites.redeem'].includes(action)) fail('INVITE_REQUIRED', '请先绑定管理员提供的邀请');
    const epoch = identityEpoch, owner = user.uid;
    await verifyNativeSession(owner,epoch);
    let data;
    try{data=await raw(action,payload,operationId,owner);}catch(error){if(epoch===identityEpoch&&['AUTH_REQUIRED','ACCOUNT_DISABLED','NOT_REGISTERED','STALE_SESSION'].includes(error.code)){++identityEpoch;await setIdentity(null,null);state.error=error.message;}throw error;}
    await verifyNativeSession(owner,epoch);
    if (epoch !== identityEpoch || owner !== user?.uid) fail('STALE_SESSION', '账号已切换，旧请求结果已忽略');
    return data;
  }
  async function refreshIdentity(){
    if(!user||!session)fail('AUTH_REQUIRED','请先登录正式账号');
    const owner=user.uid,epoch=identityEpoch;
    return mutateNativeAuth(async()=>{
      await verifyNativeSession(owner,epoch);
      try{return await acceptSession(epoch);}catch(error){if(epoch===identityEpoch&&['AUTH_REQUIRED','ACCOUNT_DISABLED','NOT_REGISTERED','STALE_SESSION'].includes(error.code)){++identityEpoch;await setIdentity(null,null);state.error=error.message;}throw error;}
    });
  }
  async function listAll(action, payload = {}) {
    const items = []; let cursor = ''; const seen = new Set();
    for (let page = 0; page < 50; page++) {
      const data = await call(action, { ...payload, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(data?.items)) fail('INVALID_RESPONSE', '云端列表格式不完整');
      items.push(...data.items); cursor = data.nextCursor || '';
      if (!cursor) return items;
      if (seen.has(cursor)) fail('INVALID_RESPONSE', '云端分页游标重复，请刷新后重试');
      seen.add(cursor);
    }
    fail('INCOMPLETE_SYNC', '列表尚未完整读取，请联系管理员');
  }
  async function durableWrite(action, payload, entityKey) {
    if (!user || !operationStore) fail('AUTH_REQUIRED', '请先登录正式账号');
    if (user.role === 'pending' && action !== 'invites.redeem') fail('INVITE_REQUIRED', '请先绑定管理员提供的邀请');
    const epoch = identityEpoch, store = operationStore;
    const id = `${action}:${entityKey}`;
    if (activeWrites.has(id)) return activeWrites.get(id);
    const job = (async () => {
      let operation = await store.get(id);
      if (epoch !== identityEpoch) fail('STALE_SESSION', '账号已切换');
      if (operation?.status === 'confirmed') return operation.receipt;
      if (!operation) {
        operation = { id, action, payload: copy(payload), operationId: globalThis.crypto.randomUUID(), status: 'pending', createdAt: new Date().toISOString() };
        await store.put(operation);
      }
      if (epoch !== identityEpoch) fail('STALE_SESSION', '账号已切换，未发送旧账号记录');
      const data = await call(operation.action, operation.payload, operation.operationId);
      if (operation.action === 'submissions.create' && (!data?.submission?.id || !data.submission.submittedAt || !data.receiptId)) {
        fail('INVALID_RECEIPT', '云端没有返回完整回执，送达状态未确认，请重试原操作');
      }
      // Only the backend envelope can produce a confirmation. Failed/ambiguous calls retain pending data.
      let confirmationWarning='';
      try{await store.put({ ...operation, status: 'confirmed', receipt: copy(data), confirmedAt: new Date().toISOString() });}catch{confirmationWarning='云端已确认，但本机回执缓存未写入；可从云端列表重新查询。';}
      if (epoch !== identityEpoch) fail('STALE_SESSION', '账号已切换，旧账号回执已保存');
      return confirmationWarning?{...data,clientWarning:confirmationWarning}:data;
    })();
    activeWrites.set(id, job);
    try { return await job; } finally { if (activeWrites.get(id) === job) activeWrites.delete(id); }
  }
  async function uploadMedia(blob) {
    if(!user||!session)fail('AUTH_REQUIRED','请先登录正式账号');
    if(user.role!=='anchor'||state.capabilities.media!==true)fail('MEDIA_NOT_AVAILABLE','当前尚未开放私有媒体上传，请明确选择只提交文字');
    const mime=String(blob?.type||'').split(';')[0].trim().toLowerCase();
    const extensions={'video/webm':'webm','video/mp4':'mp4','audio/webm':'webm','audio/mp4':'m4a','audio/wav':'wav','audio/x-wav':'wav','audio/mpeg':'mp3','audio/ogg':'ogg'};
    if(!extensions[mime]||!blob?.size||blob.size>50*1024*1024)fail('MEDIA_INVALID','请选择不超过50MiB的受支持录音或录像');
    const owner=user.uid,epoch=identityEpoch;await verifyNativeSession(owner,epoch);const path=`${owner}/${crypto.randomUUID()}.${extensions[mime]}`;
    await sdkApp.__r25Media.upload(path,blob,mime);
    await verifyNativeSession(owner,epoch);
    if(epoch!==identityEpoch||user?.uid!==owner)fail('STALE_SESSION','账号已切换，旧账号上传结果已忽略');
    return {path,mime,size:blob.size};
  }
  async function downloadMedia(path) {
    if(!user||!session)fail('AUTH_REQUIRED','请先登录正式账号');
    const owner=user.uid,epoch=identityEpoch;await verifyNativeSession(owner,epoch);const blob=await sdkApp.__r25Media.download(path);
    await verifyNativeSession(owner,epoch);
    if(epoch!==identityEpoch||user?.uid!==owner)fail('STALE_SESSION','账号已切换，旧媒体结果已忽略');
    if(!(blob instanceof Blob))fail('MEDIA_INVALID','云端没有返回可播放的媒体');
    return blob;
  }
  async function pendingOperations() {
    if (!operationStore) return [];
    const epoch = identityEpoch, rows = await operationStore.list();
    if (epoch !== identityEpoch) fail('STALE_SESSION', '账号已切换');
    return rows.filter(row => row.status === 'pending').map(copy);
  }
  return { initialize, signIn, register, restoreRegistration: code => personIdentity.restoreRecovery(code), redeemInvitation, signOut, changePassword, call, listAll, durableWrite, pendingOperations, uploadMedia, downloadMedia, refreshIdentity, getState: snapshot, get user() { return user ? { ...user } : null; } };
}
