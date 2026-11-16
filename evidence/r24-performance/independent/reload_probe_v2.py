"""Synthetic checkpoints (turn count and CPU rate are recorded); unchanged app bytes; actual reload and native IndexedDB."""
from pathlib import Path
import ast,hashlib,json,os,subprocess,threading,traceback
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3];SITE=ROOT/'experiments/r24/tcl-v352-asr-r24-qa';OUT=Path(os.environ.get('R24_RELOAD_OUT',str(Path(__file__).parent/'reload')));OUT.mkdir(parents=True,exist_ok=True)
DB='tcl-specialty-v352-asr-r24-qa'
tree=ast.parse((ROOT/'experiments/r24/tests/performance.py').read_text())
FIXTURE=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FIXTURE' for t in n.targets))
baseline_ref=os.environ.get('R24_RELOAD_BASELINE_REF','d82e0ad')
versions={'baseline':subprocess.check_output(['git','show',baseline_ref+':experiments/r24/tcl-v352-asr-r24-qa/app.js'],cwd=ROOT),'candidate':(SITE/'app.js').read_bytes()}
versions={k:v for k,v in versions.items() if k in os.environ.get('R24_RELOAD_VERSIONS','baseline,candidate').split(',')}
turns=int(os.environ.get('R24_RELOAD_TURNS','1'));rate=float(os.environ.get('R24_RELOAD_RATE','1'));input_mode=os.environ.get('R24_RELOAD_INPUT','single');delays=[int(x) for x in os.environ.get('R24_RELOAD_DELAYS','0,50').split(',')]
active=b''
class Q(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(SITE),**kw)
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.split('?')[0]=='/app.js':
   self.send_response(200);self.send_header('Content-Type','application/javascript');self.end_headers();self.wfile.write(active)
  else:super().do_GET()
s=ThreadingHTTPServer(('127.0.0.1',0),Q);threading.Thread(target=s.serve_forever,daemon=True).start();url=f'http://127.0.0.1:{s.server_port}/'
r={'mode':__doc__,'baseline_ref':baseline_ref,'app_sha256':{k:hashlib.sha256(v).hexdigest() for k,v in versions.items()},'turns':turns,'cpu_rate':rate,'input_mode':input_mode,'samples':[],'errors':[]}
read="""async({name,dbName})=>{const db=await new Promise(r=>{const q=indexedDB.open(dbName);q.onsuccess=()=>r(q.result)});try{return await new Promise(r=>{const q=db.transaction('prefs').objectStore('prefs').get('draft-session:'+encodeURIComponent(name));q.onsuccess=()=>r(q.result)})}finally{db.close()}}"""
try:
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);r['browser']=b.version
  for label,active in versions.items():
   for delay in delays:
    for repeat in range(3):
     c=b.new_context();p=c.new_page();c.new_cdp_session(p).send('Emulation.setCPUThrottlingRate',{'rate':rate});p.on('pageerror',lambda e:r['errors'].append(str(e)));p.goto(url);p.locator('[data-role-pick="anchor"]').wait_for();name=f'人工刷新复核-{label}-{delay}-{repeat}';args={'name':name,'n':turns,'dbName':DB};p.evaluate(FIXTURE,args);p.reload();p.locator('[data-role-pick="anchor"]').click();p.locator('#simpleName').fill(name);p.locator('#simpleLogin').click();p.locator('#restoreLocalSession').click();p.locator('#reviewReplay').click();p.locator('#reviewToolsFold > summary').click()
     before=p.evaluate(read,args)['snapshot'].get('postTranscript','');expected='刷新前末字庚-'+str(delay)+'-'+str(repeat)
     if input_mode=='keyboard':
      p.evaluate("""({expected,delay})=>{const t=document.querySelector('#postTranscript'),events=[];t.addEventListener('input',e=>{events.push({trusted:e.isTrusted,value:t.value});if(t.value===expected){sessionStorage.setItem('__reload_events',JSON.stringify(events));if(delay)setTimeout(()=>location.reload(),delay);else location.reload()}})}""",{'expected':expected,'delay':delay});p.locator('#postTranscript').press_sequentially(expected,delay=0)
     else:
      p.evaluate("""({expected,delay})=>{const t=document.querySelector('#postTranscript');t.value=expected;t.dispatchEvent(new Event('input',{bubbles:true}));if(delay) setTimeout(()=>location.reload(),delay);else location.reload()}""",{'expected':expected,'delay':delay})
     p.wait_for_url(url);p.locator('[data-role-pick="anchor"]').wait_for();after=p.evaluate(read,args)['snapshot'].get('postTranscript','');r['samples'].append({'version':label,'delay_ms':delay,'repeat':repeat,'before':before,'expected':expected,'after':after,'pass':after==expected,'events':p.evaluate("JSON.parse(sessionStorage.getItem('__reload_events')||'[]')")});c.close()
  b.close()
except Exception as e:r['exception']=str(e);r['traceback']=traceback.format_exc()
finally:
 s.shutdown();r['status']='PASS' if not r.get('exception') and not r['errors'] and r['samples'] and all(x['pass'] for x in r['samples']) else 'FAIL';(OUT/'result.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps(r,ensure_ascii=False,indent=2))
