"""One bounded Tiny compatibility run, scratch candidate only; public existing audio.
Existing forced-mirror mode prevents retries on a second model host. No model API.
"""
from pathlib import Path
import functools,hashlib,json,shutil,threading,time,traceback
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

REPO=Path(__file__).resolve().parents[3]
OUT=Path(__file__).resolve().parent
FIX=Path('/workspace/scratch/r24-whisper-proxy-candidate')
FIX.mkdir(parents=True,exist_ok=True)
source=REPO/'experiments/r24/tcl-v352-asr-r24-qa/whisper-bridge.mjs'
original=source.read_text()
assert original.count('const { pipeline, env } = mod;')==1
candidate=original.replace('const { pipeline, env } = mod;','const { pipeline, env } = mod;\n      if (env?.backends?.onnx?.wasm) env.backends.onnx.wasm.proxy = true;')
(FIX/'whisper-bridge.mjs').write_text(candidate)
(FIX/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Whisper proxy candidate probe</title><p>Public audio QA, scratch candidate.</p>')
baseline=json.loads((REPO/'evidence/r24/real-model.json').read_text())
samples=json.loads((REPO/'evidence/r24/samples.json').read_text())
for row in samples:
 src=Path('/workspace/scratch/r24-audio-samples')/row['file'];assert src.is_file()
 shutil.copyfile(src,FIX/row['file']);row['input_sha256']=hashlib.sha256(src.read_bytes()).hexdigest()

class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(FIX)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}/'
report={'status':'RUNNING','scope':'Actual desktop Chromium, fixed Tiny revision, existing 3 public PolyAI Mandarin telephone samples, scratch bridge candidate enabling WASM proxy. Not physical phone or TCL business accuracy.','source_bridge_sha256':hashlib.sha256(original.encode()).hexdigest(),'candidate_bridge_sha256':hashlib.sha256(candidate.encode()).hexdigest(),'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'model':'onnx-community/whisper-tiny','revision':'ff4177021cc41f7db950912b73ea4fdf7d01d8e7','single_model_host':'https://hf-mirror.com/','forced_mirror_prevents_second_host_retry':True,'samples':[],'workers':[],'requests':[],'response_errors':[],'request_errors':[],'page_errors':[]}
def save(): (OUT/'whisper-proxy-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
save()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  ctx=browser.new_context();page=ctx.new_page();page.set_default_timeout(110000)
  page.on('worker',lambda w:report['workers'].append(w.url))
  page.on('request',lambda r:report['requests'].append(r.url.split('?')[0]))
  page.on('response',lambda r:report['response_errors'].append({'url':r.url.split('?')[0],'status':r.status}) if r.status>=400 else None)
  page.on('requestfailed',lambda r:report['request_errors'].append({'url':r.url.split('?')[0],'failure':r.failure}))
  page.on('pageerror',lambda e:report['page_errors'].append(str(e)))
  page.goto(base,wait_until='load');report['browser']=browser.version
  page.evaluate('''async()=>{
    window.__WHISPER_FORCE_MIRROR=true;
    const {createLocalWhisper}=await import('./whisper-bridge.mjs');
    window.probeEvents=[];window.probeProgress=[];
    window.probeEngine=createLocalWhisper({modelPreset:'tiny',loadTimeoutMs:90000,inferTimeoutMs:45000,onDiagnostic:e=>probeEvents.push({...e,time:performance.now()}),onProgress:p=>probeProgress.push({text:p,time:performance.now()})});
  }''')
  for sample in samples:
   item=dict(sample);report['samples'].append(item);started=time.monotonic();save()
   try:
    item['probe']=page.evaluate('''async filename=>{
      const blob=await(await fetch(filename)).blob();
      let ticks=[],tasks=[];const start=performance.now();
      const po=new PerformanceObserver(list=>tasks.push(...list.getEntries().filter(e=>e.startTime>=start).map(e=>({start:e.startTime,duration:e.duration}))));po.observe({type:'longtask'});
      const timer=setInterval(()=>ticks.push(performance.now()),20);
      try {
        const result=await probeEngine(blob);
        const end=performance.now();await new Promise(r=>setTimeout(r,60));
        const relevant=probeEvents.filter(e=>e.time>=start&&e.time<=end);
        const ready=relevant.find(e=>e.stage==='model-ready')?.time||start;
        const inferTicks=ticks.filter(t=>t>=ready&&t<=end);
        const gaps=[ready,...inferTicks,end].slice(1).map((v,i)=>v-[ready,...inferTicks,end][i]);
        const mod=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
        return {result,ms:end-start,modelReadyAt:ready,start,end,inferenceHeartbeatCount:inferTicks.length,maxInferenceHeartbeatGapMs:Math.max(0,...gaps),longTasks:tasks,events:relevant,envProxy:mod.env.backends.onnx.wasm.proxy,crossOriginIsolated};
      } finally {clearInterval(timer);po.disconnect();}
    }''',sample['file'])
    old=next(x for x in baseline['samples'] if x['file']==sample['file'])
    item['baseline_text']=old['result']['text'];item['text_identical_to_historical_tiny']=item['probe']['result']['text']==old['result']['text']
    item['status']='PASS' if item['probe']['result']['text'].strip() and item['probe']['envProxy'] else 'FAIL'
   except Exception as error:
    item['status']='FAIL';item['error']=str(error);item['traceback']=traceback.format_exc()[-1600:]
   item['seconds']=round(time.monotonic()-started,3);save()
   if item['status']!='PASS' or report['response_errors'] or report['request_errors']:break
  report['progress']=page.evaluate('window.probeProgress')
  report['all_events']=page.evaluate('window.probeEvents')
  ctx.close();browser.close()
 report['status']='PASS' if len(report['samples'])==3 and all(x['status']=='PASS' for x in report['samples']) and report['workers'] and not report['page_errors'] and not report['response_errors'] and not report['request_errors'] else 'FAIL'
except Exception as error:
 report.update(status='FAIL',error=str(error),traceback=traceback.format_exc()[-1600:])
finally:
 server.shutdown();save();print(json.dumps({k:v for k,v in report.items() if k not in ['progress','requests']},ensure_ascii=False,indent=2))
if report['status']!='PASS':raise SystemExit(1)
