from pathlib import Path
import json,hashlib,urllib.request,urllib.parse,concurrent.futures,time,traceback,os
from playwright.sync_api import sync_playwright
repo=Path(__file__).resolve().parents[3];out=repo/'evidence/r24-delivery/public';out.mkdir(exist_ok=True)
base='https://lijianjun004-star.github.io/tcl-v43-preview/'
expected=json.loads((repo/'evidence/r24-delivery/release/final-pages-sha256.json').read_text())
if 'files' in expected:expected=expected['files']
def fetch(kv):
 name,digest=kv
 if isinstance(digest,dict):digest=digest['sha256']
 url=base+urllib.parse.quote(name,safe='/')+'?r24=b086a0c5'
 try:
  with urllib.request.urlopen(url,timeout=40) as r:data=r.read();status=r.status
  actual=hashlib.sha256(data).hexdigest();return {'path':name,'status':status,'sha256':actual,'matches':actual==digest}
 except Exception as e:return {'path':name,'error':str(e),'matches':False}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:rows=list(pool.map(fetch,expected.items()))
report={'scope':'Public GitHub Pages HTTP hashes plus real Chromium text workflow, native IndexedDB. No microphone mocks, no ASR/model request, no physical phone.','http':rows,'errors':[],'ok':all(r['matches'] for r in rows)}
try:
 assert report['ok'],[r for r in rows if not r['matches']]
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  context=browser.new_context(viewport={'width':390,'height':844})
  page=context.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
  requests=[];page.on('request',lambda r:requests.append(r.url))
  def login():
   page.locator('[data-role-pick="anchor"]').click();page.locator('#simpleName').fill('交付公网文字验证');page.locator('#simpleLogin').click()
  page.goto(base+'tcl-v352-asr-r24-qa/',wait_until='networkidle',timeout=40000);report['title']=page.title();login()
  page.locator('#freePractice').click();page.locator('#prepQuickText').click();page.locator('#startScene').click();page.wait_for_function("document.body.classList.contains('room-live')")
  page.locator('#focusReview').click();page.locator('#liveToolText').click();page.locator('#liveTextAnswer').fill('公网真实页面文字练播：请核对官方参数。');page.locator('#liveTextSave').click();page.locator('#focusClose').click();page.locator('#tclEndYes').click();page.wait_for_selector('#reviewDetails');page.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='saved'",timeout=15000)
  page.reload();login();page.locator('#restoreLocalSession').click();page.locator('#reviewDetails').click();assert '公网真实页面文字练播' in page.locator('#questionSummary').inner_text();assert page.locator('audio').count()==0
  report['text_workflow_reload']='PASS';report['browser']=browser.version;report['external_requests']=[u for u in requests if not u.startswith(base)];report['no_model_requests']=not any('huggingface' in u or 'vosk' in u or 'hf-mirror' in u for u in requests)
  page.screenshot(path=str(out/'text-restored.png'),full_page=True);browser.close()
 report['ok']=report['ok'] and not report['errors'] and report['no_model_requests']
except Exception as e:report['ok']=False;report['exception']=str(e);report['traceback']=traceback.format_exc()[-2000:]
(out/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='http'},ensure_ascii=False,indent=2));print('HTTP matched',sum(r['matches'] for r in rows),'/',len(rows))
if not report['ok']:raise SystemExit(2)
