(()=>{
  'use strict';
  const key='tcl-r25-asr-engine';
  const selector=document.getElementById('r23ModelChoice');
  if(!selector)return;
  const get=()=>{try{const v=localStorage.getItem(key);return v==='tiny'||v==='base'?v:'vosk';}catch{return 'vosk';}};
  selector.value=get();
  selector.addEventListener('change',()=>{
    if(document.body.classList.contains('room-live') || document.body.dataset.page==='training' ||
       document.body.dataset.page==='sessionReview'){
      selector.value=get();
      window.alert('请先完成并保存当前练播，再在首页切换模型，防止正在录制的声音丢失。');
      return;
    }
    const value=selector.value==='base'||selector.value==='tiny'?selector.value:'vosk';
    if(value===get())return;
    const note=value==='vosk'?'改用本机中文识别（Vosk，约42MB，输出简体，推荐手机使用）。':value==='base'?'启用 Whisper Base 增强识别（约77MB，需能访问模型站点，下载失败会自动改用本机中文识别）。':'启用 Whisper Tiny 轻量识别（需能访问模型站点，下载失败会自动改用本机中文识别）。';
    if(!window.confirm(note+' 切换后刷新本页，是否继续？')){selector.value=get();return;}
    try {localStorage.setItem(key,value);} catch(err){selector.value=get();window.alert('浏览器不允许保存本机模型设置。');return;}
    window.location.reload();
  });
})();
