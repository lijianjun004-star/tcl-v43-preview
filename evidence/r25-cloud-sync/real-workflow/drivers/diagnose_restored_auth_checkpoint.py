#!/usr/bin/env python3
"""Focused real-public diagnostic: actual Auth login -> user model control reload -> first local text save.
No task creation, submission, feedback or model request; unsubmitted synthetic text only.
"""
from pathlib import Path
from datetime import datetime,timezone
import json,traceback
from playwright.sync_api import sync_playwright
from run_native_pg_e2e import private_config,sha
ROOT=Path(__file__).resolve().parent;out=ROOT/'results/public-restored-auth-diagnostic';out.mkdir(parents=True,exist_ok=True)
cfg=private_config('/workspace/r25-cloud-test-credentials.json');account=cfg['accounts']['anchor'];url='https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r25-qa/'
r={'scope':__doc__,'url':url,'status':'NOT RUN','startedAt':datetime.now(timezone.utc).isoformat(),'pageErrors':[],'modelRequests':[],'cloudBusinessWrites':'No task/submission/feedback actions performed'}
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);ctx=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,locale='zh-CN');p=ctx.new_page();p.on('dialog',lambda d:d.accept());p.on('pageerror',lambda e:r['pageErrors'].append({'type':type(e).__name__}))
  p.goto(url,wait_until='networkidle',timeout=45000);p.locator('#cloudUsername').fill(account['username']);p.locator('#cloudPassword').fill(account['password']);p.locator('#cloudLoginForm button').click();p.locator('#cloudRefresh').wait_for(timeout=45000)
  p.locator('details.header-tools > summary').click()
  with p.expect_navigation(wait_until='networkidle',timeout=45000):p.locator('#r23ModelChoice').select_option('tiny')
  p.locator('#cloudRefresh').wait_for(timeout=45000);r['authAutomaticallyRestored']=p.locator('#cloudLoginForm').count()==0
  p.locator('#cloudFreePractice').click();p.locator('#prepQuickText').click();p.wait_for_function("!document.querySelector('#startScene').disabled",timeout=15000);p.locator('#startScene').click();p.wait_for_function("document.body.classList.contains('room-live')")
  p.locator('#focusReview').click();p.locator('#liveToolText').click();p.locator('#liveTextAnswer').fill('公网定点诊断：自动恢复登录后的首次本机保存。');p.locator('#liveTextSave').click()
  p.wait_for_function("['saved','error'].includes(document.querySelector('#localSessionSaveStatus')?.dataset.status)",timeout=15000)
  state=p.locator('#localSessionSaveStatus');r['saveStatus']=state.get_attribute('data-status');text=state.inner_text();r['expectedCursorFailureShown']='尚未读取本机恢复版本' in text;r['displayedSaveMessage']=text
  r['indexedDB']=p.evaluate("async()=>({databases:(await indexedDB.databases()).map(x=>({name:x.name,version:x.version}))})")
  p.screenshot(path=str(out/'restored-login-first-save.png'),full_page=True,mask=[p.locator('.r2-identity-text,input[autocomplete=username],input[type=password]')])
  r['status']='REPRODUCED_PRODUCT_CHECKPOINT_INITIALIZATION_BUG' if r['saveStatus']=='error' and r['expectedCursorFailureShown'] else 'NOT_REPRODUCED';r['browser']=b.version;b.close()
except Exception as e:r['status']='DIAGNOSTIC_ERROR';r['error']={'type':type(e).__name__,'frames':[{'file':Path(x.filename).name,'line':x.lineno,'function':x.name} for x in traceback.extract_tb(e.__traceback__) if str(x.filename).startswith(str(ROOT))]}
(out/'result.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in r.items() if k!='indexedDB'},ensure_ascii=False,indent=2))
