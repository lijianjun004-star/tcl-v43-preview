"""Independent native Chromium/IndexedDB probes with synthetic 61-turn checkpoint and silent WAV.
The HTTP handler appends only temporary internal test accessors; no product file is edited.
"""
from pathlib import Path
import ast,functools,hashlib,json,os,threading,traceback
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3];SITE=ROOT/'experiments/r24/tcl-v352-asr-r24-qa';OUT=Path(os.environ.get('INDEPENDENT_OUT',str(Path(__file__).parent/'candidate')));OUT.mkdir(parents=True,exist_ok=True)
DB='tcl-specialty-v352-asr-r24-qa'
tree=ast.parse((ROOT/'experiments/r24/tests/performance.py').read_text())
FIXTURE=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FIXTURE' for t in n.targets))
HOOK="""\nwindow.__independent={turns:()=>lastSessionSnapshot?.turns||sessionTurns,refresh:()=>renderQuestionSummary(),status:(index,value)=>{const t=(lastSessionSnapshot?.turns||sessionTurns)[index];t.asrStatus=value;renderTurnStatus(t);},run:()=>runId};\n"""
class Q(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(SITE),**kw)
 def log_message(self,*a):pass
 def do_GET(self):
  if self.path.split('?')[0]=='/app.js':
   b=(SITE/'app.js').read_bytes()+HOOK.encode();self.send_response(200);self.send_header('Content-Type','application/javascript');self.end_headers();self.wfile.write(b)
  else:super().do_GET()
s=ThreadingHTTPServer(('127.0.0.1',0),Q);threading.Thread(target=s.serve_forever,daemon=True).start();URL=f'http://127.0.0.1:{s.server_port}/'
sha=lambda:hashlib.sha256((SITE/'app.js').read_bytes()).hexdigest()
r={'mode':__doc__,'app_sha256':sha(),'checks':{},'errors':[]}
def check(k,v,detail=None):
 r['checks'][k]={'pass':bool(v),'detail':detail};assert v,(k,detail)
def login(p,name):
 p.locator('[data-role-pick="anchor"]').click();p.locator('#simpleName').fill(name);p.locator('#simpleLogin').click();p.locator('#freePractice').wait_for()
def read(p,name):return p.evaluate('''async({name,dbName})=>{const db=await new Promise(r=>{const q=indexedDB.open(dbName);q.onsuccess=()=>r(q.result)});try{return await new Promise(r=>{const q=db.transaction('prefs').objectStore('prefs').get('draft-session:'+encodeURIComponent(name));q.onsuccess=()=>r(q.result)})}finally{db.close()}}''',{'name':name,'dbName':DB})
def saved(p):p.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='saved'",timeout=15000)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--autoplay-policy=no-user-gesture-required']);ctx=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);p=ctx.new_page();p.on('pageerror',lambda e:r['errors'].append(str(e)));p.goto(URL);p.locator('[data-role-pick="anchor"]').wait_for();name='人工独立分页复核'
  p.evaluate(FIXTURE,{'name':name,'n':61,'dbName':DB})
  p.evaluate('''async({name,dbName})=>{const db=await new Promise(r=>{const q=indexedDB.open(dbName);q.onsuccess=()=>r(q.result)});await new Promise((resolve,reject)=>{const tx=db.transaction('prefs','readwrite'),st=tx.objectStore('prefs'),q=st.get('draft-session:'+encodeURIComponent(name));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);q.onsuccess=()=>{const meta=q.result,t=meta.snapshot.turns[0],samples=16000*30,buf=new ArrayBuffer(44+samples*2),d=new DataView(buf),str=(i,v)=>[...v].forEach((c,n)=>d.setUint8(i+n,c.charCodeAt(0)));str(0,'RIFF');d.setUint32(4,36+samples*2,true);str(8,'WAVE');str(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,16000,true);d.setUint32(28,32000,true);d.setUint16(32,2,true);d.setUint16(34,16,true);str(36,'data');d.setUint32(40,samples*2,true);const blob=new Blob([buf],{type:'audio/wav'}),id='draft-media:'+meta.runId+':'+t.id;st.put({id,blob,turnId:t.id,owner:name,runId:meta.runId});meta.media=[{id,turnId:t.id,size:blob.size}];st.put(meta);}});db.close()}''',{'name':name,'dbName':DB})
  p.reload();login(p,name);p.locator('#restoreLocalSession').click();p.locator('#reviewDetails').wait_for();check('overview_keeps_summary_unmounted',p.locator('#questionSummary tbody tr').count()==0)
  p.locator('#reviewDetails').click();check('first_page_is_20_rows',p.locator('#questionSummary tbody tr').count()==20)
  edit=p.locator('textarea[aria-label="编辑本题回答"]').first;edit.fill('尚未保存的人工草稿末字甲');p.evaluate("window.__dirtyNode=document.querySelector('#questionSummary textarea');window.__audioNode=document.querySelector('#questionSummary audio');window.__audioSrc=__audioNode.src")
  p.evaluate('()=>window.__audioNode.play()');p.wait_for_timeout(100)
  for i in range(3):p.locator('#reviewQuestionsMore').click()
  check('all_61_rows_reachable',p.locator('#questionSummary tbody tr').count()==61 and '人工构造第60题' in p.locator('#questionSummary').inner_text() and p.locator('#reviewQuestionsMore').is_hidden())
  p.evaluate("()=>{for(let i=0;i<15;i++)window.__independent.status(1,'人工状态更新'+i)}")
  d=p.evaluate("()=>({sameEditor:__dirtyNode===document.querySelector('#questionSummary textarea'),draft:__dirtyNode.value,dirty:__dirtyNode.dataset.dirty,sameAudio:__audioNode===document.querySelector('#questionSummary audio'),sameSrc:__audioSrc===__audioNode.src,playing:!__audioNode.paused,time:__audioNode.currentTime,status:document.querySelectorAll('#questionSummary tbody tr')[1].textContent})")
  check('dirty_editor_survives_append_and_status_updates',d['sameEditor'] and d['draft']=='尚未保存的人工草稿末字甲' and d['dirty']=='true',d)
  check('playing_audio_keeps_node_url_and_playback',d['sameAudio'] and d['sameSrc'] and d['playing'] and d['time']>0,d)
  check('other_row_updates_while_first_editor_dirty','人工状态更新14' in d['status'])
  check('unsaved_editor_does_not_change_snapshot',p.evaluate("__independent.turns()[0].answer")!='尚未保存的人工草稿末字甲' and read(p,name)['snapshot']['turns'][0]['answer']!='尚未保存的人工草稿末字甲')
  p.locator('textarea[aria-label="编辑本题回答"]').nth(1).fill('第二题独立保存末字戊');p.get_by_role('button',name='保存本题修改',exact=True).nth(1).click();saved(p)
  d=p.evaluate("()=>({sameEditor:__dirtyNode===document.querySelector('#questionSummary textarea'),draft:__dirtyNode.value,dirty:__dirtyNode.dataset.dirty,sameAudio:__audioNode===document.querySelector('#questionSummary audio'),sameSrc:__audioSrc===__audioNode.src,playing:!__audioNode.paused,time:__audioNode.currentTime})")
  check('other_question_save_preserves_dirty_editor_and_playback',d['sameEditor'] and d['draft']=='尚未保存的人工草稿末字甲' and d['dirty']=='true' and d['sameAudio'] and d['sameSrc'] and d['playing'] and read(p,name)['snapshot']['turns'][1]['answer']=='第二题独立保存末字戊',d)
  p.locator('#reviewDetailsBack').click();check('leaving_details_pauses_audio',p.evaluate('__audioNode.paused'))
  p.locator('#reviewDetails').click();check('return_details_preserves_dirty_draft',p.locator('textarea[aria-label="编辑本题回答"]').first.input_value()=='尚未保存的人工草稿末字甲')
  p.get_by_role('button',name='保存本题修改',exact=True).first.click();saved(p);check('save_dirty_editor_persists_latest_text',read(p,name)['snapshot']['turns'][0]['answer']=='尚未保存的人工草稿末字甲')
  p.locator('#reviewGoReplay').click();p.locator('#reviewToolsFold > summary').click();p.evaluate("()=>{const t=document.querySelector('#postTranscript');t.value='整场末字乙';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#reviewReplayBack').click()}");saved(p);check('post_text_stage_switch_keeps_last_character',read(p,name)['snapshot']['postTranscript']=='整场末字乙')
  p.locator('#reviewReplay').click();p.evaluate("()=>{const t=document.querySelector('#postTranscript');t.value='切详情末字己';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#reviewGoDetails').click()}");saved(p);check('replay_to_details_keeps_last_character',read(p,name)['snapshot']['postTranscript']=='切详情末字己')
  p.locator('#reviewGoReplay').click();p.evaluate("()=>{const t=document.querySelector('#postTranscript');t.value='刷新前最后一个字庚';t.dispatchEvent(new Event('input',{bubbles:true}));location.reload()}");p.wait_for_load_state('load');p.locator('[data-role-pick="anchor"]').wait_for();check('pagehide_immediate_reload_keeps_last_character',read(p,name)['snapshot']['postTranscript']=='刷新前最后一个字庚')
  login(p,name);p.locator('#restoreLocalSession').click();p.locator('#reviewDetails').wait_for();p.locator('#submitOperator').fill('人工复核运营')
  p.evaluate("()=>{const t=document.querySelector('#postTranscript');t.value='提交前最后一个字辛';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#submitSession').click()}");p.wait_for_function("document.querySelector('#submitSession').textContent.includes('已提交给')")
  sub=p.evaluate('''async(dbName)=>{const db=await new Promise(r=>{const q=indexedDB.open(dbName);q.onsuccess=()=>r(q.result)});return await new Promise(r=>{const q=db.transaction('prefs').objectStore('prefs').get('submissions');q.onsuccess=()=>{db.close();r(q.result.value[0])}})}''',DB)
  check('submission_contains_all_61_saved_turns',len(sub['turns'])==61 and sub['turns'][0]['answer']=='尚未保存的人工草稿末字甲')
  check('immediate_submit_keeps_checkpoint_last_character',read(p,name)['snapshot']['postTranscript']=='提交前最后一个字辛')
  ctx.close()
  # Input event followed by immediate next button; no delay before the action.
  ctx=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);p=ctx.new_page();p.on('pageerror',lambda e:r['errors'].append(str(e)));p.goto(URL);name='人工即时末字复核';login(p,name);p.locator('#freePractice').click();p.locator('#prepQuickText').click();p.locator('#startScene').click();p.locator('#focusReview').click();p.locator('#liveToolText').click()
  p.evaluate("()=>{const t=document.querySelector('#liveTextAnswer');t.value='切题前最后一个字丙';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#focusNext').click()}");p.wait_for_function('__independent.turns().length===2');p.wait_for_timeout(350);check('immediate_next_preserves_previous_answer',read(p,name)['snapshot']['turns'][0]['answer']=='切题前最后一个字丙')
  p.locator('#focusReview').click();p.locator('#liveToolText').click();p.evaluate("()=>{const t=document.querySelector('#liveTextAnswer');t.value='应清空';t.dispatchEvent(new Event('input',{bubbles:true}));t.value='';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#liveTextClose').click()}");p.wait_for_timeout(350);turn=read(p,name)['snapshot']['turns'][1];check('clear_preserves_intentional_empty_answer',turn['answer']=='' and turn['manualCleared'],turn)
  p.locator('#focusReview').click();p.locator('#liveToolText').click();p.evaluate("()=>{const t=document.querySelector('#liveTextAnswer');t.value='结束前最后一个字丁';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#focusClose').click();document.querySelector('#tclEndYes').click()}");p.locator('#reviewDetails').wait_for();saved(p);check('immediate_finish_keeps_last_character',read(p,name)['snapshot']['turns'][1]['answer']=='结束前最后一个字丁')
  old=read(p,name);p.evaluate("()=>{const t=document.querySelector('#postTranscript');t.value='旧场尾文壬';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#reviewRetry').click();document.querySelector('#tclRestartYes').click()}");p.locator('#prepQuickText').wait_for();p.wait_for_timeout(300)
  check('new_practice_preserves_old_owner_checkpoint',read(p,name)['runId']==old['runId'] and read(p,name)['snapshot']['postTranscript']=='旧场尾文壬')
  p.locator('#prepQuickText').click();p.locator('#startScene').click();p.locator('#focusReview').click();p.locator('#liveToolText').click();p.evaluate("()=>{const t=document.querySelector('#liveTextAnswer');t.value='新场回答癸';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#liveTextClose').click()}");p.wait_for_timeout(300);new=read(p,name)
  check('old_pending_write_does_not_pollute_new_run',new['runId']!=old['runId'] and new['owner']==name and len(new['snapshot']['turns'])==1 and new['snapshot']['turns'][0]['answer']=='新场回答癸' and not new['snapshot'].get('postTranscript'))
  ctx.close();r['browser']=browser.version;browser.close();r['status']='PASS'
except Exception as e:r['status']='FAIL';r['exception']=str(e);r['traceback']=traceback.format_exc()
finally:
 s.shutdown();r['app_sha256_after']=sha();r['source_unchanged']=r['app_sha256']==r['app_sha256_after'];
 if not r['source_unchanged'] or r['errors']:r['status']='FAIL'
 (OUT/'result.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:r[k] for k in ['status','app_sha256','app_sha256_after','source_unchanged','checks','errors']},ensure_ascii=False,indent=2))
 if r.get('exception'):print(r['traceback'])
if r['status']!='PASS':raise SystemExit(1)
