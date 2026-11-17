#!/usr/bin/env python3
"""Single real PG response-drop + new-context same-UID idempotency recovery case.
Uses an already joined synthetic assignment; never creates users or modifies configuration.
"""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json,traceback,uuid
from playwright.sync_api import sync_playwright
from run_native_pg_e2e import private_config,Contract,LiveRun
from cdp_response_fault import verify_lost_response
ROOT=Path(__file__).resolve().parent
class FaultRun(LiveRun):
 def run_single(self,assignment_id):
  run='r25-fault-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:5]
  self.report['scope']='REAL official SDK + native PG: response paused after successful real Chromium HTTP commit, dropped, original client closed; fresh same-UID context retries original operation_id. Single supplemental case, not rerun of all earlier core groups.'
  self.report['runId']=run;self.report['assignmentId']=assignment_id
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
   try:
    for alias in ('operator','anchor'):self.actor(browser,alias)
    for alias,role in (('operator','operator'),('anchor','anchor')):
     user=self.contract.entity(self.call(alias,'me')['data'],'user');self.check(alias+'_server_uid_and_role_match',str(user['uid'])==self.uid[alias] and user['role']==role)
    rows=self.contract.rows(self.call('anchor','assignmentList')['data']);self.check('new_anchor_is_already_joined_to_selected_test_assignment',any(self.contract.id(row)==assignment_id for row in rows))
    sid=verify_lost_response(self,browser,run,assignment_id);self.report['submissionId']=sid
    self.report['status']='PASS_REAL_CDP_RESPONSE_LOSS_RECOVERY';self.report['browser']=browser.version
   finally:browser.close()
  self.record()
def main():
 p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');p.add_argument('--private-config');p.add_argument('--task-id');p.add_argument('--browser-url',default='http://127.0.0.1:8765/tcl-v352-asr-r25-qa/');p.add_argument('--out',default=str(ROOT/'results/fault-recovery'));args=p.parse_args()
 if not args.execute:print(json.dumps({'status':'PREPARED_NOT_EXECUTED','cloudWrites':0}));return
 c=Contract(json.loads((ROOT/'contract.json').read_text()))
 if c.data.get('confirmed') is not True or not args.private_config or not args.task_id:raise SystemExit('Confirmed deployment, private config and existing joined test task required.')
 config=private_config(args.private_config);config['browserUrl']=args.browser_url;r=FaultRun(config,c,Path(args.out))
 try:r.run_single(args.task_id)
 except Exception as e:r.report['status']='FAIL';r.report['error']={'type':type(e).__name__,'summary':'Fault test step failed; raw exception suppressed','frames':[{'file':Path(x.filename).name,'line':x.lineno,'function':x.name} for x in traceback.extract_tb(e.__traceback__) if str(x.filename).startswith(str(ROOT))]};r.record();print(json.dumps({'status':'FAIL','errorType':type(e).__name__}));raise SystemExit(1)
 print(json.dumps({'status':r.report['status'],'checks':len(r.report['checks']),'out':str(r.out)}))
if __name__=='__main__':main()
