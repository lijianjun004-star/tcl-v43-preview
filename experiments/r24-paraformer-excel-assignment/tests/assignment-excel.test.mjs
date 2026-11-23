import test from 'node:test';import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
// Test the actual generated library, never a guessed historical source tree.
const qaFile=process.env.R24_EXCEL_SITE_DIR
 ? resolve(process.env.R24_EXCEL_SITE_DIR,'lib/qa-import.js')
 : fileURLToPath(new URL('../../../_qa/build/frontend/tcl-r24-paraformer-excel-qa/lib/qa-import.js',import.meta.url));
assert.ok(existsSync(qaFile),'Build the official candidate and set R24_EXCEL_SITE_DIR to its frontend directory before running tests');
const qaSource=readFileSync(qaFile,'utf8');
console.log('QA_IMPORT_SOURCE '+qaFile);
const {extractQA}=await import('data:text/javascript;base64,'+Buffer.from(qaSource).toString('base64'));
import {validateExcelQuestions,makeAssignment,parseRecipients,questionsForAssignment,isAssigned,verifyAssignment,toExchangePackage,toReceipt,verifyReceipt,verifyAssignmentSnapshot,assertExcelExtractionComplete,assignmentContent,sha256Hex,isDegenerateAnswer,isReceiptLate} from '../assignment-excel.mjs';
const parsed={format:'xlsx',blocks:[{kind:'table',rows:[
 {locator:'Excel 1',cells:['问题','参考答案','型号','SKU','评分点','品类','平台']},
 {locator:'Excel 2',cells:['这款TCL Q10L电视有什么画质技术？','请依据该型号已审核参数说明','Q10L','SKU-001','亮度；背光；画质','TCL 电视','京东']},
 {locator:'Excel 3',cells:['这台电视有哪些接口？','应核对该型号的HDMI和USB接口','Q10L','SKU-001','HDMI；USB','TCL 电视','京东']}
 ]}]};
const opts={category:'TCL 电视',platform:'京东'};
const get=()=>validateExcelQuestions(extractQA(parsed),opts);
async function build(){return await makeAssignment({id:'A-001',title:'电视基础作业',operatorName:'王运营',boardId:'01',platform:'京东',assignedTo:'张主播，李主播',questions:get(),createdAt:'2026-11-23T00:00:00Z'});}
function snapshot(a,changes={}){return {id:'run-1',assignmentId:a.id,assignmentVersion:a.version,assignmentSnapshotSha256:a.snapshotSha256,operatorName:a.operatorName,boardId:a.boardId,platform:a.platform,anchorName:'张主播',turns:a.questions.map(q=>({questionId:q.id,question:q.question,model:q.model,sku:q.sku,answer:'主播已保存回答',transcript:'原始转写',asrStatus:'已完成'})),...changes};}
test('01 table header and one-row-one-question parse',()=>{const a=extractQA(parsed);assert.equal(a.length,2);assert.equal(a[0].model,'Q10L');assert.deepEqual(a[0].keyPoints,['亮度','背光','画质']);});
test('02 preserve exact model/SKU and reference answer',()=>{const x=get();assert.equal(x[0].model,'Q10L');assert.equal(x[0].sku,'SKU-001');assert.equal(x[1].answer,'应核对该型号的HDMI和USB接口');});
test('03 empty answer blocked',()=>{const x=[{question:'什么是HDR10+',answer:''}];assert.throws(()=>validateExcelQuestions(x,opts),/参考答案缺失/);});
test('04 wrong platform rejected',()=>{assert.throws(()=>validateExcelQuestions([{question:'什么是电视',answer:'测试回答',platform:'抖音'}],opts),/平台/);});
test('05 JD/Tmall shared accepted only in related platform',()=>{let x=[{question:'能效指标是什么',answer:'测试内容',platform:'京东\/天猫'}];assert.equal(validateExcelQuestions(x,opts).length,1);assert.throws(()=>validateExcelQuestions(x,{...opts,platform:'抖音'}),/平台/);});
test('06 wrong category rejected',()=>{assert.throws(()=>validateExcelQuestions([{question:'冰箱怎么样',answer:'测试答案',category:'TCL 冰箱'}],opts),/品类/);});
test('07 duplicate same question+SKU blocked',()=>{const x=[{question:'这款型号为什么好',answer:'参考答案',model:'T7M',sku:'10'},{question:'这款型号为什么好',answer:'第二份答案',model:'T7M',sku:'10'}];assert.throws(()=>validateExcelQuestions(x,opts),/重复/);});
test('08 same question different model permitted',()=>{let x=[{question:'对比具体参数',answer:'型号1',model:'Q10L'},{question:'对比具体参数',answer:'型号2',model:'T7M'}];assert.equal(validateExcelQuestions(x,opts).length,2);});
test('09 stop >100 questions',()=>{assert.throws(()=>validateExcelQuestions(Array.from({length:101},(_,i)=>({question:'测试问题'+i,answer:'参考答案'})),opts),/100/);});
test('10 recipients trim and dedupe',()=>assert.deepEqual(parseRecipients('张主播，李主播\n张主播; 王主播'),['张主播','李主播','王主播']));
test('11 historical selected anchor access only',async()=>{const a=await build();assert.ok(isAssigned(a,'张主播'));assert.ok(!isAssigned(a,'赵主播'));});
test('12 immutable assignment source after publish',async()=>{let q=get(),a=await makeAssignment({id:'A-02',title:'测试',operatorName:'运',boardId:'01',platform:'京东',assignedTo:['张主播'],questions:q});q[0].question='恶意覆盖';assert.notEqual(a.questions[0].question,'恶意覆盖');assert.ok(Object.isFrozen(a.questions[0]));});
test('13 version hash validates',async()=>{const a=await build();assert.equal((await verifyAssignment(a)).snapshotSha256,a.snapshotSha256);});
test('14 reject modified question in transferred assignment',async()=>{let a=await build(),tampered=structuredClone(a);tampered.questions[0].answer='篡改';await assert.rejects(verifyAssignment(tampered),/校验失败/);});
test('15 distinct version-specific frozen pool',async()=>{const a=await build();const questions=questionsForAssignment(a);questions[0].answer='修改后';assert.notEqual(a.questions[0].answer,'修改后');assert.equal(questions.length,2);});
test('16 export/import contains assignment only',async()=>{let a=await build(),pkg=toExchangePackage(a);assert.equal(pkg.schema,'tcl-r24-excel-assignment/v1');assert.equal(pkg.assignment.questions.length,2);assert.ok(!JSON.stringify(pkg).includes('localEntries'));await verifyAssignment(pkg.assignment);});
test('17 recipient mismatch receipt rejected',async()=>{let a=await build();assert.throws(()=>toReceipt(a,snapshot(a,{anchorName:'赵主播'})),/不在/);});
test('18 complete receipt belongs to exact version',async()=>{let a=await build(),r=toReceipt(a,snapshot(a));assert.ok(verifyReceipt(r,a));assert.throws(()=>verifyReceipt({...r,snapshotSha256:'0'.repeat(64)},a),/不一致/);});
test('19 no imported question can be public data by default',()=>{assert.equal(get()[0].kind,'assignment-excel');assert.equal(get()[0].source,'运营Excel作业');});
test('20 open Excel assignment supports no selected streamer',async()=>{
 const a=await makeAssignment({id:'A-open-20',title:'公开领取作业',operatorName:'王运营',boardId:'01',platform:'京东',questions:get()});
 assert.deepEqual(a.assignedTo,[]);
 for(const name of ['张主播','李主播','赵主播']) assert.equal(isAssigned(a,name),true);
 assert.equal(isAssigned(a,''),false);
 const explicit=await makeAssignment({id:'A-open-20b',title:'公开领取作业',operatorName:'王运营',boardId:'01',platform:'京东',assignedTo:[],questions:get()});
 assert.deepEqual(explicit.assignedTo,[]);
 assert.deepEqual((await verifyAssignment(toExchangePackage(a).assignment)).assignedTo,[]);
});
import {assertExcelOneRowPerQuestion} from '../assignment-excel.mjs';
test('21 reject duplicate Excel table records before legacy aggregation',()=>{
 const file={format:'xlsx',blocks:[{kind:'table',rows:[
 {cells:['弹幕内容','型号','SKU','案例话术1']},
 {locator:'sheet:2',cells:['怎么介绍这台电视','Q10L','SKU1','回答1']},
 {locator:'sheet:3',cells:['怎么介绍这台电视','Q10L','SKU1','回答2']}
 ]}]};assert.throws(()=>assertExcelOneRowPerQuestion(file),/出现多行/);
});
test('22 repeated question with distinct product SKU can coexist',()=>{
 const file={format:'xlsx',blocks:[{kind:'table',rows:[
 {cells:['弹幕内容','型号','SKU','案例话术1']},
 {locator:'sheet:2',cells:['怎么介绍这台电视','Q10L','SKU1','回答1']},
 {locator:'sheet:3',cells:['怎么介绍这台电视','Q10L','SKU2','回答2']}
 ]}]};assert.doesNotThrow(()=>assertExcelOneRowPerQuestion(file));
});

for(const label of ['题目','作业题目','QUESTION','用户提问','弹幕']){
 test('raw duplicate check recognizes header '+label,()=>{
  const p=structuredClone(parsed);p.blocks[0].rows[0].cells[0]=label;
  p.blocks[0].rows.push(structuredClone(p.blocks[0].rows[1]));
  assert.throws(()=>assertExcelOneRowPerQuestion(p),/出现多行/);
 });
}
test('raw rows and extraction count match without dropping blank-answer or blank-question rows',()=>{
 assert.equal(assertExcelOneRowPerQuestion(parsed),2);
 assert.equal(assertExcelExtractionComplete(2,extractQA(parsed)).length,2);
 for(const column of [0,1]){const p=structuredClone(parsed);p.blocks[0].rows[2].cells[column]='';assert.throws(()=>assertExcelOneRowPerQuestion(p),column===0?/题目/:/参考答案/);}
 assert.throws(()=>assertExcelExtractionComplete(2,extractQA(parsed).slice(0,1)),/原始行数/);
});
test('empty spreadsheet rows are ignored but unknown headers stop the import',()=>{
 const p=structuredClone(parsed);p.blocks[0].rows.push({cells:['','','','']});assert.equal(assertExcelOneRowPerQuestion(p),2);
 p.blocks[0].rows[0].cells=['编号','说明','商品'];assert.throws(()=>assertExcelOneRowPerQuestion(p),/未找到题目列/);
});
test('short questions cannot be silently omitted by the generic legacy extractor',()=>{
 const p=structuredClone(parsed);p.blocks[0].rows[1].cells[0]='价';assert.throws(()=>assertExcelOneRowPerQuestion(p),/不能静默略过/);
});
test('raw duplicate guard spans all worksheets',()=>{
 const p=structuredClone(parsed);p.blocks.push(structuredClone(p.blocks[0]));assert.throws(()=>assertExcelOneRowPerQuestion(p),/出现多行/);
});
test('raw source more than 100 rows is rejected before extraction or truncation',()=>{
 const p=structuredClone(parsed);p.blocks[0].rows=[p.blocks[0].rows[0],...Array.from({length:101},(_,i)=>({cells:['题目'+i,'测试参考答案']}))];
 assert.throws(()=>assertExcelOneRowPerQuestion(p),/100题/);
});
test('special multiline template missing answer is rejected before grouping',()=>{
 const p={format:'xlsx',blocks:[{kind:'table',rows:[{cells:['弹幕内容','型号','SKU','案例话术1']},{cells:['怎么介绍电视','Q10L','001','']}]}]};
 assert.throws(()=>assertExcelOneRowPerQuestion(p),/参考答案/);
});
test('scalar objects, unsafe SKU numbers and control characters are rejected',()=>{
 for(const [field,value] of [['question',{}],['answer',true],['sku',Number.MAX_SAFE_INTEGER+1],['model','M\u0000X'],['keyPoints',[{}]],['sourceLocators','not-an-array']]){
  assert.throws(()=>validateExcelQuestions([{question:'测试问题内容',answer:'测试参考答案',[field]:value}],opts));
 }
});
test('field limits reject data rather than truncating it',()=>{
 for(const [field,value] of [['question','问'.repeat(501)],['answer','答'.repeat(3001)],['model','M'.repeat(201)],['sourceRef','x'.repeat(2001)],['keyPoints',Array(13).fill('要点')],['sourceLocators',Array(21).fill('位置')]]){
  assert.throws(()=>validateExcelQuestions([{question:'测试问题内容',answer:'测试参考答案',[field]:value}],opts));
 }
});
test('SKU leading zero, case and model punctuation remain exact',()=>{
 const rows=validateExcelQuestions([{question:'接口有何区别',answer:'分别核实接口',model:'HDMI2.1',sku:'001-A'},{question:'接口有何区别',answer:'分别核实接口',model:'HDMI21',sku:'001-a'}],opts);
 assert.deepEqual(rows.map(r=>[r.model,r.sku]),[['HDMI2.1','001-A'],['HDMI21','001-a']]);
});
test('JD and Tmall sharing is explicit; Douyin never borrows their rows',()=>{
 for(const shared of ['京东/天猫','天猫/京东']){
  const rows=[{question:'这是测试题目',answer:'这是参考答案',platform:shared}];
  assert.equal(validateExcelQuestions(rows,{...opts,platform:'天猫'}).length,1);
  assert.throws(()=>validateExcelQuestions(rows,{...opts,platform:'抖音'}),/平台/);
 }
 assert.throws(()=>validateExcelQuestions([{question:'测试题目',answer:'测试答案',platform:'京东'}],{...opts,platform:'天猫'}),/平台/);
});
test('recipient list rejects blank, non-string, control and ambiguous names',async()=>{
 for(const assignedTo of [[' '],[42],['张\u202e主播'],['张\n主播'],['张\t主播'],['A主播','Ａ主播'],Array.from({length:101},(_,i)=>'主播'+i)]){
  await assert.rejects(makeAssignment({id:'a',title:'作业',operatorName:'运营',boardId:'01',platform:'京东',assignedTo,questions:get()}));
 }
 assert.throws(()=>parseRecipients({name:'张主播'}),/须为文字/);
});
test('created assignment freezes nested key points and origin locations',async()=>{
 const a=await build();assert.ok(Object.isFrozen(a.questions[0].keyPoints));assert.ok(Object.isFrozen(a.questions[0].sourceLocators));
 assert.throws(()=>a.questions[0].keyPoints.push('修改'),TypeError);
 assert.throws(()=>a.assignedTo.push('其他主播'),TypeError);
});
test('import returns a detached frozen snapshot rather than a mutable caller object',async()=>{
 const input=structuredClone(await build()),verified=await verifyAssignment(input);input.questions[0].answer='后来修改';
 assert.notEqual(verified.questions[0].answer,'后来修改');assert.ok(Object.isFrozen(verified));
});
test('hash is insensitive to JSON property order while preserving array order',async()=>{
 const a=await build(),reordered=JSON.parse(JSON.stringify(a),(key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse()):value);
 assert.equal((await verifyAssignment(reordered)).snapshotSha256,a.snapshotSha256);
 const swapped=structuredClone(a);swapped.assignedTo.reverse();await assert.rejects(verifyAssignment(swapped),/校验失败/);
});
test('every assignment identity field participates in the content hash',async()=>{
 const a=await build();
 for(const [key,value] of [['id','another'],['title','另一作业'],['operatorName','另一运营'],['boardId','03'],['deadline','2026-12-01T00:00:00Z'],['createdAt','2026-11-22T00:00:00Z'],['assignedTo',['李主播']]]){
  await assert.rejects(verifyAssignment({...structuredClone(a),[key]:value}),/校验失败/);
 }
});
test('unknown versions, extra fields and malformed identities are refused even after rehash',async()=>{
 const a=await build();
 for(const [key,value] of [['version',2],['schema','tcl-r24-excel-assignment/v0'],['id','../escape'],['title',''],['operatorName',42],['boardId','99'],['platform','未知平台'],['createdAt','2026-02-30T00:00:00Z'],['assignedTo',['张主播','张主播']],['hiddenQuestionPool',[]]]){
  const changed={...structuredClone(a),[key]:value};changed.snapshotSha256=await sha256Hex(assignmentContent(changed));
  await assert.rejects(verifyAssignment(changed));
 }
});
test('question IDs, fields and canonical row order are checked independently of a matching hash',async()=>{
 const a=await build();
 for(const mutate of [x=>x.questions[1].id=x.questions[0].id,x=>x.questions[0].sku=123,x=>x.questions[0].platform='抖音',x=>x.questions[0].extra='unrecognized',x=>x.questions.reverse()]){
  const changed=structuredClone(a);mutate(changed);changed.snapshotSha256=await sha256Hex(assignmentContent(changed));await assert.rejects(verifyAssignment(changed));
 }
});
test('optional authoritative board check rejects mismatched category or platform',async()=>{
 const a=await build();assert.equal((await verifyAssignment(a,{board:{id:'01',category:'TCL 电视',platforms:['京东','天猫']}})).id,a.id);
 await assert.rejects(verifyAssignment(a,{board:{id:'03',category:'TCL 冰箱',platforms:['京东','天猫']}}),/本站训练板块/);
});
test('historical restricted assignments cannot become public by dropping recipients',async()=>{
 const a=structuredClone(await build());delete a.assignedTo;assert.equal(isAssigned(a,'其他主播'),false);
 assert.equal(isAssigned({id:'legacy'},'原主播'),true);
});
test('fully answered session retains exact frozen version and exports a verifiable receipt',async()=>{
 const a=await build(),snap=snapshot(a);assert.equal(await verifyAssignmentSnapshot(a,snap),true);
 const receipt=toReceipt(a,snap);assert.equal(verifyReceipt(receipt,await verifyAssignment(a)),true);
 assert.equal(receipt.assignmentVersion,1);assert.equal(receipt.boardId,'01');assert.equal(receipt.platform,'京东');assert.match(receipt.warning,/人工复核/);
});
for(const [name,mutate,pattern] of [
 ['partial',s=>s.turns.pop(),/全部题目/],
 ['duplicate',s=>s.turns[1]=structuredClone(s.turns[0]),/ID、顺序/],
 ['reordered',s=>s.turns.reverse(),/ID、顺序/],
 ['foreign-id',s=>s.turns[0].questionId='excel-other',/ID、顺序/],
 ['changed-question',s=>s.turns[0].question='另一个问题',/题目、型号或SKU/],
 ['wrong-model',s=>s.turns[0].model='Q10L Pro',/题目、型号或SKU/],
 ['wrong-sku',s=>s.turns[0].sku='SKU-002',/题目、型号或SKU/],
 ['empty-answer',s=>s.turns[0].answer=' ',/尚未完成回答/],
 ['cleared-with-old-transcript',s=>{s.turns[0].manualCleared=true;s.turns[0].transcript='旧文字';},/尚未完成回答/]
]){
 test('cannot submit '+name+' work as complete',async()=>{
  const a=await build(),s=snapshot(a);mutate(s);assert.throws(()=>toReceipt(a,s),pattern);await assert.rejects(verifyAssignmentSnapshot(a,s),pattern);
 });
}
for(const [key,value] of [['assignmentSnapshotSha256','0'.repeat(64)],['assignmentVersion',0],['assignmentId','other'],['operatorName','另一运营'],['boardId','03'],['platform','抖音'],['anchorName','无关主播']]){
 test('submission identity rejects wrong '+key,async()=>{const a=await build(),s=snapshot(a,{[key]:value});await assert.rejects(verifyAssignmentSnapshot(a,s));assert.throws(()=>toReceipt(a,s));});
}
test('legacy sessions without a frozen assignment version cannot be relabelled by current state',async()=>{
 const a=await build(),s=snapshot(a);delete s.assignmentSnapshotSha256;delete s.assignmentVersion;
 await assert.rejects(verifyAssignmentSnapshot(a,s),/冻结版本/);
});
test('full hash is verified before a submission is accepted',async()=>{
 const a=structuredClone(await build()),s=snapshot(a);a.questions[0].answer='作业参考答案已更改';
 await assert.rejects(verifyAssignmentSnapshot(a,s),/校验失败/);
});
test('manual receipts reject missing answers, repeated questions, wrong SKU and stale versions',async()=>{
 const a=await build(),good=toReceipt(a,snapshot(a));
 for(const mutate of [r=>r.turns.pop(),r=>r.turns[1]=structuredClone(r.turns[0]),r=>r.turns[0].answer='',r=>r.turns[0].sku='other',r=>r.assignmentVersion=0,r=>r.platform='抖音',r=>r.sessionId='',r=>r.warning='已认证',r=>r.turns[0].hidden=true]){
  const r=structuredClone(good);mutate(r);assert.throws(()=>verifyReceipt(r,a));
 }
});
test('same question text on different model rows still requires the correct model and SKU per ID',async()=>{
 const questions=validateExcelQuestions([{question:'这个型号的特点是什么',answer:'第一型号参考',model:'M1',sku:'001'},{question:'这个型号的特点是什么',answer:'第二型号参考',model:'M2',sku:'002'}],opts);
 const a=await makeAssignment({id:'same-question',title:'同问异型号',operatorName:'王运营',boardId:'01',platform:'京东',assignedTo:['张主播'],questions});
 const s=snapshot(a);assert.equal(await verifyAssignmentSnapshot(a,s),true);s.turns[1].model='M1';s.turns[1].sku='001';await assert.rejects(verifyAssignmentSnapshot(a,s),/型号或SKU/);
});
test('oversized receipts fail explicitly instead of exporting an unimportable file',async()=>{
 const questions=validateExcelQuestions(Array.from({length:100},(_,i)=>({question:'测试题目'+i,answer:'测试参考答案'})),opts);
 const a=await makeAssignment({id:'big',title:'多题测试',operatorName:'王运营',boardId:'01',platform:'京东',assignedTo:['张主播'],questions});
 const varied=Array.from({length:10000},(_,i)=>String.fromCharCode(0x4e00+i%500)).join('');
 const s=snapshot(a);s.turns.forEach(t=>{t.answer=varied;});assert.throws(()=>toReceipt(a,s),/交换大小上限/);
});
test('candidate importer handles reordered 题目/作业题目 headers without guessing the first column',()=>{
 for(const questionHeader of ['题目','作业题目']){
  const p={format:'xlsx',blocks:[{kind:'table',rows:[
   {cells:['型号','SKU',questionHeader,'参考答案','评分要点','品类','平台']},
   {cells:['Q10L','0001','这款电视如何演示画质','只依据已审核型号内容','画质；用途','TCL 电视','京东']}
  ]}]};
  const rows=assertExcelExtractionComplete(assertExcelOneRowPerQuestion(p),extractQA(p));
  const questions=validateExcelQuestions(rows,opts);assert.equal(questions[0].question,'这款电视如何演示画质');
  assert.equal(questions[0].model,'Q10L');assert.equal(questions[0].sku,'0001');assert.deepEqual(questions[0].keyPoints,['画质','用途']);
 }
});

test('public Excel job is searchable by operator independently of streamer identity',async()=>{
 const a=await makeAssignment({id:'public-search',title:'冰箱外观话术',operatorName:'王运营',boardId:'01',platform:'京东',assignedTo:[],questions:get()});
 const query='王运营',all=[a,await build()];
 const found=all.filter(x=>isAssigned(x,'未指定的新主播')&&[x.operatorName,x.title,x.platform].join(' ').includes(query));
 assert.deepEqual(found.map(x=>x.id),['public-search']);
 const transferred=await verifyAssignment(toExchangePackage(a).assignment);
 for(const anchorName of ['新主播甲','新主播乙']){
  const receipt=toReceipt(transferred,snapshot(transferred,{anchorName,sessionId:'run-'+anchorName}));
  assert.equal(receipt.anchorName,anchorName);
  assert.ok(verifyReceipt(receipt,transferred));
 }
});
test('public job cannot be silently converted to a restricted roster',async()=>{
 const a=structuredClone(await makeAssignment({id:'public-locked',title:'公开练习',operatorName:'王运营',boardId:'01',platform:'京东',assignedTo:[],questions:get()}));
 a.assignedTo=['张主播'];
 await assert.rejects(verifyAssignment(a),/校验失败/);
});

test('QA3 degenerate noise transcripts are not accepted as answers',()=>{
 for(const noise of ['谢谢谢谢谢谢谢谢谢谢谢谢','不不不谢谢谢谢谢谢谢不谢','嗯嗯嗯嗯','好的好的','AAAA AAAA','。。。谢谢，谢谢！谢谢','的的的的的的的的的的的是','谢谢谢谢谢谢不不好好']) assert.equal(isDegenerateAnswer(noise),true,noise);
 for(const real of ['主播已保存回答','这款TCL Q10L电视支持144Hz高刷','好的','谢谢','人工回答第1题：TEST-A1 为合成型号，信息仅用于流程测试。','RV-1 型号 001','一二三四五六七八九十十十十',Array.from({length:10000},(_,i)=>String.fromCharCode(0x4e00+i%500)).join('')]) assert.equal(isDegenerateAnswer(real),false,real);
});
test('QA3 submission and manual receipt reject noise-only answers',async()=>{
 const a=await build(),s=snapshot(a);s.turns[0].answer='谢谢谢谢谢谢谢谢谢谢谢谢';
 await assert.rejects(verifyAssignmentSnapshot(a,s),/疑似噪音误识别或重复字/);
 const good=toReceipt(a,snapshot(a)),r=structuredClone(good);r.turns[1].answer='不不不谢谢谢谢谢谢谢不谢';
 assert.throws(()=>verifyReceipt(r,a),/第2题回答疑似噪音/);assert.equal(verifyReceipt(good,a),true);
});
test('QA3 receipt lateness uses the frozen deadline and the receipt submission time',async()=>{
 const base=await build();assert.equal(isReceiptLate({submittedAt:'2030-01-01T00:00:00Z'},base),false);
 const a=await makeAssignment({id:'late-1',title:'限时作业',operatorName:'王运营',boardId:'01',platform:'京东',deadline:'2026-11-23T10:23:00.000Z',assignedTo:[],questions:get(),createdAt:'2026-11-23T10:00:00Z'});
 assert.equal(isReceiptLate({submittedAt:'2026-11-23T10:22:59.999Z'},a),false);
 assert.equal(isReceiptLate({submittedAt:'2026-11-23T10:23:00.000Z'},a),true);
 assert.equal(isReceiptLate({submittedAt:'2026-11-23T10:23:04.227Z'},a),true);
 assert.equal(isReceiptLate({submittedAt:'not-a-time'},a),false);
});
