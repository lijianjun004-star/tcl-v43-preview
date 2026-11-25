import {createHash, randomBytes} from 'node:crypto';
import {isIP} from 'node:net';
import {readEnrollment} from './cloudbase-identity.mjs';

const devicePrefix = 'r24d_';
const deviceTokenPattern = /^r24d_[0-9a-f]{64}$(?![\s\S])/;
const activationCodePattern = /^R24-[0-9a-f]{24}$(?![\s\S])/;
const maxActivationBytes = 4096;
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const validRole = role => role === 'anchor' || role === 'operator';

export function normalizeEnrollmentName(raw) {
  if (typeof raw !== 'string' || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(raw)) return '';
  const name = raw.normalize('NFKC').trim();
  const length = [...name].length;
  return length >= 2 && length <= 30 && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(name) ? name : '';
}

function response(body, status, headers) {
  return Response.json(body, {status, headers: {
    ...headers, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  }});
}

function activeDevice(grant, deviceDigest, now) {
  return Boolean(grant && grant.used_at && !grant.revoked_at && grant.device_digest === deviceDigest &&
    Date.parse(grant.device_expires_at) > now);
}

function requestClientKey(trustedIp) {
  const version = typeof trustedIp === 'string' && !trustedIp.includes('%') && isIP(trustedIp);
  if (!version) return {clientKey: digest('r24-identity:unknown-gateway-ip'), shared: true};
  const canonicalIp = version === 6 ? new URL(`http://[${trustedIp}]`).hostname : trustedIp;
  return {clientKey: digest('r24-identity:source-ip:' + canonicalIp), shared: false};
}

const enrollmentErrors = {
  invalid: [400, 'NAME_OR_ROLE_INVALID', '请选择身份，填写 2–30 个字符的姓名'],
  unavailable: [403, 'ENROLLMENT_UNAVAILABLE', '该姓名暂不可开通，请联系管理员'],
  ambiguous: [409, 'NAME_AMBIGUOUS', '存在同名登记，请联系管理员核实身份'],
  device_conflict: [409, 'DEVICE_CREDENTIAL_CONFLICT', '此设备凭证已登记或失效，请重新进入'],
};
const activationErrors = {
  CODE_EXPIRED: [401, '设备码已过期或已作废。请在原设备生成新码'],
  CODE_USED: [409, '设备码已被使用。请在原设备生成新码'],
  CODE_MISMATCH: [401, '姓名、登记角色或设备码不匹配。请核对后重试'],
};

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

  async function handleDeviceRequest(request, handle, context = {}) {
    const path = new URL(request.url).pathname;
    const issuing = path === '/device/code';
    const enrolling = path === '/device/auto-enroll';
    if ((!issuing && !enrolling && path !== '/device/activate') || request.method === 'OPTIONS') {
      return handle(request);
    }

    const origin = request.headers.get('origin');
    const cors = {vary: 'Origin'};
    const error = (status, code, message, extra = {}, headers = {}) =>
      response({errorCode: code, error: {code, message}, ...extra}, status, {...cors, ...headers});

    if (origin && !origins.has(origin)) return error(403, 'ORIGIN_DENIED', '来源未获授权');
    if (origin) cors['access-control-allow-origin'] = origin;
    if (request.method !== 'POST') {
      return error(405, 'METHOD_NOT_ALLOWED', '此接口仅支持 POST', {}, {allow: 'POST, OPTIONS'});
    }

    const deviceAuthRequired = () => error(401, 'DEVICE_AUTH_REQUIRED', '请先在已启用的设备上进入工作台');
    const invalidBody = () => error(400, 'BODY_INVALID', issuing ? '请求体须为空对象' : '请求内容格式有误');
    const bearer = /^Bearer ([^\s,]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (issuing && (!bearer || !deviceTokenPattern.test(bearer))) return deviceAuthRequired();
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return error(415, 'JSON_REQUIRED', '请求须使用 application/json');
    }

    try {
      if (!issuing) {
        const action = enrolling ? 'auto-enroll' : 'activate';
        const access = await grants.countAttempt({...requestClientKey(context.clientIp), action});
        if (!access.allowed) {
          return error(429, 'RATE_LIMITED', '请求过于频繁，请稍后再试',
            {retryAfter: access.retryAfter}, {'retry-after': String(access.retryAfter)});
        }
      }

      const body = await request.arrayBuffer(); // The gateway caps inbound body bytes as well.
      if (body.byteLength > maxActivationBytes) return error(413, 'PAYLOAD_TOO_LARGE', '请求内容过大');
      let input;
      try {
        input = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(body));
      } catch {
        return invalidBody();
      }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return invalidBody();

      if (issuing) {
        if (Object.keys(input).length) return invalidBody();
        const code = 'R24-' + randomBytes(12).toString('hex');
        const issued = await grants.issueCode({issuerDeviceDigest: digest(bearer), codeDigest: digest(code)});
        return issued ? response({code, ...issued}, 200, cors) : deviceAuthRequired();
      }

      if (enrolling) {
        const name = normalizeEnrollmentName(input.name);
        if (!name || !validRole(input.role) ||
            typeof input.deviceCredential !== 'string' || !deviceTokenPattern.test(input.deviceCredential)) {
          return error(...enrollmentErrors.invalid);
        }
        const result = await grants.enroll({
          name, role: input.role, deviceDigest: digest(input.deviceCredential), internalDigest: randomBytes(32).toString('hex'),
        });
        if (result.status === 'exists' && validRole(result.registeredRole)) {
          return error(409, 'ALREADY_ENROLLED', '该姓名已登记，请在原设备生成 R24 设备码',
            {registeredRole: result.registeredRole});
        }
        if (Object.hasOwn(enrollmentErrors, result.status)) return error(...enrollmentErrors[result.status]);
        if (result.status !== 'enrolled') throw new Error('Unexpected enrollment response');
        return response({...publicBinding(result), status: 'enrolled'}, 200, cors);
      }

      const name = normalizeEnrollmentName(input.displayName ?? input.name);
      const token = input.deviceToken ?? input.deviceCredential;
      if (!name || (input.role != null && !validRole(input.role)) ||
          typeof token !== 'string' || !deviceTokenPattern.test(token) ||
          typeof input.code !== 'string' || !activationCodePattern.test(input.code)) {
        return error(401, 'CODE_MISMATCH', activationErrors.CODE_MISMATCH[1]);
      }
      const result = await grants.activate({
        name, role: input.role ?? null, deviceDigest: digest(token), codeDigest: digest(input.code),
      });
      if (Object.hasOwn(activationErrors, result.errorCode)) {
        const [httpStatus, message] = activationErrors[result.errorCode];
        const extra = validRole(result.registeredRole) ? {registeredRole: result.registeredRole} : {};
        return error(httpStatus, result.errorCode, message, extra);
      }
      return response(publicBinding(result), 200, cors);
    } catch {
      return error(503, 'SERVICE_ERROR', '服务暂不可用，请稍后重试');
    }
  }

  return {authenticate, handleDeviceRequest};
}

function publicBinding(result) {
  const {id, name, role, deviceId} = result;
  if (typeof id !== 'string' || !id || typeof name !== 'string' || !name || !validRole(role) ||
      typeof deviceId !== 'string' || !deviceId) throw new Error('Invalid device binding response');
  return {name, role, deviceId, principal: {id, role, displayName: name}};
}
