import {sign} from '@cloudbase/signature-nodejs';

const maxBytes = 512 * 1024;
const bucketName = 'tcl-r24-sync-v2-audio';
const objectPath = /^submissions\/[0-9a-f]{64}\/[0-9a-f]{64}\.(webm|ogg|m4a|wav|mp3|aac)$/u;
const isCredential = value => typeof value === 'string' && /^\S+$/u.test(value);

function validatePath(path) {
  if (typeof path !== 'string' || !objectPath.test(path)) {
    throw new Error('Invalid pilot audio object path');
  }
}

function storageFailure(operation, error) {
  const rawStatus = Number(error?.statusCode ?? error?.status ?? error?.response?.status);
  const rawCode = String(error?.code ?? error?.error ?? '');
  const status = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus < 600 ? rawStatus : null;
  const code = /^(?:[1-5][0-9]{2}|[A-Za-z][A-Za-z_]{1,35})$/u.test(rawCode) ? rawCode : null;
  console.warn('R24 pilot private audio', {operation, status, code});
  return Object.assign(new Error('CloudBase private storage request failed'), {storageOperation: operation, storageStatus: status});
}

function runtimeCredential(env = {}) {
  const {TENCENTCLOUD_SECRETID: secretId, TENCENTCLOUD_SECRETKEY: secretKey, TENCENTCLOUD_SESSIONTOKEN: sessionToken} = env;
  if ([secretId, secretKey, sessionToken].every(isCredential)) return {secretId, secretKey, sessionToken};
  return null;
}

/** Fixed private CloudBase PG Storage bucket. No tokenized URL leaves this service. */
export function createCloudBaseAudio(cloudApp, envId, fetchImpl = globalThis.fetch, runtimeEnv = process.env) {
  if (typeof envId !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/u.test(envId)) {
    throw new Error('Invalid CloudBase storage environment');
  }
  const host = `${envId}.api.tcloudbasegateway.com`;
  const endpoint = `https://${host}/v1/storages/object`;
  const tokenEndpoint = `https://${host}/auth/v1/token/clientCredential`;

  async function getStorageToken() {
    let token;
    try {
      const runtime = runtimeCredential(runtimeEnv) || runtimeCredential(cloudApp.getCloudbaseContext?.());
      if (runtime) {
        // Match the CloudBase CLI exchange using only SCF's current temporary IAM credential.
        const {secretId, secretKey, sessionToken} = runtime;
        const body = {grant_type: 'client_credentials'};
        const headers = {Host: host, 'Content-Type': 'application/json'};
        const {authorization, timestamp} = sign({
          secretId, secretKey, method: 'POST', url: tokenEndpoint, params: body, headers,
          timestamp: Math.floor(Date.now() / 1000) - 1, isCloudApi: true, withSignedParams: false,
        });
        const response = await fetchImpl(tokenEndpoint, {
          method: 'POST', headers: {...headers, Authorization: `${authorization}, Timestamp=${timestamp}, Token=${sessionToken}`},
          body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(12_000),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
          throw {status: response.status, code: result?.code ?? result?.Code ?? result?.error};
        }
        token = result?.access_token;
      } else {
        // In the pinned Node SDK 4.2.1 this is the same exchange used by rdb().
        token = await cloudApp.request?.reqClass?.getClientCredential?.({origin: `https://${host}`});
        if (!isCredential(token)) {
          const credential = await cloudApp.auth().getClientCredential();
          token = typeof credential === 'string' ? credential : credential?.access_token;
        }
      }
    } catch (error) {
      throw storageFailure('credential-request', error);
    }
    if (!isCredential(token)) throw storageFailure('credential-response');
    return token;
  }

  async function request(operation, path, method, headers, body) {
    const token = await getStorageToken();
    const prefix = method === 'GET' ? '/authenticated' : '';
    try {
      return await fetchImpl(`${endpoint}${prefix}/${bucketName}/${path}`, {
        method, headers: {...headers, Authorization: `Bearer ${token}`}, body,
        redirect: 'error', signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      throw storageFailure(operation, error);
    }
  }

  return {
    async put(path, mimeType, bytes) {
      validatePath(path);
      if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maxBytes) {
        throw new Error('Invalid pilot audio size');
      }
      // Match CloudBase CLI's raw binary upload so the gateway sees the audio MIME type.
      const response = await request('upload-request', path, 'POST', {
        'Content-Type': mimeType, 'Content-Length': String(bytes.length), 'Cache-Control': 'max-age=0',
      }, bytes);
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        // The caller verifies existing bytes before confirming a repeated upload.
        const code = result?.code ?? result?.Code ?? result?.error;
        if (response.status === 409 || code === 'Duplicate' || code === 'ResourceAlreadyExists') return;
        throw storageFailure('upload-response', {status: response.status, code});
      }
      if (typeof result?.Id !== 'string' || !result.Id || typeof result?.Key !== 'string' || !result.Key) {
        throw storageFailure('upload-confirmation');
      }
    },
    async get(path) {
      validatePath(path);
      const response = await request('download-request', path, 'GET', {'Cache-Control': 'no-store'});
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw storageFailure('download-response', {status: response.status, code: result?.code ?? result?.Code ?? result?.error});
      }
      if (!response.body || Number(response.headers.get('content-length')) > maxBytes) {
        await response.body?.cancel();
        throw new Error('Invalid CloudBase audio response size');
      }
      let size = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > maxBytes) throw new Error('Invalid CloudBase audio response size');
        chunks.push(chunk);
      }
      if (size === 0) throw new Error('Invalid CloudBase audio response size');
      return Buffer.concat(chunks, size);
    },
  };
}
