#!/usr/bin/env python3
"""Real Chromium + synthetic Office/CSV/JSON import data checks; no business documents."""
import functools, hashlib, io, json, os, pathlib, threading, zipfile
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
from docx import Document

REPO=pathlib.Path(__file__).resolve().parents[3]
SITE=REPO/'experiments/r24/tcl-v352-asr-r24-qa'
OUT=pathlib.Path(os.environ.get('R24_DATA_OUTPUT',str(REPO/'evidence/r24-data-audit')))
OUT.mkdir(parents=True,exist_ok=True)
FILES=['lib/parser.js','lib/qa-import.js']
def hashes():return {name:hashlib.sha256((SITE/name).read_bytes()).hexdigest() for name in FILES}
def archive(files):
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for name,value in files:z.writestr(name,value)
 return out.getvalue()
def sheet(q,a):
 return f'<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>问题</t></is></c><c r="B1" t="inlineStr"><is><t>优秀回答</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>{q}</t></is></c><c r="B2" t="inlineStr"><is><t>{a}</t></is></c></row></sheetData></worksheet>'
WORKBOOK='<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="电视" sheetId="2" r:id="rId2"/><sheet name="冰箱" sheetId="1" r:id="rId1"/></sheets></workbook>'
RELS='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'
def book(rels=RELS,second='xl/worksheets/sheet2.xml'):
 return archive([('xl/workbook.xml',WORKBOOK),('xl/_rels/workbook.xml.rels',rels),('xl/worksheets/sheet1.xml',sheet('冰箱怎么清洁？','冰箱样本回答')),(second,sheet('电视怎么清洁？','电视样本回答'))])
doc=Document();table=doc.add_table(rows=2,cols=3);table.cell(0,0).merge(table.cell(0,1)).text='问题';table.cell(0,2).text='优秀回答';table.cell(1,0).text='电视接口如何确认？';table.cell(1,1).text='这是备注，不是回答';table.cell(1,2).text='请查看该型号官方接口参数';docbuf=io.BytesIO();doc.save(docbuf)

def payload(value):return json.dumps(value,ensure_ascii=False).encode()
fixtures=[
 ('model-plus.csv','弹幕内容,案例话术1\nHDR10怎么设置？,HDR10样本回答\nHDR10+怎么设置？,HDR10+样本回答\n'.encode(),{'questions':['HDR10怎么设置？','HDR10+怎么设置？']}),
 ('model-dot.csv','弹幕内容,案例话术1\nHDMI2.1如何识别？,接口版本2.1\nHDMI21如何识别？,合成型号21\n'.encode(),{'count':2}),
 ('equivalent-width.csv','弹幕内容,案例话术1\nＨＤＲ１０怎么设置？,第一种话术\nHDR10怎么设置?,第二种话术\n'.encode(),{'count':1,'answer_contains':['第一种话术','第二种话术']}),
 ('merged-columns.docx',docbuf.getvalue(),{'answers':['请查看该型号官方接口参数'],'header':['问题','','优秀回答']}),
 ('sheet-order.xlsx',book(),{'sheet_names':['电视','冰箱'],'questions':['电视怎么清洁？','冰箱怎么清洁？']}),
 ('sheet-custom-name.xlsx',book(RELS.replace('worksheets/sheet2.xml','/xl/worksheets/television.xml'),'xl/worksheets/television.xml'),{'sheet_names':['电视','冰箱'],'questions':['电视怎么清洁？','冰箱怎么清洁？']}),
 ('missing-sheet.xlsx',book(RELS.replace('worksheets/sheet2.xml','worksheets/missing.xml')),{'error':'工作表文件缺失'}),
 ('external-sheet.xlsx',book(RELS.replace('Target="worksheets/sheet2.xml"','Target="https://example.invalid/sheet.xml" TargetMode="External"')),{'error':'外部文件'}),
 ('json-array.json',payload([{'question':'接口怎样确认？','answer':'查看官方参数','keypoints':['型号','接口']}]),{'answers':['查看官方参数']}),
 ('json-zero-false.json',payload({'items':[{'question':'合成数值是多少？','answer':0},{'question':'合成开关的值是什么？','answer':False}]}),{'answers':['0','false']}),
 ('json-scalar-question.json',payload({'questions':[{'question':0,'answer':'合成数字问题'},{'question':False,'answer':'合成标记问题'}]}),{'questions':['0','false']}),
 ('json-object.json',payload({'items':[{'question':{'text':'接口怎样确认？'},'answer':'文字回答'}]}),{'error':'问题须为'}),
 ('json-answer-array.json',payload([{'question':'接口怎样确认？','answer':['第一条','第二条']}]),{'error':'回答须为'}),
 ('json-point-object.json',payload([{'question':'接口怎样确认？','answer':'文字回答','keypoints':[{'point':'型号'}]}]),{'error':'要点须为'}),
 ('json-null-row.json',payload([None]),{'error':'第1条须为'}),
 ('json-missing-question.json',payload([{'answer':'文字回答'}]),{'error':'缺少有效问题'}),
 ('long-answer.csv',('问题,优秀回答\n接口如何确认？,'+'答'*2994+'末尾约束必须保留\n').encode(),{'error':'回答超过3000字'}),
 ('long-question.json',payload([{'question':'问'*501,'answer':'文字回答'}]),{'error':'问题超过500字'}),
 ('many-points.json',payload([{'question':'接口怎样确认？','answer':'文字回答','keypoints':[f'要点{i}' for i in range(13)]}]),{'error':'要点超过12条'}),
 ('merged-long.csv',('弹幕内容,案例话术1\n接口如何确认？,'+'答'*1600+'\n接口如何确认？,'+'答'*1600+'\n').encode(),{'error':'合并后的回答超过3000字'}),
 ('long-intent.csv',('弹幕内容,消费者意图分析,案例话术1\n接口如何确认？,'+'意'*501+',查看官方参数\n').encode(),{'error':'消费者意图超过500字'}),
 ('long-type.csv',('弹幕类型,弹幕内容,案例话术1\n'+'类'*21+',接口如何确认？,查看官方参数\n').encode(),{'error':'弹幕类型超过20字'}),
 ('whitespace-bom.csv','\ufeff 问题 , 优秀回答 \r\n接口如何确认？,"以型号官方参数为准\n并核对自己的设备"\r\n'.encode(),{'answers':['以型号官方参数为准\n并核对自己的设备']}),
 ('parser-501.csv',('问题,优秀回答\n'+''.join(f'合成问题第{i}项是什么？,合成回答第{i}项\n' for i in range(501))).encode(),{'count':501}),
]
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(SITE.parent)));threading.Thread(target=server.serve_forever,daemon=True).start()
report={'mode':'Actual desktop Chromium; synthetic CSV/JSON and Office documents; no Gemini/private business data','source_hashes':hashes(),'cases':[]}
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);page=browser.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/{SITE.name}/')
  for name,data,expect in fixtures:
   actual=page.evaluate('''async({name,data})=>{const {parseDocumentFile}=await import('./lib/parser.js');const {extractQA,detectReviewConflicts}=await import('./lib/qa-import.js');try{const parsed=await parseDocumentFile(new File([new Uint8Array(data)],name));const qa=extractQA(parsed);detectReviewConflicts(qa);return {qa,blocks:parsed.blocks};}catch(e){return {error:String(e.message)}}}''',{'name':name,'data':list(data)})
   if 'error' in expect:assert expect['error'] in actual.get('error',''),(name,actual)
   else:
    assert 'error' not in actual,(name,actual)
    qa=actual['qa']
    if 'count' in expect:assert len(qa)==expect['count'],(name,len(qa))
    if 'questions' in expect:assert [x['question'] for x in qa]==expect['questions'],(name,qa)
    if 'answers' in expect:assert [x['answer'] for x in qa]==expect['answers'],(name,qa)
    if 'answer_contains' in expect:assert all(x in qa[0]['answer'] for x in expect['answer_contains']),(name,qa)
    if 'header' in expect:assert actual['blocks'][0]['rows'][0]['cells']==expect['header'],(name,actual['blocks'])
    if 'sheet_names' in expect:
     assert [x['sheetName'] for x in actual['blocks']]==expect['sheet_names'],(name,actual['blocks'])
     assert all(f'「{title}」' in row['locator'] for title,row in zip(expect['sheet_names'],qa)),(name,qa)
   report['cases'].append({'file':name,'input_sha256':hashlib.sha256(data).hexdigest(),'expected':expect,'result':'PASS','error':actual.get('error'),'rows':len(actual.get('qa',[]))})
  # Duplicate detector must retain semantic symbols in preexisting library records too.
  distinct=page.evaluate('''async()=>{const {detectReviewConflicts}=await import('./lib/qa-import.js');const rows=[{question:'HDR10+怎么设置？',answer:'样本回答',reviewStatus:'needs_review'}];detectReviewConflicts(rows,{existing:[{question:'HDR10怎么设置？',answer:'另一个答案',boardId:'01',platform:'京东'}],boardId:'01',platform:'京东'});return rows[0].reviewStatus}''')
  assert distinct=='needs_review',distinct;report['existing_model_variant']='PASS'
  report.update(status='PASS',browser=browser.version);browser.close()
finally:
 server.shutdown();report['source_hashes_after']=hashes();report['source_unchanged']=report['source_hashes']==report['source_hashes_after'];
 if not report['source_unchanged']:report['status']='FAIL'
 (OUT/'import-mappings-after.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({'status':report.get('status'),'cases':len(report['cases']),'source_unchanged':report['source_unchanged'],'source_hashes':report['source_hashes']},ensure_ascii=False,indent=2))
assert report.get('status')=='PASS'
