"""Synthetic one-turn checkpoints; unmodified baseline/candidate app bytes; actual reload and native IndexedDB."""
from pathlib import Path
import ast,hashlib,json,subprocess,threading,traceback
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3];SITE=ROOT/'experiments/r24/tcl-v352-asr-r24-qa';OUT=Path(__file__).parent/'reload-beforeunload';OUT.mkdir(exist_ok=True)
DB='tcl-specialty-v352-asr-r24-qa'
tree=ast.parse((ROOT/'experiments/r24/tests/performance.py').read_text())
FIXTURE=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FIXTURE' for t in n.targets))
versions={'baseline':subprocess.check_output(['git','show','3672708:experiments/r24/tcl-v352-asr-r24-qa/app.js'],cwd=ROOT),'candidate':(SITE/'app.js').read_bytes()}
active=b''
class Q(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(SITE),**kw)
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.split('?')[0]=='/app.js':
   self.send_response(200);self.send_header('Content-Type','application/javascript');self.end_headers();self.wfile.write(active)
  else:super().do_GET()
s=ThreadingHTTPServer(('127.0.0.1',0),Q);threading.Thread(target=s.serve_forever,daemon=True).start();url=f'http://127.0.0.1:{s.server_port}/'
r={'mode':__doc__,'app_sha256':{k:hashlib.sha256(v).hexdigest() for k,v in versions.items()},'samples':[],'errors':[]}
read="""async({name,dbName})=>{const db=await new Promise(r=>{const q=indexedDB.open(dbName);q.onsuccess=()=>r(q.result)});try{return await new Promise(r=>{const q=db.transaction('prefs').objectStore('prefs').get('draft-session:'+encodeURIComponent(name));q.onsuccess=()=>r(q.result)})}finally{db.close()}}"""
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);r['browser']=b.version
  for label,active in versions.items():
   for delay in [0,50]:
    for repeat in range(3):
     c=b.new_context();p=c.new_page();p.on('pageerror',lambda e:r['errors'].append(str(e)));p.goto(url);p.locator('[data-role-pick="anchor"]').wait_for();name=f'人工刷新复核-{label}-{delay}-{repeat}';args={'name':name,'n':1,'dbName':DB};p.evaluate(FIXTURE,args);p.reload();p.locator('[data-role-pick="anchor"]').click();p.locator('#simpleName').fill(name);p.locator('#simpleLogin').click();p.locator('#restoreLocalSession').click();p.locator('#reviewReplay').click();p.locator('#reviewToolsFold > summary').click()
     before=p.evaluate(read,args)['snapshot'].get('postTranscript','');expected='刷新前末字庚-'+str(delay)+'-'+str(repeat)
     p.evaluate("""({expected,delay})=>{const t=document.querySelector('#postTranscript');t.value=expected;t.dispatchEvent(new Event('input',{bubbles:true}));if(delay) setTimeout(()=>location.reload(),delay);else location.reload()}""",{'expected':expected,'delay':delay})
     p.wait_for_url(url);p.locator('[data-role-pick="anchor"]').wait_for();after=p.evaluate(read,args)['snapshot'].get('postTranscript','');r['samples'].append({'version':label,'delay_ms':delay,'repeat':repeat,'before':before,'expected':expected,'after':after,'pass':after==expected});c.close()
  b.close()
except Exception as e:r['exception']=str(e);r['traceback']=traceback.format_exc()
finally:
 s.shutdown();(OUT/'result.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps(r,ensure_ascii=False,indent=2))
