const forwardedHeaders = new Set([
  'authorization', 'origin', 'content-type',
  'access-control-request-method', 'access-control-request-headers',
]);
const maxBodyBytes = 1024 * 1024;
const requestMethods = new Set(['GET', 'HEAD', 'POST', 'OPTIONS']);

function jsonError(statusCode, code) {
  return {
    statusCode,
    headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'},
    isBase64Encoded: false,
    body: JSON.stringify({error: code}),
  };
}

function toRequest(event) {
  if (typeof event?.path !== 'string' || !event.path.startsWith('/') ||
      event.path.startsWith('//') || /[\\?#\x00-\x1f]/.test(event.path)) {
    throw new TypeError('Invalid gateway path');
  }
  const method = event.httpMethod;
  if (!requestMethods.has(method)) throw new TypeError('Invalid gateway method');
  const url = new URL('https://tcl-r24-sync.invalid' + event.path);
  const params = event.queryStringParameters || {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') url.searchParams.append(key, value);
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers || {})) {
    const name = key.toLowerCase();
    if (forwardedHeaders.has(name) && typeof value === 'string') headers.append(name, value);
  }
  let body;
  if (method === 'POST') {
    if (event.body != null && typeof event.body !== 'string') throw new TypeError('Invalid gateway body');
    const raw = event.body ?? '';
    if (raw.length > Math.ceil(maxBodyBytes * 4 / 3) + 8) throw new RangeError('Gateway body too big');
    body = Buffer.from(raw, event.isBase64Encoded === true ? 'base64' : 'utf8');
    if (body.length > maxBodyBytes) throw new RangeError('Gateway body too big');
  }
  return new Request(url, {method, headers, body});
}

export function createGatewayHandler(api) {
  return async (event) => {
    let request;
    try {
      request = toRequest(event);
    } catch (error) {
      return error instanceof RangeError ? jsonError(413, 'PAYLOAD_TOO_LARGE')
        : jsonError(400, 'INVALID_GATEWAY_REQUEST');
    }
    try {
      const response = await api(request);
      return {
        statusCode: response.status,
        headers: {...Object.fromEntries(response.headers.entries()), 'cache-control': 'no-store'},
        isBase64Encoded: false,
        body: await response.text(),
      };
    } catch {
      // Never forward database errors or credentials to callers.
      return jsonError(503, 'SERVICE_UNAVAILABLE');
    }
  };
}
