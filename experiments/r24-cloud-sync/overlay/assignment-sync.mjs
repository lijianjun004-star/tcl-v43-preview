// Credentials live only in the current page. The assignment API identifies
// users from verified access tokens, never from a name entered in the app.
const loopback = url => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
const text = value => typeof value === 'string' ? value : '';

export function createAssignmentSync(settings, pageUrl = location.href) {
  if (!settings?.apiBase) return null;

  const api = new URL(settings.apiBase);
  const page = new URL(pageUrl);
  const localTest = Boolean(settings.testAuthUrl);
  const envId = text(settings.envId);
  if (api.username || api.password || api.search || api.hash) {
    throw new Error('作业服务地址配置无效');
  }
  let auth;
  if (localTest) {
    auth = new URL(settings.testAuthUrl);
    if (![page, api, auth].every(loopback) || auth.username || auth.password) {
      throw new Error('测试登录仅限本机');
    }
  } else {
    if (api.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(envId)) {
      throw new Error('请配置 CloudBase 环境 ID 和 HTTPS 作业服务地址');
    }
    auth = new URL(`https://${envId}.api.tcloudbasegateway.com/auth/v1/signin`);
  }

  const base = api.href.replace(/\/$/, '');
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
        const message = response.status === 401 ? '登录已失效，请重新登录后继续'
          : text(data?.error?.message) || `请求失败（HTTP ${response.status}）`;
        throw new Error(message);
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
    if (!token) throw new Error('请先登录云端账号');
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

  return {
    storageScope: localTest ? base : envId,
    get principal() { return principal; },
    async signIn(username, password) {
      let deviceId;
      try {
        deviceId = localStorage.getItem('tcl-sync-device-id');
        if (!deviceId) {
          deviceId = crypto.randomUUID();
          localStorage.setItem('tcl-sync-device-id', deviceId);
        }
      } catch { deviceId = crypto.randomUUID(); }
      const session = await request(auth, {
        method: 'POST', body: { username, password },
        headers: localTest ? {} : { 'x-device-id': deviceId },
      });
      if (typeof session.access_token !== 'string' || !session.access_token) {
        throw new Error('登录失败，请检查账号及密码');
      }
      token = session.access_token;
      try {
        const result = await get('/me');
        const member = result.principal;
        if (!member || !['anchor', 'operator'].includes(member.role) ||
            !text(member.id) || !text(member.displayName)) {
          throw new Error('当前账号未开通主播或运营权限');
        }
        principal = Object.freeze({ id: member.id, role: member.role, displayName: member.displayName });
        return principal;
      } catch (error) {
        token = null;
        principal = null;
        throw error;
      }
    },
    signOut() { token = null; principal = null; },
    listAssignments: () => list('/assignments', 'assignments'),
    publish: assignment => get('/assignments', 'POST', { assignment, recipientIds: [] }),
    submit: snapshot => get('/assignments/' + encodeURIComponent(snapshot.assignmentId) + '/submissions', 'POST', { snapshot }),
    submissions: assignmentId => list('/assignments/' + encodeURIComponent(assignmentId) + '/submissions', 'submissions'),
  };
}
