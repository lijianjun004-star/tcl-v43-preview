const shanghaiEnvironment = 'unknown-roadrunner-d7cap6e21f517';
const shanghaiOrigin = 'https://unknown-roadrunner-d7cap6e21f517-1519058345.tcloudbaseapp.com';
const pilotPrefix = 'tcl_r24_sync_v1';

function configuredOrigins(raw = '') {
  return raw.split(',').map(origin => origin.trim()).filter(Boolean).map(origin => {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('Invalid allowed origin');
    return url.origin;
  });
}

export function readFunctionConfig(env, runtimeNamespace) {
  if (env.TCL_R24_SYNC_ENABLED !== 'true') throw new Error('Cloud sync not enabled');
  const envId = env.TCL_R24_SYNC_ENV_ID;
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(envId ?? '')) throw new Error('Invalid CloudBase environment ID');

  // Only trust SCF runtime-provided metadata, never the HTTP event.
  const runtimeIds = [env.TCB_ENV, env.SCF_NAMESPACE, runtimeNamespace].filter(Boolean);
  if (!runtimeIds.length || runtimeIds.some(id => id !== envId)) throw new Error('CloudBase runtime environment mismatch');

  const prefix = env.TCL_R24_SYNC_COLLECTION_PREFIX || pilotPrefix;
  if (!/^tcl_r24_sync_[a-z0-9_]{1,22}$/.test(prefix)) throw new Error('Invalid collection prefix');
  const allowedOrigins = configuredOrigins(env.TCL_R24_SYNC_ORIGINS);
  if (envId === shanghaiEnvironment && (
    env.TCL_R24_SYNC_ALLOW_SHARED_SHANGHAI !== 'true' ||
    env.TCL_R24_SYNC_COLLECTION_PREFIX !== pilotPrefix ||
    allowedOrigins.length !== 1 ||
    allowedOrigins[0] !== shanghaiOrigin
  )) throw new Error('Shared Shanghai pilot not explicitly scoped');

  return {envId, prefix, allowedOrigins};
}
