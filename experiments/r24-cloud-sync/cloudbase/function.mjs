import cloudbase from '@cloudbase/node-sdk';
import {createApi} from './portable/api.mjs';
import {createAuthenticator} from './cloudbase-identity.mjs';
import {createDatabaseAdapter} from './cloudbase-store.mjs';
import {createGatewayHandler} from './gateway.mjs';
import {readFunctionConfig} from './function-config.mjs';
import {createDeviceAccess} from './device-access.mjs';
import {createDeviceGrantStore} from './device-grants-store.mjs';

function createFunction(runtimeNamespace) {
  const {envId, prefix, allowedOrigins} = readFunctionConfig(process.env, runtimeNamespace);
  const cloudApp = cloudbase.init({env: envId, region: 'ap-shanghai', timeout: 12_000});
  const db = cloudApp.rdb();
  const {getEnrollment, directory, store} = createDatabaseAdapter(db, prefix);
  const authenticateNative = createAuthenticator({envId, getEnrollment});
  const grants = createDeviceGrantStore(db, prefix);
  const {authenticate, handleDeviceRequest} = createDeviceAccess({grants, getEnrollment, authenticateNative, allowedOrigins});
  const api = createApi({authenticate, directory, store, allowedOrigins, basePath: ''});
  return createGatewayHandler(request => handleDeviceRequest(request, api));
}

let handler;
export function main(event, context) {
  try {
    handler ||= createFunction(context?.namespace);
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
