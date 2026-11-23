import test from 'node:test';import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const localQA=new URL('../../base/tcl-v352-asr-r24-qa/lib/qa-import.js',import.meta.url);
const repoQA=new URL('../../r24/tcl-v352-asr-r24-qa/lib/qa-import.js',import.meta.url);
const {extractQA}=await import(existsSync(fileURLToPath(localQA))?localQA.href:repoQA.href);
import {validateExcelQuestions,makeAssignment,parseRecipients,questionsForAssignment,isAssigned,verifyAssignment,toExchangePackage,toReceipt,verifyReceipt} from '../assignment-excel.mjs';
const parsed={format:'xlsx',blocks:[{kind:'table',rows:[
 {locator:'Excel 1',cells:['问题','参考答案','型号','SKU','评分点','品类','平台']},
 {locator:'Excel 2',cells:['这款TCL Q10L电视有什么画质技术？','请依据该型号已审核参数说明','Q10L','SKU-001','亮度；背光；画质','TCL 电视','京东']},
 {locator:'Excel 3',cells:['这台电视有哪些接口？','应核对该型号的HDMI和USB接口','Q10L','SKU-001','HDMI；USB','TCL 电视','京东']}
 ]}]};
const opts={category:'TCL 电视',platform:'京东'};
const get=()=>validateExcelQuestions(extractQA(parsed),opts);
async function build(){return await makeAssignment({id:'A-001',title:'电视基础作业',operatorName:'王运营',boardId:'01',platform:'京东',assignedTo:'张主播，李主播',questions:get(),createdAt:'2026-11-23T00:00:00Z'});}
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
test('11 selected anchor access only',async()=>{const a=await build();assert.ok(isAssigned(a,'张主播'));assert.ok(!isAssigned(a,'赵主播'));});
test('12 immutable assignment source after publish',async()=>{let q=get(),a=await makeAssignment({id:'A-02',title:'测试',operatorName:'运',boardId:'01',platform:'京东',assignedTo:['张主播'],questions:q});q[0].question='恶意覆盖';assert.notEqual(a.questions[0].question,'恶意覆盖');assert.ok(Object.isFrozen(a.questions[0]));});
test('13 version hash validates',async()=>{const a=await build();assert.equal((await verifyAssignment(a)).snapshotSha256,a.snapshotSha256);});
test('14 reject modified question in transferred assignment',async()=>{let a=await build(),tampered=structuredClone(a);tampered.questions[0].answer='篡改';await assert.rejects(verifyAssignment(tampered),/校验失败/);});
test('15 distinct version-specific frozen pool',async()=>{const a=await build();const questions=questionsForAssignment(a);questions[0].answer='修改后';assert.notEqual(a.questions[0].answer,'修改后');assert.equal(questions.length,2);});
test('16 export/import contains assignment only',async()=>{let a=await build(),pkg=toExchangePackage(a);assert.equal(pkg.schema,'tcl-r24-excel-assignment/v1');assert.equal(pkg.assignment.questions.length,2);assert.ok(!JSON.stringify(pkg).includes('localEntries'));await verifyAssignment(pkg.assignment);});
test('17 recipient mismatch receipt rejected',async()=>{let a=await build();assert.throws(()=>toReceipt(a,{id:'run',assignmentId:a.id,anchorName:'赵主播',turns:[]}),/不在/);});
test('18 receipt belongs to exact version',async()=>{let a=await build(),r=toReceipt(a,{id:'run1',assignmentId:a.id,anchorName:'张主播',turns:[{question:a.questions[0].question,answer:'主播的回答'}]});assert.ok(verifyReceipt(r,a));assert.throws(()=>verifyReceipt({...r,snapshotSha256:'0'.repeat(64)},a),/不一致/);});
test('19 no imported question can be public data by default',()=>{assert.equal(get()[0].kind,'assignment-excel');assert.equal(get()[0].source,'运营Excel作业');});
test('20 missing recipients blocked',async()=>{await assert.rejects(makeAssignment({id:'a',title:'b',operatorName:'c',boardId:'d',platform:'京东',assignedTo:'',questions:get()}),/至少一名/);});
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