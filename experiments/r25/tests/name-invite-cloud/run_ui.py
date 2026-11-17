#!/usr/bin/env python3
"""Actual product UI signup/name-login, isolated contexts, real business workflow.
Optional CDP response loss uses Chromium's real network; never Route.fetch/mock.
"""
from pathlib import Path
from urllib.parse import urlsplit
import argparse,json,re,uuid,time,base64
from common import Evidence,private_fixture,sha
ROOT=Path(__file__).resolve().parent
SOURCE=Path('/workspace/tcl-r25-name-login/experiments/r25/tcl-v352-asr-r25-qa')

class UI(Evidence):
 def run(self,response_loss=False):
  from playwright.sync_api import sync_playwright
  self.pages={};self.contexts={};self.identities={};self.report.update({'sdkInjection':False,'configurationOverride':False,'businessMocks':False,'pageErrors':[],'modelRequests':[],'appResponses':[],'expectedAppSha256':sha((SOURCE/'app.js').read_bytes())})
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=self.config.get('chromium','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
   try:
    for alias in ('operator','anchor','outsider'):self.signup(browser,alias,response_loss and alias=='anchor')
    operator=self.pages['operator'];anchor=self.pages['anchor'];outsider=self.pages['outsider']
    # Daily UI login is a new independent context with native Auth, using name.
    self.daily_login(browser,'anchor')
    title='姓名开户实际UI-'+uuid.uuid4().hex[:8];operator.locator('#cloudAssignmentTitle').fill(title);operator.locator('#cloudAssignmentBoard').select_option('01');operator.locator('#cloudAssignmentPlatform').select_option('京东');operator.locator('#cloudPublishAssignment').click();row=operator.locator('#cloudAssignments article').filter(has_text=title);row.wait_for(timeout=45000);task_id=row.locator('[data-cloud-assignment]').get_attribute('data-cloud-assignment');code=re.search(r'作业口令\s*([0-9a-f]{12})',row.inner_text(),re.I).group(1)
    self.check('new_operator_ui_publishes_real_task',bool(task_id));self.refresh('outsider');self.check('other_anchor_does_not_list_unjoined_task',outsider.locator(f'[data-cloud-assignment="{task_id}"]').count()==0)
    anchor.locator('details.header-tools > summary').click()
    with anchor.expect_navigation(wait_until='networkidle',timeout=45000):anchor.locator('#r23ModelChoice').select_option('tiny')
    self.ready(anchor);self.capture_apps('anchor');self.check('new_native_session_survives_actual_model_reload',anchor.locator('#cloudLoginForm').count()==0)
    anchor.locator('#cloudJoinCode').fill(code);anchor.locator('#cloudJoinByCode').click();anchor.locator('#prepQuickText').wait_for(timeout=45000);anchor.locator('#prepQuickText').click();anchor.wait_for_function("!document.querySelector('#startScene').disabled",timeout=15000);anchor.locator('#startScene').click();anchor.wait_for_function("document.body.classList.contains('room-live')",timeout=15000)
    answer=title+' 新姓名独立主播的文字回答。';anchor.locator('#focusReview').click();anchor.locator('#liveToolText').click();anchor.locator('#liveTextAnswer').fill(answer);anchor.locator('#liveTextSave').click();anchor.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='saved'",timeout=15000);self.check('new_anchor_first_text_save_after_auth_restore',True);anchor.locator('#focusClose').click();anchor.locator('#tclEndYes').click();anchor.locator('#cloudSubmitText').wait_for(timeout=30000)
    if anchor.locator('#cloudTextOnlyConsent').count():anchor.locator('#cloudTextOnlyConsent').check()
    else:anchor.locator('input[name=cloudSubmissionMode][value=text]').check()
    anchor.wait_for_function("document.querySelector('#cloudSubmitOperator')?.options.length>1",timeout=30000);receiver=anchor.locator('#cloudSubmitOperator');self.check('assignment_receiver_is_actual_new_operator',receiver.input_value()==str(self.identities['operator']['uid']) and receiver.is_disabled())
    anchor.locator('#cloudSubmitText').click();anchor.locator('#cloudSubmitText[data-confirmed="1"]').wait_for(timeout=45000);self.check('new_anchor_ui_receives_real_submit_receipt',True)
    self.refresh('operator');operator.locator('#cloudSubmissions [data-cloud-submission]').first.click();operator.locator('#cloudFeedbackBody').wait_for(timeout=30000);self.check('new_operator_reads_new_anchor_answer',answer in operator.locator('#cloudDetail').inner_text());feedback=title+' 实际反馈';operator.locator('#cloudFeedbackBody').fill(feedback);operator.locator('#cloudSaveFeedback').click();operator.locator('#cloudDetail .cloud-feedback').filter(has_text=feedback).wait_for(timeout=30000)
    sid=operator.locator('#cloudDetail').get_attribute('data-submission-id');anchor.locator('#reviewHome').click();self.refresh('anchor');anchor.locator(f'[data-cloud-submission="{sid}"]').click();anchor.locator('#cloudDetail .cloud-feedback').filter(has_text=feedback).wait_for(timeout=30000);self.check('new_anchor_reads_new_operator_feedback',True)
    self.refresh('outsider');self.check('separate_other_context_has_no_submission',outsider.locator(f'[data-cloud-submission="{sid}"]').count()==0)
    anchor.reload(wait_until='networkidle');self.ready(anchor);anchor.locator(f'[data-cloud-submission="{sid}"]').click();anchor.locator('#cloudDetail .cloud-feedback').filter(has_text=feedback).wait_for(timeout=30000);self.check('reload_keeps_native_identity_and_cloud_feedback',True)
    for alias in ('operator','anchor'):self.shot(alias,alias+'-new-name-workflow.png')
    self.check('all_actual_http_app_hashes_match_candidate',bool(self.report['appResponses']) and all(x['status']==200 and x['sha256']==self.report['expectedAppSha256'] for x in self.report['appResponses']));self.check('no_product_page_errors',not self.report['pageErrors']);self.check('no_model_downloads',not self.report['modelRequests']);self.report['browser']=browser.version
   finally:browser.close();self.report['contextsClosed']=True
  self.finish()
 def ready(self,page):
  page.locator('#cloudRefresh').wait_for(timeout=45000);page.wait_for_function("document.querySelector('[data-cloud-status]')?.textContent.includes('云端已更新')",timeout=45000)
 def refresh(self,alias):self.pages[alias].locator('#cloudRefresh').click();self.ready(self.pages[alias])
 def shot(self,alias,name):
  p=self.pages[alias];p.screenshot(path=str(self.out/name),full_page=True,mask=[p.locator('input[type=password],input[autocomplete=username],.r2-identity-text,#cloudAssignments small,#cloudJoinCode')])
 def capture_apps(self,alias):
  state=self.responses[alias]
  while state['captured']<len(state['items']):
   response=state['items'][state['captured']];self.report['appResponses'].append({'actor':alias,'status':response.status,'sha256':sha(response.body())});state['captured']+=1
 def page(self,browser,alias):
  if not hasattr(self,'responses'):self.responses={}
  ctx=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,locale='zh-CN');self.contexts[alias]=ctx;p=ctx.new_page();p.on('dialog',lambda d:d.accept());p.on('pageerror',lambda e:self.report['pageErrors'].append({'actor':alias,'type':type(e).__name__}));self.pages[alias]=p;self.responses[alias]={'items':[],'captured':0}
  p.on('response',lambda response:self.responses[alias]['items'].append(response) if urlsplit(response.url).path.endswith('/app.js') else None)
  def route(r):
   path=urlsplit(r.request.url).path.lower()
   if '/live-practice-room/voice/' in path or path.endswith(('.wasm','.onnx')) or urlsplit(r.request.url).hostname in ('huggingface.co','hf-mirror.com'):
    self.report['modelRequests'].append({'actor':alias,'path':path});r.abort('blockedbyclient')
   else:r.continue_()
  ctx.route('**/*',route);p.goto(self.config['browserUrl'],wait_until='networkidle',timeout=45000);self.capture_apps(alias);return p
 def signup(self,browser,alias,loss):
  p=self.page(browser,alias);acct=self.config['newAccounts'][alias];replies=[];requests=[]
  def response(response):
   if response.url==self.config['registrationEndpoint']:
    try:
     body=response.json()
     if body.get('ok') and body.get('data',{}).get('state')=='ready':replies.append(body['data'])
    except Exception:pass
  def request(request):
   if request.url==self.config['registrationEndpoint'] and request.method=='POST':
    try:requests.append(json.loads(request.post_data))
    except Exception:pass
  p.on('response',response);p.on('request',request);cdp=None;drops=[];errors=[]
  if loss:
   cdp=self.contexts[alias].new_cdp_session(p)
   def paused(event):
    rid=event['requestId']
    try:
     post=json.loads(event.get('request',{}).get('postData') or '{}')
     if post.get('action')!='register' or drops:return cdp.send('Fetch.continueResponse',{'requestId':rid})
     raw=cdp.send('Fetch.getResponseBody',{'requestId':rid});data=json.loads(base64.b64decode(raw['body']) if raw.get('base64Encoded') else raw['body'])
     if event.get('responseStatusCode')!=200 or not(data.get('ok') and data.get('data',{}).get('state')=='ready'):return cdp.send('Fetch.continueResponse',{'requestId':rid})
     drops.append({'uid':str(data['data']['uid']),'operation':post});cdp.send('Fetch.failRequest',{'requestId':rid,'errorReason':'ConnectionClosed'})
    except Exception as e:
     errors.append(type(e).__name__)
     try:cdp.send('Fetch.failRequest',{'requestId':rid,'errorReason':'Aborted'})
     except Exception:pass
   cdp.on('Fetch.requestPaused',paused);cdp.send('Fetch.enable',{'patterns':[{'urlPattern':self.config['registrationEndpoint'],'requestStage':'Response'}]})
  p.locator('#cloudJoinTab').click();p.locator('#cloudRegisterName').fill(acct['name']);p.locator('#cloudRegisterPassword').fill(acct['password']);p.locator('#cloudInvitationCode').fill(acct['inviteCode']);p.locator('#cloudRegisterForm button[type=submit]').click()
  if loss:
   deadline=time.monotonic()+45
   while not drops and not errors and time.monotonic()<deadline:p.wait_for_timeout(100)
   self.check('cdp_dropped_actual_ready_enrollment_response',bool(drops) and not errors,{'dropCount':len(drops),'callbackErrors':errors})
   p.wait_for_function("document.querySelector('[data-cloud-status]')?.classList.contains('error')",timeout=15000);self.check('lost_ready_response_not_shown_as_logged_in',p.locator('#cloudRefresh').count()==0);cdp.send('Fetch.disable')
   p.locator('#cloudRegisterPassword').fill(acct['password']);p.locator('#cloudInvitationCode').fill(acct['inviteCode']);p.locator('#cloudRegisterForm button[type=submit]').click()
  self.ready(p);data=next((x for x in reversed(replies) if x.get('uid')),None);self.check(alias+'_actual_ui_chinese_name_enrollment',bool(data));self.identities[alias]=data
  self.check(alias+'_password_and_invite_not_persisted_in_web_storage',p.evaluate('(s)=>![...Object.values(localStorage),...Object.values(sessionStorage)].some(v=>s.some(x=>v.includes(x)))',[acct['password'],acct['inviteCode']]))
  storage=p.evaluate(r'''async({env,secretValues})=>{const name='r25-name-identity:'+encodeURIComponent(env),exists=(await indexedDB.databases()).some(x=>x.name===name);if(!exists)return {exists:false,safe:false};const db=await new Promise((resolve,reject)=>{const q=indexedDB.open(name);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});try{return await new Promise((resolve,reject)=>{const t=db.transaction('operations','readonly'),q=t.objectStore('operations').getAll();t.oncomplete=()=>{const rows=q.result,text=JSON.stringify(rows);resolve({exists:true,rowCount:rows.length,safe:rows.length>0&&!secretValues.some(x=>text.includes(x))&&!rows.some(x=>Object.keys(x).some(k=>/password|inviteCode/i.test(k)))});};t.onabort=()=>reject(t.error)})}finally{db.close()}}''',{'env':self.config['envId'],'secretValues':[acct['password'],acct['inviteCode']]})
  self.check(alias+'_registration_indexeddb_persists_no_password_or_invite',storage.get('safe') is True,storage)
  if loss:
   statuses=[x for x in requests if x.get('action')=='status'];old=drops[0]['operation'];self.check('response_loss_recovered_same_operation_secret_uid',str(data['uid'])==drops[0]['uid'] and any(x.get('operationId')==old.get('operationId') and x.get('operationSecret')==old.get('operationSecret') for x in statuses));self.report['lossRecovery']={'transport':'Actual Chromium CDP response stage','uidSha256':sha(data['uid']),'registerRequests':sum(x.get('action')=='register' for x in requests),'statusRequests':len(statuses),'operationSecretsLogged':False}
  requests.clear();self.shot(alias,alias+'-signup-complete.png')
 def daily_login(self,browser,alias):
  key=alias+'-daily';p=self.page(browser,key);acct=self.config['newAccounts'][alias];p.locator('#cloudNameLoginTab').click();p.locator('#cloudUsername').fill(acct['name']);p.locator('#cloudPassword').fill(acct['password']);p.locator('#cloudLoginForm button[type=submit]').click();self.ready(p);self.check(alias+'_separate_context_daily_name_password_login',True)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--execute',action='store_true');ap.add_argument('--private-fixture');ap.add_argument('--response-loss',action='store_true');ap.add_argument('--out',default=str(ROOT/'results/ui'));a=ap.parse_args()
 if not a.execute:print(json.dumps({'status':'DRY_RUN_ZERO_NETWORK','script':str(Path(__file__)),'networkRequests':0,'browserLaunches':0}));return 0
 if not a.private_fixture:raise SystemExit('Private fixture required; no operation executed')
 cfg=private_fixture(a.private_fixture,True);run=UI(a.out,cfg,'ACTUAL_NAME_INVITE_PRODUCT_UI')
 try:run.run(a.response_loss)
 except Exception as e:run.fail(e)
 print(json.dumps({'status':run.report['status'],'checks':len(run.report['checks']),'out':str(run.out)}));return 1 if run.report['status']=='FAIL' else 0
if __name__=='__main__':raise SystemExit(main())
