// R2.2 EXPERIMENT ONLY. Deploy separately from GitHub Pages, AFTER explicit cost approval.
// Both the user access code and OpenAI API key are server-side secrets; neither is shipped in the frontend.
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_AUDIO = /^(audio\/(webm|mp4|mpeg|mp3|ogg|wav|x-wav|m4a|aac|flac)|video\/(webm|mp4))(;.*)?$/i;
const KNOWN_HINTS = 'TCL、FFALCON雷鸟、T7M Pro、电视、冰箱、空调、洗衣机、显示器、智能门锁、京东、天猫、抖音、Mini LED、QD-Mini LED、HDMI 2.1';
const MODEL = 'gpt-transcribe';
const safeText = (s, n) => String(s ?? '').slice(0, n);
function json(value, status, headers={}) {
  return new Response(JSON.stringify(value), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
}
function allowOrigin(request, env) {
  const origin = request.headers.get('origin');
  const valid = (env.ALLOWED_ORIGIN || '').trim();
  return Boolean(origin && valid.startsWith('https://') && origin===valid);
}
function corsHeaders(request, env) {
  return allowOrigin(request, env)?{
    'access-control-allow-origin':request.headers.get('origin'),
    'access-control-allow-methods':'POST, OPTIONS',
    'access-control-allow-headers':'Authorization, Content-Type',
    'access-control-max-age':'600',
    'vary':'Origin'
  }:{};
}
async function equalSecret(a, b) {
  // Constant-time value check for equal lengths; bound both inputs.
  const enc = new TextEncoder();
  const aa=enc.encode(safeText(a,512)), bb=enc.encode(safeText(b,512));
  if(!aa.length || aa.length!==bb.length || aa.length!==String(a??'').length || bb.length!==String(b??'').length) return false;
  let mismatch=0;
  for(let i=0;i<aa.length;i++) mismatch |= aa[i]^bb[i];
  return mismatch===0;
}
function isReady(env) {
  return Boolean(env.OPENAI_API_KEY && env.ASR_ACCESS_TOKEN && env.ALLOWED_ORIGIN && env.ASR_USAGE_KV?.get && env.ASR_USAGE_KV?.put && env.ASR_BILLING_ENABLED === 'true');
}
async function consumeQuota(env) {
  const cap=Math.min(30,Math.max(1,Number(env.DAILY_MAX_REQUESTS)||5));
  const key='asr-day:'+new Date().toISOString().slice(0,10);
  // Cloudflare KV is eventually consistent, NOT a strict spending lock.
  // Also configure account-side API budgets/limits before enabling paid traffic.
  const count=Number(await env.ASR_USAGE_KV.get(key))||0;
  if(count>=cap)return false;
  await env.ASR_USAGE_KV.put(key,String(count+1),{expirationTtl:172800});
  return true;
}
export async function handleRequest(request, env, deps={fetchImpl:fetch}) {
  if(new URL(request.url).pathname!=='/transcribe')return json({error:'not_found'},404);
  const originOK=allowOrigin(request,env);
  const c=corsHeaders(request,env);
  if(!originOK)return json({error:'origin_not_allowed'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:c});
  if(request.method!=='POST')return json({error:'method_not_allowed'},405,c);
  if(!isReady(env))return json({error:'not_configured',message:'OpenAI API 尚未经过授权配置；不会收费。'},503,c);
  const bearer=request.headers.get('authorization')||'';
  if(!bearer.startsWith('Bearer ') || !await equalSecret(bearer.slice(7),env.ASR_ACCESS_TOKEN))return json({error:'unauthorized'},401,c);
  const type=request.headers.get('content-type')||'';
  if(!type.startsWith('multipart/form-data;'))return json({error:'invalid_form_type'},415,c);
  if(Number(request.headers.get('content-length'))>MAX_BYTES+8192)return json({error:'audio_too_large'},413,c);
  let submitted;
  try { submitted=await request.formData(); }
  catch {return json({error:'invalid_form'},400,c);}
  const file=submitted.get('audio');
  const turnId=safeText(submitted.get('turnId'),90);
  if(!turnId || !/^[\w-]{1,90}$/.test(turnId))return json({error:'invalid_turn_id'},400,c);
  if(!(file instanceof File) || !file.size || file.size>MAX_BYTES)return json({error:'invalid_audio_size'},413,c);
  if(!ALLOWED_AUDIO.test(file.type))return json({error:'unsupported_audio_type'},415,c);
  if(!await consumeQuota(env))return json({error:'daily_limit_reached'},429,c);
  const form=new FormData();
  form.append('file',file, /\.(webm|wav|mp3|m4a|mp4|ogg|flac)$/i.test(file.name)?file.name:'question.webm');
  form.append('model',MODEL);
  form.append('prompt',KNOWN_HINTS);
  let upstream;
  try {
    upstream=await deps.fetchImpl('https://api.openai.com/v1/audio/transcriptions',{
      method:'POST',headers:{'Authorization':'Bearer '+env.OPENAI_API_KEY},body:form,
      signal:AbortSignal.timeout(70000)
    });
  }catch {return json({error:'openai_unreachable'},502,c);}
  if(!upstream.ok)return json({error:'openai_failed',upstream_status:upstream.status},502,c);
  let answer;
  try {answer=await upstream.json();}catch {return json({error:'openai_invalid_response'},502,c);}
  if(typeof answer?.text!=='string')return json({error:'openai_missing_transcript'},502,c);
  return json({turnId,text:answer.text,source:'openai-api',model:MODEL},200,c);
}
export default {fetch(request,env){return handleRequest(request,env)}};