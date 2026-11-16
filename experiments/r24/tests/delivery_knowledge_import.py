#!/usr/bin/env python3
"""Operator import races using actual UI handlers and native IndexedDB; synthetic data."""
import functools,json,pathlib,threading,os,hashlib
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=pathlib.Path(os.environ.get('R24_UI_OUTPUT',str(ROOT/'evidence/r24-delivery/recheck')));OUT.mkdir(parents=True,exist_ok=True)
APP=ROOT/'experiments/r24/tcl-v352-asr-r24-qa/app.js';APP_SHA=hashlib.sha256(APP.read_bytes()).hexdigest()
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'experiments/r24')))
threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/tcl-v352-asr-r24-qa/'
report={'mode':'Chromium UI handlers + real IndexedDB with synthetic CSV, delayed File read for navigation race','checks':{}}
CSV='问题,优秀回答\n如何核对接口兼容性？,请核对当前型号官方参数，并确认自己的设备接口。\n'.encode()
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 def start():
  ctx=browser.new_context(viewport={'width':1280,'height':900});page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(url)
  page.locator('[data-role-pick="operator"]').click();page.locator('#simpleName').fill('导入竞态测试');page.locator('#simpleLogin').click()
  page.evaluate("document.querySelector('[data-page=import]').click()")
  page.locator('#fileInput').set_input_files({'name':'synthetic.csv','mimeType':'text/csv','buffer':CSV})
  return ctx,page,errors
 ctx,page,errors=start();page.locator('#parseFile').click();page.wait_for_function("!document.getElementById('saveImport').disabled")
 page.locator('#importScope').select_option('category')
 invalidated=page.locator('#saveImport').is_disabled()
 report['checks']['context_change_invalidates_preview']=invalidated;ctx.close()
 ctx,page,errors=start();page.locator('#parseFile').click();page.wait_for_function("!document.getElementById('saveImport').disabled")
 page.locator('#fileInput').set_input_files({'name':'other.csv','mimeType':'text/csv','buffer':CSV})
 report['checks']['file_change_invalidates_preview']=page.locator('#saveImport').is_disabled();ctx.close()
 ctx,page,errors=start();page.locator('#parseFile').click();page.wait_for_function("!document.getElementById('saveImport').disabled")
 page.evaluate("()=>{const b=document.getElementById('saveImport');b.click();b.click();}")
 page.wait_for_function("document.body.dataset.page==='review'");page.wait_for_timeout(250)
 rows=page.evaluate("""async()=>{const d=(await indexedDB.databases()).find(d=>d.name.includes('r24'));return await new Promise((resolve,reject)=>{const r=indexedDB.open(d.name);r.onsuccess=()=>{const db=r.result;const q=db.transaction('items').objectStore('items').getAll();q.onsuccess=()=>{resolve(q.result.map(x=>({question:x.question,platform:x.platform,status:x.status})));db.close()};q.onerror=()=>reject(q.error)};r.onerror=()=>reject(r.error)})}""")
 report['checks']['double_save_row_count']=len(rows);report['double_save_errors']=errors;ctx.close()
 ctx,page,errors=start()
 page.evaluate("()=>{const original=File.prototype.arrayBuffer;File.prototype.arrayBuffer=async function(){await new Promise(r=>setTimeout(r,500));return original.call(this)}}")
 page.locator('#parseFile').click();page.evaluate("document.querySelector('[data-page=home]').click()")
 page.wait_for_timeout(800)
 report['checks']['late_parse_page_errors']=errors;report['checks']['late_parse_stays_home']=page.evaluate("document.body.dataset.page==='home'")
 ctx.close()
 if not os.environ.get('BASELINE'):
  ctx,page,errors=start()
  csv_two=CSV+'另一种设备怎样确认接口？,请查看该设备与电视的官方接口说明。\n'.encode()
  page.locator('#fileInput').set_input_files({'name':'two.csv','mimeType':'text/csv','buffer':csv_two})
  page.locator('#parseFile').click();page.wait_for_function("!document.getElementById('saveImport').disabled")
  page.evaluate("""()=>{const original=IDBObjectStore.prototype.add;let count=0;IDBObjectStore.prototype.add=function(...args){if(this.name==='items'&&++count===2){IDBObjectStore.prototype.add=original;throw new DOMException('Synthetic quota failure','QuotaExceededError')}return original.apply(this,args)}}""")
  page.locator('#saveImport').click();page.wait_for_function("document.getElementById('toast').textContent.includes('保存中断')")
  get_count="""async()=>{const d=(await indexedDB.databases()).find(d=>d.name.includes('r24'));return await new Promise((resolve,reject)=>{const r=indexedDB.open(d.name);r.onsuccess=()=>{const db=r.result;const q=db.transaction('items').objectStore('items').count();q.onsuccess=()=>{resolve(q.result);db.close()};q.onerror=()=>reject(q.error)};r.onerror=()=>reject(r.error)})}"""
  report['checks']['aborted_batch_rows']=page.evaluate(get_count)
  page.locator('#saveImport').click();page.wait_for_function("document.body.dataset.page==='review'")
  report['checks']['retry_batch_rows']=page.evaluate(get_count);report['atomic_batch_errors']=errors
  ctx.close()
 report['browser']=browser.version;browser.close()
server.shutdown()
report['status']='PASS' if invalidated and len(rows)==1 and not report['checks']['late_parse_page_errors'] and report['checks']['late_parse_stays_home'] and report['checks']['file_change_invalidates_preview'] and report['checks'].get('aborted_batch_rows')==0 and report['checks'].get('retry_batch_rows')==2 and not errors else 'FAIL'
report['app_sha256']=APP_SHA;report['app_sha256_after']=hashlib.sha256(APP.read_bytes()).hexdigest();report['source_unchanged']=report['app_sha256_after']==APP_SHA
if not report['source_unchanged']:report['status']='FAIL'
name='knowledge-import-'+('before' if os.environ.get('BASELINE') else 'after')+'.json'
(OUT/name).write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
if not os.environ.get('BASELINE'):assert report['status']=='PASS'
