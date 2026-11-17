#!/usr/bin/env python3
"""Optional single-object real MediaRecorder synthetic-video roundtrip."""
import argparse
from pathlib import Path
import json
from datetime import datetime,timezone
import uuid
from playwright.sync_api import sync_playwright
from run_private_storage import Run,private_config,ROOT

def main():
    p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');args=p.parse_args()
    if not args.execute:print('PREPARED_NOT_EXECUTED');return
    cfg=private_config('/workspace/r25-cloud-test-credentials.json');out=ROOT/'results'/('video-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    run=Run(cfg,out,True)
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
            try:
                run.actor(browser,'anchor');page=run.pages['anchor'];page.add_script_tag(path=str(ROOT/'video-client.bundle.js'))
                config={'env':cfg['envId'],'region':cfg.get('region','ap-shanghai'),'persistence':'local',**cfg.get('sdkInit',{})}
                result=page.evaluate('async ({config,suffix})=>await R25VideoSDK.run(config,suffix)',{'config':config,'suffix':run.id+'-synthetic-video.webm'})
                run.report['video']=result;run.report['status']=result['status'];run.write()
                run.check('owner_synthetic_webm_roundtrip_and_playback',result['status']=='PASS_SYNTHETIC_WEBM_ROUNDTRIP_PLAYBACK',{'status':result['status'],'failedStep':result.get('failedStep')})
                run.actor(browser,'operator')
                assignment=run.rpc('operator','assignments.create',{'id':str(uuid.uuid4()),'title':run.id+' 合成WebM送达验收','boardId':'01','platform':'京东'},True)
                run.check('video_assignment_created',assignment.get('ok') is True,{'errorCode':assignment.get('errorCode')})
                assignment=assignment['data']['assignment'];run.report['assignmentId']=assignment['id']
                joined=run.rpc('anchor','assignments.join',{'joinCode':assignment['joinCode']},True);run.check('video_anchor_joined',joined.get('ok') is True)
                detail=next(x['detail'] for x in result['steps'] if x['step']=='webm_byte_hash_roundtrip')
                object_path=run.uid['anchor']+'/'+run.id+'-synthetic-video.webm'
                payload=run.submission(assignment['id'],[{'path':object_path,'mime':'video/webm','size':detail['bytes'],'sha256':detail['sha256']}])
                submitted=run.rpc('anchor','submissions.create',payload,True);run.check('real_webm_submission_receipt',submitted.get('ok') is True,{'errorCode':submitted.get('errorCode')})
                run.report['submissionId']=submitted['data']['receiptId']
                op=run.pages['operator'];op.add_script_tag(path=str(ROOT/'video-client.bundle.js'))
                recipient=op.evaluate('async p=>await R25VideoSDK.playExisting(p.config,p.path,p.sha256)',{'config':config,'path':object_path,'sha256':detail['sha256']})
                run.report['recipientVideo']=recipient;run.check('recipient_actual_webm_download_and_playback',recipient['status']=='PASS_RECIPIENT_VIDEO_PLAYBACK',{'status':recipient['status'],'failedStep':recipient.get('failedStep')})
                run.report['status']='PASS_SYNTHETIC_WEBM_SUBMITTED_AND_RECIPIENT_PLAYBACK';run.report['finishedAt']=datetime.now(timezone.utc).isoformat();run.write()
            finally:browser.close()
    except Exception as error:
        run.report['status']='FAIL';run.report['failure']={'type':type(error).__name__,'summary':'Sensitive error text intentionally omitted'};run.write()
    print(json.dumps({'status':run.report['status'],'out':str(out)}))
    raise SystemExit(0 if run.report['status'].startswith('PASS') else 1)
if __name__=='__main__':main()
