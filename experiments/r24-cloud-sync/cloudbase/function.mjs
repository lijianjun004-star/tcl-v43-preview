import cloudbase from '@cloudbase/node-sdk';
import {createApi} from './portable/api.mjs';
import {createAuthenticator} from './cloudbase-identity.mjs';
import {createDatabaseAdapter} from './cloudbase-store.mjs';
import {createGatewayHandler} from './gateway.mjs';

const publishedEnvironment = 'unknown-roadrunner-d7cap6e21f517';

function configuredOrigins(raw = '') {
  return raw.split(',').map(origin => origin.trim()).filter(Boolean).map(origin => {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('Invalid allowed origin');
    return url.origin;
  });
}

function createFunction() {
  if (process.env.TCL_R24_SYNC_ENABLED !== 'true') throw new Error('Cloud sync not enabled');
  const envId = process.env.TCL_R24_SYNC_ENV_ID;
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(envId ?? '') || envId === publishedEnvironment) {
    throw new Error('An isolated CloudBase environment is required');
  }
  // The platform sets this value in the CloudBase function runtime.
  // One function instance cannot elect to read an unrelated environment.
  const runtimeEnvironment = process.env.TCB_ENV || process.env.SCF_NAMESPACE;
  if (runtimeEnvironment !== envId) throw new Error('CloudBase runtime environment mismatch');
  const prefix = process.env.TCL_R24_SYNC_COLLECTION_PREFIX || 'tcl_r24_sync_v1';
  if (!/^tcl_r24_sync_[a-z0-9_]{1,22}$/.test(prefix)) throw new Error('Invalid collection prefix');
  const allowedOrigins = configuredOrigins(process.env.TCL_R24_SYNC_ORIGINS);
  const cloudApp = cloudbase.init({env: envId});
  const {getEnrollment, directory, store} = createDatabaseAdapter(cloudApp.database(), prefix);
  const authenticate = createAuthenticator({envId, getEnrollment});
  return createGatewayHandler(createApi({authenticate, directory, store, allowedOrigins, basePath: ''}));
}

let handler;
export function main(event) {
  try {
    handler ||= createFunction();
  } catch {
    return {
      statusCode: 503,
      headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'},
      isBase64Encoded: false,
      body: '{"error":"CLOUD_SYNC_NOT_CONFIGURED"}',
    };
  }
  return handler(event);
}
