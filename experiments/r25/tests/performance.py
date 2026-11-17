#!/usr/bin/env python3
"""Reproducible browser performance samples; artificial DB fixtures, no models.
R24_PERF_SITE selects a frozen site; R24_PERF_OUT selects a new evidence directory.
Use R24_PERF_RATES and R24_PERF_REPEATS for the frozen sampling configuration.
"""
import functools, hashlib, json, os, pathlib, statistics, threading, time, traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright
R25_PIN="try{localStorage.getItem('tcl-r25-asr-engine')||localStorage.setItem('tcl-r25-asr-engine','tiny')}catch(e){}"  # R2.5 port: keep the R24 Whisper-path semantics and avoid the default Vosk auto-download (network)


REPO=pathlib.Path(__file__).resolve().parents[3]
SITE=pathlib.Path(os.environ.get('R24_PERF_SITE', str(REPO/'experiments/r24/tcl-v352-asr-r25-qa')))
OUT=pathlib.Path(os.environ.get('R24_PERF_OUT', str(REPO/'evidence/r25-ported/candidate')))
OUT.mkdir(parents=True,exist_ok=True)
RATES=[int(x) for x in os.environ.get('R24_PERF_RATES','1,4').split(',')]
REPEATS=int(os.environ.get('R24_PERF_REPEATS','3'))
COUNTS=[int(x) for x in os.environ.get('R24_PERF_COUNTS','20,100,200').split(',')]
DB='tcl-specialty-v352-asr-r25-qa'
INPUT=('input0123456789'*3)[:40]
ASSETS=['app.js','style.css','index.html']
def hashes():return {x:hashlib.sha256((SITE/x).read_bytes()).hexdigest() for x in ASSETS}
INIT=r'''(() => {
 const state={tx:[],puts:{},longtasks:[],inputFrames:[],summaryMutations:0,intervals:new Map(),intervalFires:0};
 const nativeSet=window.setInterval,nativeClear=window.clearInterval;
 window.setInterval=function(fn,delay,...args){let id;const call=typeof fn==='function'?function(...a){state.intervalFires++;return fn.apply(this,a)}:fn;id=nativeSet.call(window,call,delay,...args);state.intervals.set(id,delay);return id};
 window.clearInterval=function(id){state.intervals.delete(id);return nativeClear.call(window,id)};
 const tx=IDBDatabase.prototype.transaction;
 IDBDatabase.prototype.transaction=function(stores,mode,...args){state.tx.push({stores:[].concat(stores),mode:mode||'readonly'});return tx.call(this,stores,mode,...args)};
 const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(value,...args){state.puts[this.name]=(state.puts[this.name]||0)+1;return put.call(this,value,...args)};
 try{new PerformanceObserver(list=>state.longtasks.push(...list.getEntries().map(e=>({duration:e.duration,startTime:e.startTime})))).observe({entryTypes:['longtask']})}catch{}
 document.addEventListener('input',e=>{const start=performance.now();requestAnimationFrame(()=>{state.inputFrames.push({target:e.target.id||e.target.getAttribute('aria-label')||e.target.tagName,ms:performance.now()-start})})},true);
 document.addEventListener('DOMContentLoaded',()=>new MutationObserver(list=>{for(const r of list)if(r.target.id==='questionSummary')state.summaryMutations++}).observe(document,{childList:true,subtree:true}));
 window.__perf={reset(){state.tx=[];state.puts={};state.longtasks=[];state.inputFrames=[];state.summaryMutations=0;state.intervalFires=0;state.start=performance.now()},read(){return {elapsedMs:performance.now()-state.start,tx:state.tx,puts:state.puts,longtasks:state.longtasks,inputFrames:state.inputFrames,summaryMutations:state.summaryMutations,activeIntervals:[...state.intervals.values()],intervalFires:state.intervalFires,domNodes:document.querySelectorAll('*').length,summaryRows:document.querySelectorAll('#questionSummary tbody tr').length,viewport:{innerWidth,scrollWidth:document.documentElement.scrollWidth,scale:visualViewport?.scale||1}}}};
})();'''
FIXTURE='''async({name,n,dbName})=>{
 const db=await new Promise((res,rej)=>{const r=indexedDB.open(dbName);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
 const now=new Date().toISOString(),run='synthetic-perf-'+n;
 const turns=Array.from({length:n},(_,i)=>({id:run+'-'+i,runId:run,boardId:'01',category:'TCL 电视',platform:'京东',questionId:'synthetic-q-'+i,question:'人工构造第'+i+'题：如何核对型号与接口？',prompt:'人工构造第'+i+'题：如何核对型号与接口？',trainingHint:'核对资料',referenceAnswer:('人工构造参考答案，仅作性能测量；核对型号和接口。').repeat(12),source:'人工性能夹具',kind:'uploaded',model:'PERF-M'+i,sku:'PERF-SKU'+i,sourceRef:'人工性能样本',sourceLocators:['人工第'+i+'行'],keyPoints:['型号','接口'],pointKeywords:[['型号'],['接口']],answer:('人工构造主播回答：依据资料核对型号和接口。').repeat(6),transcript:'',responseSeconds:2,durationSeconds:20,createdAt:now,asrStatus:'人工填写',pointsHit:['型号','接口'],compliance:[],manualEdited:true,manualCleared:false}));
 const snap={id:run,anchorName:name,boardId:'01',category:'TCL 电视',platform:'京东',assignmentId:'',operatorName:'',assignmentTitle:'',startedAt:now,endedAt:now,durationSeconds:n*20,turns,incomplete:false,postTranscript:''};
 const checkpoint={id:'draft-session:'+encodeURIComponent(name),version:1,owner:name,runId:run,snapshot:snap,trainingLogId:'',videoMeta:null,mode:'text',updatedAt:now,media:[],writeToken:'synthetic-perf-token',revision:1};
 await new Promise((resolve,reject)=>{const tx=db.transaction(['items','prefs','records'],'readwrite');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);const items=tx.objectStore('items');for(let i=0;i<500;i++)items.put({id:'synthetic-item-'+i,boardId:'01',category:'TCL 电视',platform:'京东',scope:'board',model:'PERF-M'+i,sku:'SKU'+i,question:'人工资料第'+i+'条如何核对？',answer:'人工构造资料回答，只验证页面功能。'.repeat(8),keyPoints:['型号'],source:'人工性能样本',status:'published',kind:'uploaded',reviewStatus:'reviewed-demo'});tx.objectStore('prefs').put(checkpoint);for(const t of turns)tx.objectStore('records').put({...t,anchorName:name,result:'人工性能样本'});});db.close();return {turns:turns.length,items:500,checkpointBytes:JSON.stringify(checkpoint).length};}'''
READ='''async({name,dbName})=>{const db=await new Promise(r=>{const q=indexedDB.open(dbName);q.onsuccess=()=>r(q.result)});try{return await new Promise(r=>{const q=db.transaction('prefs').objectStore('prefs').get('draft-session:'+encodeURIComponent(name));q.onsuccess=()=>r(q.result)})}finally{db.close()}}'''
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(SITE)));threading.Thread(target=server.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{server.server_port}/'
report={'fixture_kind':'artificial, 500 library rows and 20/100/200 historical text turns, no speech/media','mode':'desktop Chromium, 390x844 mobile viewport, native IndexedDB; CDP CPU throttling is not a physical phone','script_sha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'source_hashes':hashes(),'configuration':{'rates':RATES,'repeats':REPEATS,'counts':COUNTS,'input_chars':len(INPUT),'input_delay_ms':20},'samples':[],'errors':[],'checks':{},'limits':['No real iPhone/Android keyboard or gesture zoom measurement','Synthetic workload, no real user business data','Wall times include scheduling and UI waits; report raw samples and medians rather than a global speed claim']}
def login(page,name):
 page.locator('[data-role-pick="anchor"]').click();page.locator('#simpleName').fill(name);page.locator('#simpleLogin').click();page.locator('#restoreLocalSession').wait_for()
def reset(page):page.evaluate('window.__perf.reset()')
def collect(page):return page.evaluate('window.__perf.read()')
def frames(page):page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
def visible_fields(page):
 return page.locator('input,textarea,select').evaluate_all('''els=>els.filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden').map(el=>({id:el.id||el.getAttribute('aria-label'),fontPx:parseFloat(getComputedStyle(el).fontSize),width:el.getBoundingClientRect().width}))''')
def nav(page,target):
 # Invoke the existing DOM button handler; avoiding menu animation makes timer leakage counting deterministic.
 page.locator(f'[data-page="{target}"]').evaluate('(el)=>el.click()');page.wait_for_function('(p)=>document.body.dataset.page===p',arg=target)
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage']);report['browser']=browser.version
  for rate in RATES:
   for n in COUNTS:
    for rep in range(REPEATS):
     row={'cpu_rate':rate,'turns':n,'repeat':rep+1};report['samples'].append(row)
     ctx=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1);ctx.add_init_script(R25_PIN);ctx.add_init_script(INIT);page=ctx.new_page();page.set_default_timeout(30000);page.on('pageerror',lambda e:report['errors'].append(str(e)))
     cdp=ctx.new_cdp_session(page);cdp.send('Emulation.setCPUThrottlingRate',{'rate':rate})
     page.goto(URL);page.locator('[data-role-pick="anchor"]').wait_for();name=f'人工性能{rate}-{n}-{rep}'
     row['fixture']=page.evaluate(FIXTURE,{'name':name,'n':n,'dbName':DB});page.reload();login(page,name)
     reset(page);page.locator('#restoreLocalSession').click();page.locator('#reviewDetails').wait_for();frames(page);row['restore_overview']=collect(page);row['overview_fields']=visible_fields(page)
     reset(page);page.locator('#reviewDetails').click();page.locator('textarea[aria-label="编辑本题回答"]').first.wait_for();frames(page);row['open_details']=collect(page);row['detail_fields']=visible_fields(page)
     # No rows are removed: paging, if available, must expose the final source question.
     row['details_initial_rows']=page.locator('#questionSummary tbody tr').count()
     row['details_total_text']=page.locator('#reviewDetailsScreen').inner_text()[:400]
     page.locator('#reviewGoReplay').click();page.locator('#reviewToolsFold > summary').click();page.locator('#postTranscript').wait_for();row['post_fields']=visible_fields(page)
     reset(page);page.locator('#postTranscript').press_sequentially(INPUT,delay=20);row['typing_events_end_ms']=collect(page)['elapsedMs']
     page.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='saved'",timeout=30000);page.wait_for_timeout(1100);frames(page);row['typing']=collect(page)
     saved=page.evaluate(READ,{'name':name,'dbName':DB});row['saved_full_text']=saved['snapshot']['postTranscript']==INPUT;row['saved_revision']=saved.get('revision')
     page.reload();login(page,name);page.locator('#restoreLocalSession').click();page.locator('#reviewReplay').wait_for();page.locator('#reviewReplay').click();page.locator('#reviewToolsFold > summary').click();row['reload_full_text']=page.locator('#postTranscript').input_value()==INPUT
     ctx.close();(OUT/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
     print(json.dumps({'rate':rate,'turns':n,'rep':rep+1,'restore_ms':round(row['restore_overview']['elapsedMs'],1),'hidden_rows':row['restore_overview']['summaryRows'],'detail_rows':row['details_initial_rows'],'typing_ms':round(row['typing_events_end_ms'],1),'write_tx':sum(x['mode']=='readwrite' for x in row['typing']['tx']),'record_puts':row['typing']['puts'].get('records',0),'input_frames':len(row['typing']['inputFrames']),'saved':row['saved_full_text'] and row['reload_full_text']},ensure_ascii=False),flush=True)
  # Navigation/search probe uses the same 500-row fixture in a separate context.
  ctx=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);ctx.add_init_script(R25_PIN);ctx.add_init_script(INIT);page=ctx.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)));page.goto(URL);page.locator('[data-role-pick="anchor"]').wait_for();name='人工切页性能';page.evaluate(FIXTURE,{'name':name,'n':20,'dbName':DB});page.reload();login(page,name)
  before=collect(page)['activeIntervals'];reset(page)
  for i in range(30):nav(page,['library','catalog','home'][i%3])
  after=collect(page);report['navigation30']={'before_intervals':before,**after};report['checks']['navigation_no_interval_growth']=len(after['activeIntervals'])<=len(before)
  nav(page,'library');page.locator('#librarySearch').fill('PERF-M499');frames(page);report['library_search']={'text':page.locator('#libraryList').inner_text(),'viewport':collect(page)['viewport'],'fields':visible_fields(page)};report['checks']['library_500_search_correct']='人工资料第499条' in report['library_search']['text']
  report['checks']['all_saved_and_reloaded']=all(x['saved_full_text'] and x['reload_full_text'] for x in report['samples']);report['checks']['no_page_errors']=not report['errors'];ctx.close();browser.close()
 report['status']='MEASURED' if all(report['checks'].values()) else 'FAIL'
except Exception as e:report['status']='FAIL';report['exception']=str(e);report['traceback']=traceback.format_exc();print(report['traceback'],flush=True)
finally:
 server.shutdown();report['source_hashes_after']=hashes();report['source_unchanged']=report['source_hashes']==report['source_hashes_after'];
 if not report['source_unchanged']:report['status']='FAIL'
 summary=[]
 for rate in RATES:
  for n in COUNTS:
   rows=[x for x in report['samples'] if x['cpu_rate']==rate and x['turns']==n and 'typing' in x]
   if not rows:continue
   values=lambda f:[f(x) for x in rows]
   def stat(v):return {'median':statistics.median(v),'min':min(v),'max':max(v),'n':len(v)}
   summary.append({'cpu_rate':rate,'turns':n,'restore_ms':stat(values(lambda x:x['restore_overview']['elapsedMs'])),'details_ms':stat(values(lambda x:x['open_details']['elapsedMs'])),'hidden_rows':values(lambda x:x['restore_overview']['summaryRows']),'detail_rows':values(lambda x:x['details_initial_rows']),'typing_event_loop_ms':stat(values(lambda x:x['typing_events_end_ms'])),'write_transactions':values(lambda x:sum(t['mode']=='readwrite' for t in x['typing']['tx'])),'record_puts':values(lambda x:x['typing']['puts'].get('records',0)),'longtasks_total_ms':values(lambda x:sum(t['duration'] for t in x['typing']['longtasks'])),'longtasks_max_ms':values(lambda x:max([t['duration'] for t in x['typing']['longtasks']] or [0]))})
 report['summary']=summary;(OUT/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));(OUT/'summary.json').write_text(json.dumps({'status':report['status'],'source_hashes':report['source_hashes'],'source_unchanged':report['source_unchanged'],'summary':summary,'checks':report['checks'],'exception':report.get('exception')},ensure_ascii=False,indent=2));print('RESULT',report['status'],len(report['samples']),flush=True)
if report['status']=='FAIL':raise SystemExit(1)
