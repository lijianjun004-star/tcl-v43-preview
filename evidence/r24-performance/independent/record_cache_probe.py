"""Independent changed-record durability checks, native IndexedDB and synthetic turns.
HTTP appends test accessors; instrumentation counts attempted puts and injects one
checkpoint QuotaExceededError. No product source is modified and no mock DB is used.
"""
from pathlib import Path
import ast,hashlib,json,os,threading,traceback
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3];SITE=ROOT/'experiments/r24/tcl-v352-asr-r24-qa'
OUT=Path(os.environ.get('R24_CACHE_OUT',str(Path(__file__).parent/'record-cache-v2')));OUT.mkdir(parents=True,exist_ok=True)
DB='tcl-specialty-v352-asr-r24-qa'
tree=ast.parse((ROOT/'experiments/r24/tests/performance.py').read_text())
FIXTURE=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FIXTURE' for t in n.targets))
HOOK='\nwindow.__cacheAudit={save:()=>persistSessionCheckpoint(),change:(i,text)=>{lastSessionSnapshot.turns[i].answer=text;}};\n'
SOURCE=(SITE/'app.js').read_bytes()
INIT="""(()=>{const native=IDBObjectStore.prototype.put;window.__puts=[];window.__failCheckpoint=false;IDBObjectStore.prototype.put=function(row,...args){if(this.name==='records')window.__puts.push({id:row.id,answer:row.answer});if(window.__failCheckpoint&&String(row?.id).startsWith('draft-session:')){window.__failCheckpoint=false;throw new DOMException('independent one-shot quota failure','QuotaExceededError')}return native.call(this,row,...args)}})()"""
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(SITE),**kw)
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.split('?')[0]=='/app.js':
   self.send_response(200);self.send_header('Content-Type','application/javascript');self.end_headers();self.wfile.write(SOURCE+HOOK.encode())
  else:super().do_GET()
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();URL=f'http://127.0.0.1:{server.server_port}/'
result={'mode':__doc__,'app_sha256':hashlib.sha256(SOURCE).hexdigest(),'checks':{},'errors':[]}
def check(key,passed,detail=None):
 result['checks'][key]={'pass':bool(passed),'detail':detail};assert passed,(key,detail)
READ="""async({name,dbName})=>{const db=await new Promise(resolve=>{const q=indexedDB.open(dbName);q.onsuccess=()=>resolve(q.result)});const [checkpoint,records]=await Promise.all([new Promise(resolve=>{const q=db.transaction('prefs').objectStore('prefs').get('draft-session:'+encodeURIComponent(name));q.onsuccess=()=>resolve(q.result)}),new Promise(resolve=>{const q=db.transaction('records').objectStore('records').getAll();q.onsuccess=()=>resolve(q.result)})]);db.close();return {checkpoint,records}}"""
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);result['browser']=browser.version
  context=browser.new_context();context.add_init_script(INIT);page=context.new_page();page.on('pageerror',lambda e:result['errors'].append(str(e)))
  name='人工差量记录独立复核';args={'name':name,'n':3,'dbName':DB}
  def restore():
   page.locator('[data-role-pick="anchor"]').click();page.locator('#simpleName').fill(name);page.locator('#simpleLogin').click();page.locator('#restoreLocalSession').click();page.locator('#reviewDetails').wait_for()
  def reset():page.evaluate('window.__puts=[]')
  def save():return page.evaluate('window.__cacheAudit.save()')
  def puts():return page.evaluate('window.__puts')
  def read():return page.evaluate(READ,args)
  page.goto(URL);page.locator('[data-role-pick="anchor"]').wait_for();page.evaluate(FIXTURE,args);page.reload();restore();reset()
  check('first_restored_save_writes_all_three_records',save() and len(puts())==3,puts())
  before=read();reset();check('unchanged_save_commits_checkpoint_without_record_rewrites',save() and len(puts())==0 and read()['checkpoint']['revision']==before['checkpoint']['revision']+1,puts())
  reset();page.evaluate("__cacheAudit.change(0,'第一题新文字甲')");check('one_changed_answer_writes_one_record',save() and len(puts())==1 and puts()[0]['answer']=='第一题新文字甲',puts())
  before=read();reset();page.evaluate("()=>{__cacheAudit.change(1,'配额失败后应完整重试乙');window.__failCheckpoint=true}");failed=save();after=read()
  check('failed_checkpoint_aborts_changed_record_and_metadata',failed is False and before==after and len(puts())==1,puts())
  reset();check('retry_rewrites_failed_record_and_commits_complete_snapshot',save() and len(puts())==1 and puts()[0]['answer']=='配额失败后应完整重试乙',puts())
  state=read();check('record_rows_equal_checkpoint_answers_after_retry',all(any(row['id']==turn['id'] and row['answer']==turn['answer'] for row in state['records']) for turn in state['checkpoint']['snapshot']['turns']))
  reset();check('successful_retry_updates_cache_only_once',save() and puts()==[],puts())
  page.reload();page.locator('[data-role-pick="anchor"]').wait_for();restore();reset();check('reload_does_not_reuse_previous_page_record_cache',save() and len(puts())==3,puts())
  # A new owner has its own first save; a cache cannot suppress its records.
  page.locator('#reviewHome').click();page.locator('#freePractice').click();page.locator('#tclRestartYes').click();page.locator('#prepQuickText').click();page.locator('#startScene').click();page.wait_for_function("document.body.classList.contains('room-live')");page.wait_for_timeout(150)
  new=read();check('new_run_has_complete_independent_first_record',new['checkpoint']['runId']!=state['checkpoint']['runId'] and len(new['checkpoint']['snapshot']['turns'])==1 and any(row['id']==new['checkpoint']['snapshot']['turns'][0]['id'] for row in new['records']))
  browser.close();result['status']='PASS'
except Exception as e:result['status']='FAIL';result['exception']=str(e);result['traceback']=traceback.format_exc()
finally:
 server.shutdown();result['app_sha256_after']=hashlib.sha256((SITE/'app.js').read_bytes()).hexdigest();result['source_unchanged']=result['app_sha256']==result['app_sha256_after']
 if result['errors'] or not result['source_unchanged']:result['status']='FAIL'
 (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False,indent=2))
if result['status']!='PASS':raise SystemExit(1)
