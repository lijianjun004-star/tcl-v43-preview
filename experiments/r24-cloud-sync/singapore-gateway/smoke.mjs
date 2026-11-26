// Run on the authorized administrator's terminal. Only --live sends a paid synthetic request.
const [mode] = process.argv.slice(2);
async function check() {
  if (!['--check', '--live'].includes(mode)) throw new Error('ARGUMENT_REQUIRED');
  const root = new URL(process.env.AI_GATEWAY_URL || '');
  if (root.protocol !== 'https:' || root.port || root.pathname !== '/' || root.username || root.password ||
      root.search || root.hash || !root.hostname.endsWith('.ap-singapore.tencentscf.com')) throw new Error('INVALID_SG_ROOT');
  const token = process.env.AI_GATEWAY_TOKEN;
  if (mode === '--live' && (!token || token.length < 32 || /^sk[-_]/i.test(token))) throw new Error('INVALID_GATEWAY_TOKEN');
  async function call(path, options = {}) {
    return fetch(new URL(path, root), {...options, redirect: 'error', signal: AbortSignal.timeout(30_000)});
  }
  const health = await call('/health');
  const body = await health.json();
  if (!health.ok || body.ok !== true || body.configured !== true) throw new Error('HEALTH_FAILED');
  console.log('health HTTP 200; configured=true');
  const request = {model: 'gpt-4o-mini', stream: false, max_completion_tokens: 16,
    messages: [{role: 'user', content: '请只回答 OK'}]};
  function completion(credential) {
    return call('/v1/chat/completions', {method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: 'Bearer ' + credential,
    }, body: JSON.stringify(request)});
  }
  const denied = await completion('synthetic-invalid');
  if (denied.status !== 401) throw new Error('WRONG_TOKEN_NOT_REJECTED');
  console.log('wrong token HTTP 401');
  if (mode === '--check') return;
  const response = await completion(token);
  if (response.status !== 200) throw new Error('LIVE_HTTP_' + response.status);
  const result = await response.json();
  if (result.choices?.[0]?.finish_reason !== 'stop' ||
      !/^OK[。.!]?$/iu.test(result.choices[0].message?.content?.trim() || '')) throw new Error('LIVE_REPLY_INVALID');
  console.log('live HTTP 200; synthetic reply verified; tokens=' +
    (Number.isSafeInteger(result.usage?.total_tokens) ? result.usage.total_tokens : 'unknown'));
}
try { await check(); } catch (e) {
  console.error(/^[A-Z0-9_]+$/.test(e.message) ? e.message : 'SMOKE_FAILED');
  process.exitCode = 1;
}
