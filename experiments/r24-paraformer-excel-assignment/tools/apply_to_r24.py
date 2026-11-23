#!/usr/bin/env python3
"""Exact-source R24 patch. Fail closed if app structure has changed.
No frontend CSS or existing HTML files are modified; only app.js and a new module.
Do not use as an unreviewed production hotpatch.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys

MODULE=Path(__file__).resolve().parents[1]/'assignment-excel.mjs'
VERSION='r24-paraformer-excel-assignment-20261123-qa2-operator-search'
EXTERNAL_MODEL_FILES={
    'vendor/paraformer/sherpa-onnx-asr.js':'ab619fbad082d474ef35616072d3ace7e8f533d3725c611c1c60d7b97cac41c9',
    'vendor/paraformer/sherpa-onnx-wasm-main-vad-asr.data':'9b89b7afaf5375704e758e85e88955abab381f81c466b24ecc7320b24d81b80f',
    'vendor/paraformer/sherpa-onnx-wasm-main-vad-asr.js':'3e0cbcad90833164f04097e51fbc99b8812dc03977382578fb73eba7f5d13ec4',
    'vendor/paraformer/sherpa-onnx-wasm-main-vad-asr.wasm':'2fc8dc389b23ad07f0d526b2e7c7c828543956d053db858d73cff192be7589e3',
}
ISOLATED_MODULE_KEYS={
    'r23-model-choice.js':("'tcl-r24-paraformer-asr-model-v1'", "'tcl-r24-paraformer-excel-qa-asr-model-v1'"),
    'glossary-ui.mjs':("'tcl-r24-paraformer-private-asr-terms-v1'", "'tcl-r24-paraformer-excel-qa-private-asr-terms-v1'"),
    'paraformer-worker.js':("'tcl-r24-paraformer-assets-1.12.20-v1'", "'tcl-r24-paraformer-excel-qa-assets-1.12.20-v1'"),
}


def replace_once(s, old, new, name):
    count=s.count(old)
    if count!=1:
        raise ValueError(f'{name}: expected exactly one anchor; found {count}. Refusing to patch unknown R24 source.')
    return s.replace(old,new,1)


def patch_app(src:str)->str:
    s=src
    s=replace_once(s,"import { extractQA, detectReviewConflicts } from './lib/qa-import.js';",
        "import { extractQA, detectReviewConflicts } from './lib/qa-import.js';\nimport {validateExcelQuestions,assertExcelOneRowPerQuestion,makeAssignment,isAssigned,questionsForAssignment,toExchangePackage,verifyAssignment,toReceipt,verifyReceipt} from './assignment-excel.mjs';",'ASR/qa imports')
    s=replace_once(s,'let operatorActiveTab="publish";',
        'let assignmentExcelPreview=null, assignmentExcelEpoch=0;\nlet operatorActiveTab="publish";', 'operator state')
    s=replace_once(s,"const assigned=localAssignments.filter(a=>!q||norm(`${a.operatorName}${a.title}${boardById(a.boardId).category}${a.platform}`).includes(q));",
        "const assigned=localAssignments.filter(a=>isAssigned(a,userName)&&(!q||norm(`${a.operatorName}${a.title}${boardById(a.boardId).category}${a.platform}`).includes(q)));",'anchor assigned filter')
    s=replace_once(s,"const todo=localAssignments.filter(x=>['已加入','已训练','已逾期'].includes(assignmentStatusFor(x,userName)));",
        "const todo=localAssignments.filter(x=>isAssigned(x,userName)&&['已加入','已训练','已逾期'].includes(assignmentStatusFor(x,userName)));",'anchor todo')
    s=replace_once(s,
        "const q=norm(assignmentSearch),matches=localAssignments.filter(a=>!q||norm(`${a.operatorName}${a.title}${boardById(a.boardId).category}${a.platform}`).includes(q));",
        "const q=norm(assignmentSearch),matches=localAssignments.filter(a=>isAssigned(a,userName)&&(!q||norm(`${a.operatorName}${a.title}${boardById(a.boardId).category}${a.platform}`).includes(q)));",'anchor search filter')
    # Do not restyle/relayout: append only one input in existing fold.
    s=replace_once(s,'<div class="assignment-results" id="assignmentSearchResults">',
        '<div class="field"><label for="assignmentPackageImport">从运营接收作业包（JSON，跨设备需手动传送）</label><input type="file" id="assignmentPackageImport" accept=".json,application/json"><small>本机姓名不是账号认证；作业包需要运营本人发送给你。</small></div><div class="assignment-results" id="assignmentSearchResults">','anchor file import control')
    s=replace_once(s,'search.oninput=e=>{assignmentSearch=e.target.value;',
        "ELEM('assignmentPackageImport').onchange=importAssignmentPackage;\n search.oninput=e=>{assignmentSearch=e.target.value;",'anchor import binding')
    # Inline additions only in existing operator 'publish' panel.
    s=replace_once(s,'<button id="publishAssignment" class="btn primary wide hub-publish">',
        '<p class="scene-tip">本次作业面向所有主播开放领取；当前仅能搜索本机已有的作业，跨手机须先导入运营发送的 JSON。</p><div class="field"><label for="assignmentExcelFile">4. 上传本次作业 Excel</label><input type="file" id="assignmentExcelFile" accept=".xlsx,.xls"/><small>一行一题：问题、参考答案、型号、SKU、评分点。只用于本次作业，不进入公共题库。</small></div><button type="button" class="btn soft" id="assignmentExcelPreviewBtn">解析并预览作业题目</button><div id="assignmentExcelPreview" role="status" aria-live="polite"></div><button id="publishAssignment" class="btn primary wide hub-publish">','operator upload UI')
    s=replace_once(s,"ELEM('publishAssignment').onclick=async()=>{await publishAssignment();};",
        "ELEM('publishAssignment').onclick=async()=>{await publishAssignment();};\n ELEM('assignmentExcelPreviewBtn').onclick=previewAssignmentExcel;\n ['assignmentTitle','assignmentBoard','assignmentPlatform'].forEach(id=>ELEM(id).addEventListener('change',()=>{assignmentExcelEpoch++;assignmentExcelPreview=null;const dest=ELEM('assignmentExcelPreview');if(dest)dest.textContent='作业条件已变化，请重新预览Excel';}));\n ELEM('assignmentExcelFile').addEventListener('change',()=>{assignmentExcelEpoch++;assignmentExcelPreview=null;ELEM('assignmentExcelPreview').textContent='文件已更换，请重新解析预览';});\n document.querySelectorAll('[data-export-assignment]').forEach(btn=>btn.onclick=()=>{const a=assignmentById(btn.dataset.exportAssignment);if(a?.schema)downloadJSON('TCL-运营作业-'+a.id+'.json',toExchangePackage(a));});\n if(ELEM('assignmentReceiptImport'))ELEM('assignmentReceiptImport').onchange=importAssignmentReceipt;",'operator controls')
    s=replace_once(s,'<div class="assignment-results">${own.map(a=>',
        '<div class="field"><label for="assignmentReceiptImport">接收主播提交回执（JSON；需人工确认真实性）</label><input id="assignmentReceiptImport" type="file" accept=".json,application/json"></div><div class="assignment-results">${own.map(a=>','operator receipt input')
    s=replace_once(s,'<div class="assignment-statuses">${anchors.map',
        '<div>${a.schema?`<small>Excel作业 · ${a.questions.length}题 · 固定版本 v${a.version}</small><button type="button" class="btn soft small" data-export-assignment="${ESC(a.id)}">导出作业包给主播</button>`:""}</div><div class="assignment-statuses">${anchors.map','operator export button')
    # Keep historical explicitly named recipients in tracking; public [] tracks actual claimants.
    s=replace_once(s,
        "const anchors=[...new Set(localAssignmentJoins.filter(j=>j.assignmentId===a.id).map(j=>j.anchorName))];",
        "const anchors=[...new Set([...(a.assignedTo||[]),...localAssignmentJoins.filter(j=>j.assignmentId===a.id).map(j=>j.anchorName)])];",'assignment recipient status')
    s=replace_once(s,'if(!title)return toast(\'请输入作业名称\');',
        "if(!title)return toast('请输入作业名称');\n if(!assignmentExcelPreview||assignmentExcelPreview.epoch!==assignmentExcelEpoch||assignmentExcelPreview.boardId!==boardId||assignmentExcelPreview.platform!==platform||assignmentExcelPreview.file!==ELEM('assignmentExcelFile')?.files?.[0])return toast('请先上传Excel并完成预览，确认题目无误后发布');",'publish preflight')
    s=replace_once(s,"const item={id:uid(),title,operatorName:ownerName,boardId,platform,deadline:end?end.toISOString():'',createdAt:nowIso()};",
        "",'remove premature legacy assignment initializer')
    s=replace_once(s,"assignmentPublishPending=true;if(button)button.disabled=true;\n try{",
        "assignmentPublishPending=true;if(button)button.disabled=true;\n try{\n  const item=await makeAssignment({id:uid(),title,operatorName:ownerName,boardId,platform,deadline:end?end.toISOString():'',createdAt:nowIso(),assignedTo:[],questions:assignmentExcelPreview.questions});",'make immutable assignment inside catchable transaction')
    s=replace_once(s,"toast('作业已发布（本机测试数据）');operatorActiveTab='tracking';operatorHome();",
        "toast('已发布全员可领取的本机作业；跨手机仍须先传递 JSON，尚无共享后台');operatorActiveTab='tracking';operatorHome();",'publication truthfulness')
    s=replace_once(s,"if(sub)return sub.late?'逾期提交':'已提交';",
        "if(sub)return sub.manuallyImported?'回执待核实':sub.late?'逾期提交':'已提交';",'operator manual receipt status')
    s=replace_once(s,"const a=assignmentById(id);if(!a)return toast('作业不存在');",
        "const a=assignmentById(id);if(!a)return toast('作业不存在');\n if(!isAssigned(a,userName))return toast('此作业采用历史限定名单，当前主播姓名不匹配');",'recipient visibility join')
    # Prohibit accidental switching to a different category/platform with an active assignment.
    s=replace_once(s,"function openBoard(id,platform='',opts={}){\n if(!pageAllowed('training'))",
        "function openBoard(id,platform='',opts={}){\n const assigned=activeAssignmentId?assignmentById(activeAssignmentId):null;\n if(assigned&&!Object.prototype.hasOwnProperty.call(opts,'assignmentId')&&(assigned.boardId!==id||platform&&assigned.platform!==platform))return toast('当前为运营专属作业；如需更换板块，请先返回首页退出作业');\n if(!pageAllowed('training'))",'prevent assignment cross-board')
    s=replace_once(s,"const b=boardById(selectedBoard);questions=JSON.parse(JSON.stringify(practiceEntriesFor(b,activePlatform)));if(!questions.length)return toast('本板块暂无可用问题');",
        "const b=boardById(selectedBoard),assigned=currentAssignment();\n if(activeAssignmentId&&(!assigned||!isAssigned(assigned,userName)||assigned.boardId!==selectedBoard||assigned.platform!==activePlatform))return toast('作业身份、品类或平台已变化，请返回首页重新进入作业');\n questions=assigned?.schema?questionsForAssignment(assigned):JSON.parse(JSON.stringify(practiceEntriesFor(b,activePlatform)));if(!questions.length)return toast('本板块暂无可用问题');",'assignment question pool')
    s=replace_once(s,"const q=questions[activeQuestionIndex],viewerAsk=viewerQuestionFor(q,b,activePlatform),danmu=",
        "const q=questions[activeQuestionIndex],viewerAsk=currentAssignment()?.schema?{text:q.question,variantId:'assignment-excel'}:viewerQuestionFor(q,b,activePlatform),danmu=",'exact source questions')
    s=replace_once(s,"const ids=questions.map(q=>q.id);if(ids.length<=1)return 0;",
        "const ids=questions.map(q=>q.id);if(currentAssignment()?.schema)return Math.min(sessionTurns.length,ids.length);if(ids.length<=1)return 0;",'Excel row order')
    s=replace_once(s,"const b=boardById(selectedBoard);if(!questions.length)return toast('没有可练问题，请重新开始一场');",
        "const b=boardById(selectedBoard);if(!questions.length)return toast('没有可练问题，请重新开始一场');\n if(currentAssignment()?.schema&&sessionTurns.length>=questions.length)return toast('本次作业的题目已全部完成，请结束练播并提交作业');",'stop after last assigned question')
    s=replace_once(s,"if(!practiceEntriesFor(boardById(selectedBoard),activePlatform).length)return toast('本板块尚无训练问题，无法开始');",
        "if(!(currentAssignment()?.schema?currentAssignment().questions:practiceEntriesFor(boardById(selectedBoard),activePlatform)).length)return toast('本板块尚无训练问题，无法开始');",'preparation checks exact assignment pool')
    # Review submission locked to assignment recipient / immutable source.
    s=replace_once(s,"if(snap.assignmentId){const assignment=assignmentById(snap.assignmentId);if(!assignment||assignment.boardId!==snap.boardId||assignment.platform!==snap.platform||!assignment.operatorName||snap.operatorName!==assignment.operatorName)return toast('作业信息不匹配，无法提交');operatorName=assignment.operatorName;}",
        "if(snap.assignmentId){const assignment=assignmentById(snap.assignmentId);if(!assignment||assignment.boardId!==snap.boardId||assignment.platform!==snap.platform||!assignment.operatorName||snap.operatorName!==assignment.operatorName||!isAssigned(assignment,snap.anchorName))return toast('作业信息不匹配，无法提交');operatorName=assignment.operatorName;}",'submission ownership')
    s=replace_once(s,"toast(`已提交给 ${operatorName}${late?'（逾期提交）':''}（音视频与记录仅保存在本机）`);",
        "toast(`本机提交已保存；请导出JSON回执发送给运营（本机记录不会自动跨设备送达）`);\n   if(lateAssignment?.schema)downloadJSON('TCL-主播作业提交回执-'+id+'.json',toReceipt(lateAssignment,snap));",'export a receipt after commit')
    # Include callbacks before operatorHome; keep browser parse guards tied to exact active view.
    marker='let assignmentPublishPending=false,assignmentJoinPending=false;'
    helpers=r'''let assignmentExcelParsing=false;
async function previewAssignmentExcel(){
 if(assignmentExcelParsing||userRole!=='operator'||page!=='home')return;
 const input=ELEM('assignmentExcelFile'),file=input?.files?.[0],panel=ELEM('assignmentExcelPreview');
 if(!file)return toast('请先选择Excel作业文件');
 if(file.size>15*1024*1024)return toast('作业Excel超过15MB，请拆分后导入');
 if(!/\.(xlsx|xls)$/i.test(file.name))return toast('作业只支持XLSX或XLS');
 const epoch=++assignmentExcelEpoch,owner=userName,boardId=ELEM('assignmentBoard').value,platform=ELEM('assignmentPlatform').value;
 assignmentExcelPreview=null;assignmentExcelParsing=true;panel.textContent='正在读取并检查Excel题目…';
 try{
  const parsed=await parseDocumentFile(file);if(userRole!=='operator'||userName!==owner||page!=='home'||epoch!==assignmentExcelEpoch||input.files?.[0]!==file)return;
  assertExcelOneRowPerQuestion(parsed);
  const extracted=extractQA(parsed);
  const questions=validateExcelQuestions(extracted,{category:boardById(boardId).category,platform});
  assignmentExcelPreview={epoch,file,boardId,platform,questions};
  panel.innerHTML='<p><b>已解析 '+questions.length+' 道专属作业题目（尚未发布）</b></p>'+questions.slice(0,100).map((q,i)=>'<p>'+ESC(String(i+1))+'. '+ESC(q.question)+' · 型号：'+ESC(q.model||'未填')+' · SKU：'+ESC(q.sku||'未填')+' · 参考答案：'+ESC(q.answer)+'</p>').join('');
 }catch(e){assignmentExcelPreview=null;panel.textContent='Excel解析失败：'+String(e?.message||e);}
 finally{assignmentExcelParsing=false;}
}
async function importAssignmentPackage(ev){
 const file=ev.currentTarget.files?.[0];if(!file)return;
 if(file.size>1*1024*1024){toast('作业包超过1MB，请联系运营拆分');return;}
 const who=userName,role=userRole;
 try{
  const envelope=JSON.parse(await file.text());const assignment=await verifyAssignment(envelope?.assignment);
  if(assignment.schema!==envelope.schema||!isAssigned(assignment,who))throw new Error('作业包不匹配当前主播姓名');
  if(userName!==who||userRole!==role||page!=='home')return;
  localAssignments=await updatePrefList('assignments',list=>{const existing=list.find(a=>a.id===assignment.id);if(existing&&existing.snapshotSha256!==assignment.snapshotSha256)throw new Error('同一作业ID的版本发生冲突，拒绝覆盖');return existing?list:[assignment,...list];});
  if(userName===who&&userRole===role){toast('作业包已导入本机，可搜索运营姓名自主领取');anchorHome();}
 }catch(e){toast('导入失败：'+String(e?.message||e));}
}
async function importAssignmentReceipt(ev){
 const file=ev.currentTarget.files?.[0];if(!file||userRole!=='operator')return;
 if(file.size>1*1024*1024)return toast('回执文件不能超过1MB');
 const owner=userName;
 try{
  const receipt=JSON.parse(await file.text()),assignment=assignmentById(receipt.assignmentId);
  if(!assignment||assignment.operatorName!==owner)throw new Error('未找到本人发布的对应作业');
  verifyReceipt(receipt,assignment);
  if(userName!==owner||userRole!=='operator'||page!=='home')return;
  const item={id:'imported-receipt:'+receipt.sessionId,sessionId:receipt.sessionId,assignmentId:receipt.assignmentId,operatorName:receipt.operatorName,anchorName:receipt.anchorName,submittedAt:receipt.submittedAt,turns:receipt.turns,manuallyImported:true,verification:'待人工核实（没有服务端身份认证）'};
  localSubmissions=await updatePrefList('submissions',list=>list.some(x=>x.id===item.id||x.sessionId===item.sessionId)?list:[item,...list]);
  if(userRole==='operator'&&userName===owner){toast('回执已导入本机，真实性仍需运营人工核对');operatorActiveTab='tracking';operatorHome();}
 }catch(e){toast('导入回执失败：'+String(e?.message||e));}
}
'''
    s=replace_once(s,marker,helpers+marker,'independent Excel callbacks')
    return harden_app(s)


def replace_region(source, start, end, replacement, label):
    """Replace one named, bounded function section; never guess a missing anchor."""
    if source.count(start) != 1 or source.count(end) != 1:
        raise ValueError(f'{label}: expected exactly one anchor for section bounds')
    first = source.index(start)
    last = source.index(end, first)
    return source[:first] + replacement.rstrip() + source[last:]


def harden_app(s):
    s=replace_once(s,'toReceipt,verifyReceipt} from',
        'toReceipt,verifyReceipt,verifyAssignmentSnapshot,assertExcelExtractionComplete} from','submission validator import')
    s=replace_once(s,"const STORE_NAME='tcl-specialty-r24-paraformer-v1';",
        "const STORE_NAME='tcl-specialty-r24-paraformer-excel-qa-v1';\nlet sessionAssignmentSnapshot=null;",'isolated database and channel')
    s=replace_once(s,"'tcl-r24-paraformer-asr-model-v1'", "'tcl-r24-paraformer-excel-qa-asr-model-v1'",'isolated model preference')
    s=replace_once(s,"'tcl-specialty-v352-asr-r24-qa-vosk-v1'", "'tcl-r24-paraformer-excel-qa-vosk-v1'",'isolated Vosk cache')
    s=replace_once(s,'function currentAssignment(){return assignmentById(activeAssignmentId);}',
        'function currentAssignment(){return runId&&sessionAssignmentSnapshot?.id===activeAssignmentId?sessionAssignmentSnapshot:assignmentById(activeAssignmentId);}', 'freeze active assignment lookup')
    s=replace_once(s,'function operatorHome(){\n',
        'function operatorHome(){\n invalidateAssignmentExcel();\n','invalidate preview on fresh operator view')
    s=replace_once(s,"['assignmentTitle','assignmentBoard','assignmentPlatform'].forEach(id=>ELEM(id).addEventListener('change',()=>{assignmentExcelEpoch++;assignmentExcelPreview=null;const dest=ELEM('assignmentExcelPreview');if(dest)dest.textContent='作业条件已变化，请重新预览Excel';}));\n ELEM('assignmentExcelFile').addEventListener('change',()=>{assignmentExcelEpoch++;assignmentExcelPreview=null;ELEM('assignmentExcelPreview').textContent='文件已更换，请重新解析预览';});",
        "['assignmentTitle','assignmentBoard','assignmentPlatform','assignmentDeadline'].forEach(id=>['input','change'].forEach(event=>ELEM(id).addEventListener(event,()=>invalidateAssignmentExcel('作业条件已变化，请重新预览Excel'))));\n ELEM('assignmentExcelFile').addEventListener('change',()=>invalidateAssignmentExcel('文件已更换，请重新解析预览'));",'invalidate on all form edits')
    s=replace_once(s,"const todo=localAssignments.filter(x=>isAssigned(x,userName)&&['已加入','已训练','已逾期'].includes(assignmentStatusFor(x,userName)));",
        "const todo=localAssignments.filter(x=>isAssigned(x,userName)&&(['已加入','已训练','已逾期'].includes(assignmentStatusFor(x,userName))||x.schema&&assignmentStatusFor(x,userName)==='未加入'));",'show assigned tasks before joining')

    preview=r'''let assignmentExcelParsing=0;
function invalidateAssignmentExcel(message=''){
 assignmentExcelEpoch++;assignmentExcelPreview=null;assignmentExcelParsing=0;
 const panel=ELEM('assignmentExcelPreview'),button=ELEM('assignmentExcelPreviewBtn');
 if(panel)panel.textContent=message;if(button)button.disabled=false;
}
function assignmentFormFingerprint(){
 return JSON.stringify(['assignmentTitle','assignmentBoard','assignmentPlatform','assignmentDeadline'].map(id=>ELEM(id)?.value??''));
}
function assignmentViewCurrent(ctx){
 return userRole===ctx.role&&userName===ctx.owner&&page==='home'&&ELEM('view')?.firstElementChild===ctx.view&&ELEM('assignmentExcelFile')===ctx.input&&ctx.input.isConnected&&ctx.input.files?.[0]===ctx.file&&assignmentExcelEpoch===ctx.epoch&&assignmentFormFingerprint()===ctx.fingerprint;
}
async function previewAssignmentExcel(){
 if(userRole!=='operator'||page!=='home')return;
 const input=ELEM('assignmentExcelFile'),file=input?.files?.[0],panel=ELEM('assignmentExcelPreview'),button=ELEM('assignmentExcelPreviewBtn');
 if(!input||!panel||!button||button.disabled)return;
 if(!file)return toast('请先选择Excel作业文件');
 if(file.size===0||file.size>15*1024*1024)return toast('作业Excel须为1字节至15MB，请检查或拆分后导入');
 if(!/\.(xlsx|xls)$/i.test(file.name))return toast('作业只支持XLSX或XLS');
 const ctx={epoch:++assignmentExcelEpoch,owner:userName,role:userRole,view:ELEM('view')?.firstElementChild,input,file,boardId:ELEM('assignmentBoard').value,platform:ELEM('assignmentPlatform').value,fingerprint:assignmentFormFingerprint()};
 assignmentExcelPreview=null;assignmentExcelParsing=ctx.epoch;button.disabled=true;panel.textContent='正在读取并检查Excel题目…';
 try{
  const parsed=await parseDocumentFile(file);if(!assignmentViewCurrent(ctx))return;
  const expectedCount=assertExcelOneRowPerQuestion(parsed),extracted=assertExcelExtractionComplete(expectedCount,extractQA(parsed));
  const questions=validateExcelQuestions(extracted,{category:boardById(ctx.boardId).category,platform:ctx.platform});
  if(!assignmentViewCurrent(ctx))return;
  assignmentExcelPreview={...ctx,questions};
  panel.innerHTML='<p><b>已解析 '+questions.length+' 道专属作业题目（尚未发布）</b></p>'+questions.map((q,i)=>'<p>'+ESC(String(i+1))+'. '+ESC(q.question)+' · 型号：'+ESC(q.model||'未填')+' · SKU：'+ESC(q.sku||'未填')+' · 参考答案：'+ESC(q.answer)+' · 评分要点：'+ESC(q.keyPoints.join('；')||'未填')+'</p>').join('');
 }catch(e){if(assignmentViewCurrent(ctx)){assignmentExcelPreview=null;panel.textContent='Excel解析失败：'+String(e?.message||e);}}
 finally{if(assignmentExcelParsing===ctx.epoch)assignmentExcelParsing=0;if(assignmentViewCurrent(ctx))button.disabled=false;}
}'''
    s=replace_region(s,'let assignmentExcelParsing=false;','\nasync function importAssignmentPackage',preview,'guard preview lifecycle')

    publish=r'''async function publishAssignment(){
 if(userRole!=='operator'||!userName||page!=='home')return;
 if(memoryFallback||!localDB)return toast('本机数据库不可用，无法可靠发布作业，请保留Excel后重试');
 if(assignmentPublishPending)return toast('作业正在保存，请稍候');
 const ownerName=userName,ownerView=ELEM('view')?.firstElementChild,button=ELEM('publishAssignment'),preview=assignmentExcelPreview;
 const activeView=()=>userRole==='operator'&&userName===ownerName&&page==='home'&&ELEM('view')?.firstElementChild===ownerView;
 const current=()=>activeView()&&preview===assignmentExcelPreview&&assignmentViewCurrent(preview);
 const title=ELEM('assignmentTitle')?.value.trim(),boardId=ELEM('assignmentBoard')?.value,platform=ELEM('assignmentPlatform')?.value,deadline=ELEM('assignmentDeadline')?.value||'';
 if(!title)return toast('请输入作业名称');
 if(!preview||!assignmentViewCurrent(preview))return toast('请先上传Excel并完成预览，确认题目无误后发布');
 const end=deadline?new Date(deadline):null;
 if(end&&!Number.isFinite(end.getTime()))return toast('截止时间无效，请重新选择');
 if(end&&end.getTime()<=Date.now())return toast('截止时间需要晚于现在');
 const questionCopy=structuredClone(preview.questions);
 assignmentPublishPending=true;if(button)button.disabled=true;
 try{
  const item=await makeAssignment({id:uid(),title,operatorName:ownerName,boardId,platform,deadline:end?end.toISOString():'',createdAt:nowIso(),assignedTo:[],questions:questionCopy});
  if(!current())throw new Error('发布人、文件或作业条件已变化，请重新预览后发布');
  const saved=await updatePrefList('assignments',list=>{if(!current())throw new Error('发布上下文已变化，作业未保存');return [item,...list.filter(x=>x.id!==item.id)];});
  if(!activeView())return;localAssignments=saved;
  toast('已发布全员可领取的本机作业；跨手机仍须先传递 JSON，尚无共享后台');operatorActiveTab='tracking';operatorHome();
 }catch(e){if(activeView())toast('作业未保存：'+(e?.message||e)+'。请重新核对后重试');}
 finally{assignmentPublishPending=false;if(button?.isConnected)button.disabled=false;}
}'''
    s=replace_region(s,'async function publishAssignment(){','\nasync function joinAssignment',publish,'guard publish transaction')

    exchange=r'''async function importAssignmentPackage(ev){
 const input=ev.currentTarget,file=input.files?.[0];if(!file||userRole!=='anchor')return;
 if(memoryFallback||!localDB)return toast('本机数据库不可用，无法可靠导入作业，请保留原文件后重试');
 if(file.size===0||file.size>1*1024*1024)return toast('作业包须为1字节至1MB，请联系运营检查或拆分');
 const who=userName,view=ELEM('view')?.firstElementChild;
 const current=()=>userName===who&&userRole==='anchor'&&page==='home'&&ELEM('view')?.firstElementChild===view&&ELEM('assignmentPackageImport')===input&&input.isConnected&&input.files?.[0]===file;
 try{
  const envelope=JSON.parse(await file.text());if(!current())return;
  const assignment=structuredClone(await verifyAssignment(envelope?.assignment,{board:boardById(envelope?.assignment?.boardId)}));if(!current())return;
  if(assignment.schema!==envelope.schema||!isAssigned(assignment,who))throw new Error('作业包不匹配当前主播姓名');
  const board=BOARDS.find(x=>x.id===assignment.boardId);
  if(!board||!board.platforms.includes(assignment.platform)||assignment.questions.some(q=>q.category!==board.category))throw new Error('作业板块、品类或平台不匹配');
  const saved=await updatePrefList('assignments',list=>{if(!current())throw new Error('导入页面或姓名已变化');const existing=list.find(a=>a.id===assignment.id);if(existing&&existing.snapshotSha256!==assignment.snapshotSha256)throw new Error('同一作业ID的版本发生冲突，拒绝覆盖');return existing?list:[assignment,...list];});
  if(current()){localAssignments=saved;toast('作业包已导入本机，可搜索运营姓名自主领取');anchorHome();}
 }catch(e){if(current())toast('导入失败：'+String(e?.message||e));}
}
function receiptKey(receipt){return JSON.stringify([receipt.assignmentId,receipt.sessionId,receipt.anchorName]);}
function receiptContent(receipt){
 return JSON.stringify([receipt.schema,receipt.assignmentId,receipt.snapshotSha256,receipt.assignmentVersion,receipt.boardId,receipt.platform,receipt.operatorName,receipt.anchorName,receipt.sessionId,receipt.submittedAt,receipt.turns.map(t=>[t.questionId,t.question,t.answer,t.transcript||'',t.model||'',t.sku||'',t.asrStatus||''])]);
}
async function importAssignmentReceipt(ev){
 const input=ev.currentTarget,file=input.files?.[0];if(!file||userRole!=='operator')return;
 if(memoryFallback||!localDB)return toast('本机数据库不可用，无法可靠保存回执，请保留原文件后重试');
 if(file.size===0||file.size>1*1024*1024)return toast('回执文件须为1字节至1MB');
 const owner=userName,view=ELEM('view')?.firstElementChild;
 const current=()=>userName===owner&&userRole==='operator'&&page==='home'&&ELEM('view')?.firstElementChild===view&&ELEM('assignmentReceiptImport')===input&&input.isConnected&&input.files?.[0]===file;
 try{
  const receipt=JSON.parse(await file.text());if(!current())return;
  const assignment=assignmentById(receipt.assignmentId);
  if(!assignment||assignment.operatorName!==owner)throw new Error('未找到本人发布的对应作业');
  await verifyAssignment(assignment,{board:boardById(assignment.boardId)});if(!current())return;verifyReceipt(receipt,assignment);
  const key=receiptKey(receipt),content=receiptContent(receipt),byId=new Map(assignment.questions.map(q=>[q.id,q]));
  const item={id:'imported-receipt:'+encodeURIComponent(key),sessionId:receipt.sessionId,assignmentId:receipt.assignmentId,operatorName:receipt.operatorName,anchorName:receipt.anchorName,boardId:assignment.boardId,category:boardById(assignment.boardId).category,platform:assignment.platform,submittedAt:receipt.submittedAt,turns:receipt.turns.map(t=>{const q=byId.get(t.questionId);return {...t,prompt:t.question,referenceAnswer:q.answer,keyPoints:[...q.keyPoints],kind:q.kind,source:q.source,sourceRef:q.sourceRef,sourceLocators:[...q.sourceLocators]};}),assignmentSnapshotSha256:assignment.snapshotSha256,assignmentVersion:assignment.version,assignmentReceipt:receipt,manuallyImported:true,verification:'待人工核实（没有服务端身份认证）'};
  const saved=await updatePrefList('submissions',list=>{if(!current())throw new Error('导入页面或运营姓名已变化');const existing=list.find(x=>receiptKey(x)===key);if(existing){if(!existing.assignmentReceipt||receiptContent(existing.assignmentReceipt)!==content)throw new Error('同一场次回执内容冲突，未覆盖原记录');return list;}return [item,...list];});
  if(current()){localSubmissions=saved;toast('回执已导入本机，真实性仍需运营人工核对');operatorActiveTab='tracking';operatorHome();}
 }catch(e){if(current())toast('导入回执失败：'+String(e?.message||e));}
}'''
    s=replace_region(s,'async function importAssignmentPackage(ev){','\nlet assignmentPublishPending',exchange,'guard exchange ownership and deduplication')

    # Freeze the assignment at start, persist it with checkpoints, and use it
    # throughout this run even if another tab receives a different task.
    s=replace_once(s,"questions=assigned?.schema?questionsForAssignment(assigned):JSON.parse(JSON.stringify(practiceEntriesFor(b,activePlatform)));if(!questions.length)return toast('本板块暂无可用问题');",
        "const sourceAssignment=assigned?.schema?structuredClone(assigned):null,startingOwner=userName,startingAssignmentId=activeAssignmentId;\n questions=sourceAssignment?questionsForAssignment(sourceAssignment):JSON.parse(JSON.stringify(practiceEntriesFor(b,activePlatform)));if(!questions.length)return toast('本板块暂无可用问题');",'capture source assignment')
    s=replace_once(s,'let acquired=null;\n try{\n  clearVideoStopWatchdog();',
        "let acquired=null;\n try{\n  if(sourceAssignment)await verifyAssignment(sourceAssignment,{board:b});\n  if(seq!==captureSeq||roomPhase!=='ready'||userRole!=='anchor'||userName!==startingOwner||activeAssignmentId!==startingAssignmentId)return;\n  clearVideoStopWatchdog();",'verify source before media start')
    s=replace_once(s,"resetRunState({cancelPreload:false});runId=uid();", "resetRunState({cancelPreload:false});sessionAssignmentSnapshot=sourceAssignment;runId=uid();",'install frozen run source')
    s=replace_once(s,"function resetRunState({cancelPreload=true}={}){\n", "function resetRunState({cancelPreload=true}={}){\n sessionAssignmentSnapshot=null;\n",'reset frozen run source')
    fields="...(sessionAssignmentSnapshot?.schema?{assignmentSnapshotSha256:sessionAssignmentSnapshot.snapshotSha256,assignmentVersion:sessionAssignmentSnapshot.version,assignmentSnapshot:structuredClone(sessionAssignmentSnapshot)}:{}),"
    s=replace_once(s,"assignmentTitle:a?.title||'',startedAt:","assignmentTitle:a?.title||'',"+fields+"startedAt:",'checkpoint frozen version')
    s=replace_once(s,"assignmentTitle:assignment?.title||'',startedAt:","assignmentTitle:assignment?.title||'',"+fields+"startedAt:",'finished frozen version')
    s=replace_once(s,"const snap=JSON.parse(JSON.stringify(data.snapshot));\n  runId=snap.id;",
        "const snap=JSON.parse(JSON.stringify(data.snapshot));\n  const frozen=snap.assignmentSnapshot?structuredClone(await verifyAssignment(snap.assignmentSnapshot,{board:boardById(snap.boardId)})):null;\n  if(frozen&&(frozen.id!==snap.assignmentId||frozen.snapshotSha256!==snap.assignmentSnapshotSha256||frozen.version!==snap.assignmentVersion||frozen.boardId!==snap.boardId||frozen.platform!==snap.platform||frozen.operatorName!==snap.operatorName||!isAssigned(frozen,owner)))throw new Error('恢复记录的作业版本或归属不一致');\n  if(epoch!==restoreSessionEpoch||userRole!=='anchor'||userName!==owner||page!=='home'||runId!==initialRun||ELEM('view')?.firstElementChild!==initialView)return;\n  sessionAssignmentSnapshot=frozen;\n  runId=snap.id;",'restore immutable assignment')
    s=replace_once(s,"  resetRunState();discardVideoArchive();\n  checkpointCursor={key:draftKey(owner),token:checkpointToken(data),known:true,ready:Promise.resolve()};savedSessionCandidate=data;\n  const snap=JSON.parse(JSON.stringify(data.snapshot));",
        "  const snap=JSON.parse(JSON.stringify(data.snapshot));",'validate restoration before releasing current state')
    s=replace_once(s,"  sessionAssignmentSnapshot=frozen;\n  runId=snap.id;",
        "  resetRunState();discardVideoArchive();\n  checkpointCursor={key:draftKey(owner),token:checkpointToken(data),known:true,ready:Promise.resolve()};savedSessionCandidate=data;\n  sessionAssignmentSnapshot=frozen;\n  runId=snap.id;",'apply restored state after async ownership check')
    s=replace_once(s,"if(currentAssignment()?.schema&&sessionTurns.length>=questions.length)return toast('本次作业的题目已全部完成，请结束练播并提交作业');\n saveCurrentTypedAnswer();",
        "saveCurrentTypedAnswer();\n if(currentAssignment()?.schema&&sessionTurns.length>=questions.length)return toast('本次作业的题目已全部展示，请结束练播并核对每题回答后提交');",'save final answer before stopping at last question')

    # The official onstop handler mounts a preview immediately before a question
    # transition. Removing that player alone does not cancel its deferred media
    # load. Stop the known preview, remove its source, and reset the load before
    # revoking the URL; leave perQuestionAudio and the recorded Blob untouched.
    old_audio_cleanup="if(answerAudioURL){URL.revokeObjectURL(answerAudioURL);answerAudioURL=''}"
    if s.count(old_audio_cleanup)!=3:
        raise ValueError('answer preview cleanup: expected exactly three anchors; refusing unknown R24 source')
    s=s.replace(old_audio_cleanup,'clearAnswerAudio();')
    s=replace_once(s,"clearAnswerAudio();\n ELEM('audioHolder').replaceChildren();recordUI('尚未录制本题回答');",
        "clearAnswerAudio();\n recordUI('尚未录制本题回答');",'cancel preview load before question transition')
    s=replace_once(s,'if(answerAudioURL)URL.revokeObjectURL(answerAudioURL);\n   answerAudioURL=URL.createObjectURL(blob);',
        'clearAnswerAudio();\n   answerAudioURL=URL.createObjectURL(blob);','cancel preview load before a replacement recording')
    s=replace_once(s,'function nextQuestion(){',r'''function clearAnswerAudio(){
 const holder=ELEM('audioHolder');
 if(holder){for(const audio of holder.querySelectorAll('audio')){try{audio.pause()}catch{}try{audio.removeAttribute('src');audio.load()}catch{}}holder.replaceChildren();}
 if(answerAudioURL){URL.revokeObjectURL(answerAudioURL);answerAudioURL=''}
}
function nextQuestion(){''','stop preview resource selection before revocation')

    # A receipt is prepared only after every exact frozen question has an answer.
    # Keep the original atomic checkpoint + media transaction and add a current
    # owner/answer check inside its write callback.
    s=replace_once(s,'function commitSubmission(submission,logId,media,expectedToken){','function commitSubmission(submission,logId,media,expectedToken,stillCurrent=()=>true){','submission transaction current callback')
    s=replace_once(s,'const checkpoint=checkpointReq.result;','if(!stillCurrent())throw new Error(\'提交页面、姓名或回答已变化，未提交\');\n   const checkpoint=checkpointReq.result;','atomic submission view guard')
    s=replace_once(s,"if(oldSubs.some(x=>x.sessionId===submission.sessionId))", "if(oldSubs.some(x=>x.sessionId===submission.sessionId&&x.assignmentId===submission.assignmentId&&x.anchorName===submission.anchorName))",'composite committed submission identity')
    s=replace_once(s,"localSubmissions.find(x=>x.sessionId===lastSessionSnapshot.id)","localSubmissions.find(x=>x.sessionId===lastSessionSnapshot.id&&x.assignmentId===lastSessionSnapshot.assignmentId&&x.anchorName===lastSessionSnapshot.anchorName)",'composite review submission identity')
    s=replace_once(s,"localSubmissions.some(x=>x.sessionId===snap.id)","localSubmissions.some(x=>x.sessionId===snap.id&&x.assignmentId===snap.assignmentId&&x.anchorName===snap.anchorName)",'composite preflight submission identity')
    s=replace_once(s,"submissionSaving=true;const btn=ELEM('submitSession');if(btn)btn.disabled=true;\n try{\n  if(!await persistSessionCheckpoint())",
        "submissionSaving=true;const btn=ELEM('submitSession');if(btn)btn.disabled=true;\n const snapshotFingerprint=JSON.stringify(snap),current=()=>userRole==='anchor'&&userName===snap.anchorName&&runId===snap.id&&lastSessionSnapshot===snap&&JSON.stringify(snap)===snapshotFingerprint;\n try{\n  if(lateAssignment?.schema){await verifyAssignmentSnapshot(lateAssignment,snap,{board:boardById(lateAssignment.boardId)});if(!current())throw new Error('本场回答或身份已变化，请重新核对后提交');submission.assignmentSnapshotSha256=snap.assignmentSnapshotSha256;submission.assignmentVersion=snap.assignmentVersion;submission.assignmentReceipt=toReceipt(lateAssignment,snap);}\n  if(!await persistSessionCheckpoint())",'validate complete submission before persistence')
    s=replace_once(s,'commitSubmission(submission,lastTrainingLogId,media,checkpointCursor.token)', 'commitSubmission(submission,lastTrainingLogId,media,checkpointCursor.token,current)','pass transaction guard')
    s=replace_once(s,"if(lateAssignment?.schema)downloadJSON('TCL-主播作业提交回执-'+id+'.json',toReceipt(lateAssignment,snap));",
        "if(submission.assignmentReceipt)downloadJSON('TCL-主播作业提交回执-'+id+'.json',submission.assignmentReceipt);",'export committed receipt')
    # A failed/cancelled browser download is recoverable after refresh.
    s=replace_once(s,"<p class=\"scene-tip submit-local-note\">", "${submitted?.assignmentReceipt?'<button type=\"button\" id=\"exportAssignmentReceipt\" class=\"btn soft wide\">导出作业回执（JSON）</button>':''}<p class=\"scene-tip submit-local-note\">",'persistent receipt export control')
    s=replace_once(s,"ELEM('reviewRetry').onclick=", "if(ELEM('exportAssignmentReceipt'))ELEM('exportAssignmentReceipt').onclick=()=>{const record=reviewSubmission();if(record?.assignmentReceipt)downloadJSON('TCL-主播作业提交回执-'+record.id+'.json',record.assignmentReceipt);};\n ELEM('reviewRetry').onclick=",'bind persistent receipt export')
    return s


# Support standard XLSX worksheet XML with either prefixed (x:row / x:c / x:v)
# or non-prefixed tags. Some spreadsheet exporters emit x: namespace tags.
def patch_xlsx_parser(source:str)->str:
    pairs=[
        (r'const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;',r'const siRegex = /<(?:[\w.-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?si>/g;'),
        (r'const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g;',r'const tRegex = /<(?:[\w.-]+:)?t(?:\s+[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?t>/g;'),
        (r'const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;',r'const rowRegex = /<(?:[\w.-]+:)?row\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?row>/g;'),
        (r'const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;',r'const cellRegex = /<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c>)/g;'),
        (r'const vMatch = cBody.match(/<v[^>]*>([\s\S]*?)<\/v>/);',r'const vMatch = cBody.match(/<(?:[\w.-]+:)?v[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?v>/);'),
        (r'const tMatches = Array.from(cBody.matchAll(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g));',r'const tMatches = Array.from(cBody.matchAll(/<(?:[\w.-]+:)?t(?:\s+[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?t>/g));'),
    ]
    for old,new in pairs:source=replace_once(source,old,new,'XLSX prefix-safe parsing')
    return source

def build(source_dir:Path,output_dir:Path):
    source_dir=Path(source_dir);output_dir=Path(output_dir)
    if (source_dir/'app.js').is_file():
        site=source_dir
    else:
        found=list(source_dir.glob('*/app.js'))
        if len(found)!=1:raise ValueError('Expected one R24 source directory with app.js')
        site=found[0].parent
    out=output_dir/site.name
    if out.exists():shutil.rmtree(out)
    shutil.copytree(site,out)
    original=(out/'app.js').read_text('utf-8')
    target=patch_app(original)
    (out/'app.js').write_text(target,'utf-8')
    shutil.copyfile(MODULE,out/'assignment-excel.mjs')
    parser_path=out/'lib/parser.js'
    parser_path.write_text(patch_xlsx_parser(parser_path.read_text('utf-8')),encoding='utf-8')
    qa_path=out/'lib/qa-import.js'
    qa=qa_path.read_text('utf-8')
    qa=replace_once(qa,"export const Q_KEYS=['question','问题'", "export const Q_KEYS=['question','题目','作业题目','问题'",'recognize Excel 题目 header')
    qa_path.write_text(qa,encoding='utf-8')
    for name,(before,after) in ISOLATED_MODULE_KEYS.items():
        path=out/name
        path.write_text(replace_once(path.read_text('utf-8'),before,after,'isolated namespace '+name),encoding='utf-8')
    # Rebuild exact SHA manifest for the patched R24 copy, preserving the bytes
    # of all other static resources and never modifying a previous site in place.
    manifest=out/'static-manifest.json'
    if manifest.is_file():
        obj=json.loads(manifest.read_text('utf-8'))
        if not isinstance(obj.get('files'),dict):raise ValueError('Unexpected static resource manifest format')
        obj['version']=VERSION
        obj['files']['app.js']=hashlib.sha256((out/'app.js').read_bytes()).hexdigest()
        obj['files']['assignment-excel.mjs']=hashlib.sha256((out/'assignment-excel.mjs').read_bytes()).hexdigest()
        for other in ('lib/parser.js','lib/qa-import.js',*ISOLATED_MODULE_KEYS):
            obj['files'][other]=hashlib.sha256((out/other).read_bytes()).hexdigest()
        manifest.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n','utf-8')
        for relative,digest in obj['files'].items():
            target_file=out/relative
            if not target_file.is_file():
                # Paraformer model files are delivered by the separate trusted
                # official model staging step, not the small frontend ZIP.
                if relative in EXTERNAL_MODEL_FILES and digest==EXTERNAL_MODEL_FILES[relative]:continue
                raise ValueError('Unexpected missing static resource: '+relative)
            actual=hashlib.sha256(target_file.read_bytes()).hexdigest()
            if actual!=digest:raise ValueError('Static asset mismatch: '+relative)
    # Existing UI layout, CSS and original HTML bytes unchanged.
    for x in ('index.html','style.css','training-boards.json','legacy-65.json'):
        assert (site/x).read_bytes()==(out/x).read_bytes(),x
    result={'source_app_sha256':hashlib.sha256(original.encode()).hexdigest(),
            'patched_app_sha256':hashlib.sha256(target.encode()).hexdigest(),
            'unchanged_html_sha256':hashlib.sha256((out/'index.html').read_bytes()).hexdigest(),
            'unchanged_style_sha256':hashlib.sha256((out/'style.css').read_bytes()).hexdigest(),
            'added_module_sha256':hashlib.sha256((out/'assignment-excel.mjs').read_bytes()).hexdigest(),
            'source_directory':site.name,'browser_ui_changed':'Only Excel/public-claim/transfer controls inside existing cards; CSS/HTML unchanged'}
    (output_dir/'PATCH_EVIDENCE.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('output');opts=p.parse_args()
    build(Path(opts.source),Path(opts.output))
