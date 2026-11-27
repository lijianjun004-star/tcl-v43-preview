const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const PILOT_PREFIX = /^tcl_r24_sync_[a-z0-9_]{1,22}$/u;
const DEFAULT_DAILY_LIMIT = '5';
const MAX_DAILY_LIMIT = 20;
const MAX_PROMPT_BYTES = 128 * 1024;

function draftError(code) {
  return Object.assign(new Error(code), {code});
}

function draftReservation(db, prefix, env) {
  const raw = env.TCL_R24_SYNC_AI_DAILY_LIMIT ?? DEFAULT_DAILY_LIMIT;
  if (typeof db?.rpc !== 'function' || typeof prefix !== 'string' || !PILOT_PREFIX.test(prefix) ||
      typeof raw !== 'string' || !/^[1-9][0-9]?$/u.test(raw) || Number(raw) > MAX_DAILY_LIMIT) return null;
  return async () => {
    let result;
    try {
      result = await db.rpc(`${prefix}_reserve_ai_draft`, {p_daily_limit: Number(raw)});
    } catch {
      throw draftError('AI_DRAFT_QUOTA_UNAVAILABLE');
    }
    if (result?.error || typeof result?.data !== 'boolean') throw draftError('AI_DRAFT_QUOTA_UNAVAILABLE');
    if (!result.data) throw draftError('AI_DRAFT_LIMIT');
  };
}

export function createCloudBaseDraftGeneration({client, db, prefix, env = process.env}) {
  const reserveQuota = draftReservation(db, prefix, env);
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
