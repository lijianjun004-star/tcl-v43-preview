#!/usr/bin/env python3
import pathlib,json,threading,hashlib,traceback
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path('/workspace/tcl-v43-preview/experiments/r24');OUT=pathlib.Path('/workspace/scratch/r24-data-audit')
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/tcl-v352-asr-r24-qa/'
result={'mode':'actual Chromium UI + native IndexedDB, two same-origin tabs; synthetic text-only user data; no model calls','app_sha256':hashlib.sha256((ROOT/'tcl-v352-asr-r24-qa/app.js').read_bytes()).hexdigest(),'errors':[]}
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':390,'height':844})
  ctx.add_init_script("navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('test text mode','NotAllowedError')}")
  a=ctx.new_page();a.on('dialog',lambda d:d.accept());a.on('pageerror',lambda e:result['errors'].append('A:'+str(e)))
  def login(page):
   page.goto(url);page.locator('[data-role-pick="anchor"]').click();page.locator('#simpleName').fill('双标签数据审查');page.locator('#simpleLogin').click();page.wait_for_selector('#freePractice')
  def live_answer(page,text):
   page.locator('#focusReview').click();page.locator('#liveToolText').click();page.locator('#liveTextAnswer').fill(text);page.locator('#liveTextSave').click()
  def review_edit(page,index,text):
   page.locator('textarea[aria-label="编辑本题回答"]').nth(index).fill(text);page.get_by_role('button',name='保存本题修改').nth(index).click();page.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='saved'");page.wait_for_timeout(100)
  def read(page):return page.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('tcl-specialty-v352-asr-r24-qa');q.onsuccess=()=>r(q.result)});const all=s=>new Promise(r=>{const q=db.transaction(s).objectStore(s).getAll();q.onsuccess=()=>r(q.result)});const prefs=await all('prefs'),records=await all('records');return {checkpoint:prefs.find(x=>x.id.startsWith('draft-session:')),records:records.map(x=>({id:x.id,answer:x.answer,question:x.question}))}}""")
  login(a);a.locator('#freePractice').click();a.locator('#prepQuickText').click();a.locator('#startScene').click();a.wait_for_function("document.body.classList.contains('room-live')")
  live_answer(a,'第一题原始答案');a.locator('#focusNext').click();live_answer(a,'第二题原始答案');a.locator('#focusClose').click();a.locator('#tclEndYes').click();a.wait_for_selector('#reviewDetails');a.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='saved'");a.locator('#reviewDetails').click()
  b=ctx.new_page();b.on('dialog',lambda d:d.accept());b.on('pageerror',lambda e:result['errors'].append('B:'+str(e)));login(b);b.locator('#restoreLocalSession').click();b.wait_for_selector('#reviewDetails');b.locator('#reviewDetails').click()
  review_edit(a,0,'第一题A标签已更新');result['after_a']=read(a)
  review_edit(b,1,'第二题B标签已更新');result['after_b']=read(b)
  checkpoint=result['after_b']['checkpoint']['snapshot']['turns'];result['expected_answers']=['第一题A标签已更新','第二题B标签已更新'];result['checkpoint_answers']=[x['answer'] for x in checkpoint]
  result['lost_update_reproduced']=result['checkpoint_answers']!=result['expected_answers'] and all(any(r['answer']==want for r in result['after_b']['records']) for want in result['expected_answers'])
  c=ctx.new_page();login(c);c.locator('#restoreLocalSession').click();c.wait_for_selector('#reviewDetails');c.locator('#reviewDetails').click();result['actual_restored_answers']=c.locator('textarea[aria-label="编辑本题回答"]').evaluate_all('(els)=>els.map(e=>e.value)');c.screenshot(path=str(OUT/'two-tabs-restored.png'),full_page=True)
  result['confirmed']=result['lost_update_reproduced'] and result['actual_restored_answers']==result['checkpoint_answers'];browser.close()
except Exception as e:result['exception']=str(e);result['traceback']=traceback.format_exc()
finally:server.shutdown();(OUT/'two-tabs.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in result.items() if k not in ['after_a','after_b']},ensure_ascii=False,indent=2))
