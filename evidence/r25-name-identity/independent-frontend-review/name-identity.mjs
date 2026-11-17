// Names resolve to the same immutable native Auth UID. Passwords are never persisted here.
export class NameIdentityError extends Error {
  constructor(code, message) { super(message); this.name = 'NameIdentityError'; this.code = code; }
}
const error = (code, message) => { throw new NameIdentityError(code, message); };
export function normalizePersonName(value, { registration = false } = {}) {
  const name = String(value || '').normalize('NFKC').trim();
  if (!name || [...name].length > 64 || [...name].length > 40 && (registration || !nativeUsername(name)) || /[\p{Cc}\p{Cf}]/u.test(name)) error('INVALID_NAME', '请填写有效姓名，重名时可加上部门');
  if (registration && !/\p{Script=Han}/u.test(name)) error('INVALID_NAME', '请填写中文姓名；重名时可加上部门，例如“张三（电视）”');
  return name;
}
export function validateJoinPassword(password) {
  if (!/^(?=.*[A-Za-z])(?=.*\d)[\x21-\x7e]{8,32}$/.test(String(password || ''))) error('INVALID_PASSWORD', '密码需8–32位，至少包含字母和数字，不含空格');
}
const nativeUsername = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$/.test(value);
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');

function createRegistrationStore(envId) {
  let database;
  async function db() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open(`r25-name-identity:${encodeURIComponent(envId || '')}`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('operations');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Registration storage blocked'));
    });
    return database;
  }
  async function transact(mode, run) {
    const connection = await db();
    return new Promise((resolve, reject) => {
      const transaction = connection.transaction('operations', mode), request = run(transaction.objectStore('operations'));
      let result; request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error);
    });
  }
  async function reserve(key, value) {
    const connection = await db();
    return new Promise((resolve, reject) => {
      const transaction = connection.transaction('operations', 'readwrite'), store = transaction.objectStore('operations'), request = store.get(key);
      let result;
      request.onsuccess = () => {
        if (request.result) result = { value: request.result, existing: true };
        else { store.put(value, key); result = { value, existing: false }; }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error);
    });
  }
  return { reserve, put: (key, value) => transact('readwrite', store => store.put(value, key)) };
}

export function createNameIdentityClient({ config = {}, envId, fetchImpl = globalThis.fetch, storage, crypto = globalThis.crypto } = {}) {
  const enabled = config.enabled === true;
  const registry = storage || createRegistrationStore(envId);
  async function request(body) {
    if (!enabled || !config.endpoint) error('IDENTITY_UNAVAILABLE', '姓名加入服务正在准备，请稍后重试');
    let endpoint;
    try { endpoint = new URL(config.endpoint); } catch { error('IDENTITY_UNAVAILABLE', '姓名加入服务尚未配置完成'); }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) error('IDENTITY_UNAVAILABLE', '姓名加入服务配置无效');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(1000, config.timeoutMs || 60000));
    try {
      const response = await fetchImpl(endpoint.href, { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const envelope = await response.json().catch(() => null);
      if (!response.ok || envelope?.ok !== true) {
        const failure = envelope?.error;
        error(failure?.code || 'IDENTITY_REQUEST_FAILED', failure?.message || (body.action === 'resolve' ? '姓名尚未验证，请稍后重试登录' : '加入结果尚未确认，请保留姓名并重试'));
      }
      if (!envelope.data || typeof envelope.data !== 'object') error('INVALID_IDENTITY_RESPONSE', '加入结果不完整，请重试原操作');
      return envelope.data;
    } catch (failure) {
      if (failure instanceof NameIdentityError) throw failure;
      error('IDENTITY_NETWORK', body.action === 'resolve' ? '网络未连通，姓名和密码尚未验证，请稍后重试' : '网络未确认加入结果，再次点击会继续原操作；请使用首次设置的密码');
    } finally { clearTimeout(timer); }
  }
  async function keyFor(name) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name.toLowerCase()));
    return `r25-name-join:${encodeURIComponent(envId || '')}:${hex(new Uint8Array(digest))}`;
  }
  async function reservationFor(name) {
    const key = await keyFor(name);
    try {
      const value = { name, operationId: crypto.randomUUID(), operationSecret: hex(crypto.getRandomValues(new Uint8Array(32))), createdAt: new Date().toISOString(), state: 'pending' };
      const result = await registry.reserve(key, value);
      if (result.value?.name?.toLowerCase() !== name.toLowerCase() || !result.value.operationId || !/^[0-9a-f]{64}$/.test(result.value.operationSecret)) error('REGISTRATION_STORAGE', '本机加入重试信息无法确认，请联系管理员核对');
      return { key, ...result };
    } catch { error('REGISTRATION_STORAGE', '浏览器无法保存安全重试信息，请允许本机存储后重试'); }
  }
  function ready(data) {
    if (!nativeUsername(data?.username)) error('REGISTRATION_PENDING', '加入尚未确认完成，请稍后重试原操作');
    if (data.state !== 'ready') error('REGISTRATION_PENDING', '加入正在处理中，请稍后继续；不需要重复更换姓名');
    return { username: data.username, ...(data.uid != null ? { uid: String(data.uid) } : {}), state: 'ready' };
  }
  async function resolve(value) {
    const name = normalizePersonName(value);
    if (!enabled) {
      // Existing native usernames remain compatible while the new name broker is not enabled.
      if (nativeUsername(name)) return { username: name };
      error('IDENTITY_UNAVAILABLE', '姓名登录服务正在准备，请稍后重试');
    }
    return ready(await request({ action: 'resolve', name }));
  }
  async function register({ name: inputName, password, inviteCode }) {
    const name = normalizePersonName(inputName, { registration: true }); validateJoinPassword(password);
    if (!String(inviteCode || '').trim()) error('INVITATION_REQUIRED', '请填写运营或管理员给你的邀请码');
    if (!enabled) error('IDENTITY_UNAVAILABLE', '姓名加入服务正在准备，请稍后重试');
    const reservation = await reservationFor(name);
    const operation = { name: reservation.value.name, operationId: reservation.value.operationId, operationSecret: reservation.value.operationSecret };
    if (reservation.existing) {
      try {
        const status = await request({ action: 'status', ...operation });
        if (status.state === 'ready') {
          const data = ready(status);
          if (!data.uid) error('INVALID_IDENTITY_RESPONSE', '加入身份尚未确认，请稍后继续原操作');
          return data;
        }
        if (status.state !== 'reserved' || status.requiresPassword !== true) error('REGISTRATION_PENDING', '加入尚未确认，请稍后继续原操作');
      } catch (failure) {
        // The first request may never have reached the server. Keep the same recovery operation.
        if (failure.code !== 'NOT_FOUND') throw failure;
      }
    }
    const data = ready(await request({ action: 'register', ...operation, password, inviteCode: String(inviteCode).trim() }));
    if (!data.uid) error('INVALID_IDENTITY_RESPONSE', '加入身份尚未确认，请稍后继续原操作');
    // Only identifiers and the recovery secret are retained. Never persist a password or invite code.
    try { await registry.put(reservation.key, { ...reservation.value, state: 'ready', uid: data.uid, username: data.username }); } catch {}
    return data;
  }
  return { enabled, resolve, register };
}
