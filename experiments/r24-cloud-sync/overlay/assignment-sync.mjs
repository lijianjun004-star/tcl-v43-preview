// The API verifies an opaque, revocable binding scoped to this R24 pilot.
// A displayed name is never used as proof of identity.
const loopback = url => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
const text = value => typeof value === 'string' ? value : '';
export const normalizeDisplayName = value => text(value).trim().normalize('NFKC').trim();
const roles = new Set(['anchor', 'operator']);

function validateName(value) {
  const canonical = normalizeDisplayName(value);
  const length = [...canonical].length;
  if (/[\p{Cc}\p{Cf}]/u.test(text(value)) || length < 2 || length > 30) {
    throw new Error('姓名须为 2–30 个字符，不能含控制字符');
  }
  return canonical;
}
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
  const pendingKey = bindingKey + ':pending';
  const signedOutKey = bindingKey + ':signed-out';
  let token = null;
  let principal = null;
  let draftGenerationInFlight = false;

  async function request(url, { method = 'GET', body, headers = {}, timeoutMs = 15000 } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
        throw Object.assign(new Error(message), {
          status: response.status, code: text(data?.errorCode || data?.error?.code),
          registeredRole: roles.has(data?.registeredRole) ? data.registeredRole : null,
        });
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

  async function get(path, method = 'GET', body, timeoutMs) {
    if (!token) throw new Error('请先通过姓名进入');
    return request(base + path, { method, body, timeoutMs, headers: { Authorization: `Bearer ${token}` } });
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

  function verifiedMember(result, name) {
    const member = result?.principal;
    if (!member || !['anchor', 'operator'].includes(member.role) ||
        !text(member.id) || normalizeDisplayName(member.displayName) !== name) {
      throw new Error('设备绑定与所填姓名不匹配');
    }
    return Object.freeze({id: member.id, role: member.role, displayName: member.displayName});
  }

  function forget(key) {
    try { localStorage.removeItem(key); } catch {}
  }

  function intentionallySignedOut() {
    try { return localStorage.getItem(signedOutKey) === '1'; } catch { return false; }
  }

  function accept(member, binding) {
    writeBinding(bindingKey, {name: member.displayName, token: binding.token, confirmed: true});
    forget(pendingKey);
    forget(signedOutKey);
    token = binding.token;
    principal = member;
    return member;
  }

  async function checkBinding(binding) {
    try {
      const result = await request(base + '/me', {headers: { Authorization: `Bearer ${binding.token}` }});
      return verifiedMember(result, normalizeDisplayName(binding.name));
    } catch (error) {
      if (error.status === 401) return null;
      throw error;
    }
  }

  function pendingDevice(name) {
    const previous = readBinding(pendingKey);
    if (previous && previous.name === name && !previous.confirmed) return previous;
    const binding = {name, token: newDeviceToken(), confirmed: false};
    writeBinding(pendingKey, binding);
    return binding;
  }

  return {
    storageScope: localTest ? base : envId,
    get principal() { return principal; },
    hasSavedBinding: () => readBinding(bindingKey)?.confirmed === true,
    async restoreSession() {
      const stored = readBinding(bindingKey);
      if (!stored?.confirmed || intentionallySignedOut()) return null;
      const member = await checkBinding(stored);
      if (member) return accept(member, stored);
      forget(bindingKey);
      return null;
    },
    async enter({displayName, role, rawCode = '', allowEnrollment = true}) {
      const name = validateName(displayName);
      if (!roles.has(role)) throw new Error('请选择主播或直播运营');
      const stored = readBinding(bindingKey);
      const local = stored && normalizeDisplayName(stored.name) === name ? stored : null;
      token = null;
      principal = null;
      try {
        if (rawCode) {
          const code = normalizeDeviceCode(rawCode);
          if (!code) throw new Error(deviceCodeFormatHint);
          const binding = pendingDevice(name);
          const result = await request(base + '/device/activate', {
            method: 'POST', body: {displayName: name, code, deviceToken: binding.token, role},
          });
          return {member: accept(verifiedMember(result,name),binding), opened: false};
        }
        if (local) {
          const member = await checkBinding(local);
          if (member) {
            if (member.role !== role) return {member: null, boundRole: member.role};
            return {member: accept(member, local), opened: false};
          }
          forget(bindingKey);
        }
        if (!allowEnrollment) return {member: null, needsBinding: true};
        const binding = pendingDevice(name);
        try {
          const result = await request(base + '/device/auto-enroll', {
            method: 'POST', body: {name, role, deviceCredential: binding.token},
          });
          if (result.status !== 'enrolled') throw new Error('自动开通未确认，请重试');
          return {member: accept(verifiedMember(result,name),binding), opened: true};
        } catch (error) {
          if (error.status === 409 && error.code === 'ALREADY_ENROLLED' && error.registeredRole) {
            return {member: null, needsBinding: true, registeredRole: error.registeredRole};
          }
          if (error.code === 'DEVICE_CREDENTIAL_CONFLICT') forget(pendingKey);
          throw error;
        }
      } catch (error) {
        token = null;
        principal = null;
        throw error;
      }
    },
    signOut(manual = false) {
      token = null; principal = null;
      if (manual) {
        try { localStorage.setItem(signedOutKey, '1'); } catch {}
      }
    },
    async issueDeviceCode() {
      const result = await get('/device/code', 'POST', {});
      const expiry = Date.parse(result.expiresAt);
      if (!/^R24-[a-f0-9]{24}$/.test(text(result.code)) || !Number.isFinite(expiry)) {
        throw new Error('设备码结果未确认，请重新生成');
      }
      if (normalizeDisplayName(result.name) !== normalizeDisplayName(principal?.displayName) ||
          result.role !== principal?.role) throw new Error('签发身份未确认，请重新进入工作台');
      return {code: result.code, expiresAt: result.expiresAt, name: result.name, role: result.role};
    },
    async getDraftAvailability() {
      if (principal?.role !== 'operator') return false;
      try {
        const result = await get('/assignments/draft');
        if (typeof result.available !== 'boolean') throw new Error('出题服务状态未确认');
        return result.available;
      } catch (error) {
        if (error.status === 404) return false;
        throw error;
      }
    },
    async generateDraft({ material, boardId, platform, count }) {
      if (principal?.role !== 'operator') throw new Error('请先进入直播运营工作台');
      if (draftGenerationInFlight) throw new Error('已有出题请求正在处理，请稍后重试');
      draftGenerationInFlight = true;
      try {
        return await get('/assignments/draft', 'POST', { material, boardId, platform, count }, 35000);
      } finally {
        draftGenerationInFlight = false;
      }
    },
    listAssignments: () => list('/assignments', 'assignments'),
    publish: assignment => get('/assignments', 'POST', { assignment, recipientIds: [] }),
    submit: snapshot => get('/assignments/' + encodeURIComponent(snapshot.assignmentId) + '/submissions', 'POST', { snapshot }),
    submissions: assignmentId => list('/assignments/' + encodeURIComponent(assignmentId) + '/submissions', 'submissions'),
    claim: assignmentId => get('/assignments/' + encodeURIComponent(assignmentId) + '/claim', 'POST', {}),
    progress: assignmentId => list('/assignments/' + encodeURIComponent(assignmentId) + '/progress', 'claims'),
    mySubmissions: assignmentId => list('/assignments/' + encodeURIComponent(assignmentId) + '/my-submissions', 'submissions'),
    uploadSubmissionAudio: (assignmentId, submissionId, segment) =>
      get(submissionAudioPath(assignmentId, submissionId), 'POST', segment),
    submissionAudio: (assignmentId, submissionId, questionId) =>
      get(submissionAudioPath(assignmentId, submissionId) + '?questionId=' + encodeURIComponent(questionId)),
  };
}

function submissionAudioPath(assignmentId, submissionId) {
  return '/assignments/' + encodeURIComponent(assignmentId) + '/submissions/' + encodeURIComponent(submissionId) + '/audio';
}
