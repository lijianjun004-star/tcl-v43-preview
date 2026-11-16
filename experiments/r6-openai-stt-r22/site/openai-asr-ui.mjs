import {configureASR,getASRSettings} from './openai-asr-client.mjs';
function boot(){
 const button=document.createElement('button');
 button.id='openai-asr-settings-button';
 button.type='button';
 button.textContent='转写引擎：本地（设置）';
 button.style.cssText='position:fixed;bottom:74px;left:8px;z-index:9998;padding:8px 12px;border-radius:18px;background:#122d43;color:#fff;border:1px solid #7c9bae;font-size:12px;max-width:230px;';
 button.setAttribute('aria-label','设置练播房语音转写引擎');
 const dialog=document.createElement('dialog');
 dialog.id='openai-asr-settings-dialog';
 dialog.style.cssText='max-width:440px;width:min(92vw,440px);border:1px solid #b3bac1;border-radius:16px;padding:18px;box-sizing:border-box;background:#fff;color:#17212b;line-height:1.65;';
 dialog.innerHTML=`<form method="dialog" id="openai-asr-form">
  <h3 style="margin:0 0 8px">练播房转写引擎（R2.2 实验）</h3>
  <p style="font-size:13px;margin:0 0 12px">默认本地 Whisper，零 API 费用。OpenAI 模式必须由你单独配置安全代理及 API 额度；不能直接抵扣 ChatGPT 订阅额度。</p>
  <label style="display:block"><input name="mode" type="radio" value="local" checked> 本地 Whisper（默认）</label>
  <label style="display:block"><input name="mode" type="radio" value="openai"> OpenAI gpt-transcribe（按量计费）</label>
  <label style="display:block;margin-top:10px;font-size:13px">安全代理 HTTPS 地址
  <input name="endpoint" type="url" autocomplete="off" placeholder="https://...workers.dev/transcribe" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #aaa;border-radius:7px"></label>
  <label style="display:block;margin-top:10px;font-size:13px">测试访问码（不是 OpenAI API 密钥）
  <input name="accessToken" type="password" autocomplete="off" placeholder="由安全代理管理员配置" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #aaa;border-radius:7px"></label>
  <label style="display:block;margin-top:10px;font-size:13px"><input name="confirmedCosts" type="checkbox"> 我理解 OpenAI API 是单独计费；已设置额度控制，并同意本页发送本题录音给代理服务。</label>
  <p id="openai-asr-panel-status" role="status" style="color:#9e322d;font-size:12px;min-height:18px"></p>
  <div style="display:flex;gap:10px"><button type="submit" value="save" style="padding:8px 16px;background:#155c8b;color:#fff;border:0;border-radius:8px">保存设置</button><button type="button" id="openai-asr-close" style="padding:8px 16px">取消</button></div>
  <p style="font-size:12px;color:#5a6470">本页面不保存访问码到 localStorage；关闭或刷新页面即恢复本地模式。API 密钥不得填写在此处。转写失败会保留本题原始录音及人工编辑。</p>
 </form>`;
 document.body.append(button,dialog);
 button.addEventListener('click',()=>dialog.showModal());
 dialog.querySelector('#openai-asr-close').addEventListener('click',()=>dialog.close());
 const form=dialog.querySelector('form');
 form.addEventListener('submit',e=>{
  e.preventDefault();
  const data=new FormData(form);
  try{
    const result=configureASR({mode:data.get('mode'),endpoint:String(data.get('endpoint')||''),accessToken:String(data.get('accessToken')||''),confirmedCosts:data.has('confirmedCosts')});
    button.textContent=result.mode==='openai'?'转写引擎：OpenAI API':'转写引擎：本地（设置）';
    dialog.querySelector('input[name=accessToken]').value='';
    dialog.querySelector('#openai-asr-panel-status').textContent='';
    dialog.close();
  }catch(err){dialog.querySelector('#openai-asr-panel-status').textContent=String(err?.message||err);}
 });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();