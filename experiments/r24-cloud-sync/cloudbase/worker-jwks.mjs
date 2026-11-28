import {get} from 'node:https';

export const jwksUrl = 'https://token.actions.githubusercontent.com/.well-known/jwks';
const maxBodyBytes = 65536;
const retryableCodes = new Set(['ABORT_ERR', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND']);

function load(getImpl, headers, signal, family) {
  return new Promise((resolve, reject) => {
    const req = getImpl(jwksUrl, {headers, signal, family, rejectUnauthorized: true}, res => {
      if (res.statusCode !== 200) {
        resolve(new Response(null, {status: res.statusCode}));
        res.destroy();
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('error', reject);
      res.on('aborted', () => reject(Object.assign(new Error('Incomplete issuer response'), {code: 'ECONNRESET'})));
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBodyBytes) {
          reject(new Error('Oversized issuer response'));
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(new Response(Buffer.concat(chunks))));
    });
    req.on('error', reject);
  });
}

// Node's native HTTPS transport is reachable from the Shanghai Event function.
// No redirects. Both address-family attempts share the caller's deadline and
// validate TLS against the original GitHub hostname.
export function createIssuerFetch({getImpl = get, log = console.info} = {}) {
  return async (url, options) => {
    if (String(url) !== jwksUrl || options.method !== 'GET' || !options.signal) throw new Error('Invalid issuer request');
    const headers = Object.fromEntries(new Headers(options.headers));
    const ipv4Signal = AbortSignal.any([options.signal, AbortSignal.timeout(6500)]);
    let response;
    let transport;
    try {
      response = await load(getImpl, headers, ipv4Signal, 4);
      transport = 'FETCHED_IPV4';
    } catch (error) {
      if (options.signal.aborted || !retryableCodes.has(error?.code)) throw error;
      response = await load(getImpl, headers, options.signal, undefined);
      transport = 'FETCHED_DEFAULT_FAMILY';
    }
    if (response.ok) log('R24_SCORE_WORKER_JWKS', transport);
    return response;
  };
}
