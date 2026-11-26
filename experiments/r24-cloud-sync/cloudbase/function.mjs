import cloudbase from '@cloudbase/node-sdk';
import {createApi} from './portable/api.mjs';
import {createAuthenticator} from './cloudbase-identity.mjs';
import {createDatabaseAdapter} from './cloudbase-store.mjs';
import {createGatewayHandler} from './gateway.mjs';
import {readFunctionConfig} from './function-config.mjs';
import {createDeviceAccess} from './device-access.mjs';
import {createDeviceGrantStore} from './device-grants-store.mjs';
import {createCloudBaseAudio} from './cloudbase-audio.mjs';
import {createCloudBaseDraftGeneration, createCloudBaseEvaluationGeneration} from './ai-draft-provider.mjs';
import {createAiGatewayClient} from './portable/ai-gateway-client.mjs';

function createFunction(runtimeNamespace) {
  const {envId, prefix, allowedOrigins} = readFunctionConfig(process.env, runtimeNamespace);
  const cloudApp = cloudbase.init({env: envId, region: 'ap-shanghai', timeout: 12_000});
  const db = cloudApp.rdb();
  const {getEnrollment, directory, store} = createDatabaseAdapter(db, prefix);
  const authenticateNative = createAuthenticator({envId, getEnrollment});
  const grants = createDeviceGrantStore(db, prefix);
  const {authenticate, authenticateBoundDevice, handleDeviceRequest} = createDeviceAccess({grants, getEnrollment, authenticateNative, allowedOrigins});
  const media = createCloudBaseAudio(cloudApp, envId);
  const gateway = {client: createAiGatewayClient(), db, prefix};
  const draftGeneration = createCloudBaseDraftGeneration(gateway);
  const evaluationGeneration = createCloudBaseEvaluationGeneration(gateway);
  const api = createApi({authenticate, authenticateEvaluation: authenticateBoundDevice, directory, store, media, draftGeneration, evaluationGeneration, allowedOrigins, basePath: ''});
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
