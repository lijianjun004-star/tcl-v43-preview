/** R24 immutable per-assignment question snapshots. Pure helpers, no remote calls. */
export const ASSIGNMENT_SCHEMA='tcl-r24-excel-assignment/v1';
const txt=(value)=>String(value??'').trim();
const norm=value=>txt(value).normalize('NFKC').toLowerCase().replace(/\s+/gu,'');
export const parseRecipients=value=>[...new Set(txt(value).split(/[\n,，;；、]+/u).map(x=>x.trim()).filter(Boolean))];
const check=(ok,msg)=>{if(!ok)throw new Error(msg)};
const platformFits=(source,dest)=>!source||source===dest||source==='全部平台'||source==='京东/天猫'&&['京东','天猫'].includes(dest)||source==='天猫/京东'&&['京东','天猫'].includes(dest);

/** Reject multi-row repeated questions before the legacy QA importer folds them into one. */
export function assertExcelOneRowPerQuestion(parsed){
 if(!parsed||!Array.isArray(parsed.blocks))return;
 for(const block of parsed.blocks){
  if(block.kind!=='table'||!Array.isArray(block.rows)||!block.rows.length)continue;
  const rows=block.rows;
  const headers=(rows[0].cells||[]).map(x=>norm(x));
  const find=(aliases)=>headers.findIndex(h=>aliases.some(a=>norm(a)===h));
  const questionColumn=find(['弹幕内容','问题','用户问题','提问','顾客提问','话术问题','问']);
  if(questionColumn<0)continue;
  const modelColumn=find(['型号','产品型号','商品型号','model']);
  const skuColumn=find(['SKU','商品SKU','产品SKU']);
  const seen=new Set();
  for(const row of rows.slice(1)){
   const cells=row.cells||[];
   const question=txt(cells[questionColumn]);if(!question)continue;
   const key=JSON.stringify([norm(question),norm(modelColumn>=0?cells[modelColumn]:''),norm(skuColumn>=0?cells[skuColumn]:'')]);
   check(!seen.has(key),`${row.locator||'Excel'}：同一问题/型号/SKU出现多行。请合并到一行后再上传作业`);
   seen.add(key);
  }
 }
}

/** Input is from existing parseDocumentFile + extractQA; never mix with public `items`. */
export function validateExcelQuestions(rows,{category,platform,max=100}={}){
 check(Array.isArray(rows),'未读取到有效问答行');
 check(rows.length>=1 && rows.length<=max,`本次作业须有1–${max}道完整题目，超出时请拆分Excel`);
 const seen=new Set();
 return rows.map((row,i)=>{
  const location=txt(row?.locator||row?.sourceLocators?.[0])||`第${i+2}行`;
  const question=txt(row?.question),referenceAnswer=txt(row?.answer);
  check(question.length>=2&&question.length<=500,`${location}：题目缺失或超过500字`);
  check(referenceAnswer.length>=2&&referenceAnswer.length<=3000,`${location}：参考答案缺失或超过3000字`);
  const product=txt(row?.model),sku=txt(row?.sku),cat=txt(row?.category),sourcePlat=txt(row?.platform);
  check(!cat||norm(cat)===norm(category)||norm(cat).replace(/^tcl/,'')===norm(category).replace(/^tcl/,''),`${location}：品类与这份作业不一致`);
  check(platformFits(sourcePlat,platform),`${location}：平台与这份作业不一致`);
  check(product.length<=200&&sku.length<=200,`${location}：型号或SKU超过长度限制`);
  const key=JSON.stringify([norm(question),norm(product),norm(sku)]);
  check(!seen.has(key),`${location}：发现重复题目、型号和SKU，请在源Excel中核对`);seen.add(key);
  const points=Array.isArray(row?.keyPoints)?row.keyPoints.map(txt).filter(Boolean):txt(row?.keyPoints).split(/[;,，、；\n]+/u).map(txt).filter(Boolean);
  check(points.length<=12&&points.every(p=>p.length<=200),`${location}：评分要点过多或过长`);
  return {id:`excel-${i+1}`,question,answer:referenceAnswer,keyPoints:points,pointKeywords:[],model:product,sku,category,platform,source:txt(row.source)||'运营Excel作业',sourceRef:txt(row.sourceRef),sourceLocators:(row.sourceLocators||[]).map(txt).filter(Boolean).slice(0,4),kind:'assignment-excel',stage:'运营作业'};
 });
}

export async function sha256Hex(value){
 const data=new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));
 const buffer=await crypto.subtle.digest('SHA-256',data);
 return [...new Uint8Array(buffer)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function assignmentContent(a){
 return {schema:ASSIGNMENT_SCHEMA,id:a.id,title:a.title,operatorName:a.operatorName,boardId:a.boardId,platform:a.platform,deadline:a.deadline||'',createdAt:a.createdAt,assignedTo:a.assignedTo,questions:a.questions,version:1};
}
export async function makeAssignment({id,title,operatorName,boardId,platform,deadline='',assignedTo,questions,createdAt}){
 const names=Array.isArray(assignedTo)?assignedTo:parseRecipients(assignedTo);
 check(names.length>=1 && names.length<=100,'必须指定至少一名主播，最多100名');
 check(names.every(x=>x.length<=40),'主播姓名不能超过40字');
 check(txt(id)&&txt(title)&&txt(operatorName)&&txt(boardId)&&txt(platform),'作业名称、发布人、品类和平台必须完整');
 check(Array.isArray(questions)&&questions.length>=1,'必须先预览Excel题目');
 const a={id:txt(id),title:txt(title),operatorName:txt(operatorName),boardId:txt(boardId),platform:txt(platform),deadline:txt(deadline),createdAt:createdAt||new Date().toISOString(),assignedTo:names,questions:structuredClone(questions),version:1,schema:ASSIGNMENT_SCHEMA};
 const hash=await sha256Hex(assignmentContent(a));
 return Object.freeze({...a,questions:Object.freeze(a.questions.map(row=>Object.freeze({...row}))),assignedTo:Object.freeze([...names]),snapshotSha256:hash});
}
export function isAssigned(a,anchorName){return !Array.isArray(a?.assignedTo)||a.assignedTo.includes(txt(anchorName));}
export function questionsForAssignment(a){
 check(a?.schema===ASSIGNMENT_SCHEMA && Array.isArray(a.questions)&&a.questions.length,'该作业没有可用的Excel题目快照');
 return structuredClone(a.questions);
}
export async function verifyAssignment(a){
 check(a?.schema===ASSIGNMENT_SCHEMA,'不是R24 Excel作业包');
 check(a?.version===1 && Array.isArray(a.assignedTo) && a.assignedTo.length && a.assignedTo.length<=100,'作业格式或接收主播无效');
 check(Array.isArray(a.questions) && a.questions.length>0 && a.questions.length<=100,'作业题目数量无效');
 // validate each imported row rather than trusting a JSON file as an authority.
 const rows=validateExcelQuestions(a.questions,{category:a.questions[0]?.category,platform:a.platform});
 check(rows.length===a.questions.length,'作业题目不完整');
 const digest=await sha256Hex(assignmentContent(a));
 check(digest===a.snapshotSha256,'作业包校验失败，内容已改变');
 return a;
}
export function toExchangePackage(a){return {schema:ASSIGNMENT_SCHEMA,notice:'仅供手动传递的本机练播作业；姓名不是身份认证。请勿上传含隐私或机密的文件到公开页面。',assignment:structuredClone(a)};}
export function toReceipt(assignment,snapshot){
 check(snapshot?.assignmentId===assignment.id,'提交记录不属于这份作业');
 check(isAssigned(assignment,snapshot.anchorName),'提交的主播不在这份作业的分配名单');
 return {schema:'tcl-r24-assignment-receipt/v1',assignmentId:assignment.id,snapshotSha256:assignment.snapshotSha256,operatorName:assignment.operatorName,anchorName:snapshot.anchorName,sessionId:snapshot.id,submittedAt:new Date().toISOString(),turns:structuredClone(snapshot.turns||[]).map(t=>({questionId:txt(t.questionId),question:txt(t.question),answer:txt(t.answer),transcript:txt(t.transcript),model:txt(t.model),sku:txt(t.sku),asrStatus:txt(t.asrStatus)})),warning:'手动传递的回执未经服务端身份认证，运营必须人工复核'};
}
export function verifyReceipt(receipt,assignment){
 check(receipt?.schema==='tcl-r24-assignment-receipt/v1','回执文件格式不支持');
 check(receipt.assignmentId===assignment.id && receipt.snapshotSha256===assignment.snapshotSha256,'回执对应的作业版本不一致');
 check(receipt.operatorName===assignment.operatorName && isAssigned(assignment,receipt.anchorName),'回执接收人或主播不匹配');
 check(Array.isArray(receipt.turns)&&receipt.turns.length>=1&&receipt.turns.length<=100,'回执题目数量无效');
 const expected=assignment.questions.map(x=>x.question);
 check(receipt.turns.length<=expected.length && receipt.turns.every(t=>expected.includes(t.question)),'回执包含不属于原作业的题目');
 return true;
}