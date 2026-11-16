(()=>{
  'use strict';
  const key='tcl-r24-asr-model';
  const selector=document.getElementById('r23ModelChoice');
  if(!selector)return;
  const get=()=>{try{return localStorage.getItem(key)==='tiny'?'tiny':'base';}catch{return 'base';}};
  selector.value=get();
  selector.addEventListener('change',()=>{
    if(document.body.classList.contains('room-live') || document.body.dataset.page==='training' ||
       document.body.dataset.page==='sessionReview'){
      selector.value=get();
      window.alert('请先完成并保存当前练播，再在首页切换模型，防止正在录制的声音丢失。');
      return;
    }
    const value=selector.value==='base'?'base':'tiny';
    if(value===get())return;
    const note=value==='base'?'启用 Whisper Base 增强识别，下载与内存占用会增加。':'切回 Whisper Tiny 轻量识别。';
    if(!window.confirm(note+' 切换后刷新本页，是否继续？')){selector.value=get();return;}
    try {localStorage.setItem(key,value);} catch(err){selector.value=get();window.alert('浏览器不允许保存本机模型设置。');return;}
    window.location.reload();
  });
})();
