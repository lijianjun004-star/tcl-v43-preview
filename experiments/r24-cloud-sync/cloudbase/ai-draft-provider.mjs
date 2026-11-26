const CLOUD_MODEL_PROVIDER = 'cloudbase';
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const PILOT_PREFIX = /^tcl_r24_sync_[a-z0-9_]{1,22}$/u;
const DEFAULT_DAILY_LIMIT = '5';
const MAX_DAILY_LIMIT = 20;
const MAX_PROMPT_BYTES = 128 * 1024;
const MAX_RESPONSE_CHARS = 150_000;
export const MODEL_TIMEOUT_MS = 24_000;
const MAX_OUTPUT_TOKENS = 4096;

function draftError(code) {
  return Object.assign(new Error(code), {code});
}

export function createCloudBaseDraftGeneration({cloudApp, db, prefix, env = process.env}) {
  if (env.TCL_R24_SYNC_AI_ENABLED !== 'true' ||
      env.TCL_R24_SYNC_AI_MODEL_PROVIDER !== CLOUD_MODEL_PROVIDER ||
      typeof cloudApp?.ai !== 'function' || typeof db?.rpc !== 'function' ||
      typeof prefix !== 'string' || !PILOT_PREFIX.test(prefix)) return undefined;

  const modelId = env.TCL_R24_SYNC_AI_MODEL_ID;
  const rawLimit = env.TCL_R24_SYNC_AI_DAILY_LIMIT ?? DEFAULT_DAILY_LIMIT;
  const rawOperatorIds = env.TCL_R24_SYNC_AI_OPERATOR_IDS;
  if (typeof modelId !== 'string' || !MODEL_ID.test(modelId) ||
      typeof rawLimit !== 'string' || !/^[1-9][0-9]?$/u.test(rawLimit) || Number(rawLimit) > MAX_DAILY_LIMIT ||
      typeof rawOperatorIds !== 'string') return undefined;

  const operatorIds = rawOperatorIds.split(',').map(id => id.trim());
  const allowedOperators = new Set(operatorIds);
  if (operatorIds.some(id => !ACCOUNT_ID.test(id)) || operatorIds.length !== allowedOperators.size) return undefined;

  const dailyLimit = Number(rawLimit);

  function canGenerate(principal) {
    return principal?.active === true && principal.role === 'operator' && allowedOperators.has(principal.id);
  }

  async function reserveQuota() {
    let result;
    try {
      result = await db.rpc(`${prefix}_reserve_ai_draft`, {p_daily_limit: dailyLimit});
    } catch {
      throw draftError('AI_DRAFT_QUOTA_UNAVAILABLE');
    }
    if (result?.error || typeof result?.data !== 'boolean') throw draftError('AI_DRAFT_QUOTA_UNAVAILABLE');
    if (!result.data) throw draftError('AI_DRAFT_LIMIT');
  }

  async function generate(principal, prompt) {
    if (!canGenerate(principal)) throw draftError('AI_DRAFT_UNAVAILABLE');
    if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) {
      throw draftError('AI_DRAFT_INPUT_INVALID');
    }

    await reserveQuota();

    let result;
    let timer;
    const timeoutError = draftError('AI_DRAFT_TIMEOUT');
    try {
      const model = cloudApp.ai().createModel(CLOUD_MODEL_PROVIDER);
      // The locked native provider uses the CloudBase app's timeout for transport.
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError), MODEL_TIMEOUT_MS);
      });
      result = await Promise.race([
        model.generateText({
          model: modelId,
          messages: [{role: 'user', content: prompt}],
          maxSteps: 1,
          max_tokens: MAX_OUTPUT_TOKENS,
        }),
        timeout,
      ]);
    } catch (error) {
      if (error === timeoutError) throw timeoutError;
      throw draftError('AI_DRAFT_PROVIDER_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }

    if (result?.error || typeof result?.text !== 'string' ||
        result.text.length > MAX_RESPONSE_CHARS || !result.text.trim()) {
      throw draftError('AI_DRAFT_PROVIDER_INVALID_RESPONSE');
    }
    return result.text;
  }

  return {canGenerate, generate};
}
