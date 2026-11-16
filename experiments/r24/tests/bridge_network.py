"""Actual bridge with intercepted Transformers module, no real model/network request."""
import functools,json,pathlib,threading
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
repo=pathlib.Path(__file__).resolve().parents[3];out=repo/'evidence/r24-delivery/audio';out.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(repo)));threading.Thread(target=server.serve_forever,daemon=True).start()
module="""export const env={remoteHost:''};export async function pipeline(task,model,options){
 globalThis.qaCalls.push({host:env.remoteHost,model,revision:options.revision});
 if(globalThis.qaMode==='forced-failure'||globalThis.qaCalls.length===1)throw Error('mock source unavailable');
 return async()=>({text:'网络路径模拟'});
}"""
report={'mode':'MOCK Transformers module; actual bridge URL/source/options behavior only','cases':[]}
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  try:
   for mode in ['fallback','forced-failure']:
    context=browser.new_context();page=context.new_page()
    page.route('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1',lambda r:r.fulfill(status=200,content_type='text/javascript',body=module,headers={'access-control-allow-origin':'*'}))
    page.goto(f'http://127.0.0.1:{server.server_port}/experiments/r24/tcl-v352-asr-r24-qa/index.html')
    result=page.evaluate('''async mode=>{
      window.qaMode=mode;window.qaCalls=[];window.__WHISPER_FORCE_MIRROR=mode==='forced-failure';
      const b=await import('./whisper-bridge.mjs');const engine=b.createLocalWhisper({modelPreset:'base'});
      try{return {mode,result:await engine.transcribePreparedAudio({data:new Float32Array(16000).fill(.1),sampleRate:16000,duration:1}),calls:qaCalls};}
      catch(e){return {mode,error:String(e),calls:qaCalls};}
    }''',mode)
    if mode=='fallback':
     assert [x['host'] for x in result['calls']]==['https://huggingface.co/','https://hf-mirror.com/']
     assert result['result']['text']=='网络路径模拟'
    else:
     assert len(result['calls'])==1 and result['calls'][0]['host']=='https://hf-mirror.com/'
     assert 'unavailable' in result['error']
    assert all(x['revision']=='27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c' for x in result['calls'])
    result['status']='PASS';report['cases'].append(result);context.close()
  finally:browser.close()
 report['status']='PASS'
except Exception as e:report['status']='FAIL';report['error']=str(e)[:1800]
finally:server.shutdown();(out/'bridge-network.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))

if report["status"] != "PASS":
 raise SystemExit(1)
