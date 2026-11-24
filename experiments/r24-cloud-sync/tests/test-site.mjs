import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from '../backend/api.mjs';
import { createMemoryStore } from '../backend/memory-store.mjs';

const apiBasePath = '/api/tcl-r24-sync';
const sitePath = resolve(process.env.TCL_TEST_SITE_DIR || fileURLToPath(new URL('../site/', import.meta.url)));
const mediaTypes = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm'
};

export const identities = {
  operator: { code: 'R24-000000000000000000000001', id: 'operator-1', teamId: 'team-a', role: 'operator', displayName: '合成验收运营', active: true },
  anchor: { code: 'R24-000000000000000000000002', id: 'anchor-1', teamId: 'team-a', role: 'anchor', displayName: '合成文字主播', active: true },
  foreign: { code: 'R24-000000000000000000000003', id: 'anchor-2', teamId: 'team-b', role: 'anchor', displayName: '其他团队测试主播', active: true }
};

async function readBody(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 1_000_000) throw new Error('fixture body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': mediaTypes['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

export async function startTestSite() {
  let origin;
  let api;
  const requests = [];
  const tokens = new Map();
  const actors = Object.values(identities);
  const unusedCodes = new Map(actors.map(actor => [actor.code, actor]));
  const lastSelfIssuedCodeByMember = new Map();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const path = url.pathname;
    const method = req.method;
    requests.push({ path, method });
    try {
      if (path === apiBasePath + '/device/activate' && method === 'POST') {
        const { displayName, code, deviceToken } = JSON.parse(await readBody(req));
        const actor = unusedCodes.get(code);
        if (!actor || actor.displayName !== displayName ||
            !/^r24d_[0-9a-f]{64}$/.test(deviceToken) || tokens.has(deviceToken)) {
          return sendJson(res, 401, {
            error: { code: 'INVALID_ACTIVATION', message: '姓名或设备绑定码无效' },
          });
        }
        const { id, role } = actor;
        unusedCodes.delete(code);
        tokens.set(deviceToken, actor);
        return sendJson(res, 200, { principal: { id, role, displayName } });
      }

      if (path === apiBasePath + '/device/code' && method === 'POST') {
        const token = /^Bearer (r24d_[0-9a-f]{64})$/.exec(req.headers.authorization || '')?.[1];
        const actor = tokens.get(token);
        if (!actor) {
          return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: '设备尚未绑定' } });
        }
        const body = JSON.parse(await readBody(req));
        if (body === null || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== 0) {
          return sendJson(res, 400, { error: { code: 'INVALID_INPUT', message: '请求必须为空对象' } });
        }
        const oldCode = lastSelfIssuedCodeByMember.get(actor.id);
        unusedCodes.delete(oldCode);
        const code = 'R24-' + randomBytes(12).toString('hex');
        lastSelfIssuedCodeByMember.set(actor.id, code);
        unusedCodes.set(code, actor);
        const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
        return sendJson(res, 200, { code, expiresAt });
      }

      if (path.startsWith(apiBasePath + '/')) {
        const headers = new Headers(req.headers);
        const request = new Request(origin + path.slice(apiBasePath.length) + url.search, {
          method,
          headers,
          body: method === 'POST' ? await readBody(req) : undefined
        });
        const result = await api(request);
        res.writeHead(result.status, Object.fromEntries(result.headers));
        return res.end(Buffer.from(await result.arrayBuffer()));
      }

      const match = /^\/(sync|local)\/(.*)$/.exec(path);
      if (!match) return sendJson(res, 404, { error: 'Unknown fixture route' });
      const [, mode, filename] = match;
      if (filename === 'app-config.json') {
        return sendJson(res, 200, mode === 'sync' ? {
          assignmentSync: {
            apiBase: origin + apiBasePath,
            testMode: true
          }
        } : {});
      }

      const target = resolve(sitePath, filename || 'index.html');
      if (!target.startsWith(resolve(sitePath) + sep)) return sendJson(res, 404, { error: 'Not found' });
      const data = await readFile(target);
      res.writeHead(200, {
        'Content-Type': mediaTypes[extname(target)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    } catch (error) {
      const status = error.code === 'ENOENT' ? 404 : 500;
      sendJson(res, status, { error: { message: error.message } });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = 'http://127.0.0.1:' + server.address().port;
  api = createApi({
    authenticate: async token => tokens.get(token) || null,
    store: createMemoryStore(),
    directory: {
      async listAnchors(teamId) {
        return actors.filter(actor => actor.role === 'anchor' && actor.teamId === teamId);
      }
    },
    allowedOrigins: [origin]
  });
  return {
    origin,
    requests,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}
