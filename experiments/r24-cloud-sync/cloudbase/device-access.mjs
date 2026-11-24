import {createHash, randomBytes} from 'node:crypto';
import {readEnrollment} from './cloudbase-identity.mjs';

const devicePrefix = 'r24d_';
const deviceTokenPattern = /^r24d_[0-9a-f]{64}$(?![\s\S])/;
const activationCodePattern = /^R24-[0-9a-f]{24}$(?![\s\S])/;
const deviceLifetimeMs = 90 * 24 * 60 * 60 * 1000;
const maxActivationBytes = 4096;
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');

function activeDevice(grant, deviceDigest, now) {
  return Boolean(grant && grant.used_at && !grant.revoked_at && grant.device_digest === deviceDigest &&
    Date.parse(grant.device_expires_at) > now);
}

function activationReady(grant, now) {
  return Boolean(grant && !grant.used_at && !grant.revoked_at && Date.parse(grant.activation_expires_at) > now);
}

function enrollmentName(name) {
  return typeof name === 'string' ? name.trim().normalize('NFC') : '';
}

function response(body, status, headers) {
  return Response.json(body, {status, headers: {
    ...headers, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  }});
}

export function createDeviceAccess({grants, getEnrollment, authenticateNative, allowedOrigins, now = Date.now}) {
  const origins = new Set(allowedOrigins);

  const enrollment = async id => {
    const principal = readEnrollment(await getEnrollment(id));
    return principal?.id === id ? principal : null;
  };

  async function authenticate(token) {
    if (typeof token !== 'string' || !token.startsWith(devicePrefix)) return authenticateNative(token);
    if (!deviceTokenPattern.test(token)) return null;
    const proof = digest(token);
    const grant = await grants.findByDevice(proof);
    return activeDevice(grant, proof, now()) ? enrollment(grant.enrollment_id) : null;
  }

  async function handleDeviceRequest(request, handle) {
    const path = new URL(request.url).pathname;
    const issuing = path === '/device/code';
    if ((!issuing && path !== '/device/activate') || request.method === 'OPTIONS') return handle(request);
    const origin = request.headers.get('origin');
    const cors = {vary: 'Origin'};
    if (origin && !origins.has(origin)) {
      return response({error: {code: 'ORIGIN_DENIED', message: '来源未获授权'}}, 403, cors);
    }
    if (origin) cors['access-control-allow-origin'] = origin;
    if (request.method !== 'POST') {
      return response({error: {code: 'METHOD_NOT_ALLOWED', message: '此接口仅支持 POST'}}, 405, {...cors, allow: 'POST, OPTIONS'});
    }
    const invalid = () => response({error: issuing
      ? {code: 'DEVICE_AUTH_REQUIRED', message: '请先在已启用的设备上进入工作台'}
      : {code: 'ACTIVATION_INVALID', message: '请核对已登记姓名和启用码，或联系运营获取新码'}}, 401, cors);
    const invalidBody = () => response({error: {code: 'BODY_INVALID', message: '请求体须为不含身份字段的空对象'}}, 400, cors);
    const bearer = /^Bearer ([^\s,]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (issuing && (!bearer || !deviceTokenPattern.test(bearer))) return invalid();
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return response({error: {code: 'JSON_REQUIRED', message: '请求须使用 application/json'}}, 415, cors);
    }

    let input;
    try {
      const body = await request.arrayBuffer(); // The gateway already limits inbound request bodies.
      if (body.byteLength > maxActivationBytes) return response({error: {code: 'PAYLOAD_TOO_LARGE', message: '请求内容过大'}}, 413, cors);
      input = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(body));
    } catch {
      return issuing ? invalidBody() : invalid();
    }
    if (issuing) {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) return invalidBody();
      try {
        const code = 'R24-' + randomBytes(12).toString('hex');
        const expiresAt = await grants.issueCode({issuerDeviceDigest: digest(bearer), codeDigest: digest(code)});
        return expiresAt ? response({code, expiresAt}, 200, cors) : invalid();
      } catch {
        return response({error: {code: 'SERVICE_ERROR', message: '服务暂不可用，请稍后重试'}}, 503, cors);
      }
    }
    const displayName = enrollmentName(input?.displayName);
    const {code, deviceToken} = input || {};
    if (!displayName || displayName.length > 40 || typeof code !== 'string' || !activationCodePattern.test(code) ||
        typeof deviceToken !== 'string' || !deviceTokenPattern.test(deviceToken)) return invalid();

    try {
      const codeDigest = digest(code);
      const deviceDigest = digest(deviceToken);
      let grant = await grants.findByCode(codeDigest);
      const start = now();
      if (!activeDevice(grant, deviceDigest, start) && !activationReady(grant, start)) return invalid();
      const principal = await enrollment(grant.enrollment_id);
      if (!principal || enrollmentName(principal.displayName) !== displayName) return invalid();

      if (!activeDevice(grant, deviceDigest, start)) {
        const claimTime = now();
        grant = await grants.claim({
          codeDigest,
          enrollmentId: principal.id,
          deviceDigest,
          usedAt: new Date(claimTime).toISOString(),
          deviceExpiresAt: new Date(claimTime + deviceLifetimeMs).toISOString(),
        }) || await grants.findByCode(codeDigest);
        if (!activeDevice(grant, deviceDigest, now()) || grant.enrollment_id !== principal.id) return invalid();
      }
      const {id, role} = principal;
      return response({principal: {id, role, displayName: principal.displayName}}, 200, cors);
    } catch {
      return response({error: {code: 'SERVICE_ERROR', message: '服务暂不可用，请稍后重试'}}, 503, cors);
    }
  }

  return {authenticate, handleDeviceRequest};
}
