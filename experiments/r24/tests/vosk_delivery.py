"""REAL Vosk fallback: extract unchanged loader/recognizer functions from app.js.
Public PolyAI telephone audio only. No fake Vosk worker, no paid API, no device claim.
"""
import functools, hashlib, json, pathlib, threading, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
repo=pathlib.Path(__file__).resolve().parents[3]
out=repo/'evidence/r24-delivery/audio';out.mkdir(parents=True,exist_ok=True)
app=(repo/'experiments/r24/tcl-v352-asr-r24-qa/app.js').read_text()
loader=app.split('// VOSK_LOADER_BEGIN',1)[1].split('// VOSK_LOADER_END',1)[0]
bounded=app.split('async function awaitBounded(',1)[1].split('async function decodeAudioCopy(',1)[0]
code='async function awaitBounded('+bounded+'\n'+loader+'\nwindow.qaVosk={loadVerifiedVosk,recognizeVosk};'
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(repo)))
threading.Thread(target=server.serve_forever,daemon=True).start()
report={'status':'RUNNING','scope':'REAL loader/hash verification/worker/model inference on public Mandarin; extracted actual functions, not full UI or actual phone','loader_sha256':hashlib.sha256(loader.encode()).hexdigest(),'progress':[],'samples':[]}
def save(): (out/'real-vosk.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  try:
   page=browser.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/experiments/r24/tcl-v352-asr-r24-qa/index.html')
   report['browser']=browser.version
   page.add_script_tag(content='(()=>{'+code+'})();')
   started=time.monotonic()
   report['load']=page.evaluate('''async()=>{
     window.qaProgress=[];
     window.qaModel=await qaVosk.loadVerifiedVosk(()=>true,e=>qaProgress.push(e));
     return {ready:!!qaModel.KaldiRecognizer,progress:qaProgress};
   }''')
   report['load_seconds']=round(time.monotonic()-started,3);save()
   for sample in json.loads((repo/'evidence/r24/samples.json').read_text()):
    started=time.monotonic();item=dict(sample)
    try:
     item['result']=page.evaluate('''async file=>{
       const {prepareAudio}=await import('./whisper-bridge.mjs');
       const a=await prepareAudio(await(await fetch('/evidence/r24/'+file)).blob());
       return await qaVosk.recognizeVosk(qaModel,a.data);
     }''',sample['file'])
     item['status']='PASS' if item['result']['text'] else 'FAIL'
    except Exception as e:item['status']='FAIL';item['error']=str(e)[:1800]
    item['seconds']=round(time.monotonic()-started,3);report['samples'].append(item);save()
    if item['status']=='FAIL':break
   report['status']='PASS' if len(report['samples'])==3 and all(s['status']=='PASS' for s in report['samples']) else 'FAIL'
  finally:browser.close()
except Exception as e:report['status']='FAIL';report['error']=str(e)[:1800]
finally:server.shutdown();save();print(json.dumps(report,ensure_ascii=False,indent=2))

if report["status"] != "PASS":
 raise SystemExit(1)
