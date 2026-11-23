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


def replace_once(s, old, new, name):
    count=s.count(old)
    if count!=1:
        raise ValueError(f'{name}: expected exactly one anchor; found {count}. Refusing to patch unknown R24 source.')
    return s.replace(old,new,1)


def patch_app(src:str)->str:
    s=src
    s=replace_once(s,"import { extractQA, detectReviewConflicts } from './lib/qa-import.js';",
        "import { extractQA, detectReviewConflicts } from './lib/qa-import.js';\nimport {validateExcelQuestions,assertExcelOneRowPerQuestion,parseRecipients,makeAssignment,isAssigned,questionsForAssignment,toExchangePackage,verifyAssignment,toReceipt,verifyReceipt} from './assignment-excel.mjs';",'ASR/qa imports')
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
        '<div class="field"><label for="assignmentRecipients">4. 接收作业的主播姓名（可用逗号分隔）</label><input id="assignmentRecipients" placeholder="例如：张三，李四"></div><div class="field"><label for="assignmentExcelFile">5. 上传本次作业 Excel</label><input type="file" id="assignmentExcelFile" accept=".xlsx,.xls"/><small>一行一题：问题、参考答案、型号、SKU、评分点。只用于本次作业，不进入公共题库。</small></div><button type="button" class="btn soft" id="assignmentExcelPreviewBtn">解析并预览作业题目</button><div id="assignmentExcelPreview" role="status" aria-live="polite"></div><button id="publishAssignment" class="btn primary wide hub-publish">','operator upload UI')
    s=replace_once(s,"ELEM('publishAssignment').onclick=async()=>{await publishAssignment();};",
        "ELEM('publishAssignment').onclick=async()=>{await publishAssignment();};\n ELEM('assignmentExcelPreviewBtn').onclick=previewAssignmentExcel;\n ['assignmentTitle','assignmentBoard','assignmentPlatform','assignmentRecipients'].forEach(id=>ELEM(id).addEventListener('change',()=>{assignmentExcelEpoch++;assignmentExcelPreview=null;const dest=ELEM('assignmentExcelPreview');if(dest)dest.textContent='作业条件已变化，请重新预览Excel';}));\n ELEM('assignmentExcelFile').addEventListener('change',()=>{assignmentExcelEpoch++;assignmentExcelPreview=null;ELEM('assignmentExcelPreview').textContent='文件已更换，请重新解析预览';});\n document.querySelectorAll('[data-export-assignment]').forEach(btn=>btn.onclick=()=>{const a=assignmentById(btn.dataset.exportAssignment);if(a?.schema)downloadJSON('TCL-运营作业-'+a.id+'.json',toExchangePackage(a));});\n if(ELEM('assignmentReceiptImport'))ELEM('assignmentReceiptImport').onchange=importAssignmentReceipt;",'operator controls')
    s=replace_once(s,'<div class="assignment-results">${own.map(a=>',
        '<div class="field"><label for="assignmentReceiptImport">接收主播提交回执（JSON；需人工确认真实性）</label><input id="assignmentReceiptImport" type="file" accept=".json,application/json"></div><div class="assignment-results">${own.map(a=>','operator receipt input')
    s=replace_once(s,'<div class="assignment-statuses">${anchors.map',
        '<div>${a.schema?`<small>Excel作业 · ${a.questions.length}题 · 固定版本 v${a.version}</small><button type="button" class="btn soft small" data-export-assignment="${ESC(a.id)}">导出作业包给主播</button>`:""}</div><div class="assignment-statuses">${anchors.map','operator export button')
    # Existing operator tracking must include named recipients even before join.
    s=replace_once(s,
        "const anchors=[...new Set(localAssignmentJoins.filter(j=>j.assignmentId===a.id).map(j=>j.anchorName))];",
        "const anchors=[...new Set([...(a.assignedTo||[]),...localAssignmentJoins.filter(j=>j.assignmentId===a.id).map(j=>j.anchorName)])];",'assignment recipient status')
    s=replace_once(s,'if(!title)return toast(\'请输入作业名称\');',
        "if(!title)return toast('请输入作业名称');\n const recipients=parseRecipients(ELEM('assignmentRecipients')?.value||'');\n if(!recipients.length)return toast('请填写接收作业的主播姓名');\n if(!assignmentExcelPreview||assignmentExcelPreview.epoch!==assignmentExcelEpoch||assignmentExcelPreview.boardId!==boardId||assignmentExcelPreview.platform!==platform||assignmentExcelPreview.file!==ELEM('assignmentExcelFile')?.files?.[0])return toast('请先上传Excel并完成预览，确认题目无误后发布');",'publish preflight')
    s=replace_once(s,"const item={id:uid(),title,operatorName:ownerName,boardId,platform,deadline:end?end.toISOString():'',createdAt:nowIso()};",
        "",'remove premature legacy assignment initializer')
    s=replace_once(s,"assignmentPublishPending=true;if(button)button.disabled=true;\n try{",
        "assignmentPublishPending=true;if(button)button.disabled=true;\n try{\n  const item=await makeAssignment({id:uid(),title,operatorName:ownerName,boardId,platform,deadline:end?end.toISOString():'',createdAt:nowIso(),assignedTo:recipients,questions:assignmentExcelPreview.questions});",'make immutable assignment inside catchable transaction')
    s=replace_once(s,"toast('作业已发布（本机测试数据）');operatorActiveTab='tracking';operatorHome();",
        "toast('作业已保存到本机；请导出作业包手动发送给主播（不会自动跨设备同步）');operatorActiveTab='tracking';operatorHome();",'publication truthfulness')
    s=replace_once(s,"if(sub)return sub.late?'逾期提交':'已提交';",
        "if(sub)return sub.manuallyImported?'回执待核实':sub.late?'逾期提交':'已提交';",'operator manual receipt status')
    s=replace_once(s,"const a=assignmentById(id);if(!a)return toast('作业不存在');",
        "const a=assignmentById(id);if(!a)return toast('作业不存在');\n if(!isAssigned(a,userName))return toast('当前姓名不在此作业接收名单中（姓名不是身份认证）');",'recipient visibility join')
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
  if(userName===who&&userRole===role){toast('作业包已导入本机，请在待完成作业中进入');anchorHome();}
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
    # Rebuild exact SHA manifest for the patched R24 copy, preserving the bytes
    # of all other static resources and never modifying a previous site in place.
    manifest=out/'static-manifest.json'
    if manifest.is_file():
        obj=json.loads(manifest.read_text('utf-8'))
        if not isinstance(obj.get('files'),dict):raise ValueError('Unexpected static resource manifest format')
        obj['version']=str(obj.get('version','r24'))+'-excel-assignment-candidate'
        obj['files']['app.js']=hashlib.sha256((out/'app.js').read_bytes()).hexdigest()
        obj['files']['assignment-excel.mjs']=hashlib.sha256((out/'assignment-excel.mjs').read_bytes()).hexdigest()
        for other in ('lib/parser.js','lib/qa-import.js'):
            obj['files'][other]=hashlib.sha256((out/other).read_bytes()).hexdigest()
        manifest.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n','utf-8')
        for relative,digest in obj['files'].items():
            target_file=out/relative
            if not target_file.is_file():
                # Paraformer model files are delivered by the separate trusted
                # official model staging step, not the small frontend ZIP.
                if relative.startswith(('models/','model/')):continue
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
            'source_directory':site.name,'browser_ui_changed':'Only new Excel/recipient/transfer controls inside existing cards; CSS/HTML unchanged'}
    (output_dir/'PATCH_EVIDENCE.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('output');opts=p.parse_args()
    build(Path(opts.source),Path(opts.output))