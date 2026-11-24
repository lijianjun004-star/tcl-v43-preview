// The API verifies an opaque, revocable binding scoped to this R24 pilot.
// A displayed name is never used as proof of identity.
const loopback = url => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
const text = value => typeof value === 'string' ? value : '';
export const normalizeDisplayName = value => text(value).normalize('NFC').trim();
const devicePattern = /^r24d_[a-f0-9]{64}$/;
const deviceCodeFormatHint = '设备码格式不符。R24 云同步试点设备码以 R24- 开头，共 28 个字符，后 24 位为数字 0–9 或字母 a–f。请从本试点已绑定设备完整复制。';

export function normalizeDeviceCode(value) {
  const compact = text(value).normalize('NFKC')
    .replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
  const match = /^r24-([a-f0-9]{24})$/i.exec(compact);
  return match ? 'R24-' + match[1].toLowerCase() : null;
}

function newDeviceToken() {
  const random = crypto.getRandomValues(new Uint8Array(32));
  return 'r24d_' + Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
}

function readBinding(key) {
  try {
    const binding = JSON.parse(localStorage.getItem(key));
    if (binding && typeof binding.name === 'string' &&
        devicePattern.test(binding.token) && typeof binding.confirmed === 'boolean') return binding;
  } catch { /* Unavailable or unreadable binding. */ }
  return null;
}

function writeBinding(key, binding) {
  try {
    localStorage.setItem(key, JSON.stringify(binding));
  } catch {
    throw new Error('此浏览器无法保存设备绑定，请使用非无痕浏览器重试');
  }
}

export function createAssignmentSync(settings, pageUrl = location.href) {
  if (!settings?.apiBase) return null;

  const api = new URL(settings.apiBase);
  const page = new URL(pageUrl);
  const localTest = settings.testMode === true;
  const envId = text(settings.envId);
  if (api.username || api.password || api.search || api.hash) {
    throw new Error('作业服务地址配置无效');
  }
  if (localTest ? ![page, api].every(loopback) :
    api.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(envId)) {
    throw new Error('作业服务环境配置无效');
  }

  const base = api.href.replace(/\/$/, '');
  const bindingKey = 'tcl-r24-sync-binding-v1:' + base;
  let token = null;
  let principal = null;

  async function request(url, { method = 'GET', body, headers = {} } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        method, signal: controller.signal, cache: 'no-store',
        credentials: 'omit', redirect: 'error',
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        const message = text(data?.error?.message) || `请求失败（HTTP ${response.status}）`;
        throw Object.assign(new Error(message), {status: response.status});
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('请求超时，结果尚未确认，请重试');
      if (error instanceof TypeError) throw new Error('网络请求失败，结果尚未确认，请检查连接后重试');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function get(path, method = 'GET', body) {
    if (!token) throw new Error('请先通过姓名进入');
    return request(base + path, { method, body, headers: { Authorization: `Bearer ${token}` } });
  }

  async function list(path, key) {
    const rows = [];
    const seen = new Set();
    let cursor;
    do {
      const result = await get(path + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
      if (!Array.isArray(result[key])) throw new Error('服务返回的数据格式无效');
      rows.push(...result[key]);
      cursor = result.nextCursor;
      if (cursor && (typeof cursor !== 'string' || seen.has(cursor) || seen.size >= 199)) {
        throw new Error('服务返回的分页信息无效');
      }
      if (cursor) seen.add(cursor);
    } while (cursor);
    return rows;
  }

  function confirmMember(result, name) {
    const member = result?.principal;
    if (!member || !['anchor', 'operator'].includes(member.role) ||
        !text(member.id) || normalizeDisplayName(member.displayName) !== name) {
      throw new Error('设备绑定与所填姓名不匹配');
    }
    principal = Object.freeze({id: member.id, role: member.role, displayName: member.displayName});
    return principal;
  }

  return {
    storageScope: localTest ? base : envId,
    get principal() { return principal; },
    hasSavedBinding: () => readBinding(bindingKey)?.confirmed === true,
    async signIn(displayName, rawCode = '') {
      const name = normalizeDisplayName(displayName);
      if (!name || name.length > 40) throw new Error('请输入有效姓名');
      const stored = readBinding(bindingKey);
      const binding = stored?.name === name ? stored : null;
      token = null;
      principal = null;

      if (!rawCode) {
        if (!binding) return null;
        token = binding.token;
        try {
          const member = confirmMember(await get('/me'), name);
          if (!binding.confirmed) writeBinding(bindingKey, {...binding, confirmed: true});
          return member;
        } catch (error) {
          token = null;
          principal = null;
          if (error.status === 401) return null;
          throw error;
        }
      }

      const code = normalizeDeviceCode(rawCode);
      if (!code) throw new Error(deviceCodeFormatHint);
      const pending = binding && !binding.confirmed ? binding : {name, token: newDeviceToken(), confirmed: false};
      writeBinding(bindingKey, pending);
      try {
        const result = await request(base + '/device/activate', {
          method: 'POST', body: {displayName: name, code, deviceToken: pending.token},
        });
        const member = confirmMember(result, name);
        writeBinding(bindingKey, {...pending, confirmed: true});
        token = pending.token;
        return member;
      } catch (error) {
        token = null;
        principal = null;
        throw error;
      }
    },
    signOut() { token = null; principal = null; },
    async issueDeviceCode() {
      const result = await get('/device/code', 'POST', {});
      const expiry = Date.parse(result.expiresAt);
      if (!/^R24-[a-f0-9]{24}$/.test(text(result.code)) || !Number.isFinite(expiry)) {
        throw new Error('设备码结果未确认，请重新生成');
      }
      return {code: result.code, expiresAt: result.expiresAt};
    },
    listAssignments: () => list('/assignments', 'assignments'),
    publish: assignment => get('/assignments', 'POST', { assignment, recipientIds: [] }),
    submit: snapshot => get('/assignments/' + encodeURIComponent(snapshot.assignmentId) + '/submissions', 'POST', { snapshot }),
    submissions: assignmentId => list('/assignments/' + encodeURIComponent(assignmentId) + '/submissions', 'submissions'),
  };
}
