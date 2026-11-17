#!/usr/bin/env python3
"""Two isolated Chromium storage contexts + official CloudBase JS SDK + real native PG RPC.
No user creation, mocks, admin service key, or business call occurs without --execute.
"""
from pathlib import Path
from urllib.parse import urlsplit
from datetime import datetime,timezone,timedelta
import argparse,hashlib,json,os,stat,time,uuid,traceback,urllib.request,urllib.error
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent

def sha(value):return hashlib.sha256(value if isinstance(value,bytes) else value.encode()).hexdigest()
def private_config(path):
 p=Path(path).resolve(strict=True)
 if not p.is_relative_to(Path('/workspace')):raise ValueError('Private config must stay inside /workspace')
 if p.is_symlink() or not stat.S_ISREG(p.stat().st_mode) or p.stat().st_mode&0o077:raise ValueError('Private config must be an owner-only regular file (0600)')
 d=json.loads(p.read_text());accounts=d.get('accounts',{})
 if isinstance(accounts,list):
  accounts={a.get('alias',a.get('role','')):a for a in accounts if a.get('alias',a.get('role','')) in ('operator','anchor','outsider','admin')}
 d['accounts']=accounts
 for alias in ('operator','anchor','outsider'):
  a=accounts.get(alias,{})
  if not a.get('username') or not a.get('password'):raise ValueError('Private config requires operator/anchor/outsider aliases with credentials')
 if len({accounts[a]['username'] for a in ('operator','anchor','outsider')})!=3:raise ValueError('Three distinct test accounts are required')
 return d

class Contract:
 def __init__(self,data):self.data=data;self.actions=data['actions'];self.keys=data['keys'];self.shapes=data.get('payloadShapes',{})
 def action(self,key):return self.actions[key]
 def entity(self,data,key):return data[self.keys[key]]
 def rows(self,data):return data[self.keys['items']]
 def id(self,row):return str(row[self.keys['id']])
 def task(self,run,task_id):
  return {'id':task_id,'title':run+' 两题跨设备验收','boardId':'01','platform':'京东','deadline':(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()}
 def join(self,join_code):return {'joinCode':join_code}
 def submission(self,run,task_id,operator_uid,session_id,submission_id):
  now=datetime.now(timezone.utc).isoformat()
  snap={'id':session_id,'sessionId':session_id,'assignmentId':task_id,'operatorId':operator_uid,'boardId':'01','category':'TCL 电视','platform':'京东','startedAt':now,'endedAt':now,'durationSeconds':8,'turns':[
   {'id':str(uuid.uuid4()),'prompt':run+' 第一题：请说明电视型号。','answer':'T7M Pro 75寸，参数须核对正式资料。','transcript':'T7M Pro 75寸，参数须核对正式资料。','model':'T7M Pro','sku':'TEST-ONLY-75','sourceRef':run+' 合成测试表第1行','sourceLocators':[run+'!A2'],'manualEdited':True,'manualCleared':False},
   {'id':str(uuid.uuid4()),'prompt':run+' 第二题：人工清空不应被替代。','answer':'','transcript':'晚到候选不代表人工答案','manualEdited':True,'manualCleared':True,'model':'','sku':'','sourceRef':run+' 合成测试表第2行','sourceLocators':[run+'!A3']}]}
  if self.shapes.get('submissionCreate')=='snapshot':return {'id':submission_id,'sessionId':session_id,'assignmentId':task_id,'operatorId':operator_uid,'snapshot':snap,'media':[]}
  return {'id':submission_id,**snap,'media':[]}
 def get(self,identifier):return {self.shapes.get('getIdField','id'):identifier}
 def feedback(self,submission_id,body):return {'submissionId':submission_id,'body':body}
 def feedback_query(self,submission_id):return {'submissionId':submission_id}

class LiveRun:
 def __init__(self,config,contract,out):
  self.config=config;self.contract=contract;self.out=out;self.pages={};self.contexts={};self.uid={};self.raw_secrets=[]
  for account in config['accounts'].values():self.raw_secrets.extend([account.get('username',''),account.get('password','')])
  self.report={'scope':'REAL official SDK Auth + native PG RPC across isolated Chromium storage contexts; API contract layer, not product-UI acceptance','startedAt':datetime.now(timezone.utc).isoformat(),'environmentId':config['envId'],'browserUrl':config['browserUrl'],'contractVersion':contract.data['version'],'sourceContractSha256':contract.data.get('sourceContractSha256'),'deployedSchemaSha256':contract.data.get('deployedSchemaSha256'),'deploymentEvidence':contract.data.get('deploymentEvidence'),'adapterBuild':json.loads((ROOT/'adapter-build.json').read_text()),'checks':[],'operations':[],'actors':{},'status':'NOT RUN','notRun':['Real phones','Mainland network','ASR accuracy','Backend process restart','Private cloud media','Full product UI (separate UI driver required)']}
 def redact(self,value):
  text=str(value)
  for s in self.raw_secrets:
   if s:text=text.replace(s,'[REDACTED]')
  return text[:1000]
 def record(self):self.out.mkdir(parents=True,exist_ok=True);(self.out/'result.json').write_text(json.dumps(self.report,ensure_ascii=False,indent=2)+'\n')
 def check(self,name,ok,detail=None):
  self.report['checks'].append({'name':name,'pass':bool(ok),'detail':detail});self.record()
  if not ok:raise AssertionError(name)
 def client(self,page):
  page.add_script_tag(path=str(ROOT/'browser-client.bundle.js'))
  public={'clientConfig':{'env':self.config['envId'],'region':self.config.get('region','ap-shanghai'),'persistence':'local',**self.config.get('sdkInit',{})},'authOptions':self.config.get('authOptions',{'persistence':'local'}),'rpcName':self.contract.data.get('rpcName','r25wf_api'),'rdbOptions':self.config.get('rdbOptions',{})}
  page.evaluate('c=>{window.__r25AcceptanceClient=R25AcceptanceSDK.createClient(c)}',public)
 def actor(self,browser,alias):
  context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,locale='zh-CN')
  self.check(alias+'_initial_context_has_no_cookies',not context.cookies())
  page=context.new_page();page.goto(self.config['browserUrl'],wait_until='domcontentloaded',timeout=45000);self.client(page);self.pages[alias]=page;self.contexts[alias]=context
  if alias!='anonymous':self.sign_in(alias)
  return page
 def sign_in(self,alias):
  account=self.config['accounts'][alias];reply=self.pages[alias].evaluate('c=>window.__r25AcceptanceClient.signIn(c)',{'username':account['username'],'password':account['password']})
  self.check(alias+'_real_auth_login',reply.get('ok') is True,{'errorCode':reply.get('error',{}).get('code')})
  uid=str(reply['data']['uid']);expected=account.get('uid')
  self.check(alias+'_authenticated_uid_matches_provisioned_user',not expected or uid==str(expected))
  self.uid[alias]=uid;self.report['actors'][alias]={'uidSha256':sha(uid),'independentContext':True};self.record()
 def call(self,alias,key,payload=None,operation_id=None,expect_ok=True):
  start=time.monotonic();action=self.contract.action(key);reply=self.pages[alias].evaluate('args=>window.__r25AcceptanceClient.call(...args)',[action,payload or {},operation_id])
  self.report['operations'].append({'actor':alias,'action':action,'operationId':operation_id,'ok':reply.get('ok') is True,'errorCode':reply.get('error',{}).get('code'),'seconds':round(time.monotonic()-start,3)});self.record()
  if expect_ok:self.check(alias+'_'+key+'_confirmed',reply.get('ok') is True,{'errorCode':reply.get('error',{}).get('code')})
  return reply
 def denied(self,alias,key,payload=None,op=None,name=None,conflict=False):
  reply=self.call(alias,key,payload,op,False);expected=self.contract.data['idempotencyConflictCodes' if conflict else 'denialCodes']+(self.contract.data.get('providerDenialCodes',[]) if alias=='anonymous' else []);code=reply.get('error',{}).get('code')
  self.check(name or alias+'_'+key+'_server_denied',reply.get('ok') is False and code in expected,{'errorCode':code});return reply
 def anonymous_http_probe(self):
  url=self.pages['anonymous'].evaluate('()=>window.__r25AcceptanceClient.gatewayRPCUrl()')
  parsed=urlsplit(url)
  if parsed.scheme!='https' or not parsed.netloc or parsed.username or parsed.password or parsed.query:raise ValueError('Unexpected official PG endpoint')
  request=urllib.request.Request(url,data=json.dumps({'action':'me','payload':{},'operation_id':None}).encode(),headers={'Content-Type':'application/json'},method='POST')
  try:
   with urllib.request.urlopen(request,timeout=30) as response:status=response.status;body=response.read(4096)
  except urllib.error.HTTPError as error:status=error.code;body=error.read(4096)
  try:
   data=json.loads(body);response_code=data.get('code') or data.get('error',{}).get('code') or data.get('error_code')
  except Exception:response_code='NON_JSON'
  evidence={'httpStatus':status,'bodyCode':response_code,'endpointOrigin':parsed.scheme+'://'+parsed.netloc,'endpointPath':parsed.path,'authorizationHeaderSent':False,'cookiesSent':False}
  self.report['anonymousHttpProbe']=evidence
  self.check('anonymous_direct_native_pg_http_is_server_denied',status in (401,403),evidence)
 def reload(self,alias):
  self.pages[alias].reload(wait_until='domcontentloaded');self.client(self.pages[alias]);self.sign_in(alias)
 def run_auth_only(self):
  self.report['scope']='REAL CloudBase username/password Auth only; isolated browser storage contexts; no native business RPC or user creation'
  self.report['notRun']=['Business RPC and role bindings','Task/submission/feedback workflow','Full product UI','Private media','Real devices']
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
   try:
    aliases=[x for x in ('operator','anchor','outsider','admin') if x in self.config['accounts']]
    for alias in aliases:self.actor(browser,alias)
    self.check('all_authenticated_principals_are_distinct',len({self.uid[x] for x in aliases})==len(aliases))
    for alias in aliases:
     current=self.pages[alias].evaluate('()=>window.__r25AcceptanceClient.session()')
     self.check(alias+'_session_remains_own_after_other_logins',current.get('ok') is True and str(current['data']['uid'])==self.uid[alias])
    self.report['status']='PASS_AUTH_ONLY';self.report['browser']=browser.version
   finally:browser.close()
  self.record()
 def run(self):
  run='r25-e2e-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:6];self.report['runId']=run
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
   try:
    for alias in ('operator','anchor','outsider','admin','anonymous'):
     if alias!='admin' or 'admin' in self.config['accounts']:self.actor(browser,alias)
    self.check('real_principals_are_distinct',len({self.uid[k] for k in ('operator','anchor','outsider')})==3)
    for alias,role in (('operator','operator'),('anchor','anchor')):
     user=self.contract.entity(self.call(alias,'me')['data'],'user');self.check(alias+'_server_profile_matches_auth',str(user.get('uid',user.get('id','')))==self.uid[alias] and user.get('role')==role)
    anonymous=self.call('anonymous','me',expect_ok=False);self.check('anonymous_sdk_produced_no_successful_receipt',anonymous.get('ok') is False,{'errorCode':anonymous.get('error',{}).get('code'),'scope':'Client observation only; server authorization proved separately'})
    self.anonymous_http_probe()
    task_id=str(uuid.uuid4());op_task=str(uuid.uuid4());task=self.contract.task(run,task_id)
    result=self.call('operator','assignmentCreate',task,op_task);created=self.contract.entity(result['data'],'assignment');task_id=self.contract.id(created)
    self.report['assignmentId']=task_id
    rows=self.contract.rows(self.call('anchor','assignmentList')['data']);self.check('unjoined_task_not_disclosed_to_anchor_list',all(self.contract.id(x)!=task_id for x in rows))
    self.denied('anchor','assignmentCreate',{**task,'id':str(uuid.uuid4()),'role':'operator','operatorId':self.uid['operator']},str(uuid.uuid4()),'client_role_fields_cannot_promote_anchor')
    join_payload=self.contract.join(created['joinCode']);op_join=str(uuid.uuid4());self.call('anchor','assignmentJoin',join_payload,op_join);self.call('anchor','assignmentJoin',join_payload,op_join)
    rows=self.contract.rows(self.call('anchor','assignmentList')['data']);self.check('joined_anchor_reads_operator_task_from_real_api',sum(self.contract.id(x)==task_id for x in rows)==1)
    session_id=str(uuid.uuid4());submission_id=str(uuid.uuid4());op_submit=str(uuid.uuid4());submission=self.contract.submission(run,task_id,self.uid['operator'],session_id,submission_id)
    first=self.contract.entity(self.call('anchor','submissionCreate',submission,op_submit)['data'],'submission');submission_id=self.contract.id(first);self.report['submissionId']=submission_id
    second=self.contract.entity(self.call('anchor','submissionCreate',submission,op_submit)['data'],'submission');self.check('same_operation_returns_same_submission',self.contract.id(second)==submission_id)
    rows=self.contract.rows(self.call('operator','submissionList')['data']);matching=[x for x in rows if self.contract.id(x)==submission_id];self.check('operator_has_exactly_one_real_submission',len(matching)==1)
    full=self.contract.entity(self.call('operator','submissionGet',self.contract.get(submission_id))['data'],'submission')
    original=submission.get('snapshot',submission);actual=full.get('snapshot',full)
    self.check('original_two_turn_snapshot_metadata_and_manual_clear_preserved',actual.get('turns')==original['turns'])
    self.denied('outsider','submissionGet',self.contract.get(submission_id),name='wrong_user_cannot_read_known_submission_id')
    outsider_rows=self.contract.rows(self.call('outsider','submissionList')['data']);self.check('wrong_user_list_excludes_submission',all(self.contract.id(x)!=submission_id for x in outsider_rows))
    feedback_body=run+' 运营人工反馈：先核对型号与资料，再明确表达。';op_feedback=str(uuid.uuid4());fp=self.contract.feedback(submission_id,feedback_body)
    feedback=self.contract.entity(self.call('operator','feedbackCreate',fp,op_feedback)['data'],'feedback');self.call('operator','feedbackCreate',fp,op_feedback)
    feedback_rows=self.contract.rows(self.call('anchor','feedbackList',self.contract.feedback_query(submission_id))['data']);match=[x for x in feedback_rows if self.contract.id(x)==self.contract.id(feedback)]
    self.check('anchor_reads_one_persisted_operator_feedback',len(match)==1 and match[0].get('body')==feedback_body)
    self.denied('outsider','feedbackCreate',fp,str(uuid.uuid4()),'wrong_user_cannot_write_feedback')
    self.denied('outsider','feedbackList',self.contract.feedback_query(submission_id),name='wrong_user_cannot_read_feedback')
    changed=json.loads(json.dumps(submission));target=changed.get('snapshot',changed);target['turns'][0]['answer']='same operation changed body must reject'
    self.denied('anchor','submissionCreate',changed,op_submit,'same_idempotency_key_changed_payload_rejected',True)
    # A transport outage must not create a confirmed server receipt.
    offline_id=str(uuid.uuid4());offline_payload=self.contract.submission(run+'-offline',task_id,self.uid['operator'],str(uuid.uuid4()),offline_id)
    self.contexts['anchor'].set_offline(True)
    try:offline=self.call('anchor','submissionCreate',offline_payload,str(uuid.uuid4()),False)
    finally:self.contexts['anchor'].set_offline(False)
    self.check('offline_request_has_no_confirmed_receipt',offline.get('ok') is False)
    rows=self.contract.rows(self.call('operator','submissionList')['data']);self.check('offline_attempt_does_not_appear_in_operator_inbox',all(self.contract.id(x)!=offline_id for x in rows))
    from cdp_response_fault import verify_lost_response
    verify_lost_response(self,browser,run,task_id)
    # Browser storage is refreshed/re-authenticated, not copied to the other actor.
    for alias in ('operator','anchor'):self.reload(alias)
    final_full=self.contract.entity(self.call('operator','submissionGet',self.contract.get(submission_id))['data'],'submission');final_feedback=self.contract.rows(self.call('anchor','feedbackList',self.contract.feedback_query(submission_id))['data'])
    self.check('refresh_and_real_relogin_retain_submission_and_feedback',self.contract.id(final_full)==submission_id and any(self.contract.id(x)==self.contract.id(feedback) for x in final_feedback))
    self.report['status']='PASS_API_LAYER';self.report['browser']=browser.version
   finally:browser.close()
  self.record()

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');parser.add_argument('--auth-only',action='store_true');parser.add_argument('--private-config',default=os.environ.get('R25_E2E_PRIVATE_CONFIG'));parser.add_argument('--contract',default=str(ROOT/'contract.json'));parser.add_argument('--out',default=str(ROOT/'results/native-pg'));args=parser.parse_args()
 contract=Contract(json.loads(Path(args.contract).read_text()))
 if not args.execute:
  print(json.dumps({'status':'PREPARED_NOT_EXECUTED','contractConfirmed':contract.data.get('confirmed',False),'cloudWrites':0,'userCreation':0}));return
 if not args.auth_only and contract.data.get('confirmed') is not True:raise SystemExit('Contract is not confirmed; no SDK initialized or cloud operation executed.')
 if not args.private_config:raise SystemExit('Private config path required; no cloud operation executed.')
 config=private_config(args.private_config);config.setdefault('browserUrl','http://127.0.0.1:8765/tcl-v352-asr-r25-qa/')
 u=urlsplit(config['browserUrl'])
 if u.username or u.password or any(x in u.query.lower() for x in ('token','password','invite','key=')):raise SystemExit('Browser URL must not contain credentials.')
 run=LiveRun(config,contract,Path(args.out))
 try:
  if args.auth_only:run.run_auth_only()
  else:run.run()
 except Exception as error:
  run.report['status']='FAIL';run.report['error']={'type':type(error).__name__,'summary':'Verification step failed; raw exception omitted to protect request credentials','frames':[{'file':Path(x.filename).name,'line':x.lineno,'function':x.name} for x in traceback.extract_tb(error.__traceback__) if str(x.filename).startswith(str(ROOT))]};run.record();print(json.dumps({'status':'FAIL','errorType':type(error).__name__,'detailsFile':'result.json'},ensure_ascii=False));raise SystemExit(1)
 print(json.dumps({'status':run.report['status'],'checks':len(run.report['checks']),'operations':len(run.report['operations']),'out':str(run.out)},ensure_ascii=False))
if __name__=='__main__':main()
