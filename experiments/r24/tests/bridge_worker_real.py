"""Pinned real Tiny + actual module Worker; synthetic PCM, no accuracy claim."""
import functools, hashlib, json, pathlib, threading, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

repo=pathlib.Path(__file__).resolve().parents[3]
src=repo/'experiments/r24/tcl-v352-asr-r24-qa'
out=repo/'evidence/r24-smooth-mobile/worker';out.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*_args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(repo)))
threading.Thread(target=server.serve_forever,daemon=True).start()
report={'scope':'REAL pinned Tiny model in actual module Worker; synthetic non-silent 1-second PCM. Checks runtime/inference only, no speech-accuracy or phone acceptance.',
        'hashes':{name:hashlib.sha256((src/name).read_bytes()).hexdigest() for name in ['whisper-bridge.mjs','whisper-worker.mjs']}}
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
        try:
            page=browser.new_page()
            page.goto(f'http://127.0.0.1:{server.server_port}/experiments/r24/tcl-v352-asr-r24-qa/index.html')
            report['browser']=browser.version;report['worker_urls']=[]
            page.on('worker',lambda worker:report['worker_urls'].append(worker.url))
            started=time.monotonic()
            report['result']=page.evaluate('''async()=>{
              const b=await import('./whisper-bridge.mjs'),events=[],progress=[];
              const engine=b.createLocalWhisper({modelPreset:'tiny',loadTimeoutMs:120000,inferTimeoutMs:120000,
                onProgress:s=>progress.push(s),onDiagnostic:e=>events.push(e)});
              const pcm=new Float32Array(16000);for(let i=0;i<pcm.length;i++)pcm[i]=.1*Math.sin(i*2*Math.PI*440/16000);
              let ticks=0;const timer=setInterval(()=>ticks++,20);
              try{const result=await engine.transcribePreparedAudio({data:pcm,sampleRate:16000,duration:1});
                return{result,events,progressCount:progress.length,ticks,busy:engine.isResourceBusy(),pcmLength:pcm.length};}
              finally{clearInterval(timer)}
            }''')
            report['seconds']=round(time.monotonic()-started,3)
            assert report['worker_urls'] and report['worker_urls'][0].endswith('/whisper-worker.mjs')
            assert report['result']['result']['model']=='onnx-community/whisper-tiny'
            assert report['result']['pcmLength']==16000 and not report['result']['busy']
            assert any(event['stage']=='inference-complete' for event in report['result']['events'])
            report['status']='PASS'
        finally: browser.close()
except Exception as error:
    report['status']='FAIL';report['error']=str(error)[:3000]
finally:
    server.shutdown()
    (out/'bridge-worker-real-tiny.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))
if report['status']!='PASS': raise SystemExit(1)
