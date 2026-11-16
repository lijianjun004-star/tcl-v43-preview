"""Bounded synthetic ONNX MatMul probe of the exact Transformers.js 3.8.1 runtime.
No speech model/tokenizer/weights are downloaded. This is not Whisper accuracy QA.
"""
from pathlib import Path
import functools, hashlib, json, threading, time, traceback
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

OUT=Path(__file__).resolve().parent
FIX=Path('/workspace/scratch/r24-asr-synthetic-runtime')
MODEL=FIX/'synthetic'/'onnx'
MODEL.mkdir(parents=True,exist_ok=True)

def varint(n):
    out=bytearray()
    while n>127:out.append((n&127)|128);n>>=7
    out.append(n);return bytes(out)
def field(n,value):
    if isinstance(value,int):return varint(n<<3)+varint(value)
    if isinstance(value,str):value=value.encode()
    return varint((n<<3)|2)+varint(len(value))+value
N=1024
def value_info(name):
    dim=field(1,N)
    shape=field(1,dim)+field(1,dim)
    tensor_type=field(1,1)+field(2,shape)
    return field(1,name)+field(2,field(1,tensor_type))
node=field(1,'input_ids')+field(1,'attention_mask')+field(2,'last_hidden_state')+field(4,'MatMul')
graph=field(1,node)+field(2,'synthetic_matmul_1024')+field(11,value_info('input_ids'))+field(11,value_info('attention_mask'))+field(12,value_info('last_hidden_state'))
raw=field(1,9)+field(2,'R24-synthetic-runtime-probe')+field(7,graph)+field(8,field(2,13))
(MODEL/'model.onnx').write_bytes(raw)
(FIX/'synthetic'/'config.json').write_text(json.dumps({'model_type':'bert','architectures':['BertModel'],'hidden_size':N,'num_attention_heads':1,'num_hidden_layers':1}))
(FIX/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>Synthetic runtime probe</title><p>Manual synthetic ONNX runtime probe; no business data.</p>')

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(FIX)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}/'
report={'status':'RUNNING','scope':'Actual Chromium + exact Transformers.js 3.8.1 / fixed ORT dependency, manually generated 1024x1024 MatMul. No real Whisper model, speech, mobile hardware or accuracy claim.','synthetic_onnx_bytes':len(raw),'synthetic_onnx_sha256':hashlib.sha256(raw).hexdigest(),'matrix_size':N,'repeats':3,'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'cases':[]}

try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  report['browser']=browser.version
  for proxy in [False,True]:
   ctx=browser.new_context();page=ctx.new_page();page.set_default_timeout(120000)
   requests=[];workers=[];errors=[]
   page.on('request',lambda req:requests.append(req.url))
   page.on('worker',lambda worker:workers.append(worker.url))
   page.on('pageerror',lambda err:errors.append(str(err)))
   started=time.monotonic()
   case={'proxy':proxy,'status':'RUNNING'};report['cases'].append(case)
   try:
    page.goto(base,wait_until='load')
    case['result']=page.evaluate('''async({proxy,N})=>{
      const mod=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
      const {env,AutoModel,Tensor}=mod;
      env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath='/';
      env.backends.onnx.wasm.proxy=proxy;env.backends.onnx.wasm.numThreads=1;
      const loadStart=performance.now();
      const model=await AutoModel.from_pretrained('synthetic',{device:'wasm',dtype:'fp32',local_files_only:true});
      const loadMs=performance.now()-loadStart;
      const input=()=>({input_ids:new Tensor('float32',new Float32Array(N*N).fill(.5),[N,N]),attention_mask:new Tensor('float32',new Float32Array(N*N).fill(.25),[N,N])});
      const initial=await model(input());
      if(initial.last_hidden_state.data[0]!==N*.125)throw new Error('synthetic output mismatch during warmup');
      await new Promise(r=>setTimeout(r,60));
      const measurementStart=performance.now();
      let ticks=[],longTasks=[];
      const po=new PerformanceObserver(list=>longTasks.push(...list.getEntries().filter(e=>e.startTime>=measurementStart).map(e=>({start:e.startTime,duration:e.duration}))));
      po.observe({type:'longtask',buffered:false});
      const timer=setInterval(()=>ticks.push(performance.now()),10);
      const runs=[];
      for(let i=0;i<3;i++){
        const values=input();await new Promise(r=>setTimeout(r,60));
        const before=ticks.length,start=performance.now();
        const output=await model(values);
        const end=performance.now(),count=ticks.length-before;
        const data=output.last_hidden_state.data;
        if(data.length!==N*N||data[0]!==N*.125||data[data.length-1]!==N*.125)throw new Error('synthetic output mismatch');
        runs.push({ms:end-start,heartbeatTicksDuringRun:count,first:data[0],last:data[data.length-1],length:data.length});
        await new Promise(r=>setTimeout(r,60));
      }
      clearInterval(timer);po.disconnect();
      const gaps=ticks.slice(1).map((v,i)=>v-ticks[i]);
      await model.dispose();
      return {loadMs,measurementStart,runs,heartbeatCount:ticks.length,maxHeartbeatGapMs:Math.max(0,...gaps),longTasks,envProxy:env.backends.onnx.wasm.proxy,envNumThreads:env.backends.onnx.wasm.numThreads,crossOriginIsolated};
    }''',{'proxy':proxy,'N':N})
    case['status']='PASS'
   except Exception as error:
    case['status']='FAIL';case['error']=str(error);case['traceback']=traceback.format_exc()[-1600:]
   finally:
    case.update(seconds=round(time.monotonic()-started,3),workers=workers,page_errors=errors,requests=requests)
    bad=[url for url in requests if not url.startswith(base) and not url.startswith('blob:') and not url.startswith('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1')]
    case['unexpected_external_requests']=bad
    if bad:case['status']='FAIL'
    ctx.close()
    (OUT/'proxy-runtime-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
   if case['status']=='FAIL':break
  browser.close()
 report['status']='PASS' if len(report['cases'])==2 and all(x['status']=='PASS' for x in report['cases']) else 'FAIL'
except Exception as error:
 report.update(status='FAIL',error=str(error),traceback=traceback.format_exc()[-1600:])
finally:
 server.shutdown()
 (OUT/'proxy-runtime-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(report,ensure_ascii=False,indent=2))
if report['status']!='PASS':raise SystemExit(1)
