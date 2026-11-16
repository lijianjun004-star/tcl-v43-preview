#!/usr/bin/env python3
"""Synthetic long-session workload in actual mobile Chromium; no physical phone/model accuracy claim."""
import os,json,pathlib,threading,time,hashlib,traceback
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
SITE=pathlib.Path(os.environ.get('SMOOTH_SITE',str(ROOT)))
OUT=pathlib.Path(os.environ.get('SMOOTH_OUT',str(ROOT.parents[1]/'evidence/r24-smooth-mobile/browser')));OUT.mkdir(parents=True,exist_ok=True)
APP=SITE/'tcl-v352-asr-r24-qa/app.js'
PROBE='''\nwindow.__smoothProbe={stress(){for(let i=0;i<59;i++)nextQuestion();let count=0;const el=ELEM('questionSummary'),replace=el.replaceChildren.bind(el);el.replaceChildren=(...a)=>{count++;return replace(...a)};const start=performance.now();for(let i=0;i<80;i++){sessionTurns[0].asrStatus='模型下载进度 '+i;renderTurnStatus(sessionTurns[0]);}const elapsed=performance.now()-start;el.replaceChildren=replace;return {turns:sessionTurns.length,hiddenSummaryRebuilds:count,elapsedMs:elapsed};}};'''
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(SITE),**kw)
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.split('?')[0].endswith('/app.js'):
   data=(APP.read_text()+PROBE).encode();self.send_response(200);self.send_header('Content-Type','text/javascript');self.end_headers();self.wfile.write(data);return
  super().do_GET()
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
report={'mode':'Chromium touch/mobile emulation; 4x CPU slowdown; synthetic 60-question/80-progress stress','app_sha256':hashlib.sha256(APP.read_bytes()).hexdigest(),'checks':{},'errors':[]}
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  for width,height in [(320,568),(390,844),(430,932)]:
   ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=True,has_touch=True,device_scale_factor=2)
   page=ctx.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
   page.goto(f'http://127.0.0.1:{server.server_port}/tcl-v352-asr-r24-qa/');page.locator('[data-role-pick="anchor"]').click();page.locator('#simpleName').fill('流畅性验收');page.locator('#simpleLogin').click();page.locator('#freePractice').click();page.locator('#prepQuickText').click();page.locator('#startScene').click();page.wait_for_selector('#focusNext')
   cdp=ctx.new_cdp_session(page);cdp.send('Emulation.setCPUThrottlingRate',{'rate':4})
   result=page.evaluate('()=>window.__smoothProbe.stress()')
   page.locator('#focusReview').click();page.locator('#liveToolText').click();page.locator('#liveTextAnswer').fill('流畅性测试人工回答')
   result['liveInputFont']=page.locator('#liveTextAnswer').evaluate('(e)=>getComputedStyle(e).fontSize')
   result['viewport']=page.evaluate('()=>({scale:visualViewport.scale,width:innerWidth,scroll:document.documentElement.scrollWidth})')
   page.locator('#liveTextSave').click();page.locator('#focusClose').click();page.locator('#tclEndYes').click();page.wait_for_selector('#reviewDetails');page.locator('#reviewDetails').click()
   result['reviewInputFont']=page.locator('textarea[aria-label="编辑本题回答"]').first.evaluate('(e)=>getComputedStyle(e).fontSize')
   result['rows']=page.locator('#questionSummary tbody tr').count()
   page.screenshot(path=str(OUT/f'{width}-review.png'))
   result['pass']=result['hiddenSummaryRebuilds']==0 and result['liveInputFont']=='16px' and result['reviewInputFont']=='16px' and result['viewport']['scale']==1 and result['viewport']['scroll']<=width and result['rows']==60
   report['checks'][str(width)]=result;ctx.close()
  browser.close()
 report['ok']=all(x['pass'] for x in report['checks'].values()) and not report['errors']
except Exception as e:report.update(ok=False,exception=str(e),traceback=traceback.format_exc())
finally:
 server.shutdown();(OUT/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
if not report['ok']:raise SystemExit(1)
