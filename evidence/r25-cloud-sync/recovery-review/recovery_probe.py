#!/usr/bin/env python3
"""Actual app functions in Chromium with real IndexedDB; synthetic identities, no SDK/Auth/cloud calls.
Dependencies outside checkpoint/partition logic are minimal UI stubs. Faults delay native read callback or abort its transaction.
"""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
import threading,json,hashlib,traceback
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent
APP=Path('/workspace/tcl-r25-cloud/experiments/r25/tcl-v352-asr-r25-qa/app.js')
source=APP.read_text();sha=hashlib.sha256(APP.read_bytes()).hexdigest()
def part(start,end):
 a=source.index(start);b=source.index(end,a);return source[a:b]
functions='\n'.join([
 part('const dbOpen=()=>','const dbAll='),
 part('const dbAll=','const dbPut='),
 part('async function persistSessionCheckpoint(){','async function findSavedSession('),
 part('async function findSavedSession(','function savedSessionHtml(){'),
 part('function currentCloudCheckpointReady(){','async function initializeCloudWorkflow(){')])
bootstrap=r'''async (functions)=>{
const cloudbaseConfig={envId:'independent-local-only'};
const cloudPartitionName=(env,uid)=>`tcl-specialty-v352-asr-r25-qa:cloud:${encodeURIComponent(env)}:${encodeURIComponent(uid)}`;
const draftKey=name=>'draft-session:'+encodeURIComponent(name);
const draftMediaKey=(id,part)=>'draft-media:'+id+':'+part;
const checkpointToken=row=>!row?null:row.writeToken||('legacy:'+row.runId+':'+(row.updatedAt||''));
let checkpointCursor={key:'',token:null,known:false,ready:Promise.resolve()},checkpointWriteChain=Promise.resolve();
let localDB=null,localPartitionName='',memoryFallback=false,userName='',userRole='',restoreSessionEpoch=0,savedSessionCandidate=null;
let runId='',sessionStorageSeq=0,sessionStorageState={},sessionVideoBlob=null,sessionVideoMeta=null;
const perQuestionAudio=new Map(),storedSessionMedia=new Map();let storedSessionRecords=new Map(),localRecords=[];
const memStores={items:new Map(),records:new Map(),prefs:new Map()};
let localEntries=[],localAssignments=[],localAssignmentJoins=[],localTrainingLogs=[],localSubmissions=[],lastSessionSnapshot=null,lastTrainingLogId='',activeAssignmentId='';
let uploadedFileName='',librarySearch='',assignmentSearch='',pendingRole='',page='home',barrageIntervalMs=60000,cloudWorkspace=null,asrGlossary=null;
const cloud={token:'',role:'',name:''},cloudTrainingAttempts=new Set();
const cloudWorkflow={getState:()=>({initialized:false}),user:null};
const ELEM=id=>document.getElementById(id),render=()=>{},toast=m=>messages.push(m),messages=[];
const saveCurrentTypedAnswer=()=>{},invalidateImportPreview=()=>{},r6WhisperCancelAll=()=>{},resetRunState=()=>{runId='';storedSessionRecords=new Map()},stopScene=()=>{},discardVideoArchive=()=>{};
const updateMode=()=>{},initGlossaryUI=()=>({destroy(){}}),parseDocumentFile=()=>{};
const prefGet=(prefs,id,fallback)=>prefs.find(row=>row.id===id)?.value??fallback;
const loadPrefs=()=>new Promise((resolve,reject)=>{const q=localDB.transaction('prefs','readonly').objectStore('prefs').getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
let fixture=null;const currentSessionCheckpoint=()=>fixture,sessionTurnRecord=(turn,owner)=>({id:turn.id,anchorName:owner,answer:turn.answer});
const LOCAL_SESSION_LIMIT=96*1024*1024,uid=()=>crypto.randomUUID();
const showSessionStorageState=()=>{},localSessionFailure=(owner,error)=>{if(owner===runId)sessionStorageState={status:'error',message:error.message}};
let delayKey=null,failKey=null,releaseRead=null,readArrived=false,writeCount=0,rememberedCursor=null,readCount=0;
const nativeGet=IDBObjectStore.prototype.get,nativePut=IDBObjectStore.prototype.put;
IDBObjectStore.prototype.put=function(...args){if(this.name==='prefs'||this.name==='records')writeCount++;return nativePut.apply(this,args)};
IDBObjectStore.prototype.get=function(key){
 if(this.name==='prefs')readCount++;const request=nativeGet.call(this,key);
 if(this.name!=='prefs')return request;
 if(key===failKey){queueMicrotask(()=>{try{this.transaction.abort()}catch{}});return request;}
 if(key!==delayKey)return request;
 // Native IDB reads actual disk row; only application success delivery is deferred.
 const proxy={get result(){return request.result},get error(){return request.error},set onerror(fn){request.onerror=fn},set onsuccess(fn){request.onsuccess=event=>{readArrived=true;releaseRead=()=>fn.call(request,event)}}};return proxy;
};
const api={};
// Exact actual functions are evaluated in this lexical fixture; no product source rewrite.
eval(functions+`;api.switch=loadCloudLocalPartition;api.find=findSavedSession;api.persist=persistSessionCheckpoint;`);
const seed=async(owner,token)=>{
 const name=cloudPartitionName(cloudbaseConfig.envId,owner);
 const db=await new Promise((resolve,reject)=>{const q=indexedDB.open(name,1);q.onupgradeneeded=()=>{for(const store of ['items','records','prefs'])q.result.createObjectStore(store,{keyPath:'id'})};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
 const row={id:draftKey(owner),version:1,owner,runId:'run-'+owner,writeToken:token,updatedAt:'local',snapshot:{id:'run-'+owner,anchorName:owner,turns:[{id:'turn-'+owner,answer:'original '+owner}]}};
 await new Promise((resolve,reject)=>{const tx=db.transaction('prefs','readwrite');tx.objectStore('prefs').put(row);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});db.close();return row;
};
window.probe={seed,switch:identity=>{cloudWorkflow.user=identity;return api.switch(identity)},find:api.find,persist:api.persist,state:()=>({userName,userRole,partition:localPartitionName,cursor:{key:checkpointCursor.key,token:checkpointCursor.token,known:checkpointCursor.known},candidateOwner:savedSessionCandidate?.owner||null,candidateToken:savedSessionCandidate?.writeToken||null,saveState:sessionStorageState,messages:[...messages],writeCount,readCount}),
 rememberCursor:()=>{rememberedCursor=checkpointCursor},sameCursor:()=>rememberedCursor===checkpointCursor,externalToken:async token=>{await new Promise((resolve,reject)=>{const tx=localDB.transaction('prefs','readwrite'),store=tx.objectStore('prefs'),q=nativeGet.call(store,draftKey(userName));q.onsuccess=()=>nativePut.call(store,{...q.result,writeToken:token});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});},invalidateCursor:()=>{checkpointCursor={key:'',token:null,known:false,ready:Promise.resolve()};savedSessionCandidate=null},delay:key=>{delayKey=key;readArrived=false;releaseRead=null},arrived:()=>readArrived,release:()=>{const f=releaseRead;releaseRead=null;delayKey=null;f?.()},fail:key=>{failKey=key},
 fixture:owner=>{runId='new-run-'+owner;fixture={id:draftKey(owner),owner,runId,version:1,snapshot:{id:runId,anchorName:owner,turns:[{id:'new-turn-'+owner,answer:'new input'}]}}},clearFixture:()=>fixture=null,
 read:async(owner)=>{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open(cloudPartitionName(cloudbaseConfig.envId,owner));q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});try{return await new Promise((resolve,reject)=>{const req=nativeGet.call(db.transaction('prefs','readonly').objectStore('prefs'),draftKey(owner));req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}finally{db.close()}}
};return {scope:'actual-functions-real-Chromium-IDB',loaded:true};
}'''
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kw):super().__init__(*args,directory=str(ROOT),**kw)
 def log_message(self,*args):pass
(ROOT/'index.html').write_text('<!doctype html><meta charset="utf-8"><div id="view"></div>')
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
r={'scope':__doc__,'appShaBefore':sha,'checks':[],'pageErrors':[],'cloudCalls':0}
def check(name,ok,detail=None):
 r['checks'].append({'name':name,'pass':bool(ok),'detail':detail});assert ok,(name,detail)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);p=browser.new_page();p.on('pageerror',lambda e:r['pageErrors'].append(str(e)))
  p.goto('http://127.0.0.1:'+str(server.server_port)+'/');p.evaluate(bootstrap,functions)
  p.evaluate("async()=>{await probe.seed('A','token-A');await probe.seed('B','token-B');await probe.seed('C','token-C')}")
  p.evaluate("()=>probe.switch({uid:'A',role:'anchor'})");a=p.evaluate('probe.state()')
  check('automatic_partition_initializes_current_cursor',a['cursor']=={'key':'draft-session:A','token':'token-A','known':True},a)
  check('automatic_partition_reads_existing_candidate',a['candidateOwner']=='A' and a['candidateToken']=='token-A',a)
  p.evaluate('probe.invalidateCursor()');p.evaluate("()=>probe.switch({uid:'A',role:'anchor'})");fast=p.evaluate('probe.state()')
  check('same_partition_fastpath_initializes_missing_cursor',fast['cursor']=={'key':'draft-session:A','token':'token-A','known':True} and fast['candidateOwner']=='A',fast)
  p.evaluate("probe.fixture('A')");firstsave=p.evaluate('()=>probe.persist()');savedA=p.evaluate("()=>probe.read('A')");saveState=p.evaluate('probe.state()');p.evaluate('probe.clearFixture()')
  check('first_save_after_automatic_restore_commits',firstsave is True and savedA['runId']=='new-run-A' and savedA['snapshot']['turns'][0]['answer']=='new input' and saveState['saveState'].get('status')=='saved',saveState)
  p.evaluate('probe.rememberCursor()');knownBefore=p.evaluate('probe.state()');p.evaluate("()=>probe.switch({uid:'A',role:'anchor'})");knownAfter=p.evaluate('probe.state()')
  check('known_same_partition_preserves_cursor_object_without_read',p.evaluate('probe.sameCursor()') and knownAfter['cursor']==knownBefore['cursor'] and knownAfter['readCount']==knownBefore['readCount'],{'before':knownBefore,'after':knownAfter})
  p.evaluate("()=>probe.externalToken('external-A-new-token')");p.evaluate("()=>probe.switch({uid:'A',role:'anchor'})");externalReady=p.evaluate('probe.state()')
  check('same_partition_does_not_adopt_external_writer_token',p.evaluate('probe.sameCursor()') and externalReady['cursor']==knownBefore['cursor'],externalReady)
  p.evaluate("probe.fixture('A')");conflict=p.evaluate('()=>probe.persist()');conflictAfter=p.evaluate('probe.state()');conflictRow=p.evaluate("()=>probe.read('A')");p.evaluate('probe.clearFixture()')
  check('external_writer_conflict_is_rejected_without_puts',conflict is False and conflictAfter['saveState'].get('status')=='error' and conflictAfter['writeCount']==externalReady['writeCount'] and conflictRow['writeToken']=='external-A-new-token',{'state':conflictAfter,'row':conflictRow})
  p.evaluate("()=>{probe.delay('draft-session:A');window.delayedA=probe.find()}");p.wait_for_function('probe.arrived()')
  p.evaluate("()=>probe.switch({uid:'B',role:'anchor'})");before=p.evaluate('probe.state()');p.evaluate('probe.release()');p.evaluate('()=>window.delayedA');after=p.evaluate('probe.state()')
  check('late_A_read_cannot_replace_B_cursor',after['cursor']=={'key':'draft-session:B','token':'token-B','known':True},after)
  check('late_A_read_cannot_install_A_candidate',after['candidateOwner']=='B' and after['candidateToken']=='token-B',after)
  p.evaluate("()=>{probe.fail('draft-session:C');return probe.switch({uid:'C',role:'anchor'})}");failed=p.evaluate('probe.state()')
  check('failed_lookup_never_marks_known',failed['cursor']['key']=='draft-session:C' and failed['cursor']['known'] is False and failed['cursor']['token'] is None,failed)
  count=failed['writeCount'];p.evaluate("probe.fixture('C')");saved=p.evaluate('()=>probe.persist()');post=p.evaluate('probe.state()');row=p.evaluate("()=>probe.read('C')")
  check('failed_lookup_refuses_checkpoint_save',saved is False and post['saveState'].get('status')=='error',post)
  check('failed_lookup_never_overwrites_saved_row',row['writeToken']=='token-C' and row['runId']=='run-C' and count==post['writeCount'],row)
  check('no_page_errors',not r['pageErrors'],r['pageErrors']);r['browser']=browser.version;browser.close()
 r['appShaAfter']=hashlib.sha256(APP.read_bytes()).hexdigest();check('source_unchanged',r['appShaAfter']==sha);r['status']='PASS'
except Exception as e:r['status']='FAIL';r['error']={'message':str(e),'traceback':traceback.format_exc()}
finally:server.shutdown();(ROOT/'result.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps(r,ensure_ascii=False,indent=2))
if r['status']!='PASS':raise SystemExit(1)
