import functools,threading,json,pathlib
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[2]
s=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(SimpleHTTPRequestHandler,directory=str(root)))
threading.Thread(target=s.serve_forever,daemon=True).start()
r={}
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  page=b.new_page();page.goto(f'http://127.0.0.1:{s.server_port}/experiments/r24/tcl-v352-asr-r24-qa/')
  r=page.evaluate('''async()=>{
 const {pipeline,env}=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
 const {prepareAudio}=await import('./whisper-bridge.mjs');
 const pipe=await pipeline('automatic-speech-recognition','onnx-community/whisper-base',{device:'wasm',dtype:'q8'});
 const a=await prepareAudio(await (await fetch('/evidence/r24/zh-1.wav')).blob());
 const config=pipe.model.generation_config;
 const init=[config.decoder_start_token_id,config.lang_to_id['<|zh|>'],config.task_to_id.transcribe,config.no_timestamps_token_id];
 const promptText='银行账户，账户余额，查询。';
 const prompt=pipe.tokenizer.encode(' '+promptText,{add_special_tokens:false});
 const prev=pipe.tokenizer.convert_tokens_to_ids?pipe.tokenizer.convert_tokens_to_ids('<|startofprev|>'):pipe.tokenizer.model.tokens_to_ids.get('<|startofprev|>');
 const ids=[prev,...prompt,...init];
 const opts={language:'chinese',task:'transcribe',chunk_length_s:30,stride_length_s:5};
 const baseline=await pipe(a.data,opts);
 const ignored=await pipe(a.data,{...opts,prompt_ids:[prev,...prompt]});
 const raw=await pipe(a.data,{...opts,decoder_input_ids:ids});
 const original=pipe.tokenizer._decode_asr;
 let seen=[];
 pipe.tokenizer._decode_asr=function(chunks,options){
   seen=chunks.map(x=>x.tokens.map(Number));
   return original.call(this,chunks.map(x=>({ ...x,tokens:x.tokens.every((_,i)=>i>=ids.length||Number(x.tokens[i])===ids[i])?x.tokens.slice(ids.length):x.tokens})),options);
 };
 const cleaned=await pipe(a.data,{...opts,decoder_input_ids:ids});
 pipe.tokenizer._decode_asr=original;
 return {promptText,prompt,prev,init,ids,baseline,ignored,raw,cleaned,seen};
}''')
  b.close()
except Exception as e:r={'error':str(e)}
finally:s.shutdown()
pathlib.Path(__file__).with_name('probe-result.json').write_text(json.dumps(r,ensure_ascii=False,indent=2))
print(json.dumps(r,ensure_ascii=False,indent=2))
