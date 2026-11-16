#!/usr/bin/env python3
"""Public R25 pure-text Chromium workflow; no hardware, model loading or inference."""
from pathlib import Path
from urllib.parse import urlsplit
import hashlib,json,os,time,traceback,sys
from playwright.sync_api import sync_playwright
OUT=Path('/workspace/r25-deployment/public-browser');OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('R25_PUBLIC_URL','https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r25-qa/')
APP_SHA='2848488723324db8a897fcb0fc4cbe577916b0e3e01cce8e05922aed8c3d1bfc'
NAME='Codex-R25公网文字验收-'+str(int(time.time()))
ANSWERS=['公网验收第一题：请核对官方产品参数。','公网验收第二题：型号与数字以资料为准。']
report={'scope':__doc__,'url':URL,'expected_app_sha256':APP_SHA,'test_name':NAME,'checks':{},'steps':[],'page_errors':[],'requests':[],'model_requests':[],'request_failures':[],'app_responses':[],'status':'NOT RUN'}
DBREAD=r'''async name=>{
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('tcl-specialty-v352-asr-r25-qa');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction('prefs','readonly'),q=tx.objectStore('prefs').getAll();tx.oncomplete=()=>{const rows=q.result,meta=rows.find(x=>x.id==='draft-session:'+encodeURIComponent(name));resolve({runId:meta?.runId,turnIds:meta?.snapshot?.turns.map(t=>t.id),answers:meta?.snapshot?.turns.map(t=>t.answer),mediaCount:rows.filter(x=>String(x.id).startsWith('draft-media:')).length,revision:meta?.revision})};tx.onabort=()=>reject(tx.error)})}finally{db.close()}
}'''
def check(name,ok,detail=None):
 report['checks'][name]={'pass':bool(ok),'detail':detail}
 if not ok:raise AssertionError((name,detail))
def step(name,fn):
 start=time.monotonic();v=fn();report['steps'].append({'name':name,'seconds':round(time.monotonic()-start,3)});return v
browser=None
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,locale='zh-CN')
  # Detect and block accidental model requests; product HTML/app/resources are never mocked.
  def route(req):
   u=req.request.url;host=urlsplit(u).hostname or '';path=urlsplit(u).path.lower()
   if '/live-practice-room/voice/' in path or host in ('huggingface.co','hf-mirror.com') or 'transformers' in u or path.endswith(('.wasm','.onnx')):
    report['model_requests'].append(u);return req.abort('blockedbyclient')
   return req.continue_()
  context.route('**/*',route)
  page=context.new_page();app_objects=[]
  page.on('pageerror',lambda e:report['page_errors'].append(str(e)))
  page.on('request',lambda r:report['requests'].append(r.url))
  page.on('requestfailed',lambda r:report['request_failures'].append({'url':r.url,'failure':r.failure}))
  page.on('response',lambda r:app_objects.append(r) if urlsplit(r.url).path.endswith('/tcl-v352-asr-r25-qa/app.js') else None)
  page.on('dialog',lambda d:d.accept())
  def login():
   page.locator('[data-role-pick="anchor"]').wait_for(timeout=20000);page.locator('[data-role-pick="anchor"]').click();page.locator('#simpleName').fill(NAME);page.locator('#simpleLogin').click();page.locator('#freePractice').wait_for(timeout=20000)
  def save_done():page.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='saved'",timeout=20000)
  step('load_public_url',lambda:page.goto(URL,wait_until='networkidle',timeout=45000));step('login_default_context',login)
  default=page.locator('#r23ModelChoice').input_value();check('new_context_defaults_to_vosk',default=='vosk',{'selected':default,'stored':page.evaluate("localStorage.getItem('tcl-r25-asr-engine')")})
  page.screenshot(path=str(OUT/'01-home-default-vosk.png'),full_page=True)
  # Switch only this empty test context to Tiny before entering prep. The subsequent path is text only.
  page.evaluate("localStorage.setItem('tcl-r25-asr-engine','tiny')")
  step('reload_with_test_context_engine_tiny',lambda:page.reload(wait_until='networkidle'));step('login_text_context',login)
  check('text_context_tiny_selected',page.locator('#r23ModelChoice').input_value()=='tiny')
  step('open_free_practice',lambda:page.locator('#freePractice').click());step('select_text_mode',lambda:page.locator('#prepQuickText').click())
  page.wait_for_function("!document.querySelector('#startScene').disabled",timeout=15000);page.screenshot(path=str(OUT/'02-text-prep.png'),full_page=True)
  step('start_text_practice',lambda:page.locator('#startScene').click());page.wait_for_function("document.body.classList.contains('room-live')",timeout=15000)
  for i,text in enumerate(ANSWERS):
   step('open_tools_'+str(i+1),lambda:page.locator('#focusReview').click());page.locator('#liveToolText').click();page.locator('#liveTextAnswer').fill(text);page.locator('#liveTextSave').click();save_done()
   page.screenshot(path=str(OUT/f'03-live-text-question-{i+1}.png'),full_page=True)
   if i==0:
    page.locator('#focusNext').click();page.wait_for_function("/第\\s*2\\s*题/.test(document.querySelector('#liveQIndex')?.textContent||'')",timeout=15000)
  step('finish_practice',lambda:page.locator('#focusClose').click());page.locator('#tclEndYes').click();page.locator('#reviewDetails').wait_for(timeout=20000);save_done()
  page.locator('#reviewDetails').click();editors=page.locator('textarea[aria-label="编辑本题回答"]');editors.first.wait_for(timeout=15000)
  before_values=editors.evaluate_all('(els)=>els.map(x=>x.value)');check('two_answers_in_original_question_order',before_values==ANSWERS,before_values)
  check('pure_text_has_no_audio_players',page.locator('audio').count()==0)
  report['checkpoint_before_reload']=page.evaluate(DBREAD,NAME);check('native_checkpoint_has_two_exact_answers',report['checkpoint_before_reload']['answers']==ANSWERS,report['checkpoint_before_reload'])
  page.screenshot(path=str(OUT/'04-two-question-review.png'),full_page=True)
  step('reload_review',lambda:page.reload(wait_until='networkidle'));step('relogin_same_name',login)
  page.locator('#restoreLocalSession').wait_for(timeout=15000);page.locator('#restoreLocalSession').click();page.locator('#reviewDetails').wait_for(timeout=15000);page.locator('#reviewDetails').click()
  restored=page.locator('textarea[aria-label="编辑本题回答"]').evaluate_all('(els)=>els.map(x=>x.value)');check('reload_same_name_restores_two_exact_answers',restored==ANSWERS,restored)
  after=page.evaluate(DBREAD,NAME);report['checkpoint_after_reload']=after
  check('restored_same_run_and_turn_ids',after['runId']==report['checkpoint_before_reload']['runId'] and after['turnIds']==report['checkpoint_before_reload']['turnIds'],after)
  check('pure_text_has_no_recorded_media',after['mediaCount']==0 and page.locator('audio').count()==0,after['mediaCount'])
  report['mobile_layout']=page.evaluate("({width:innerWidth,documentWidth:document.documentElement.scrollWidth,scale:visualViewport?.scale,firstEditorFont:getComputedStyle(document.querySelector('textarea[aria-label=\"编辑本题回答\"]')).fontSize})")
  page.screenshot(path=str(OUT/'05-refreshed-restored-mobile-review.png'),full_page=True)
  for r in app_objects:
   b=r.body();report['app_responses'].append({'url':r.url,'status':r.status,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
  check('actual_browser_app_responses_match_release',len(report['app_responses'])>=3 and all(x['status']==200 and x['sha256']==APP_SHA for x in report['app_responses']),report['app_responses'])
  check('no_model_requests_or_inference',not report['model_requests'],report['model_requests']);check('no_page_errors',not report['page_errors'],report['page_errors'])
  report['browser']=browser.version;report['status']='PASS';browser.close();browser=None
except Exception as e:
 report['status']='FAIL';report['exception']=str(e);report['traceback']=traceback.format_exc()
 try:
  if 'page' in globals():page.screenshot(path=str(OUT/'failure.png'),full_page=True)
 except Exception:pass
 finally:
  try:
   if browser:browser.close()
  except Exception:pass
finally:
 (OUT/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k not in ('requests','steps')},ensure_ascii=False,indent=2))
if report['status']!='PASS':raise SystemExit(1)
