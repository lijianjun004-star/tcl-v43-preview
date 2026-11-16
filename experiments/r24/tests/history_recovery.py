#!/usr/bin/env python3
"""Chromium real app/IndexedDB; synthetic persisted page-transition events.
This tests the BFCache event-handler contract, not a real mobile BFCache/device.
"""
import functools,hashlib,json,pathlib,threading,traceback
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT.parents[1]/'evidence/r24-delivery/history';OUT.mkdir(parents=True,exist_ok=True)
APP=ROOT/'tcl-v352-asr-r24-qa/app.js';sha=hashlib.sha256(APP.read_bytes()).hexdigest()
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
result={'mode':'Chromium real UI and IndexedDB; synthetic persisted pagehide/pageshow events; text-only, no model/hardware','source_sha256':sha,'checks':{},'errors':[]}
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  page=browser.new_page(viewport={'width':390,'height':844});page.on('pageerror',lambda e:result['errors'].append(str(e)))
  page.on('dialog',lambda d:d.accept())
  page.goto(f'http://127.0.0.1:{server.server_port}/tcl-v352-asr-r24-qa/')
  page.locator('[data-role-pick="anchor"]').click();page.locator('#simpleName').fill('历史恢复测试');page.locator('#simpleLogin').click();page.wait_for_selector('#freePractice');page.wait_for_timeout(150)
  page.locator('#freePractice').click();page.locator('#prepQuickText').click();page.locator('#startScene').click()
  page.locator('#focusReview').click();page.locator('#liveToolText').click();page.locator('#liveTextAnswer').fill('返回之前已保存的回答');page.locator('#liveTextSave').click()
  page.locator('#focusClose').click();page.locator('#tclEndYes').click();page.wait_for_selector('#reviewDetails')
  page.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='saved'")
  page.evaluate("()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));}")
  page.wait_for_selector('#restoreLocalSession',timeout=5000)
  assert page.locator('#reviewDetails').count()==0
  result['checks']['stale_review_replaced_by_recovery_home']=True
  page.locator('#restoreLocalSession').click();page.locator('#reviewDetails').click()
  edit=page.locator('textarea[aria-label="编辑本题回答"]').first
  assert edit.input_value()=='返回之前已保存的回答'
  edit.fill('历史返回后修改成功');page.get_by_role('button',name='保存本题修改').first.click()
  page.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='saved'")
  value=page.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('tcl-specialty-v352-asr-r24-qa');q.onsuccess=()=>r(q.result)});const rows=await new Promise(r=>{const q=db.transaction('prefs').objectStore('prefs').getAll();q.onsuccess=()=>r(q.result)});db.close();return rows.find(x=>x.id.startsWith('draft-session:')).snapshot.turns[0].answer}""")
  assert value=='历史返回后修改成功',value
  result['checks']['restored_review_edits_commit']=True
  result['source_unchanged']=hashlib.sha256(APP.read_bytes()).hexdigest()==sha
  result['ok']=not result['errors'] and result['source_unchanged'];browser.close()
except Exception as e:result.update(ok=False,exception=str(e),traceback=traceback.format_exc())
finally:server.shutdown();(OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2))
if not result['ok']:raise SystemExit(1)
