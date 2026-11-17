#!/usr/bin/env python3
"""Real native CloudBase private-storage acceptance; never execute before root apply.

Uses isolated Chromium contexts, official SDK3.11.1, synthetic WAV bytes and real
Auth/Storage/PG. No credentials/tokens/signed URLs are written to evidence.
"""
import argparse
import base64
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import stat
import struct
from datetime import datetime, timezone, timedelta
from urllib.parse import urlsplit
import uuid
import wave
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent
BUCKET='r25wf-private'

def sha(b):
    return hashlib.sha256(b if isinstance(b,bytes) else b.encode()).hexdigest()

def now():
    return datetime.now(timezone.utc).isoformat()

def wav_fixture():
    out=io.BytesIO()
    with wave.open(out,'wb') as stream:
        stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(16000)
        stream.writeframes(b''.join(struct.pack('<h',int(6000*math.sin(2*math.pi*440*i/16000))) for i in range(8000)))
    return out.getvalue()

def private_config(path):
    p=Path(path)
    if p.is_symlink():raise ValueError('Private config symlink refused')
    p=p.resolve(strict=True)
    if not p.is_relative_to(Path('/workspace')) or not stat.S_ISREG(p.stat().st_mode) or p.stat().st_mode&0o077:
        raise ValueError('Private config must be a workspace owner-only regular file')
    c=json.loads(p.read_text());accounts=c['accounts']
    if isinstance(accounts,list):accounts={a['alias']:a for a in accounts}
    for alias in ('anchor','operator','outsider','admin'):
        if not accounts.get(alias,{}).get('username') or not accounts[alias].get('password'):
            raise ValueError('Four provisioned test aliases are required')
    c['accounts']=accounts
    return c

class Run:
    def __init__(self,c,out,storage_only,diagnose_upload=False):
        self.c=c;self.out=out;self.storage_only=storage_only;self.diagnose_upload=diagnose_upload;self.pages={};self.contexts={};self.uid={};self.secrets=[]
        for a in c['accounts'].values():self.secrets.extend([a['username'],a['password']])
        self.id='r25-media-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:6]
        self.wav=wav_fixture();self.b64=base64.b64encode(self.wav).decode();self.path=None
        self.report={'runId':self.id,'startedAt':now(),'scope':'REAL official stable SDK browser + native Auth/PG/Storage; synthetic 0.5s sine WAV, no ASR or hardware test',
          'status':'RUNNING','storageOnly':storage_only,'bucket':BUCKET,'sdkBuild':json.loads((ROOT/'adapter-build.json').read_text()),
          'fixture':{'kind':'synthetic 440Hz mono PCM WAV','bytes':len(self.wav),'sha256':sha(self.wav),'range0to99Sha256':sha(self.wav[:100])},
          'actors':{},'checks':[],'operations':[],'pageErrorCounts':{},'rangeConfirmed':False,
          'notRun':['Real microphone/camera/phone','Mainland network','MP4/AAC decoding','Long recordings','Human/TCL ASR accuracy','Physical audio/video seeking']}
        self.write()
    def write(self):
        self.out.mkdir(parents=True,exist_ok=True)
        text=json.dumps(self.report,ensure_ascii=False,indent=2)+'\n'
        # Refuse evidence that accidentally includes an account credential or bearer URL.
        if any(v and v in text for v in self.secrets):raise RuntimeError('EVIDENCE_REDACTION_GUARD')
        (self.out/'result.json').write_text(text)
    def check(self,name,passed,detail=None,critical=True):
        self.report['checks'].append({'name':name,'pass':bool(passed),'detail':detail});self.write()
        if not passed and critical:raise AssertionError(name)
    def action(self,alias,method,arg=None):
        response=self.pages[alias].evaluate('async ({method,arg})=>await window.client[method](arg)',{'method':method,'arg':arg})
        # Only safe summaries leave this method. RPC data stays in memory and is never logged.
        safe={k:response[k] for k in ('ok','errorCode','status','bytes','sha256','mime','contentRange','acceptRanges','contentType','transportFailure','providerMessage','removedCount') if k in response}
        if 'providerMessage' in safe:
            for secret in self.secrets:
                if secret:safe['providerMessage']=safe['providerMessage'].replace(secret,'[REDACTED]')
        self.report['operations'].append({'actor':alias,'method':method,**safe});self.write();return response
    def rpc(self,alias,action,payload=None,write=False):
        response=self.pages[alias].evaluate('async p=>await window.client.call(...p)',[action,payload or {},str(uuid.uuid4()) if write else None])
        self.report['operations'].append({'actor':alias,'method':'rpc','action':action,'ok':response.get('ok'), 'errorCode':response.get('errorCode')});self.write();return response
    def denied(self,name,response):
        code=response.get('errorCode');status=response.get('status')
        # Network/fixture failure is not evidence of authorization denial.
        credible=not response.get('transportFailure') and (status in (400,401,403,404,406) or bool(code and code not in ('TypeError','Error','NO_SESSION','TRANSPORT_ERROR','StorageUnknownError')))
        self.check(name,response.get('ok') is False and credible,{'errorCode':code,'status':status})
    def bytes_ok(self,name,response):
        self.check(name,response.get('ok') is True and response.get('bytes')==len(self.wav) and response.get('sha256')==sha(self.wav),
                   {k:response.get(k) for k in ('ok','errorCode','bytes','sha256','status')})
    def actor(self,browser,alias):
        context=browser.new_context(viewport={'width':390,'height':844},locale='zh-CN')
        origin=urlsplit(self.c.get('browserUrl','http://127.0.0.1:8765/'))
        if origin.scheme not in ('http','https') or origin.username or origin.password:raise ValueError('Invalid test origin')
        url=f'{origin.scheme}://{origin.netloc}/__r25_media_test__/{self.id}'
        context.route(url,lambda route:route.fulfill(status=200,content_type='text/html',body='<!doctype html><meta charset="utf-8"><title>R25 native media acceptance</title>'))
        page=context.new_page();self.report['pageErrorCounts'][alias]=0
        def page_error(_):self.report['pageErrorCounts'][alias]+=1
        page.on('pageerror',page_error);page.goto(url);page.add_script_tag(path=str(ROOT/'media-client.bundle.js'))
        config={'clientConfig':{'env':self.c['envId'],'region':self.c.get('region','ap-shanghai'),'persistence':'local',**self.c.get('sdkInit',{})},'authOptions':self.c.get('authOptions',{'persistence':'local'})}
        page.evaluate('c=>{window.client=R25MediaSDK.createClient(c)}',config);self.pages[alias]=page;self.contexts[alias]=context
        if alias!='anonymous':
            a=self.c['accounts'][alias];r=page.evaluate('c=>window.client.login(c)',{'username':a['username'],'password':a['password']})
            self.check(alias+'_native_login',r.get('ok') is True,{'errorCode':r.get('errorCode')})
            self.uid[alias]=r['uid'];self.check(alias+'_uid_matches_provisioned',not a.get('uid') or str(a['uid'])==r['uid'])
            self.report['actors'][alias]={'uidSha256':sha(r['uid']),'isolatedContext':True}
    def upload(self,alias,path):
        r=self.action(alias,'upload',{'path':path,'base64':self.b64,'mime':'audio/wav'})
        self.check(alias+'_upload_'+path.split('/')[-1],r.get('ok') is True,{'errorCode':r.get('errorCode')});return path
    def submission(self,assignment,path_items):
        return {'id':str(uuid.uuid4()),'assignmentId':assignment,'sessionId':str(uuid.uuid4()),'snapshot':{'turns':[{'id':'media-synthetic-turn','prompt':'合成媒体验收，无真人资料','answer':'测试文字，不代表识别结果','model':'TEST-ONLY','sku':'TEST-SYNTHETIC'}]},'media':path_items}
    def invalid_submission(self,name,assignment,items,allowed):
        r=self.rpc('anchor','submissions.create',self.submission(assignment,items),True)
        self.check(name,r.get('ok') is False and r.get('errorCode') in allowed,{'errorCode':r.get('errorCode')})
    def run(self):
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
            self.report['browserVersion']=browser.version
            try:
                for alias in ('anchor','operator','outsider','admin','anonymous'):self.actor(browser,alias)
                self.check('all_native_users_distinct',len(set(self.uid.values()))==4)
                for alias in ('anchor','operator'):
                    me=self.rpc(alias,'me');self.check(alias+'_active_business_role',me.get('ok') and me.get('data',{}).get('user',{}).get('role')==alias)
                self.path=self.upload('anchor',self.uid['anchor']+'/'+self.id+'-1.wav')
                info=self.action('anchor','info',self.path)
                self.report['uploadedObjectInfo']=info.get('info')
                self.check('uploaded_object_metadata_visible_via_storage_api',info.get('ok') is True,{'errorCode':info.get('errorCode')})
                if self.diagnose_upload:
                    self.report['status']='UPLOAD_DIAGNOSTIC_PASSED';self.report['finishedAt']=now();self.write();return
                self.report['objectKeyTemplate']='<anchor_uid>/'+self.id+'-1.wav'
                self.bytes_ok('owner_download_exact_synthetic_wav',self.action('anchor','download',self.path))
                for alias in ('operator','outsider','anonymous'):
                    self.denied(alias+'_before_link_download_denied',self.action(alias,'download',self.path))
                    self.denied(alias+'_before_link_sign_denied',self.action(alias,'sign',self.path))
                anonymous_http=self.action('anonymous','withoutSession',self.path)
                self.check('anonymous_direct_http_get_without_authorization_denied',anonymous_http.get('ok') is False and anonymous_http.get('status') in (400,401,403,404),{'status':anonymous_http.get('status')})
                # A browser must not fabricate Storage metadata through PostgREST.
                forge=self.action('anchor','forgeStorageRow',{'path':self.uid['anchor']+'/'+self.id+'-forged.wav','owner':self.uid['anchor'],'mime':'audio/wav','size':len(self.wav)})
                self.check('direct_postgrest_storage_row_forgery_denied',forge.get('ok') is False and forge.get('status') in (400,401,403,404,406),{'status':forge.get('status'),'errorCode':forge.get('errorCode')})
                self.denied('owner_upsert_existing_object_denied',self.action('anchor','upload',{'path':self.path,'base64':base64.b64encode(b'mutated synthetic media').decode(),'mime':'audio/wav','upsert':True}))
                removal=self.action('anchor','remove',self.path)
                self.check('owner_delete_cannot_remove_object',removal.get('ok') is False or removal.get('removedCount')==0,{'ok':removal.get('ok'),'errorCode':removal.get('errorCode'),'removedCount':removal.get('removedCount')})
                self.bytes_ok('denied_mutations_preserve_original_bytes',self.action('anchor','download',self.path))
                invalid=self.action('anchor','invalidSession',self.path)
                self.check('invalid_session_token_rejected',invalid.get('ok') is False and invalid.get('status') in (400,401,403,404),{'status':invalid.get('status'),'errorCode':invalid.get('errorCode')})
                ran=self.action('anchor','range',self.path)
                expected=f'bytes 0-99/{len(self.wav)}'
                range_ok=ran.get('status')==206 and ran.get('bytes')==100 and ran.get('sha256')==sha(self.wav[:100]) and ran.get('contentRange')==expected
                self.report['rangeConfirmed']=range_ok
                self.check('range_206_content_range_exact_100_bytes',range_ok,{k:ran.get(k) for k in ('status','bytes','sha256','contentRange','acceptRanges','errorCode')},critical=False)
                # Signed URLs are bearer capabilities; never serialize the URL.
                signed=self.action('anchor','sign',self.path)
                self.check('owner_can_request_short_lived_signature',signed.get('ok') is True)
                self.secrets.append(signed['privateURL'])
                bearer=self.action('outsider','fetchPrivateURL',signed['privateURL'])
                self.bytes_ok('signed_url_bearer_is_transferable_no_auth_header',bearer)
                self.report['signedUrlConclusion']='TRANSFERABLE_BEARER: RLS authorizes issuance; URL use does not recheck the clicking account. Product must use authenticated Blob download.'
                if not self.storage_only:self.linked()
                self.check('no_page_errors',sum(self.report['pageErrorCounts'].values())==0,self.report['pageErrorCounts'])
                self.report['status']=('PASS_STORAGE_PREFLIGHT' if self.storage_only else 'PASS_MEDIA_ACL')+('_WITH_RANGE' if range_ok else '_RANGE_NOT_CONFIRMED')
            finally:browser.close()
        self.report['finishedAt']=now();self.write()
    def inspect_existing(self,suffix):
        if not re.fullmatch('[A-Za-z0-9_.-]{1,180}',suffix):raise ValueError('Invalid synthetic object suffix')
        self.report['scope']='Read-only inspection after ambiguous SDK remove success; no object writes. Native Auth + SDK info/download + fetch Range; synthetic WAV only.'
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
            try:
                for alias in ('anchor','outsider','anonymous'):self.actor(browser,alias)
                path=self.uid['anchor']+'/'+suffix
                self.report['objectKeyTemplate']='<anchor_uid>/'+suffix
                self.bytes_ok('original_object_still_exists_with_exact_bytes_after_remove_api',self.action('anchor','download',path))
                info=self.action('anchor','info',path);self.report['uploadedObjectInfo']=info.get('info');self.check('original_info_still_readable',info.get('ok') is True)
                for alias in ('outsider','anonymous'):self.denied(alias+'_known_path_read_denied',self.action(alias,'download',path))
                ran=self.action('anchor','range',path)
                confirmed=ran.get('status')==206 and ran.get('bytes')==100 and ran.get('sha256')==sha(self.wav[:100]) and ran.get('contentRange')==f'bytes 0-99/{len(self.wav)}'
                self.report['rangeConfirmed']=confirmed
                self.check('range_206_content_range_exact_100_bytes',confirmed,{k:ran.get(k) for k in ('status','bytes','sha256','contentRange','acceptRanges','errorCode')},critical=False)
                self.report['status']='PASS_READ_ONLY_INSPECTION'+('_WITH_RANGE' if confirmed else '_RANGE_NOT_CONFIRMED')
            finally:browser.close()
        self.report['finishedAt']=now();self.write()
    def linked(self):
        # Root explicitly enables capability only after native bucket ACL preflight.
        me=self.rpc('anchor','me');cap=me.get('data',{}).get('capabilities',{})
        self.report['capabilitiesReceivedKeys']=sorted(cap)
        assignment=self.rpc('operator','assignments.create',{'id':str(uuid.uuid4()),'title':self.id+' 合成媒体验收','boardId':'01','platform':'京东','deadline':(datetime.now(timezone.utc)+timedelta(days=1)).isoformat()},True)
        self.check('recipient_creates_real_assignment',assignment.get('ok') is True,{'errorCode':assignment.get('errorCode')})
        a=assignment['data']['assignment'];self.report['assignmentId']=a['id']
        joined=self.rpc('anchor','assignments.join',{'joinCode':a['joinCode']},True);self.check('anchor_joins_real_assignment',joined.get('ok') is True)
        items=[{'path':self.path,'mime':'audio/wav','size':len(self.wav),'sha256':sha(self.wav)}]
        for i in (2,3,4):
            path=self.upload('anchor',self.uid['anchor']+'/'+self.id+f'-{i}.wav');items.append({'path':path,'mime':'audio/wav','size':len(self.wav),'sha256':sha(self.wav)})
        foreign=self.upload('outsider',self.uid['outsider']+'/'+self.id+'-foreign.wav')
        self.invalid_submission('foreign_existing_storage_path_rejected',a['id'],[{**items[0],'path':foreign}],{'MEDIA_INVALID','FORBIDDEN'})
        self.invalid_submission('nonexistent_owned_object_rejected',a['id'],[{**items[0],'path':self.uid['anchor']+'/'+self.id+'-missing.wav'}],{'MEDIA_INVALID'})
        self.invalid_submission('forged_size_claim_rejected',a['id'],[{**items[0],'size':len(self.wav)+1}],{'MEDIA_INVALID'})
        self.invalid_submission('forged_mime_claim_rejected',a['id'],[{**items[0],'mime':'video/mp4'}],{'MEDIA_INVALID'})
        self.invalid_submission('four_real_uploaded_attachments_rejected',a['id'],items,{'LIMIT_EXCEEDED','MEDIA_INVALID'})
        submitted=self.rpc('anchor','submissions.create',self.submission(a['id'],items[:3]),True)
        self.check('three_real_media_attachments_receive_committed_receipt',submitted.get('ok') is True,{'errorCode':submitted.get('errorCode')})
        self.report['submissionId']=submitted['data']['receiptId']
        self.bytes_ok('recipient_after_link_download_exact_bytes',self.action('operator','download',self.path))
        self.bytes_ok('admin_after_link_download_exact_bytes',self.action('admin','download',self.path))
        for alias in ('outsider','anonymous'):
            self.denied(alias+'_after_link_download_denied',self.action(alias,'download',self.path))
            self.denied(alias+'_after_link_sign_denied',self.action(alias,'sign',self.path))
        self.invalid_submission('attached_object_cannot_bind_to_second_receipt',a['id'],items[:1],{'MEDIA_ALREADY_ATTACHED'})
        self.action('operator','logout')
        self.denied('recipient_after_logout_download_denied',self.action('operator','download',self.path))

def main():
    p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');p.add_argument('--storage-only',action='store_true');p.add_argument('--diagnose-upload',action='store_true');p.add_argument('--inspect-existing-suffix');p.add_argument('--private-config',default='/workspace/r25-cloud-test-credentials.json');p.add_argument('--out');args=p.parse_args()
    if not args.execute:
        print(json.dumps({'status':'PREPARED_NOT_EXECUTED','cloudRequests':0,'cloudWrites':0,'requires':'Root explicitly confirms native schema/helper/bucket/policies applied and roles bound before --execute'}));return
    config=private_config(args.private_config)
    out=Path(args.out) if args.out else ROOT/'results'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    if out.exists():raise SystemExit('Refusing to overwrite a prior result directory')
    run=Run(config,out,args.storage_only,args.diagnose_upload)
    try:
        if args.inspect_existing_suffix:run.inspect_existing(args.inspect_existing_suffix)
        else:run.run()
    except Exception as error:
        run.report['status']='FAIL';run.report['finishedAt']=now();run.report['failure']={'type':type(error).__name__,'step':str(error) if isinstance(error,AssertionError) and re.fullmatch('[A-Za-z0-9_.:-]+',str(error)) else 'See last recorded check; exception text intentionally omitted'};run.write()
        print(json.dumps({'status':'FAIL','out':str(out),'lastCheck':run.report['checks'][-1]['name'] if run.report['checks'] else None}));raise SystemExit(1)
    print(json.dumps({'status':run.report['status'],'checks':len(run.report['checks']),'rangeConfirmed':run.report['rangeConfirmed'],'out':str(out)}))

if __name__=='__main__':main()
