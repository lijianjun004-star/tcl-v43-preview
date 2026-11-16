"""Real model cache test with already-loaded runtime; not full offline page startup."""
import functools,json,pathlib,threading,time
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
repo=pathlib.Path(__file__).resolve().parents[3];out=repo/'evidence/r24-delivery/audio';out.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(repo)));threading.Thread(target=server.serve_forever,daemon=True).start()
report={'status':'RUNNING','scope':'REAL Tiny fresh pipeline using browser model cache with runtime already imported; not offline page startup, not device/mainland'}
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  try:
   context=browser.new_context();page=context.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/experiments/r24/tcl-v352-asr-r24-qa/index.html')
   report['browser']=browser.version
   report['online']=page.evaluate('''async()=>{
    window.cacheBridge=await import('./whisper-bridge.mjs');window.cacheBlob=await(await fetch('/evidence/r24/zh-2.wav')).blob();
    const engine=cacheBridge.createLocalWhisper({modelPreset:'tiny',loadTimeoutMs:120000});
    const result=await engine(cacheBlob);
    const keys=await caches.keys();const cacheFiles=[];
    for(const key of keys){const c=await caches.open(key);cacheFiles.push({key,urls:(await c.keys()).map(r=>r.url)});}
    return {result,cacheFiles};
   }''')
   context.set_offline(True)
   report['offline_fresh_pipeline']=page.evaluate('''async()=>{
     const engine=cacheBridge.createLocalWhisper({modelPreset:'tiny',loadTimeoutMs:15000});
     return await engine(cacheBlob);
   }''')
   report['status']='PASS' if report['offline_fresh_pipeline']['text']==report['online']['result']['text'] else 'FAIL'
  finally:browser.close()
except Exception as e:report['status']='FAIL';report['error']=str(e)[:1800]
finally:
 server.shutdown();(out/'warm-model-cache.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))

if report["status"] != "PASS":
 raise SystemExit(1)
