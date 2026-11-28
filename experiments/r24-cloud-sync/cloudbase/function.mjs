import cloudbase from '@cloudbase/node-sdk';
import {createApi} from './portable/api.mjs';
import {createAuthenticator} from './cloudbase-identity.mjs';
import {createDatabaseAdapter} from './cloudbase-store.mjs';
import {createRepositoryNotifier} from './repository-notifier.mjs';
import {createWorkerRelay} from './worker-relay.mjs';
import {createGatewayHandler} from './gateway.mjs';
import {readFunctionConfig} from './function-config.mjs';
import {createDeviceAccess} from './device-access.mjs';
import {createDeviceGrantStore} from './device-grants-store.mjs';
import {createCloudBaseAudio} from './cloudbase-audio.mjs';
import {createCloudBaseDraftGeneration, createCloudBaseEvaluationGeneration} from './ai-draft-provider.mjs';
import {createAiGatewayClient, createHunyuanClient} from './portable/ai-gateway-client.mjs';

function createFunction(runtimeNamespace) {
  const {envId, prefix, allowedOrigins} = readFunctionConfig(process.env, runtimeNamespace);
  const cloudApp = cloudbase.init({env: envId, region: 'ap-shanghai', timeout: 12_000});
  const db = cloudApp.rdb();
  const {getEnrollment, directory, store} = createDatabaseAdapter(db, prefix);
  const authenticateNative = createAuthenticator({envId, getEnrollment});
  const grants = createDeviceGrantStore(db, prefix);
  const {authenticate, authenticateBoundDevice, handleDeviceRequest} = createDeviceAccess({grants, getEnrollment, authenticateNative, allowedOrigins});
  const media = createCloudBaseAudio(cloudApp, envId);
  const provider = process.env.TCL_R24_SYNC_AI_MODEL_PROVIDER || 'openai_gateway';
  let modelApp;
  const client = provider === 'openai_gateway' ? createAiGatewayClient() : createHunyuanClient({
    cloudApp: {ai() {
      modelApp ||= cloudbase.init({env: envId, region: 'ap-shanghai', timeout: 28_000});
      return modelApp.ai();
    }},
  });
  const draftGeneration = createCloudBaseDraftGeneration({client, db, prefix});
  const evaluationGeneration = createCloudBaseEvaluationGeneration({client, db, prefix});
  const api = createApi({notifyRepositoryQueue: createRepositoryNotifier(), authenticate, authenticateEvaluation: authenticateBoundDevice, directory, store, media, draftGeneration, evaluationGeneration, allowedOrigins, basePath: ''});
  const relay = createWorkerRelay({db, envId, prefix});
  return createGatewayHandler((request, context) => relay(request, req => handleDeviceRequest(req, api, context)));
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
