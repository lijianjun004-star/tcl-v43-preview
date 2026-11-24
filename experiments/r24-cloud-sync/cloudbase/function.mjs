import cloudbase from '@cloudbase/node-sdk';
import {createApi} from './portable/api.mjs';
import {createAuthenticator} from './cloudbase-identity.mjs';
import {createDatabaseAdapter} from './cloudbase-store.mjs';
import {createGatewayHandler} from './gateway.mjs';
import {readFunctionConfig} from './function-config.mjs';

function createFunction(runtimeNamespace) {
  const {envId, prefix, allowedOrigins} = readFunctionConfig(process.env, runtimeNamespace);
  const cloudApp = cloudbase.init({env: envId, region: 'ap-shanghai', timeout: 12_000});
  const {getEnrollment, directory, store} = createDatabaseAdapter(cloudApp.rdb(), prefix);
  const authenticate = createAuthenticator({envId, getEnrollment});
  return createGatewayHandler(createApi({authenticate, directory, store, allowedOrigins, basePath: ''}));
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
