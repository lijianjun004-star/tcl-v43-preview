"""Actual Chromium DOM checks with synthetic workflow, no cloud writes.

Run with Python Playwright and an installed Chromium:
  CHROMIUM_EXECUTABLE=/path/to/chromium python direct-registration-ui.py
When unset, Playwright uses its managed Chromium installation.
These checks use synthetic workflow data; they are not real CloudBase acceptance.
"""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
import json
import os
ROOT=Path(__file__).resolve().parents[1]/'tcl-v352-asr-r25-qa'
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
checks=[]
try:
 with sync_playwright() as p:
  browser=None
  try:
   launch_options={'headless':True,'args':['--no-sandbox']}
   if os.environ.get('CHROMIUM_EXECUTABLE'):
    launch_options['executable_path']=os.environ['CHROMIUM_EXECUTABLE']
   browser=p.chromium.launch(**launch_options)
   page=browser.new_page()
   page.goto(f'http://127.0.0.1:{server.server_port}/name-identity.mjs')
   page.evaluate('''async()=>{
   document.body.innerHTML='<div id="mount"></div><div id="submission"></div>';
   const {createCloudWorkspace}=await import('/cloud-workspace.mjs');
   window.calls=[];window.rows=[{uid:'operator-id',displayName:'运营甲',role:'operator',active:true}];window.snapshot={id:'session-a',turns:[]};
   window.wf={user:null,getState:()=>({error:'',capabilities:{media:false}}),enterWithName:async v=>calls.push({action:'enterWithName',...v}),register:async v=>calls.push({action:'register',...v}),signIn:async(...v)=>calls.push({action:'signIn',v}),refreshIdentity:async()=>{},listAll:async a=>{calls.push({action:a});return a==='operators.list'?rows:[]},pendingOperations:async()=>[],durableWrite:async(a,p)=>{calls.push({action:a,payload:p});return{submission:{id:p.id,submittedAt:'now'},receiptId:'receipt'};}};
   window.workspace=createCloudWorkspace({workflow:wf,boards:[{id:'b',category:'板块',platforms:['平台']}],onIdentityReady:async()=>{},onLogout:async()=>{},onStart:async()=>{}});
   await workspace.mount(document.querySelector('#mount'));
   window.submitPanel=()=>workspace.mountSubmissionPanel(document.querySelector('#submission'),{getSnapshot:()=>snapshot,onConfirmed:async()=>{},beforeSubmit:async()=>{}});
   }''')
   assert page.locator('#cloudInvitationCode').count()==0
   checks.append('registration has no invitation field')
   page.fill('#cloudEntryName','运营甲');page.select_option('#cloudEntryRole','operator');page.click('#cloudNameEntryForm button')
   assert page.evaluate("calls.some(c=>c.action==='enterWithName'&&c.role==='operator'&&!('password'in c)&&!('inviteCode'in c))")
   checks.append('operator name entry submits role without password or invite')
   for role,title in [('admin','全部主播交付作业'),('operator','我的云端收件箱')]:
    page.evaluate("async role=>{wf.user={uid:role,displayName:'测试',role};await workspace.mount(document.querySelector('#mount'));}",role)
    assert title in page.locator('#mount').inner_text()
    assert page.locator('#cloudCreateInvite').count()==0
    assert page.evaluate("calls.some(c=>c.action==='submissions.list')")
    checks.append(role+' dashboard requests submissions and labels scope')
   page.evaluate("async()=>{wf.user={uid:'anchor',displayName:'主播',role:'anchor'};await submitPanel();}")
   page.check('#cloudTextOnlyConsent');page.fill('#cloudSubmitOperator','不存在');page.click('#cloudSubmitText')
   assert '没有找到' in page.locator('#submission [data-cloud-status]').inner_text()
   assert not page.evaluate("calls.some(c=>c.action==='submissions.create')")
   checks.append('missing recipient cannot submit')
   page.evaluate("async()=>{rows.push({uid:'duplicate',displayName:'运营甲',role:'operator',active:true});await submitPanel();}")
   page.check('#cloudTextOnlyConsent');page.fill('#cloudSubmitOperator','运营甲');page.click('#cloudSubmitText')
   assert '多个账号' in page.locator('#submission [data-cloud-status]').inner_text()
   assert not page.evaluate("calls.some(c=>c.action==='submissions.create')")
   checks.append('ambiguous recipient cannot submit')
   page.evaluate("async()=>{rows.pop();await submitPanel();}")
   page.check('#cloudTextOnlyConsent');page.fill('#cloudSubmitOperator','运营甲');page.click('#cloudSubmitText')
   assert page.evaluate("calls.some(c=>c.action==='submissions.create'&&c.payload.operatorId==='operator-id')")
   assert '回执' in page.locator('#submission [data-cloud-status]').inner_text()
   checks.append('unique exact operator resolves stable uid and requires server receipt')
  finally:
   if browser is not None:
    browser.close()
finally:
 server.shutdown()
 server.server_close()
print(json.dumps({'passed':len(checks),'checks':checks,'scope':'Chromium DOM, synthetic workflow; no cloud calls'},ensure_ascii=False,indent=2))
