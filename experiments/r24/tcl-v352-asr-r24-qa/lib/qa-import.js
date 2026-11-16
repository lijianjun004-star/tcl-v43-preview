// TCL 运营问答文件解释器：没有提取出的答案不会被编造。客户隐私应在文件导入前删除。
export const Q_KEYS=['question','问题','弹幕内容','弹幕','提问','用户提问','顾客提问','话术问题','用户问题','问'];
export const A_KEYS=['answer','答案','回答','优秀回答','参考回答','参考话术','话术','主播话术','标准回答','标准解答','解答','合理回答','老主播回答','运营回答','成熟回答','答'];
export const POINT_KEYS=['keypoints','评分点','知识点','关键点','要点'];
export const METADATA_KEYS={
 model:['model','product_model','productModel','型号','产品型号','商品型号'],
 sku:['sku','SKU','商品SKU','产品SKU'],
 category:['category','品类','产品品类','商品品类'],
 platform:['platform','平台','销售平台'],
 sourceRef:['sourceRef','source_ref','source','来源','资料来源']
};
export const METADATA_LIMITS={model:200,sku:200,category:100,platform:50,sourceRef:2000,sourceLocators:1000,sourceLocatorChars:1000};
// Model/version symbols are data: HDR10 != HDR10+, HDMI2.1 != HDMI21.
// Only normalize width, case, whitespace and terminal sentence punctuation.
const qaNorm=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/\s+/gu,'').replace(/[?!。]+$/u,'');
const cellHeader=s=>String(s??'').normalize('NFKC').trim().toLowerCase().replace(/[\s\(\)（）、]/g,'');
const metadataNorm=(value,key)=>{if(key==='sourceRef')return String(value??'').trim();const text=String(value??'').normalize('NFKC').trim().replace(/\s+/gu,' ');return key==='sku'?text:text.toLowerCase();};
const metadataScalar=(value,key,locator)=>{
 if(value===null||value===undefined)return '';
 if(typeof value!=='string'&&!(typeof value==='number'&&Number.isFinite(value)))throw new Error(`${locator}：${key}须为文字或有限数字，不能使用布尔值、对象或数组`);
 if(typeof value==='number'&&Number.isInteger(value)&&!Number.isSafeInteger(value))throw new Error(`${locator}：${key}超出安全整数范围，请在源文件中改为字符串，避免编号精度丢失`);
 const text=String(value).trim();
 if(text.length>METADATA_LIMITS[key])throw new Error(`${locator}：${key}超过${METADATA_LIMITS[key]}字，请精简后重新导入；未截断保存`);
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))throw new Error(`${locator}：${key}包含不可用控制字符`);
 return text;
};
function readMetadata(entries,locator){
 const metadata={};
 for(const [key,aliases] of Object.entries(METADATA_KEYS)){
  const names=new Set(aliases.map(cellHeader));
  let matching=entries.filter(([name])=>names.has(cellHeader(name)));
  // Exported records also carry a legacy source display label. The explicit
  // sourceRef is authoritative; source is only an alias when sourceRef is absent.
  if(key==='sourceRef'){
   const canonical=matching.filter(([name,value])=>['sourceref','source_ref'].includes(cellHeader(name))&&value!==null&&value!==undefined&&(typeof value!=='string'||value.trim()!==''));
   if(canonical.length)matching=canonical;
  }
  const values=matching.map(([,value])=>metadataScalar(value,key,locator)).filter(value=>value!=='');
  if(new Set(values.map(value=>metadataNorm(value,key))).size>1)throw new Error(`${locator}：${key}的多个列/字段值不一致，请明确一份值后重新导入`);
  metadata[key]=values[0]||'';
 }
 return metadata;
}
const sourceLocations=(locator,provided=[])=>{
 if(!Array.isArray(provided)||provided.some(value=>typeof value!=='string'))throw new Error(`${locator}：sourceLocators须为文字数组`);
 const locations=[...new Set([...provided,locator].map(value=>String(value??'').trim()).filter(Boolean))];
 if(locations.length>METADATA_LIMITS.sourceLocators||locations.some(value=>value.length>METADATA_LIMITS.sourceLocatorChars))throw new Error(`${locator}：来源位置最多${METADATA_LIMITS.sourceLocators}项，每项最多${METADATA_LIMITS.sourceLocatorChars}字，请精简后重新导入；未截断保存`);
 return locations;
};
const normPlatform=(board,platform)=>String(board)==='12'&&platform==='抖音生活服务'?'抖音':platform;
const questionIdentity=(row,context={})=>{
 const board=row.boardId||context.boardId||'';
 const range=(row.scope||context.scope)==='category'?'':String(board);
 return JSON.stringify([qaNorm(row.question),metadataNorm(row.model,'model'),metadataNorm(row.sku,'sku'),metadataNorm(row.category||context.category,'category'),metadataNorm(normPlatform(board,row.platform||context.platform||''),'platform'),range]);
};
const productIdentity=row=>JSON.stringify([qaNorm(row.question),metadataNorm(row.model,'model'),metadataNorm(row.sku,'sku')]);
const effectiveRange=(row,context)=>{
 const board=String(row.boardId||context.boardId||'');
 return {board,category:metadataNorm(row.category||context.category,'category'),scope:row.scope||context.scope||'board',platform:metadataNorm(normPlatform(board,row.platform||context.platform||''),'platform')};
};
function rangesOverlap(a,b){
 // The same board can see an all-platform/shared row and a narrower platform row.
 // Separate platform names stay independent; 京东/天猫 explicitly covers both.
 if(!a.platform||!b.platform){if(a.platform!==b.platform)return false;}
 else if(a.platform!=='全部平台'&&b.platform!=='全部平台'){
  const left=a.platform==='京东/天猫'?['京东','天猫']:[a.platform];
  const right=b.platform==='京东/天猫'?['京东','天猫']:[b.platform];
  if(!left.some(value=>right.includes(value)))return false;
 }
 if(a.category&&b.category&&a.category!==b.category)return false;
 if(a.scope==='category'||b.scope==='category')return a.category&&b.category?a.category===b.category:!!a.board&&a.board===b.board;
 if(a.board&&b.board)return a.board===b.board;
 if(a.board||b.board)return !!a.category&&a.category===b.category;
 return a.category===b.category;
}
export function extractQA(parsed){
 const out=[];
 const bounded=(value,max,field,locator)=>{if(value.length>max)throw new Error(`${locator||'导入资料'}：${field}超过${max}字，请拆分或精简后重新导入；未截断保存`);return value;};
 const add=(q,a,point,locator,minQuestionLength=3,metadata={},locations=[])=>{
   q=String(q??'').trim();a=String(a??'').trim();if(!q||q.length<minQuestionLength)return;
   const keyPoints=point?String(point).split(/[、；;,，\n]+/).map(value=>value.trim()).filter(Boolean):[];
   if(keyPoints.length>12)throw new Error(`${locator||'导入资料'}：要点超过12条，请拆分后重新导入；未截断保存`);
   out.push({question:bounded(q,500,'问题',locator),answer:bounded(a,3000,'回答',locator),keyPoints,...readMetadata(Object.entries(metadata),locator),sourceLocators:sourceLocations(locator,locations),locator,reviewStatus:!a?'incomplete':'needs_review'});
 };
 if(parsed.format==='json'){
   let val=parsed.jsonData;const arr=Array.isArray(val)?val:Array.isArray(val?.items)?val.items:Array.isArray(val?.questions)?val.questions:null;
   if(!arr)throw new Error('JSON 顶层须为问答数组，或包含 items/questions 数组的对象');
   const first=(row,keys)=>keys.map(k=>row[k]).find(v=>v!==null&&v!==undefined&&(typeof v!=='string'||v.trim()!==''));
   const scalar=(value,field,index)=>{
     if(value===null||value===undefined)return '';
     if(typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return String(value);
     throw new Error(`JSON 第${index+1}条的${field}须为文字、数字或布尔值，不能使用嵌套对象或数组`);
   };
   for(const [i,row]of arr.entries()){
     if(!row||typeof row!=='object'||Array.isArray(row))throw new Error(`JSON 第${i+1}条须为包含问题和回答字段的对象`);
     const q=scalar(first(row,Q_KEYS),'问题',i),a=scalar(first(row,A_KEYS),'回答',i),rawPoints=first(row,POINT_KEYS);
     if(!q.trim())throw new Error(`JSON 第${i+1}条缺少有效问题字段`);
     const points=Array.isArray(rawPoints)?rawPoints.map(value=>scalar(value,'要点',i)).join('；'):scalar(rawPoints,'要点',i);
     const locator=`JSON ${i+1}`;
     add(q,a,points,locator,1,readMetadata(Object.entries(row),locator),sourceLocations('',row.sourceLocators??[]));
   }return out;
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
    const metadata=readMetadata(hdr.map((name,index)=>[name,c[index]]),rr[i].locator);
    const key=questionIdentity({question:q,...metadata});let g=groups.get(key);if(!g){g={q,type:'',variants:[],locator:rr[i].locator,metadata,locations:[],sourceRefs:[]};groups.set(key,g);}
    if(typeof rr[i].locator==='string')g.locations.push(rr[i].locator);if(metadata.sourceRef)g.sourceRefs.push(metadata.sourceRef);
    if(!g.type&&ti>=0)g.type=String(c[ti]||'').trim();
    const intent=ii>=0?String(c[ii]||'').trim():'',answers=ais.map(j=>String(c[j]||'').trim()).filter(Boolean);
    if(intent||answers.length)g.variants.push({intent,answers});
   }
   for(const g of groups.values()){
    const total=g.variants.reduce((n,v)=>n+v.answers.length,0),parts=[];let n=0;
    for(const v of g.variants)for(const a of v.answers){n++;parts.push((total>1?`【话术${n}${v.intent?' · '+v.intent:''}】`:'')+a);}
    const answer=bounded(parts.join('\n\n'),3000,'合并后的回答',g.locator),intents=[...new Set(g.variants.map(v=>v.intent).filter(Boolean))];
    out.push({question:bounded(g.q,500,'问题',g.locator),answer,keyPoints:[],intent:bounded(intents.join('；'),500,'消费者意图',g.locator),danmuType:bounded(g.type,20,'弹幕类型',g.locator),...g.metadata,sourceRef:metadataScalar([...new Set(g.sourceRefs)].join('\n'),'sourceRef',g.locator),sourceLocators:sourceLocations(g.locator,g.locations),locator:g.locator,reviewStatus:answer?'needs_review':'incomplete'});
   }
   continue;
  }
 const findIndex=(arr,excluded=[])=>{const keys=arr.map(cellHeader);let idx=hdr.findIndex((x,i)=>!excluded.includes(i)&&keys.includes(x));if(idx>=0)return idx;const headerLike=x=>x.length<=16&&!/[?？。！!；;]/.test(x);return hdr.findIndex((x,i)=>!excluded.includes(i)&&headerLike(x)&&keys.some(k=>k.length>=2&&(x.includes(k)||k.includes(x))))};let qi=findIndex(Q_KEYS),pi=findIndex(POINT_KEYS,qi>=0?[qi]:[]),ai=findIndex(A_KEYS,[qi,pi].filter(i=>i>=0));let start=0;if(qi>=0){start=1;}else{qi=0;ai=1;pi=-1;}for(let i=start;i<rr.length;i++){const c=rr[i].cells;add(c[qi],c[ai],pi>=0?c[pi]:'',rr[i].locator,3,start?readMetadata(hdr.map((name,index)=>[name,c[index]]),rr[i].locator):{})}}
 const lines=(parsed.blocks||[]).filter(x=>x.kind==='paragraph').flatMap(b=>String(b.text||'').split(/\n+/).map(s=>({text:s.trim(),locator:b.locator}))).filter(x=>x.text);
 let q='',a='',location='',pts='';const flush=()=>{if(q)add(q,a,pts,location);q='';a='';pts=''};
 for(const row of lines){const line=row.text;const single=line.match(/^(?:Q|问|提问|问题|弹幕)[:：\s]+(.+?)\s+(?:A|答|回答|参考回答|优秀回答)[:：\s]+(.+)$/i);if(single){flush();add(single[1],single[2],'',row.locator);continue}
  const isQ=line.match(/^(?:Q|问|提问|问题|弹幕|顾客)\s*[:：.、]\s*(.+)$/i);const isA=line.match(/^(?:A|答|回答|参考答案|优秀回答|成熟回答)\s*[:：.、]\s*(.+)$/i);
  if(isQ){flush();q=isQ[1];location=row.locator;}else if(isA){a+=(a?'\n':'')+isA[1]}else if(/^\s*(?:要点|评分点|关键点)\s*[:：]/.test(line)){pts+=line.replace(/^[^:：]+[:：]/,'');}else if(a){a+='\n'+line;}else if(q&&line.length<300){q+=' '+line;}}
 flush();return out;
}
export function detectReviewConflicts(rows,{existing=[],boardId='',platform='',category='',scope=''}={}){
 const context={boardId,platform,category,scope},seen=new Map();
 const describe=row=>({row,product:productIdentity(row),identity:questionIdentity(row,context),range:effectiveRange(row,context),answer:qaNorm(row.answer)});
 for(const row of rows){
  if(!row.reviewStatus||['needs_review','duplicate','conflict','incomplete'].includes(row.reviewStatus))row.reviewStatus=row.answer?'needs_review':'incomplete';
  if(!row.answer||row.reviewStatus==='sensitive')continue;
  const value=describe(row),group=seen.get(value.product)||[];group.push(value);seen.set(value.product,group);
 }
 for(const group of seen.values()){
  for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){
   const a=group[i],b=group[j];if(!rangesOverlap(a.range,b.range))continue;
   if(a.answer!==b.answer){a.row.reviewStatus='conflict';b.row.reviewStatus='conflict';}
   else if(a.identity===b.identity&&b.row.reviewStatus!=='conflict')b.row.reviewStatus='duplicate';
  }
 }
 const candidates=existing.filter(x=>x&&x.status!=='rejected').map(describe);
 for(const r of rows){
  if(!r.answer){r.reviewStatus='incomplete';continue;}if(r.reviewStatus==='sensitive')continue;
  const value=describe(r),hits=candidates.filter(x=>x.product===value.product&&rangesOverlap(x.range,value.range));
  if(hits.some(hit=>hit.answer!==value.answer))r.reviewStatus='conflict';
  else if(hits.some(hit=>hit.identity===value.identity)&&r.reviewStatus!=='conflict')r.reviewStatus='duplicate';
 }
 return {dup:rows.filter(row=>row.reviewStatus==='duplicate').length,conflict:rows.filter(row=>row.reviewStatus==='conflict').length};
}
