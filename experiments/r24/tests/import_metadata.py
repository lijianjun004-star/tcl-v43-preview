#!/usr/bin/env python3
"""Real Chromium parser with synthetic metadata fixtures; no private product facts."""
import csv,functools,hashlib,io,json,os,pathlib,threading
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
from openpyxl import Workbook
from docx import Document
REPO=pathlib.Path(__file__).resolve().parents[3];SITE=REPO/'experiments/r24/tcl-v352-asr-r24-qa'
OUT=pathlib.Path(os.environ.get('R24_METADATA_OUTPUT',str(REPO/'evidence/r24-question-bank/import')));OUT.mkdir(parents=True,exist_ok=True)
MODULE=SITE/'lib/qa-import.js';module_sha=hashlib.sha256(MODULE.read_bytes()).hexdigest()
HEADERS=['产品型号','SKU','品类','平台','来源','弹幕内容','消费者意图分析','案例话术1']
ROWS=[['T7M Pro','SKU-A','TCL 电视','京东','合成参数表A','这款支持什么接口？','确认兼容性','T7M Pro合成参考回答A'],['T8M','SKU-B','TCL 电视','天猫','合成参数表B','这款支持什么接口？','确认兼容性','T8M合成参考回答B']]
s=io.StringIO();writer=csv.writer(s);writer.writerows([HEADERS]+ROWS);csv_data=s.getvalue().encode()
wb=Workbook();ws=wb.active;ws.title='人工元数据样本';ws.append(HEADERS)
for row in ROWS:ws.append(row)
b=io.BytesIO();wb.save(b)
doc=Document();table=doc.add_table(rows=3,cols=len(HEADERS))
for i,row in enumerate([HEADERS]+ROWS):
 for j,value in enumerate(row):table.cell(i,j).text=value
d=io.BytesIO();doc.save(d)
JSON_ROWS=[{'question':row[5],'answer':row[7],'product_model':row[0],'sku':row[1],'category':row[2],'platform':row[3],'source':row[4]} for row in ROWS]
FILES=[('metadata.csv',csv_data),('metadata.xlsx',b.getvalue()),('metadata.docx',d.getvalue()),('metadata.json',json.dumps({'items':JSON_ROWS},ensure_ascii=False).encode())]
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(SITE.parent)));threading.Thread(target=server.serve_forever,daemon=True).start()
report={'mode':'Chromium, synthetic CSV/XLSX/DOCX/JSON; no business model parameters','module_sha256':module_sha,'format_checks':[]}
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);page=browser.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/{SITE.name}/')
  for name,data in FILES:
   rows=page.evaluate('''async({name,data})=>{const {parseDocumentFile}=await import('./lib/parser.js');const {extractQA}=await import('./lib/qa-import.js');return extractQA(await parseDocumentFile(new File([new Uint8Array(data)],name)))}''',{'name':name,'data':list(data)})
   assert len(rows)==2,(name,rows)
   for i,row in enumerate(rows):
    expected=ROWS[i]
    for key,index in [('model',0),('sku',1),('category',2),('platform',3),('sourceRef',4),('question',5),('answer',7)]:assert row[key]==expected[index],(name,key,row)
    assert len(row['sourceLocators'])==1 and row['locator'] in row['sourceLocators'],(name,row)
   report['format_checks'].append({'file':name,'status':'PASS','input_sha256':hashlib.sha256(data).hexdigest(),'rows':rows})
  report['identity_checks']=page.evaluate(r'''async()=>{
   const {extractQA,detectReviewConflicts,METADATA_LIMITS}=await import('./lib/qa-import.js');
   const results=[];
   const check=(name,ok,details)=>{if(!ok)throw new Error(name+': '+JSON.stringify(details));results.push({name,status:'PASS'});};
   const raw={question:'这款支持什么接口？',answer:'合成回答',model:'T7M Pro',sku:'SKU-A',category:'TCL 电视',platform:'京东',sourceRef:'参数表A'};
   const convert=rows=>extractQA({format:'json',jsonData:{items:rows}});
   for(const [field,other] of [['model','T8M'],['sku','SKU-B'],['category','雷鸟电视'],['platform','天猫']]){
    const rows=convert([raw,{...raw,[field]:other,answer:'第二份参考回答'}]);detectReviewConflicts(rows,{boardId:'01',category:'TCL 电视',platform:'京东'});
    check('distinct_'+field,rows.length===2&&rows.every(x=>x.reviewStatus==='needs_review'),rows);
    const incoming=convert([{...raw,[field]:other,answer:'第二份参考回答'}]);detectReviewConflicts(incoming,{existing:[{...raw,boardId:'01',status:'published'}],boardId:'01',category:'TCL 电视',platform:'京东'});check('existing_distinct_'+field,incoming[0].reviewStatus==='needs_review',incoming);
   }
   const op=extractQA({format:'csv',blocks:[{kind:'table',rows:[{cells:['型号','SKU','品类','平台','来源','弹幕内容','案例话术1'],locator:'第1行'}, {cells:['T7M Pro','A','TCL 电视','京东','参数表A','如何确认接口？','第一段参考'],locator:'第2行'},{cells:['T7M Pro','A','TCL 电视','京东','参数表B','如何确认接口？','第二段参考'],locator:'第3行'}]}]});
   check('same_identity_keeps_all_sources',op.length===1&&op[0].sourceRef==='参数表A\n参数表B'&&op[0].sourceLocators.join('|')==='第2行|第3行'&&op[0].answer.includes('第一段参考')&&op[0].answer.includes('第二段参考'),op);
   const standard=extractQA({format:'csv',blocks:[{kind:'table',rows:[{cells:['型号','SKU','品类','平台','来源','问题','优秀回答'],locator:'第1行'},{cells:['T7M Pro','A','TCL 电视','京东','参数表A','如何确认接口？','第一段参考'],locator:'第2行'}]}]});check('standard_headers_metadata',standard[0].model==='T7M Pro'&&standard[0].sourceRef==='参数表A'&&standard[0].sku==='A',standard);
   const missing=convert([{question:'这款支持什么接口？',answer:'答案中提到T7M Pro',sku:'T8M'}])[0];check('never_infer_model_from_answer_or_sku',missing.model===''&&missing.sku==='T8M'&&missing.answer==='答案中提到T7M Pro',missing);
   const roundtrip=convert([{...raw,source:'匿名导入资料 · 第2行',sourceLocators:['旧资料第2行']}])[0];check('canonical_source_and_lineage_roundtrip',roundtrip.sourceRef==='参数表A'&&roundtrip.sourceLocators.includes('旧资料第2行')&&roundtrip.sourceLocators.includes('JSON 1'),roundtrip);
   const defaults=convert([{question:raw.question,answer:raw.answer,model:raw.model,sku:raw.sku}]);detectReviewConflicts(defaults,{existing:[{...raw,boardId:'01',status:'published'}],boardId:'01',category:raw.category,platform:raw.platform});check('context_fills_missing_range',defaults[0].reviewStatus==='duplicate',defaults);
   const shared=convert([{...raw,platform:'全部平台'}]);shared[0].boardId='02';shared[0].scope='category';detectReviewConflicts(shared,{existing:[{...raw,platform:'全部平台',boardId:'01',scope:'category',status:'published'}]});check('category_shared_identity_cross_board',shared[0].reviewStatus==='duplicate',shared);
   const scoped=convert([raw]);scoped[0].boardId='02';scoped[0].scope='board';detectReviewConflicts(scoped,{existing:[{...raw,boardId:'01',scope:'board',status:'published'}]});check('board_scope_not_cross_merged',scoped[0].reviewStatus==='needs_review',scoped);
   const exact=convert([raw,{...raw,answer:'另一条不同答案'}]);detectReviewConflicts(exact);check('same_identity_conflicting_answers',exact.every(row=>row.reviewStatus==='conflict'),exact);
   const skuCase=convert([raw,{...raw,sku:'sku-a',answer:'另一条不同答案'}]);detectReviewConflicts(skuCase);check('opaque_sku_case_preserved',skuCase.every(row=>row.reviewStatus==='needs_review'),skuCase);
   const alias=convert([{问题:'如何确认接口？',优秀回答:'以资料为准',商品型号:'T7M Pro',商品SKU:0,产品品类:'TCL 电视',销售平台:'京东',资料来源:'显式来源'}])[0];check('chinese_aliases_and_zero_sku',alias.model==='T7M Pro'&&alias.sku==='0'&&alias.category==='TCL 电视'&&alias.platform==='京东'&&alias.sourceRef==='显式来源',alias);
   const ambiguous={...raw,product_model:'T8M'};let message='';try{convert([ambiguous])}catch(e){message=e.message}check('conflicting_metadata_aliases_rejected',message.includes('多个列/字段值不一致'),message);
   for(const field of ['model','sku','category','platform','sourceRef']){
    for(const value of [{text:'嵌套'},['数组'],false]){let error='';try{convert([{...raw,[field]:value}])}catch(e){error=e.message}check('reject_'+field+'_'+typeof value,error.includes(field)&&error.includes('JSON 1'),error);}
    let error='';try{convert([{...raw,[field]:'X'.repeat(METADATA_LIMITS[field]+1)}])}catch(e){error=e.message}check('limit_'+field,error.includes(field)&&error.includes('超过')&&error.includes('未截断保存'),error);
   }
   for(const values of [['X'.repeat(METADATA_LIMITS.sourceLocatorChars+1)],Array.from({length:METADATA_LIMITS.sourceLocators+1},(_,i)=>'来源'+i),[{row:1}]]){
    let error='';try{convert([{...raw,sourceLocators:values}])}catch(e){error=e.message}check('invalid_or_excess_source_locations_'+results.length,!!error,error);
   }
   const overlaps=[
    ['all_platforms_vs_jd',{scope:'board',boardId:'01',platform:'京东'},{scope:'board',boardId:'01',platform:'全部平台'}],
    ['shared_vs_board',{scope:'board',boardId:'01',platform:'京东'},{scope:'category',boardId:'02',platform:'京东'}],
    ['board_vs_shared',{scope:'category',boardId:'02',platform:'京东'},{scope:'board',boardId:'01',platform:'京东'}],
    ['combined_vs_jd',{scope:'board',boardId:'01',platform:'京东'},{scope:'board',boardId:'01',platform:'京东/天猫'}],
    ['tmall_vs_combined',{scope:'board',boardId:'01',platform:'京东/天猫'},{scope:'board',boardId:'01',platform:'天猫'}]
   ];
   for(const [name,incomingRange,existingRange] of overlaps){
    const rows=[{...raw,...incomingRange,answer:'不支持功能A',reviewStatus:'needs_review'}];detectReviewConflicts(rows,{existing:[{...raw,...existingRange,answer:'支持功能A',status:'published'}]});check('overlap_'+name,rows[0].reviewStatus==='conflict',rows);
    const same=[{...raw,...incomingRange,answer:'相同参考答案',reviewStatus:'needs_review'}];detectReviewConflicts(same,{existing:[{...raw,...existingRange,answer:'相同参考答案',status:'published'}]});check('same_answer_scope_extension_'+name,same[0].reviewStatus!=='conflict',same);
    const other=[{...raw,...incomingRange,model:'另一型号',answer:'不支持功能A',reviewStatus:'needs_review'}];detectReviewConflicts(other,{existing:[{...raw,...existingRange,answer:'支持功能A',status:'published'}]});check('overlap_other_model_'+name,other[0].reviewStatus==='needs_review',other);
   }
   const batch=[{...raw,scope:'board',boardId:'01',platform:'京东',answer:'不支持A'},{...raw,scope:'category',boardId:'02',platform:'全部平台',answer:'支持A'}];detectReviewConflicts(batch);check('overlap_inside_incoming_batch',batch.every(row=>row.reviewStatus==='conflict'),batch);
   const blankSource=convert([{...raw,sourceRef:' ',来源:'有效来源'}])[0];check('blank_canonical_source_falls_back',blankSource.sourceRef==='有效来源',blankSource);
   let caseError='';try{convert([{...raw,sourceRef:'https://example.test/A',source_ref:'https://example.test/a'}])}catch(e){caseError=e.message}check('source_url_path_case_distinct',caseError.includes('sourceRef')&&caseError.includes('不一致'),caseError);
   for(const key of ['model','sku','category','platform','sourceRef']){let error='';try{convert([{...raw,[key]:9007199254740993}])}catch(e){error=e.message}check('unsafe_integer_'+key,error.includes(key)&&error.includes('安全整数')&&error.includes('字符串'),error);}
   const safeSku=convert([{...raw,sku:Number.MAX_SAFE_INTEGER}])[0];check('safe_numeric_sku_preserved',safeSku.sku===String(Number.MAX_SAFE_INTEGER),safeSku);
   const preciseSku=convert([{...raw,sku:'9007199254740993'}])[0];check('large_string_sku_preserved',preciseSku.sku==='9007199254740993',preciseSku);
   return results;
  }''')
  report.update(status='PASS',browser=browser.version);browser.close()
finally:
 server.shutdown();report['module_sha256_after']=hashlib.sha256(MODULE.read_bytes()).hexdigest();report['source_unchanged']=report['module_sha256_after']==module_sha
 if not report['source_unchanged']:report['status']='FAIL'
 (OUT/'metadata.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({'status':report.get('status'),'formats':len(report['format_checks']),'identity_checks':len(report.get('identity_checks',[])),'module_sha256':module_sha,'source_unchanged':report['source_unchanged']},indent=2));assert report.get('status')=='PASS'
