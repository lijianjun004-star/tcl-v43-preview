import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from '../backend/api.mjs';
import { createMemoryStore } from '../backend/memory-store.mjs';

const apiBasePath = '/api/tcl-r24-sync';
const sitePath = fileURLToPath(new URL('../site/', import.meta.url));
const mediaTypes = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm'
};

export const identities = {
  operator: { username: 'fixture-operator', id: 'operator-1', teamId: 'team-a', role: 'operator', displayName: '合成验收运营', active: true },
  anchor: { username: 'fixture-anchor', id: 'anchor-1', teamId: 'team-a', role: 'anchor', displayName: '合成文字主播', active: true },
  foreign: { username: 'fixture-foreign', id: 'anchor-2', teamId: 'team-b', role: 'anchor', displayName: '其他团队测试主播', active: true }
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
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const path = url.pathname;
    const method = req.method;
    requests.push({ path, method });
    try {
      if (path === '/test-auth' && method === 'POST') {
        const { username, password } = JSON.parse(await readBody(req));
        const user = actors.find(entry => entry.username === username);
        if (!user || password !== 'fixture-account-password') {
          return sendJson(res, 401, { error: { message: '合成测试账号或密码错误' } });
        }
        const token = randomUUID();
        tokens.set(token, user);
        return sendJson(res, 200, { access_token: token });
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
            testAuthUrl: origin + '/test-auth'
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
