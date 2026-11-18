(()=>{
  'use strict';
  const key='tcl-r24-asr-model';
  const selector=document.getElementById('r23ModelChoice');
  if(!selector)return;
  const choices={
    paraformer:'普通话 Paraformer-small · 默认',
    base:'增强 Base · 更大模型',
    tiny:'轻量 Tiny · 低内存',
  };
  const get=()=>{
    try {
      const value=localStorage.getItem(key);
      if(Object.hasOwn(choices,value))return value;
    }catch{}
    return 'paraformer';
  };
  selector.add(new Option(choices.paraformer,'paraformer'),0);
  const tip=document.querySelector('#r23ModelBox small');
  if(tip)tip.textContent='默认 Paraformer-small，首次约 94 MB。低内存设备可选 Tiny。切换会刷新页面。';
  selector.value=get();
  selector.addEventListener('change',()=>{
    if(document.body.classList.contains('room-live') || document.body.dataset.page==='training' ||
       document.body.dataset.page==='sessionReview'){
      selector.value=get();
      window.alert('请先完成并保存当前练播，再在首页切换模型，防止正在录制的声音丢失。');
      return;
    }
    const value=selector.value;
    if(!Object.hasOwn(choices,value)){selector.value=get();return;}
    if(value===get())return;
    const download=value==='paraformer'?' 首次需要约 94 MB 资源。':'';
    if(!window.confirm('切换为'+choices[value]+'。'+download+' 切换后刷新本页，是否继续？')){selector.value=get();return;}
    try {localStorage.setItem(key,value);} catch(err){selector.value=get();window.alert('浏览器不允许保存本机模型设置。');return;}
    window.location.reload();
  });
})();
