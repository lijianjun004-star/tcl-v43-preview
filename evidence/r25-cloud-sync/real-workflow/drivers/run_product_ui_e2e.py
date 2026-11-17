#!/usr/bin/env python3
"""Actual R25 product UI + real CloudBase Auth/RPC; isolated operator/anchor contexts.
Only app-config may be enabled for the localhost candidate; no SDK/business response mocks.
"""
from pathlib import Path
from urllib.parse import urlsplit
from datetime import datetime,timezone
import argparse,hashlib,json,time,re,uuid,traceback
from playwright.sync_api import sync_playwright
from run_native_pg_e2e import private_config,sha
ROOT=Path(__file__).resolve().parent

class UIAcceptance:
 def __init__(self,config,out,override):
  self.config=config;self.out=out;self.override=override;self.contexts={};self.pages={};self.responseBuffers={};self.responseCounts={};self.useEngineUI=urlsplit(config['browserUrl']).hostname not in ('localhost','127.0.0.1');self.secret_values=[str(a[k]) for a in config['accounts'].values() for k in ('username','password') if a.get(k)]
  self.report={'scope':'Actual candidate R25 UI + real CloudBase Auth/PG. Two isolated storage contexts, plus outsider. Text only; no API/SDK mocks.','browserUrl':config['browserUrl'],'environmentId':config['envId'],'configurationOverride':override,'sdkInjection':False,'businessResponseMocks':False,'enginePreferenceMethod':'actual published model selector UI' if self.useEngineUI else 'isolated local test preference','expectedAppSha256':sha(Path('/workspace/tcl-r25-cloud/experiments/r25/tcl-v352-asr-r25-qa/app.js').read_bytes()),'startedAt':datetime.now(timezone.utc).isoformat(),'status':'NOT RUN','checks':[],'actors':{},'pageErrors':[],'modelRequests':[],'productResponses':[],'configReadbacks':[],'notRun':['Physical devices','Mainland network','ASR accuracy','Backend process restart','Cloud media (separate suite)']}
 def save(self):self.out.mkdir(parents=True,exist_ok=True);(self.out/'result.json').write_text(json.dumps(self.report,ensure_ascii=False,indent=2)+'\n')
 def check(self,name,ok,detail=None):
  self.report['checks'].append({'name':name,'pass':bool(ok),'detail':detail});self.save()
  if not ok:raise AssertionError(name)
 def sanitize(self,value):
  s=str(value)
  for secret in self.secret_values:s=s.replace(secret,'[REDACTED]')
  s=re.sub(r'(?i)(authorization\s*[:=]\s*)([^\r\n]+)',r'\1[REDACTED]',s)
  s=re.sub(r'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}','[REDACTED_TOKEN]',s)
  return s[:1000]
 def screenshot(self,alias,name):
  page=self.pages[alias]
  masks=page.locator('input[type="password"],input[autocomplete="username"],.r2-identity-text,#cloudAssignments small,#cloudJoinCode')
  page.screenshot(path=str(self.out/name),full_page=True,mask=[masks])
 def actor(self,browser,alias):
  context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,locale='zh-CN');self.check(alias+'_initial_cookie_jar_empty',not context.cookies())
  # Pure text workflow: avoid default Vosk auto-download; this setting does not mock inference.
  if not self.useEngineUI:context.add_init_script("try{localStorage.setItem('tcl-r25-asr-engine','tiny')}catch{}")
  def route_inner(request):
   u=request.request.url;parsed=urlsplit(u);path=parsed.path.lower()
   if '/live-practice-room/voice/' in path or parsed.hostname in ('huggingface.co','hf-mirror.com') or 'transformers' in u or path.endswith(('.wasm','.onnx')):
    self.report['modelRequests'].append({'actor':alias,'path':path});return request.abort('blockedbyclient')
   if self.override and path.endswith('/app-config.json'):
    original=Path('/workspace/tcl-r25-cloud/experiments/r25/tcl-v352-asr-r25-qa/app-config.json').read_bytes();data=json.loads(original);data['cloudbase']={**data.get('cloudbase',{}),'enabled':True,'envId':self.config['envId'],'region':self.config.get('region','ap-shanghai'),'functionName':'r25wf_api'};effective=json.dumps(data,ensure_ascii=False).encode()
    self.report['configReadbacks'].append({'actor':alias,'originalSha256':sha(original),'effectiveSha256':sha(effective),'onlyChanged':'app-config.cloudbase test environment/enabled; localhost candidate only'})
    return request.fulfill(status=200,body=effective,headers={'content-type':'application/json'})
   return request.continue_()
  def route(request):
   try:return route_inner(request)
   except Exception as error:
    self.report.setdefault('routingErrors',[]).append({'actor':alias,'type':type(error).__name__})
    try:return request.abort('aborted')
    except Exception:return None
  context.route('**/*',route);page=context.new_page();responses=[]
  page.on('response',lambda r:responses.append(r) if urlsplit(r.url).path.endswith(('/app.js','/cloud-workspace.mjs','/cloud-workflow.mjs','/cloudbase-adapter.mjs')) else None)
  page.on('pageerror',lambda e:self.report['pageErrors'].append({'actor':alias,'error':self.sanitize(e)}));page.on('dialog',lambda d:d.accept())
  self.contexts[alias]=context;self.pages[alias]=page;self.responseBuffers[alias]=responses;self.responseCounts[alias]=0;self.report['actors'][alias]={'independentContext':True,'uidSha256':sha(str(self.config['accounts'][alias].get('uid','')))}
  page.goto(self.config['browserUrl'],wait_until='networkidle',timeout=45000)
  self.capture_responses(alias);self.login(alias)
  if alias=='anchor' and self.useEngineUI:self.select_text_engine_in_product_ui(alias)
 def capture_responses(self,alias):
  responses=self.responseBuffers[alias]
  while self.responseCounts[alias]<len(responses):
   response=responses[self.responseCounts[alias]];self.report['productResponses'].append({'actor':alias,'path':urlsplit(response.url).path,'status':response.status,'sha256':sha(response.body())});self.responseCounts[alias]+=1
 def select_text_engine_in_product_ui(self,alias):
  page=self.pages[alias];before=page.locator('#r23ModelChoice').input_value()
  if before!='tiny':
   page.locator('details.header-tools > summary').click()
   with page.expect_navigation(wait_until='networkidle',timeout=45000):page.locator('#r23ModelChoice').select_option('tiny')
   self.capture_responses(alias);page.wait_for_selector('#cloudRefresh,#cloudLoginForm',timeout=45000)
   if page.locator('#cloudLoginForm').count():self.login(alias)
   else:page.wait_for_function("document.querySelector('[data-cloud-status]')?.textContent.includes('云端已更新')",timeout=45000)
  self.report['publicModelPreference']={'initialSelected':before,'selectedAfterUserControl':page.locator('#r23ModelChoice').input_value(),'method':'Actual header tools/model select + native confirm/reload; no init script or configuration injection'}
  self.check('public_text_test_model_preference_uses_actual_product_control',page.locator('#r23ModelChoice').input_value()=='tiny')
 def login(self,alias):
  page=self.pages[alias];a=self.config['accounts'][alias]
  page.locator('#cloudUsername').wait_for(timeout=30000);page.locator('#cloudUsername').fill(a['username']);page.locator('#cloudPassword').fill(a['password']);page.locator('#cloudLoginForm button').click();page.locator('#cloudRefresh').wait_for(timeout=45000)
  page.wait_for_function("document.querySelector('[data-cloud-status]')?.textContent.includes('云端已更新')",timeout=45000)
  self.check(alias+'_actual_product_login_and_server_refresh',True)
 def refresh(self,alias):
  page=self.pages[alias];page.locator('#cloudRefresh').click();page.wait_for_function("document.querySelector('[data-cloud-status]')?.textContent.includes('云端已更新')",timeout=45000)
 def pending(self,alias,assignment_id):
  uid=str(self.config['accounts'][alias]['uid']);env=self.config['envId']
  return self.pages[alias].evaluate(r'''async ({uid,env,assignmentId})=>{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('r25-cloud-outbox:'+env+':'+uid);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});try{return await new Promise((resolve,reject)=>{const t=db.transaction('operations','readonly'),q=t.objectStore('operations').getAll();t.oncomplete=()=>resolve(q.result.filter(x=>x.action==='submissions.create'&&x.payload.assignmentId===assignmentId).map(x=>({operationId:x.operationId,status:x.status,submissionId:x.payload.id,receiptId:x.receipt?.receiptId||null})));t.onabort=()=>reject(t.error)})}finally{db.close()}}''',{'uid':uid,'env':env,'assignmentId':assignment_id})
 def run(self):
  run='r25-ui-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:5];self.report['runId']=run;answers=[run+' 第一题：核对T7M Pro型号与正式参数。',run+' 第二题：以资料确认75寸与接口规格。'];title=run+' 两题文字作业';feedback=run+' 运营反馈：型号表达清楚，参数须查正式资料。'
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
   try:
    for alias in ('operator','anchor','outsider'):self.actor(browser,alias)
    operator=self.pages['operator'];anchor=self.pages['anchor'];outsider=self.pages['outsider']
    app_responses=[x for x in self.report['productResponses'] if x['path'].endswith('/app.js')];self.check('actual_candidate_app_responses_match_frozen_source',len(app_responses)>=3 and all(x['status']==200 and x['sha256']==self.report['expectedAppSha256'] for x in app_responses),app_responses)
    operator.locator('#cloudAssignmentTitle').fill(title);operator.locator('#cloudAssignmentBoard').select_option('01');operator.locator('#cloudAssignmentPlatform').select_option('京东');operator.locator('#cloudPublishAssignment').click()
    row=operator.locator('#cloudAssignments article').filter(has_text=title);row.wait_for(timeout=45000);task_id=row.locator('[data-cloud-assignment]').get_attribute('data-cloud-assignment');match=re.search(r'作业口令\s*([0-9a-f]{12})',row.inner_text(),re.I)
    self.check('operator_published_real_cloud_task_with_join_code',bool(task_id) and bool(match));join_code=match.group(1);self.report['assignmentId']=task_id;self.screenshot('operator','01-operator-task-published.png')
    self.refresh('anchor');self.check('unjoined_task_not_in_anchor_list',anchor.locator(f'[data-cloud-assignment="{task_id}"]').count()==0)
    anchor.locator('#cloudJoinCode').fill(join_code);anchor.locator('#cloudJoinByCode').click();anchor.locator('#prepQuickText').wait_for(timeout=45000);anchor.locator('#prepQuickText').click();anchor.wait_for_function("!document.querySelector('#startScene').disabled",timeout=15000);anchor.locator('#startScene').click();anchor.wait_for_function("document.body.classList.contains('room-live')",timeout=15000)
    for index,text in enumerate(answers):
     anchor.locator('#focusReview').click();anchor.locator('#liveToolText').click();anchor.locator('#liveTextAnswer').fill(text);anchor.locator('#liveTextSave').click();anchor.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='saved'",timeout=15000)
     if not index:anchor.locator('#focusNext').click();anchor.wait_for_function("/第\\s*2\\s*题/.test(document.querySelector('#liveQIndex')?.textContent||'')",timeout=15000)
    anchor.locator('#focusClose').click();anchor.locator('#tclEndYes').click();anchor.locator('#cloudSubmitText').wait_for(timeout=30000);self.report['submissionScopeControls']={'textCheckbox':anchor.locator('#cloudTextOnlyConsent').count(),'scopeRadios':anchor.locator('input[name=cloudSubmissionMode]').count()};self.save()
    if anchor.locator('#cloudTextOnlyConsent').count():anchor.locator('#cloudTextOnlyConsent').check()
    else:anchor.locator('input[name=cloudSubmissionMode][value=text]').check()
    anchor.wait_for_function("document.querySelector('#cloudSubmitOperator')?.options.length>1||document.querySelector('.review-submit-card [data-cloud-status]')?.classList.contains('error')",timeout=30000)
    receiver=anchor.locator('#cloudSubmitOperator');status_text=anchor.locator('.review-submit-card [data-cloud-status]').inner_text();receiver_state={'selectedUidSha256':sha(receiver.input_value()),'expectedUidSha256':sha(str(self.config['accounts']['operator']['uid'])),'disabled':receiver.is_disabled(),'optionCount':receiver.locator('option').count(),'errorState':anchor.locator('.review-submit-card [data-cloud-status]').get_attribute('class'),'reason':'ASSIGNMENT_RECEIVER_NOT_LOADED' if '作业接收人信息未加载' in status_text else 'LOADING' if '正在读取' in status_text else 'READY_OR_OTHER'}
    self.report['receiverReadback']=receiver_state
    self.check('assignment_receiver_server_uid_selected',receiver.input_value()==str(self.config['accounts']['operator']['uid']) and receiver.is_disabled(),receiver_state)
    self.contexts['anchor'].set_offline(True)
    try:
     anchor.locator('#cloudSubmitText').click();anchor.wait_for_function("document.querySelector('.review-submit-card [data-cloud-status]')?.classList.contains('error')",timeout=45000)
     status=anchor.locator('.review-submit-card [data-cloud-status]').inner_text();button=anchor.locator('#cloudSubmitText');self.check('offline_ui_does_not_claim_delivery','云端已确认' not in status and '已获云端回执' not in button.inner_text() and button.get_attribute('data-confirmed')!='1')
     pending=self.pending('anchor',task_id);self.check('offline_submission_is_persisted_as_pending_not_confirmed',len(pending)==1 and pending[0]['status']=='pending' and not pending[0]['receiptId']);self.report['offlineOperation']=pending[0];self.screenshot('anchor','02-anchor-offline-not-delivered.png')
    finally:self.contexts['anchor'].set_offline(False)
    sid=pending[0]['submissionId'];self.refresh('operator');self.check('operator_does_not_receive_failed_submission',operator.locator(f'[data-cloud-submission="{sid}"]').count()==0)
    anchor.locator('#cloudSubmitText').click();anchor.wait_for_selector('#cloudSubmitText[data-confirmed="1"]',timeout=45000);confirmed=self.pending('anchor',task_id);self.check('online_retry_same_operation_receives_real_receipt',len(confirmed)==1 and confirmed[0]['operationId']==pending[0]['operationId'] and confirmed[0]['status']=='confirmed' and confirmed[0]['receiptId']==sid);self.report['submissionId']=sid;self.screenshot('anchor','03-anchor-real-receipt.png')
    self.refresh('operator');operator.locator(f'[data-cloud-submission="{sid}"]').wait_for(timeout=30000);self.check('operator_ui_receives_one_submission',operator.locator(f'[data-cloud-submission="{sid}"]').count()==1);operator.locator(f'[data-cloud-submission="{sid}"]').click();operator.locator('#cloudFeedbackBody').wait_for(timeout=30000)
    detail=operator.locator('#cloudDetail').inner_text();self.check('operator_reads_both_original_answers',all(x in detail for x in answers));operator.locator('#cloudFeedbackBody').fill(feedback);operator.locator('#cloudSaveFeedback').click();operator.locator('#cloudDetail .cloud-feedback').filter(has_text=feedback).wait_for(timeout=30000);self.screenshot('operator','04-operator-inbox-and-feedback.png')
    anchor.locator('#reviewHome').click();anchor.locator('#cloudRefresh').wait_for(timeout=30000);self.refresh('anchor');anchor.locator(f'[data-cloud-submission="{sid}"]').click();anchor.locator('#cloudDetail .cloud-feedback').filter(has_text=feedback).wait_for(timeout=30000);self.check('anchor_ui_reads_persisted_operator_feedback',True);self.screenshot('anchor','05-anchor-feedback-returned.png')
    self.refresh('outsider');self.check('outsider_ui_does_not_list_other_submission',outsider.locator(f'[data-cloud-submission="{sid}"]').count()==0);self.check('outsider_ui_does_not_list_unjoined_task',outsider.locator(f'[data-cloud-assignment="{task_id}"]').count()==0)
    for alias in ('operator','anchor'):
     page=self.pages[alias];page.reload(wait_until='networkidle');page.wait_for_selector('#cloudRefresh,#cloudLoginForm',timeout=45000)
     needs_login=page.locator('#cloudLoginForm').count()>0;self.report['actors'][alias]['reloadRequiredLogin']=needs_login
     if needs_login:self.login(alias)
     else:self.refresh(alias)
     page.locator(f'[data-cloud-submission="{sid}"]').click();page.locator('#cloudDetail .cloud-feedback').filter(has_text=feedback).wait_for(timeout=30000);self.check(alias+'_reload_still_reads_server_submission_and_feedback',True);self.screenshot(alias,f'06-{alias}-refreshed-cloud-record.png')
    self.check('zero_product_page_errors',not self.report['pageErrors']);self.check('no_model_download_or_inference_requests',not self.report['modelRequests']);self.report['browser']=browser.version;self.report['status']='PASS_PRODUCT_UI_REAL_CLOUD'
   finally:browser.close()
  self.save()

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');parser.add_argument('--private-config',required=False);parser.add_argument('--browser-url',default='http://127.0.0.1:8765/tcl-v352-asr-r25-qa/');parser.add_argument('--enable-test-config',action='store_true');parser.add_argument('--out',default=str(ROOT/'results/product-ui'));args=parser.parse_args()
 if not args.execute:print(json.dumps({'status':'PREPARED_NOT_EXECUTED','cloudWrites':0,'userCreation':0}));return
 contract=json.loads((ROOT/'contract.json').read_text())
 if contract.get('confirmed') is not True:raise SystemExit('SQL contract/role binding not confirmed; no browser or cloud operation executed.')
 if not args.private_config:raise SystemExit('Private config path required; no operation executed.')
 config=private_config(args.private_config);config['browserUrl']=args.browser_url
 if args.enable_test_config and urlsplit(args.browser_url).hostname not in ('localhost','127.0.0.1'):raise SystemExit('Test configuration override is restricted to localhost candidates.')
 run=UIAcceptance(config,Path(args.out),args.enable_test_config)
 try:run.run()
 except Exception as error:run.report['status']='FAIL';run.report['error']={'type':type(error).__name__,'summary':'UI verification step failed; raw exception omitted to protect credentials','frames':[{'file':Path(x.filename).name,'line':x.lineno,'function':x.name} for x in traceback.extract_tb(error.__traceback__) if str(x.filename).startswith(str(ROOT))]};run.save();print(json.dumps({'status':'FAIL','errorType':type(error).__name__,'detailsFile':'result.json'}));raise SystemExit(1)
 print(json.dumps({'status':run.report['status'],'checks':len(run.report['checks']),'out':str(run.out)}))
if __name__=='__main__':main()
