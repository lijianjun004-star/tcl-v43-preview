import {webcrypto} from 'node:crypto';
import {createIssuerFetch, jwksUrl} from './worker-jwks.mjs';
import {createRemoteJWKSet, customFetch, jwtVerify} from 'jose';

const issuer = 'https://token.actions.githubusercontent.com';
const repository = 'lijianjun004-star/tcl-r24-score-archive';
const ref = 'refs/heads/main';
const audience = 'r24-sh-score-main-v1';

class WorkerVerificationError extends Error {}

// Return only local constants. JOSE exceptions may include token data and claims.
export function oidcFailureReason(error) {
  if (error instanceof WorkerVerificationError) return error.message;
  switch (error?.code) {
    case 'ERR_JWKS_TIMEOUT': return 'JWKS_TIMEOUT';
    case 'ERR_JWKS_NO_MATCHING_KEY': return 'JWKS_UNKNOWN_KEY';
    case 'ERR_JWKS_INVALID': return 'JWKS_INVALID';
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED': return 'SIGNATURE_INVALID';
    case 'ERR_JOSE_ALG_NOT_ALLOWED': return 'ALGORITHM_INVALID';
    case 'ERR_JWT_EXPIRED': return 'TOKEN_EXPIRED';
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED': return 'CLAIMS_INVALID';
    case 'ERR_JWS_INVALID':
    case 'ERR_JWT_INVALID': return 'TOKEN_MALFORMED';
    default: return 'VERIFICATION_FAILED';
  }
}

export function createGitHubWorkerVerifier({fetchImpl = createIssuerFetch()} = {}) {
  // Some SCF Node 20 runtimes omit the global WebCrypto binding used by jose.
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', {value: webcrypto, configurable: true});
  }
  const keys = createRemoteJWKSet(new URL(jwksUrl), {
    timeoutDuration: 12000, cooldownDuration: 30000, cacheMaxAge: 300000,
    [customFetch]: async (url, options) => {
      let response;
      try { response = await fetchImpl(url, {...options, redirect: 'error'}); }
      catch {
        throw new WorkerVerificationError(options.signal?.aborted ? 'JWKS_TIMEOUT' : 'JWKS_UNREACHABLE');
      }
      if (response.status !== 200) throw new WorkerVerificationError('JWKS_HTTP_ERROR');
      return response;
    },
  });
  return async token => {
    const {payload} = await jwtVerify(token, keys, {
      issuer, audience, algorithms: ['RS256'], maxTokenAge: '10 minutes', clockTolerance: 5,
      requiredClaims: ['iat', 'exp', 'nbf', 'jti', 'sub', 'run_id'],
    });
    if (payload.aud !== audience || payload.repository !== repository || payload.repository_id !== '1474053872' ||
        payload.repository_visibility !== 'private' || payload.ref !== ref ||
        payload.workflow_ref !== repository + '/.github/workflows/r24-private-score-archive.yml@' + ref ||
        typeof payload.sha !== 'string' || !/^[a-f0-9]{40}$/.test(payload.sha) ||
        payload.workflow_sha !== payload.sha || payload.run_attempt !== '1' ||
        !['schedule', 'workflow_dispatch'].includes(payload.event_name) ||
        typeof payload.run_id !== 'string' || !/^[1-9][0-9]*$/.test(payload.run_id) ||
        !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) ||
        payload.exp <= payload.iat || payload.exp - payload.iat > 900) {
      throw new WorkerVerificationError('WORKFLOW_IDENTITY_MISMATCH');
    }
    return true;
  };
}
