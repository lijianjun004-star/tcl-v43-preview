#!/usr/bin/env python3
"""Official SDK native login + submission ACL acceptance. Zero operations by default.
No HAR, traces, screenshots, console forwarding or credential output.
"""
from pathlib import Path
import argparse,json,os,uuid,hashlib
ROOT=Path('/workspace/tcl-r25-fix')
BUNDLE=ROOT/'experiments/r25/tests/name-invite-cloud/browser-client.bundle.js'
def private_read(path):
 p=Path(path)
 if p.is_symlink() or not p.is_file() or p.stat().st_mode&0o077:raise ValueError('PRIVATE_FILE_REQUIRED')
 return json.loads(p.read_text())
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--execute',action='store_true');ap.add_argument('--private-dir');ap.add_argument('--private-admin-file');a=ap.parse_args()
 if not a.execute:print(json.dumps({'status':'DRY_RUN_ZERO_NETWORK','browserLaunches':0}));return 0
 if not a.private_dir:raise ValueError('PRIVATE_DIRECTORY_REQUIRED')
 directory=Path(a.private_dir);f=private_read(directory/'fixture.json')
 if not(f.get('executionApproved') is True and f.get('testOnly') is True and f['envId']=='unknown-roadrunner-d7cap6e21f517'):raise ValueError('APPROVED_SYNTHETIC_FIXTURE_REQUIRED')
 report={'suite':'REAL_OFFICIAL_SDK_AUTH_AND_SUBMISSIONS_ACL','status':'RUNNING','checks':[],'notRun':['Private media','Real mobile and mainland network'],'testScope':'test-only browser harness uses actual official bundled SDK and real Auth/PG; not product UI acceptance'}
 def save():
  p=directory/'browser-result.json';p.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');p.chmod(0o600)
 def check(label,ok):
  report['checks'].append({'label':label,'pass':bool(ok)});save()
  if not ok:raise AssertionError(label)
 clients={};contexts=[]
 try:
  from playwright.sync_api import sync_playwright
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'],proxy={'server':os.environ['HTTPS_PROXY'],'bypass':'localhost,127.0.0.1'} if os.environ.get('HTTPS_PROXY') else None)
   try:
    for account in f['accounts']:
     context=browser.new_context(locale='zh-CN');contexts.append(context);page=context.new_page()
     # Synthetic harness HTML at approved site origin; no product JS or UI mocks.
     page.route(f['browserUrl'],lambda route:route.fulfill(status=200,content_type='text/html',body='<!doctype html><meta charset="utf-8"><title>Official SDK acceptance harness</title>'))
     page.goto(f['browserUrl'],wait_until='domcontentloaded');page.add_script_tag(path=str(BUNDLE))
     page.evaluate("env=>window.client=R25AcceptanceSDK.createClient({clientConfig:{env,region:'ap-shanghai',persistence:'local'},rpcName:'r25wf_api'})",f['envId'])
     result=page.evaluate('x=>client.signIn(x)',{'username':account['username'],'password':account['password']})
     check(account['alias']+'_official_login',result.get('ok') is True and str(result.get('data',{}).get('uid'))==str(account['uid']))
     me=page.evaluate("()=>client.call('me')");check(account['alias']+'_me_exact_uid_role',me.get('ok') is True and str(me.get('data',{}).get('user',{}).get('uid'))==str(account['uid']) and me['data']['user']['role']==account['role'])
     clients[account['alias']]=page
    def call(alias,action,payload=None,op=None):return clients[alias].evaluate('args=>client.call(...args)',[action,payload or {},op])
    anchor=next(x for x in f['accounts'] if x['alias']=='anchor');operator=next(x for x in f['accounts'] if x['alias']=='operator')
    payload={'id':f['submissionId'],'operatorId':operator['uid'],'snapshot':{'id':str(uuid.uuid4()),'category':'合成恢复验收','turns':[{'id':str(uuid.uuid4()),'prompt':'合成验收题','answer':'仅用于新版本权限验收的合成内容。'}]},'media':[]}
    op=str(uuid.uuid4());reply=call('anchor','submissions.create',payload,op)
    check('synthetic_submission_real_receipt',reply.get('ok') is True and reply.get('data',{}).get('receiptId')==f['submissionId'])
    repeat=call('anchor','submissions.create',payload,op);check('same_operation_same_receipt',repeat.get('ok') is True and repeat.get('data',{}).get('receiptId')==f['submissionId'])
    inbox=call('operator','submissions.get',{'id':f['submissionId']});check('recipient_operator_reads',inbox.get('ok') is True)
    denied=call('outsider','submissions.get',{'id':f['submissionId']});check('unrelated_operator_denied',denied.get('ok') is False and denied.get('error',{}).get('code') in ('FORBIDDEN','NOT_FOUND'))
    denied=call('noNative','submissions.get',{'id':f['submissionId']});check('unrelated_anchor_denied',denied.get('ok') is False and denied.get('error',{}).get('code') in ('FORBIDDEN','NOT_FOUND'))
    reread=call('anchor','submissions.get',{'id':f['submissionId']});check('original_anchor_reads',reread.get('ok') is True)
    feedback=call('operator','feedback.create',{'submissionId':f['submissionId'],'body':'合成验收反馈'},str(uuid.uuid4()));check('recipient_feedback_persisted',feedback.get('ok') is True)
    feedback=call('anchor','feedback.list',{'submissionId':f['submissionId']});check('anchor_reads_feedback',feedback.get('ok') is True and any(x.get('body')=='合成验收反馈' for x in feedback.get('data',{}).get('items',[])))
    if a.private_admin_file:
     admin=private_read(a.private_admin_file);context=browser.new_context();contexts.append(context);page=context.new_page();page.route(f['browserUrl'],lambda route:route.fulfill(content_type='text/html',body='<title>Official SDK administrator acceptance</title>'));page.goto(f['browserUrl']);page.add_script_tag(path=str(BUNDLE));page.evaluate("env=>window.client=R25AcceptanceSDK.createClient({clientConfig:{env,region:'ap-shanghai',persistence:'local'},rpcName:'r25wf_api'})",f['envId'])
     login=page.evaluate('x=>client.signIn(x)',{'username':admin['username'],'password':admin['password']});check('existing_admin_official_login',login.get('ok') is True and str(login.get('data',{}).get('uid'))==str(admin['uid']))
     me=page.evaluate("()=>client.call('me')");check('existing_admin_role_verified',me.get('ok') is True and me['data']['user']['role']=='admin')
     result=page.evaluate("id=>client.call('submissions.get',{id})",f['submissionId']);check('existing_admin_reads_test_submission',result.get('ok') is True)
    else:report['notRun'].append('Existing administrator real Auth login/all-submission access: no private existing-admin fixture supplied; no account guessed or changed')
    report['notRun'].append('Existing user original-password login: no private legacy fixture supplied; database preservation checked separately')
    report['status']='PASS_WITH_NOT_RUN'
   finally:
    for context in contexts:context.close()
    browser.close()
 except Exception as error:
  report['status']='FAIL';report['error']={'type':type(error).__name__,'summary':'Raw exception and request data omitted'}
 save();print(json.dumps({'status':report['status'],'checks':len(report['checks']),'notRun':len(report['notRun'])}));return 1 if report['status']=='FAIL' else 0
if __name__=='__main__':
 try:raise SystemExit(main())
 except Exception:print(json.dumps({'status':'FAIL','error':'Controlled setup failure; raw details omitted'}));raise SystemExit(1)
