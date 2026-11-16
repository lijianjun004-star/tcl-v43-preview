// Access token is held ONLY in memory. OpenAI API key never reaches the browser.
const MAX_AUDIO_BYTES=8*1024*1024;
let state={mode:'local',endpoint:'',accessToken:''};
export function getASRSettings(){return {mode:state.mode,endpoint:state.endpoint,authenticated:!!state.accessToken};}
export function configureASR({mode,endpoint='',accessToken='',confirmedCosts=false}){
  if(mode==='local'){state={mode:'local',endpoint:'',accessToken:''};return getASRSettings();}
  if(mode!=='openai'||!confirmedCosts)throw new Error('请先确认独立 API 计费风险');
  const url=new URL(endpoint);
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||!/\/transcribe$/.test(url.pathname))throw new Error('需填写 HTTPS 服务端 /transcribe 地址');
  if(accessToken.length<20 || accessToken.length>512)throw new Error('测试访问令牌必须至少20位');
  state={mode:'openai',endpoint:url.href,accessToken};
  return getASRSettings();
}
export async function transcribePreferred(blob,task,localEngine,{fetchImpl=fetch,timeoutMs=85000}={}){
  if(state.mode!=='openai'){
    const result=await localEngine(blob);
    return {...result,source:'whisper-local'};
  }
  if(!(blob instanceof Blob)||!blob.size||blob.size>MAX_AUDIO_BYTES)throw new Error('本题录音为空或超过8MB，OpenAI API 不发起调用');
  if(!task || !/^[\w-]{1,90}$/.test(String(task.turnId)))throw new Error('本题编号无效，阻止串题');
  const form=new FormData();
  const mime=(blob.type||'audio/webm').split(';')[0];
  const ext= mime==='audio/mp4'?'m4a': mime==='audio/ogg'?'ogg':mime==='audio/wav'?'wav':'webm';
  form.set('audio',blob,`turn.${ext}`);
  form.set('turnId',task.turnId);
  let resp;
  try {
    resp=await fetchImpl(state.endpoint,{
      method:'POST',headers:{Authorization:'Bearer '+state.accessToken},
      body:form,signal:AbortSignal.timeout(timeoutMs),credentials:'omit',cache:'no-store'
    });
  }catch {throw new Error('OpenAI 安全代理网络请求失败（密钥未暴露）');}
  if(!resp.ok){
    const safe=({401:'访问码错误',403:'网页来源不允许',413:'录音太大',429:'今日试用额度已用完',503:'服务端尚未启用',502:'OpenAI 服务调用失败'})[resp.status]||`请求失败 HTTP ${resp.status}`;
    throw new Error(safe);
  }
  let payload;
  try{payload=await resp.json();}catch{throw new Error('服务端返回格式错误');}
  if(payload.turnId!==task.turnId||typeof payload.text!=='string')throw new Error('题目编号不匹配，转写文字已拒绝写入');
  return {text:payload.text,source:'openai-api'};
}