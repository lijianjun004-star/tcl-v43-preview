"""Repeatable public-audio decoder and REAL Whisper check; never a device acceptance test.
Requires download_samples.py, ffmpeg and Chromium/Playwright. Downloads free model files.
"""
import functools, hashlib, json, pathlib, subprocess, threading, time, tempfile
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

repo=pathlib.Path(__file__).resolve().parents[3]
out=repo/'evidence/r24-delivery/audio';out.mkdir(parents=True,exist_ok=True)
temp_audio=tempfile.TemporaryDirectory(prefix='tcl-r24-audio-')
formats=pathlib.Path(temp_audio.name)
samples=json.loads((repo/'evidence/r24/samples.json').read_text())
for ext,args in [('m4a',['-ac','2','-ar','48000','-c:a','aac']),('webm',['-ac','2','-ar','48000','-c:a','libopus']),('wav',['-ac','2','-ar','44100','-c:a','pcm_s16le'])]:
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(repo/'evidence/r24/zh-1.wav'),*args,str(formats/('zh-1-stereo.'+ext))],check=True)
class Handler(SimpleHTTPRequestHandler):
 def translate_path(self,path):
  if path.startswith('/qa-audio/'):
   return str(formats/path.split('/')[-1])
  return super().translate_path(path)
 def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(repo)))
threading.Thread(target=server.serve_forever,daemon=True).start()
report={'scope':'REAL public Mandarin corpus playback; Linux Chromium, no microphone hardware or iPhone; no paid API','models':{},'decode':[],'status':'RUNNING'}
report['bridge_sha256']=hashlib.sha256((repo/'experiments/r24/tcl-v352-asr-r24-qa/whisper-bridge.mjs').read_bytes()).hexdigest()
report['sources']=[{**s,'sha256':hashlib.sha256((repo/'evidence/r24'/s['file']).read_bytes()).hexdigest()} for s in samples]
def save(): (out/'real-audio.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
def distance(a,b):
 row=list(range(len(b)+1))
 for i,x in enumerate(a,1):
  nxt=[i]
  for j,y in enumerate(b,1): nxt.append(min(nxt[-1]+1,row[j]+1,row[j-1]+(x!=y)))
  row=nxt
 return row[-1]
try:
 with sync_playwright() as p:
  for preset in ['base','tiny']:
   browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
   try:
    page=browser.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/experiments/r24/tcl-v352-asr-r24-qa/index.html')
    report['browser']=browser.version
    page.evaluate('''async preset=>{
      window.bridge=await import('./whisper-bridge.mjs');
      window.normalize=(await import('./asr-normalize.mjs')).toSimplified;
      window.events=[];window.progress=[];
      window.engine=bridge.createLocalWhisper({modelPreset:preset,loadTimeoutMs:120000,inferTimeoutMs:120000,onProgress:s=>progress.push(s),onDiagnostic:e=>events.push(e)});
    }''',preset)
    if preset=='base':
     for file in ['evidence/r24/zh-1.wav','qa-audio/zh-1-stereo.m4a','qa-audio/zh-1-stereo.webm','qa-audio/zh-1-stereo.wav']:
      item=page.evaluate('''async file=>{
       const blob=await(await fetch('/'+file)).blob();const a=await bridge.prepareAudio(blob);
       return {file,sampleRate:a.sampleRate,duration:a.duration,samples:a.data.length,rms:a.rms,bytes:blob.size,mime:blob.type};
      }''',file)
      item['status']='PASS' if item['sampleRate']==16000 and item['rms']>0.001 and abs(item['samples']/16000-item['duration'])<.001 else 'FAIL'
      report['decode'].append(item);save()
    model={'status':'RUNNING','samples':[]};report['models'][preset]=model;save()
    for sample in samples:
     started=time.monotonic();item=dict(sample)
     try:
      item['result']=page.evaluate('''async file=>{
       const blob=await(await fetch('/evidence/r24/'+file)).blob();const r=await engine(blob);
       return {...r,normalized:normalize(r.text).replace(/[\\s\\p{P}\\p{S}]/gu,'').toLowerCase()};
      }''',sample['file'])
      item['status']='PASS' if item['result']['text'].strip() else 'FAIL'
      ref=''.join(sample['reference'].split()).lower();item['reference_characters']=len(ref)
      item['character_errors']=distance(ref,item['result']['normalized']);item['cer']=item['character_errors']/len(ref)
     except Exception as e: item['status']='FAIL';item['error']=str(e)[:1800]
     item['seconds']=round(time.monotonic()-started,3);model['samples'].append(item);save()
     if item['status']=='FAIL':break
    model['diagnostics']=page.evaluate('window.events')
    model['progress_events']=page.evaluate('window.progress.length')
    model['status']='PASS' if len(model['samples'])==3 and all(s['status']=='PASS' for s in model['samples']) else 'FAIL'
    if model['status']=='PASS':
     model['aggregate_cer']=sum(s['character_errors'] for s in model['samples'])/sum(s['reference_characters'] for s in model['samples'])
     model['accuracy_acceptance']='NOT ACCEPTED: only three telephone-banking samples, no authorized TCL speech corpus'
    save()
   finally:browser.close()
 report['status']='PASS' if all(m['status']=='PASS' for m in report['models'].values()) and all(d['status']=='PASS' for d in report['decode']) else 'FAIL'
except Exception as e: report['status']='FAIL';report['error']=str(e)[:1800]
finally:
 server.shutdown();temp_audio.cleanup();save()
 print(json.dumps({'status':report['status'],'browser':report.get('browser'),'decode':report['decode'],'models':{k:{'status':v['status'],'aggregate_cer':v.get('aggregate_cer'),'samples':v['samples']} for k,v in report['models'].items()}},ensure_ascii=False,indent=2))

if report["status"] != "PASS":
 raise SystemExit(1)
