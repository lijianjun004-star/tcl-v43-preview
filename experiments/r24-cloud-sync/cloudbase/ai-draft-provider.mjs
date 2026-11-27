const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const PILOT_PREFIX = /^tcl_r24_sync_[a-z0-9_]{1,22}$/u;
const DEFAULT_DAILY_LIMIT = '5';
const MAX_DAILY_LIMIT = 20;
const MAX_PROMPT_BYTES = 128 * 1024;

function draftError(code) {
  return Object.assign(new Error(code), {code});
}

function sharedReservation(db, prefix, env, codePrefix) {
  const raw = env.TCL_R24_SYNC_AI_DAILY_LIMIT ?? DEFAULT_DAILY_LIMIT;
  if (typeof db?.rpc !== 'function' || typeof prefix !== 'string' || !PILOT_PREFIX.test(prefix) ||
      typeof raw !== 'string' || !/^[1-9][0-9]?$/u.test(raw) || Number(raw) > MAX_DAILY_LIMIT) return null;
  return async () => {
    let result;
    try {
      result = await db.rpc(`${prefix}_reserve_ai_draft`, {p_daily_limit: Number(raw)});
    } catch {
      throw draftError(codePrefix + '_QUOTA_UNAVAILABLE');
    }
    if (result?.error || typeof result?.data !== 'boolean') throw draftError(codePrefix + '_QUOTA_UNAVAILABLE');
    if (!result.data) throw draftError(codePrefix + '_LIMIT');
  };
}

export function createCloudBaseEvaluationGeneration({client, db, prefix, env = process.env}) {
  if (client?.source !== 'cloudbase_hunyuan' && (!env.AI_GATEWAY_URL?.trim() || !env.AI_GATEWAY_TOKEN?.trim())) return undefined;
  const reserve = sharedReservation(db, prefix, env, 'AI_EVALUATION');
  return {
    source: client?.source ?? 'openai_gateway',
    model: client?.model,
    async evaluate(items) {
      if (env.TCL_R24_SYNC_AI_ENABLED !== 'true') throw draftError('AI_EVALUATION_DISABLED');
      if (!reserve) throw draftError('AI_EVALUATION_QUOTA_UNAVAILABLE');
      return client.evaluate(items, {beforeFetch: reserve});
    },
  };
}

export function createCloudBaseDraftGeneration({client, db, prefix, env = process.env}) {
  const reserveQuota = sharedReservation(db, prefix, env, 'AI_DRAFT');
  const rawOperatorIds = env.TCL_R24_SYNC_AI_OPERATOR_IDS;
  if (env.TCL_R24_SYNC_AI_ENABLED !== 'true' || typeof client?.generate !== 'function' ||
      !reserveQuota || typeof rawOperatorIds !== 'string') return undefined;

  const operatorIds = rawOperatorIds.split(',').map(id => id.trim());
  const allowedOperators = new Set(operatorIds);
  if (operatorIds.some(id => !ACCOUNT_ID.test(id)) || operatorIds.length !== allowedOperators.size) return undefined;

  function canGenerate(principal) {
    return principal?.active === true && principal.role === 'operator' && allowedOperators.has(principal.id);
  }

  async function generate(principal, prompt) {
    if (!canGenerate(principal)) throw draftError('AI_DRAFT_UNAVAILABLE');
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) {
      throw draftError('AI_DRAFT_INPUT_INVALID');
    }

    return client.generate(prompt, {beforeFetch: reserveQuota});
  }

  return {
    canGenerate,
    generate,
    model: client.model,
    source: client.source ?? 'openai_gateway',
    fallbackEnabled: (env.AI_FALLBACK_ENABLED ?? 'true') === 'true',
  };
}
