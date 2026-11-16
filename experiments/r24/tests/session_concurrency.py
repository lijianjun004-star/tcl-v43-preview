#!/usr/bin/env python3
"""Native Chromium/IndexedDB concurrency, using actual UI and synthetic text-only data."""
import pathlib,json,threading,hashlib,traceback,os
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path(os.environ.get('R24_CONCURRENCY_OUT',str(ROOT.parents[1]/'evidence/r24-data-audit/concurrency')));OUT.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();url=f'http://127.0.0.1:{server.server_port}/tcl-v352-asr-r24-qa/'
APP=ROOT/'tcl-v352-asr-r24-qa/app.js';start_sha=hashlib.sha256(APP.read_bytes()).hexdigest()
result={'mode':'actual Chromium UI + native IndexedDB; synthetic text-only fixtures, no model/network services','app_sha256':start_sha,'checks':{},'errors':[]}
NAME='并发回归主播'
READ="""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('tcl-specialty-v352-asr-r24-qa');q.onsuccess=()=>r(q.result)});const all=s=>new Promise(r=>{const q=db.transaction(s).objectStore(s).getAll();q.onsuccess=()=>r(q.result)});const prefs=await all('prefs'),records=await all('records');return {checkpoint:prefs.find(x=>x.id.startsWith('draft-session:')),records:records.map(x=>({id:x.id,answer:x.answer,manualCleared:x.manualCleared}))}}"""
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':390,'height':844},accept_downloads=True)
  def page_new(context=ctx):
   page=context.new_page();page.on('dialog',lambda d:d.accept());page.on('pageerror',lambda e:result['errors'].append(str(e)));return page
  def login(page):
   page.goto(url);page.locator('[data-role-pick="anchor"]').click();page.locator('#simpleName').fill(NAME);page.locator('#simpleLogin').click();page.wait_for_selector('#freePractice');page.wait_for_timeout(100)
  def live_answer(page,text):
   page.locator('#focusReview').click();page.locator('#liveToolText').click();page.locator('#liveTextAnswer').fill(text);page.locator('#liveTextSave').click()
  def saved(page,status='saved'):page.wait_for_function('(s)=>document.querySelector("#localSessionSaveStatus")?.dataset.status===s',arg=status);page.wait_for_timeout(80)
  def edit(page,index,text,status='saved'):
   page.locator('textarea[aria-label="编辑本题回答"]').nth(index).fill(text);page.get_by_role('button',name='保存本题修改').nth(index).click();saved(page,status)
  def restore(page):page.locator('#restoreLocalSession').click();page.wait_for_selector('#reviewDetails');page.locator('#reviewDetails').click()
  def read(page):return page.evaluate(READ)
  a=page_new();login(a);a.locator('#freePractice').click();a.locator('#prepQuickText').click();a.locator('#startScene').click();a.wait_for_function("document.body.classList.contains('room-live')")
  live_answer(a,'原始第一题');a.locator('#focusNext').click();live_answer(a,'原始第二题');a.locator('#focusClose').click();a.locator('#tclEndYes').click();a.wait_for_selector('#reviewDetails');saved(a);a.locator('#reviewDetails').click()
  b=page_new();login(b);restore(b)
  edit(a,0,'A第一题已提交');after_a=read(a)
  edit(b,1,'B第二题尚未保存','error');after_b=read(b)
  assert after_a==after_b,(after_a,after_b)
  assert '其他标签' in b.locator('#localSessionSaveStatus').inner_text()
  assert b.locator('textarea[aria-label="编辑本题回答"]').nth(1).input_value()=='B第二题尚未保存'
  with b.expect_download() as dl:b.locator('#exportUnsavedSession').click()
  exported=json.loads(pathlib.Path(dl.value.path()).read_text());assert exported['snapshot']['turns'][1]['answer']=='B第二题尚未保存'
  result['checks']['different_question_conflict_atomic_and_unsaved_export']=True
  edit(b,0,'B想覆盖第一题','error');assert read(b)==after_a
  b.locator('#reviewDetailsBack').click();b.locator('#submitOperator').fill('复验运营');b.locator('#submitSession').click();saved(b,'error');b.wait_for_timeout(200)
  subs=b.evaluate("async()=>{const db=await new Promise(r=>{const q=indexedDB.open('tcl-specialty-v352-asr-r24-qa');q.onsuccess=()=>r(q.result)});return await new Promise(r=>{const q=db.transaction('prefs').objectStore('prefs').get('submissions');q.onsuccess=()=>r(q.result?.value||[])})}");assert subs==[]
  result['checks']['stale_conflicted_tab_cannot_submit_to_operator']=True
  result['checks']['same_question_conflict_rejected']=True
  b.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}))");b.wait_for_timeout(300);assert read(b)==after_a
  result['checks']['stale_pagehide_does_not_overwrite']=True
  c=page_new();login(c) # caches the current card, then A saves newer metadata
  edit(a,0,'A在恢复按钮显示后更新');restore(c)
  assert c.locator('textarea[aria-label="编辑本题回答"]').first.input_value()=='A在恢复按钮显示后更新'
  result['checks']['restore_reads_latest_metadata_not_cached_card']=True
  c.evaluate("""()=>{for(const [i,v] of [[0,'快速保存第一题'],[1,'快速保存第二题']]){const row=document.querySelectorAll('#questionSummary tbody tr')[i];const e=row.querySelector('textarea');e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));[...row.querySelectorAll('button')].find(x=>x.textContent==='保存本题修改').click();}}""")
  saved(c);quick=read(c);assert [x['answer'] for x in quick['checkpoint']['snapshot']['turns']]==['快速保存第一题','快速保存第二题'];assert quick['checkpoint']['revision']>after_a['checkpoint']['revision']
  assert all(any(r['answer']==v for r in quick['records']) for v in ['快速保存第一题','快速保存第二题'])
  result['checks']['same_tab_rapid_saves_serialized_without_conflict']=True
  # Saving records first would create partial success here. Throw at the checkpoint write.
  c.evaluate("""()=>{window.__put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,...rest){if(v?.id?.startsWith('draft-session:'))throw new DOMException('test quota','QuotaExceededError');return window.__put.call(this,v,...rest)}}""")
  edit(c,0,'配额失败不应进入records','error');assert read(c)==quick
  result['checks']['quota_aborts_records_and_checkpoint_together']=True
  c.evaluate('()=>{IDBObjectStore.prototype.put=window.__put}');edit(c,1,'另一题触发整场恢复保存');recovered=read(c);assert any(x['answer']=='配额失败不应进入records' for x in recovered['records']);assert recovered['checkpoint']['snapshot']['turns'][0]['answer']=='配额失败不应进入records'
  result['checks']['retry_after_failed_transaction_uses_previous_token']=True
  # Start a new run from the current writer, then ensure the old run cannot replace it.
  c.locator('#reviewDetailsBack').click();c.locator('#reviewHome').click();c.locator('#freePractice').click();c.locator('#tclRestartYes').click();c.locator('#prepQuickText').click();c.locator('#startScene').click();live_answer(c,'新场第一题');saved(c);new_run=read(c);assert new_run['checkpoint']['runId']!=quick['checkpoint']['runId']
  edit(a,0,'旧场试图覆盖新场','error');assert read(a)==new_run
  result['checks']['old_run_cannot_replace_new_run_or_update_records']=True
  # Old v1 checkpoints without tokens are readable and upgraded on their first write.
  legacy_ctx=browser.new_context(viewport={'width':390,'height':844});legacy=page_new(legacy_ctx);legacy.goto(url);legacy.wait_for_selector('[data-role-pick="anchor"]')
  fixture=quick['checkpoint'];fixture.pop('writeToken',None);fixture.pop('revision',None)
  legacy.evaluate("""async data=>{const db=await new Promise(r=>{const q=indexedDB.open('tcl-specialty-v352-asr-r24-qa');q.onsuccess=()=>r(q.result)});await new Promise((res,rej)=>{const t=db.transaction('prefs','readwrite');t.objectStore('prefs').put(data);t.oncomplete=res;t.onabort=()=>rej(t.error)})}""",fixture)
  login(legacy);restore(legacy);edit(legacy,0,'旧格式兼容写入');upgraded=read(legacy);assert upgraded['checkpoint']['writeToken'] and upgraded['checkpoint']['revision']==1
  result['checks']['legacy_checkpoint_read_and_token_upgrade']=True
  c.screenshot(path=str(OUT/'new-run-protected.png'),full_page=True)
  result['source_unchanged']=hashlib.sha256(APP.read_bytes()).hexdigest()==start_sha;result['ok']=not result['errors'] and result['source_unchanged'];browser.close()
except Exception as e:result['ok']=False;result['exception']=str(e);result['traceback']=traceback.format_exc()
finally:server.shutdown();(OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2))
if not result['ok']:raise SystemExit(1)
