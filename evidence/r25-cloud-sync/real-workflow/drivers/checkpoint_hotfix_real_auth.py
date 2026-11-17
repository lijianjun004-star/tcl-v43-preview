#!/usr/bin/env python3
"""Real native Auth + actual model selector reload; read-only IndexedDB telemetry.
The telemetry delegates every native IDB call unchanged, records draft reads/puts,
and never replaces Auth, SDK, responses, business RPC, or stored values.
"""
from pathlib import Path
from datetime import datetime,timezone
from urllib.parse import urlsplit
import argparse,json,traceback,hashlib
from playwright.sync_api import sync_playwright
from run_native_pg_e2e import private_config,sha
ROOT=Path(__file__).resolve().parent
PROBE=r'''(()=>{const state={reads:[],puts:[]};window.__checkpointObserve=state;
const get=IDBObjectStore.prototype.get,put=IDBObjectStore.prototype.put;
IDBObjectStore.prototype.get=function(key){const request=get.apply(this,arguments);if(this.name==='prefs'&&String(key).startsWith('draft-session:')){const item={key:String(key),mode:this.transaction.mode,row:null};state.reads.push(item);request.addEventListener('success',()=>{item.row=request.result?JSON.parse(JSON.stringify(request.result)):null;});}return request;};
IDBObjectStore.prototype.put=function(value){if(this.name==='prefs'&&String(value?.id||'').startsWith('draft-session:'))state.puts.push({id:value.id});return put.apply(this,arguments);};})();'''

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--private-config',required=True);ap.add_argument('--url',default='http://127.0.0.1:8765/tcl-v352-asr-r25-qa/');ap.add_argument('--out',required=True);a=ap.parse_args()
 if urlsplit(a.url).hostname not in ('localhost','127.0.0.1'):raise SystemExit('Observational telemetry test is local candidate only.')
 out=Path(a.out);out.mkdir(parents=True,exist_ok=True);cfg=private_config(a.private_config);account=cfg['accounts']['anchor'];expected=sha(Path('/workspace/tcl-r25-cloud/experiments/r25/tcl-v352-asr-r25-qa/app.js').read_bytes())
 r={'status':'NOT RUN','scope':__doc__,'url':a.url,'expectedAppSha256':expected,'startedAt':datetime.now(timezone.utc).isoformat(),'checks':[],'pageErrors':[],'modelRequests':[],'appResponses':[],'configurationOverride':False,'sdkInjection':False,'businessMocks':False}
 def save():(out/'result.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
 def check(name,ok,detail=None):
  r['checks'].append({'name':name,'pass':bool(ok),'detail':detail});save()
  if not ok:raise AssertionError(name)
 try:
  with sync_playwright() as pw:
   b=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage']);c=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,locale='zh-CN');c.add_init_script(PROBE);p=c.new_page();p.on('dialog',lambda d:d.accept());p.on('pageerror',lambda e:r['pageErrors'].append({'type':type(e).__name__}));responses=[]
   p.on('response',lambda response:responses.append(response) if urlsplit(response.url).path.endswith('/app.js') else None)
   def capture():
    while len(r['appResponses'])<len(responses):
     x=responses[len(r['appResponses'])];r['appResponses'].append({'status':x.status,'sha256':sha(x.body())})
   def route(route):
    path=urlsplit(route.request.url).path.lower()
    if '/live-practice-room/voice/' in path or path.endswith(('.wasm','.onnx')) or urlsplit(route.request.url).hostname in ('huggingface.co','hf-mirror.com'):
     r['modelRequests'].append({'path':path});route.abort('blockedbyclient')
    else:route.continue_()
   c.route('**/*',route)
   def home_ready():
    p.locator('#cloudRefresh').wait_for(timeout=45000);p.wait_for_function("document.querySelector('[data-cloud-status]')?.textContent.includes('云端已更新')",timeout=45000)
   def checkpoint():
    return p.evaluate(r'''async({env,uid})=>{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('tcl-specialty-v352-asr-r25-qa:cloud:'+encodeURIComponent(env)+':'+encodeURIComponent(uid));q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});try{return await new Promise((resolve,reject)=>{const t=db.transaction('prefs','readonly'),q=t.objectStore('prefs').get('draft-session:'+encodeURIComponent(uid));t.oncomplete=()=>resolve(q.result||null);t.onabort=()=>reject(t.error)})}finally{db.close()}}''',{'env':cfg['envId'],'uid':account['uid']})
   def start_save(text):
    p.locator('#cloudFreePractice').click();p.locator('#prepQuickText').click();p.wait_for_function("!document.querySelector('#startScene').disabled",timeout=15000);p.locator('#startScene').click();p.wait_for_function("document.body.classList.contains('room-live')",timeout=15000)
    p.locator('#focusReview').click();p.locator('#liveToolText').click();p.locator('#liveTextAnswer').fill(text);p.locator('#liveTextSave').click();p.wait_for_function("['saved','error'].includes(document.querySelector('#localSessionSaveStatus')?.dataset.status)",timeout=15000)
    return p.locator('#localSessionSaveStatus').get_attribute('data-status')
   def finish_home():
    p.locator('#focusClose').click();p.locator('#tclEndYes').click();p.locator('#reviewHome').wait_for(timeout=30000);p.locator('#reviewHome').click();home_ready()
   def collect_readonly(label):
    telemetry=p.evaluate('window.__checkpointObserve');row=checkpoint();first=next((x for x in telemetry['reads'] if x['key']=='draft-session:'+str(account['uid'])),None)
    detail={'draftReadCount':len(telemetry['reads']),'draftPutCount':len(telemetry['puts']),'firstReadMode':first['mode'] if first else None,'correctUidPartitionKey':bool(first),'initialRowSha256':sha(json.dumps(first['row'],sort_keys=True,ensure_ascii=False)) if first else None,'afterInitRowSha256':sha(json.dumps(row,sort_keys=True,ensure_ascii=False)),'writeTokenUnchanged':bool(first and first['row'] and row and first['row'].get('writeToken')==row.get('writeToken'))}
    check(label,bool(first and first['row'] and row and first['mode']=='readonly' and not telemetry['puts'] and first['row']==row and detail['writeTokenUnchanged']),detail);return row
   p.goto(a.url,wait_until='networkidle',timeout=45000);capture();p.locator('#cloudUsername').fill(account['username']);p.locator('#cloudPassword').fill(account['password']);p.locator('#cloudLoginForm button').click();home_ready()
   check('real_native_login',p.locator('#cloudLoginForm').count()==0)
   before=p.locator('#r23ModelChoice').input_value();p.locator('details.header-tools > summary').click()
   with p.expect_navigation(wait_until='networkidle',timeout=45000):p.locator('#r23ModelChoice').select_option('tiny')
   home_ready();capture();check('actual_model_control_reload_restores_native_auth',p.locator('#cloudLoginForm').count()==0 and p.locator('#r23ModelChoice').input_value()=='tiny',{'initialModel':before,'afterModel':'tiny'})
   text1='真实Auth恢复定点复验：初始化读取版本后首次保存。';check('first_text_save_after_automatic_auth_restore',start_save(text1)=='saved');seed=checkpoint();check('first_saved_draft_contains_answer',seed and any(x.get('answer')==text1 for x in seed['snapshot']['turns']));finish_home()
   # pagehide may legitimately save again; first new-document native read is the
   # baseline after that save, so only startup initialization is compared.
   p.reload(wait_until='networkidle',timeout=45000);home_ready();capture();check('existing_draft_auto_auth_restore',p.locator('#cloudLoginForm').count()==0);existing=collect_readonly('existing_draft_initialization_is_readonly_token_and_json_unchanged');check('existing_draft_resume_control_visible',p.locator('#cloudResumePractice').count()==1)
   text2='真实Auth恢复定点复验：已有草稿后明确新开练习保存正常。';check('new_practice_after_restored_existing_draft_saves',start_save(text2)=='saved');fresh=checkpoint();check('explicit_new_practice_replaces_latest_draft_with_new_run',fresh and fresh['runId']!=existing['runId'] and any(x.get('answer')==text2 for x in fresh['snapshot']['turns']));finish_home()
   p.reload(wait_until='networkidle',timeout=45000);home_ready();capture();collect_readonly('new_draft_reload_initialization_is_readonly');p.locator('#cloudResumePractice').click();p.locator('#reviewHome').wait_for(timeout=30000);p.locator('#reviewDetails').click();p.locator('textarea[aria-label="编辑本题回答"]').first.wait_for(timeout=15000);check('new_draft_restores_saved_text_after_reload',text2 in p.locator('textarea[aria-label="编辑本题回答"]').evaluate_all('(xs)=>xs.map(x=>x.value)'))
   p.screenshot(path=str(out/'restored-auth-checkpoint-fixed.png'),full_page=True,mask=[p.locator('.r2-identity-text,input[autocomplete=username],input[type=password]')]);r['browser']=b.version
   check('actual_http_app_matches_candidate_hash',bool(responses) and all(x['status']==200 and x['sha256']==expected for x in r['appResponses']));check('zero_product_page_errors',not r['pageErrors']);check('no_model_requests',not r['modelRequests']);r['status']='PASS_REAL_AUTH_CHECKPOINT_HOTFIX';b.close()
 except Exception as e:r['status']='FAIL';r['error']={'type':type(e).__name__,'frames':[{'file':Path(x.filename).name,'line':x.lineno,'function':x.name} for x in traceback.extract_tb(e.__traceback__) if str(x.filename).startswith(str(ROOT))]}
 save();print(json.dumps({'status':r['status'],'checks':len(r['checks']),'out':str(out)}));return 0 if r['status'].startswith('PASS') else 1
if __name__=='__main__':raise SystemExit(main())
