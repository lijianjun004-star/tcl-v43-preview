// TCL 运营问答文件解释器：没有提取出的答案不会被编造。客户隐私应在文件导入前删除。
export const Q_KEYS=['question','问题','弹幕内容','弹幕','提问','用户提问','顾客提问','话术问题','用户问题','问'];
export const A_KEYS=['answer','答案','回答','优秀回答','参考回答','参考话术','话术','主播话术','标准回答','标准解答','解答','合理回答','老主播回答','运营回答','成熟回答','答'];
export const POINT_KEYS=['keypoints','评分点','知识点','关键点','要点'];
const qaNorm=s=>String(s||'').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const cellHeader=s=>String(s||'').trim().toLowerCase().replace(/[\s\(\)（）、]/g,'');
export function extractQA(parsed){
 const out=[];
 const add=(q,a,point,locator)=>{q=String(q||'').trim();a=String(a||'').trim();if(!q||q.length<3)return;out.push({question:q.slice(0,500),answer:a.slice(0,3000),keyPoints:point?String(point).split(/[、；;,，\n]+/).filter(Boolean).slice(0,12):[],locator,reviewStatus:!a?'incomplete':'needs_review'});};
 if(parsed.format==='json'){
   let val=parsed.jsonData;const arr=Array.isArray(val)?val:Array.isArray(val?.items)?val.items:Array.isArray(val?.questions)?val.questions:[];
   for(const [i,row]of arr.entries()){if(!row||typeof row!=='object')continue;const q=Q_KEYS.map(k=>row[k]).find(Boolean),a=A_KEYS.map(k=>row[k]).find(Boolean),points=POINT_KEYS.map(k=>row[k]).find(Boolean);add(q,a,Array.isArray(points)?points.join('；'):points,`JSON ${i+1}`)}return out;
 }
 for(const b of parsed.blocks||[]){if(b.kind!=='table')continue;const rr=b.rows||[];if(!rr.length)continue;const hdr=rr[0].cells.map(cellHeader);
 // 运营实际使用的模板：弹幕类型 | 弹幕内容 | 消费者意图分析 | 案例话术1 | 案例话术2 …
  // 同一条弹幕可以写多行（不同意图、不同话术），合并成一条题目的多个话术；只有类型没有弹幕内容的行跳过。
  const ci=hdr.indexOf('弹幕内容');
  if(ci>=0){
   const ti=hdr.indexOf('弹幕类型'),ii=hdr.findIndex(x=>x.startsWith('消费者意图')||x==='意图分析'||x==='意图');
   const ais=hdr.map((x,i)=>i!==ci&&i!==ti&&i!==ii&&/^(案例话术|参考话术|话术|优秀回答|参考回答|回答|答案)\d*$/.test(x)?i:-1).filter(i=>i>=0);
   const groups=new Map();
   for(let i=1;i<rr.length;i++){
    const c=rr[i].cells,q=String(c[ci]||'').trim();if(q.length<2)continue;
    const key=qaNorm(q);let g=groups.get(key);if(!g){g={q,type:'',variants:[],locator:rr[i].locator};groups.set(key,g);}
    if(!g.type&&ti>=0)g.type=String(c[ti]||'').trim();
    const intent=ii>=0?String(c[ii]||'').trim():'',answers=ais.map(j=>String(c[j]||'').trim()).filter(Boolean);
    if(intent||answers.length)g.variants.push({intent,answers});
   }
   for(const g of groups.values()){
    const total=g.variants.reduce((n,v)=>n+v.answers.length,0),parts=[];let n=0;
    for(const v of g.variants)for(const a of v.answers){n++;parts.push((total>1?`【话术${n}${v.intent?' · '+v.intent:''}】`:'')+a);}
    const answer=parts.join('\n\n').slice(0,3000),intents=[...new Set(g.variants.map(v=>v.intent).filter(Boolean))];
    out.push({question:g.q.slice(0,500),answer,keyPoints:[],intent:intents.join('；').slice(0,500),danmuType:g.type.slice(0,20),locator:g.locator,reviewStatus:answer?'needs_review':'incomplete'});
   }
   continue;
  }
 const findIndex=(arr,excluded=[])=>{const keys=arr.map(cellHeader);let idx=hdr.findIndex((x,i)=>!excluded.includes(i)&&keys.includes(x));if(idx>=0)return idx;const headerLike=x=>x.length<=16&&!/[?？。！!；;]/.test(x);return hdr.findIndex((x,i)=>!excluded.includes(i)&&headerLike(x)&&keys.some(k=>k.length>=2&&(x.includes(k)||k.includes(x))))};let qi=findIndex(Q_KEYS),pi=findIndex(POINT_KEYS,qi>=0?[qi]:[]),ai=findIndex(A_KEYS,[qi,pi].filter(i=>i>=0));let start=0;if(qi>=0){start=1;}else{qi=0;ai=1;pi=-1;}for(let i=start;i<rr.length;i++){const c=rr[i].cells;add(c[qi],c[ai],pi>=0?c[pi]:'',rr[i].locator)}}
 const lines=(parsed.blocks||[]).filter(x=>x.kind==='paragraph').flatMap(b=>String(b.text||'').split(/\n+/).map(s=>({text:s.trim(),locator:b.locator}))).filter(x=>x.text);
 let q='',a='',location='',pts='';const flush=()=>{if(q)add(q,a,pts,location);q='';a='';pts=''};
 for(const row of lines){const line=row.text;const single=line.match(/^(?:Q|问|提问|问题|弹幕)[:：\s]+(.+?)\s+(?:A|答|回答|参考回答|优秀回答)[:：\s]+(.+)$/i);if(single){flush();add(single[1],single[2],'',row.locator);continue}
  const isQ=line.match(/^(?:Q|问|提问|问题|弹幕|顾客)\s*[:：.、]\s*(.+)$/i);const isA=line.match(/^(?:A|答|回答|参考答案|优秀回答|成熟回答)\s*[:：.、]\s*(.+)$/i);
  if(isQ){flush();q=isQ[1];location=row.locator;}else if(isA){a+=(a?'\n':'')+isA[1]}else if(/^\s*(?:要点|评分点|关键点)\s*[:：]/.test(line)){pts+=line.replace(/^[^:：]+[:：]/,'');}else if(a){a+='\n'+line;}else if(q&&line.length<300){q+=' '+line;}}
 flush();return out;
}
export function detectReviewConflicts(rows,{existing=[],boardId='',platform='',category=''}={}){
 const seen=new Map();let dup=0,conflict=0;
 for(const r of rows){const key=qaNorm(r.question);if(seen.has(key)){const first=seen.get(key);if(qaNorm(first.answer)===qaNorm(r.answer)){r.reviewStatus='duplicate';dup++}else{r.reviewStatus='conflict';first.reviewStatus='conflict';conflict++}}else seen.set(key,r);if(!r.answer)r.reviewStatus='incomplete';}
 const normP=(b,p)=>String(b)==='12'&&p==='抖音生活服务'?'抖音':p;
 const candidates=existing.filter(x=>x&&x.status!=='rejected');
 for(const r of rows){
  if(!r.answer){r.reviewStatus='incomplete';continue;}
  const qk=qaNorm(r.question),p=normP(boardId,platform);
  const hit=candidates.find(x=>qaNorm(x.question)===qk&&((x.scope==='category'&&(!category||String(x.category||'')===String(category)))||(String(x.boardId)===String(boardId)&&(normP(x.boardId,x.platform)===p||x.platform==='全部平台'||platform==='全部平台'))));
  if(hit)r.reviewStatus=qaNorm(hit.answer)===qaNorm(r.answer)?'duplicate':'conflict';
 }
 return {dup,conflict};
}
