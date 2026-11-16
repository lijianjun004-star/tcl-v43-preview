"""Real module Worker/bridge with an intercepted model; no real ASR accuracy claim."""
import functools, hashlib, json, pathlib, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

repo = pathlib.Path(__file__).resolve().parents[3]
source = repo / 'experiments/r24/tcl-v352-asr-r24-qa'
out = repo / 'evidence/r24-smooth-mobile/worker'
out.mkdir(parents=True, exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(repo)))
threading.Thread(target=server.serve_forever, daemon=True).start()
mock = '''export const env = {remoteHost:''};
const calls=[];let active=0,maxActive=0;
export async function pipeline(task,model,options){
  calls.push({host:env.remoteHost,model,revision:options.revision,device:options.device,dtype:options.dtype});
  options.progress_callback({status:'progress',loaded:12,total:24,progress:50});
  if (FAIL_ALL || env.remoteHost==='https://huggingface.co/') throw Error('mock source unavailable');
  return async(data,params)=>{
    active++;maxActive=Math.max(maxActive,active);
    const started=performance.now();while(performance.now()-started<250){}
    active--;
    return {text:JSON.stringify({calls,inWorker:typeof WorkerGlobalScope!=='undefined' && self instanceof WorkerGlobalScope,
      samples:data.length,params,maxActive})};
  };
}'''
report = {'scope':'Actual module Worker + current bridge, intercepted Transformers/model; busy-loop inference measures page responsiveness only, not real model performance or handset acceptance',
          'hashes': {name:hashlib.sha256((source/name).read_bytes()).hexdigest() for name in ['whisper-bridge.mjs','whisper-worker.mjs']}, 'cases':[]}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage'])
        try:
            for mode in ['base-fallback','tiny-forced-mirror','forced-mirror-failure','worker-unavailable','worker-script-failure']:
                context = browser.new_context()
                body = mock.replace('FAIL_ALL', 'true' if mode=='forced-mirror-failure' else 'false')
                context.route('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1', lambda route, _request, body=body: route.fulfill(status=200,content_type='text/javascript',body=body,headers={'access-control-allow-origin':'*'}))
                if mode=='worker-script-failure':
                    context.route('**/whisper-worker.mjs', lambda route: route.abort())
                page=context.new_page()
                page.goto(f'http://127.0.0.1:{server.server_port}/experiments/r24/tcl-v352-asr-r24-qa/index.html')
                result=page.evaluate('''async mode=>{
                  const b=await import('./whisper-bridge.mjs');
                  const notes=[],events=[];
                  if(mode==='worker-unavailable')globalThis.Worker=undefined;
                  globalThis.__WHISPER_FORCE_MIRROR=mode.includes('forced-mirror');
                  const engine=b.createLocalWhisper({modelPreset:mode.startsWith('tiny')?'tiny':'base',loadTimeoutMs:2000,
                    onProgress:note=>notes.push(note),onDiagnostic:event=>events.push(event)});
                  let ticks=0;const timer=setInterval(()=>ticks++,10);
                  const prepared=()=>({data:new Float32Array(16000).fill(.1),duration:1,sampleRate:16000});
                  try{
                    const audio=prepared();
                    const results=await Promise.all([engine.transcribePreparedAudio(audio),engine.transcribePreparedAudio(prepared())]);
                    return {mode,results:results.map(result=>JSON.parse(result.text)),ticks,notes,events,pcmLength:audio.data.length,busy:engine.isResourceBusy()};
                  }catch(error){return {mode,error:String(error),notes,events,busy:engine.isResourceBusy()};}
                  finally{clearInterval(timer);}
                }''',mode)
                if mode in ['base-fallback','tiny-forced-mirror']:
                    assert result['pcmLength']==16000 and not result['busy']
                    assert result['ticks']>=5, result
                    assert any('12/24' in note and '50%' in note for note in result['notes'])
                    for observed in result['results']:
                        assert observed['inWorker'] and observed['maxActive']==1 and observed['samples']==16000
                        assert observed['params']=={'language':'chinese','task':'transcribe','chunk_length_s':30,'stride_length_s':5}
                        calls=observed['calls']
                        expected_hosts=['https://huggingface.co/','https://hf-mirror.com/'] if mode=='base-fallback' else ['https://hf-mirror.com/']
                        assert [call['host'] for call in calls]==expected_hosts
                        for call in calls:
                            assert call['model']=='onnx-community/whisper-'+('tiny' if mode.startswith('tiny') else 'base')
                            assert call['revision']==('ff4177021cc41f7db950912b73ea4fdf7d01d8e7' if mode.startswith('tiny') else '27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c')
                            assert call['device']=='wasm' and call['dtype']=='q8'
                elif mode=='forced-mirror-failure':
                    assert 'mock source unavailable' in result['error']
                    assert len([event for event in result['events'] if event['stage']=='model-download'])==1
                elif mode=='worker-unavailable':
                    assert '不支持' in result['error'] and 'Worker' in result['error']
                else:
                    assert 'Worker 已停止' in result['error']
                result['status']='PASS';report['cases'].append(result);context.close()
        finally: browser.close()
    report['status']='PASS'
except Exception as error:
    report['status']='FAIL';report['error']=str(error)[:2500]
finally:
    server.shutdown()
    (out/'bridge-worker-browser.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))
if report['status']!='PASS': raise SystemExit(1)
