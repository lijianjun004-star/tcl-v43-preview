import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from '../backend/api.mjs';
import { createMemoryStore } from '../backend/memory-store.mjs';
import { normalizeEnrollmentName } from '../cloudbase/device-access.mjs';

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

export async function startTestSite({ draftGeneration } = {}) {
  let origin;
  let api;
  const requests = [];
  const tokens = new Map();
  const actors = Object.values(identities);
  const unusedCodes = new Map(actors.map(actor => [actor.code, actor]));
  const codeErrors = new Map();
  const lastSelfIssuedCodeByMember = new Map();
  const principal = ({id, role, displayName}) => ({id, role, displayName});
  const status = (res, responseStatus, code, extra = {}) => sendJson(res, responseStatus, {
    errorCode: code, error: { code, message: code }, ...extra,
  });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const path = url.pathname;
    const method = req.method;
    requests.push({ path, method });
    try {
      if (path === apiBasePath + '/device/auto-enroll' && method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const displayName = normalizeEnrollmentName(body.name);
        const role = body.role;
        const token = body.deviceCredential;
        if (!displayName || !['anchor', 'operator'].includes(role) || !/^r24d_[a-f0-9]{64}$/.test(token)) {
          return status(res, 400, 'NAME_OR_ROLE_INVALID');
        }
        const registered = actors.find(actor => normalizeEnrollmentName(actor.displayName) === displayName);
        if (registered && tokens.get(token)?.id !== registered.id) {
          return status(res, 409, 'ALREADY_ENROLLED', { registeredRole: registered.role });
        }
        if (tokens.has(token) && tokens.get(token)?.id !== registered?.id) {
          return status(res, 409, 'DEVICE_CREDENTIAL_CONFLICT');
        }
        const actor = registered || { id: randomUUID(), teamId: 'team-a', displayName, role, active: true };
        if (!registered) actors.push(actor);
        tokens.set(token, actor);
        return sendJson(res, 200, {
          status: 'enrolled', name: actor.displayName, role: actor.role,
          deviceId: actor.id, principal: principal(actor),
        });
      }
      if (path === apiBasePath + '/device/activate' && method === 'POST') {
        const { displayName, code, deviceToken, role: chosenRole } = JSON.parse(await readBody(req));
        const prior = codeErrors.get(code);
        const actor = unusedCodes.get(code) || prior?.actor;
        if (!actor || normalizeEnrollmentName(actor.displayName) !== normalizeEnrollmentName(displayName) ||
            !/^r24d_[0-9a-f]{64}$/.test(deviceToken)) {
          return status(res, 401, 'CODE_MISMATCH');
        }
        if (chosenRole && chosenRole !== actor.role) {
          return status(res, 401, 'CODE_MISMATCH', { registeredRole: actor.role });
        }
        if (prior && prior.deviceToken !== deviceToken) {
          return status(res, prior.error === 'CODE_USED' ? 409 : 401, prior.error);
        }
        if (prior?.deviceToken === deviceToken) return sendJson(res, 200, { principal: principal(actor) });
        if (tokens.has(deviceToken)) return status(res, 401, 'CODE_MISMATCH');
        unusedCodes.delete(code);
        codeErrors.set(code, { actor, deviceToken, error: 'CODE_USED' });
        tokens.set(deviceToken, actor);
        return sendJson(res, 200, { principal: principal(actor) });
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
        if (unusedCodes.delete(oldCode)) codeErrors.set(oldCode, { actor, error: 'CODE_EXPIRED' });
        const code = 'R24-' + randomBytes(12).toString('hex');
        lastSelfIssuedCodeByMember.set(actor.id, code);
        unusedCodes.set(code, actor);
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        return sendJson(res, 200, { code, expiresAt, name: actor.displayName, role: actor.role });
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
      let data = await readFile(target);
      if (mode === 'local' && target.endsWith('/index.html')) {
        data = data.toString('utf8').replace(/<meta\b[^>]*name=["']tcl-r24-sync-mode["'][^>]*>/gi, '');
      }
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
  const clips = new Map();
  api = createApi({
    draftGeneration,
    media: {
      async put(path, _mimeType, bytes) {
        if (!clips.has(path)) clips.set(path, Buffer.from(bytes));
      },
      async get(path) {
        if (!clips.has(path)) throw new Error('Synthetic clip not found');
        return Buffer.from(clips.get(path));
      },
    },
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
