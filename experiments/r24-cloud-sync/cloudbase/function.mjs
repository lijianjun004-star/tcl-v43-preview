import cloudbase from '@cloudbase/node-sdk';
import {createApi} from './portable/api.mjs';
import {createAuthenticator} from './cloudbase-identity.mjs';
import {createDatabaseAdapter} from './cloudbase-store.mjs';
import {createGatewayHandler} from './gateway.mjs';
import {readFunctionConfig} from './function-config.mjs';
import {createDeviceAccess} from './device-access.mjs';
import {createDeviceGrantStore} from './device-grants-store.mjs';
import {createCloudBaseAudio} from './cloudbase-audio.mjs';
import {createCloudBaseDraftGeneration, MODEL_TIMEOUT_MS} from './ai-draft-provider.mjs';

function createFunction(runtimeNamespace) {
  const {envId, prefix, allowedOrigins} = readFunctionConfig(process.env, runtimeNamespace);
  const connection = {env: envId, region: 'ap-shanghai'};
  const cloudApp = cloudbase.init({...connection, timeout: 12_000});
  const db = cloudApp.rdb();
  const {getEnrollment, directory, store} = createDatabaseAdapter(db, prefix);
  const authenticateNative = createAuthenticator({envId, getEnrollment});
  const grants = createDeviceGrantStore(db, prefix);
  const {authenticate, handleDeviceRequest} = createDeviceAccess({grants, getEnrollment, authenticateNative, allowedOrigins});
  const media = createCloudBaseAudio(cloudApp, envId);
  let modelApp;
  const draftGeneration = createCloudBaseDraftGeneration({
    cloudApp: {ai: () => (modelApp ??= cloudbase.init({...connection, timeout: MODEL_TIMEOUT_MS})).ai()},
    db,
    prefix,
  });
  const api = createApi({authenticate, directory, store, media, draftGeneration, allowedOrigins, basePath: ''});
  return createGatewayHandler((request, context) => handleDeviceRequest(request, api, context));
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
