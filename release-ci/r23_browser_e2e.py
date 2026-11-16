#!/usr/bin/env python3
"""R2 independent three-turn desktop Chromium smoke test; model is MOCKED. Not speech-accuracy evidence."""
import json, pathlib, threading, functools, time, sys, traceback, os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT=pathlib.Path(os.environ.get('R23_SITE_ROOT', str(pathlib.Path(__file__).resolve().parents[1] / 'site')))
REPORT=pathlib.Path(os.environ.get('R23_BROWSER_REPORT',str(pathlib.Path(__file__).resolve().parents[1] / 'evidence/browser_r23_result.json')))
MOCK_MODULE='''
export const env={remoteHost:'https://huggingface.co/'};
let count=0;
export async function pipeline(task, modelId, opts){
 window.__mockPipeline={task,modelId,opts};
 return async function(pcm, inferOpts){
  count++;
  window.__inferCalls=window.__inferCalls||[];
  window.__inferCalls.push({count,samples:pcm.length,options:inferOpts});
  if(window.__mockWhisperFail) throw new Error('SIMULATED MODEL ERROR');
  await new Promise(r=>setTimeout(r,count===2?600:count===3?400:120));
  if(count===1)return {text:'二零二四年新款Q十M Pro八十五吋售價兩千五百塊錢'};
  if(count===2)return {text:'C十一K七十五英寸支持HDMI二点一'};
  return {text:'支持四K一百四十四赫茲高刷，連接PS五玩遊戲'};
 };
}
'''
class ServerHandler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def log_message(self,*args):pass
    def do_GET(self):
        u=self.path.split('?',1)[0]
        if u=='/mock-transformers.mjs':
            data=MOCK_MODULE.encode();self.send_response(200);self.send_header('Content-Type','application/javascript; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
        if u.endswith('/whisper-bridge.mjs'):
            f=ROOT/u.lstrip('/')
            if not f.is_file():self.send_error(404);return
            data=f.read_text().replace("const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';", "const CDN = '/mock-transformers.mjs';").encode()
            self.send_response(200);self.send_header('Content-Type','application/javascript; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
        return super().do_GET()

INIT_JS=r'''(() => {
 if(!navigator.mediaDevices)navigator.mediaDevices={};
 navigator.mediaDevices.getUserMedia=async constraints=>{
  const tracks=[];
  if(constraints&&constraints.video){
    const canvas=document.createElement('canvas');canvas.width=360;canvas.height=640;
    let n=0;const c=canvas.getContext('2d');
    const draw=()=>{c.fillStyle=n++%2?'#152238':'#21314a';c.fillRect(0,0,360,640);c.fillStyle='#fff';c.font='30px sans-serif';c.fillText('E2E',40,140)};
    draw();const iv=setInterval(draw,80);
    canvas.captureStream(15).getTracks().forEach(t=>{
     t.getSettings=()=>({width:360,height:640,frameRate:15,resizeMode:'none'});
     t.applyConstraints=async()=>{};
     const stop=t.stop.bind(t);t.stop=()=>{clearInterval(iv);stop()};tracks.push(t);
    });
  }
  if(constraints&&constraints.audio){
    const ac=new AudioContext();const osc=ac.createOscillator(),gain=ac.createGain(),dest=ac.createMediaStreamDestination();
    osc.frequency.value=440;gain.gain.value=.14;osc.connect(gain);gain.connect(dest);osc.start();
    dest.stream.getTracks().forEach(t=>{
      const stop=t.stop.bind(t);t.stop=()=>{try{osc.stop();ac.close()}catch{}stop()};tracks.push(t);
    });
  }
  return new MediaStream(tracks);
 };
})();'''

server=ThreadingHTTPServer(('127.0.0.1',0),ServerHandler)
threading.Thread(target=server.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{server.server_port}/tcl-v352-asr-autoqa-r23/'
result={'test_mode':'Chromium real MediaRecorder + synthetic sine-wave mic; Whisper return text MOCKED','url':URL,'steps':{},'errors':[]}

def step(name,fn):
    t=time.perf_counter();fn();result['steps'][name]=round(time.perf_counter()-t,2)
try:
 with sync_playwright() as p:
  candidates=('/usr/bin/chromium','/usr/bin/google-chrome','/opt/google/chrome/chrome')
  executable=next((f for f in candidates if pathlib.Path(f).exists()),None)
  opts={'executable_path':executable} if executable else {}
  browser=p.chromium.launch(headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'],**opts)
  context=browser.new_context(viewport={'width':390,'height':844},permissions=['camera','microphone'])
  context.add_init_script(INIT_JS)
  page=context.new_page();page.on('pageerror',lambda err:result['errors'].append(str(err)))
  page.goto(URL,wait_until='domcontentloaded',timeout=15000)
  # The guest gateway intentionally hides the topbar. Model selection is
  # available on the anchor home screen after entering a name, not before.
  step('choose_anchor',lambda:page.locator('[data-role-pick="anchor"]').click(timeout=7000))
  step('name',lambda:page.locator('#simpleName').fill('AutoQA-R2-独立核验'))
  step('login',lambda:page.locator('#simpleLogin').click())
  page.wait_for_function("document.body.dataset.role==='anchor'",timeout=8000)
  page.locator('details.header-tools summary').click(timeout=7000)
  pref=page.locator('#r23ModelChoice')
  assert pref.input_value() in ('tiny','base')
  result['preset_before_run']=pref.input_value()
  step('freePractice',lambda:page.locator('#freePractice').click())
  page.wait_for_function("document.body.dataset.page==='training'",timeout=7000)
  step('device_recheck',lambda:page.locator('#prepQuickRecheck').click())
  page.wait_for_function("!document.getElementById('startScene')?.disabled",timeout=11000)
  step('startScene',lambda:page.locator('#startScene').click())
  page.wait_for_function("document.body.classList.contains('room-live')",timeout=11000)
  page.wait_for_timeout(1600)
  step('next_Q1',lambda:page.locator('#focusNext').click())
  page.wait_for_timeout(1600)
  step('stop_Q2',lambda:page.locator('#focusMic').click())
  page.wait_for_timeout(90)
  step('open_tools',lambda:page.locator('#focusReview').click())
  step('open_text_answer',lambda:page.locator('#liveToolText').click())
  page.locator('#liveTextAnswer').fill('人工修改测试：T7M Pro 75英寸')
  step('save_manual',lambda:page.locator('#liveTextSave').click())
  page.wait_for_timeout(900)
  step('next_Q2',lambda:page.locator('#focusNext').click())
  page.wait_for_timeout(1500)
  step('finish_menu',lambda:page.locator('#focusClose').click())
  page.locator('#tclEndYes').wait_for(timeout=7000)
  start=time.perf_counter();step('finish_confirm',lambda:page.locator('#tclEndYes').click())
  page.wait_for_function("document.body.dataset.page==='sessionReview'",timeout=8000)
  result['finish_transition_ms']=round((time.perf_counter()-start)*1000)
  page.wait_for_timeout(900)
  step('reviewDetails',lambda:page.locator('#reviewDetails').click())
  page.wait_for_function("document.body.dataset.reviewStage==='details'",timeout=8000)
  result['inspect']=page.evaluate('''async()=>{
    const rows=[...document.querySelectorAll('#questionSummary tbody tr')].map(tr=>({
      answer:tr.children[3]?.innerText?.slice(0,500)||'',status:tr.children[4]?.innerText?.slice(0,500)||'',audio:!!tr.querySelector('audio')
    }));
    const request=indexedDB.open('tcl-specialty-v352-asr-autoqa-r23-r2');
    const db=await new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
    const tx=db.transaction(['records'],'readonly');
    const records=await new Promise(r=>{const req=tx.objectStore('records').getAll();req.onsuccess=()=>r(req.result||[])})
    db.close();
    return {title:document.title,rows,recordCount:records.length,records:records.map(x=>({answer:x.answer,transcript:x.transcript,whisperCandidate:x.whisperCandidate,asrStatus:x.asrStatus})),calls:window.__inferCalls||[],modelLoaded:window.__mockPipeline};
  }''')
  result['ok']=len(result['inspect']['rows'])>=3 and len(result['inspect']['calls'])>=3 and any('人工修改测试' in r['answer'] for r in result['inspect']['records'])
  page.screenshot(path=str(REPORT.with_name('r23_review.png')),full_page=True)
  browser.close()
except Exception as e:
 result['ok']=False;result['exception']=str(e);result['traceback']=traceback.format_exc()[-3000:]
finally:
 REPORT.parent.mkdir(parents=True,exist_ok=True)
 server.shutdown();REPORT.write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2)[:8000])

if not result.get("ok"):
 sys.exit(2)