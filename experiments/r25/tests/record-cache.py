#!/usr/bin/env python3
"""Native IndexedDB record-write cache regression, synthetic text fixtures and real UI.

No application test hooks or model calls. Instrument native put/transaction calls,
then compare stored checkpoints and records across aborts, restores and stale tabs.
"""
import ast, hashlib, json, os, pathlib, threading, traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright
R25_PIN="try{localStorage.getItem('tcl-r25-asr-engine')||localStorage.setItem('tcl-r25-asr-engine','tiny')}catch(e){}"  # R2.5 port: keep the R24 Whisper-path semantics and avoid the default Vosk auto-download (network)


ROOT = pathlib.Path(__file__).resolve().parents[1]
SITE = ROOT / 'tcl-v352-asr-r25-qa'
APP = SITE / 'app.js'
OUT = pathlib.Path(os.environ.get('R24_RECORD_CACHE_OUT', str(ROOT.parents[1] / 'evidence/r25-ported/record-cache')))
OUT.mkdir(parents=True, exist_ok=True)
DB = 'tcl-specialty-v352-asr-r25-qa'
NAME = '人工记录缓存复核'
N = 25
tree = ast.parse((ROOT / 'tests/performance.py').read_text())
FIXTURE = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'FIXTURE' for t in n.targets))
INSTRUMENT = r'''(() => {
 let counts;
 const fresh=()=>({transactions:0,complete:0,aborted:0,checkpointPuts:0,recordIds:[]});
 counts=fresh();
 const put=IDBObjectStore.prototype.put, transaction=IDBDatabase.prototype.transaction;
 IDBObjectStore.prototype.put=function(value,...args){
  if(this.name==='records')counts.recordIds.push(value.id);
  if(this.name==='prefs'&&value?.id?.startsWith('draft-session:')){
   counts.checkpointPuts++;
   if(window.__failCheckpoint)throw new DOMException('Synthetic quota failure','QuotaExceededError');
  }
  return put.call(this,value,...args);
 };
 IDBDatabase.prototype.transaction=function(stores,mode,...args){
  const tx=transaction.call(this,stores,mode,...args);
  if(mode==='readwrite'&&[].concat(stores).includes('records')&&[].concat(stores).includes('prefs')){
   const current=counts;current.transactions++;
   tx.addEventListener('complete',()=>current.complete++);
   tx.addEventListener('abort',()=>current.aborted++);
  }
  return tx;
 };
 window.__cacheProbe={reset(){counts=fresh()},read(){return structuredClone(counts)}};
})();'''
READ = r'''async ({name,dbName})=>{
 const db=await new Promise((resolve,reject)=>{const q=indexedDB.open(dbName);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(['prefs','records']),meta=tx.objectStore('prefs').get('draft-session:'+encodeURIComponent(name)),rows=tx.objectStore('records').getAll();
  tx.oncomplete=()=>resolve({checkpoint:meta.result,records:rows.result});tx.onabort=()=>reject(tx.error);
 })}finally{db.close()}
}'''
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kw):super().__init__(*args,directory=str(SITE),**kw)
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{server.server_port}/'
sha=lambda:hashlib.sha256(APP.read_bytes()).hexdigest()
report={'mode':__doc__,'app_sha256':sha(),'fixture_turns':N,'checks':{},'errors':[]}
def check(name,ok,detail=None):
 report['checks'][name]={'pass':bool(ok),'detail':detail}
 assert ok,(name,detail)
def saved(page,status='saved'):
 page.wait_for_function('(status)=>document.querySelector("#localSessionSaveStatus")?.dataset.status===status',arg=status,timeout=20000)
def read(page):return page.evaluate(READ,{'name':NAME,'dbName':DB})
def reset(page):page.evaluate('__cacheProbe.reset()')
def count(page):return page.evaluate('__cacheProbe.read()')
def login_restore(page):
 page.goto(URL);page.locator('[data-role-pick="anchor"]').click();page.locator('#simpleName').fill(NAME);page.locator('#simpleLogin').click();page.locator('#restoreLocalSession').click();page.locator('#reviewDetails').wait_for()
def details(page):page.locator('#reviewDetails').click()
def edit(page,index,text,status='saved'):
 page.locator('textarea[aria-label="编辑本题回答"]').nth(index).fill(text)
 page.get_by_role('button',name='保存本题修改',exact=True).nth(index).click();saved(page,status)
def post(page,text):
 page.evaluate('(text)=>{const el=document.querySelector("#postTranscript");el.value=text;el.dispatchEvent(new Event("input",{bubbles:true}))}',text)

try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  context=browser.new_context(viewport={'width':390,'height':844});context.add_init_script(R25_PIN);context.add_init_script(INSTRUMENT)
  def newpage():
   page=context.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)));page.on('dialog',lambda d:d.accept());return page
  a=newpage();a.goto(URL);a.locator('[data-role-pick="anchor"]').wait_for();a.evaluate(FIXTURE,{'name':NAME,'n':N,'dbName':DB})
  login_restore(a);details(a);reset(a);edit(a,0,'首次恢复后的第一题')
  c=count(a);check('restore_first_commit_writes_all_records',len(c['recordIds'])==N and c['checkpointPuts']==1 and c['complete']==1,c)
  reset(a);edit(a,1,'仅第二题发生变化');c=count(a)
  check('one_edited_turn_writes_one_record',c['recordIds']==['synthetic-perf-25-1'] and c['checkpointPuts']==1,c)
  a.locator('#reviewGoReplay').click();a.locator('#reviewToolsFold > summary').click();reset(a)
  expected=''.join(str(i%10) for i in range(40))
  a.evaluate('(text)=>{const el=document.querySelector("#postTranscript");el.value="";for(const char of text){el.value+=char;el.dispatchEvent(new Event("input",{bubbles:true}))}}',expected);saved(a)
  c=count(a);state=read(a)
  check('forty_inputs_keep_forty_immediate_checkpoints',c['checkpointPuts']==40 and c['transactions']==40 and c['complete']==40,c)
  check('unchanged_turns_are_not_rewritten_for_post_text',c['recordIds']==[] and state['checkpoint']['snapshot']['postTranscript']==expected,c)
  a.locator('#reviewGoDetails').click();before=read(a);reset(a);a.evaluate('window.__failCheckpoint=true');edit(a,0,'配额失败的第一题','error')
  c=count(a);check('quota_aborts_changed_record_and_checkpoint',read(a)==before and c['recordIds']==['synthetic-perf-25-0'] and c['aborted']==1,c)
  a.evaluate('window.__failCheckpoint=false');reset(a);edit(a,1,'失败后第二题触发重试');after=read(a);c=count(a)
  answers={r['id']:r['answer'] for r in after['records']}
  check('failed_transaction_does_not_advance_record_fingerprints',set(c['recordIds'])=={'synthetic-perf-25-0','synthetic-perf-25-1'} and answers['synthetic-perf-25-0']=='配额失败的第一题' and answers['synthetic-perf-25-1']=='失败后第二题触发重试',c)
  reset(a);a.evaluate('''()=>{for(const [i,text]of [[0,'串行快写第一题'],[1,'串行快写第二题']]){const row=document.querySelectorAll('#questionSummary tbody tr')[i],el=row.querySelector('textarea');el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));[...row.querySelectorAll('button')].find(b=>b.textContent==='保存本题修改').click()}}''');saved(a);c=count(a);after=read(a)
  check('queued_saves_compare_after_previous_commit',c['recordIds']==['synthetic-perf-25-0','synthetic-perf-25-1'] and c['checkpointPuts']==2 and [x['answer'] for x in after['checkpoint']['snapshot']['turns'][:2]]==['串行快写第一题','串行快写第二题'],c)
  # New page has no fingerprints. Its first text-only change must rebuild all rows.
  b=newpage();login_restore(b);reset(b);post(b,'新页恢复后的整场文字');saved(b);c=count(b)
  check('fresh_page_restore_does_not_trust_previous_tab_cache',len(c['recordIds'])==N and c['checkpointPuts']==1,c)
  cpage=newpage();login_restore(cpage);details(cpage);edit(cpage,0,'当前最新标签写入');winner=read(cpage)
  reset(b);post(b,'旧页无变更题目仍不能覆盖');saved(b,'error');c=count(b)
  check('cache_hit_still_checks_cross_tab_checkpoint_token',read(b)==winner and c['transactions']==1 and c['aborted']==1 and c['recordIds']==[] and c['checkpointPuts']==0 and '其他标签' in b.locator('#localSessionSaveStatus').inner_text(),c)
  # Reset in same JS page: new run gets fresh fingerprints and a complete record.
  cpage.locator('#reviewDetailsBack').click();cpage.locator('#reviewHome').click();cpage.locator('#freePractice').click();cpage.locator('#tclRestartYes').click();cpage.locator('#prepQuickText').click();reset(cpage);cpage.locator('#startScene').click();cpage.locator('#focusReview').click();cpage.locator('#liveToolText').click();cpage.locator('#liveTextAnswer').fill('新场记录必须保存');cpage.locator('#liveTextSave').click();saved(cpage)
  latest=read(cpage);c=count(cpage);turn=latest['checkpoint']['snapshot']['turns'][0]
  check('same_page_new_run_writes_new_turn_without_old_cache',latest['checkpoint']['runId']!=winner['checkpoint']['runId'] and turn['id'] in c['recordIds'] and all(not x.startswith('synthetic-perf-25-') for x in c['recordIds']) and any(x['id']==turn['id'] and x['answer']=='新场记录必须保存' for x in latest['records']),c)
  report['browser']=browser.version;browser.close();report['status']='PASS'
except Exception as e:
 report['status']='FAIL';report['exception']=str(e);report['traceback']=traceback.format_exc()
finally:
 server.shutdown();report['app_sha256_after']=sha();report['source_unchanged']=report['app_sha256']==report['app_sha256_after']
 if not report['source_unchanged'] or report['errors']:report['status']='FAIL'
 (OUT/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2))
if report['status']!='PASS':raise SystemExit(1)
