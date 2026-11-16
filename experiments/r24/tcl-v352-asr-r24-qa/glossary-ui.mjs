import {parseTerms,extractTerms} from './asr-glossary.mjs';

const KEY='tcl-r24-private-asr-terms-v1';
export function initGlossaryUI({parseDocumentFile,isEditable=()=>document.body.dataset.page==='home',storage=null}={}) {
  let saved=[],store=storage,storageError=false;
  try {store=store||globalThis.localStorage;const raw=store.getItem(KEY);if(raw!==null)saved=parseTerms(raw);}catch{storageError=true;}
  const panel=document.getElementById('asrGlossaryPanel');
  const getTerms=()=>saved.slice();
  if(!panel)return {getTerms};
  const node=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
  const heading=node('h3','术语拼写校正');
  const note=node('p','导入讲解词，提取型号和技术缩写；核对后保存。文件只在本机读取，原文不保存。术语用于统一英文拼写，不会改变模型听辨能力，也不会补写商品参数或未说出的内容。');
  const label=node('label','每行一个短英文型号或技术缩写（最多24个）');
  const input=node('textarea');input.id='asrGlossaryTerms';input.rows=5;input.maxLength=4096;input.value=saved.join('\n');label.htmlFor=input.id;
  const fileLabel=node('label','从讲解词提取术语');
  const file=node('input');file.id='asrGlossaryFile';file.type='file';file.accept='.txt,.xlsx,.docx,.csv';fileLabel.htmlFor=file.id;
  const save=node('button','保存本机术语');save.type='button';save.id='asrGlossarySave';save.className='btn soft';
  const clear=node('button','清除本机术语');clear.type='button';clear.id='asrGlossaryClear';clear.className='btn soft';
  const status=node('p');status.id='asrGlossaryStatus';status.setAttribute('role','status');
  status.textContent=storageError?'无法读取本机术语存储；当前未启用术语。':`已保存 ${saved.length} 个术语。`;
  panel.replaceChildren(heading,note,label,input,fileLabel,file,save,clear,status);
  let loading=false,request=0,lastEditable=isEditable();
  const sync=()=>{const allowed=isEditable();if(loading&&lastEditable&&!allowed)request++;lastEditable=allowed;const disabled=!allowed||loading;for(const el of [input,file,save,clear])el.disabled=disabled;};
  const editable=()=>{if(isEditable())return true;status.textContent='请返回首页后编辑术语，当前练播使用原有词表。';return false;};
  save.onclick=()=>{
    if(!editable()||loading)return;
    try {const terms=parseTerms(input.value);store.setItem(KEY,terms.join('\n'));saved=terms;input.value=terms.join('\n');status.textContent=`已保存 ${terms.length} 个术语，将用于后续转写的英文拼写整理。`;}
    catch(err){status.textContent='保存失败，原词表保持不变：'+String(err.message||err);}
  };
  clear.onclick=()=>{
    if(!editable()||loading)return;
    try{store.removeItem(KEY);saved=[];input.value='';status.textContent='已清除本机术语。';}
    catch(err){status.textContent='清除失败，原词表保持不变：'+String(err.message||err);}
  };
  file.onchange=async()=>{
    if(!editable()||loading)return;
    const selected=file.files?.[0];if(!selected)return;
    if(!/\.(txt|xlsx|docx|csv)$/i.test(selected.name)||selected.size>5*1024*1024){status.textContent='请选择不超过5MB的 TXT、XLSX、DOCX 或 CSV 文件。';file.value='';return;}
    const mine=++request;loading=true;sync();status.textContent='正在本机提取术语…';
    try {
      const parsed=await parseDocumentFile(selected);
      if(mine!==request||!isEditable()){status.textContent='已离开首页，本次导入预览已取消；原词表保持不变。';return;}
      const terms=extractTerms(parsed);input.value=terms.join('\n');status.textContent=terms.length?`提取 ${terms.length} 个候选术语，请核对后点击保存。只读取前10万字符；未提取价格或完整句子。`:'没有提取到型号或技术缩写。可手动填写短英文型号或技术缩写后保存。';
    }catch(err){status.textContent='提取失败，原词表保持不变：'+String(err.message||err);}
    finally{file.value='';loading=false;sync();}
  };
  const observer=new MutationObserver(records=>{
    // Remember a leave+return even if both attribute mutations precede this callback.
    if(loading&&records.some(r=>r.attributeName==='data-page'&&(r.oldValue!=='home'||document.body.dataset.page!=='home')))request++;
    sync();
  });observer.observe(document.body,{attributes:true,attributeOldValue:true,attributeFilter:['data-page','class']});sync();
  const details=panel.closest('details');details?.addEventListener('toggle',sync);
  return {getTerms,refresh:sync,destroy:()=>{request++;observer.disconnect();details?.removeEventListener('toggle',sync);}};
}
