// Names resolve to the same immutable native Auth UID. Passwords are never persisted here.
export class NameIdentityError extends Error {
  constructor(code, message) { super(message); this.name = 'NameIdentityError'; this.code = code; }
}
const error = (code, message) => { throw new NameIdentityError(code, message); };
export function normalizePersonName(value, { registration = false } = {}) {
  const name = String(value || '').normalize('NFKC').trim();
  if (!name || [...name].length > 64 || [...name].length > 40 && (registration || !nativeUsername(name)) || /[\p{Cc}\p{Cf}]/u.test(name)) error('INVALID_NAME', '请填写有效姓名，重名时可加上部门');
  return name;
}
export function validateJoinPassword(password) {
  const value = String(password || '');
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[()!@#$%^&*|?><_-]/].filter(rule => rule.test(value)).length;
  if (value.length < 8 || value.length > 32 || !/^[A-Za-z0-9]/.test(value) || kinds < 3) error('INVALID_PASSWORD', '密码须8–32位，首位为字母或数字；小写字母、大写字母、数字和指定符号中至少包含三类。建议使用大小写字母加数字。');
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
  async function save(key, value, expected) {
    const connection = await db();
    return new Promise((resolve, reject) => {
      const transaction = connection.transaction('operations', 'readwrite'), store = transaction.objectStore('operations');
      const request = store.get(key); let saved = false;
      request.onsuccess = () => {
        const current = request.result;
        // A late response in an old tab must never overwrite an imported recovery secret.
        if (expected === null ? current === undefined : current?.operationId === expected.operationId && current?.operationSecret === expected.operationSecret) {
          store.put(value, key); saved = true;
        }
      };
      transaction.oncomplete = () => resolve(saved);
      transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error);
    });
  }
  return { reserve, save, get: key => transact('readonly', store => store.get(key)) };
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
  async function reservationFor(name, role) {
    const key = await keyFor(name);
    try {
      const value = { name, role, operationId: crypto.randomUUID(), operationSecret: hex(crypto.getRandomValues(new Uint8Array(32))), createdAt: new Date().toISOString(), state: 'pending' };
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
  async function saveReservation(key, value, expected) {
    if (!await registry.save(key, value, expected)) error('REGISTRATION_STORAGE_CHANGED', '本机恢复信息已在其他页面改变，请关闭旧页面后重试');
  }
  async function restoreRecovery(code) {
    let value;
    try {
      const token = String(code || '').trim();
      if (token.length > 4096 || !/^R25REC1\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
      const encoded = token.slice(8).replace(/-/g, '+').replace(/_/g, '/');
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))));
      if (!value || value.version !== 1 || value.envId !== envId ||
          Object.keys(value).sort().join(',') !== 'envId,name,operationId,operationSecret,role,version' ||
          typeof value.name !== 'string' || normalizePersonName(value.name, { registration: true }) !== value.name ||
          !['anchor', 'operator'].includes(value.role) || typeof value.operationId !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.operationId) ||
          typeof value.operationSecret !== 'string' || !/^[a-f0-9]{64}$/.test(value.operationSecret)) throw new Error();
    } catch { error('INVALID_RECOVERY_CODE', '恢复码无效或不属于当前练播房，请联系管理员核对'); }
    const { name, role, operationId, operationSecret } = value;
    // Snapshot before the network request: a delayed old code import must not
    // overwrite a newer verified code imported while its response was pending.
    const key = await keyFor(name), previous = await registry.get(key);
    // Validate against the server before replacing any existing local attempt.
    const status = await request({ action: 'status', name, operationId, operationSecret });
    if (status.role !== role || !['reserved', 'ready'].includes(status.state) ||
        status.state === 'reserved' && status.requiresPassword !== true) error('INVALID_IDENTITY_RESPONSE', '恢复身份尚未确认，本机原信息已保留');
    if (status.state === 'ready' && !ready(status).uid) error('INVALID_IDENTITY_RESPONSE', '恢复身份尚未确认，本机原信息已保留');
    await saveReservation(key, { name, role, operationId, operationSecret, state: status.state, recoveredAt: new Date().toISOString() }, previous || null);
    return { name, role, state: status.state };
  }
  async function register({ name: inputName, password, role = 'anchor' }) {
    const name = normalizePersonName(inputName, { registration: true }); validateJoinPassword(password);
    if (!['anchor', 'operator'].includes(role)) error('INVALID_ROLE', '请选择主播或运营注册，管理员账号不能自行注册');
    if (!enabled) error('IDENTITY_UNAVAILABLE', '姓名加入服务正在准备，请稍后重试');
    const reservation = await reservationFor(name, role);
    const legacyRecovery = reservation.value.role == null;
    const proof = { name: reservation.value.name, operationId: reservation.value.operationId, operationSecret: reservation.value.operationSecret };
    if (reservation.existing) {
      try {
        // Discover the server's canonical role with the same high-entropy proof.
        // Never infer it from a previous browser write or change an existing server role.
        const status = await request({ action: 'status', ...proof });
        if (legacyRecovery) {
          if (status.state !== 'ready') error('LEGACY_REGISTRATION_PENDING', '原账号注册尚未完成，安全重试信息已保留；请尝试姓名密码登录，或联系管理员恢复原操作');
          if (!['anchor', 'operator'].includes(status.role)) error('REGISTRATION_CONFLICT', '原账号身份尚未确认，请联系管理员');
          const recovered = ready(status);
          if (!recovered.uid) error('INVALID_IDENTITY_RESPONSE', '原账号身份尚未确认，请联系管理员');
          return { ...recovered, role: status.role, legacyRecovery: true };
        }
        if (!['anchor', 'operator'].includes(status.role)) error('INVALID_IDENTITY_RESPONSE', '注册身份尚未确认，本机原信息已保留');
        if (status.role !== reservation.value.role) {
          reservation.value = { ...reservation.value, role: status.role };
          await saveReservation(reservation.key, reservation.value, proof);
        }
        if (status.role !== role) error('REGISTRATION_CONFLICT', `该姓名已在服务端预约为${status.role === 'operator' ? '运营' : '主播'}，请使用原身份继续；更正身份请联系管理员`);
        if (status.state === 'ready') {
          const data = ready(status);
          if (!data.uid) error('INVALID_IDENTITY_RESPONSE', '加入身份尚未确认，请稍后继续原操作');
          return data;
        }
        if (status.state !== 'reserved' || status.requiresPassword !== true) error('REGISTRATION_PENDING', '加入尚未确认，请稍后继续原操作');
      } catch (failure) {
        if (failure.code !== 'NOT_FOUND') throw failure;
        if (legacyRecovery) error('LEGACY_REGISTRATION_PENDING', '原注册操作尚未确认，安全重试信息已保留；请使用姓名密码登录或联系管理员恢复');
        // Keep the same operation and secret even when changing an unsent role.
        // A racing original request is still protected by the SQL role guard;
        // the next roleless status reads back whichever role actually committed.
        reservation.value = { ...reservation.value, role };
        await saveReservation(reservation.key, reservation.value, proof);
      }
    }
    const result = await request({ action: 'register', ...proof, role, password });
    if (result.role !== role) error('REGISTRATION_CONFLICT', '注册角色尚未确认，请保留原角色并联系管理员');
    const data = ready(result);
    if (!data.uid) error('INVALID_IDENTITY_RESPONSE', '加入身份尚未确认，请稍后继续原操作');
    // Conditional writes keep late old-tab responses from restoring retired secrets.
    await saveReservation(reservation.key, { ...reservation.value, state: 'ready', uid: data.uid, username: data.username }, proof);
    return data;
  }
  return { enabled, resolve, register, restoreRecovery };
}
