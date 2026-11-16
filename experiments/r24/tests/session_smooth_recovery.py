#!/usr/bin/env python3
"""Real Chromium IndexedDB/media persistence; synthetic camera/audio, MOCK Whisper.
No hardware or speech-accuracy claim. Runs actual production app, no app test hooks.
"""
import ast,json,pathlib,threading,time,traceback,hashlib,os
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=pathlib.Path(os.environ.get('R24_SESSION_OUT',str(ROOT.parents[1]/'evidence/r24-smooth-mobile/recovery')));OUT.mkdir(parents=True,exist_ok=True)
tree=ast.parse((ROOT/'tests/browser_smooth_e2e.py').read_text()); values={}
for n in tree.body:
 if isinstance(n,ast.Assign):
  for t in n.targets:
   if isinstance(t,ast.Name) and t.id in ('INIT_JS','MOCK_MODULE'):values[t.id]=ast.literal_eval(n.value)
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kw):super().__init__(*args,directory=str(ROOT),**kw)
 def log_message(self,*args):pass
 def do_GET(self):
  path=self.path.split('?')[0]
  if path=='/mock-transformers.mjs':data=values['MOCK_MODULE'].encode()
  elif path.endswith('/whisper-worker.mjs'):data=(ROOT/path.lstrip('/')).read_text().replace("const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';","const CDN = '/mock-transformers.mjs';").encode()
  else:return super().do_GET()
  self.send_response(200);self.send_header('Content-Type','application/javascript');self.end_headers();self.wfile.write(data)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/tcl-v352-asr-r24-qa/'
app_path=ROOT/'tcl-v352-asr-r24-qa/app.js'
app_sha=hashlib.sha256(app_path.read_bytes()).hexdigest()
result={'app_sha256':app_sha,'mode':'real Chromium IndexedDB + MediaRecorder; synthetic mic/video, MOCK model','checks':{},'errors':[]}
DBREAD="""async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('tcl-specialty-v352-asr-r24-qa');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});const rows=await new Promise((res,rej)=>{const r=db.transaction('prefs').objectStore('prefs').getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});const meta=rows.find(x=>x.id.startsWith('draft-session:'));const media=rows.filter(x=>x.id.startsWith('draft-media:'));return {meta,media:await Promise.all(media.map(async x=>({id:x.id,turnId:x.turnId,size:x.blob.size,sha:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await x.blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('')})))}}"""
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'])
  context=browser.new_context(viewport={'width':390,'height':844},permissions=['camera','microphone']);context.add_init_script(values['INIT_JS'])
  page=context.new_page();page.on('pageerror',lambda e:result['errors'].append(str(e)));page.on('dialog',lambda d:d.accept())
  def login(name):
   page.locator('[data-role-pick="anchor"]').click();page.locator('#simpleName').fill(name);page.locator('#simpleLogin').click();page.wait_for_selector('#freePractice');page.wait_for_timeout(150)
  page.goto(url);login('恢复测试A');page.locator('#freePractice').click();page.locator('#prepQuickRecheck').click();page.wait_for_function("!document.querySelector('#startScene').disabled");page.locator('#startScene').click();page.wait_for_timeout(1600)
  page.locator('#focusNext').click();page.wait_for_timeout(1800);page.locator('#focusClose').click();page.locator('#tclEndYes').click();page.wait_for_selector('#reviewDetails')
  page.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='saved'",timeout=15000);page.wait_for_timeout(1500)
  before=page.evaluate(DBREAD);assert len(before['media'])==3,before
  result['checks']['two_audio_and_video_committed']=True
  page.locator('#reviewDetails').click();edit=page.locator('textarea[aria-label="编辑本题回答"]').first;edit.fill('');page.get_by_role('button',name='保存本题修改').first.click()
  page.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='saved'");page.wait_for_timeout(100)
  page.reload();login('不同姓名B');assert page.locator('#restoreLocalSession').count()==0
  result['checks']['other_name_does_not_offer_media']=True
  page.locator('#switchIdentity').click();login('恢复测试A');page.locator('#restoreLocalSession').wait_for();page.locator('#restoreLocalSession').click();page.wait_for_selector('#reviewDetails')
  after=page.evaluate(DBREAD);assert before['media']==after['media']
  result['checks']['reload_same_name_restores_exact_blobs']=True
  page.locator('#reviewDetails').click();assert page.locator('audio').count()==2;assert '已清空回答' in page.locator('#questionSummary tbody tr').first.inner_text()
  assert page.locator('textarea[aria-label="编辑本题回答"]').first.input_value()==''
  result['checks']['manual_clear_and_audio_players_restored']=True
  page.locator('#reviewDetailsBack').click();page.locator('#reviewReplay').click();assert page.locator('#sessionArchiveHolder video').count()==1
  result['checks']['video_player_restored']=True
  page.locator('#reviewReplayBack').click();page.locator('#reviewDetails').click()
  page.evaluate("""()=>{const put=IDBObjectStore.prototype.put;window.__originalPut=put;IDBObjectStore.prototype.put=function(v,...args){if(v?.id?.startsWith('draft-session:'))throw new DOMException('Simulated full storage','QuotaExceededError');return put.call(this,v,...args)}}""")
  edit=page.locator('textarea[aria-label="编辑本题回答"]').first;edit.fill('保存失败时保留的人工回答');page.get_by_role('button',name='保存本题修改').first.click()
  page.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='error'",timeout=12000)
  assert '保存失败' in page.locator('#localSessionSaveStatus').inner_text()
  failed=page.evaluate(DBREAD);assert failed['meta']['snapshot']['turns'][0]['manualCleared'] is True
  result['checks']['quota_failure_visible_previous_checkpoint_intact']=True
  page.evaluate('()=>{IDBObjectStore.prototype.put=window.__originalPut}');edit=page.locator('textarea[aria-label="编辑本题回答"]').first;edit.fill('重新保存成功');page.get_by_role('button',name='保存本题修改').first.click();page.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='saved'")
  page.reload();login('恢复测试A');page.locator('#restoreLocalSession').click();page.wait_for_selector('#reviewDetails');page.locator('#reviewDetails').click();assert page.locator('textarea[aria-label="编辑本题回答"]').first.input_value()=='重新保存成功'
  result['checks']['explicit_retry_persists_new_answer']=True
  page.screenshot(path=str(OUT/'restored-review.png'),full_page=True)
  # A manual clear must survive both record and submission payloads.
  edit=page.locator('textarea[aria-label="编辑本题回答"]').first;edit.fill('');page.get_by_role('button',name='保存本题修改').first.click();page.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='saved'")
  page.locator('#reviewDetailsBack').click();page.locator('#submitOperator').fill('复核运营');page.locator('#submitSession').click();page.wait_for_function("document.querySelector('#submitSession').textContent.includes('已提交给')")
  flags=page.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('tcl-specialty-v352-asr-r24-qa');q.onsuccess=()=>r(q.result)});const read=(s,id)=>new Promise(r=>{const q=db.transaction(s).objectStore(s)[id?'get':'getAll'](id);q.onsuccess=()=>r(q.result)});return {subs:await read('prefs','submissions'),records:await read('records')}}""")
  cleared=flags['subs']['value'][0]['turns'][0];assert cleared['manualCleared'] is True and cleared['answer']=='' and cleared['transcript']
  assert any(x.get('manualCleared') is True and x['answer']=='' for x in flags['records'])
  result['checks']['manual_clear_kept_in_record_and_submission']=True
  # New local identity can complete the text workflow without media/model calls.
  page.locator('#reviewHome').click();page.locator('#switchIdentity').click();login('纯文字C');page.locator('#freePractice').click();page.locator('#prepQuickText').click();page.locator('#startScene').click();page.wait_for_function("document.body.classList.contains('room-live')")
  page.locator('#focusReview').click();page.locator('#liveToolText').click();page.locator('#liveTextAnswer').fill('纯文字练习：说明产品特点并核对参数');page.locator('#liveTextSave').click();page.locator('#focusClose').click();page.locator('#tclEndYes').click();page.wait_for_selector('#reviewDetails');page.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='saved'")
  page.reload();login('纯文字C');page.locator('#restoreLocalSession').click();page.locator('#reviewDetails').click();assert '纯文字练习' in page.locator('#questionSummary').inner_text();assert page.locator('audio').count()==0
  result['checks']['text_only_workflow_and_reload_without_model']=True
  # Begin a new recorded run, save Q1, then refresh while Q2 is still recording.
  page.locator('#reviewDetailsBack').click();page.locator('#reviewHome').click();page.locator('#switchIdentity').click();login('中断D');page.locator('#freePractice').click();page.locator('#prepQuickRecheck').click();page.wait_for_function("!document.querySelector('#startScene').disabled");page.locator('#startScene').click();page.wait_for_timeout(1500);page.locator('#focusNext').click();page.wait_for_timeout(600)
  page.reload();login('中断D');page.locator('#restoreLocalSession').click();page.wait_for_selector('#reviewDetails');assert '中断' in page.locator('#localSessionSaveStatus').inner_text();page.locator('#reviewDetails').click();assert page.locator('audio').count()>=1
  result['checks']['interrupted_run_restores_stopped_question_not_active_video']=True
  result['media_hashes']=before['media'];result['source_unchanged']=hashlib.sha256(app_path.read_bytes()).hexdigest()==app_sha;result['ok']=not result['errors'] and result['source_unchanged'];browser.close()
except Exception as e:result['ok']=False;result['exception']=str(e);result['traceback']=traceback.format_exc()
finally:server.shutdown();(OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2));
if not result['ok']:raise SystemExit(1)
