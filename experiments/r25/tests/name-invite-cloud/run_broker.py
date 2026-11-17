#!/usr/bin/env python3
"""New Chinese-name enrollment -> official native Auth -> real PG ACL workflow.
Default dryrun performs zero network/browser operations. No admin credentials used.
"""
from pathlib import Path
import argparse,json,secrets,uuid,unicodedata
from common import Evidence,private_fixture,sha,operation,safe_operation,new_password
ROOT=Path(__file__).resolve().parent

class Runner(Evidence):
 def native(self,browser,alias,account,username,uid=None,role=None):
  context=browser.new_context(locale='zh-CN');page=context.new_page();page.goto(self.config['browserUrl'],wait_until='domcontentloaded',timeout=45000);page.add_script_tag(path=str(ROOT/'browser-client.bundle.js'))
  page.evaluate("c=>window.client=R25AcceptanceSDK.createClient(c)",{'clientConfig':{'env':self.config['envId'],'region':self.config.get('region','ap-shanghai'),'persistence':'local'},'rpcName':'r25wf_api'})
  reply=page.evaluate('x=>client.signIn(x)',{'username':username,'password':account['password']});self.check(alias+'_official_native_login',reply.get('ok') is True,{'errorCode':reply.get('error',{}).get('code')})
  actual=str(reply['data']['uid']);self.check(alias+'_server_native_uid_matches',not uid or actual==str(uid),{'uidSha256':sha(actual)});me=page.evaluate("()=>client.call('me')");self.check(alias+'_me_bound_expected_role',me.get('ok') is True and str(me['data']['user']['uid'])==actual and (not role or me['data']['user']['role']==role),{'role':me.get('data',{}).get('user',{}).get('role')})
  self.contexts[alias]=context;self.pages[alias]=page;self.uids[alias]=actual;return actual
 def rpc(self,alias,action,payload=None,op=None,ok=True):
  reply=self.pages[alias].evaluate('x=>client.call(...x)',[action,payload or {},op]);self.report['operations'].append({'actor':alias,'action':action,'ok':reply.get('ok'),'errorCode':reply.get('error',{}).get('code')});self.save()
  if ok:self.check(alias+'_'+action+'_confirmed',reply.get('ok') is True,{'errorCode':reply.get('error',{}).get('code')})
  return reply
 def denied(self,name,reply,codes):self.check(name,reply.get('ok') is False and reply.get('error',{}).get('code') in codes,{'errorCode':reply.get('error',{}).get('code')})
 def run(self):
  from playwright.sync_api import sync_playwright
  self.contexts={};self.pages={};self.uids={};self.operations={};self.enrolled={}
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=self.config.get('chromium','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
   try:
    legacy=self.config.get('legacyAccount')
    if legacy:self.native(browser,'legacy-before',legacy,legacy['username'],legacy['uid'],legacy.get('role'))
    else:self.not_run('legacy_original_uid_and_password_preserved','Root must provide an existing account with expected immutable UID; no password guessing')
    base=self.config['newAccounts']['anchor'];invalid='无效邀请验收'+uuid.uuid4().hex[:10]
    weak=operation({'name':'弱密码验收'+uuid.uuid4().hex[:10],'password':'abc12345','inviteCode':base['inviteCode']})
    self.denied('weak_password_rejected_before_reservation',self.broker(weak),['INVALID_PASSWORD'])
    self.denied('weak_password_creates_no_alias',self.broker({'action':'resolve','name':weak['name']}),['NOT_FOUND'])
    self.denied('weak_password_creates_no_reservation',self.broker({'action':'status','operationId':weak['operationId'],'operationSecret':weak['operationSecret'],'name':weak['name']}),['NOT_FOUND'])
    for label,code in [('missing',''),('wrong',self.config.get('wrongInviteCode','f'*48))]:
     acct={'name':invalid+label,'password':new_password(),'inviteCode':code};body=operation(acct);reply=self.broker(body)
     self.denied(label+'_invite_register_is_server_rejected',reply,['INVALID_INVITE','INVALID_REQUEST'])
     resolved=self.broker({'action':'resolve','name':acct['name']});self.denied(label+'_invite_does_not_create_login_alias',resolved,['NOT_FOUND'])
    for item in self.config.get('extraInvalidInvites',[]):
     reply=self.broker(operation(item));self.denied('invite_'+item['label']+'_server_rejected',reply,item['expectedCodes'])
    # Extra privilege-bearing fields must fail before reserving/creating an account.
    privileged=operation(base);privileged.update({'role':'admin','uid':'123','username':'arbitrary'})
    self.denied('untrusted_role_uid_username_rejected',self.broker(privileged),['INVALID_REQUEST'])
    self.denied('role_rejection_does_not_create_alias',self.broker({'action':'resolve','name':base['name']}),['NOT_FOUND'])
    for alias in ('operator','anchor','outsider'):
     acct=self.config['newAccounts'][alias];body=operation(acct);self.operations[alias]=body;reply=self.broker(body)
     self.check(alias+'_chinese_name_enrollment_ready',reply.get('ok') is True and reply.get('data',{}).get('state')=='ready' and bool(reply['data'].get('username')) and bool(reply['data'].get('uid')),{'state':reply.get('data',{}).get('state')})
     if alias=='anchor':self.check('weak_password_did_not_consume_valid_invite',weak['inviteCode']==body['inviteCode'] and reply.get('ok') is True)
     data=reply['data'];self.check(alias+'_broker_uses_29_character_opaque_native_username',len(data['username'])==29 and data['username'].isascii() and data['username'].startswith('r25n_'),{'usernameLength':len(data['username'])});self.enrolled[alias]=data;self.native(browser,alias,acct,data['username'],data['uid'],acct.get('role','anchor' if alias!='operator' else 'operator'))
     resolved=self.broker({'action':'resolve','name':unicodedata.normalize('NFKC',acct['name']).strip()});self.check(alias+'_daily_name_resolves_same_native_identity',resolved.get('ok') is True and resolved['data']['username']==data['username'] and (not resolved['data'].get('uid') or str(resolved['data']['uid'])==str(data['uid'])))
     self.native(browser,alias+'-daily',acct,resolved['data']['username'],data['uid'],acct.get('role','anchor' if alias!='operator' else 'operator'))
    anchor_body=self.operations['anchor'];anchor_data=self.enrolled['anchor'];status={'action':'status','operationId':anchor_body['operationId'],'operationSecret':anchor_body['operationSecret'],'name':anchor_body['name']}
    recovered=self.broker(status);self.check('same_operation_secret_status_recovers_same_uid',recovered.get('ok') is True and recovered['data'].get('state')=='ready' and str(recovered['data'].get('uid'))==str(anchor_data['uid']) and recovered['data'].get('username')==anchor_data['username'])
    replay=self.broker(anchor_body);self.check('same_operation_replay_preserves_native_uid',replay.get('ok') is True and str(replay['data'].get('uid'))==str(anchor_data['uid']))
    self.denied('wrong_operation_secret_cannot_recover',self.broker({**status,'operationSecret':secrets.token_urlsafe(32)}),['INVALID_OPERATION_SECRET','REGISTRATION_CONFLICT','NOT_FOUND'])
    self.denied('status_rejects_password_field',self.broker({**status,'password':self.config['newAccounts']['anchor']['password']}),['INVALID_REQUEST'])
    conflict_invite=self.config.get('nameConflictInviteCode')
    if conflict_invite:
     changed=operation({**self.config['newAccounts']['anchor'],'password':new_password(),'inviteCode':conflict_invite});self.denied('duplicate_name_cannot_replace_existing_account',self.broker(changed),['NAME_TAKEN','NAME_CONFLICT'])
     self.native(browser,'anchor-after-name-conflict',self.config['newAccounts']['anchor'],anchor_data['username'],anchor_data['uid'],'anchor')
     if legacy:
      namespace=operation({'name':legacy['username'].upper(),'password':new_password(),'inviteCode':conflict_invite});self.denied('legacy_native_username_casefold_namespace_cannot_be_claimed',self.broker(namespace),['NAME_TAKEN','NAME_CONFLICT'])
      old=self.broker({'action':'resolve','name':legacy['username']});self.check('legacy_native_username_resolves_original_uid',old.get('ok') is True and old['data']['username']==legacy['username'] and (not old['data'].get('uid') or str(old['data']['uid'])==str(legacy['uid'])))
    else:self.not_run('duplicate_name_does_not_change_old_password','Unused valid conflict-test invite required; consumed/invalid invite would not prove name conflict')
    self.check('independent_native_context_uids_are_distinct',len({self.uids[x] for x in ('operator','anchor','outsider')})==3)
    self.workflow()
    if legacy:self.native(browser,'legacy-after',legacy,legacy['username'],legacy['uid'],legacy.get('role'));self.check('legacy_uid_and_original_password_still_work',self.uids['legacy-before']==self.uids['legacy-after'])
    self.not_run('native_provider_no_account_created_for_invalid_invites','Root must independently compare exact synthetic fixture scope with native DescribeUserList before/after; alias absence alone is not provider proof')
    self.not_run('weak_password_native_create_call_count_is_zero','Root/provider audit must prove zero native CreateUser calls; no alias/reservation and reusing the same invite alone cannot inspect server internals')
    self.not_run('formal_business_data_unchanged','Root must perform before/after readonly SQL audit excluding explicitly scoped synthetic writes')
    self.not_run('crash_between_native_create_and_sql_finalize','Requires a root-approved server checkpoint; no production fault switch is assumed')
    self.report['browser']=browser.version
   finally:browser.close();self.report['contextsClosed']=True
  self.finish()
 def workflow(self):
  task_id=str(uuid.uuid4());run='name-invite-'+uuid.uuid4().hex[:8]
  created=self.rpc('operator','assignments.create',{'id':task_id,'title':run,'boardId':'01','platform':'京东'},str(uuid.uuid4()))['data']['assignment']
  self.rpc('anchor','assignments.join',{'joinCode':created['joinCode']},str(uuid.uuid4()));sid=str(uuid.uuid4());answer=run+' 中文姓名开户后的真实独立账号练习。'
  snap={'id':str(uuid.uuid4()),'boardId':'01','category':'TCL电视','platform':'京东','turns':[{'id':str(uuid.uuid4()),'prompt':run+' 问题','answer':answer}]}
  submitted=self.rpc('anchor','submissions.create',{'id':sid,'assignmentId':task_id,'snapshot':snap,'media':[]},str(uuid.uuid4()));self.check('anchor_submission_has_real_receipt',submitted['data']['receiptId']==sid)
  inbox=self.rpc('operator','submissions.list')['data']['items'];self.check('assigned_operator_receives_new_anchor_once',sum(x['id']==sid for x in inbox)==1)
  self.denied('other_context_cannot_read_submission',self.rpc('outsider','submissions.get',{'id':sid},ok=False),['FORBIDDEN','NOT_FOUND'])
  text=run+' 运营反馈';self.rpc('operator','feedback.create',{'submissionId':sid,'body':text},str(uuid.uuid4()));items=self.rpc('anchor','feedback.list',{'submissionId':sid})['data']['items'];self.check('anchor_reads_operator_persisted_feedback',any(x.get('body')==text for x in items))
  self.denied('other_context_cannot_read_feedback',self.rpc('outsider','feedback.list',{'submissionId':sid},ok=False),['FORBIDDEN','NOT_FOUND'])
  for alias in ('operator','anchor','outsider'):
   me=self.rpc(alias,'me')['data']['user'];self.check(alias+'_session_still_own_uid_after_other_logins',str(me['uid'])==self.uids[alias])

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--execute',action='store_true');ap.add_argument('--private-fixture');ap.add_argument('--out',default=str(ROOT/'results/broker'));a=ap.parse_args()
 if not a.execute:print(json.dumps({'status':'DRY_RUN_ZERO_NETWORK','script':str(Path(__file__)),'requires':'--execute plus root-approved mode0600 private fixture','networkRequests':0,'browserLaunches':0}));return 0
 if not a.private_fixture:raise SystemExit('Private fixture required; no operation executed')
 cfg=private_fixture(a.private_fixture,True);run=Runner(a.out,cfg,'REAL_NAME_INVITE_BROKER_AND_NATIVE_AUTH')
 try:run.run()
 except Exception as e:run.fail(e)
 print(json.dumps({'status':run.report['status'],'checks':len(run.report['checks']),'notRun':len(run.report['notRun']),'out':str(run.out)}));return 1 if run.report['status']=='FAIL' else 0
if __name__=='__main__':raise SystemExit(main())
