"""Real Chromium layout/computed-style probe; synthetic rows and resized viewports, not physical iOS keyboard tests."""
from pathlib import Path
import functools, hashlib, json, os, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3]
SITE=ROOT/'experiments/r24/tcl-v352-asr-r24-qa'
OUT=Path(os.environ.get('MOBILE_OUT',str(Path(__file__).parent/'before')));OUT.mkdir(parents=True,exist_ok=True)
class Q(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Q,directory=str(SITE.parent)));threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/{SITE.name}/'
sha=lambda f:hashlib.sha256((SITE/f).read_bytes()).hexdigest()
report={'mode':__doc__,'style_sha256':sha('style.css'),'index_sha256':sha('index.html'),'app_sha256':sha('app.js'),'observations':[],'errors':[]}
SNAP='''()=>{const seen=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'; const controls=[...document.querySelectorAll('input,select,textarea,[contenteditable=true]')].filter(seen).map(e=>({id:e.id||e.getAttribute('aria-label')||e.tagName,font:parseFloat(getComputedStyle(e).fontSize),width:e.getBoundingClientRect().width,touchAction:getComputedStyle(e).touchAction}));const outside=[...document.querySelectorAll('#view *')].filter(seen).filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1||r.left< -1}).slice(0,12).map(e=>({tag:e.tagName,id:e.id,cls:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width}));return {innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,scale:visualViewport?.scale,controls,outside,blurLayers:[...document.querySelectorAll('*')].filter(seen).filter(e=>!['none',''].includes(getComputedStyle(e).backdropFilter)).map(e=>({id:e.id,cls:e.className,blur:getComputedStyle(e).backdropFilter})),tapAction:getComputedStyle(document.body).touchAction}}'''
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  def login(page,role):
   page.locator(f'[data-role-pick="{role}"]').click();page.locator('#simpleName').fill('人工布局检查');record(page,'login');page.locator('#simpleLogin').click();page.wait_for_timeout(100)
  def record(page,label):
   row=page.evaluate(SNAP);row['page']=label;row['configured_width']=width;report['observations'].append(row);return row
  def nav(page,label):
   page.evaluate('(name)=>document.querySelector(`[data-page="${name}"]`).click()',label);page.wait_for_timeout(50);return record(page,label)
  for width in [320,390,768,1024]:
   ctx=browser.new_context(viewport={'width':width,'height':844},is_mobile=True,has_touch=True);page=ctx.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)));page.goto(url);login(page,'operator');record(page,'operator-home')
   for label in ['library','import','settings','legacy']:nav(page,label)
   nav(page,'import');page.locator('#fileInput').set_input_files({'name':'synthetic-layout.csv','mimeType':'text/csv','buffer':('型号,SKU,品类,平台,来源,问题,优秀回答\n人工型号-A,人工SKU-A,TCL 电视,京东,https://example.invalid/'+'longsource'*30+',这款电视的接口如何核对？,人工回答仅用于布局测试\n').encode()});page.locator('#parseFile').click();page.wait_for_function("!document.querySelector('#saveImport').disabled");record(page,'import-long-source');page.locator('#saveImport').click();page.wait_for_function("document.body.dataset.page==='review'");record(page,'review-model')
   nav(page,'home');page.locator('.header-tools').evaluate('e=>e.open=true');record(page,'header-tools');page.locator('.header-tools').evaluate('e=>e.open=false');ctx.close()
   ctx=browser.new_context(viewport={'width':width,'height':844},is_mobile=True,has_touch=True);page=ctx.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)));page.goto(url);login(page,'anchor');page.locator('#freePractice').click();page.locator('#prepQuickText').click();page.locator('#prepMore').click();record(page,'prep-tools');page.locator('#prepMoreClose').click();page.locator('#startScene').click();page.wait_for_function("document.body.classList.contains('room-live')");record(page,'live');page.locator('#focusReview').click();page.locator('#liveToolText').click();page.locator('#liveTextAnswer').fill('人工布局回答');record(page,'live-text');page.set_viewport_size({'width':width,'height':460});record(page,'live-text-small-height');page.set_viewport_size({'width':width,'height':844});page.locator('#liveTextSave').click();page.locator('#focusClose').click();page.locator('#tclEndYes').click();page.locator('#reviewDetails').click();record(page,'review-answer');
   if width==390:page.screenshot(path=str(OUT/'review.png'),full_page=True)
   ctx.close()
  report['browser']=browser.version;browser.close()
finally:
 server.shutdown();report['style_sha256_after']=sha('style.css');report['style_unchanged']=report['style_sha256']==report['style_sha256_after'];report['small_controls']=[{'page':x['page'],'width':x['innerWidth'],'controls':[c for c in x['controls'] if c['font']<16]} for x in report['observations'] if any(c['font']<16 for c in x['controls'])];report['page_overflow']=[{'page':x['page'],'width':x['innerWidth'],'scroll':x['scrollWidth'],'outside':x['outside']} for x in report['observations'] if x['scrollWidth']>x['clientWidth']+1];(OUT/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['style_unchanged','small_controls','page_overflow','errors']},ensure_ascii=False,indent=2))
if os.environ.get('MOBILE_EXPECT_STABLE'):
 assert report['style_unchanged'] and not report['errors'] and not report['small_controls'] and not report['page_overflow']
 assert all(x['innerWidth']==x['configured_width'] and x['scale']==1 for x in report['observations'])
 assert all(c['touchAction']=='manipulation' for x in report['observations'] for c in x['controls'])
 assert all(not x['blurLayers'] for x in report['observations'] if x['page']=='live')
