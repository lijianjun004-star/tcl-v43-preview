// Synthetic inputs only. Read current module once, then import that exact snapshot.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const moduleURL=new URL('../../../experiments/r24/tcl-v352-asr-r24-qa/lib/qa-import.js',import.meta.url);
const source=fs.readFileSync(moduleURL);
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const {extractQA,detectReviewConflicts}=await import('data:text/javascript;base64,'+source.toString('base64'));
const cases=[];
function conflictCase(name,row,existing,context={},expected='conflict'){
 const input={rows:[row],existing,context};
 const rows=structuredClone(input.rows);
 const summary=detectReviewConflicts(rows,{...context,existing:structuredClone(existing)});
 cases.push({name,input,expected_review_status:expected,observed:{summary,rows},pass:rows[0].reviewStatus===expected});
}
const base={question:'支持什么功能？',answer:'支持 A',model:'T7M Pro',sku:'SKU-A',scope:'board',boardId:'1',category:'TCL 电视',platform:'京东'};
const incoming={...base,answer:'不支持 A'};
conflictCase('existing_all_platform_vs_new_jd',incoming,[{...base,platform:'全部平台'}]);
conflictCase('existing_category_vs_new_board',incoming,[{...base,scope:'category',boardId:'2'}]);
conflictCase('new_category_vs_existing_board',{...incoming,scope:'category',boardId:'2'},[base]);
conflictCase('existing_joint_platform_vs_new_jd',incoming,[{...base,platform:'京东/天猫'}]);
conflictCase('all_platform_category_vs_new_board',incoming,[{...base,scope:'category',platform:'全部平台',boardId:'2'}]);
for(const [field,value] of [['model','T8M'],['sku','SKU-B'],['sku','sku-a'],['category','雷鸟电视'],['platform','天猫'],['boardId','2']]){
 conflictCase('independent_'+field+'_'+value,{...incoming,[field]:value},[base],{},'needs_review');
}
function importCase(name,input,expectation,check){
 let observed;
 try{observed={rows:extractQA({format:'json',jsonData:JSON.parse(input)})};}catch(e){observed={error:e.message};}
 cases.push({name,input_json:input,expected:expectation,observed,pass:check(observed)});
}
importCase('unsafe_numeric_sku','[{"question":"如何核对接口？","answer":"以对应文件为准","sku":9007199254740993}]','Reject unsafe numeric SKU; require source string',r=>!!r.error);
importCase('case_sensitive_source_aliases',JSON.stringify([{question:'如何核对接口？',answer:'以对应文件为准',sourceRef:'https://example.com/SpecA.pdf',source_ref:'https://example.com/speca.pdf'}]),'Reject conflicting source aliases whose URL paths differ in case',r=>!!r.error);
importCase('blank_canonical_source',JSON.stringify([{question:'如何核对接口？',answer:'以对应文件为准',sourceRef:' ',来源:'https://example.com/actual.pdf'}]),'Whitespace-only sourceRef must not mask nonblank source alias',r=>r.rows?.[0].sourceRef==='https://example.com/actual.pdf');
importCase('model_alias_conflict',JSON.stringify([{question:'如何核对接口？',answer:'以对应文件为准',model:'T7M Pro',product_model:'T8M'}]),'Reject conflicting model aliases',r=>!!r.error);
importCase('canonical_source_over_legacy_label',JSON.stringify([{question:'如何核对接口？',answer:'以对应文件为准',sourceRef:'https://example.com/actual.pdf',source:'匿名导入资料 · 第2行'}]),'Canonical sourceRef preserved over legacy source display label',r=>r.rows?.[0].sourceRef==='https://example.com/actual.pdf');
importCase('large_sku_string_preserved',JSON.stringify([{question:'如何核对接口？',answer:'以对应文件为准',sku:'9007199254740993'}]),'Large SKU provided as a string remains exact',r=>r.rows?.[0].sku==='9007199254740993');
const boundaries=[];
for(const row of [
 {question:'是否支持 HDMI2.1？',问题:'是否支持 HDMI2.0？',answer:'支持'},
 {question:'是否支持 HDMI2.1？',answer:'支持',答案:'不支持'}
])boundaries.push({name:'preexisting_qa_alias_first_value_behavior',scope:'Recorded only; excluded from this repair round by task owner',input:row,observed:extractQA({format:'json',jsonData:[row]})});
console.log(JSON.stringify({recorded_at_utc:new Date().toISOString(),mode:'Independent Node import of exact local module snapshot; synthetic data; no browser/model/network requests',module_path:fileURLToPath(moduleURL),module_sha256:sha(source),module_sha256_after:sha(fs.readFileSync(moduleURL)),source_unchanged_during_run:sha(source)===sha(fs.readFileSync(moduleURL)),probe_sha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),pass_count:cases.filter(x=>x.pass).length,case_count:cases.length,cases,boundaries},null,2));
