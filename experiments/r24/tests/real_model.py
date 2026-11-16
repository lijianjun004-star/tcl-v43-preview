"""REAL model + public human Mandarin corpus; desktop Chromium, not iPhone."""
import functools, json, pathlib, threading, time, os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

repo = pathlib.Path(__file__).resolve().parents[3]
out = repo / 'evidence/r24'
preset=os.environ.get('ASR_PRESET','tiny')
server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(SimpleHTTPRequestHandler, directory=str(repo)))
threading.Thread(target=server.serve_forever, daemon=True).start()
result = {'mode': f'REAL Whisper {preset} q8 / public human Mandarin / desktop Chromium', 'samples': [], 'status': 'NOT RUN'}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--disable-dev-shm-usage'])
        page = browser.new_page()
        page.goto(f'http://127.0.0.1:{server.server_port}/experiments/r24/tcl-v352-asr-r24-qa/')
        page.evaluate('''async preset => {
          const {createLocalWhisper} = await import('./whisper-bridge.mjs');
          window.realEvents=[];
          window.realEngine=createLocalWhisper({modelPreset:preset,loadTimeoutMs:120000,inferTimeoutMs:120000,onProgress:n=>realEvents.push(n)});
        }''', preset)
        for sample in json.loads((out/'samples.json').read_text()):
            started = time.monotonic()
            item = dict(sample)
            try:
                item['result'] = page.evaluate('''async file => {
                  const blob=await (await fetch('/evidence/r24/'+file)).blob();
                  return await realEngine(blob);
                }''', sample['file'])
                item['status'] = 'PASS' if item['result']['text'].strip() else 'FAIL'
                item['scope'] = 'inference completed only; see CER, not accuracy acceptance'
            except Exception as e:
                item['status']='FAIL'; item['error']=str(e)[:1200]
            item['seconds']=round(time.monotonic()-started,2)
            result['samples'].append(item)
            if item['status']=='FAIL': break  # no automatic retries
        result['progress']=page.evaluate('window.realEvents')
        result['status']='PASS' if len(result['samples'])==3 and all(x['status']=='PASS' for x in result['samples']) else 'FAIL'
        result['browser']=browser.version
        browser.close()
except Exception as e:
    result['error']=str(e)[:1200]
finally:
    server.shutdown()
    (out/f'real-model-{preset}.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps(result,ensure_ascii=False,indent=2))
