import { canonicalizeTerms } from './asr-glossary.mjs';
import { initGlossaryUI } from './glossary-ui.mjs';
import { toSimplified } from './asr-normalize.mjs';
import { createLocalWhisper } from './whisper-bridge.mjs';
import { createLocalParaformer } from './paraformer-bridge.mjs';
import { parseDocumentFile } from './lib/parser.js?v=r24-sync-v2-20261124.7';
import { extractQA, detectReviewConflicts } from './lib/qa-import.js';
import { assignmentDraftPanelHtml, bindAssignmentDraftPanel } from './assignment-draft-panel.mjs?v=r24-sync-v2-20261124.13-async-rc2';
import {validateExcelQuestions,assertExcelOneRowPerQuestion,makeAssignment,isAssigned,questionsForAssignment,toExchangePackage,verifyAssignment,toReceipt,verifyReceipt,verifyAssignmentSnapshot,assertExcelExtractionComplete,isReceiptLate} from './assignment-excel.mjs';

import { evaluationReadbackHtml, isRepositoryReviewPending, repositoryReviewLabel } from './assignment-evaluation.mjs?v=r24-sync-v2-20261124.13-async-rc2';
import { createAssignmentSync, normalizeDeviceCode } from './assignment-sync.mjs?v=r24-sync-v2-20261124.13-async-rc2';

const STORE_NAME='tcl-specialty-r24-paraformer-excel-qa-v1';
let sessionAssignmentSnapshot=null;
let assignmentSync=null, syncConfigError='', cloudAssignments=[], syncSubmitStatus=new Map();
let syncAssignmentsLoading=false, syncAssignmentsLoaded=false, syncAssignmentsMessage='';
let pendingCloudAssignment=null, workflowChannel=null;
const syncMember=()=>assignmentSync?.principal||null;
const visibleAssignments=()=>syncMember()?cloudAssignments.map(row=>row.assignment):localAssignments;
// UI-R2：统一的线性图标，替换各平台显示不一致的符号字符。
const ICON={'video': '<svg class="ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="3"/><path d="M16 10l5-3v10l-5-3"/></svg>', 'tasks': '<svg class="ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="17" rx="3"/><path d="M9 3h6v3H9z"/><path d="M8 12l2 2 4-4M8 17h8"/></svg>', 'more': '<svg class="ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>', 'list': '<svg class="ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>'};
const BOARDS_RAW=await (await fetch('./training-boards.json')).json();
const LEGACY_RAW=await (await fetch('./legacy-65.json')).json();
const BOARDS=BOARDS_RAW.boards;
const ELEM=(id)=>document.getElementById(id);
const ESC=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto?.randomUUID?.()||'id-'+Date.now()+'-'+Math.random().toString(16).slice(2);
const norm=(s)=>String(s||'').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const containsPII=(s)=>/(?:1[3-9]\d{9})|(?:\b\d{16,19}\b)|(?:[\w.+-]+@[\w.-]+\.[a-z]{2,})/i.test(String(s||''));
const boardById=(id)=>BOARDS.find(x=>x.id===String(id))||BOARDS[0];
const iconFor=(s)=>/电视/.test(s)?'▣':/空调/.test(s)?'❄':/冰箱/.test(s)?'▤':/洗衣/.test(s)?'◎':/显示器/.test(s)?'▥':/门锁/.test(s)?'⌘':/生活/.test(s)?'⌖':'◈';
const nowIso=()=>new Date().toISOString();
let page='home', selectedBoard='01', activePlatform='京东', activeQuestionIndex=0, questions=[], recChunks=[], currentRecorder=null, micStream=null, camStream=null, answerAudioURL='', chatTimer=null, liveStarted=false, importCandidate=[], localEntries=[], localRecords=[], legacyCards=LEGACY_RAW.cards, cloud={base:'',token:'',role:'',name:''}, librarySearch='', importBoardId='01', importScope='platform', importPlatform='京东', selectedLibraryBoard='all', selectedLegacyFilter='all', uploadedFileName='', userRole='', userName='', pendingRole='', assignmentSearch='', activeAssignmentId='', barrageIntervalMs=60000, localAssignments=[], localAssignmentJoins=[], localTrainingLogs=[], localSubmissions=[], lastSessionSnapshot=null, lastTrainingLogId='', reviewParked=false, reviewStage='overview', homeResultsUpdater=null;
let roomPhase='check', deviceCheckSeq=0, deviceCheck={camera:false,microphone:false,recorder:false,ready:false,mode:'hardware',checked:false}, lastDeviceError='';
let localDB=null, memoryFallback=false, cameraBusy=false;
let capturePending=false, captureSeq=0, sessionRecorder=null, sessionMicStream=null, sessionVideoStream=null, sessionChunks=[], sessionVideoBlob=null, sessionVideoURL='', sessionCaptureNote='', sessionVideoMeta=null;
let transcriptSeq=0, transcriptBusy=false, chatQuestionSeq=0;
let videoRecorderFinalizing=false, sessionVideoDownloaded=false,ttsSpeaking=false,ttsToken=0;
// V3.3.6 mobile-safe pilot limits. Longer 30–60 minute sessions need incremental disk persistence and real-device QA.
const MAX_CAPTURE_BYTES=64*1024*1024, CAPTURE_WARN_BYTES=48*1024*1024;
const captureMaxMs=()=>Math.min(8*60*1000,Math.max(500,Number(window.__CAPTURE_MAX_MS)||8*60*1000));
let captureLimitTimer=null,sessionStopReason='',audioDecodeJob=null,asrInferJob=null,exitGuardInstalled=false;
function clearCaptureLimit(){if(captureLimitTimer!==null){clearTimeout(captureLimitTimer);captureLimitTimer=null;}}
function needsExitWarning(){return !!(capturePending||sessionRecorder?.state==='recording'||videoRecorderFinalizing||(sessionVideoBlob&&!sessionVideoDownloaded)||speechRecognizer||oneShotAsrJob||questionAsrQueue.length||recorderFinalizing||transcriptBusy||r6WhisperRunning||r6WhisperQueue.length);}
function guardUnload(e){if(!needsExitWarning())return;e.preventDefault();e.returnValue='';}
function syncExitWarning(){if(exitGuardInstalled)return;exitGuardInstalled=true;window.addEventListener('beforeunload',guardUnload);}
function recordedSeconds(blob){
 if(blob!==sessionVideoBlob||!sessionVideoMeta?.startedAt)return null;
 const endWall=sessionVideoMeta.stoppedAt??Date.now();
 if(endWall<sessionVideoMeta.startedAt)return -1;
 const wallSec=(endWall-sessionVideoMeta.startedAt)/1000;
 const monoSec=(Number.isFinite(sessionVideoMeta.startedMono)&&Number.isFinite(sessionVideoMeta.stoppedMono)&&sessionVideoMeta.stoppedMono>=sessionVideoMeta.startedMono)?(sessionVideoMeta.stoppedMono-sessionVideoMeta.startedMono)/1000:0;
 return Math.max(wallSec,monoSec);
}
function ensureDecodeBudget(blob){
 if(!blob?.size)throw new Error('原始录像不存在');
 // Check metadata before allocating an ArrayBuffer or starting an AudioContext.
 const seconds=recordedSeconds(blob);
 if(seconds!==null&&seconds<0)throw new Error('录像起止时间戳异常（可能发生系统时钟跳变），为保护内存已拒绝直接解码，请先下载原视频');
 if(seconds!==null&&seconds>180)throw new Error(`本机录后识别/音轨提取最多180秒，本次约${Math.ceil(seconds)}秒。请下载原录像后分段处理`);
 if(blob.size>48*1024*1024)throw new Error('录像超过48MB本机解码安全额度。请下载原录像后使用离线工具提取音轨');
}

const memStores={items:new Map(),records:new Map(),prefs:new Map()};
const dbOpen=(name=STORE_NAME)=>new Promise((resolve,reject)=>{
 if(!('indexedDB' in window))return reject(new Error('IndexedDB unavailable'));
 let settled=false;
 const timeoutMs=typeof window.__IDB_TIMEOUT_MS==='number'?window.__IDB_TIMEOUT_MS:10000;
 const timer=setTimeout(()=>{if(!settled){settled=true;reject(new Error('IndexedDB open timeout'));}},timeoutMs);
 const done=(fn,val)=>{if(!settled){settled=true;clearTimeout(timer);fn(val);}};
 try{
  const req=indexedDB.open(name,1);
  req.onupgradeneeded=()=>{const db=req.result;for(const name of ['items','records','prefs'])if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'id'});};
  req.onsuccess=()=>{if(settled){try{req.result?.close?.();}catch{}return;}done(resolve,req.result);};
  req.onerror=()=>done(reject,req.error||new Error('IDB open error'));
  req.onblocked=()=>done(reject,new Error('IDB open blocked'));
 }catch(e){done(reject,e);}
});
const dbAll=(store)=>memoryFallback?Promise.resolve([...(memStores[store]?.values()||[])]):new Promise((resolve,reject)=>{const req=localDB.transaction(store,'readonly').objectStore(store).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
const dbPut=(store,obj)=>memoryFallback?(memStores[store]?.set(obj.id,obj),Promise.resolve(obj.id)):new Promise((resolve,reject)=>{try{const tx=localDB.transaction(store,'readwrite');let value=obj.id,failed=false;tx.oncomplete=()=>{if(!failed)resolve(value)};tx.onerror=()=>{failed=true;reject(tx.error||new Error('保存事务失败'))};tx.onabort=()=>{failed=true;reject(tx.error||new Error('保存已中止'))};const req=tx.objectStore(store).put(obj);req.onsuccess=()=>{value=req.result};req.onerror=()=>{failed=true;reject(req.error||new Error('写入失败'))}}catch(e){reject(e)}});
const dbDelete=(store,id)=>memoryFallback?(memStores[store]?.delete(id),Promise.resolve()):new Promise((resolve,reject)=>{try{const tx=localDB.transaction(store,'readwrite');let failed=false;tx.oncomplete=()=>{if(!failed)resolve()};tx.onerror=()=>{failed=true;reject(tx.error||new Error('删除事务失败'))};tx.onabort=()=>{failed=true;reject(tx.error||new Error('删除已中止'))};const req=tx.objectStore(store).delete(id);req.onerror=()=>{failed=true;reject(req.error||new Error('删除失败'))}}catch(e){reject(e)}});

// Full video remains local; text receipt, session audio and pending upload IDs commit together.
let submissionSaving=false, submittedPlaybackUrls=[],submittedPlaybackEpoch=0,submittedMediaSequence=0;
function clearSubmittedPlayback(){submittedPlaybackEpoch++;document.querySelectorAll('[id^="submitted-media-"] video,[id^="submitted-media-"] audio,[data-cloud-player] audio').forEach(media=>{try{media.pause()}catch{}});for(const url of submittedPlaybackUrls)URL.revokeObjectURL(url);submittedPlaybackUrls=[];document.querySelectorAll('[id^="submitted-media-"]').forEach(holder=>{holder.replaceChildren();delete holder.dataset.loaded;delete holder.dataset.loading;});document.querySelectorAll('[data-cloud-player]').forEach(holder=>{holder.replaceChildren();});}
function commitSubmission(submission,logId,media,expectedToken,stillCurrent=()=>true){
 if(memoryFallback||!localDB)return Promise.reject(new Error('本机数据库不可用，无法可靠保存提交；请先下载原录像'));
 return new Promise((resolve,reject)=>{let tx,error,merged;try{
  tx=localDB.transaction('prefs','readwrite');const store=tx.objectStore('prefs');
  const subReq=store.get('submissions'),logsReq=store.get('trainingLogs'),checkpointReq=store.get(draftKey(submission.anchorName));let waiting=3;
  const write=()=>{if(--waiting)return;try{
   if(!stillCurrent())throw new Error('提交页面、姓名或回答已变化，未提交');
   const checkpoint=checkpointReq.result;
   if(!expectedToken||checkpoint?.writeToken!==expectedToken||checkpoint.runId!==submission.sessionId||checkpoint.owner!==submission.anchorName)throw new Error('本场保存版本已变化，提交已取消，请重新恢复并核对');
   const oldSubs=subReq.result?.value||[],oldLogs=logsReq.result?.value||[];
   if(oldSubs.some(x=>x.sessionId===submission.sessionId&&x.assignmentId===submission.assignmentId&&x.anchorName===submission.anchorName))throw new Error('这次训练已经提交');
   merged={submissions:[submission,...oldSubs],logs:oldLogs.map(x=>x.id===logId?{...x,submitted:true}:x)};
   store.put({id:'submissions',value:merged.submissions,updatedAt:nowIso()});
   store.put({id:'trainingLogs',value:merged.logs,updatedAt:nowIso()});
   if(media)store.put(media);
  }catch(e){error=e;try{tx.abort()}catch{}}};
  subReq.onsuccess=write;logsReq.onsuccess=write;checkpointReq.onsuccess=write;
  tx.oncomplete=()=>resolve(merged);tx.onabort=()=>reject(error||tx.error||new Error('本机提交事务已取消'));tx.onerror=()=>{};
 }catch(e){if(tx)try{tx.abort()}catch{}reject(e)}});
}
function getSubmittedMedia(id){return new Promise((resolve,reject)=>{try{const tx=localDB.transaction('prefs','readonly'),req=tx.objectStore('prefs').get('submission-media:'+id);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);}catch(e){reject(e)}})}
async function showSubmittedMedia(id){
 if(userRole!=='operator'||!userName||!localDB||memoryFallback)return;
 const recipient=userName,submission=localSubmissions.find(x=>x.id===id&&x.operatorName===recipient),holder=ELEM('submitted-media-'+id);
 if(!submission||!holder||holder.dataset.loading||holder.dataset.loaded)return;const epoch=submittedPlaybackEpoch,loadId=String(++submittedMediaSequence);holder.dataset.loading=loadId;holder.textContent='正在读取本机录音录像…';
 try{const data=await getSubmittedMedia(id);
  if(epoch!==submittedPlaybackEpoch||holder.dataset.loading!==loadId||userRole!=='operator'||userName!==recipient||!holder.isConnected||!localSubmissions.some(x=>x.id===id&&x.operatorName===recipient))return;
  holder.replaceChildren();holder.dataset.loaded='1';
  if(!data){holder.textContent='本次没有保存可回放的音视频。';return;}
  if(data.video instanceof Blob){const label=document.createElement('p');label.textContent='本次录像（仅本机）';const player=document.createElement('video');player.controls=true;player.playsInline=true;player.style.maxWidth='100%';player.src=URL.createObjectURL(data.video);submittedPlaybackUrls.push(player.src);holder.append(label,player);}
  for(const audio of data.audio||[]){if(!(audio.blob instanceof Blob))continue;const label=document.createElement('p');label.textContent='单题录音：'+(audio.prompt||'');const player=document.createElement('audio');player.controls=true;player.src=URL.createObjectURL(audio.blob);submittedPlaybackUrls.push(player.src);holder.append(label,player);}
  if(!holder.childNodes.length)holder.textContent='本次没有保存可回放的音视频。';
 }catch(e){if(epoch===submittedPlaybackEpoch&&holder.dataset.loading===loadId&&holder.isConnected)holder.textContent='无法读取本机音视频：'+(e?.message||e);}
 finally{if(holder.dataset.loading===loadId)delete holder.dataset.loading;}
}

const loadPrefs=()=>Promise.all(['barrageIntervalMs','assignments','assignmentJoins','trainingLogs','submissions'].map(id=>new Promise((resolve,reject)=>{const tx=localDB.transaction('prefs','readonly'),req=tx.objectStore('prefs').get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)}))).then(rows=>rows.filter(Boolean));
const prefGet=(rows,id,fallback)=>rows.find(x=>x.id===id)?.value??fallback;
const savePref=(id,value)=>dbPut('prefs',{id,value,updatedAt:nowIso()});
// V3.4.9：跨标签列表修改必须在同一个 IndexedDB readwrite 事务内读取并写回。
// 同一对象仓库的 readwrite 事务跨标签串行化，防止多个并发写入覆盖；
// 事务真正完成后才通知其它标签刷新。仍是本机测试数据，不是云端协作/身份认证。
function attachWorkflowChannel(storageName){
 workflowChannel?.close();
 try{workflowChannel='BroadcastChannel' in window?new BroadcastChannel(storageName+'-workflow'):null;}catch{workflowChannel=null;}
 if(workflowChannel)workflowChannel.onmessage=()=>void refreshWorkflowState();
}
const notifyWorkflowChange=(id)=>{try{workflowChannel?.postMessage({type:'workflow',id})}catch{}};
const readPrefValue=(id)=>memoryFallback||!localDB?Promise.resolve(memStores.prefs.get(id)?.value):new Promise((resolve,reject)=>{try{const req=localDB.transaction('prefs','readonly').objectStore('prefs').get(id);req.onsuccess=()=>resolve(req.result?.value);req.onerror=()=>reject(req.error)}catch(e){reject(e)}});
function updatePrefList(id,mutate,{transactionTimeoutMs=0}={}){
 if(memoryFallback){
  try{const current=memStores.prefs.get(id)?.value;const next=mutate(Array.isArray(current)?current:[]);
   if(!Array.isArray(next))throw new Error('列表更新必须返回数组');
   memStores.prefs.set(id,{id,value:next,updatedAt:nowIso()});notifyWorkflowChange(id);return Promise.resolve(next);
  }catch(e){return Promise.reject(e)}
 }
 if(!localDB)return Promise.reject(new Error('本机数据库不可用，无法保存列表'));
  return new Promise((resolve,reject)=>{
   let tx,updated,error,finished=false,timedOut=false,timeoutTimer=null;
   const clearDeadline=()=>{if(timeoutTimer!==null){clearTimeout(timeoutTimer);timeoutTimer=null;}};
   try{
    tx=localDB.transaction('prefs','readwrite');const store=tx.objectStore('prefs');
   const req=store.get(id);
   req.onsuccess=()=>{
    try{
     const current=req.result?.value;
     updated=mutate(Array.isArray(current)?current:[]);
     if(!Array.isArray(updated))throw new Error('列表更新必须返回数组');
     store.put({id,value:updated,updatedAt:nowIso()});
    }catch(e){error=e;try{tx.abort()}catch{}}
   };
   tx.oncomplete=()=>{finished=true;clearDeadline();if(!timedOut){notifyWorkflowChange(id);resolve(updated)}};
   tx.onabort=()=>{finished=true;clearDeadline();if(!timedOut)reject(error||tx.error||new Error('本机列表更新事务已取消'))};
   tx.onerror=()=>{};
   const deadline=Number(transactionTimeoutMs);
   if(Number.isFinite(deadline)&&deadline>0){timeoutTimer=setTimeout(()=>{
    if(finished)return;
    timedOut=true;
    try{tx.abort()}catch{} // Already committed/aborted: the actual disk outcome is unconfirmed.
    reject(new Error('本机列表写入超过时限，已尝试取消事务，持久化结果未确认'));
   },Math.max(1,deadline));}
   }catch(e){clearDeadline();if(tx)try{tx.abort()}catch{}reject(e)}
  });
}
async function refreshWorkflowState(){
 if(memoryFallback||!localDB)return false;let prefs;try{prefs=await loadPrefs()}catch{return false}
 const next=[prefGet(prefs,'assignments',[]),prefGet(prefs,'assignmentJoins',[]),prefGet(prefs,'trainingLogs',[]),prefGet(prefs,'submissions',[])];
 if(JSON.stringify(next)===JSON.stringify([localAssignments,localAssignmentJoins,localTrainingLogs,localSubmissions]))return false;
 [localAssignments,localAssignmentJoins,localTrainingLogs,localSubmissions]=next;
 if(page==='home'&&userName){const active=document.activeElement,typing=active&&ELEM('view')?.contains(active)&&/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
  if(!typing)home();else if(userRole==='anchor'&&active.id==='assignmentSearch'&&typeof homeResultsUpdater==='function')homeResultsUpdater();}
 return true;
}
const persistWorkflowState=async()=>{await Promise.all([savePref('identity',{role:userRole,name:userName}),savePref('barrageIntervalMs',barrageIntervalMs),savePref('assignments',localAssignments),savePref('assignmentJoins',localAssignmentJoins),savePref('trainingLogs',localTrainingLogs),savePref('submissions',localSubmissions)]);};
const roleLabel=()=>userRole==='operator'?'直播运营':userRole==='anchor'?'主播':'';
function assignmentById(id){return visibleAssignments().find(x=>x.id===id)||null;}
function assignmentForReview(snap){
 return snap?.assignmentId?(assignmentById(snap.assignmentId)||
   (sessionAssignmentSnapshot?.id===snap.assignmentId?sessionAssignmentSnapshot:null)):null;
}
function currentAssignment(){return runId&&sessionAssignmentSnapshot?.id===activeAssignmentId?sessionAssignmentSnapshot:assignmentById(activeAssignmentId);}
// V3.4.9：到点即截止（<=）；未加入的显示“已截止”，已加入/已训练未交的显示“已逾期”；截止后提交标记“逾期提交”。
function assignmentExpired(a){return !!a?.deadline&&new Date(a.deadline).getTime()<=Date.now();}
function cloudAssignmentState(id){return cloudAssignments.find(row=>row.assignment.id===id);}
function assignmentJoined(a,anchor){
 const cloudRow=syncMember()?cloudAssignmentState(a.id):null;
 return cloudRow?Boolean(cloudRow.claimedAt||cloudRow.submitted):
  localAssignmentJoins.some(row=>row.assignmentId===a.id&&row.anchorName===anchor);
}
function canSeeAssignment(a){return Boolean(syncMember())||isAssigned(a,userName);}
function assignmentStatusFor(a,anchor){
 const cloudRow=syncMember()?cloudAssignmentState(a.id):null;
 if(cloudRow){
  if(cloudRow.submitted)return '已提交到云端';
  if(assignmentExpired(a))return cloudRow.claimedAt?'已逾期':'已截止';
  if(cloudRow.claimedAt)return '已加入';
  return '未加入';
 }
 const sub=localSubmissions.find(x=>x.assignmentId===a.id&&x.anchorName===anchor);
 if(sub)return sub.cloudConfirmed?'已提交到云端':sub.manuallyImported?
  (sub.late?'逾期提交 · 回执待核实':'回执待核实'):sub.late?'本机已保存（逾期）':'本机已保存';
 const log=localTrainingLogs.find(x=>x.assignmentId===a.id&&x.anchorName===anchor);
 const join=assignmentJoined(a,anchor);
 if(assignmentExpired(a))return (log||join)?'已逾期':'已截止';
 if(log)return '已训练';
 if(join)return '已加入';
 return '未加入';
}
// UI boundaries in this local demo are not authentication: users sharing a browser
// can choose any name or inspect its storage. A shared backend must enforce access.
function pageAllowed(target){
 if(target==='home'||target==='roleLogin')return true;
 if(!userName)return false;
 const anchorPages=['catalog','training','sessionReview','progress','legacy','library'];
 const operatorPages=['library','import','review','settings'];
 return (userRole==='anchor'?anchorPages:userRole==='operator'?operatorPages:[]).includes(target);
}
function applyRoleChrome(){
 document.body.dataset.role=userRole||'guest';
 const brand=ELEM('modeText');
 if(brand&&userName&&!assignmentSync&&!syncConfigError)brand.textContent=`${roleLabel()} · ${userName} · 本机测试`;
 document.querySelectorAll('[data-page]').forEach(el=>{el.hidden=!pageAllowed(el.dataset.page)});
 // 主播在普通页面只需一键到达首页、练播、记录；摄像头与复盘全屏时不占空间。
 const quick=ELEM('mobileQuickNav');
 if(quick){
  quick.hidden=!(userRole==='anchor'&&['home','catalog','progress'].includes(page));
  document.body.dataset.quicknav=quick.hidden?'off':'on';
  quick.querySelectorAll('[data-quick-page]').forEach(btn=>{
   const active=btn.dataset.quickPage===page;
   btn.classList.toggle('active',active);
   if(active)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');
  });
 }
}
function ownRecords(){return userRole==='anchor'&&userName?localRecords.filter(r=>r.anchorName===userName):[];}
function backupForIdentity(){
 if(!userName||!['anchor','operator'].includes(userRole)){toast('请先选择身份并输入姓名');return;}
 const base={exportedAt:nowIso(),role:userRole,name:userName,note:'本机测试备份仅包含文字数据，不包含录音录像；姓名不是安全认证，不代替云端备份。'};
 if(userRole==='anchor')base.records=ownRecords();
 else {base.items=localEntries;base.submissions=localSubmissions.filter(s=>s.operatorName===userName);}
 downloadJSON('TCL-练播房本机备份.json',base);
}
const toast=(message)=>{const el=ELEM('toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.tm);toast.tm=setTimeout(()=>el.classList.remove('show'),3400)};
const categoryType=(b)=>b.category;
const platformOptions=(b)=>b.platforms;
const matchEntry=(entry,board,platform)=>entry.status==='published' && (entry.scope==='category'?entry.category===board.category:entry.boardId===board.id) && (entry.platform==='全部平台'||entry.platform===platform||entry.platform==='京东/天猫'&&['京东','天猫'].includes(platform)||board.id==='12'&&platform==='抖音'&&entry.platform==='抖音生活服务');
function defaultEntries(){const rows=[];for(const b of BOARDS){for(const [index,e] of b.exercises.entries()){rows.push({id:`seed-${b.id}-${index}`,boardId:b.id,category:b.category,scope:'board',platform:'全部平台',stage:e.kind||'',question:e.question,answer:'',keyPoints:e.semantic_points||[],pointKeywords:e.semantic_keywords||[],source:'16板块研究底稿 · 教学示例（不作为正式标准答案）',status:'published',kind:'seed',reviewStatus:'教学示例 · 缺少经核准的标准答案',createdAt:nowIso()});}}return rows;}
const getEntries=()=>[...defaultEntries(),...localEntries];
// Reviewed source material is the practice pool. Teaching examples are a fallback
// only when this category/platform has no published answer-bearing source rows.
function practiceEntriesFor(board,platform){
 const source=localEntries.filter(e=>e.kind!=='seed'&&matchEntry(e,board,platform)&&String(e.answer||'').trim()&&!modelRequiredForQuestion(e));
 // Only the fixed built-in price exercise adopts the selected platform. Keep
 // source files, stable IDs, teaching points and reviewed material unchanged.
 return source.length?source:defaultEntries().filter(e=>matchEntry(e,board,platform)).map(e=>({...e,question:e.question.replace(/^(?:京东\/天猫(?:\/抖音)?|抖音)(上的价格、优惠、送装和售后怎么合规确认？)$/,(_,suffix)=>platform+suffix)}));
}
function practicePoolLabel(board,platform){const rows=practiceEntriesFor(board,platform);return `${rows.length} 道${rows[0]?.kind==='seed'?'教学示例（暂无已审核资料）':'已审核资料题'}`;}
function questionSnapshot(q){return {questionId:q.id||'',question:q.question||'',referenceAnswer:q.answer||'',source:q.source||'',kind:q.kind||'',model:q.model||'',sku:q.sku||'',sourceRef:q.sourceRef||'',sourceLocators:[...(q.sourceLocators||[])]};}
function turnReferenceSnapshot(turn){return {questionId:turn.questionId||'',question:turn.question??turn.trainingHint??turn.prompt??'',referenceAnswer:turn.referenceAnswer||'',source:turn.source||'',kind:turn.kind||'',model:turn.model||'',sku:turn.sku||'',sourceRef:turn.sourceRef||'',sourceLocators:[...(turn.sourceLocators||[])]};}
function missingModelHint(q){
 if(String(q.model||'').trim()||!/(?:这台|这款|该款|该型号|本款|此款|该台|(?:这个|这部|该|本|此)(?:电视|空调|冰箱|洗衣机|显示器|门锁|产品|设备|型号))/.test(q.question||''))return '';
 // A visibly named model in the original question does not require duplicating
 // it into a new column. Technology tokens alone are not a product model.
 const tokens=String(q.question||'').match(/[A-Za-z0-9][A-Za-z0-9.+/-]*[A-Za-z0-9]/g)||[];
 if(tokens.some(x=>!/^SKU(?:[-_]|\d)/i.test(x)&&x!==String(q.sku||'').trim()&&/[A-Za-z]/.test(x)&&/\d/.test(x)&&!/^(?:(?:HDMI|HDR|USB|WIFI|WLAN|BT|DDR|VRR|MEMC|DOLBY|DP|HDCP|H)\d*(?:[.+/-]\d+)*[+]?|(?:\d+(?:K|HZ|W|KW|L|GB|TB|NITS|BIT|MBPS))+)$/i.test(x))||/(?:TCL|雷鸟)[\u3400-\u9fff]{1,6}\d+/i.test(q.question||''))return '';
 return '待补型号：问题使用了“这台/这款”等指代，请结合资料核实；SKU不会自动当作型号。';
}
function questionMetadataHtml(q){
 const items=[q.model&&`型号：${q.model}`,q.sku&&`SKU（上下文）：${q.sku}`,q.sourceRef&&`资料来源：${q.sourceRef}`,...(q.sourceLocators||[]).map(x=>`行定位：${x}`)].filter(Boolean);
 return items.map(x=>`<p class="muted">${ESC(x)}</p>`).join('')+(missingModelHint(q)?`<p class="notice">${ESC(missingModelHint(q))}</p>`:'');
}
function referenceHtml(turn){return `<b>${turn.kind==='seed'?'教学示例 · 要点自查':'本题参考回答（开场资料快照）'}</b><p>${ESC(turn.referenceAnswer||'本题没有经审核参考答案；历史记录未保存答案快照时，不回填当前题库。')}</p><b>应覆盖的重点</b><ul>${(turn.keyPoints||[]).map(k=>`<li>${ESC(k)}</li>`).join('')}</ul>${questionMetadataHtml(turn)}<small>来源：${ESC(turn.source||'历史记录未保存来源')}</small>`;}
function referenceDetailsHtml(turn){return `<details><summary>查看本题参考与来源</summary><p>原问题：${ESC(turn.question??turn.trainingHint??turn.prompt??'')}</p>${referenceHtml(turn)}</details>`;}

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

// V3.4 public-only simulation. Private workbook contents MUST NOT be bundled.
const DANMU_TEMPLATES=BOARDS_RAW.barrage_templates?.templates||[];
const COMPLIANCE_RULES=BOARDS_RAW.compliance_rules?.rules||[];
const MODEL_NAMES=BOARDS_RAW.public_model_names||{};
const platformGroup=p=>(p==='京东'||p==='天猫'||p==='京东/天猫')?'jd_tmall':'douyin';
const TRIGRAM=(s)=>{const n=norm(s);return [...new Set(Array.from({length:Math.max(0,n.length-1)},(_,i)=>n.slice(i,i+2)))]};
const fuzzyPoint=(point,text,aliases=[])=>{
  const p=norm(point),t=norm(text),alts=[p,...(Array.isArray(aliases)?aliases:[]).map(norm)].filter(Boolean);
  if(!p||!t)return false;
  const neg=p.match(/^(不|不要|不得|禁止|严禁|避免|不可|不能)/)?.[0]||'';
  const aliasHit=(a)=>a.length>=2&&t.includes(a);
  if(neg){
   // A negative/verification cue must govern the matched concept, not merely occur
   // somewhere nearby. Exact negative wording remains valid even for short points.
   if(t.includes(p))return true;
   const cueGoverns=(a)=>{
    if(!aliasHit(a))return false;
    let from=0;
    while(true){
     const idx=t.indexOf(a,from);if(idx<0)return false;
     const before=t.slice(Math.max(0,idx-8),idx);
     const after=t.slice(idx+a.length,Math.min(t.length,idx+a.length+12));
     const negPrefix=/(?:不|不会|不再|别|勿|莫|避免|禁止|严禁|不可|不能|不得|不要)(?:直接|轻易|随意|明确|主动|一概)?(?:承诺|保证|宣称|夸大|虚构)?$/;
     const negSuffix=/^(?:也要|要)?(?:不|不会|不再|别|勿|莫|避免|禁止|严禁|不可|不能|不得|不要)(?:直接|轻易|随意|明确|主动|一概)?(?:承诺|保证|宣称|夸大|虚构)/;
     const verifyBefore=/(?:需要|先|分别)核对$/;
     const verifyAfter=/^(?:(?:也要|要)?以.{0,6}为准|(?:需要|先|分别)核对)/;
     if(negPrefix.test(before)||negSuffix.test(after)||verifyBefore.test(before)||verifyAfter.test(after))return true;
     from=idx+Math.max(1,a.length);
    }
   };
   if(Array.isArray(aliases)&&aliases.length){
    const selfSafeAlias=(a)=>/^(?:不|别|勿|莫|避免|禁止|严禁|不可|不能|不得|不要)/.test(a)||/(?:核对|为准)$/.test(a)||a==='每类不同';
    return alts.some(a=>aliasHit(a)&&(selfSafeAlias(a)||cueGoverns(a)));
   }
   // Uploaded/reviewed questions have no controlled aliases. First try the full
   // concept (also preserves short paraphrases such as 禁止夸大→严禁夸大), then
   // fall back to legacy fuzzy chunks while keeping the cue bound to a chunk.
   const concept=p.slice(neg.length);
   if(concept.length>=2&&cueGoverns(concept))return true;
   if(concept.length<4)return false;
   const chunks=TRIGRAM(concept),matched=chunks.filter(c=>t.includes(c));
   if(chunks.length<=1||matched.length/chunks.length<0.66)return false;
   return matched.some(cueGoverns);
  }
  if(alts.some(aliasHit))return true;
  // For seed questions, semantic_keywords provide controlled synonyms. If none hit,
  // retain the legacy fuzzy fallback for uploaded/reviewed questions only.
  if(Array.isArray(aliases)&&aliases.length)return false;
  if(p.length<4)return false;
  const chunks=TRIGRAM(p);
  return chunks.length>1&&chunks.filter(c=>t.includes(c)).length/chunks.length>=0.66;
};
const complianceHints=(text,platform)=>{
 const group=platformGroup(platform),found=[];
 for(const rule of COMPLIANCE_RULES){
  if(rule.platform_group!=='common'&&rule.platform_group!==group)continue;
  try{
   const match=new RegExp(rule.pattern,'i').exec(String(text||''));
   if(match)found.push({id:rule.id,category:rule.category,matched:match[0],level:rule.level,
    manual:!!rule.manual_review,suggestion:rule.suggestion});
  }catch(e){console.warn('invalid public compliance rule',rule.id)}
 }
 if(group==='jd_tmall'){
  const cross=platform==='京东'?/(天猫|淘宝|某宝)/i:platform==='天猫'?/(京东|某东)/i:null;
  const match=cross?.exec(String(text||''));
  if(match){
   const base=COMPLIANCE_RULES.find(r=>r.id==='CR07');
   found.push({id:'CR07',category:base?.category||'提及/比较其他平台',matched:match[0],level:base?.level||'P0',manual:true,suggestion:base?.suggestion||'当前直播间不提其他平台，不做平台比较'});
  }
 }
 return found;
};
const randomOf=(arr)=>arr[Math.floor(Math.random()*arr.length)];
const modelCategory=(category)=>/冰箱/.test(category)?'冰箱':/空调/.test(category)?'空调':/洗衣/.test(category)?'洗衣机':/显示器/.test(category)?'显示器':/电视/.test(category)?'电视':'';
// Public model names were already present in V3.4; never load private product talk tracks.
// Each question must point to a real public-listed model/series or use a category-level fallback.
const parsePublicModels=(label,category)=>{
 const raw=String(label||'').replace(/\s*\n\s*/g,' ').trim();
 if(!raw)return [];
 if(category!=='电视')return [raw];
 // Single size-prefixed labels are ambiguous SKU-style entries: drop rather than invent a series name.
 if(/^\d{2,3}[A-Za-z]/.test(raw))return [];
 const stripped=raw.replace(/^(?:\d{2,3}\/)+\d{2,3}\s*/,'').trim();
 if(!stripped||/^\d{2,3}(?:\/\d{2,3})*$/.test(stripped))return [];
 return stripped.split('/').map(x=>x.trim()).filter(x=>x&&/[A-Za-z]/.test(x)&&!/^\d{2,3}$/.test(x));
};
const cleanPublicModel=(label,category)=>parsePublicModels(label,category)[0]||'';
const publicModels=(category)=>[...new Set((MODEL_NAMES[category]||[]).flatMap(x=>parsePublicModels(x,category)).filter(Boolean))];
const modelContext=(board)=>{
 const categoryName=String(board?.category||'');
 // There is no verified ThunderBird brand model list in V3.4. Never use TCL models here.
 if(/雷鸟/.test(categoryName))return {label:categoryName,second:'',hasModel:false,productCategory:''};
 let category=modelCategory(categoryName);
 if(/全品类/.test(categoryName)){
  const categories=['电视','冰箱','空调','洗衣机','显示器'].filter(k=>publicModels(k).length);
  category=categories.length?randomOf(categories):'';
 }
 const candidates=category?publicModels(category):[];
 if(!candidates.length)return {label:categoryName||'家电',second:'',hasModel:false,productCategory:category};
 const model=randomOf(candidates);
 const others=candidates.filter(name=>name!==model);
 const prefix=/全品类/.test(categoryName)?`TCL${category} `:'';
 // 全品类板块的对比问法要落在两个不同品类上，才能对上“按品类分别讲、参数不混用”的训练要点。
 if(/全品类/.test(categoryName)){const otherCats=['电视','冰箱','空调','洗衣机','显示器'].filter(k=>k!==category&&publicModels(k).length);
  if(otherCats.length){const c2=randomOf(otherCats);return {label:prefix+model,second:`TCL${c2} `+randomOf(publicModels(c2)),hasModel:true,productCategory:category};}}
 return {label:prefix+model,second:others.length?prefix+randomOf(others):'',hasModel:true,productCategory:category};
};
const templateText=(pattern,board,ctx=modelContext(board),platform='')=>{
 const product=ctx.productCategory||modelCategory(board.category);
 const sizes=product==='显示器'?[24,27,32]:[55,65,75,85];
 const parameter={电视:'HDMI接口',显示器:'刷新率',空调:'能效与制冷',冰箱:'容量与保鲜',洗衣机:'洗涤程序'}[product]||(/智能门锁/.test(board.category)?'开锁方式和电池状态':'使用条件');
 const scene={电视:'看电影',显示器:'办公或游戏',空调:'卧室制冷',冰箱:'家庭食材存储',洗衣机:'日常洗护'}[product]||(/智能门锁/.test(board.category)?'家庭入户安全':'日常使用');
 const values={型号:ctx.label,对比型号:ctx.second||ctx.label,尺寸:String(randomOf(sizes)),数字:String(randomOf([3,4,5])),参数:parameter,场景:scene,平台:platform||'当前平台'};
 // Defensive migration for any historical templates that still used "{n}号".
 return String(pattern).replace(/\{n\}号/g,ctx.label).replace(/\{n\}/g,ctx.label)
  .replace(/\{(型号|对比型号|尺寸|数字|参数|场景|平台)\}/g,(_,key)=>values[key]);
};
const pickDanmu=(board,platform,mode='question')=>{
 if(mode==='question'&&/本地生活/.test(board.category)){
  const text=randomOf(['套餐具体包含哪些项目？','哪些门店可以使用这个套餐？','购买后怎么预约和核销？','有效期和使用限制在哪里核实？']);
  return {id:uid(),text,needsAnswer:true,priority:false,templateId:'local-life-safe'};
 }
 if(mode==='question'&&/智能门锁/.test(board.category)){
  const text=randomOf(['这类智能门锁支持哪些开锁方式？','安装前需要确认哪些门体条件？','电池续航和低电量提醒怎么查看？','安装和售后服务在哪里核实？']);
  return {id:uid(),text,needsAnswer:true,priority:false,templateId:'smart-lock-safe'};
 }
 const scope=danmuScope(board.category);
 let pool=DANMU_TEMPLATES.filter(t=>t.platform_group===platformGroup(platform)&&!(t.exclude_scopes||[]).includes(scope));
 if(mode==='question')pool=pool.filter(t=>t.needs_answer&&!t.priority);
 else if(mode==='chatter')pool=pool.filter(t=>!t.needs_answer);
 else if(mode==='complaint')pool=pool.filter(t=>t.priority);
 if(scope==='local')pool=pool.filter(t=>!/发货|安装|家里刚好要换|补贴/.test(t.text));
 if(scope==='monitor'||scope==='rhino_monitor')pool=pool.filter(t=>!/安装师傅/.test(t.text));
 if(!/电视|显示器/.test(board.category))pool=pool.filter(t=>!/\{尺寸\}|英寸/.test(t.text));
 // Auxiliary chatter stays generic: no unrelated product model or size.
 if(mode!=='question')pool=pool.filter(t=>!t.requires_multiple_models&&!/\{(?:型号|对比型号|尺寸|n)\}|英寸/.test(t.text));
 const ctx=mode==='question'?modelContext(board):{label:board.category,second:'',hasModel:false,productCategory:modelCategory(board.category)};
 if(mode!=='question'&&!pool.length)return {id:uid(),text:mode==='complaint'?'售后问题应该在哪里联系处理？':'主播请继续介绍，我在了解使用需求。',needsAnswer:mode==='complaint',priority:mode==='complaint',templateId:'generic-'+mode};
 if(!ctx.hasModel)pool=pool.filter(t=>!t.requires_multiple_models);
 const t=!pool.length?{id:'fallback',text:'{型号}有哪些需要了解的功能？',needs_answer:true,priority:false}:mode==='question'?randomOf(pool):bagPick(['c',mode,platformGroup(platform),board.category].join('|'),pool);
 // No verified models for this brand/category? Ask useful general questions instead of
 // implying a specific live product, cart number, price or promotion exists.
 const genericQuestions={
  ask_price:'{型号}现在有哪些系列可以了解？',
  ask_model:'{型号}现在有哪些系列？',
  ask_feature:'{型号}主要有哪些功能？',
  ask_discount:'{型号}的活动信息在哪里核实？',
  ask_compare:'{型号}不同系列有什么区别？',
  ask_followup:'{型号}适合哪些使用场景？安装和售后怎么了解？'
 };
 const type=t.id.split('-').slice(1).join('-');
 const pattern=!ctx.hasModel&&(genericQuestions[type]||null)||
  (t.requires_multiple_models&&!ctx.second?'{型号}有哪些功能？':t.text);
 const text=templateText(pattern,board,ctx,platform);
 return {id:uid(),text,needsAnswer:!!t.needs_answer,priority:!!t.priority,templateId:t.id};
};
// V3.4.5 弹幕多样化：同一教学题在屏幕上以多种观众问法出现（同一训练点与自查要点）。
// 问法只提问不作答；不含价格数字、商品编号或其他平台名；雷鸟/门锁/本地生活不套用 TCL 型号。
const QUESTION_VARIANTS=BOARDS_RAW.barrage_templates?.question_variants||[];
const NICK_PARTS=BOARDS_RAW.barrage_templates?.nickname_parts||{a:[],b:[]};
const danmuScope=(category)=>/雷鸟电视/.test(category)?'rhino_tv':/雷鸟显示器/.test(category)?'rhino_monitor':/本地生活/.test(category)?'local':/智能门锁/.test(category)?'lock':/全品类/.test(category)?'all_cat':/电视/.test(category)?'tv':/空调/.test(category)?'ac':/冰箱/.test(category)?'fridge':/洗衣/.test(category)?'washer':/显示器/.test(category)?'monitor':'';
const DANMU_FILLS={距离:['2.5米','3米','3.5米','4米','4.5米','5米'],面积:['12平','15平','18平','20平','25平','30平'],房间:['卧室','主卧','次卧','客厅','书房','儿童房'],人数:['两口之家','三口之家','四口人','五口人','一家六口'],人群:['老人','爸妈','小孩','孩子','家里老人'],用途:['办公','修图','剪视频','打游戏','写代码','做设计'],设备:['笔记本','台式机','PS5','Switch','Mac'],宽度:['60厘米','65厘米','70厘米','80厘米'],桌深:['60厘米','70厘米','80厘米'],门:['防盗门','入户门','老小区的铁门','木门'],品类:['电视','空调','冰箱','洗衣机','显示器']};
const DANMU_PREFIXES=['','','','','','主播，','主播主播，','请问','想问下','问一下，','在吗，'];
// 近期记忆在本页打开期间跨轮保留，避免"过一轮又一样"。
let recentDanmuTexts=[],questionBag=[],lastQuestionId='';
// 洗牌袋：同一组（板块范围+阶段+平台组）里的问法全部出现一遍后才重新洗牌；新一袋把上一袋最后出现的一半排在后面，
// 因此同一问法至少间隔 floor(n/2)+1 次才可能再出现（跨轮、跨场有效，页面打开期间保留）。
const danmuBags=new Map();
function bagPick(key,items){
 const ids=items.map(x=>x.id);let bag=(danmuBags.get(key)||[]).filter(id=>ids.includes(id));
 const tail=(danmuBags.get(key+'#tail')||[]).filter(id=>ids.includes(id));
 if(!bag.length)bag=[...shuffled(ids.filter(id=>!tail.includes(id))),...shuffled(ids.filter(id=>tail.includes(id)))];
 const id=bag.shift();tail.push(id);while(tail.length>Math.max(1,Math.floor(ids.length/2)))tail.shift();
 danmuBags.set(key,bag);danmuBags.set(key+'#tail',tail);return items[ids.indexOf(id)];
}
function rememberRecent(list,value,limit){list.push(value);while(list.length>limit)list.shift();}
function shuffled(arr){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function viewerNick(board=boardById(selectedBoard)){
 const scope=danmuScope(board?.category||'');
 const rawA=NICK_PARTS.a||[],b=NICK_PARTS.b||[],r=Math.random();
 const a=rawA.filter(prefix=>{
  if(prefix==='想换电视的'||prefix==='爱看球的')return scope==='tv'||scope==='rhino_tv'||scope==='all_cat';
  if(prefix==='装修中的')return scope!=='local'&&scope!=='monitor'&&scope!=='rhino_monitor';
  return true;
 });
 if(a.length&&b.length&&r<0.55)return randomOf(a)+randomOf(b);
 if(b.length&&r<0.7)return randomOf(b)+String(Math.floor(Math.random()*90)+10);
 return '用户'+String(1000+Math.floor(Math.random()*9000));
}
function decorateDanmu(text){
 let t=String(text);const p=randomOf(DANMU_PREFIXES);
 if(p&&!/^(主播|请问|想问|问一下|在吗)/.test(t))t=p+t;
 const r=Math.random();if(r<0.15)t=t.replace(/？$/,'??');else if(r<0.3)t=t.replace(/？$/,'');
 return t;
}
function fillVariant(pattern,board,platform){
 const text=templateText(pattern,board,modelContext(board),platform);
 return text.replace(/\{(距离|面积|房间|人数|人群|用途|设备|宽度|桌深|门|品类)\}/g,(_,k)=>randomOf(DANMU_FILLS[k]));
}
function variantPool(q,board,platform){
 const scope=danmuScope(board.category),group=platformGroup(platform),ctx=modelContext(board);
 let pool=QUESTION_VARIANTS.filter(v=>v.stage===q.stage&&(v.scopes||[]).includes(scope)&&(v.platform_group==='all'||v.platform_group===group));
 if(scope==='local')pool=pool.filter(v=>v.id!=='qv206'&&!/福袋|发货|安装|保修/.test(v.text));
 if(!ctx.hasModel)pool=pool.filter(v=>!/\{(型号|对比型号)\}/.test(v.text));
 if(!/电视|显示器/.test(board.category))pool=pool.filter(v=>!/\{尺寸\}/.test(v.text));
 return pool;
}
function viewerQuestionFor(q,board,platform){
 // Keep the source wording and teaching criteria together. Explicit metadata
 // supplies context; never infer a model/size from SKU or a random catalogue.
 const text=q.kind!=='seed'&&q.model?`关于「${q.model}」：${q.question}`:q.question;
 return {text,variantId:q.kind==='seed'?'seed-question':'reviewed-question'};
}
function nextQuestionIndex(){
 const ids=questions.map(q=>q.id);if(currentAssignment()?.schema)return Math.min(sessionTurns.length,ids.length);if(ids.length<=1)return 0;
 questionBag=questionBag.filter(id=>ids.includes(id));
 if(!questionBag.length){questionBag=shuffled(ids);if(questionBag[0]===lastQuestionId)questionBag.push(questionBag.shift());}
 const id=questionBag.shift();lastQuestionId=id;return ids.indexOf(id);
}
// Per-question records use an immutable turn ID; stopped audio can be checkpointed locally.
let runId='',activeTurn=null,sessionTurns=[],recordingTurn=null,oneShotAsrJob=null,sessionStartedAt=0,sessionStartedMono=0;
const perQuestionAudio=new Map();

// Recover the latest locally saved run for the entered name. This is local
// convenience, not account authentication. Blob rows are separate so typing does
// not repeatedly clone a video. A metadata row and any new media commit atomically.
const LOCAL_SESSION_LIMIT=96*1024*1024;
const draftKey=name=>'draft-session:'+encodeURIComponent(name);
const draftMediaKey=(id,part)=>'draft-media:'+id+':'+part;
let savedSessionCandidate=null,sessionStorageState={run:'',status:'idle',message:''},restoreSessionEpoch=0,sessionStorageSeq=0;
const storedSessionMedia=new Map();
// Only successful commits populate this run's record cache. Replace the map on
// reset so already queued work cannot populate the next run's cache.
let storedSessionRecords=new Map();
// Each tab advances its own observed token only after a committed transaction.
// A stale tab must never overwrite a newer checkpoint, including during pagehide.
let checkpointCursor={key:'',token:null,known:false,ready:Promise.resolve()},checkpointWriteChain=Promise.resolve();
const checkpointToken=row=>!row?null:row.writeToken||('legacy:'+row.runId+':'+(row.updatedAt||''));
function sessionStorageText(){
 if(sessionStorageState.run!==runId)return '正在准备本机恢复记录；尚未确认保存。';
 return sessionStorageState.message||'正在准备本机恢复记录；尚未确认保存。';
}
function showSessionStorageState(){
 const el=ELEM('localSessionSaveStatus');if(el){
  el.textContent=sessionStorageText();el.dataset.status=sessionStorageState.status;
  if(sessionStorageState.status==='error'&&sessionStorageState.run===runId){
   const button=document.createElement('button');button.type='button';button.id='exportUnsavedSession';button.className='btn soft';button.textContent='下载本页尚未保存的文字';
   button.onclick=()=>{const current=currentSessionCheckpoint();if(current)downloadJSON('TCL-本页未保存文字.json',{storageStatus:'未确认保存；这是当前页面文字，不含音视频',snapshot:current.snapshot});};el.append(document.createTextNode(' '),button);
  }
 }
}
function localSessionFailure(owner,error){
 if(owner!==runId)return;
 sessionStorageState={run:owner,status:'error',message:'本机恢复保存失败：'+String(error?.message||error).slice(0,140)+'。当前修改仍在本页，请用下方按钮导出文字、下载录像，再刷新并恢复最新版本。'};
 showSessionStorageState();
}
function currentSessionCheckpoint(){
 if(userRole!=='anchor'||!userName||!runId||!sessionTurns.length)return null;
 const b=boardById(selectedBoard),a=currentAssignment(),endedAt=nowIso();
 const snapshot=lastSessionSnapshot?.id===runId?lastSessionSnapshot:{id:runId,anchorName:userName,boardId:selectedBoard,category:b.category,platform:activePlatform,assignmentId:activeAssignmentId||'',operatorName:a?.operatorName||'',assignmentTitle:a?.title||'',...(sessionAssignmentSnapshot?.schema?{assignmentSnapshotSha256:sessionAssignmentSnapshot.snapshotSha256,assignmentVersion:sessionAssignmentSnapshot.version,assignmentSnapshot:structuredClone(sessionAssignmentSnapshot)}:{}),startedAt:new Date(sessionStartedAt||Date.now()).toISOString(),endedAt,durationSeconds:Math.round(Math.max(0,Date.now()-(sessionStartedAt||Date.now()))/1000),turns:sessionTurns,incomplete:true};
 const safe=JSON.parse(JSON.stringify(snapshot));
 return {id:draftKey(userName),version:1,owner:userName,runId,snapshot:safe,trainingLogId:lastTrainingLogId,videoMeta:sessionVideoMeta?{...sessionVideoMeta}:null,mode:deviceCheck.mode,updatedAt:endedAt};
}
function sessionTurnRecord(turn,owner){
 return {id:turn.id,anchorName:owner,boardId:turn.boardId,category:turn.category,platform:turn.platform,
  ...turnReferenceSnapshot(turn),prompt:turn.prompt,trainingHint:turn.trainingHint,answer:turn.answer||'',transcript:turn.transcript||'',rawTranscript:turn.rawTranscript||'',whisperCandidate:turn.whisperCandidate||'',manualEdited:!!turn.manualEdited,manualCleared:!!turn.manualCleared,
  responseSeconds:turn.responseSeconds??null,durationSeconds:turn.durationSeconds??null,
  compliance:turn.compliance||[],matchedKeywords:turn.pointsHit?.length||0,
  keywordTotal:turn.keyPoints?.length||0,keyPoints:[...(turn.keyPoints||[])],pointKeywords:(turn.pointKeywords||[]).map(x=>[...x]),asrStatus:turn.asrStatus||'待录音',
  result:'训练记录（仅提示，未进行正式AI评分）',createdAt:turn.createdAt};
}
async function persistSessionCheckpoint(){
 const data=currentSessionCheckpoint();if(!data)return false;
 const owner=data.runId,writeSeq=++sessionStorageSeq,cursor=checkpointCursor,recordCache=storedSessionRecords;
 if(memoryFallback||!localDB){localSessionFailure(owner,new Error('浏览器数据库不可用，仅保留本页内存'));return false;}
 const media=data.snapshot.turns.filter(t=>perQuestionAudio.has(t.id)).map(t=>({id:draftMediaKey(owner,t.id),turnId:t.id,blob:perQuestionAudio.get(t.id),owner:data.owner,runId:owner}));
 if(sessionVideoBlob)media.push({id:draftMediaKey(owner,'video'),turnId:'video',blob:sessionVideoBlob,owner:data.owner,runId:owner});
 if(media.reduce((n,x)=>n+x.blob.size,0)>LOCAL_SESSION_LIMIT||data.snapshot.turns.length>200){localSessionFailure(owner,new Error('本场超过96MB或200题恢复额度，请下载备份'));return false;}
 data.media=media.map(x=>({id:x.id,turnId:x.turnId,size:x.blob.size}));
 const records=data.snapshot.turns.map(turn=>sessionTurnRecord(turn,data.owner));
 sessionStorageState={run:owner,status:'saving',message:'正在保存本机恢复记录，请稍候…'};showSessionStorageState();
 const commit=async()=>{
  try{
   await cursor.ready;
   if(cursor.key!==data.id||!cursor.known)throw new Error('尚未读取本机恢复版本，请刷新后重新进入');
   const changed=media.filter(x=>storedSessionMedia.get(x.id)!==x.blob);
   // Compare after the preceding save has committed. A cold cache writes the
   // original rows immediately and computes fingerprints only after success.
   const changedRecords=recordCache.size?records.map(row=>({row,fingerprint:JSON.stringify(row)})).filter(x=>recordCache.get(x.row.id)!==x.fingerprint):null;
   await new Promise((resolve,reject)=>{
    let tx,settled=false,timer,writeError;
    const done=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);fn(value)};
    try{
     // The turn row, checkpoint and new media either all commit or all abort.
     tx=localDB.transaction(['prefs','records'],'readwrite');const store=tx.objectStore('prefs'),req=store.get(data.id);
     req.onsuccess=()=>{try{
      const old=req.result;
      if(checkpointToken(old)!==cursor.token){const e=new Error('其他标签已更新这份练播记录，本次未保存，已阻止覆盖。请先导出本页修改，再刷新并恢复最新版本');e.name='SessionConflictError';throw e;}
      if(old?.owner===data.owner)for(const item of old.media||[]){if(!data.media.some(x=>x.id===item.id)&&item.id.startsWith('draft-media:'+old.runId+':'))store.delete(item.id);}
      for(const item of old?.runId===data.runId?changed:media)store.put(item);
      data.revision=(Number.isSafeInteger(old?.revision)?old.revision:0)+1;data.writeToken=uid();
      const recordStore=tx.objectStore('records');for(const row of old?.runId===data.runId&&changedRecords?changedRecords.map(x=>x.row):records)recordStore.put(row);
      store.put(data);
     }catch(e){writeError=e;try{tx.abort()}catch{}done(reject,e);}};
     tx.oncomplete=()=>done(resolve);
     tx.onabort=()=>done(reject,writeError||tx.error||new Error('保存事务已取消'));
     tx.onerror=()=>{};
     timer=setTimeout(()=>{try{tx.abort()}catch{}done(reject,new Error('保存超时，未确认落盘'));},Math.max(50,Number(window.__SESSION_SAVE_TIMEOUT_MS)||8000));
    }catch(e){try{tx?.abort()}catch{}done(reject,e);}
   });
   cursor.token=data.writeToken;
   for(const item of changedRecords||records.map(row=>({row,fingerprint:JSON.stringify(row)})))recordCache.set(item.row.id,item.fingerprint);
   if(runId===owner&&userName===data.owner)for(const row of records){const pos=localRecords.findIndex(x=>x.id===row.id);if(pos>=0)localRecords[pos]=row;else localRecords.unshift(row);}
   if(runId===owner)for(const item of changed)storedSessionMedia.set(item.id,item.blob);
   if(runId===owner&&userName===data.owner&&writeSeq===sessionStorageSeq){
    savedSessionCandidate=data;
    sessionStorageState={run:owner,status:'saved',message:'已保存本机恢复记录。刷新后重新输入同一姓名可恢复最近一场；未停止的录音片段不在其中。请另行下载备份，浏览器清理数据后无法恢复。'};
    showSessionStorageState();
   }
   return true;
  }catch(e){if(writeSeq===sessionStorageSeq)localSessionFailure(owner,e);return false;}
 };
 // Serialize this tab's own rapid saves while keeping cross-tab conflict checks in IndexedDB.
 const job=checkpointWriteChain.then(commit,commit);checkpointWriteChain=job.then(()=>{});return await job;
}
async function findSavedSession({renderHome=true}={}){
 const owner=userName,epoch=++restoreSessionEpoch;savedSessionCandidate=null;
 const cursor={key:draftKey(owner),token:null,known:false,ready:Promise.resolve()};checkpointCursor=cursor;
 if(userRole!=='anchor'||!owner||memoryFallback||!localDB)return;
 try{
  const lookup=new Promise((resolve,reject)=>{const req=localDB.transaction('prefs','readonly').objectStore('prefs').get(cursor.key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  cursor.ready=lookup.then(data=>{cursor.token=checkpointToken(data);cursor.known=true;},()=>{});
  const data=await lookup;
  if(epoch!==restoreSessionEpoch||userName!==owner||userRole!=='anchor')return;
  if(data?.version===1&&data.owner===owner&&data.snapshot?.anchorName===owner&&data.snapshot.id===data.runId&&Array.isArray(data.snapshot.turns)&&data.snapshot.turns.length<=200)savedSessionCandidate=data;
  if(renderHome&&page==='home')render();
 }catch(e){cursor.ready=Promise.resolve();if(epoch===restoreSessionEpoch)toast('无法读取本机恢复记录：'+(e?.message||e));}
}
function savedSessionHtml(){
 const d=savedSessionCandidate;if(reviewAlive()||!d||d.owner!==userName)return '';
 if(syncMember()&&!d.snapshot.incomplete&&!submissionForSession(d.snapshot))return `<button type="button" id="restoreLocalSession" class="resume-review"><span class="resume-label">上一场还没提交</span><b>${ESC(d.snapshot.category)} · ${ESC(d.snapshot.platform)}${d.snapshot.assignmentTitle?' · '+ESC(d.snapshot.assignmentTitle):''}</b><small>从本机恢复已保存的逐题文字及音视频</small><em>返回本场复盘 →</em></button>`;
 return `<button type="button" id="restoreLocalSession" class="resume-review"><span class="resume-label">本机已保存的最近一场</span><b>${ESC(d.snapshot.category)} · ${ESC(d.snapshot.platform)}</b><small>${ESC(new Date(d.updatedAt).toLocaleString('zh-CN'))} · ${d.snapshot.incomplete?'中断场次，仅恢复已保存部分':'可恢复逐题文字及已保存音视频'}</small><em>恢复本场复盘 →</em></button>`;
}
async function restoreLocalSession(){
 const candidate=savedSessionCandidate,owner=userName,epoch=++restoreSessionEpoch,initialRun=runId,initialView=ELEM('view')?.firstElementChild;
 if(userRole!=='anchor'||!candidate||candidate.owner!==owner||page!=='home'||reviewAlive())return;
 const btn=ELEM('restoreLocalSession');if(btn)btn.disabled=true;
 try{
  // Read the current metadata and all referenced media in one consistent snapshot.
  const {data,parts}=await new Promise((resolve,reject)=>{
   const tx=localDB.transaction('prefs','readonly'),store=tx.objectStore('prefs'),rows=[];let data,error;
   const req=store.get(draftKey(owner));
   req.onsuccess=()=>{try{
    data=req.result;
    if(data?.version!==1||data.owner!==owner||data.snapshot?.anchorName!==owner||data.snapshot.id!==data.runId||!Array.isArray(data.snapshot.turns)||data.snapshot.turns.length>200)throw new Error('本机恢复记录不存在或格式不完整');
    for(const item of data.media||[]){const q=store.get(item.id);q.onsuccess=()=>rows.push(q.result);}
   }catch(e){error=e;try{tx.abort()}catch{}}};
   tx.oncomplete=()=>resolve({data,parts:rows});tx.onabort=()=>reject(error||tx.error||new Error('读取已取消'));tx.onerror=()=>{};
  });
  if(epoch!==restoreSessionEpoch||userRole!=='anchor'||userName!==owner||page!=='home'||runId!==initialRun||ELEM('view')?.firstElementChild!==initialView)return;
  if(parts.some(x=>!x||x.owner!==owner||x.runId!==data.runId||!(x.blob instanceof Blob)))throw new Error('部分媒体不存在或不属于本场，未加载');
  const snap=JSON.parse(JSON.stringify(data.snapshot));
  const frozen=snap.assignmentSnapshot?structuredClone(await verifyAssignment(snap.assignmentSnapshot,{board:boardById(snap.boardId)})):null;
  if(frozen&&(frozen.id!==snap.assignmentId||frozen.snapshotSha256!==snap.assignmentSnapshotSha256||frozen.version!==snap.assignmentVersion||frozen.boardId!==snap.boardId||frozen.platform!==snap.platform||frozen.operatorName!==snap.operatorName||!isAssigned(frozen,owner)))throw new Error('恢复记录的作业版本或归属不一致');
  if(epoch!==restoreSessionEpoch||userRole!=='anchor'||userName!==owner||page!=='home'||runId!==initialRun||ELEM('view')?.firstElementChild!==initialView)return;
  resetRunState();discardVideoArchive();
  checkpointCursor={key:draftKey(owner),token:checkpointToken(data),known:true,ready:Promise.resolve()};savedSessionCandidate=data;
  sessionAssignmentSnapshot=frozen;
  runId=snap.id;selectedBoard=snap.boardId;activePlatform=snap.platform;sessionTurns=snap.turns;lastSessionSnapshot=snap;lastTrainingLogId=data.trainingLogId||'';activeAssignmentId=snap.assignmentId||'';
  for(const t of sessionTurns)if(/等待实验 Whisper|实验 Whisper：|等待本机转写|本机转写：|正在录音|待自动转写|排队等待转写|正在录后转写|识别中/.test(t.asrStatus||''))t.asrStatus='上次识别或录音已中断，已保存音频可手动补转写';
  for(const item of parts){storedSessionMedia.set(item.id,item.blob);if(item.turnId==='video'){sessionVideoBlob=item.blob;sessionVideoURL=URL.createObjectURL(item.blob);}else perQuestionAudio.set(item.turnId,item.blob);}
  sessionVideoMeta=data.videoMeta;sessionCaptureNote=sessionVideoBlob?'已从本机数据库恢复原始录像，请下载备份。':snap.incomplete?'上次录制中断，没有已完成的整场录像；已保存的单题录音可在逐题复盘回听。':'本场没有整场录像。';
  sessionStorageState={run:runId,status:'saved',message:'已恢复本机最近一场。'+(snap.incomplete?'此场次曾中断，仅恢复保存成功的部分。':'')+'浏览器清理会删除本机数据，请下载备份。'};
  deviceCheck={camera:false,microphone:false,recorder:false,ready:false,mode:data.mode==='text'?'text':'hardware',checked:false};roomPhase='check';reviewParked=false;page='sessionReview';render();
 }catch(e){if(epoch===restoreSessionEpoch)toast('本机复盘恢复失败：'+(e?.message||e));}
 finally{if(btn?.isConnected)btn.disabled=false;}
}

// ---------- ASR AutoQA isolation patch: SINGLE-QUESTION ORIGINAL AUDIO ----------
// This is intentionally not present in the approved R6 route.
// No credentials or cloud APIs. Whisper downloads third-party weights on first run,
// normalizes Traditional->Simplified + TCL product models/numbers, guards against
// cross-question/multi-engine overwrites, and falls back to same-origin Vosk if needed.
function normalizeWhisperChinese(raw,filterWhisperArtifacts=true){
  let s=String(raw??'').trim();
  if(!s)return '';
  s=canonicalizeTerms(toSimplified(s),asrGlossary.getTerms()).text;
  // Filter well-known Whisper silence/subtitle hallucinations and 3x+ repetitive loop hallucinations
  if(filterWhisperArtifacts&&['感谢观看','谢谢观看','thankyouforwatching','优优独播剧场','请不吝点赞订阅转发','订阅转发','amaraorg','字幕由amaraorg社区提供'].includes(s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'')))return '';
  if(filterWhisperArtifacts&&/^(.{2,12})\1{2,}$/u.test(s.replace(/[\s\p{P}\p{S}]/gu,'')))return '';
  return s;
}
function normalizeInterfaceDecimals(input){
  let changes=0;
  const text=String(input??'').replace(/\b(HDMI|USB|DP|Wi-?Fi)[ \t]*([零〇○一二两三四五六七八九十百千万点]+)/giu,(whole,prefix,spoken,offset,value)=>{
    const tail=value.slice(offset+whole.length);
    if(/^[\d几多来余左右上下约近]|^[到至或及与、～~—-][\d零〇○一二两三四五六七八九十百千万]/u.test(tail))return whole;
    const groups=spoken.split('点',1)[0].split('万');
    if(groups.length>2||groups.some(group=>/十.*[十百千]|百.*[百千]|千.*千/u.test(group)))return whole;
    const val=spokenNumberValue(spoken);
    if(val===null)return whole;
    changes++;
    return prefix+val;
  });
  return {text,changes};
}
// Keep explicitly saved Whisper choices and pick Paraformer for a fresh browser.
function readR23ModelPreference(){
  try {
    const saved=localStorage.getItem('tcl-r24-paraformer-excel-qa-asr-model-v1');
    if(saved==='base'||saved==='tiny')return saved;
  }catch{}
  return 'paraformer';
}
const preferredAsr=readR23ModelPreference();
const usesParaformer=preferredAsr==='paraformer';
const asrModelLabel=usesParaformer?'Paraformer-small':preferredAsr==='base'?'Whisper Base':'Whisper Tiny';
const asrDiagnostics=[];
let paraformerState='idle',paraformerNote='';
let whisperProgressTimer=null,whisperProgressKey='',whisperProgressLastAt=0;
globalThis.exportAsrDiagnostics=()=>JSON.stringify({version:'r24-qa',events:asrDiagnostics},null,2);
ELEM('asrDiagnosticsBtn')?.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([exportAsrDiagnostics()],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='tcl-r24-asr-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
const asrOptions={onDiagnostic:event=>{
  asrDiagnostics.push({...event,time:Date.now(),question:sessionTurns.findIndex(t=>t.id===r6WhisperQueue[0]?.turnId)+1});
  if(asrDiagnostics.length>200)asrDiagnostics.shift();
  if(!usesParaformer)return;
  if(event.stage==='model-download')setParaformerPreparation('loading','正在读取并校验模型资源…');
  if(event.stage==='model-ready')setParaformerPreparation('ready');
  if(event.stage==='worker-released')setParaformerPreparation('idle');
  if(event.stage==='model-error')setParaformerPreparation('error',event.message);
},onProgress:note=>{
  if(usesParaformer&&paraformerState==='loading')setParaformerPreparation('loading',note);
  const cur=r6WhisperQueue[0];
  const target=cur&&sessionTurns.find(t=>t.id===cur.turnId);
  if(target&&r6WhisperValid(cur,target)){
    target.asrStatus='本机转写：'+note+(target.captureLimitReached?'（仅录入前120秒，后续未录音）':'');
    if(!note.startsWith('下载模型：')){if(whisperProgressTimer!==null)clearTimeout(whisperProgressTimer);whisperProgressTimer=null;whisperProgressKey='';renderTurnStatus(target);return;}
    const key=target.id+':'+(note.match(/(\d+)%/)?.[1]||note);
    if(key===whisperProgressKey)return;whisperProgressKey=key;
    if(whisperProgressTimer!==null)return;
    const show=()=>{whisperProgressTimer=null;if(r6WhisperValid(cur,target)){whisperProgressLastAt=performance.now();renderTurnStatus(target);}};
    const wait=150-(performance.now()-whisperProgressLastAt);if(wait<=0)show();else whisperProgressTimer=setTimeout(show,wait);
  }
}};
const r6WhisperEngine=usesParaformer?createLocalParaformer({...asrOptions,loadTimeoutMs:600000}):createLocalWhisper({...asrOptions,modelPreset:preferredAsr});
const r6WhisperQueue=[];
let r6WhisperRunning=false;
let r6WhisperCancelSeq=0;
const r6WhisperPageAlive=()=>!!(
  (typeof isRunPage==='function'&&isRunPage())||
  (typeof reviewParked!=='undefined'&&reviewParked&&typeof reviewAlive==='function'&&reviewAlive())
);
const r6WhisperValid=(task,turn)=>!!(
  task&&turn&&runId===task.runId&&r6WhisperPageAlive()&&
  (task.cancelSeq===undefined||task.cancelSeq===r6WhisperCancelSeq)&&
  turn.runId===task.runId&&turn.boardId===task.boardId&&
  turn.platform===task.platform&&
  perQuestionAudio.get(task.turnId)===task.blob&&
  (turn.audioRevision||0)===task.audioRevision
);
function r6WhisperCancelAll(reasonText='识别已取消（离开了复盘页），可在复盘页点「补转写」'){
  r6WhisperCancelSeq++;
  r6WhisperQueue.length=0;
  r6WhisperEngine.dispose?.();
  const turns=(typeof lastSessionSnapshot!=='undefined'&&lastSessionSnapshot?.turns)||sessionTurns||[];
  for(const t of turns){
    if(/等待实验 Whisper 转写|实验 Whisper：|等待本机转写|本机转写：/.test(t.asrStatus||'')){
      t.asrStatus=reasonText;
    }
  }
}
function r6WhisperSubmit(turnId,blob){
  const turn=sessionTurns.find(t=>t.id===turnId);
  if(!turn||!blob||blob.size===0||turn.runId!==runId)return;
  for(let i=r6WhisperQueue.length-1;i>=0;i--){
    if(r6WhisperQueue[i].turnId===turnId&&!r6WhisperQueue[i].inFlight)r6WhisperQueue.splice(i,1);
  }
  r6WhisperQueue.push({
    turnId,
    blob,
    runId:turn.runId,
    boardId:turn.boardId,
    platform:turn.platform,
    audioRevision:turn.audioRevision||0,
    asrRevision:turn.asrRevision||0,
    baselineAnswer:turn.answer||'',
    baselineTranscript:turn.transcript||'',
    startedWithManual:!!(turn.manualEdited||turn.manualCleared),
    cancelSeq:r6WhisperCancelSeq,
    inFlight:false
  });
  turn.asrStatus='原始录音已保存，等待本机转写（首次下载模型可能较慢）'+(turn.captureLimitReached?'（仅录入前120秒，后续未录音）':'');
  renderTurnStatus(turn);
  void r6WhisperDrain();
}
function retryLocalQuestion(turnId){
  if(!usesParaformer)return transcribeQuestion(turnId);
  const turn=sessionTurns.find(t=>t.id===turnId),audio=perQuestionAudio.get(turnId);
  if(!turn||!audio||turn.runId!==runId||!isRunPage())return toast('当前题目没有可补转写的音频');
  if(recorderPending||recorderFinalizing||(recordingTurn===turn&&currentRecorder?.state==='recording'))return toast('请先结束本题录音，再补转写');
  if(r6WhisperQueue.some(task=>task.turnId===turnId))return toast('本题已在等待转写');
  r6WhisperEngine.resetFailure();
  r6WhisperSubmit(turnId,audio);
}
async function r6WhisperDrain(){
  if(r6WhisperRunning||transcriptBusy||oneShotAsrJob||asrInferJob||voskLoadJob)return;
  r6WhisperRunning=true;
  try{
    while(r6WhisperQueue.length){
      const task=r6WhisperQueue[0];
      task.inFlight=true;
      const turn=sessionTurns.find(t=>t.id===task.turnId);
      if(!r6WhisperValid(task,turn)){r6WhisperQueue.shift();continue;}
      const baselineAnswer=task.baselineAnswer!==undefined?task.baselineAnswer:(turn.answer||'');
      const baselineTranscript=task.baselineTranscript!==undefined?task.baselineTranscript:(turn.transcript||'');
      const startedWithManual=task.startedWithManual!==undefined?task.startedWithManual:!!(turn.manualEdited||turn.manualCleared);
      turn.asrStatus='本机转写：读取本题原始录音'+(turn.captureLimitReached?'（仅录入前120秒，后续未录音）':'');
      renderTurnStatus(turn);
      try{
        releaseVoskForParaformer();
        const result=await r6WhisperEngine(task.blob);
        if(!r6WhisperValid(task,turn)){continue;}
        turn.rawTranscript=String(result?.text||'').trim();
        const rawCleaned=normalizeWhisperChinese(result?.text||'',!usesParaformer);
        const assessed=(typeof assessAsrText==='function'&&rawCleaned)?assessAsrText(rawCleaned,!usesParaformer):{text:rawCleaned,warnings:[]};
        const numeric=(typeof finalizeAsrText==='function'&&assessed.text)?finalizeAsrText(assessed.text):{text:assessed.text||'',changes:0};
        const text=String(numeric.text||'').trim();
        const manuallyChanged=startedWithManual||turn.manualEdited||turn.manualCleared||
          (task.asrRevision!==undefined&&(turn.asrRevision||0)!==task.asrRevision)||
          (turn.answer||'')!==baselineAnswer||(turn.transcript||'')!==baselineTranscript;
        if(!text){
          turn.asrStatus=(rawCleaned&&!assessed.text?'识别结果疑似静音或杂音，已过滤；原音频已保留，可手动补文字':'未识别到有效中文语音；原音频已保留，可手动补文字')+(turn.captureLimitReached?'（仅录入前120秒，后续未录音）':'');
        }else if(manuallyChanged){
          turn.asrStatus=asrModelLabel+' 已识别，人工回答已编辑，原文字保留';
          turn.whisperCandidate=text;
        }else{
          turn.asrRevision=(turn.asrRevision||0)+1;
          turn.rawTranscript=String(result?.text||'').trim();
          turn.transcript=text;
          turn.answer=text;
          turn.manualEdited=false;
          turn.manualCleared=false;
          turn.asrWarnings=[...(assessed.warnings||[]),...(numeric.changes?['已规范化'+numeric.changes+'处明确的口述数值/型号，请重点核对']:[])];
          if(turn.captureLimitReached)turn.asrWarnings.push('本题录音达到120秒上限，之后的内容未录入');
          const input=ELEM('answerText');
          if(activeTurn?.id===turn.id&&input)input.value=text;
          const visible=ELEM('liveTextAnswer');
          if(activeTurn?.id===turn.id&&visible&&!ELEM('textAnswerSheet')?.hidden&&!visible.value.trim())visible.value=text;
          turn.compliance=complianceHints(text,turn.platform);
          turn.pointsHit=(turn.keyPoints||[]).filter((point,i)=>fuzzyPoint(point,text,turn.pointKeywords?.[i]||[]));
          turn.asrStatus='已写入本题答案 · '+asrModelLabel+'（型号数字需人工核对）'+(turn.captureLimitReached?'（仅录入前120秒，后续未录音）':'');
        }
        renderTurnStatus(turn);
        await saveTurn(turn);
      }catch(err){
        if(r6WhisperValid(task,turn)){
          const errMsg=String(err?.message||err||'未知错误').slice(0,100);
          if(!r6WhisperEngine.isResourceBusy?.()&&typeof voskModel!=='undefined'&&voskModel&&typeof enqueueQuestionAsr==='function'){
            turn.asrStatus=asrModelLabel+' 不可用（'+errMsg+'），已自动切换本机 Vosk 离线转写…';
            renderTurnStatus(turn);
            enqueueQuestionAsr(task.turnId);
          }else{
            turn.asrStatus=asrModelLabel+' 识别未完成：'+errMsg+(r6WhisperEngine.isResourceBusy?.()?'；底层资源仍被锁定，请保存备份后重新打开页面；当前可手动填写':'；原录音仍可回听，可手动填写或准备备用 Vosk');
            renderTurnStatus(turn);
          }
          await saveTurn(turn).catch(()=>{});
        }
      }finally{
        const finishedIndex=r6WhisperQueue.indexOf(task);
        if(finishedIndex>=0)r6WhisperQueue.splice(finishedIndex,1);
      }
    }
  }finally{r6WhisperRunning=false;renderQuestionSummary();void drainQuestionAsrQueue();}
}
globalThis.r6WhisperSubmit=r6WhisperSubmit;
// ---------- END isolated ASR AutoQA ----------

let questionAsrQueue=[],voskPreloadSeq=0;
// Pending work belongs to this run and remains valid on its post-live page.
const isRunPage=()=>userRole==='anchor'&&!!userName&&(page==='training'||(page==='sessionReview'&&lastSessionSnapshot?.id===runId&&lastSessionSnapshot?.anchorName===userName));
// V3.4.9：离开复盘页时暂存本场（逐题、单题录音、整场录像留在本页内存），可从首页“返回本场复盘”；
// 开始新的练习、切换身份或关闭网页才丢弃。
const reviewAlive=()=>!!(lastSessionSnapshot&&runId&&lastSessionSnapshot.id===runId&&userRole==='anchor'&&lastSessionSnapshot.anchorName===userName);
const submissionForSession=snap=>syncSubmitStatus.get(snap.id)||localSubmissions.find(x=>x.sessionId===snap.id&&x.assignmentId===snap.assignmentId&&x.anchorName===snap.anchorName)||null;
const reviewSubmission=()=>lastSessionSnapshot?submissionForSession(lastSessionSnapshot):null;
const reviewHasContent=()=>!!(lastSessionSnapshot&&(sessionVideoBlob||lastSessionSnapshot.turns.some(t=>t.answer||t.transcript||perQuestionAudio.has(t.id))));
const formatPracticeDuration=(sec)=>{const s=Math.max(0,Math.round(Number(sec)||0));return s<60?`${s}秒`:`${Math.floor(s/60)}分${String(s%60).padStart(2,'0')}秒`;};
let chatExtraTimers=[];
function cancelVoskPreload(){voskPreloadSeq++;}
function resetRunState({cancelPreload=true}={}){
 sessionAssignmentSnapshot=null;

  storedSessionRecords=new Map();storedSessionMedia.clear();clearReviewQuestionAudioUrls();clearQuestionStopWatchdog();reviewParked=false;reviewStage='overview';runId='';sessionStartedAt=0;sessionStartedMono=0;activeTurn=null;sessionTurns=[];recordingTurn=null;questionAsrQueue=[];perQuestionAudio.clear();activeQuestionIndex=-1;questionBag=[];
 if(cancelPreload)cancelVoskPreload();
}
function setVoskPreloadUi(message,busy=false){
 const status=ELEM('transcribeStatus'),tip=ELEM('preLiveVoskTip'),pre=ELEM('preloadBeforeStart'),review=ELEM('preloadVoskBtn');
 if(status&&message)status.textContent=message;if(tip&&message)tip.textContent=message;
 if(pre){pre.disabled=busy;pre.textContent=voskModel?'✓ Vosk 中文模型已就绪':busy?'正在下载/校验 Vosk…':'准备离线中文识别（模型约42MiB）';}
 if(review){review.disabled=busy||transcriptBusy;review.textContent=voskModel?'✓ Vosk 中文模型已就绪':busy?'正在下载/校验 Vosk…':'准备离线中文识别（模型约42MiB）';}
 renderVoskWidgets();
}

function saveCurrentTypedAnswer({asDraft=true}={}){
 const turn=activeTurn,field=ELEM('answerText');
 if(!turn||!field||page!=='training'||turn.runId!==runId||turn.boardId!==selectedBoard||turn.platform!==activePlatform)return;
 const entered=field.value.trim();
 if(entered===turn.answer)return;
 const asrPending=/正在录后转写|待自动转写|排队等待转写|正在录音/.test(String(turn.asrStatus||''));
 if(!entered){
  // 用户主动清空：回答保持为空，识别原文仅供展开核对，不计要点覆盖。
  if(!turn.answer&&!turn.manualCleared)return;
  turn.answer='';turn.manualEdited=false;turn.manualCleared=true;
  turn.compliance=[];turn.pointsHit=[];
  if(asDraft&&!asrPending)turn.asrStatus='已清空回答（识别原文仍保留）';
  void saveTurn(turn);renderTurnStatus(turn,{preserveInput:true});return;
 }
 turn.answer=entered;
 turn.manualCleared=false;
 turn.manualEdited=(entered!==(turn.transcript||''));
 turn.compliance=complianceHints(entered,turn.platform);
 turn.pointsHit=(turn.keyPoints||[]).filter((point,i)=>fuzzyPoint(point,entered,turn.pointKeywords?.[i]||[]));
 if(asDraft&&!asrPending)turn.asrStatus=turn.transcript?(turn.manualEdited?'已编辑识别文字（自动保存）':'已转写（请核对文本）'):'手动填写（自动保存）';
 void saveTurn(turn);renderTurnStatus(turn,{preserveInput:true});
}
function enqueueRecordedQuestions(){
 if(!voskModel||!isRunPage()||!runId)return;
 for(const turn of sessionTurns){
  if(turn.runId===runId&&perQuestionAudio.has(turn.id)&&!turn.transcript)enqueueQuestionAsr(turn.id);
 }
}
const saveTurn=async(turn)=>{
 if(!turn||!r6WhisperPageAlive()||turn.runId!==runId||turn.boardId!==selectedBoard||turn.platform!==activePlatform)return;
 try{
  if(!await persistSessionCheckpoint())return false;
  if(!r6WhisperPageAlive()||runId!==turn.runId||selectedBoard!==turn.boardId||activePlatform!==turn.platform)return;
  return true;
 }catch(e){localSessionFailure(turn.runId,e);toast('本题记录保存失败，请导出个人记录备份：'+(e.message||e));return false;}
};
function liveTurnStatusText(turn){
 if(deviceCheck.mode==='text')return turn.asrStatus||'文字练播';
 const model=usesParaformer&&paraformerState==='loading'?' · Paraformer 准备中':voskUi.state==='loading'||voskUi.state==='init'?' · 备用 Vosk 准备中':'';
 return (turn.asrStatus||'等待回答')+model;
}
function renderTurnStatus(turn,opts={}){
 if(!turn)return;
 if(isFinalCloudQuestion())paintFinalQuestionActions();
 if(activeTurn?.id===turn.id){
  const status=ELEM('turnStatus');
  if(status)status.textContent=`弹幕响应：${turn.responseSeconds===null?'待回答':turn.responseSeconds+'秒'} · 回答时长：${turn.durationSeconds===null?'待录音':turn.durationSeconds+'秒'} · ${turn.asrStatus||'待录音'}`;
  const liveStatus=ELEM('liveTurnStatus');if(liveStatus)liveStatus.textContent=liveTurnStatusText(turn);
  const answer=ELEM('answerText');
  if(answer&&!opts.preserveInput&&!turn.manualCleared&&turn.transcript&&!answer.value.trim())answer.value=turn.transcript;
  const hints=ELEM('turnHints');
  if(hints){
   const flags=(turn.compliance||[]).map(x=>`${x.manual?'需人工复核':'风险提示'}｜${x.category}：${x.matched}；${x.suggestion}`).join('；');
   hints.textContent=`参考要点覆盖 ${turn.pointsHit?.length||0}/${turn.keyPoints?.length||0}（关键词/同义表达自查，非AI评分）${flags?'；'+flags:'；未触发内置风险词'}`;
  }
 }
 const summary=ELEM('questionSummary');if(summary)renderQuestionSummary();if(page==='sessionReview')refreshReviewMetrics();
}
const REVIEW_PAGE_SIZE=20;
let questionSummaryState={el:null,run:'',limit:REVIEW_PAGE_SIZE,rows:new Map()};
let reviewQuestionAudioUrls=[];
function clearReviewQuestionAudioUrls(){
 for(const item of reviewQuestionAudioUrls){try{item.player?.pause?.();item.player?.removeAttribute?.('src');item.player?.load?.()}catch{}try{URL.revokeObjectURL(item.url)}catch{}}
 reviewQuestionAudioUrls=[];
 questionSummaryState={el:null,run:'',limit:REVIEW_PAGE_SIZE,rows:new Map()};
}
const setNodeText=(node,text)=>{const value=String(text??'');if(node.textContent!==value)node.textContent=value;};
function removeQuestionAudio(item){
 if(!item)return;try{item.player.pause()}catch{}try{URL.revokeObjectURL(item.url)}catch{}
 item.player.remove();reviewQuestionAudioUrls=reviewQuestionAudioUrls.filter(x=>x!==item);
}
function createQuestionSummaryRow(turn){
 const entry={turn,tr:document.createElement('tr'),audio:null};
 const cell=label=>{const td=document.createElement('td');td.dataset.label=label;entry.tr.append(td);return td;};
 const question=cell('弹幕问题');question.append(document.createTextNode(turn.prompt));
 const reference=document.createElement('div');reference.innerHTML=referenceDetailsHtml(turn);question.append(reference);
 entry.response=cell('响应用时');entry.duration=cell('回答时长');entry.answerCell=cell('回答文字');
 entry.answerText=document.createElement('div');entry.answerCell.append(entry.answerText);
 const detail=(title)=>{const box=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('div');summary.textContent=title;box.append(summary,text);entry.answerCell.append(box);return {box,text};};
 entry.raw=detail('查看模型识别原文');entry.candidate=detail('查看识别候选（未覆盖当前回答）');
 const use=document.createElement('button');use.type='button';use.className='btn soft';use.textContent='采用此候选回答';entry.candidate.box.append(use);
 use.onclick=()=>{const t=entry.turn;if(!isRunPage()||t.runId!==runId)return;t.answer=toSimplified(t.whisperCandidate);t.transcript=t.answer;t.manualEdited=true;t.manualCleared=false;t.compliance=complianceHints(t.answer,t.platform);t.pointsHit=(t.keyPoints||[]).filter((point,i)=>fuzzyPoint(point,t.answer,t.pointKeywords?.[i]||[]));t.asrStatus='已采用识别候选（请核对）';void saveTurn(t);renderQuestionSummary();refreshReviewMetrics();};
 const editor=document.createElement('textarea');editor.rows=3;editor.setAttribute('aria-label','编辑本题回答');editor.oninput=()=>{editor.dataset.dirty='true'};entry.editor=editor;entry.answerCell.append(editor);
 const save=document.createElement('button');save.type='button';save.className='btn soft';save.textContent='保存本题修改';
 save.onclick=()=>{const t=entry.turn;if(!isRunPage()||t.runId!==runId)return;t.answer=editor.value.trim();t.manualEdited=true;t.manualCleared=!t.answer;t.compliance=t.answer?complianceHints(t.answer,t.platform):[];t.pointsHit=(t.keyPoints||[]).filter((point,i)=>fuzzyPoint(point,t.answer,t.pointKeywords?.[i]||[]));t.asrStatus='人工修改（请核对）';editor.dataset.dirty='';void saveTurn(t);renderQuestionSummary();refreshReviewMetrics();};entry.answerCell.append(save);
 const copy=document.createElement('button');copy.type='button';copy.className='btn soft';copy.textContent='将整场文字填入本题';
 copy.onclick=()=>{const text=ELEM('postTranscript')?.value.trim();if(!text)return toast('尚无整场录后文字');editor.value=text;editor.dataset.dirty='true';editor.focus();toast('已填入本题编辑框，请核对后保存');};entry.answerCell.append(copy);
 entry.actions=cell('状态');entry.status=document.createElement('div');entry.actions.append(entry.status);
 const retry=document.createElement('button');retry.type='button';retry.className='btn soft';retry.onclick=()=>retryLocalQuestion(entry.turn.id);entry.retry=retry;entry.actions.append(retry);
 return entry;
}
function updateQuestionSummaryRow(entry,turn){
 entry.turn=turn;
 setNodeText(entry.response,turn.responseSeconds==null?'—':turn.responseSeconds+'秒');
 setNodeText(entry.duration,turn.durationSeconds==null?'—':turn.durationSeconds+'秒');
 setNodeText(entry.answerText,turn.manualCleared?'已清空回答（识别原文仍保留）':turn.answer||turn.transcript||(perQuestionAudio.has(turn.id)?'已录音，尚未获得文字':'尚无文字，请填写回答或录音'));
 entry.raw.box.hidden=!turn.rawTranscript;setNodeText(entry.raw.text,turn.rawTranscript||'');
 entry.candidate.box.hidden=!(turn.whisperCandidate&&turn.whisperCandidate!==turn.answer);setNodeText(entry.candidate.text,turn.whisperCandidate||'');
 if(entry.editor.dataset.dirty!=='true'&&document.activeElement!==entry.editor){const value=turn.manualCleared?'':turn.answer||turn.transcript||'';if(entry.editor.value!==value)entry.editor.value=value;}
 setNodeText(entry.status,turn.asrStatus||'待录音');
 const blob=perQuestionAudio.get(turn.id);
 if(entry.audio?.blob!==blob){
  removeQuestionAudio(entry.audio);entry.audio=null;
  if(blob){const player=document.createElement('audio');player.controls=true;player.preload='none';player.className='audio-player';player.setAttribute('aria-label','回听本题录音：'+turn.prompt);const url=URL.createObjectURL(blob);player.src=url;entry.audio={url,player,blob};reviewQuestionAudioUrls.push(entry.audio);entry.actions.insertBefore(player,entry.retry);}
 }
 entry.retry.hidden=!blob||!!turn.transcript;
 setNodeText(entry.retry,usesParaformer?'用 Paraformer 补转写':voskModel?'补转写':'准备 Vosk 并补转写');
 entry.retry.disabled=!!oneShotAsrJob||!!transcriptBusy||!!voskLoadJob||!!r6WhisperRunning;
}
function renderQuestionSummary(){
 const el=ELEM('questionSummary');
 // The detail screen is mounted but hidden in overview/replay/live. Rendering it
 // there used to rebuild hundreds of editors and audio players for each status.
 if(!el||page!=='sessionReview'||reviewStage!=='details')return;
 const turns=lastSessionSnapshot?.turns||sessionTurns;
 if(questionSummaryState.el!==el||questionSummaryState.run!==runId){
  clearReviewQuestionAudioUrls();el.replaceChildren();
  questionSummaryState={el,run:runId,limit:REVIEW_PAGE_SIZE,rows:new Map()};
  const table=document.createElement('table');table.className='question-summary-table';
  const head=document.createElement('thead');head.innerHTML='<tr><th>弹幕问题</th><th>响应用时</th><th>回答时长</th><th>回答文字（可人工校正）</th><th>转写状态 / 操作</th></tr>';
  const body=document.createElement('tbody');table.append(head,body);el.append(table);questionSummaryState.body=body;
  const more=document.createElement('button');more.type='button';more.className='btn soft wide';more.id='reviewQuestionsMore';more.onclick=()=>{questionSummaryState.limit+=REVIEW_PAGE_SIZE;renderQuestionSummary();};el.append(more);questionSummaryState.more=more;
  const count=document.createElement('p');count.className='muted';count.id='reviewQuestionsCount';count.setAttribute('role','status');el.append(count);questionSummaryState.count=count;
 }
 const state=questionSummaryState,visible=turns.slice(0,state.limit),ids=new Set(visible.map(t=>t.id));
 for(const [id,entry]of state.rows)if(!ids.has(id)){removeQuestionAudio(entry.audio);entry.tr.remove();state.rows.delete(id);}
 for(const turn of visible){let entry=state.rows.get(turn.id);if(!entry){entry=createQuestionSummaryRow(turn);state.rows.set(turn.id,entry);state.body.append(entry.tr);}updateQuestionSummaryRow(entry,turn);}
 state.more.hidden=visible.length>=turns.length;setNodeText(state.more,`再显示 ${Math.min(REVIEW_PAGE_SIZE,turns.length-visible.length)} 题`);
 state.count.hidden=turns.length<=REVIEW_PAGE_SIZE;setNodeText(state.count,turns.length?`已显示 ${visible.length} / ${turns.length} 题；未显示的题目仍完整保存，可继续展开。`:'本场尚无逐题回答。');
}

function enqueueQuestionAsr(turnId){
 const turn=sessionTurns.find(t=>t.id===turnId);
 if(!turn||!perQuestionAudio.has(turnId)||turn.transcript||!voskModel)return;
 if(!questionAsrQueue.includes(turnId))questionAsrQueue.push(turnId);
 turn.asrStatus=((oneShotAsrJob||audioDecodeJob||asrInferJob||transcriptBusy)?'排队等待转写':'待自动转写')+(turn.captureLimitReached?'（仅录入前120秒，后续未录音）':'');
 renderTurnStatus(turn);void drainQuestionAsrQueue();
}
async function drainQuestionAsrQueue(){
 if(oneShotAsrJob||audioDecodeJob||asrInferJob||transcriptBusy||r6WhisperRunning||!voskModel)return;
 // A browser ASR result may arrive while this turn is queued behind another recording.
 // Skip superseded queue entries instead of overwriting the newer recognized text.
 let next=null;
 while(questionAsrQueue.length){
  const candidate=questionAsrQueue.shift();
  const turn=sessionTurns.find(t=>t.id===candidate);
  if(turn&&perQuestionAudio.has(candidate)&&!turn.transcript){next=candidate;break;}
 }
 if(!next)return;
 await transcribeQuestion(next,{queued:true});
}
async function transcribeQuestion(turnId,{queued=false}={}){
 if(r6WhisperEngine.isResourceBusy?.())return toast('本机转写资源仍被占用，请等待；若已超时，请备份后重新打开页面');
 const turn=sessionTurns.find(t=>t.id===turnId),audio=perQuestionAudio.get(turnId);
 if(!turn||!audio){if(queued)return;return toast('当前题目没有可补转写的音频');}
 if(queued&&turn.transcript)return;
 if(!queued&&(recorderPending||recorderFinalizing||currentRecorder?.state==='recording'))return toast('正在录音或整理音频，请先结束本题后再手动补转写');
 if(!voskModel){turn.asrStatus='模型未就绪，点击准备Vosk并补转写';renderTurnStatus(turn);if(!queued)await preloadVoskModel();return;}
 if(oneShotAsrJob||audioDecodeJob||asrInferJob||transcriptBusy||r6WhisperRunning){
  if(queued){if(!questionAsrQueue.includes(turnId))questionAsrQueue.push(turnId);turn.asrStatus='排队等待转写';renderTurnStatus(turn);}
  else toast('已有识别任务，不能同时解码另一题');
  return;
 }
 const ownerRun=turn.runId,ownerBoard=turn.boardId,ownerPlatform=turn.platform,ownerAudioRevision=turn.audioRevision||0,ownerAsrRevision=turn.asrRevision||0;
 const valid=()=>runId===ownerRun&&isRunPage()&&selectedBoard===ownerBoard&&activePlatform===ownerPlatform&&perQuestionAudio.get(turnId)===audio&&(turn.audioRevision||0)===ownerAudioRevision&&(turn.asrRevision||0)===ownerAsrRevision;
 turn.asrStatus='正在录后转写…'+(turn.captureLimitReached?'（仅录入前120秒，后续未录音）':'');renderTurnStatus(turn);
 const job=(async()=>{
  try{
   r6WhisperEngine.dispose?.();
   const raw=await awaitBounded(decodeAudioCopy(audio),Number(window.__ASR_DECODE_TIMEOUT_MS)||60000,'单题音频解码');
   if(!valid())return;
   const trimmed=trimAsrSilence(raw,16000,{recoverQuiet:true});
   if(!trimmed.hasSpeech)throw new Error('有效语音不足1秒');
   const inferP=recognizeVosk(voskModel,trimmed.pcm,valid);
   asrInferJob=inferP;inferP.finally(()=>{if(asrInferJob===inferP){asrInferJob=null;void r6WhisperDrain();void drainQuestionAsrQueue();}}).catch(()=>{});
   const result=await awaitBounded(inferP,Number(window.__ASR_INFER_TIMEOUT_MS)||240000,'单题Vosk识别');
   if(!valid())return;
   const assessed=assessAsrText(String(result?.text||''));
   if(!assessed.text)throw new Error('模型没有返回有效中文文字');
   const numeric=finalizeAsrText(assessed.text);
   if(activeTurn?.id===turn.id)saveCurrentTypedAnswer({asDraft:true});
   const prevTranscript=turn.transcript||'';
   const hasManualAnswer=!!turn.manualCleared||!!turn.answer&&(turn.manualEdited||turn.answer!==prevTranscript);
   turn.transcript=numeric.text;turn.rawTranscript=String(result?.text||'').trim();
   if(!hasManualAnswer){
    turn.answer=numeric.text;turn.manualEdited=false;turn.manualCleared=false;
    const answerEl=ELEM('answerText');
    if(activeTurn?.id===turn.id&&answerEl){answerEl.value=numeric.text;const visible=ELEM('liveTextAnswer');if(visible&&!ELEM('textAnswerSheet')?.hidden&&!visible.value.trim())visible.value=numeric.text;}
   }
   turn.asrWarnings=[...(assessed.warnings||[]),...(numeric.changes?['已规范化'+numeric.changes+'处明确的口述数值，请重点核对数字/型号']:[])];
   if(turn.captureLimitReached)turn.asrWarnings.push('本题录音达到120秒上限，之后的内容未录入');
   if(/(?:\d|[零〇○一二两三四五六七八九十百千万点]{1,20}(?:英寸|寸|匹|元|块钱|块|秒|分钟|度|瓦|赫兹|公斤|千克|升|厘米|毫米|平方米|平米))/.test(turn.transcript)&&!turn.asrWarnings.some(x=>x.includes('数字'))){turn.asrWarnings.push('数字与型号请对照音频核对，识别错误不会自动猜测修正');}
   const effectiveText=turn.manualCleared?'':turn.answer||turn.transcript;
   turn.compliance=effectiveText?complianceHints(effectiveText,turn.platform):[];
   turn.pointsHit=effectiveText?(turn.keyPoints||[]).filter((point,i)=>fuzzyPoint(point,effectiveText,turn.pointKeywords?.[i]||[])):[];
   const baseStatus=hasManualAnswer?'已转写并保留人工修改':'已转写';
   turn.asrStatus=turn.asrWarnings.length?baseStatus+'（请核对文本；'+turn.asrWarnings.join('；')+'）':baseStatus+'（请核对文本）';
   await saveTurn(turn);if(valid())renderTurnStatus(turn);
  }catch(e){
   if(!valid())return;
   {const msg=String(e?.message||e);turn.asrStatus=(audioDecodeJob&&/解码超时/.test(msg)?'转写未完成：这段录音解码超时，手机仍在后台解码（为保护内存不会重复启动）；稍后再点「补转写」':'转写未完成：'+msg)+(turn.captureLimitReached?'（仅录入前120秒，后续未录音）':'');}
   await saveTurn(turn);renderTurnStatus(turn);
  }
 })();
 oneShotAsrJob=job;
 try{await job}finally{if(oneShotAsrJob===job)oneShotAsrJob=null;if(valid())renderQuestionSummary();void r6WhisperDrain();void drainQuestionAsrQueue();}
}

function closeMenu(){ELEM('sidebar')?.classList.remove('open');ELEM('menuBtn')?.setAttribute('aria-expanded','false');ELEM('menuScrim')?.classList.remove('visible')}
function toggleMenu(){const expanded=!ELEM('sidebar')?.classList.contains('open');ELEM('sidebar')?.classList.toggle('open',expanded);ELEM('menuScrim')?.classList.toggle('visible',expanded);ELEM('menuBtn')?.setAttribute('aria-expanded',String(expanded))}
function closeDrawer(){ELEM('trainingControls')?.classList.remove('show-live-controls');ELEM('drawerScrim')?.classList.remove('visible');for(const id of ['prepMoreSheet','liveMoreSheet']){if(ELEM(id))ELEM(id).hidden=true;}ELEM('focusReview')?.setAttribute('aria-expanded','false');ELEM('prepMore')?.setAttribute('aria-expanded','false')}
function togglePhoneSheet(id,triggerId){const sheet=ELEM(id);if(!sheet)return;const opening=sheet.hidden;closeDrawer();sheet.hidden=!opening;ELEM(triggerId)?.setAttribute('aria-expanded',String(opening));}
function showPrepPreview(){if(page!=='training'||roomPhase==='live')return;ELEM('livePhone')?.classList.add('is-preparing');document.body.classList.add('focus-open','room-preparing');if(ELEM('preLiveActions'))ELEM('preLiveActions').style.display='flex';}
function setTitle(t){ELEM('pageTitle').textContent=t;document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));closeMenu();applyRoleChrome();}
function updateMode(needsBinding=false){
 const dot=ELEM('modeDot'),label=ELEM('modeText');
 if(assignmentSync||syncConfigError){
  const bound=Boolean(syncMember());
  dot.classList.toggle('online',bound);
  const state=syncConfigError?'配置异常':bound?'已绑定':
    !needsBinding&&assignmentSync.hasSavedBinding()?'待登录':'未绑定设备';
  const identity=bound?'（'+syncRoleName(syncMember().role)+' · '+syncMember().displayName+'）':'';
  label.textContent='云同步试点 · '+state+identity;
  return;
 }
 const online=Boolean(cloud.base&&cloud.token);
 dot.classList.toggle('online',online);
 label.textContent=online?'已连接云端（需查询同步）':memoryFallback?'本机内存临时预览（受浏览器限制未持久化）':'本机独立预览';
}
async function remote(path,method='GET',body){if(!cloud.base)throw new Error('尚未配置云端 API');const res=await fetch(cloud.base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cloud.token?{'Authorization':'Bearer '+cloud.token}:{})},...(body?{body:JSON.stringify(body)}:{})});let j;try{j=await res.json()}catch{throw new Error(`服务器返回非JSON（HTTP ${res.status}）`)}if(!res.ok)throw new Error(j.error||`请求失败：${res.status}`);return j;}
function canLeaveRecording(){
 if(capturePending||roomPhase==='live')return toast('请先结束直播，确保录像封装完成后再离开'),false;
 if(videoRecorderFinalizing)return toast('录像封装中，请等到下载按钮出现后再切换'),false;
 if((speechRecognizer||oneShotAsrJob||questionAsrQueue.length||recorderFinalizing||transcriptBusy||r6WhisperRunning||r6WhisperQueue.length)&&!window.confirm('识别或单题录音仍在处理。继续离开会取消尚未完成的结果，可能丢失录音或文字。建议等待完成；确定放弃并离开吗？'))return false;
 if(reviewAlive()&&(page==='sessionReview'||reviewParked)&&!reviewSubmission()&&reviewHasContent()){if(!window.confirm('上一场练播的复盘还没有提交，录像和单题录音只保存在本页。继续会丢弃上一场复盘，确定继续？'))return false;return true;}
 if(sessionVideoBlob&&!sessionVideoDownloaded&&!window.confirm('当前原始录像还没有下载。继续切换将丢失本页录像，确定离开？'))return false;
 return true;
}
function discardVideoArchive(){cancelTranscript();if(sessionVideoURL){URL.revokeObjectURL(sessionVideoURL);sessionVideoURL=''}sessionVideoBlob=null;sessionVideoMeta=null;sessionVideoDownloaded=false;sessionCaptureNote='';sessionChunks=[];syncExitWarning();}
function leaveReviewKeepingSession(){
 if(videoRecorderFinalizing){toast('录像封装中，请等到下载按钮出现后再离开');return false;}
 const pending=!!(speechRecognizer||oneShotAsrJob||questionAsrQueue.length||recorderFinalizing||transcriptBusy||r6WhisperRunning||r6WhisperQueue.length);
 if(pending){if(!window.confirm('识别或录音整理仍在进行。离开复盘页会取消尚未完成的识别；已完成的文字、单题录音和录像会保留，可从首页回到本场复盘。确定离开？'))return false;
  stopScene();questionAsrQueue=[];if(typeof r6WhisperCancelAll==='function')r6WhisperCancelAll();
  for(const t of lastSessionSnapshot?.turns||[])if(/正在录音|待自动转写|排队等待转写|正在录后转写|识别中/.test(t.asrStatus||''))t.asrStatus='识别已取消（离开了复盘页），可在复盘页点「补转写」';}
 reviewParked=true;return true;
}
function nav(to){if(!pageAllowed(to)){toast('当前身份不能进入此页面');return;}
 if(to==='sessionReview'){if(!reviewAlive()){toast('上一场复盘已结束，或已被新的练习替换');return;}reviewParked=false;reviewStage='overview';page=to;render();window.scrollTo({top:0,behavior:'instant'});return;}
 if(reviewAlive()&&(page==='sessionReview'||reviewParked)){if(page==='sessionReview'&&!leaveReviewKeepingSession())return;activeAssignmentId='';page=to;render();window.scrollTo({top:0,behavior:'instant'});return;}
 if(!canLeaveRecording())return;const keepText=to==='catalog'&&deviceCheck.mode==='text';activeAssignmentId='';resetRunState();deviceCheckSeq++;stopScene();captureSeq++;discardVideoArchive();exitFocus();clearAnswerAudio();roomPhase='check';deviceCheck={camera:false,microphone:false,recorder:false,ready:keepText,mode:keepText?'text':'hardware',checked:keepText};page=to;render();window.scrollTo({top:0,behavior:'instant'});}
const syncReleaseVersion=document.querySelector('meta[name="tcl-r24-sync-version"]')?.content||'本地开发';
const requiresAssignmentCloud=document.querySelector('meta[name="tcl-r24-sync-mode"]')?.content==='cloud';
const r24CodeExample='R24-0123456789abcdef01234567';
const syncRoleName=role=>role==='operator'?'直播运营':'主播';
let syncSessionFeedback='';

async function loadSyncIdentity(member){
 const storageName=STORE_NAME+'-account:'+encodeURIComponent(assignmentSync.storageScope)+':'+encodeURIComponent(member.id);
 await initialiseStorage(storageName);
 userRole=member.role;
 userName=member.displayName;
 page='home';
 assignmentSearch='';
 if(userRole==='anchor')await findSavedSession({renderHome:false});
}

async function refreshAfterSyncLogin(member,openGenerator){
 if(syncMember()!==member||page!=='home')return;
 if(openGenerator)ELEM('syncGenerateDeviceCode')?.focus();
 await refreshSyncAssignments();
}

function deviceCodeGuideHtml(){
 return `<details class="field device-code-guide">
  <summary><strong>设备码使用说明｜换手机、换浏览器、旧设备找不到</strong></summary>
  <p>平时用同一个已绑定的浏览器，选原角色、填原姓名即可进入。第一次参加试点，选角色填姓名后点「进入工作台（首次自动开通）」。</p>
  <ol class="note-list">
   <li><strong>准备好新设备，再在旧设备发码。</strong>用原来已绑定的浏览器进入工作台，展开「换手机 · 生成设备码」，点「生成设备码」。核对显示的姓名与角色。</li>
   <li><strong>把完整的码私下转到新设备。</strong>点「复制」，或点「下载备份」取得文本文件。码以 <code>R24-</code> 开头，共 28 个字符，只能用一次，生成后 30 分钟内有效。下载文件不会延长有效期。不要把码发到群里。</li>
   <li><strong>在新设备填原姓名并绑定。</strong>打开同一个试点网址，选原角色、输入原姓名，点「进入工作台（首次自动开通）」。出现「一次性设备码」输入框后，粘贴完整的码，点「绑定并进入」。看到「已绑定」并核对自己的作业后，再停用旧设备。</li>
  </ol>
  <p><strong>过期、用过或忘了保存：</strong>旧浏览器还能进入，就回旧浏览器重新生成。重新生成会作废此前未使用的码。</p>
  <p><strong>旧设备丢了或已清除浏览器数据：</strong>私下联系试点管理员，说明原姓名、原角色和遇到的问题。管理员核实后会约你重置绑定。已提交的云端作业不受影响；未提交复盘、整场录像等本机内容需要从原浏览器另行备份。</p>
  <p>微信内置浏览器、Safari、Chrome 各自保存绑定。建议固定一个浏览器使用，换浏览器也按新设备绑定。</p>
 </details>`;
}

function renderSyncLogin(){
 setTitle('姓名进入');
 ELEM('view').innerHTML=`<section class="name-login"><div class="name-login-card">
 <h2>输入姓名进入练播房</h2><p>R24 云同步试点 · 已绑定的设备只需输入原姓名。</p>
 ${syncConfigError?`<p role="alert">${ESC(syncConfigError)}</p>`:`<form id="syncLoginForm">
 <div class="field"><label for="syncRole">角色</label><select id="syncRole"><option value="anchor">主播</option><option value="operator">直播运营</option></select></div>
 <div class="field"><label for="syncDisplayName">姓名</label><input id="syncDisplayName" autocomplete="name" maxlength="120" required></div>
 <div class="field" id="syncActivationField" hidden>
  <label for="syncActivationCode">一次性设备码</label>
  <input id="syncActivationCode" type="text" maxlength="128" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="syncDeviceCodeFormatHint" disabled>
  <small id="syncDeviceCodeFormatHint">本试点设备码以 R24- 开头，共 28 个字符。示例：<code>${r24CodeExample}</code>。请使用原设备生成的码。</small>
  <small>若旧设备无法打开，请私下联系试点管理员，核实后用原姓名和角色恢复绑定。</small>
 </div>
 <button class="btn primary wide" type="submit">进入工作台（首次自动开通）</button>
 <button class="btn soft wide" type="button" id="syncOpenDeviceCode" aria-describedby="syncDeviceCodeEntryGuide">生成设备码</button>
 <p id="syncDeviceCodeEntryGuide" class="scene-tip" role="status">首次使用请先选角色填姓名自动开通。已绑定设备可点此打开生成器为新设备发码。</p>
 <button class="btn primary wide" type="button" id="syncUseBoundRole" aria-describedby="syncDeviceCodeEntryGuide" hidden></button>
 <p id="syncLoginError" role="alert">${ESC(syncSessionFeedback)}</p>
 </form>`}
 <p class="scene-tip">微信内置浏览器与手机 Safari 登录态不互通，建议固定用同一浏览器打开。</p>
 ${deviceCodeGuideHtml()}
 <p class="scene-tip" id="syncReleaseVersion">版本：${ESC(syncReleaseVersion)}</p></div></section>`;
 const form=ELEM('syncLoginForm');
 if(!form)return;
 const name=ELEM('syncDisplayName'),role=ELEM('syncRole'),code=ELEM('syncActivationCode');
 const field=ELEM('syncActivationField'),message=ELEM('syncLoginError');
 const button=form.querySelector('button[type="submit"]');
 const shortcut=ELEM('syncOpenDeviceCode'),guide=ELEM('syncDeviceCodeEntryGuide');
 const useBoundRole=ELEM('syncUseBoundRole');
 const welcome='首次使用请先选角色填姓名自动开通。已绑定设备可点此打开生成器为新设备发码。';
 let openGenerator=false,inFlight=false;

 function showActivation(visible){
  field.hidden=!visible;
  code.disabled=!visible;
  code.required=visible;
  if(!visible)code.value='';
  button.textContent=visible?'绑定并进入':'进入工作台（首次自动开通）';
 }
 function applyRegisteredRole(registeredRole){
  if(!registeredRole)return;
  role.value=registeredRole;
  guide.textContent=`该姓名已登记为【${syncRoleName(registeredRole)}】，请用原设备生成的 28 位 R24- 设备码绑定。`;
 }
 function clearLoginMessage(){message.textContent='';delete message.dataset.errorCode;}
 function resetRoleOffer(){
  if(!useBoundRole.hidden)guide.textContent=welcome;
  useBoundRole.hidden=true;
  useBoundRole.onclick=null;
 }
 name.oninput=()=>{
  showActivation(false);clearLoginMessage();resetRoleOffer();updateMode();
  guide.textContent=welcome;
 };
 role.onchange=resetRoleOffer;
 function canonicalizeInput(){
  const canonical=normalizeDeviceCode(code.value);
  if(canonical)code.value=canonical;
 }
 code.addEventListener('blur',canonicalizeInput);
 code.addEventListener('paste',event=>{
  const canonical=normalizeDeviceCode(event.clipboardData?.getData('text/plain'));
  if(!canonical)return;
  event.preventDefault();
  code.value=canonical;
  clearLoginMessage();
 });
 shortcut.onclick=()=>{
  if(inFlight)return;
  if(!name.value.trim()){
   guide.textContent='请填写已绑定的姓名，再点「生成设备码」。首次使用请先选角色，点击「进入工作台」。';
   name.focus();
   return;
  }
  void submitLogin(true);
 };
 form.onsubmit=event=>{event.preventDefault();void submitLogin(false);};

 async function submitLogin(generatorOnly){
  if(inFlight)return;
  inFlight=true;
  openGenerator=generatorOnly;
  resetRoleOffer();
  button.disabled=true;shortcut.disabled=true;role.disabled=true;
  name.readOnly=true;code.readOnly=true;
  clearLoginMessage();
  if(!field.hidden)canonicalizeInput();
  try{
   const result=await assignmentSync.enter({
    displayName:name.value,role:role.value,
    rawCode:field.hidden||generatorOnly?'':code.value,
    allowEnrollment:!generatorOnly,
   });
   if(!result.member){
    updateMode(!result.boundRole);
    if(result.boundRole){
     const boundRole=result.boundRole,registered=syncRoleName(boundRole);
     guide.textContent=`该姓名已登记为【${registered}】，此浏览器已有该角色的设备绑定。请确认使用已绑定的角色进入，或修改姓名。`;
     useBoundRole.textContent=generatorOnly?`以${registered}身份打开生成器`:`以${registered}身份进入`;
     useBoundRole.onclick=()=>{
      role.value=boundRole;
      void submitLogin(generatorOnly);
     };
     useBoundRole.hidden=false;
     useBoundRole.focus();
    }else if(result.registeredRole){
     showActivation(true);
     applyRegisteredRole(result.registeredRole);
    }else if(generatorOnly){
     guide.textContent='生成设备码需要已绑定的设备。首次使用请选角色并点击「进入工作台」；换设备请在原设备生成码。';
    }
    return;
   }
   const member=result.member;
   code.value='';
   await loadSyncIdentity(member);
   if(openGenerator)deviceCodeState().open=true;
   updateMode();render();
   if(result.opened)toast('已自动绑定本机，可随时用「设备码生成器」给其他设备换机');
   await refreshAfterSyncLogin(member,openGenerator);
  }catch(error){
   assignmentSync.signOut();
   if(form.isConnected){
    if(error.registeredRole)applyRegisteredRole(error.registeredRole);
    if(error.code)message.dataset.errorCode=error.code;
    message.textContent=error.message;
   }
  }finally{
   inFlight=false;
   code.readOnly=false;name.readOnly=false;
   button.disabled=false;shortcut.disabled=false;role.disabled=false;
   if(!field.hidden&&form.isConnected)code.focus();
  }
 }
}
let deviceCodePanel=null,deviceCodeTicker=null;
const deviceCodeExpiry=expiresAt=>new Date(expiresAt).toLocaleString('zh-CN');

function deviceCodeState(){
 const member=syncMember();
 if(!deviceCodePanel||deviceCodePanel.member!==member){
  deviceCodePanel={member,open:false,busy:false,proof:null,message:''};
 }
 return deviceCodePanel;
}

function syncRefreshHtml(){
 const state=deviceCodeState();
 return `<div class="panel"><button type="button" id="syncRefresh" class="btn soft"${syncAssignmentsLoading?' disabled':''}>刷新云端作业</button>
 <span id="syncRefreshStatus" role="status">${ESC(syncAssignmentsMessage)}</span>
 <details id="syncDeviceTools"${state.open?' open':''}>
  <summary>换手机 · 生成设备码</summary>
  <small id="syncGeneratorVersion">R24 云同步试点 · ${ESC(syncReleaseVersion)} · R24- 开头，共 28 个字符</small>
  <p class="scene-tip">准备换设备时再生成。码只能用一次，生成后 30 分钟有效。重新生成会作废此前未使用的码。</p>
  <button type="button" id="syncGenerateDeviceCode" class="btn primary">生成设备码</button>
  <dialog id="syncRegenerateDialog" aria-labelledby="syncRegenerateTitle" aria-describedby="syncRegenerateMessage" style="box-sizing:border-box;width:min(390px,92vw);padding:20px;border:1px solid #dce4ed;border-radius:16px;color:#192b43;background:white">
   <h3 id="syncRegenerateTitle">重新生成设备码？</h3>
   <p id="syncRegenerateMessage">确认后，上一枚未使用的设备码会失效。</p>
   <div class="toolbar">
    <button type="button" id="syncCancelRegenerate" class="btn soft" autofocus>取消</button>
    <button type="button" id="syncConfirmRegenerate" class="btn primary">确认重新生成</button>
   </div>
  </dialog>
  <div class="field" id="syncDeviceCodeResult" hidden>
   <label for="syncGeneratedDeviceCode">我的设备码</label>
   <input id="syncGeneratedDeviceCode" type="text" readonly autocomplete="off" spellcheck="false">
   <small id="syncDeviceOwner"></small>
   <small id="syncDeviceCodeExpiry"></small>
   <small id="syncDeviceCountdown"></small>
   <div>
    <button type="button" id="syncCopyDeviceCode" class="btn soft">复制</button>
    <button type="button" id="syncSaveDeviceCode" class="btn soft">下载备份</button>
   </div>
  </div>
  <p id="syncDeviceCodeStatus" class="scene-tip" role="status"></p>
 </details>${deviceCodeGuideHtml()}</div>`;
}

function updateDeviceCountdown(state){
 const countdown=ELEM('syncDeviceCountdown');
 if(!countdown||!state.proof||syncMember()!==state.member)return;
 const seconds=Math.max(0,Math.ceil((Date.parse(state.proof.expiresAt)-Date.now())/1000));
 countdown.textContent=seconds
  ?'剩余 '+String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')+' · 一次性'
  :'设备码已过期，请重新生成。';
 ELEM('syncCopyDeviceCode').disabled=!seconds;
 ELEM('syncSaveDeviceCode').disabled=!seconds;
}

function paintDeviceCodePanel(state){
 const button=ELEM('syncGenerateDeviceCode'),result=ELEM('syncDeviceCodeResult');
 if(!button||!result||syncMember()!==state.member)return;
 button.disabled=state.busy;
 button.textContent=state.busy?'生成中…':state.proof?'重新生成':'生成设备码';
 result.hidden=!state.proof;
 ELEM('syncGeneratedDeviceCode').value=state.proof?.code||'';
 ELEM('syncDeviceOwner').textContent=state.proof?'适用：'+state.proof.name+' · '+syncRoleName(state.proof.role):'';
 ELEM('syncDeviceCodeExpiry').textContent=state.proof?'有效至 '+deviceCodeExpiry(state.proof.expiresAt):'';
 ELEM('syncDeviceCodeStatus').textContent=state.message;
 updateDeviceCountdown(state);
}

function bindDeviceCodePanel(){
 clearInterval(deviceCodeTicker);
 const panel=ELEM('syncDeviceTools');
 if(!panel)return;
 const state=deviceCodeState();
 paintDeviceCodePanel(state);
 deviceCodeTicker=setInterval(()=>{
  if(panel.isConnected)updateDeviceCountdown(state);else clearInterval(deviceCodeTicker);
 },1000);
 panel.ontoggle=()=>{if(panel.isConnected)state.open=panel.open;};
 const generate=ELEM('syncGenerateDeviceCode'),dialog=ELEM('syncRegenerateDialog');
 const cancel=ELEM('syncCancelRegenerate');
 function closeConfirmation(){
  if(typeof dialog.close==='function'&&dialog.open)dialog.close();
  else dialog.removeAttribute('open');
  generate.focus();
 }
 cancel.onclick=closeConfirmation;
 ELEM('syncConfirmRegenerate').onclick=()=>{closeConfirmation();void issueCode();};
 generate.onclick=()=>{
  if(state.busy||syncMember()!==state.member)return;
  if(!state.proof){void issueCode();return;}
  if(dialog.hasAttribute('open'))return;
  try{dialog.showModal();}
  catch{dialog.style.position='static';dialog.setAttribute('open','');}
  cancel.focus();
 };
 async function issueCode(){
  if(state.busy||syncMember()!==state.member)return;
  const replacing=Boolean(state.proof);
  state.busy=true;state.proof=null;state.message='正在生成设备码…';
  paintDeviceCodePanel(state);
  try{
   const proof=await assignmentSync.issueDeviceCode();
   if(syncMember()!==state.member)return;
   state.proof=proof;
   state.message=(replacing?'新码已生成。':'设备码已生成。')+'请在 30 分钟内私下把码转到新设备。用原姓名进入，出现输入框后粘贴此码。';
  }catch(error){
   if(syncMember()===state.member)state.message='设备码签发未确认：'+error.message+(replacing?'。旧码状态未确认，请重试后使用新码。':'');
  }finally{
   state.busy=false;
   paintDeviceCodePanel(state);
   if(replacing&&generate.isConnected&&document.activeElement===document.body)generate.focus();
  }
 }
 ELEM('syncCopyDeviceCode').onclick=async()=>{
  const proof=state.proof;
  if(!proof||Date.parse(proof.expiresAt)<=Date.now()||syncMember()!==state.member)return;
  try{
   await navigator.clipboard.writeText(proof.code);
   if(state.proof===proof)state.message='已复制。请私下转到新设备，并在剩余有效期内绑定。';
  }catch{
   if(state.proof===proof){
    const input=ELEM('syncGeneratedDeviceCode');
    input?.focus();input?.select();
    state.message='自动复制不可用，请手动复制选中的设备码。';
   }
  }
  paintDeviceCodePanel(state);
 };
 ELEM('syncSaveDeviceCode').onclick=()=>{
  const proof=state.proof;
  if(!proof||Date.parse(proof.expiresAt)<=Date.now()||syncMember()!==state.member)return;
  downloadText('TCL-R24-设备码.txt',proof.code,'text/plain;charset=utf-8');
  state.message='已请求下载备份。文件中的码也只有 30 分钟有效，请在有效期内使用。';
  paintDeviceCodePanel(state);
 };
}

function bindSyncControls(){
 const refresh=ELEM('syncRefresh');
 if(refresh)refresh.onclick=refreshSyncAssignments;
 bindDeviceCodePanel();
 for(const button of document.querySelectorAll('[data-sync-submissions]')){
  button.onclick=()=>void showSyncInbox(button.dataset.syncSubmissions);
 }
}
async function refreshSyncAssignments(){
 const member=syncMember(),previousRows=cloudAssignments;
 if(!member||syncAssignmentsLoading||assignmentPublishPending||assignmentJoinPending)return;
 const paint=()=>{
  const button=ELEM('syncRefresh'),status=ELEM('syncRefreshStatus');
  if(button)button.disabled=syncAssignmentsLoading;
  if(status)status.textContent=syncAssignmentsMessage;
 };
 syncAssignmentsLoading=true;syncAssignmentsMessage=' 正在读取云端作业…';paint();
 try{
  const rows=await assignmentSync.listAssignments();
  if(syncMember()!==member)return;
  if(assignmentJoinPending||assignmentPublishPending||cloudAssignments!==previousRows){syncAssignmentsMessage=' 作业刚有更新，可刷新查看最新列表';return;}
  cloudAssignments=rows;syncAssignmentsLoaded=true;
  syncAssignmentsMessage=` 已读取 ${rows.length} 份云端作业`;
  if(page==='home'){
   if(userRole==='anchor')updateAnchorAssignmentDashboard();
   else if(operatorActiveTab!=='publish'||!(ELEM('assignmentDraftPanel')?.open||
     ['assignmentTitle','assignmentExcelFile','assignmentDraftSourceText','assignmentDraftSourceFile','assignmentDraftResponse']
      .some(id=>ELEM(id)?.value.trim()))){
    operatorHome();
   }
  }
 }catch(error){if(syncMember()===member)syncAssignmentsMessage=' 云端作业读取失败，可重试：'+error.message;}
 finally{syncAssignmentsLoading=false;if(syncMember()===member)paint();}
}
function syncOperatorRow(assignment){
 return `<div class="assignment-manage"><div><b>${ESC(assignment.title)}</b>
 <small>${ESC(boardById(assignment.boardId).category)} · ${ESC(assignment.platform)} · ${assignment.questions.length} 题</small></div>
 <button type="button" class="btn soft small" data-sync-submissions="${ESC(assignment.id)}">查看云端提交</button>
 </div>`;
}
let syncInboxAssignmentId='',syncRecordsAssignmentId='',syncRecordList=[];
let anchorSearchRefreshAt=0;
const cloudAudioMaxBytes=512*1024;
const cloudAudioTypes=new Set(['audio/webm','audio/ogg','audio/mp4','audio/wav','audio/x-wav','audio/mpeg','audio/aac','audio/x-m4a']);
const audioMime=blob=>blob.type.toLowerCase().split(';',1)[0].trim();
const cloudAudioAcceptable=clip=>Boolean(clip.questionId&&clip.blob instanceof Blob&&clip.blob.size&&
 clip.blob.size<=cloudAudioMaxBytes&&cloudAudioTypes.has(audioMime(clip.blob)));
const syncAudioBusy=new Set();
let fallbackSubmissionMedia=null;

function refreshAnchorSearch(search){
 if(syncMember()?.role!=='anchor'||!search.isConnected||syncAssignmentsLoading||assignmentJoinPending||Date.now()<anchorSearchRefreshAt)return;
 anchorSearchRefreshAt=Date.now()+5000;
 void refreshSyncAssignments();
}

function bindAssignmentActions(target){
 target.querySelectorAll('[data-join-assignment]').forEach(button=>button.onclick=()=>joinAssignment(button.dataset.joinAssignment));
 target.querySelectorAll('[data-my-submissions]').forEach(button=>button.onclick=()=>showMySubmissions(button.dataset.mySubmissions));
}
function cloudClaimList(claims){
 return `<h4>领取进度（${claims.length} 人）</h4>${claims.map(claim=>`<div class="log-row">
  <b>${ESC(claim.anchorName)}</b><span>${claim.submittedAt?'已提交':'已领取'}</span>
  <small>${claim.claimedAt?ESC(new Date(claim.claimedAt).toLocaleString('zh-CN')):''}</small>
 </div>`).join('')||'<p class="scene-tip">暂无主播领取</p>'}`;
}
const repositoryReviewPolls=new WeakMap();
const repositoryReviewDelays=[1500,3000,6000,12000,30000];
function watchRepositoryReviews(target,records,{load,update,visible,immediate=false,onError}){
 const member=syncMember(),previous=repositoryReviewPolls.get(target),ticket={refresh};
 clearTimeout(previous?.timer);
 if(previous)document.removeEventListener('visibilitychange',previous.refresh);
 repositoryReviewPolls.set(target,ticket);
 let delayIndex=0;
 const current=()=>target.isConnected&&syncMember()===member&&repositoryReviewPolls.get(target)===ticket&&visible();
 const pending=()=>records.some(record=>isRepositoryReviewPending(record.repositoryReview));
 const schedule=()=>{
  if(!current()||!pending())return;
  ticket.timer=setTimeout(refresh,repositoryReviewDelays[delayIndex]);
  delayIndex=Math.min(delayIndex+1,repositoryReviewDelays.length-1);
 };
 async function refresh(){
  if(!current())return;
  if(document.hidden){
   document.addEventListener('visibilitychange',refresh,{once:true});
   return;
  }
  try{
   const next=await load();
   if(!current())return;
   records=next;
   update(records);
  }catch(error){
   if(!current())return;
   const retry=pending()&&![401,403,404].includes(error?.status);
   onError?.(retry);
   if(!retry)return;
  }
  schedule();
 }
 if(immediate)void refresh();
 else schedule();
}
function setEvaluationReadback(holder,record){
 const html=evaluationReadbackHtml(record,ESC);
 if(holder.evaluationMarkup===html)return;
 holder.innerHTML=html;
 holder.evaluationMarkup=html;
}
function updateCloudEvaluationReadbacks(view,records){
 const byId=new Map(records.map(record=>[record.id,record]));
 for(const holder of view.querySelectorAll('[data-cloud-evaluation]')){
  const record=byId.get(holder.dataset.cloudEvaluation);
  if(!record)continue;
  setEvaluationReadback(holder,record);
  const indicator=holder.parentElement.querySelector('[data-cloud-review-indicator]');
  const status=repositoryReviewLabel(record.repositoryReview);
  indicator.hidden=!status;
  setNodeText(indicator,status);
 }
}
function cloudSubmissionHtml(record){
 const audioQuestions=new Set((record.audio||[]).map(audio=>audio.questionId));
 const cached=localSubmissions.find(s=>s.cloudId===record.id),status=repositoryReviewLabel(record.repositoryReview);
 return `<details class="submission-card"><summary>${ESC(record.anchorName)} · ${ESC(new Date(record.submittedAt).toLocaleString('zh-CN'))}${record.late?' · 逾期':''} <span class="pill" data-cloud-review-indicator${status?'':' hidden'}>${ESC(status)}</span></summary>
 ${record.turns.map(turn=>`<div class="submission-turn"><b>${ESC(turn.question)}</b>
  <p>${ESC(turn.answer)}</p>${turn.transcript&&turn.transcript!==turn.answer?`<p>转写：${ESC(turn.transcript)}</p>`:''}
  ${audioQuestions.has(turn.questionId)?`<button type="button" class="btn soft small" data-cloud-audio="${ESC(turn.questionId)}" data-cloud-submission="${ESC(record.id)}">播放逐题录音</button>
  <div data-cloud-player role="status"></div>`:''}</div>`).join('')}
 <div data-cloud-evaluation="${ESC(record.id)}">${evaluationReadbackHtml(record,ESC)}</div>
 ${cached?cloudAudioStatusHtml(cached):''}</details>`;
}
function bindCloudPlayback(target,assignmentId){
 target.querySelectorAll('[data-cloud-audio]').forEach(button=>{
  button.onclick=async()=>{
   if(button.disabled)return;
   const holder=button.nextElementSibling,member=syncMember(),epoch=submittedPlaybackEpoch;
   if(!member||!holder)return;
   button.disabled=true;
   for(const previous of holder.querySelectorAll('audio')){
    URL.revokeObjectURL(previous.src);
    submittedPlaybackUrls=submittedPlaybackUrls.filter(url=>url!==previous.src);
   }
   holder.textContent='正在读取录音…';
   const current=()=>holder.isConnected&&syncMember()===member&&submittedPlaybackEpoch===epoch;
   try{
    const data=await assignmentSync.submissionAudio(assignmentId,button.dataset.cloudSubmission,button.dataset.cloudAudio);
    if(!current())return;
    if(!cloudAudioTypes.has(data.mimeType)||typeof data.base64!=='string'||
      data.base64.length>Math.ceil(cloudAudioMaxBytes/3)*4)throw new Error('录音响应格式有误');
    const bytes=Uint8Array.from(atob(data.base64),char=>char.charCodeAt(0));
    if(!bytes.length||bytes.length>cloudAudioMaxBytes)throw new Error('录音响应大小有误');
    const player=document.createElement('audio');
    player.className='audio-player';
    player.controls=true;player.preload='metadata';
    player.src=URL.createObjectURL(new Blob([bytes],{type:data.mimeType}));
    submittedPlaybackUrls.push(player.src);
    holder.replaceChildren(player);
   }catch(error){if(current())holder.textContent='录音读取失败：'+error.message;}
   finally{button.disabled=false;}
  };
 });
 bindAudioRetries(target);
}
function appendCloudInbox(target,assignmentId,html){
 clearSubmittedPlayback();
 target.innerHTML=html;
 bindCloudPlayback(target,assignmentId);
}
async function showSyncInbox(assignmentId){
 const target=ELEM('syncInbox'),assignment=assignmentById(assignmentId),member=syncMember();
 if(!target||!assignment||member?.role!=='operator')return;
 syncInboxAssignmentId=assignmentId;
 clearSubmittedPlayback();
 const view=document.createElement('section');
 view.setAttribute('aria-live','polite');view.textContent='正在读取云端作业…';target.replaceChildren(view);
 try{
  const [claims,submissions]=await Promise.all([
   assignmentSync.progress(assignmentId),assignmentSync.submissions(assignmentId),
  ]);
  if(!view.isConnected||syncMember()!==member)return;
  appendCloudInbox(view,assignmentId,`<h3>${ESC(assignment.title)} · 云端提交（${submissions.length}）</h3>
  <button type="button" class="btn soft small" data-sync-inbox-refresh>刷新领取与提交</button>
  ${cloudClaimList(claims)}
  ${submissions.map(cloudSubmissionHtml).join('')||'<p>暂未收到提交</p>'}`);
  view.querySelector('[data-sync-inbox-refresh]').onclick=()=>showSyncInbox(assignmentId);
  watchRepositoryReviews(view,submissions,{load:()=>assignmentSync.submissions(assignmentId),
   update:rows=>updateCloudEvaluationReadbacks(view,rows),visible:()=>page==='home'&&operatorActiveTab==='tracking'&&syncInboxAssignmentId===assignmentId});
 }catch(error){if(view.isConnected)view.textContent='读取失败：'+error.message;}
}
async function showMySubmissions(assignmentId){
 const target=ELEM('syncMySubmissions'),member=syncMember(),assignment=assignmentById(assignmentId);
 if(!target||!assignment||member?.role!=='anchor')return;
 const view=document.createElement('section');view.className='panel';
 view.textContent='正在读取我的云端提交…';target.replaceChildren(view);
 try{
  const submissions=await assignmentSync.mySubmissions(assignmentId);
  if(!view.isConnected||syncMember()!==member)return;
  appendCloudInbox(view,assignmentId,`<h3>我的云端提交 · ${ESC(assignment.title)}</h3>
   <button type="button" class="btn soft small" data-sync-my-submissions-refresh>刷新提交与评选</button>
   ${submissions.map(cloudSubmissionHtml).join('')||'<p>暂无提交记录</p>'}`);
  view.querySelector('[data-sync-my-submissions-refresh]').onclick=()=>showMySubmissions(assignmentId);
  watchRepositoryReviews(view,submissions,{load:()=>assignmentSync.mySubmissions(assignmentId),
   update:rows=>updateCloudEvaluationReadbacks(view,rows),visible:()=>page==='home'});
  view.scrollIntoView({block:'nearest'});
 }catch(error){if(view.isConnected)view.textContent='读取失败：'+error.message;}
}
function renderCloudAnchorRecords(){
 const target=ELEM('syncAnchorRecords'),selector=ELEM('syncRecordsAssignment');
 if(!target||!selector?.value)return;
 const query=norm(ELEM('syncAnchorLookup')?.value);
 const matches=syncRecordList.filter(record=>!query||norm(record.anchorName).includes(query));
 appendCloudInbox(target,selector.value,matches.map(cloudSubmissionHtml).join('')||'<p>暂无匹配的云端提交</p>');
}
async function refreshCloudAnchorRecords(){
 const target=ELEM('syncAnchorRecords'),select=ELEM('syncRecordsAssignment'),member=syncMember();
 if(!target||!select||member?.role!=='operator')return;
 const id=select.value;
 if(!id){target.textContent='请先发布作业。';return;}
 syncRecordList=[];
 syncRecordsAssignmentId=id;
 const request=document.createElement('p');request.textContent='正在读取主播记录…';request.setAttribute('aria-busy','true');target.replaceChildren(request);
 try{
  const rows=await assignmentSync.submissions(id);
  if(!request.isConnected||syncMember()!==member||select.value!==id)return;
  syncRecordList=rows;
  renderCloudAnchorRecords();
  watchRepositoryReviews(target,rows,{load:()=>assignmentSync.submissions(id),visible:()=>page==='home'&&operatorActiveTab==='lookup'&&select.value===id,
   update:next=>{syncRecordList=next;updateCloudEvaluationReadbacks(target,next);}});
 }catch(error){if(request.isConnected){request.removeAttribute('aria-busy');request.textContent='读取失败：'+error.message;}}
}
function bindCloudAnchorRecords(){
 const select=ELEM('syncRecordsAssignment'),search=ELEM('syncAnchorLookup'),refresh=ELEM('syncRefreshRecords');
 if(!select||!search||!refresh)return;
 select.onchange=refreshCloudAnchorRecords;
 refresh.onclick=refreshCloudAnchorRecords;
 const filterRecords=()=>{
  if(syncRecordsAssignmentId===select.value&&!ELEM('syncAnchorRecords')?.querySelector('[aria-busy="true"]'))renderCloudAnchorRecords();
 };
 search.oninput=event=>{if(!event.isComposing)filterRecords();};
 search.oncompositionend=filterRecords;
}
function cloudAudioStatus(submission){
 if(syncAudioBusy.has(submission.id))return '文字已提交，正在上传逐题录音…';
 const pending=submission.audioPendingIds?.length||0,uploaded=submission.audioUploadedIds?.length||0;
 const localOnly=submission.audioLocalOnly||0,notes=[];
 if(uploaded)notes.push(`${uploaded} 段逐题录音已上传`);
 if(pending)notes.push(`${pending} 段录音待上传，可用原设备重试`);
 if(localOnly)notes.push(`${localOnly} 段录音超出 512 KB 或格式不支持，仅保存在本机`);
 return notes.join('。')||'本次没有需要上传的录音。';
}
function cloudAudioStatusHtml(submission){
 if(!submission?.cloudId||(!submission.audioPendingIds?.length&&!submission.audioUploadedIds?.length&&!submission.audioLocalOnly))return '';
 return `<div data-cloud-upload="${ESC(submission.id)}">
  <p ${page==='sessionReview'?'id="syncAudioUploadStatus"':''} class="scene-tip" role="status">${ESC(cloudAudioStatus(submission))}</p>
  <button type="button" data-retry-cloud-audio="${ESC(submission.id)}" class="btn soft small"
   ${!submission.audioPendingIds?.length?' hidden':''} ${syncAudioBusy.has(submission.id)?' disabled':''}>重试上传逐题录音</button>
 </div>`;
}
function paintCloudAudioStatus(submission){
 for(const holder of document.querySelectorAll('[data-cloud-upload]')){
  if(holder.dataset.cloudUpload!==submission.id)continue;
  holder.querySelector('[role="status"]').textContent=cloudAudioStatus(submission);
  const button=holder.querySelector('[data-retry-cloud-audio]');
  button.hidden=!submission.audioPendingIds?.length;
  button.disabled=syncAudioBusy.has(submission.id);
 }
 const target=ELEM('syncReviewAudioStatus');
 if(target&&!target.firstElementChild&&reviewSubmission()?.id===submission.id){
  target.innerHTML=cloudAudioStatusHtml(submission);
  bindAudioRetries(target);
 }
}
function bindAudioRetries(target){
 target.querySelectorAll('[data-retry-cloud-audio]').forEach(button=>{
  button.onclick=()=>{
   const id=button.dataset.retryCloudAudio;
   const submission=localSubmissions.find(s=>s.id===id)||reviewSubmission();
   if(submission?.id===id)void uploadCloudAudio(submission);
  };
 });
}
async function encodeCloudAudio(blob){
 const bytes=new Uint8Array(await blob.arrayBuffer());
 let binary='';
 for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
 return btoa(binary);
}
async function uploadCloudAudio(submission,media=null){
 const member=syncMember();
 if(member?.role!=='anchor'||!submission.cloudId||!submission.audioPendingIds?.length||
   syncAudioBusy.has(submission.id))return;
 const current=()=>syncMember()===member;
 syncAudioBusy.add(submission.id);
 paintCloudAudioStatus(submission);
 try{
  const local=media||(fallbackSubmissionMedia?.id==='submission-media:'+submission.id?fallbackSubmissionMedia:null)||
    await getSubmittedMedia(submission.id);
  if(!current())return;
  if(!local?.audio?.length)throw new Error('这台设备上没有可重试的录音');
  for(const questionId of [...submission.audioPendingIds]){
   if(!current())return;
   const clip=local.audio.find(row=>row.questionId===questionId);
   if(!clip||!cloudAudioAcceptable(clip))continue;
   try{
    const base64=await encodeCloudAudio(clip.blob);
    if(!current())return;
    const result=await assignmentSync.uploadSubmissionAudio(submission.assignmentId,submission.cloudId,{
     questionId,mimeType:audioMime(clip.blob),base64,
    });
    if(!current())return;
    if(result?.audio?.questionId!==questionId)throw new Error('未确认录音保存');
    const change=s=>({...s,audioPendingIds:(s.audioPendingIds||[]).filter(id=>id!==questionId),
     audioUploadedIds:[...new Set([...(s.audioUploadedIds||[]),questionId])]});
    Object.assign(submission,change(submission));
    if(localSubmissions.some(row=>row.id===submission.id)){
     try{localSubmissions=await updatePrefList('submissions',rows=>rows.map(row=>row.id===submission.id?change(row):row));}
     catch{/* The cloud ack is authoritative; an IndexedDB retry is idempotent. */}
    }
   }catch{/* Keep this clip pending so later clips and the confirmed text remain usable. */}
  }
  if(current()&&submission.audioPendingIds.length)toast('文字已提交。部分录音未上传，请在原设备重试。');
 }catch(error){if(current())toast('文字已提交。录音未上传：'+error.message);}
 finally{
  syncAudioBusy.delete(submission.id);
  if(current())paintCloudAudioStatus(submission);
 }
}

function submitStatusText(submission){
 if(submission.cloudConfirmed)return '✓ 已提交到云端'+(submission.late?'（逾期提交）':'');
 return submission.assignmentReceipt?'✓ 已保存到本机，请发送回执':'✓ 已保存到本机';
}
function reviewSubmitHtml(assignment,operatorNames,submitted){
 const member=syncMember();
 if(member&&!assignment)return '<p class="scene-tip">本场为自由练习，复盘和录像保存在当前设备。</p>';
 const description=assignment
  ?`<div class="fixed-operator">接收运营：${ESC(assignment.operatorName)}</div>`
  :`<div class="field"><label for="submitOperator">接收运营</label><input id="submitOperator" list="operatorNames" placeholder="输入运营姓名"><datalist id="operatorNames">${operatorNames.map(name=>`<option value="${ESC(name)}"></option>`).join('')}</datalist></div>`;
 return `<div class="submit-card review-submit-card">
  <div class="review-heading"><h3>${assignment?'提交运营作业':'保存本次记录'}</h3></div>
  ${description}
  ${assignment&&assignmentExpired(assignment)&&!submitted?'<p class="scene-tip late-tip">作业已过截止时间，提交后标记为逾期。</p>':''}
  <button id="submitSession" class="btn primary wide"${submitted?' disabled':''}>
   ${submitted?ESC(submitStatusText(submitted)):member?'提交到云端':assignment?'保存并导出回执':'保存到本机'}
  </button>
  ${submitted?.assignmentReceipt?'<button type="button" id="exportAssignmentReceipt" class="btn soft wide">导出作业回执（JSON）</button>':''}
  ${member?`<div id="syncReviewAudioStatus">${cloudAudioStatusHtml(submitted||{})}</div>
  <section class="review-ai-panel" id="reviewAiEvaluation" aria-label="云端 AI 评选" hidden>
   <h3>云端 AI 评选</h3>
   <button type="button" class="btn soft small" id="reviewAiRefresh">刷新评选状态</button>
   <p class="scene-tip" role="status" data-ai-eval-load></p><div data-ai-eval-output aria-live="polite"></div>
  </section>`:''}
  <p class="scene-tip submit-local-note">${member?'提交后运营可查看文字、转写及已上传的逐题录音。整场录像只保存在本机。':'数据保存在当前浏览器。跨设备交接时，请发送作业回执给运营。'}</p>
 </div>`;
}
function cloudSubmissionPayload(snapshot){
 const {id,assignmentId,assignmentVersion,assignmentSnapshotSha256,operatorName,anchorName,boardId,platform}=snapshot;
 return {
  id,assignmentId,assignmentVersion,assignmentSnapshotSha256,operatorName,anchorName,boardId,platform,
  turns:snapshot.turns.map(({questionId,question,answer,transcript,model,sku,asrStatus,manualCleared})=>
    ({questionId,question,answer,transcript,model,sku,asrStatus,manualCleared})),
 };
}

function home(){
 if((assignmentSync||syncConfigError)&&!syncMember())return renderSyncLogin();
 setTitle(userRole?(userRole==='operator'?'运营工作台':'练播房'):'选择进入方式');applyRoleChrome();
 if(!userRole||!userName){
  ELEM('view').innerHTML=`<section class="role-gateway"><div class="role-gateway-head"><span class="eyebrow">TCL · PRACTICE HUB</span><h2>今天要进入哪个工作区？</h2><p>先选择工作区，进入后只需填写姓名。此版本为本机体验，不等同正式账号登录。</p></div><div class="role-grid"><button class="role-card anchor" data-role-pick="anchor"><span class="role-icon" aria-hidden="true">${ICON.video}</span><span class="role-index">01 / ANCHOR</span><strong>主播练播房</strong><small>选品类、看镜头、练弹幕、复盘回看。<br>把时间留给练播本身。</small><span>进入主播端 →</span></button><button class="role-card operator" data-role-pick="operator"><span class="role-icon" aria-hidden="true">${ICON.tasks}</span><span class="role-index">02 / OPERATIONS</span><strong>直播运营</strong><small>创建作业、跟踪进度、查看主动提交记录。<br>每次专注完成一件事。</small><span>进入运营端 →</span></button></div></section>`;
  document.querySelectorAll('[data-role-pick]').forEach(btn=>btn.onclick=()=>{pendingRole=btn.dataset.rolePick;page='roleLogin';render();});return;
 }
 if(userRole==='operator')return operatorHome();
 return anchorHome();
}
function roleLogin(){setTitle(pendingRole==='operator'?'运营登录':'主播登录');ELEM('view').innerHTML=`<section class="name-login"><button class="ghost-btn" id="loginBack">← 返回</button><div class="name-login-card"><span class="eyebrow">${pendingRole==='operator'?'LIVE OPERATIONS':'ANCHOR PRACTICE'}</span><h2>${pendingRole==='operator'?'输入运营姓名':'输入主播姓名'}</h2><p>填写姓名即可继续体验。本机数据不跨设备同步，姓名不是正式账号认证。</p><div class="field"><label>姓名</label><input id="simpleName" maxlength="30" autocomplete="name" placeholder="请输入姓名"></div><button id="simpleLogin" class="btn primary wide">进入</button></div></section>`;ELEM('loginBack').onclick=()=>{pendingRole='';page='home';render()};ELEM('simpleLogin').onclick=async()=>{const name=ELEM('simpleName').value.trim();if(!name)return toast('请输入姓名');userRole=pendingRole||'anchor';userName=name;pendingRole='';page='home';render();void findSavedSession()};ELEM('simpleName').addEventListener('keydown',e=>{if(e.key==='Enter')ELEM('simpleLogin').click()});}
function resumeReviewHtml(){if(!reviewAlive())return '';const snap=lastSessionSnapshot,sub=reviewSubmission();return `<button type="button" class="resume-review" data-resume-review><span class="resume-label">${sub?(sub.cloudConfirmed?'上一场已提交到云端':'上一场已保存到本机'):'上一场还没提交'}</span><b>${ESC(snap.category)} · ${ESC(snap.platform)}${snap.assignmentTitle?' · '+ESC(snap.assignmentTitle):''}</b><small>${sub?(sub.cloudConfirmed?'运营可查看，录像仍保存在本机':'本机已保存，可回看复盘'):'本机只保留最近一场恢复记录；新练习保存后会替换，请先下载备份'}</small><em>返回本场复盘 →</em></button>`;}
function bindResumeReview(){document.querySelectorAll('[data-resume-review]').forEach(b=>b.onclick=()=>nav('sessionReview'));if(ELEM('restoreLocalSession'))ELEM('restoreLocalSession').onclick=restoreLocalSession;}
function assignmentRowHtml(a){
 const st=assignmentStatusFor(a,userName),closed=st==='已截止',joined=assignmentJoined(a,userName);
 const action=closed?'已截止':joined?'继续训练':syncMember()?'领取并练习':'加入训练';
 return `<div class="assignment-row"><div><b>${ESC(a.title)}</b><small>${ESC(a.operatorName)} · ${ESC(boardById(a.boardId).category)} · ${ESC(a.platform)}${a.deadline?' · 截止 '+ESC(new Date(a.deadline).toLocaleString('zh-CN')):' · 无截止时间'}</small></div>
 <span class="pill${closed||st==='已逾期'?' warn':''}">${ESC(st)}</span>
 <button class="btn small primary" data-join-assignment="${ESC(a.id)}"${closed?' disabled':''}>${action}</button>
 ${syncMember()&&cloudAssignmentState(a.id)?.submitted?`<button type="button" class="btn soft small" data-my-submissions="${ESC(a.id)}">查看我的提交</button>`:''}</div>`;
}
function identityBar(){return `<div class="identity-bar r2-identity"><span class="r2-avatar" aria-hidden="true">${ESC([...String(userName)][0]||'·')}</span><span class="r2-identity-text"><b>${ESC(userName)}</b><small>${ESC(roleLabel())} · ${syncMember()?'云端账号':'本机体验'}</small></span><button class="ghost-btn" id="switchIdentity">${syncMember()?'退出账号':'切换身份'}</button></div>`;}
function anchorAssignmentStats(){
 const todo=visibleAssignments().filter(x=>canSeeAssignment(x)&&(['已加入','已训练','已逾期'].includes(assignmentStatusFor(x,userName))||x.schema&&assignmentStatusFor(x,userName)==='未加入'));
 const cloudMode=Boolean(syncMember());
 const submitted=cloudMode?cloudAssignments.filter(row=>row.submitted).length:localSubmissions.filter(x=>x.anchorName===userName).length;
 const hasCounts=!cloudMode||syncAssignmentsLoaded;
 return {todo,submittedCount:hasCounts?submitted:'—',todoCount:hasCounts?todo.length:'—'};
}
function anchorTodoHtml(todo){
 return todo.length?`<section class="r2-todo"><h3>待完成的作业</h3><div class="assignment-results">${todo.slice(0,3).map(assignmentRowHtml).join('')}</div>${todo.length>3?`<p class="scene-tip">当前显示前 3 条（共 ${todo.length} 条），可在下方“运营布置的作业”按运营姓名筛选。</p>`:''}</section>`:'';
}
function updateAnchorAssignmentDashboard(){
 const list=ELEM('anchorAssignmentTodo');if(!list)return;
 const {todo,submittedCount,todoCount}=anchorAssignmentStats();
 ELEM('anchorSubmittedCount').textContent=submittedCount;
 ELEM('anchorTodoCount').textContent=todoCount;
 list.innerHTML=anchorTodoHtml(todo);bindAssignmentActions(list);
 homeResultsUpdater?.();
}
function anchorHome(){
 const allMine=localTrainingLogs.filter(x=>x.anchorName===userName).sort((a,b)=>String(b.trainedAt||'').localeCompare(String(a.trainedAt||'')));
 const last=allMine[0]||null;
 const recent=last&&BOARDS.find(x=>x.id===last.boardId);
  const mine=allMine.slice(0,5);
 const startBoard=recent||BOARDS[0],startPlatform=recent&&startBoard.platforms.includes(last.platform)?last.platform:startBoard.platforms[0];
 const {todo,submittedCount,todoCount}=anchorAssignmentStats();
 ELEM('view').innerHTML=`${identityBar()}${syncMember()?syncRefreshHtml():''}${resumeReviewHtml()}${savedSessionHtml()}
 <section class="r2-start"><p class="r2-hello">${ESC(userName)}，今天练什么？</p>
 <div class="r2-start-card"><span class="r2-kicker">${recent?'接着上次练':'从这里开始'}</span><h2>${ESC(startBoard.category)}</h2><p class="r2-start-meta"><span>平台 · ${ESC(startPlatform)}</span><span>${ESC(practicePoolLabel(startBoard,startPlatform))}</span></p>
 <button class="btn primary r2-start-btn" id="freePractice">${ICON.video}<span>检查设备，准备练播</span></button>
 <button class="r2-link" id="r2ChangeBoard" type="button">换一个品类或平台 ›</button></div>
 <div class="r2-stats"><div><b>${allMine.length}</b><span>累计练播</span></div><div><b id="anchorSubmittedCount">${submittedCount}</b><span>已提交</span></div><div><b id="anchorTodoCount">${todoCount}</b><span>待完成作业</span></div></div><div data-vosk-widget="card" aria-label="中文识别模型准备进度"></div></section>
 <div id="anchorAssignmentTodo">${anchorTodoHtml(todo)}</div>
 <details class="hub-fold" id="assignmentFold" ${assignmentSearch?'open':''}><summary><span><b>运营布置的作业</b><small>${syncMember()?'云端作业 · 按运营姓名搜索':'本机测试 · 暂不支持跨设备同步'}</small></span><span class="fold-indicator">展开 ›</span></summary><div class="hub-fold-body"><label class="field" for="assignmentSearch">搜索运营、作业名称或板块<input id="assignmentSearch" value="${ESC(assignmentSearch)}" placeholder="如：张老师 / 电视抖音"></label>${syncMember()?'':'<div class="field"><label for="assignmentPackageImport">从运营接收作业包（JSON，跨设备需手动传送）</label><input type="file" id="assignmentPackageImport" accept=".json,application/json"><small>本机姓名不是账号认证；作业包需要运营本人发送给你。</small></div>'}<div class="assignment-results" id="assignmentSearchResults"></div></div></details>
 ${syncMember()?'<section id="syncMySubmissions" aria-live="polite"></section>':''}
 <details class="hub-fold" id="logFold"><summary><span><b>我的练习记录</b><small>共 ${allMine.length} 次 · 本机练习记录</small></span><span class="fold-indicator">展开 ›</span></summary><div class="hub-fold-body">${mine.map(l=>`<div class="log-row"><span>${ESC(new Date(l.trainedAt).toLocaleString('zh-CN'))}</span><b>${ESC(l.category)} · ${ESC(l.platform)}</b><span>${l.assignmentId?'作业练习':'自由练习'}</span></div>`).join('')||'<div class="empty compact">还没有训练记录，完成首次练播后会显示在这里。</div>'}<button class="btn soft hub-secondary" id="openPracticeRecords">查看全部练习记录</button></div></details>
`;
 renderVoskWidgets();
 ELEM('switchIdentity').onclick=logoutIdentity;
 ELEM('freePractice').onclick=()=>openBoard(startBoard.id,startPlatform,{assignmentId:'',checkDevicesOnOpen:true});
 ELEM('r2ChangeBoard').onclick=()=>nav('catalog');
 bindAssignmentActions(ELEM('view'));
 if(ELEM('repeatLast'))ELEM('repeatLast').onclick=()=>openBoard(recent.id,last.platform,{assignmentId:'',checkDevicesOnOpen:true});
 ELEM('openPracticeRecords').onclick=()=>nav('progress');
 const search=ELEM('assignmentSearch'),results=ELEM('assignmentSearchResults'),fold=ELEM('assignmentFold');
 let searchPullTimer;
 const updateResults=()=>{const q=norm(assignmentSearch),matches=visibleAssignments().filter(a=>canSeeAssignment(a)&&(!q||norm(`${a.operatorName}${a.title}${boardById(a.boardId).category}${a.platform}`).includes(q)));results.innerHTML=(matches.slice(0,8).map(assignmentRowHtml).join('')||'<div class="empty compact">暂无匹配作业</div>')+(matches.length>8?`<p class="scene-tip">仅显示前 8 条（共 ${matches.length} 条），请输入运营姓名或作业名称精确筛选。</p>`:'');bindAssignmentActions(results);};
 if(ELEM('assignmentPackageImport'))ELEM('assignmentPackageImport').onchange=importAssignmentPackage;
 bindSyncControls();
 const pullAfterInput=()=>{
  clearTimeout(searchPullTimer);
  searchPullTimer=setTimeout(()=>refreshAnchorSearch(search),300);
 };
 search.oninput=e=>{
  assignmentSearch=e.target.value;
  if(!e.isComposing){updateResults();pullAfterInput();}
 };
 search.oncompositionend=e=>{assignmentSearch=e.target.value;updateResults();pullAfterInput();};
 fold.addEventListener('toggle',()=>{if(fold.open)refreshAnchorSearch(search);});
 updateResults();homeResultsUpdater=updateResults;bindResumeReview();
 syncFoldIndicators();
}
let assignmentPreview=null, assignmentPreviewEpoch=0;
let operatorActiveTab="publish";
function operatorHome(){
 invalidateAssignmentPreview();
 const cloudMode=Boolean(syncMember());
 const own=visibleAssignments().filter(a=>cloudMode||a.operatorName===userName).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const names=[...new Set([...localTrainingLogs.map(x=>x.anchorName),...localSubmissions.map(x=>x.anchorName)])].filter(Boolean);
 ELEM('view').innerHTML=`${identityBar()}${syncMember()?syncRefreshHtml():''}
 <section class="hub-welcome operator"><span class="eyebrow">OPERATIONS · 运营工作台</span><h2>${ESC(userName)}，把训练安排得更清楚</h2><p>发布作业、跟踪进度、查看提交。三项任务相互独立，减少来回查找。</p></section>
 <div class="ops-tabs" role="tablist" aria-label="运营任务"><button data-ops-tab="publish" role="tab" aria-selected="false">① 发布作业</button><button data-ops-tab="tracking" role="tab" aria-selected="false">② 作业进度 <small>${own.length}</small></button><button data-ops-tab="lookup" role="tab" aria-selected="false">③ 主播记录</button></div>
 <section id="ops-publish" class="panel hub-task" role="tabpanel" hidden><h2>发布一份训练作业</h2><p class="hub-task-tip">填写作业名称，选择训练板块，点击发布。截止时间可以不填。</p><div class="field"><label for="assignmentTitle">1. 作业名称</label><input id="assignmentTitle" placeholder="如：电视抖音产品问答"></div><div class="cols-2"><div class="field"><label for="assignmentBoard">2. 训练板块</label><select id="assignmentBoard">${BOARDS.map(b=>`<option value="${ESC(b.id)}">${ESC(b.category)} · ${ESC(b.display_platform)}</option>`).join('')}</select></div><div class="field"><label for="assignmentPlatform">平台</label><select id="assignmentPlatform"></select></div></div><div class="field"><label for="assignmentDeadline">3. 截止时间（可选）</label><input id="assignmentDeadline" type="datetime-local"></div><p class="scene-tip">${cloudMode?'作业发布后，主播可在任意设备按运营姓名搜索并领取。':'本次作业面向所有主播开放领取；跨设备请导入运营发送的 JSON。'}</p><div class="field"><label for="assignmentExcelFile">4. 上传本次作业 Excel</label><input type="file" id="assignmentExcelFile" accept=".xlsx,.xls"/><small>一行一题：问题、参考答案、型号、SKU、评分点。只用于本次作业，不进入公共题库。文件最多 15 MB，XLSX 解压后总量最多 50 MB。</small></div><button type="button" class="btn soft" id="assignmentExcelPreviewBtn">解析并预览作业题目</button>${assignmentDraftPanelHtml()}<div id="assignmentExcelPreview" role="status" aria-live="polite"></div><button id="publishAssignment" class="btn primary wide hub-publish">发布作业 →</button>${cloudMode?'':'<p class="scene-tip">当前为本机演示，姓名不作为正式登录认证。</p>'}</section>
 <section id="ops-tracking" class="panel hub-task" role="tabpanel" hidden><h2>我发布的作业</h2>${syncMember()?'<p class="hub-task-tip">查看领取进度、主播提交的逐题回答与录音。</p><div id="syncInbox"></div>':'<p class="hub-task-tip">主播主动提交后，需手动导入 JSON 回执才能在此设备查看。</p><div class="field"><label for="assignmentReceiptImport">接收主播提交回执（JSON；需人工确认真实性）</label><input id="assignmentReceiptImport" type="file" accept=".json,application/json"></div>'}<div class="assignment-results">${own.map(a=>{if(syncMember())return syncOperatorRow(a);const anchors=[...new Set([...(a.assignedTo||[]),...localAssignmentJoins.filter(j=>j.assignmentId===a.id).map(j=>j.anchorName),...localSubmissions.filter(x=>x.assignmentId===a.id&&x.operatorName===a.operatorName).map(x=>x.anchorName)])];return `<div class="assignment-manage"><div><b>${ESC(a.title)}</b><small>${ESC(boardById(a.boardId).category)} · ${ESC(a.platform)}${a.deadline?' · 截止 '+ESC(new Date(a.deadline).toLocaleString('zh-CN')):' · 无截止时间'}</small></div><div>${a.schema?`<small>Excel作业 · ${a.questions.length}题 · 固定版本 v${a.version}</small><button type="button" class="btn soft small" data-export-assignment="${ESC(a.id)}">导出作业包给主播</button>`:""}</div><div class="assignment-statuses">${anchors.map(n=>`<button class="status-chip" data-anchor-name="${ESC(n)}">${ESC(n)} · ${ESC(assignmentStatusFor(a,n))}${(c=>c?` · 练${c}次`:'')(localTrainingLogs.filter(l=>l.assignmentId===a.id&&l.anchorName===n).length)}</button>`).join('')||'<span class="muted">暂无主播加入，可让主播在“运营作业”里搜索本作业</span>'}</div></div>`}).join('')||'<div class="empty compact">还没有发布作业，可点击上方“发布作业”创建第一份任务。</div>'}</div></section>
 ${cloudMode?`<section id="ops-lookup" class="panel hub-task" role="tabpanel" hidden>
  <h2>主播记录</h2>
  <label class="field" for="syncRecordsAssignment">查看哪份作业？
   <select id="syncRecordsAssignment">${own.map(a=>`<option value="${ESC(a.id)}"${a.id===syncRecordsAssignmentId?' selected':''}>${ESC(a.title)}</option>`).join('')}</select>
  </label>
  <label class="field" for="syncAnchorLookup">按主播姓名筛选
   <input id="syncAnchorLookup" placeholder="全部主播">
  </label>
  <button type="button" class="btn soft" id="syncRefreshRecords">刷新主播记录</button>
  <div id="syncAnchorRecords" class="question-list" aria-live="polite"></div>
 </section>`:`<section id="ops-lookup" class="panel hub-task" role="tabpanel" hidden><h2>查找主播训练记录</h2><p class="hub-task-tip">未提交的练习只显示时间、板块和次数，不显示回答、转写或回放。</p><div class="field"><label for="anchorLookup">主播姓名</label><input id="anchorLookup" placeholder="输入主播姓名搜索"></div><div id="anchorLookupResult" class="question-list">${names.slice(0,8).map(n=>`<button class="anchor-search-row" data-anchor-name="${ESC(n)}">${ESC(n)}</button>`).join('')||'<div class="empty compact">暂无主播训练记录</div>'}</div></section>`}`;
 ELEM('switchIdentity').onclick=logoutIdentity;
 const board=ELEM('assignmentBoard'),plat=ELEM('assignmentPlatform');
 const fill=()=>{const b=boardById(board.value);plat.innerHTML=b.platforms.map(p=>`<option value="${ESC(p)}">${ESC(p)}</option>`).join('')};board.onchange=fill;fill();
 ELEM('publishAssignment').onclick=async()=>{await publishAssignment();};
 ELEM('assignmentExcelPreviewBtn').onclick=previewAssignmentExcel;
 const draftMember=syncMember();
 bindAssignmentDraftPanel({
  panel:ELEM('assignmentDraftPanel'),parseDocumentFile,
  getAssignmentScope:()=>({boardId:board.value,category:boardById(board.value).category,platform:plat.value}),
  scopeInputs:[board,plat],
  cloud:draftMember?.role==='operator'?{
   isCurrent:()=>syncMember()===draftMember,
   getAvailability:assignmentSync.getDraftAvailability,
   generate:assignmentSync.generateDraft,
  }:null,
  invalidate:()=>{if(assignmentPreview?.source==='ai')invalidateAssignmentPreview('草稿已修改，请重新确认');},
  confirm:confirmAssignmentDraft,
 });
 ['assignmentTitle','assignmentBoard','assignmentPlatform','assignmentDeadline'].forEach(id=>['input','change'].forEach(event=>ELEM(id).addEventListener(event,()=>invalidateAssignmentPreview('作业条件已变化，请重新预览 Excel 或确认草稿'))));
 ELEM('assignmentExcelFile').addEventListener('change',()=>invalidateAssignmentPreview('文件已更换，请重新解析预览'));
 document.querySelectorAll('[data-export-assignment]').forEach(btn=>btn.onclick=()=>{const a=assignmentById(btn.dataset.exportAssignment);if(a?.schema)downloadJSON('TCL-运营作业-'+a.id+'.json',toExchangePackage(a));});
 if(ELEM('assignmentReceiptImport'))ELEM('assignmentReceiptImport').onchange=importAssignmentReceipt;
 bindSyncControls();
 const lookup=ELEM('anchorLookup');
 if(lookup){
  lookup.oninput=e=>{if(!e.isComposing)renderAnchorLookup(e.target.value)};
  lookup.oncompositionend=e=>renderAnchorLookup(e.target.value);
 }
 if(cloudMode)bindCloudAnchorRecords();
 document.querySelectorAll('[data-anchor-name]').forEach(b=>b.onclick=()=>{if(b.closest('#ops-tracking')){selectTab('lookup');ELEM('anchorLookup').value=b.dataset.anchorName;}showAnchorSummary(b.dataset.anchorName)});
 const selectTab=tab=>{
  if(operatorActiveTab!==tab)clearSubmittedPlayback();
  operatorActiveTab=tab;
  document.querySelectorAll('[data-ops-tab]').forEach(b=>{
   const current=b.dataset.opsTab===tab;
   b.classList.toggle('selected',current);b.setAttribute('aria-selected',String(current));b.tabIndex=0;
  });
  for(const key of ['publish','tracking','lookup'])ELEM('ops-'+key).hidden=key!==tab;
  if(cloudMode&&tab==='lookup')void refreshCloudAnchorRecords();
 if(cloudMode&&tab==='tracking'){
  const selection=own.find(a=>a.id===syncInboxAssignmentId)||own[0];
  if(selection)void showSyncInbox(selection.id);
 }
 };
 document.querySelectorAll('[data-ops-tab]').forEach(b=>b.onclick=()=>selectTab(b.dataset.opsTab));
 selectTab(['publish','tracking','lookup'].includes(operatorActiveTab)?operatorActiveTab:'publish');
}
async function logoutIdentity(){if(submissionSaving||assignmentPublishPending)return toast('请等待本次保存完成');if(!canLeaveRecording())return;
 if(syncMember()){assignmentSync.signOut(true);localDB?.close();location.reload();return;}restoreSessionEpoch++;savedSessionCandidate=null;operatorActiveTab='publish';resetRunState();deviceCheckSeq++;stopScene();exitFocus();roomPhase='check';deviceCheck={camera:false,microphone:false,recorder:false,ready:false,mode:'hardware',checked:false};discardVideoArchive();lastSessionSnapshot=null;lastTrainingLogId='';userRole='';userName='';activeAssignmentId='';page='home';render();}
let assignmentExcelParsing=0;
function invalidateAssignmentPreview(message=''){
 const draftStatus=ELEM('assignmentDraftStatus');
 if(message&&assignmentPreview?.source==='ai'&&draftStatus)draftStatus.textContent=message;
 assignmentPreviewEpoch++;assignmentPreview=null;assignmentExcelParsing=0;
 const panel=ELEM('assignmentExcelPreview'),button=ELEM('assignmentExcelPreviewBtn');
 if(panel)panel.textContent=message;if(button)button.disabled=false;
}
function assignmentFormFingerprint(){
 return JSON.stringify(['assignmentTitle','assignmentBoard','assignmentPlatform','assignmentDeadline'].map(id=>ELEM(id)?.value??''));
}
function assignmentViewCurrent(ctx){
 if(userRole!==ctx.role||userName!==ctx.owner||page!=='home'||ELEM('view')?.firstElementChild!==ctx.view||
  assignmentPreviewEpoch!==ctx.epoch||assignmentFormFingerprint()!==ctx.fingerprint)return false;
 if(ctx.source==='ai')return ELEM('assignmentDraftPanel')===ctx.input&&ctx.input.isConnected;
 return ELEM('assignmentExcelFile')===ctx.input&&ctx.input.isConnected&&ctx.input.files?.[0]===ctx.file;
}
function showAssignmentPreview(questions,label){
 const panel=ELEM('assignmentExcelPreview');
 panel.innerHTML='<p><b>'+ESC(label)+'（尚未发布）</b></p>'+questions.map((q,i)=>'<p>'+ESC(String(i+1))+'. '+ESC(q.question)+' · 型号：'+ESC(q.model||'未填')+' · SKU：'+ESC(q.sku||'未填')+' · 参考答案：'+ESC(q.answer)+' · 评分要点：'+ESC(q.keyPoints.join('；')||'未填')+'</p>').join('');
}
function confirmAssignmentDraft(rows,origin){
 if(userRole!=='operator'||page!=='home'||assignmentPublishPending)throw new Error('当前无法确认作业草稿');
 const boardId=ELEM('assignmentBoard').value,platform=ELEM('assignmentPlatform').value;
 const questions=validateExcelQuestions(rows.map((row,i)=>({...row,source:'运营已核对的'+origin,locator:`${origin}第 ${i+1} 题`})),
  {category:boardById(boardId).category,platform});
 invalidateAssignmentPreview();
 assignmentPreview={source:'ai',epoch:assignmentPreviewEpoch,owner:userName,role:userRole,view:ELEM('view')?.firstElementChild,
  input:ELEM('assignmentDraftPanel'),boardId,platform,fingerprint:assignmentFormFingerprint(),questions};
 showAssignmentPreview(questions,origin+'已确认，共 '+questions.length+' 题');
}
async function previewAssignmentExcel(){
 if(userRole!=='operator'||page!=='home')return;
 const input=ELEM('assignmentExcelFile'),file=input?.files?.[0],panel=ELEM('assignmentExcelPreview'),button=ELEM('assignmentExcelPreviewBtn');
 if(!input||!panel||!button||button.disabled)return;
 if(!file)return toast('请先选择Excel作业文件');
 if(file.size===0||file.size>15*1024*1024)return toast('作业Excel须为1字节至15MB，请检查或拆分后导入');
 if(!/\.(xlsx|xls)$/i.test(file.name))return toast('作业只支持XLSX或XLS');
 invalidateAssignmentPreview('正在读取并检查Excel题目…');
 const ctx={source:'excel',epoch:assignmentPreviewEpoch,owner:userName,role:userRole,view:ELEM('view')?.firstElementChild,input,file,boardId:ELEM('assignmentBoard').value,platform:ELEM('assignmentPlatform').value,fingerprint:assignmentFormFingerprint()};
 assignmentExcelParsing=ctx.epoch;button.disabled=true;
 try{
  const parsed=await parseDocumentFile(file,{assignmentExcel:true});if(!assignmentViewCurrent(ctx))return;
  const expectedCount=assertExcelOneRowPerQuestion(parsed),extracted=assertExcelExtractionComplete(expectedCount,extractQA(parsed));
  const questions=validateExcelQuestions(extracted,{category:boardById(ctx.boardId).category,platform:ctx.platform});
  if(!assignmentViewCurrent(ctx))return;
  assignmentPreview={...ctx,questions};
  showAssignmentPreview(questions,'已解析 '+questions.length+' 道专属作业题目');
 }catch(e){if(assignmentViewCurrent(ctx)){assignmentPreview=null;panel.textContent='Excel解析失败：'+String(e?.message||e);}}
 finally{if(assignmentExcelParsing===ctx.epoch)assignmentExcelParsing=0;if(assignmentViewCurrent(ctx))button.disabled=false;}
}
async function importAssignmentPackage(ev){
 const input=ev.currentTarget,file=input.files?.[0];if(!file||userRole!=='anchor')return;
 if(memoryFallback||!localDB)return toast('本机数据库不可用，无法可靠导入作业，请保留原文件后重试');
 if(file.size===0||file.size>1*1024*1024)return toast('作业包须为1字节至1MB，请联系运营检查或拆分');
 const who=userName,view=ELEM('view')?.firstElementChild;
 const current=()=>userName===who&&userRole==='anchor'&&page==='home'&&ELEM('view')?.firstElementChild===view&&ELEM('assignmentPackageImport')===input&&input.isConnected&&input.files?.[0]===file;
 try{
  const envelope=JSON.parse(await file.text());if(!current())return;
  const assignment=structuredClone(await verifyAssignment(envelope?.assignment,{board:boardById(envelope?.assignment?.boardId)}));if(!current())return;
  if(assignment.schema!==envelope.schema||!isAssigned(assignment,who))throw new Error('作业包不匹配当前主播姓名');
  const board=BOARDS.find(x=>x.id===assignment.boardId);
  if(!board||!board.platforms.includes(assignment.platform)||assignment.questions.some(q=>q.category!==board.category))throw new Error('作业板块、品类或平台不匹配');
  let alreadyImported=false;
  const saved=await updatePrefList('assignments',list=>{if(!current())throw new Error('导入页面或姓名已变化');const existing=list.find(a=>a.id===assignment.id);if(existing&&existing.snapshotSha256!==assignment.snapshotSha256)throw new Error('同一作业ID的版本发生冲突，拒绝覆盖');if(existing){alreadyImported=true;return list;}alreadyImported=false;return [assignment,...list];});
  if(current()){localAssignments=saved;toast(alreadyImported?'该作业已在本机列表中，可搜索运营姓名自主领取':'作业包已导入本机，可搜索运营姓名自主领取');anchorHome();}
 }catch(e){if(current())toast('导入失败：'+String(e?.message||e));}
}
function receiptKey(receipt){return JSON.stringify([receipt.assignmentId,receipt.sessionId,receipt.anchorName]);}
function receiptContent(receipt){
 return JSON.stringify([receipt.schema,receipt.assignmentId,receipt.snapshotSha256,receipt.assignmentVersion,receipt.boardId,receipt.platform,receipt.operatorName,receipt.anchorName,receipt.sessionId,receipt.submittedAt,receipt.turns.map(t=>[t.questionId,t.question,t.answer,t.transcript||'',t.model||'',t.sku||'',t.asrStatus||''])]);
}
async function importAssignmentReceipt(ev){
 const input=ev.currentTarget,file=input.files?.[0];if(!file||userRole!=='operator')return;
 if(memoryFallback||!localDB)return toast('本机数据库不可用，无法可靠保存回执，请保留原文件后重试');
 if(file.size===0||file.size>1*1024*1024)return toast('回执文件须为1字节至1MB');
 const owner=userName,view=ELEM('view')?.firstElementChild;
 const current=()=>userName===owner&&userRole==='operator'&&page==='home'&&ELEM('view')?.firstElementChild===view&&ELEM('assignmentReceiptImport')===input&&input.isConnected&&input.files?.[0]===file;
 try{
  const receipt=JSON.parse(await file.text());if(!current())return;
  const assignment=assignmentById(receipt.assignmentId);
  if(!assignment||assignment.operatorName!==owner)throw new Error('未找到本人发布的对应作业');
  await verifyAssignment(assignment,{board:boardById(assignment.boardId)});if(!current())return;verifyReceipt(receipt,assignment);
  const key=receiptKey(receipt),content=receiptContent(receipt),byId=new Map(assignment.questions.map(q=>[q.id,q]));
  const item={id:'imported-receipt:'+encodeURIComponent(key),sessionId:receipt.sessionId,assignmentId:receipt.assignmentId,operatorName:receipt.operatorName,anchorName:receipt.anchorName,boardId:assignment.boardId,category:boardById(assignment.boardId).category,platform:assignment.platform,submittedAt:receipt.submittedAt,turns:receipt.turns.map(t=>{const q=byId.get(t.questionId);return {...t,prompt:t.question,referenceAnswer:q.answer,keyPoints:[...q.keyPoints],kind:q.kind,source:q.source,sourceRef:q.sourceRef,sourceLocators:[...q.sourceLocators]};}),assignmentSnapshotSha256:assignment.snapshotSha256,assignmentVersion:assignment.version,assignmentReceipt:receipt,late:isReceiptLate(receipt,assignment),manuallyImported:true,verification:'待人工核实（没有服务端身份认证）'};
  const saved=await updatePrefList('submissions',list=>{if(!current())throw new Error('导入页面或运营姓名已变化');const existing=list.find(x=>receiptKey(x)===key);if(existing){if(!existing.assignmentReceipt||receiptContent(existing.assignmentReceipt)!==content)throw new Error('同一场次回执内容冲突，未覆盖原记录');return list;}return [item,...list];});
  if(current()){localSubmissions=saved;toast(item.late?'回执已导入本机（逾期提交，按主播设备时间判断），真实性仍需运营人工核对':'回执已导入本机，真实性仍需运营人工核对');operatorActiveTab='tracking';operatorHome();}
 }catch(e){if(current())toast('导入回执失败：'+String(e?.message||e));}
}
let assignmentPublishPending=false,assignmentJoinPending=false;
async function publishAssignment(){
 if(userRole!=='operator'||!userName||page!=='home')return;
 if(!syncMember()&&(memoryFallback||!localDB))return toast('本机数据库不可用，无法可靠发布作业，请保留Excel后重试');
 if(assignmentPublishPending)return toast('作业正在保存，请稍候');
 const ownerName=userName,ownerView=ELEM('view')?.firstElementChild,button=ELEM('publishAssignment'),preview=assignmentPreview;
 const activeView=()=>userRole==='operator'&&userName===ownerName&&page==='home'&&ELEM('view')?.firstElementChild===ownerView;
 const current=()=>activeView()&&preview===assignmentPreview&&assignmentViewCurrent(preview);
 const title=ELEM('assignmentTitle')?.value.trim(),boardId=ELEM('assignmentBoard')?.value,platform=ELEM('assignmentPlatform')?.value,deadline=ELEM('assignmentDeadline')?.value||'';
 if(!title)return toast('请输入作业名称');
 if(!preview||!assignmentViewCurrent(preview))return toast('请先上传Excel并完成预览，或确认草稿后发布');
 const end=deadline?new Date(deadline):null;
 if(end&&!Number.isFinite(end.getTime()))return toast('截止时间无效，请重新选择');
 if(end&&end.getTime()<=Date.now())return toast('截止时间需要晚于现在');
 const questionCopy=structuredClone(preview.questions);
 assignmentPublishPending=true;if(button)button.disabled=true;
 try{
  const item=pendingCloudAssignment?.preview===preview&&syncMember()
    ?pendingCloudAssignment.item
    :await makeAssignment({id:uid(),title,operatorName:ownerName,boardId,platform,deadline:end?end.toISOString():'',createdAt:nowIso(),assignedTo:[],questions:questionCopy});
  if(syncMember()){
   if(!current())throw new Error('发布条件已变化，请重新预览');
   pendingCloudAssignment={preview,item};
   const result=await assignmentSync.publish(item);
   if(result.assignment?.id!==item.id||!result.publishedAt)throw new Error('发布结果尚未确认，请重试');
   cloudAssignments=[result,...cloudAssignments.filter(x=>x.assignment.id!==item.id)];
   pendingCloudAssignment=null;
   if(activeView()){operatorActiveTab='tracking';operatorHome();toast('作业已发布到云端，团队主播可搜索领取');}
   return;
  }
  if(!current())throw new Error('发布人、文件或作业条件已变化，请重新预览后发布');
  const saved=await updatePrefList('assignments',list=>{if(!current())throw new Error('发布上下文已变化，作业未保存');return [item,...list.filter(x=>x.id!==item.id)];});
  if(!activeView())return;localAssignments=saved;
  toast('作业已保存到本机，跨设备请发送 JSON 作业包');operatorActiveTab='tracking';operatorHome();
 }catch(e){if(activeView())toast('作业未保存：'+(e?.message||e)+'。请重新核对后重试');}
 finally{assignmentPublishPending=false;if(button?.isConnected)button.disabled=false;}
}
async function joinAssignment(id){
 if(userRole!=='anchor'||!userName||page!=='home')return;
 if(assignmentJoinPending)return toast('正在加入作业，请稍候');
 const a=assignmentById(id);if(!a)return toast('作业不存在');
 if(!canSeeAssignment(a))return toast('此作业采用历史限定名单，当前主播姓名不匹配');
 const ownerName=userName,ownerView=ELEM('view')?.firstElementChild;
 const current=()=>userRole==='anchor'&&userName===ownerName&&page==='home'&&ELEM('view')?.firstElementChild===ownerView;
 const joined=assignmentJoined(a,ownerName);
 if(assignmentExpired(a)&&!joined)return toast('该作业已截止，不能再加入；可以先用「自由训练」练习');
 if(!pageAllowed('training')||!canLeaveRecording())return;
 assignmentJoinPending=true;
 try{
  if(syncMember()&&!joined){
   const result=await assignmentSync.claim(id);
   if(!result?.claimedAt)throw new Error('领取结果尚未确认');
   if(!current())return;
   cloudAssignments=cloudAssignments.map(row=>row.assignment.id===id?{...row,claimedAt:result.claimedAt}:row);
  }else if(!syncMember()&&!joined){
   const join={id:uid(),assignmentId:id,anchorName:ownerName,joinedAt:nowIso()};
   localAssignmentJoins=await updatePrefList('assignmentJoins',list=>list.some(x=>x.assignmentId===id&&x.anchorName===ownerName)?list:[join,...list]);
  }
  if(!current())return;
  if(assignmentExpired(a))toast('作业已过截止时间：仍可继续练习，提交后会标记为“逾期提交”');
  activeAssignmentId=id;selectedBoard=a.boardId;activePlatform=a.platform;openBoard(a.boardId,a.platform,{confirmed:true});
 }catch(e){if(current())toast('加入记录未保存：'+(e?.message||e)+'。请重试，或先选择自由练播');}
 finally{assignmentJoinPending=false;}
}
function renderAnchorLookup(query){const q=norm(query),target=ELEM('anchorLookupResult');if(!target)return;clearSubmittedPlayback();const names=[...new Set([...localTrainingLogs.map(x=>x.anchorName),...localSubmissions.map(x=>x.anchorName)])].filter(n=>!q||norm(n).includes(q));target.innerHTML=names.map(n=>`<button class="anchor-search-row" data-anchor-name="${ESC(n)}">${ESC(n)}</button>`).join('')||'<div class="empty compact">没有匹配主播</div>';target.querySelectorAll('[data-anchor-name]').forEach(b=>b.onclick=()=>showAnchorSummary(b.dataset.anchorName));}
function showAnchorSummary(name){if(userRole!=='operator'||!userName)return;clearSubmittedPlayback();const logs=localTrainingLogs.filter(x=>x.anchorName===name).sort((a,b)=>b.trainedAt.localeCompare(a.trainedAt));const subs=localSubmissions.filter(x=>x.anchorName===name&&x.operatorName===userName).sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt));const target=ELEM('anchorLookupResult');if(!target)return;const freeCount=logs.filter(l=>!l.assignmentId).length;target.innerHTML=`<div class="anchor-summary"><h3>${ESC(name)}</h3><p class="anchor-train-count">共训练 <b>${logs.length}</b> 次（自由训练 ${freeCount} 次 · 作业训练 ${logs.length-freeCount} 次）· 已提交给你 ${subs.length} 次</p><p class="muted">训练日志只显示是否训练、时间、板块和次数；未提交版本不显示分数和详细内容。</p>${logs.slice(0,12).map(l=>`<div class="log-row"><span>${ESC(new Date(l.trainedAt).toLocaleString('zh-CN'))}</span><b>${ESC(l.category)} · ${ESC(l.platform)}</b><span>${l.assignmentId?'作业训练':'自由训练'}</span></div>`).join('')||'<div class="empty compact">暂无训练日志</div>'}<h3>本机保存或手动导入的记录</h3>${subs.map(s=>`<details class="submission-card"><summary>${ESC(new Date(s.submittedAt).toLocaleString('zh-CN'))} · ${ESC(s.category)} · ${ESC(s.platform)} · ${s.turns.length}题${s.late?' · 逾期提交':''}</summary>${s.turns.map(t=>`<div class="submission-turn"><b>${ESC(t.prompt)}</b><p>${ESC(t.manualCleared?'已清空回答':t.answer||t.transcript||'无文字')}</p>${referenceDetailsHtml(t)}<small>响应：${t.responseSeconds??'—'}秒 · 回答：${t.durationSeconds??'—'}秒 · 要点：${ESC((t.pointsHit||[]).join('、')||'—')} · 状态：${ESC(t.asrStatus||'—')}</small>${(t.compliance||[]).map(c=>`<p>${ESC(c.category||'提示')}：${ESC(c.suggestion||c.matched||'')}</p>`).join('')}</div>`).join('')}<button type="button" class="btn soft" data-submitted-media="${ESC(s.id)}">查看本机回放</button><div id="submitted-media-${ESC(s.id)}"></div></details>`).join('')||'<div class="empty compact">暂无已提交记录</div>'}</div>`;;target.querySelectorAll('[data-submitted-media]').forEach(b=>b.onclick=()=>showSubmittedMedia(b.dataset.submittedMedia));}
function catalog(){
 setTitle('选择训练板块');
 const categories=[...new Set(BOARDS.map(x=>x.category))];
 const latest=localTrainingLogs.filter(x=>x.anchorName===userName).sort((a,b)=>String(b.trainedAt||'').localeCompare(String(a.trainedAt||'')))[0];
 const lastBoard=latest?BOARDS.find(x=>x.id===latest.boardId):null;
 const selected=lastBoard?.category||categories[0];
 ELEM('view').innerHTML=`${resumeReviewHtml()}<div class="r2-page-head"><h2>今天练哪个品类？</h2><p>点品类，再点平台，直接进入镜头预览。</p></div>
 <section class="hub-catalog panel"><h3 class="r2-step-title"><b>1</b>品类</h3><div class="r2-chips" id="categoryChips" role="group" aria-label="选择品类"></div><label for="categoryPick" class="hub-catalog-label r2-sr">选择品类</label><select id="categoryPick" class="hub-category-select r2-sr" tabindex="-1">${categories.map(c=>`<option value="${ESC(c)}" ${selected===c?'selected':''}>${ESC(c)}</option>`).join('')}</select><h3 class="r2-step-title"><b>2</b>平台</h3><div id="categoryBoards" class="hub-board-choices"></div></section>
 <details class="hub-fold"><summary><span><b>进阶话术学习</b><small>65 张历史话术卡 · 仅作学习参考</small></span><span class="fold-indicator">展开 ›</span></summary><div class="hub-fold-body"><p class="hub-task-tip">历史资料涉及价格、政策、型号等未审核内容，不作为直接直播或正式自动评分答案。</p><button class="btn dark" id="toLegacy">打开进阶学习</button></div></details>
 <p class="hub-footer-note">模拟弹幕不连接真实直播平台。当前仍为本机测试，不产生真实 AI 评分。</p>`;
 bindResumeReview();
 const box=ELEM('categoryBoards');
 const renderBoards=()=>{const list=BOARDS.filter(b=>b.category===ELEM('categoryPick').value);box.innerHTML=list.flatMap(b=>b.platforms.map(platform=>`<button class="hub-board-button" data-open-board="${ESC(b.id)}" data-platform="${ESC(platform)}"><span>${ESC(platform==='抖音生活服务'?'抖音生活服务':platform)} <small>${ESC(b.category)} · ${ESC(practicePoolLabel(b,platform))}</small></span><b>进入预览 ›</b></button>`)).join('');box.querySelectorAll('[data-open-board]').forEach(b=>b.onclick=()=>openBoard(b.dataset.openBoard,b.dataset.platform,{checkDevicesOnOpen:true}));};
 const chips=ELEM('categoryChips'),paintChips=()=>{chips.innerHTML=categories.map(c=>`<button type="button" class="r2-chip${ELEM('categoryPick').value===c?' selected':''}" aria-pressed="${ELEM('categoryPick').value===c}" data-cat="${ESC(c)}">${ESC(c)}</button>`).join('');chips.querySelectorAll('[data-cat]').forEach(x=>x.onclick=()=>{ELEM('categoryPick').value=x.dataset.cat;renderBoards();paintChips();});};
 ELEM('categoryPick').onchange=()=>{renderBoards();paintChips();};renderBoards();paintChips();
 ELEM('toLegacy').onclick=()=>nav('legacy');
}
let replacePracticeDialog=null;
function closeReplacePracticeDialog(){
 const overlay=replacePracticeDialog;if(!overlay)return;
 replacePracticeDialog=null;
 overlay.remove();
}
function confirmReplacePractice(onConfirm){
 if(replacePracticeDialog)return;
 const pending=!!(speechRecognizer||oneShotAsrJob||questionAsrQueue.length||recorderFinalizing||transcriptBusy||r6WhisperRunning||r6WhisperQueue.length);
 const recorded=!!sessionVideoBlob&&!sessionVideoDownloaded;
 const unsubmitted=reviewAlive()&&!reviewSubmission()&&reviewHasContent();
 const submitted=reviewAlive()&&!!reviewSubmission();
 const overlay=document.createElement('div');overlay.id='tclReplacePractice';overlay.className='practice-restart-overlay';
 overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-labelledby','tclRestartTitle');
 overlay.innerHTML=`<div class="practice-restart-card"><span class="eyebrow">NEW PRACTICE</span><h2 id="tclRestartTitle">准备开始新的一场练播？</h2><p>${submitted?'上一次提交记录将保留，新练播会独立记录。':unsubmitted?'上一场尚未提交的复盘会从当前页面清除。':'现在将打开新的一场练播。'}</p>${recorded?'<p class="practice-restart-warning">本场原始录像尚未下载，开始新练播会丢失当前页面里的录像。请先返回复盘下载。</p>':''}${pending?'<p class="practice-restart-warning">单题录音或识别还在处理，开始新练播会取消当前结果。</p>':''}<div class="practice-restart-actions"><button type="button" id="tclRestartCancel" class="btn soft">保留本场复盘</button><button type="button" id="tclRestartYes" class="btn primary">确认开始新练播</button></div></div>`;
 document.body.append(overlay);replacePracticeDialog=overlay;
 const cancel=()=>closeReplacePracticeDialog();
 overlay.querySelector('#tclRestartCancel').onclick=cancel;
 overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();cancel()}});
 overlay.querySelector('#tclRestartYes').onclick=()=>{closeReplacePracticeDialog();onConfirm()};
 overlay.querySelector('#tclRestartCancel').focus();
}
function openBoard(id,platform='',opts={}){
 const assigned=activeAssignmentId?assignmentById(activeAssignmentId):null;
 if(assigned&&!Object.prototype.hasOwnProperty.call(opts,'assignmentId')&&(assigned.boardId!==id||platform&&assigned.platform!==platform))return toast('当前为运营专属作业；如需更换板块，请先返回首页退出作业');
 if(!pageAllowed('training'))return toast('当前身份不能进入训练');
 if(capturePending||roomPhase==='live'||videoRecorderFinalizing||finishingSession)return toast('请先结束当前练播，等待录像封装后再重新开始');
 if(!opts.confirmed){
  if(reviewAlive()&&(page==='sessionReview'||reviewParked)||sessionVideoBlob&&!sessionVideoDownloaded){
   return confirmReplacePractice(()=>openBoard(id,platform,{...opts,confirmed:true}));
  }
  if(!canLeaveRecording())return;
 }
 const textOnly=deviceCheck.mode==='text';
 // A new attempt must never retain old runId, old review, stale capture or device state.
 resetRunState();deviceCheckSeq++;stopScene();captureSeq++;discardVideoArchive();exitFocus();closeReplacePracticeDialog();
 clearAnswerAudio();
 lastSessionSnapshot=null;lastTrainingLogId='';lastDeviceError='';
 if(Object.prototype.hasOwnProperty.call(opts,'assignmentId'))activeAssignmentId=opts.assignmentId;
 selectedBoard=id;activePlatform=platform&&boardById(id).platforms.includes(platform)?platform:boardById(id).platforms[0];
 roomPhase='check';deviceCheck={camera:false,microphone:false,recorder:false,ready:textOnly,mode:textOnly?'text':'hardware',checked:textOnly};page='training';render();
 if(textOnly)showReadyRoom();else if(opts.checkDevicesOnOpen===true)void checkDevices();
}
function quickSwitchBoard(id,platform='',opts={}){if(!BOARDS.some(b=>b.id===id)){if(ELEM('quickBoardSelect'))ELEM('quickBoardSelect').value=selectedBoard;return;}openBoard(id,platform,{checkDevicesOnOpen:opts.checkDevicesOnOpen===true});if(ELEM('quickBoardSelect'))ELEM('quickBoardSelect').value=selectedBoard;}
function categoryPlatformChoices(b){const same=BOARDS.filter(q=>q.category===b.category);const opts=[];for(const x of same){for(const p of x.platforms){opts.push({boardId:x.id,platform:p,selected:x.id===b.id&&p===activePlatform,label:p==='抖音生活服务'?'抖音':p});}}return opts;}
const cloudSubmissionNote='运营可查看已提交的回答和逐题录音。已开通 AI 评分的作业会自动出分。';
function trainingHome(){
const b=boardById(selectedBoard);
setTitle(`${b.category} · 视频预览`);
ELEM('view').innerHTML=`
<div class="intro-block slim-intro"><button class="ghost-btn" id="backBoard">← 换训练板块</button><h2>${ESC(b.category)} · 直播练习</h2><p class="muted">点「检测摄像头与麦克风」授权后显示真实预览；确认画面后开练。也可以选择仅文字练播。</p>${currentAssignment()?`<div class="assignment-banner">运营作业 · ${ESC(currentAssignment().title)} · 发布人 ${ESC(currentAssignment().operatorName)}</div>`:''}</div>
<details class="hub-training-switch"><summary>切换训练板块或平台（进阶）</summary><div class="quick-select"><label for="quickBoardSelect">更换训练</label><select id="quickBoardSelect" aria-label="选择16个专项训练板块">${BOARDS.map(x=>`<option value="${ESC(x.id)}" ${x.id===b.id?'selected':''}>${ESC(x.id)} · ${ESC(x.category)} · ${ESC(x.display_platform)}</option>`).join('')}</select><button type="button" id="showAllBoards" class="btn soft">全部16个板块 ▾</button></div>
<div class="board-quick-panel hidden" id="boardQuickPanel">${BOARDS.map(x=>`<button type="button" data-switch-board="${ESC(x.id)}">${ESC(x.id)} · ${ESC(x.category)} · ${ESC(x.display_platform)}</button>`).join('')}</div>
<div class="toolbar"><div class="segmented" id="platforms">${categoryPlatformChoices(b).map(x=>`<button data-board-p="${ESC(x.boardId)}" data-p="${ESC(x.platform)}" class="${x.selected?'selected':''}">${ESC(x.label)}</button>`).join('')}</div></div></details>
<p id="localSessionSaveStatus" class="scene-tip" role="status">已停止的单题录音会尝试保存到本机；录制中的片段尚不能恢复。</p><div class="live-layout danmu-layout room-flow">
  <div class="live-phone danmu-phone" id="livePhone" aria-label="竖屏模拟直播间">
    <div class="live-bg"></div><div class="camera-nine-sixteen" aria-label="9比16原始画面完整显示"><video class="live-video" muted autoplay playsinline webkit-playsinline id="liveCam"></video></div>
    <div class="room-placeholder" id="roomPlaceholder"><div class="room-icon">◎</div><strong id="roomPlaceholderTitle">正在准备摄像头</strong><p id="roomPlaceholderDesc">请允许浏览器使用摄像头和麦克风。本页只是模拟训练，不会向平台推流。</p></div>
    <div class="live-head"><div class="live-profile"><span class="live-avatar">T</span><span><strong>模拟训练直播间</strong><small>${ESC(b.category)} · ${ESC(activePlatform)}</small></span></div><span class="live-badge" id="liveStatus">● 开播前</span><span class="viewer" id="viewer">模拟观众 · 0</span></div>
    <span class="room-live-mark">训练模拟 · 非真实开播</span>
    <div class="barrage" id="barrage" role="log" aria-live="polite" aria-label="模拟观众弹幕"><div class="chat-line system"><strong>训练提示</strong><span>准备完成后，点击下方「开始练播」。</span></div></div>
    <div class="live-foot"><div class="chat-ghost">说点什么… <span>模拟弹幕</span></div><span class="danmu-bubble" aria-hidden="true">•••</span></div>
    <button class="prep-exit" id="prepExit" type="button" aria-label="返回训练板块">‹ 返回</button>
    <div class="pre-live-actions" id="preLiveActions"><span class="pre-live-label">${currentAssignment()?`运营作业：${ESC(currentAssignment().title)} · ${ESC(currentAssignment().operatorName)}`:'自由练播 · 摄像头画面仅自己可见'}</span><div class="pre-live-heading">${ESC(b.category)} · ${ESC(activePlatform)}</div><p class="prep-check-status" id="prepCheckStatus" role="status" aria-live="polite">请检查摄像头和麦克风…</p><div class="prep-recheck-actions"><button type="button" id="prepQuickRecheck" class="btn soft">↻ 重新检查设备</button><button type="button" id="prepQuickText" class="btn soft">仅文字练播</button></div><div data-vosk-widget="dark" aria-label="中文语音模型状态"></div><button class="btn primary pre-start-btn" id="startScene" type="button" disabled>准备中…</button><button class="prep-more-toggle" id="prepMore" type="button" aria-expanded="false" aria-controls="prepMoreSheet">${ICON.more}<span>换板块 · 弹幕间隔 · 设备</span></button><p class="prep-simulation-hint">模拟练播 · 单场最长 8 分钟 · ${usesParaformer?'录音结束或切题后转写 · 模型首次约 94 MB':'首次逐题转写需加载本机模型'}</p><p id="preLiveVoskTip" hidden>Vosk 可在「更多工具」手动准备，录后仍可补转写。</p><button id="preloadBeforeStart" hidden type="button">预下载模型</button><button id="preBack" hidden type="button">返回</button></div>
    <section class="phone-tools-sheet" id="prepMoreSheet" role="dialog" aria-modal="false" aria-label="开播前更多工具" hidden>
      <div class="phone-tools-heading"><h3>更多工具</h3><button type="button" id="prepMoreClose" class="tool-sheet-close" aria-label="关闭">×</button></div>
      <div class="phone-tools-group"><h4>训练内容</h4><div class="phone-tool-grid"><button type="button" id="prepChangeBoard">更换训练板块</button>${categoryPlatformChoices(b).map(x=>`<button type="button" data-prep-platform="${ESC(x.boardId)}" data-p="${ESC(x.platform)}" ${x.selected?'aria-current="true"':''}>${ESC(x.label)}</button>`).join('')}</div></div>
      <div class="phone-tools-group"><h4>弹幕设置</h4><label class="phone-tool-field">闲聊弹幕间隔<select id="prepBarrageInterval"><option value="30000">30 秒</option><option value="60000">1 分钟</option><option value="120000">2 分钟</option></select></label><small>该间隔控制闲聊和投诉；训练题由「下一条」手动切换。</small></div>
      <div class="phone-tools-group"><h4>设备与录制</h4><p id="prepDeviceStatus" class="phone-device-status">正在检查真实设备…</p><div class="phone-tool-grid"><button type="button" id="prepRecheck">重新检测设备</button><button type="button" id="prepTextOnly">仅文字练播</button><button type="button" id="prepPreloadVosk">准备中文识别模型</button></div><small>本机录像最多 8 分钟或约 64 MB，结束后请及时下载；录像提取音频限 3 分钟且不超过 48 MB。无法使用摄像头时可选择文字练播。</small></div>
    </section>
    <div class="r2-qcard" id="liveQuestionCard" hidden><div class="r2-qcard-top"><span id="liveQIndex">第 1 题</span><span id="liveQTimer" data-state="wait">等待回答 0:00</span></div><p id="liveQContext" class="muted" hidden></p><p id="liveQText"></p><p id="liveTurnStatus" class="r5-turn-status" role="status" aria-live="polite">准备录音</p><p id="liveSubmitNote" class="r5-turn-status" hidden>${cloudSubmissionNote}</p><button type="button" class="r3-question-expand" id="liveQExpand" aria-controls="liveQText" aria-expanded="false" hidden>查看完整问题 ↓</button></div><button class="focus-close" id="focusClose" type="button">结束直播</button><button class="focus-next" id="focusNext" type="button">下一条 ›</button><button class="focus-speak" id="focusSpeak" type="button" aria-label="朗读当前弹幕">🔊 朗读</button><button class="focus-review" id="focusReview" type="button" aria-expanded="false" aria-controls="liveMoreSheet" aria-label="更多练播工具">${ICON.more}<span>工具</span></button><button class="focus-mic" id="focusMic" type="button">● 回答录音</button><div class="text-answer-sheet" id="textAnswerSheet" hidden><label for="liveTextAnswer">文字回答这条弹幕</label><textarea id="liveTextAnswer" rows="3" maxlength="800" placeholder="像直播时一样，直接打字回答当前弹幕"></textarea><small id="liveTextSubmitNote" hidden>${cloudSubmissionNote}</small><div class="text-answer-actions"><button type="button" id="liveTextFinishSubmit" class="btn primary small" hidden>完成并提交</button><button type="button" id="liveTextSave" class="btn primary small">保存回答</button><button type="button" id="liveTextClose" class="btn soft small">收起</button></div></div>
    <section class="phone-tools-sheet" id="liveMoreSheet" role="dialog" aria-modal="false" aria-label="直播中更多工具" hidden><div class="phone-tools-heading"><h3>练播工具</h3><button type="button" id="liveMoreClose" class="tool-sheet-close" aria-label="关闭">×</button></div>
      <div class="phone-tools-group"><h4>回答辅助</h4><div class="phone-tool-grid"><button type="button" id="liveToolText">文字回答</button><button type="button" id="liveToolSpeak">朗读弹幕</button><button type="button" id="liveToolRecord">单题录音</button><button type="button" id="liveToolReference">参考要点</button></div><div class="phone-reference" id="liveReferenceBox" hidden></div></div>
      <div class="phone-tools-group"><h4>语音与弹幕</h4><div class="phone-tool-grid"><button type="button" id="liveToolRetry">本题补转写</button><button type="button" id="liveToolVosk">准备识别模型</button><button type="button" id="liveToolBrowserAsr">试用浏览器中文语音识别</button></div><div data-vosk-widget="card" aria-label="中文语音模型进度"></div><label class="phone-tool-field">闲聊弹幕间隔<select id="liveBarrageInterval"><option value="30000">30 秒</option><option value="60000">1 分钟</option><option value="120000">2 分钟</option></select></label><small>闲聊自动出现；训练题请点「下一条」。需要回放和导出，请在结束练播后打开复盘。</small></div>
    </section>
  </div>
  <div class="trainer danmu-trainer" id="trainingControls">
    <div class="panel compact-panel check-panel"><div class="train-headline"><h2>设备状态与高级设置</h2><span class="pill">${ESC(b.id)} / 16</span></div>
      <div class="progress-row"><span>直播平台 <b>${ESC(activePlatform)}</b></span><span>可练弹幕 <b id="questionCount">—</b></span></div>
      <details class="hub-device-details"><summary>查看摄像头、麦克风与浏览器检测详情</summary><div class="device-grid"><div id="cameraState" class="device-state">摄像头：未检查</div><div id="micState" class="device-state">麦克风：未检查</div><div id="recorderState" class="device-state">录音支持：未检查</div><div id="networkState" class="device-state">运行环境：未检查</div></div>
      <div id="cameraDetails" class="scene-tip">将按摄像头真实比例显示：接近 9:16 的竖屏画面铺满，其他比例完整显示；不允许浏览器裁切放大。</div></details><div id="checkSummary" class="scene-tip">正在自动检测设备；如浏览器要求，请允许摄像头和麦克风权限。</div><details class="hub-device-details"><summary>弹幕频率及高级设备操作</summary><div class="interval-setting"><label for="barrageInterval">自动弹幕间隔</label><select id="barrageInterval"><option value="30000">30 秒</option><option value="60000">1 分钟</option><option value="120000">2 分钟</option></select><small>按此间隔自动出现观众闲聊/投诉弹幕；回答完一题请点「下一条弹幕」换题。</small></div>
      <div class="toolbar"><button class="btn primary" id="runDeviceCheck">重新检测设备</button><button class="btn" id="cameraBtn">手动开关摄像头</button></div></details>
      <div class="toolbar"><button class="btn primary" id="enterPrep" disabled>设备就绪，下一步 →</button><button class="btn soft" id="textFallback">仅文字模拟练播</button></div>
      <p class="scene-tip" id="voskBeforeLive">${usesParaformer?'可在开播准备页提前加载 Paraformer（首次约 94 MB）。本题结束录音、切题或结束练播后转写。':'未就绪也可练播，原录音可在复盘中补转写。'}</p><p class="scene-tip">手机真实摄像头和麦克风通常需要 HTTPS 及用户授权；设备检测失败不会伪装成通过。仅文字模式会明确关闭录音功能。</p>
    </div>
    <div class="panel compact-panel learning-panel"><div class="q-meta"><span class="pill" id="questionStage">弹幕问题</span><span class="pill" id="questionSource">教学示例</span></div>
      <div class="training-question" id="currentQuestion">开始模拟直播后，训练弹幕会出现在直播画面中。</div><div class="scene-tip" id="trainingHint"></div>
      <div class="toolbar"><button class="btn dark" id="nextQuestion">下一条弹幕 →</button><button class="btn soft" id="speakQuestion">🔊 免费中文朗读</button><button class="btn soft" id="showReference">查看参考回答</button></div><div id="referenceBox" class="tintbox hidden"></div></div>
    <div class="panel compact-panel review-panel"><div class="train-headline"><h2>③ 回答与复盘</h2><button class="ghost-btn review-close" id="closeReview">返回直播画面 ×</button></div><p class="scene-tip">开播后自动开始整场音视频录制，单题录音用于回听；支持系统自带免费中文弹幕朗读（需手动触发，可能依赖系统语音包）。结束直播后可尝试从视频副本中识别文字。原录像不转码、不重排时间轴。</p>
      <div class="toolbar"><button class="btn primary" id="recordBtn">开始录音</button><button class="btn" id="recordStopBtn" disabled>结束录音</button></div>
      <div id="recordStatus" class="scene-tip">尚未录音</div><div id="turnStatus" class="scene-tip">等待本题</div><div id="turnHints" class="scene-tip">逐题合规及要点提示将在录后出现。</div><button class="btn soft" id="retryQuestionAsr" type="button">本题补转写</button><div id="audioHolder"></div>
      <div class="field" style="margin-top:12px"><label>我的回答（可编辑）</label><textarea id="answerText" rows="4" placeholder="说完后记录答案，对照参考话术复盘。"></textarea></div>
      <div class="toolbar"><button class="btn primary" id="submitAnswer">保存本次练习</button></div><div id="scoreBox"></div></div>
  </div>
<div class="panel after-live" id="sessionReview" aria-live="polite"><h2>逐题回答汇总</h2><p class="scene-tip">每道题自动单独录音，切换下一题或结束练播后自动识别并回填原题；首次需要下载中文模型，未就绪时音频仅暂存在本页。数字/型号不准确时，请在「我的回答」里纠正并保存；不会擅自把整场识别文字分给某题。</p><div id="questionSummary" aria-live="polite"></div><h2>整场录像与录后识别</h2><div id="sessionArchiveStatus" class="scene-tip">本机安全测试最多连续录制8分钟；已收集的录像分块达到64MB时停止。由于浏览器可能延迟派发大数据块，这不是硬性内存限制。结束后请立即下载原视频；30–60分钟录制需分段落盘后另行验收。</div><div id="sessionArchiveHolder"></div><div class="toolbar"><button id="transcribeVideoBtn" class="btn primary" disabled>从录像副本转文字（${asrModelLabel}）</button><button id="transcribeWhisperBtn" class="btn soft" disabled>备用 Vosk 识别</button><button id="preloadVoskBtn" class="btn soft" type="button">预下载/校验 Vosk 中文模型（48MB）</button><button id="downloadWavBtn" class="btn soft" disabled>导出独立音频 WAV</button></div><p class="scene-tip">本机录后转写及WAV提取只支持最长180秒且不超过48MB的录像。更长录像请先下载原文件，使用独立离线工具分段处理；模型首次需联网，不保证中国大陆可达。</p><div id="transcribeStatus" class="scene-tip"></div><div class="field"><label for="postTranscript">整场录后文字（可编辑，不自动作为评分）</label><textarea id="postTranscript" rows="5" placeholder="录制完成后点击识别；没有支持的模型时可手动整理文字"></textarea></div><button id="copyTranscriptToAnswer" class="btn soft" type="button">将文字复制到当前回答栏</button></div>
</div>`;
ELEM('backBoard').onclick=()=>{if(activeAssignmentId){activeAssignmentId='';nav('home')}else nav('catalog')};
ELEM('quickBoardSelect').onchange=e=>quickSwitchBoard(e.target.value,'',{checkDevicesOnOpen:true});
ELEM('showAllBoards').onclick=()=>{const panel=ELEM('boardQuickPanel');panel.classList.toggle('hidden');ELEM('showAllBoards').textContent=panel.classList.contains('hidden')?'全部16个板块 ▾':'收起板块 ▴';};
document.querySelectorAll('[data-switch-board]').forEach(el=>el.onclick=()=>quickSwitchBoard(el.dataset.switchBoard,'',{checkDevicesOnOpen:true}));
document.querySelectorAll('#platforms button').forEach(el=>el.onclick=()=>quickSwitchBoard(el.dataset.boardP,el.dataset.p,{checkDevicesOnOpen:true}));
ELEM('runDeviceCheck').onclick=()=>{if(roomPhase==='ready')returnToCheck();void checkDevices()};ELEM('prepQuickRecheck').onclick=()=>{if(roomPhase==='ready')returnToCheck();void checkDevices()};ELEM('prepQuickText').onclick=enableTextOnly;ELEM('enterPrep').onclick=showReadyRoom;ELEM('textFallback').onclick=enableTextOnly;
ELEM('startScene').onclick=startScene;ELEM('preloadBeforeStart').onclick=preparePracticeModel;ELEM('preBack').onclick=returnToCheck;ELEM('focusClose').onclick=requestFinishScene;
ELEM('prepExit').onclick=()=>{closeDrawer();nav('home')};
ELEM('prepMore').onclick=()=>togglePhoneSheet('prepMoreSheet','prepMore');ELEM('prepMoreClose').onclick=closeDrawer;
ELEM('prepChangeBoard').onclick=()=>{if(activeAssignmentId&&!window.confirm('更换板块将退出当前运营作业，改为自由训练，是否继续？'))return;closeDrawer();nav('catalog')};ELEM('prepRecheck').onclick=()=>{closeDrawer();if(roomPhase==='ready')returnToCheck();if(roomPhase!=='check')return;void checkDevices()};
ELEM('prepTextOnly').onclick=()=>{enableTextOnly();closeDrawer()};ELEM('prepPreloadVosk').onclick=preparePracticeModel;
document.querySelectorAll('[data-prep-platform]').forEach(btn=>{if(activeAssignmentId)btn.disabled=true;btn.onclick=()=>{if(activeAssignmentId)return toast('运营作业的训练板块和平台不可更换');const original=[...document.querySelectorAll('#platforms button')].find(x=>x.dataset.boardP===btn.dataset.prepPlatform&&x.dataset.p===btn.dataset.p);if(original)original.click()}});
ELEM('prepBarrageInterval').value=String(barrageIntervalMs);
ELEM('prepBarrageInterval').onchange=e=>{const base=ELEM('barrageInterval');base.value=e.target.value;base.dispatchEvent(new Event('change',{bubbles:true}))};
ELEM('focusReview').onclick=toggleLiveDrawer;ELEM('liveMoreClose').onclick=closeDrawer;
ELEM('liveToolText').onclick=()=>{closeDrawer();toggleTextAnswer(true)};
ELEM('liveToolSpeak').onclick=()=>{closeDrawer();speakCurrentQuestion()};
ELEM('liveToolRecord').onclick=()=>{closeDrawer();ELEM('focusMic').click()};
ELEM('liveToolReference').onclick=()=>{if(!activeTurn)return toast('请先等待一条弹幕');const box=ELEM('liveReferenceBox');box.innerHTML=referenceHtml(activeTurn);box.hidden=!box.hidden;};
ELEM('liveToolRetry').onclick=()=>{closeDrawer();if(activeTurn)void retryLocalQuestion(activeTurn.id);else toast('请先等待一条弹幕')};
ELEM('liveToolVosk').onclick=()=>preloadVoskModel();
 // iOS Safari may require a fresh user gesture after MediaRecorder stops asynchronously.
 // Phase 1: close and preserve current question audio; phase 2: start Web Speech on a new tap.
 let browserAsrHandoffBusy=false;
 ELEM('liveToolBrowserAsr').onclick=async()=>{
  const button=ELEM('liveToolBrowserAsr');
  if(browserAsrHandoffBusy)return toast('正在保存本题录音，请稍候');
  if(recorderPending)return toast('正在等待录音授权，请稍后重试');
  if(currentRecorder?.state==='recording'||recorderFinalizing){
   browserAsrHandoffBusy=true;
   const ownerRun=runId,ownerTurn=activeTurn?.id;
   if(button?.isConnected){button.disabled=true;button.textContent='正在保存本题录音…';}
   try{
    const saved=await finishQuestionCapture();
    if(!saved||recorderFailed||recorderPending||recorderFinalizing||currentRecorder?.state==='recording'){
     toast('本题录音未能确认保存，已取消浏览器识别；请重试录音或手动填写');
     return;
    }
    if(page!=='training'||roomPhase!=='live'||!liveStarted||runId!==ownerRun||activeTurn?.id!==ownerTurn){
     toast('题目或场次已切换，已取消本次语音识别');
     return;
    }
    if(button?.isConnected)button.textContent='② 开始浏览器中文识别';
    toast('本题录音已结束；请再点一次「开始浏览器中文识别」');
   }catch(error){toast('结束本题录音失败，未启动语音识别：'+(error?.message||'未知错误'));}
   finally{
    browserAsrHandoffBusy=false;
    if(button?.isConnected){button.disabled=false;if(button.textContent==='正在保存本题录音…')button.textContent='试用浏览器中文语音识别';}
   }
   return;
  }
  // Synchronous invocation from a new direct tap keeps activation where the browser requires it.
  if(button?.isConnected)button.textContent='试用浏览器中文语音识别';closeDrawer();browserAsr();
 };
ELEM('liveBarrageInterval').value=String(barrageIntervalMs);ELEM('liveBarrageInterval').onchange=e=>{const base=ELEM('barrageInterval');base.value=e.target.value;base.dispatchEvent(new Event('change',{bubbles:true}))};
ELEM('cameraBtn').onclick=toggleCamera;ELEM('recordBtn').onclick=()=>{if(questionTransition||finishingSession)return toast('正在整理本题录音，请稍候');void startRecord()};ELEM('recordStopBtn').onclick=()=>{if(questionTransition||finishingSession)return;stopRecord()};
let lastNextTap=-Infinity;const nextByTap=()=>{const now=performance.now();if(now-lastNextTap<700)return;lastNextTap=now;void advanceQuestion();};
ELEM('nextQuestion').onclick=nextByTap;ELEM('focusNext').onclick=nextByTap;ELEM('speakQuestion').onclick=speakCurrentQuestion;ELEM('focusSpeak').onclick=speakCurrentQuestion;ELEM('showReference').onclick=showReference;
ELEM('liveQExpand').onclick=()=>{const text=ELEM('liveQText'),btn=ELEM('liveQExpand'),expanded=btn.getAttribute('aria-expanded')!=='true';text.classList.toggle('r3-expanded',expanded);btn.setAttribute('aria-expanded',String(expanded));btn.textContent=expanded?'收起问题 ↑':'查看完整问题 ↓';if(expanded)text.setAttribute('tabindex','0');else text.removeAttribute('tabindex');};
const intervalSelect=ELEM('barrageInterval');if(intervalSelect){intervalSelect.value=String(barrageIntervalMs);intervalSelect.onchange=async()=>{barrageIntervalMs=Number(intervalSelect.value)||60000;for(const id of ['prepBarrageInterval','liveBarrageInterval'])if(ELEM(id))ELEM(id).value=String(barrageIntervalMs);await savePref('barrageIntervalMs',barrageIntervalMs);toast('自动弹幕间隔已设置为 '+(barrageIntervalMs/1000)+' 秒');if(roomPhase==='live')scheduleChatQuestion();};}
ELEM('answerText').oninput=()=>saveCurrentTypedAnswer({asDraft:true});ELEM('answerText').onchange=()=>saveCurrentTypedAnswer({asDraft:true});ELEM('submitAnswer').onclick=submitAnswer;ELEM('retryQuestionAsr').onclick=()=>activeTurn&&retryLocalQuestion(activeTurn.id);ELEM('closeReview').onclick=toggleLiveDrawer;
ELEM('focusMic').onclick=()=>{if(questionTransition||finishingSession)return toast('正在整理本题录音，请稍候');if(deviceCheck.mode==='text')return toggleTextAnswer();if(currentRecorder?.state==='recording')stopRecord();else void startRecord();};
ELEM('liveTextAnswer').oninput=syncTextAnswer;
ELEM('liveTextSave').onclick=()=>{confirmLiveTextAnswer();toggleTextAnswer(false);toast('已保存本题文字回答');};
ELEM('liveTextFinishSubmit').onclick=()=>{confirmLiveTextAnswer();void advanceQuestion();};
ELEM('liveTextClose').onclick=()=>toggleTextAnswer(false);
ELEM('questionCount').textContent=practicePoolLabel(b,activePlatform);
ELEM('transcribeVideoBtn').onclick=()=>transcribeSessionVideo();if(ELEM('transcribeWhisperBtn'))ELEM('transcribeWhisperBtn').onclick=()=>transcribeSessionVideo('vosk');if(ELEM('preloadVoskBtn'))ELEM('preloadVoskBtn').onclick=preloadVoskModel;ELEM('downloadWavBtn').onclick=downloadAudioCopy;
ELEM('copyTranscriptToAnswer').onclick=()=>{const v=ELEM('postTranscript').value.trim();if(!v)return toast('尚无可复制的录后文字');ELEM('answerText').value=v;saveCurrentTypedAnswer();toast('已复制到当前回答栏并存为本题草稿，请核对与本题的对应关系');};
renderSessionReview();renderQuestionSummary();
showPrepPreview();updateDeviceStates();
// Camera permission is requested only by the user tapping the visible device check button.
 if(page==='training'&&roomPhase==='check'&&!deviceCheck.checked){lastDeviceError='请点击「检测摄像头与麦克风」授权，或选择仅文字练播';updateDeviceStates();}
if(currentAssignment()){ELEM('quickBoardSelect').disabled=true;ELEM('showAllBoards').disabled=true;document.querySelectorAll('#platforms button').forEach(x=>x.disabled=true);ELEM('prepChangeBoard').textContent='退出当前作业并更换训练';}
}
function setDeviceState(id,ok,text){const el=ELEM(id);if(!el)return;el.textContent=text;el.classList.remove('pass','fail');if(ok===true)el.classList.add('pass');if(ok===false)el.classList.add('fail')}
function updateDeviceStates(){
 renderVoskWidgets();
const d=deviceCheck;const checking=d.mode==='hardware'&&d.pendingSeq===deviceCheckSeq;
if(ELEM('roomPlaceholder'))ELEM('roomPlaceholder').dataset.mode=d.mode;
if(ELEM('roomPlaceholderTitle'))ELEM('roomPlaceholderTitle').textContent=d.mode==='text'?'文字练播模式':(!d.camera&&lastDeviceError?'摄像头未就绪':'正在准备摄像头');
if(ELEM('roomPlaceholderDesc'))ELEM('roomPlaceholderDesc').textContent=d.mode==='text'?'不会录制音视频，可直接输入回答。':(!d.camera&&lastDeviceError?'请检查设备或权限，也可在更多工具中选择文字练播。':'请允许浏览器使用摄像头和麦克风。本页只是模拟训练，不会向平台推流。');
setDeviceState('cameraState',!d.checked||checking?null:d.camera,'摄像头：'+(!d.checked?'未检查':checking?'检测中…':d.camera?'正常，画面已预览':'未就绪'));
setDeviceState('micState',!d.checked||checking?null:d.microphone,'麦克风：'+(!d.checked?'未检查':checking?'检测中…':d.microphone?'访问正常':'未就绪'));
setDeviceState('recorderState',!d.checked?null:d.recorder,'录音支持：'+(!d.checked?'未检查':d.recorder?'可用':'不支持'));
setDeviceState('networkState',!d.checked?null:!!window.isSecureContext,'环境：'+(!d.checked?'未检查':window.isSecureContext?'安全上下文（可申请权限）':'非安全上下文（需 HTTPS）')+(navigator.onLine?' · 网络可用':' · 当前离线'));
if(ELEM('enterPrep'))ELEM('enterPrep').disabled=!d.ready;
if(ELEM('startScene')&&roomPhase!=='live'&&!capturePending){ELEM('startScene').disabled=!d.ready;ELEM('startScene').textContent=d.ready?'开始练播':checking?'正在检测设备…':d.checked?'设备未就绪':'请先检测设备';}
if(ELEM('prepQuickRecheck')){ELEM('prepQuickRecheck').disabled=checking||cameraBusy||roomPhase==='live';ELEM('prepQuickRecheck').textContent=d.ready?'↻ 重新检测设备':'↻ 检测摄像头与麦克风';}
 if(ELEM('prepQuickText'))ELEM('prepQuickText').hidden=roomPhase==='live'||d.mode==='text';
 if(ELEM('prepCheckStatus'))ELEM('prepCheckStatus').textContent=d.mode==='text'?'⌨ 文字练播已就绪（不录音录像）':d.ready?'✓ 摄像头和麦克风已就绪':checking?'正在检查摄像头和麦克风…':d.checked?'⚠ 设备未就绪，请点击「检测摄像头与麦克风」重试，或选仅文字练播':'请点击「检测摄像头与麦克风」';
if(ELEM('prepDeviceStatus'))ELEM('prepDeviceStatus').textContent=d.mode==='text'?'文字模拟已就绪，不使用摄像头和录音':d.ready?'摄像头、麦克风、录制能力已确认':'尚未就绪'+(lastDeviceError?'：'+lastDeviceError:'；请允许权限后重试');
if(ELEM('checkSummary'))ELEM('checkSummary').textContent=d.mode==='text'?'文字模拟模式已启用：视频和录音均不会使用。':checking?'正在检测设备，请处理浏览器的摄像头和麦克风授权；也可选择仅文字练播。':d.ready?'设备检查已通过。现在进入开播准备，确认画面后点击「开始直播」。':d.checked?'设备未全部通过。可修复后重试，或选择明确标识的「仅文字模拟练播」。'+(lastDeviceError?' 原因：'+lastDeviceError:''):'请点击画面里的「检测摄像头与麦克风」，允许授权后进入预览，或选择「仅文字练播」。';
for(const id of ['runDeviceCheck','prepRecheck','cameraBtn']){const button=ELEM(id);if(button)button.disabled=checking||cameraBusy||roomPhase==='live';}
if(ELEM('runDeviceCheck'))ELEM('runDeviceCheck').textContent=checking?'正在检测设备…':'重新检查设备';
if(ELEM('recordBtn'))ELEM('recordBtn').disabled=d.mode==='text'||roomPhase!=='live';
}
function deviceCheckPending(){return deviceCheck.mode==='hardware'&&deviceCheck.pendingSeq===deviceCheckSeq;}
function stopDeviceTracks(stream){for(const track of stream?.getTracks?.()||[]){try{track.stop()}catch{}}}
async function checkDevices(){
 if(page!=='training'||roomPhase!=='check'||deviceCheckPending()||cameraBusy)return;
 const seq=++deviceCheckSeq,owner=ELEM('livePhone'),board=selectedBoard,platform=activePlatform;
 const attempt={camera:false,microphone:false,recorder:false,ready:false,mode:'hardware',checked:true,pendingSeq:seq};
 deviceCheck=attempt;lastDeviceError='';
 const current=()=>seq===deviceCheckSeq&&deviceCheck===attempt&&attempt.mode==='hardware'&&page==='training'&&roomPhase==='check'&&selectedBoard===board&&activePlatform===platform&&ELEM('livePhone')===owner;
 let acquiredCamera=null,audio=null,completed=false;
 const releaseOwnedCamera=()=>{if(acquiredCamera&&camStream===acquiredCamera){stopDeviceTracks(acquiredCamera);camStream=null;const v=ELEM('liveCam');if(v?.srcObject===acquiredCamera){v.srcObject=null;v.style.display='none';}}};
 attempt.recorder=!!(window.MediaRecorder&&navigator.mediaDevices?.getUserMedia);updateDeviceStates();
 try{
  if(!navigator.mediaDevices?.getUserMedia){lastDeviceError='浏览器缺少媒体设备 API，需 HTTPS 或新版 Safari / Chrome';}
  else{
   try{
    if(!current())return;
    if(!camStream||camStream.getVideoTracks().every(t=>t.readyState!=='live')){
     const acquired=await acquireCamera(current);
     if(!current()){stopDeviceTracks(acquired);return;}
     if(camStream&&camStream!==acquired)stopDeviceTracks(camStream);
     camStream=acquired;acquiredCamera=acquired;bindCameraEnded(acquired);
    }
    await attachCamera(camStream,current);
    if(!current())return;
    const ph=ELEM('roomPlaceholder');if(ph)ph.style.display='none';
    attempt.camera=!!camStream?.getVideoTracks().some(t=>t.readyState==='live');updateCameraInfo();
    if(ELEM('cameraBtn'))ELEM('cameraBtn').textContent='关闭摄像头';
   }catch(e){if(!current())return;lastDeviceError='摄像头：'+(e.message||e.name);attempt.camera=false;}
   // A cancelled camera permission request must not start a new microphone request.
   if(!current())return;
   try{
    audio=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
    const hasAudio=audio.getAudioTracks().some(t=>t.readyState==='live');
    stopDeviceTracks(audio);audio=null;
    if(!current())return;
    attempt.microphone=hasAudio;
    if(!hasAudio)lastDeviceError+=(lastDeviceError?'；':'')+'麦克风：没有可用音轨';
   }catch(e){if(!current())return;lastDeviceError+=(lastDeviceError?'；':'')+'麦克风：'+(e.message||e.name);attempt.microphone=false;}
  }
  if(!current())return;
  delete attempt.pendingSeq;
  attempt.ready=!!(attempt.camera&&attempt.microphone&&attempt.recorder&&window.isSecureContext);
  if(!attempt.ready&&!attempt.camera&&camStream){stopDeviceTracks(camStream);camStream=null;const v=ELEM('liveCam');if(v){v.srcObject=null;v.style.display='none';}const ph=ELEM('roomPlaceholder');if(ph)ph.style.display='block';if(ELEM('cameraBtn'))ELEM('cameraBtn').textContent='打开摄像头';}
  completed=true;updateDeviceStates();
  if(attempt.ready){showReadyRoom();toast('设备已就绪，可以开始练播');}else toast('设备尚未就绪，请点击「检测摄像头与麦克风」重试，或选仅文字练播');
 }finally{
  stopDeviceTracks(audio);
  if(!completed&&!current())releaseOwnedCamera();
  if(deviceCheck===attempt&&seq===deviceCheckSeq){delete attempt.pendingSeq;if(!completed)attempt.ready=false;updateDeviceStates();}
 }
}
// V3.3.7 摄像头稳定性：不允许浏览器为凑 9:16 而裁切放大；按真实画面比例选择显示方式；画面尺寸变化时自动重新适配。
const CAMERA_BASE={facingMode:'user',resizeMode:'none',frameRate:{ideal:30,max:30}};
const CAMERA_PORTRAIT={...CAMERA_BASE,width:{ideal:720},height:{ideal:1280}};
const CAMERA_LANDSCAPE={...CAMERA_BASE,width:{ideal:1280},height:{ideal:720}};
const CAMERA_FILL_TOLERANCE=0.12;
const screenIsPortrait=()=>window.innerHeight>=window.innerWidth;
function cameraDims(stream){const v=ELEM('liveCam');let w=0,h=0;if(v&&v.srcObject===stream){w=v.videoWidth||0;h=v.videoHeight||0;}if(!(w&&h)){const st=stream?.getVideoTracks?.()[0]?.getSettings?.()||{};w=st.width||0;h=st.height||0;}return {w,h};}
function trackDims(stream){const st=stream?.getVideoTracks?.()[0]?.getSettings?.()||{};return {w:st.width||0,h:st.height||0,resizeMode:st.resizeMode};}
const cameraLog=[];function camLog(m){cameraLog.push(Math.round(performance.now())+'ms '+m);if(cameraLog.length>40)cameraLog.shift();}window.__cameraLog=cameraLog;
let cameraFitWatch=null;
function stopCameraFitWatch(){if(cameraFitWatch!==null){clearInterval(cameraFitWatch);cameraFitWatch=null;}}
function startCameraFitWatch(){if(cameraFitWatch!==null)return;cameraFitWatch=setInterval(()=>{const v=ELEM('liveCam');if(!camStream||!v||v.srcObject!==camStream||!camStream.getVideoTracks().some(t=>t.readyState==='live')){stopCameraFitWatch();return;}const key=v.videoWidth+'x'+v.videoHeight;if(key!==v.__fitKey){camLog('watch '+key);applyCameraFit();}},500);}
function waitTrackAgreement(v,stream,ms){return new Promise(res=>{const t0=Date.now();(function tick(){const t=trackDims(stream);const agree=!(t.w&&t.h)||(v.videoWidth&&v.videoHeight&&(v.videoWidth>v.videoHeight)===(t.w>t.h));if(agree||Date.now()-t0>=ms)return res(agree);setTimeout(tick,100);})();});}
function cameraFitMode(w,h){if(!(w&&h))return 'pending';if(h<=w)return 'landscape';const target=9/16;return Math.abs(w/h-target)/target<=CAMERA_FILL_TOLERANCE?'fill':'portrait-fit';}
async function acquireCamera(isCurrent){
 try{return await navigator.mediaDevices.getUserMedia({video:CAMERA_PORTRAIT,audio:false});}
 catch(e){
  // A cancelled request must not issue a second permission request with fallback constraints.
  if(!isCurrent()||['NotAllowedError','SecurityError','NotFoundError','NotReadableError','AbortError'].includes(e?.name))throw e;
  return navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});
 }
}
function waitVideoFrame(v,ms,needResize){return new Promise(res=>{if(!needResize&&v.videoWidth&&v.videoHeight)return res(true);let t=null;const done=()=>{clearTimeout(t);v.removeEventListener('loadedmetadata',done);v.removeEventListener('resize',done);res(!!(v.videoWidth&&v.videoHeight));};t=setTimeout(done,ms);v.addEventListener('loadedmetadata',done);v.addEventListener('resize',done);});}
function applyCameraFit(){
 const v=ELEM('liveCam');const box=v?.closest('.camera-nine-sixteen');if(!v||!box)return;
 const mode=camStream&&v.srcObject===camStream?cameraFitMode(...Object.values(cameraDims(camStream))):'pending';
 v.__fitKey=v.videoWidth+'x'+v.videoHeight;
 if(box.dataset.fit!==mode){box.dataset.fit=mode;camLog('fit '+mode+' '+v.__fitKey);}
 updateCameraInfo();
}
async function attachCamera(stream,isCurrent){
 const v=ELEM('liveCam');if(!v||!stream)return false;
 if(!v.__fitBound){v.__fitBound=true;v.addEventListener('resize',applyCameraFit);v.addEventListener('loadedmetadata',applyCameraFit);}
 if(v.srcObject!==stream)v.srcObject=stream;
 v.style.display='block';v.play().catch(()=>{});
 await waitVideoFrame(v,2000,false);
 if(!isCurrent()||camStream!==stream)return false;
 let {w,h}=cameraDims(stream);const track=stream.getVideoTracks()[0];
 if(w>h&&screenIsPortrait()&&track?.applyConstraints&&!stream.__orientationRetried){
  // 部分设备按传感器方向理解宽高：在同一条轨道上换一次方向请求，不重复打开摄像头。
  // V3.3.8：是否成功以轨道实际输出（getSettings）为准；视频元素的 videoWidth 可能晚于轨道刷新，不能据此撤销。
  stream.__orientationRetried=true;camLog('orientation retry from '+w+'x'+h);
  try{await track.applyConstraints(CAMERA_LANDSCAPE);camLog('applyConstraints done');}catch(e){camLog('applyConstraints failed '+(e?.name||e));}
  if(!isCurrent()||camStream!==stream)return false;
  let t=trackDims(stream);
  if(!(t.w&&t.h)){await waitVideoFrame(v,1500,true);if(!isCurrent()||camStream!==stream)return false;const d=cameraDims(stream);t={w:d.w,h:d.h,resizeMode:t.resizeMode};}
  const corrected=t.h>t.w&&t.resizeMode!=='crop-and-scale';
  camLog('track after retry '+t.w+'x'+t.h+' resizeMode='+(t.resizeMode||'未报告')+' corrected='+corrected);
  if(corrected){await waitTrackAgreement(v,stream,3000);if(!isCurrent()||camStream!==stream)return false;}
  else{try{await track.applyConstraints(CAMERA_PORTRAIT);camLog('reverted to portrait request');}catch{}}
 }
 applyCameraFit();startCameraFitWatch();return true;
}
function updateCameraInfo(){const el=ELEM('cameraDetails');if(!el)return;const track=camStream?.getVideoTracks?.()[0];if(!track){el.textContent='将按摄像头真实比例显示：接近 9:16 的竖屏画面铺满，其他比例完整显示；已请求浏览器不裁切缩放（是否生效以设备为准）。';return;}const t=trackDims(camStream);const {w,h}=cameraDims(camStream);if(!(w&&h)){el.textContent='正在读取摄像头实际画面尺寸…';return;}const mode=cameraFitMode(w,h);const tip=mode==='fill'?'竖屏画面铺满（比例接近 9:16，边缘最多裁掉约 12%）':mode==='portrait-fit'?'竖屏画面完整显示（比例与 9:16 相差较大，上下或左右留边，不裁切）':'横屏画面完整显示（不裁切、不放大）。请竖持手机；若已竖持仍为横屏，请关闭系统横屏旋转后点「重新检查设备」';const rm=t.resizeMode==='crop-and-scale'?'crop-and-scale（注意：浏览器报告已裁切缩放）':t.resizeMode||'浏览器未报告（无法确认是否裁切）';el.textContent=`摄像头实际 ${w}×${h}（${h>w?'竖屏':'横屏'}）· ${tip}。诊断：轨道 ${t.w||'?'}×${t.h||'?'} · 画面 ${w}×${h} · 裁切模式 ${rm} · 屏幕${screenIsPortrait()?'竖持':'横持'}。预览为镜像（像照镜子），录像保存摄像头原始方向。`;}
function enableTextOnly(){if(roomPhase!=='check'&&roomPhase!=='ready')return;if(roomPhase==='ready')returnToCheck();deviceCheckSeq++;stopCameraFitWatch();if(camStream){camStream.getTracks().forEach(t=>t.stop());camStream=null}const v=ELEM('liveCam');if(v){v.srcObject=null;v.style.display='none'}applyCameraFit();const ph=ELEM('roomPlaceholder');if(ph)ph.style.display='block';deviceCheck={camera:false,microphone:false,recorder:false,ready:true,mode:'text',checked:true};updateDeviceStates();showReadyRoom();toast('已切换为仅文字模拟；录音、摄像头不可用');}
function showReadyRoom(){
if(!deviceCheck.ready)return toast('请先通过设备检查，或明确选择文字模拟模式');
if(deviceCheck.mode!=='text'&&(!camStream||!camStream.getVideoTracks().some(t=>t.readyState==='live'))){deviceCheck.ready=false;deviceCheck.camera=false;lastDeviceError='摄像头已断开，请重新检查';updateDeviceStates();return toast('摄像头已断开，请重新检查设备');}
if(!(currentAssignment()?.schema?currentAssignment().questions:practiceEntriesFor(boardById(selectedBoard),activePlatform)).length)return toast('本板块尚无训练问题，无法开始');
roomPhase='ready';ELEM('liveStatus').textContent='● 准备开播';if(ELEM('preLiveVoskTip'))ELEM('preLiveVoskTip').textContent=voskModel?'✓ Vosk中文模型已就绪':'Vosk 未就绪，建议在Wi-Fi下先预下载约48MB（不强制）。';
const phone=ELEM('livePhone');phone.classList.add('is-preparing');document.body.classList.add('focus-open','room-preparing');
ELEM('preLiveActions').style.display='flex';updateDeviceStates();
}
function returnToCheck(){captureSeq++;capturePending=false;roomPhase='check';const sb=ELEM('startScene');if(sb){sb.disabled=true;sb.textContent='开始练播';}showPrepPreview();updateDeviceStates();}
function enterFocus(){const phone=ELEM('livePhone');if(!phone)return;phone.classList.remove('is-preparing');phone.classList.add('is-focused');document.body.classList.remove('room-preparing');document.body.classList.add('focus-open','room-live')}
function exitFocus(){const phone=ELEM('livePhone');if(phone)phone.classList.remove('is-focused','is-preparing');document.body.classList.remove('focus-open','room-live','room-preparing');closeDrawer();}
function toggleLiveDrawer(){if(roomPhase!=='live')return;togglePhoneSheet('liveMoreSheet','focusReview')}
let endConfirmDialog=null;
function closeEndConfirmDialog(){
 const dlg=endConfirmDialog;
 if(!dlg)return;
 endConfirmDialog=null;
 try{if(dlg.open)dlg.close()}catch{}
 dlg.remove();
}
function requestFinishScene(){
 if(page!=='training'||roomPhase!=='live'||finishingSession||endConfirmDialog)return;
 const dlg=document.createElement('dialog');
 if(typeof dlg.showModal!=='function'){
  if(window.confirm('结束本场练播并进入复盘？结束后不能继续这一场。'))void finishScene();
  return;
 }
 dlg.id='tclEndConfirm';dlg.setAttribute('aria-labelledby','tclEndConfirmTitle');
 dlg.setAttribute('aria-describedby','tclEndConfirmDesc');
 dlg.style.cssText='box-sizing:border-box;width:min(92vw,390px);max-width:390px;max-height:min(86dvh,640px);border:1px solid #e5e9f0;border-radius:22px;padding:24px;color:#192b43;background:#fff;box-shadow:0 24px 90px rgba(3,18,38,.35);font-family:system-ui,-apple-system,\"PingFang SC\",sans-serif;';
 dlg.innerHTML=`<style>#tclEndConfirm::backdrop{background:rgba(7,15,30,.72)}#tclEndConfirm button{font:inherit;cursor:pointer;min-height:48px;border-radius:12px;padding:12px;font-weight:750;touch-action:manipulation}#tclEndConfirm .end-confirm-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:24px}#tclEndConfirm h2{margin:0 0 11px;font-size:22px;color:#14243b;line-height:1.35}#tclEndConfirm p{margin:0;color:#53667e;font-size:14px;line-height:1.75}#tclEndConfirm #tclEndCancel{background:#f2f5f9;border:1px solid #dce4ed;color:#30445d}#tclEndConfirm #tclEndYes{background:#d92d4e;border:1px solid #d92d4e;color:#fff}@media(max-width:340px){#tclEndConfirm .end-confirm-actions{grid-template-columns:1fr}}</style><h2 id="tclEndConfirmTitle">确认结束本场练播？</h2><p id="tclEndConfirmDesc">结束后将进入复盘，不能继续当前这场练播。录像与逐题录音可能需要时间整理；如果保存失败，会在复盘中提示。</p><div class="end-confirm-actions"><button type="button" id="tclEndCancel">继续练播</button><button type="button" id="tclEndYes">结束并进入复盘</button></div>`;
 document.body.append(dlg);endConfirmDialog=dlg;
 dlg.addEventListener('cancel',e=>{e.preventDefault();closeEndConfirmDialog()});
 dlg.querySelector('#tclEndCancel').onclick=closeEndConfirmDialog;
 dlg.querySelector('#tclEndYes').onclick=()=>{closeEndConfirmDialog();void finishScene()};
 try{dlg.showModal();dlg.querySelector('#tclEndCancel').focus()}
 catch(e){closeEndConfirmDialog();console.warn('Native dialog unavailable, falling back to confirm',e);if(window.confirm('结束本场练播并进入复盘？'))void finishScene()}
}

async function finishScene(){
 if(page!=='training'||roomPhase!=='live'||finishingSession)return;
 finishingSession=true;if(typeof closeEndConfirmDialog==='function')closeEndConfirmDialog();const finishingRun=runId;
 try{
  const liveBadge=ELEM('liveStatus');if(liveBadge)liveBadge.textContent='● 正在结束直播…';
  const finishStatus=ELEM('recordStatus');if(finishStatus)finishStatus.textContent='正在整理最后一题录音，完成后进入复盘…';
  const captureOk=await finishQuestionCapture();
  if(runId!==finishingRun||page!=='training'||roomPhase!=='live')return;
  if(!captureOk&&activeTurn){activeTurn.asrStatus='本题录音封装未完成，请检查复盘中的状态';renderTurnStatus(activeTurn);}
  saveCurrentTypedAnswer();
  const endedAt=Date.now(),startedAt=sessionStartedAt||endedAt,elapsedMs=sessionStartedAt?Math.max(0,performance.now()-sessionStartedMono):0;
  const b=boardById(selectedBoard),assignment=currentAssignment(),ownerRun=runId,ownerName=userName;
  lastSessionSnapshot={id:runId||uid(),anchorName:userName||'未登录主播',boardId:selectedBoard,category:b.category,platform:activePlatform,assignmentId:activeAssignmentId||'',operatorName:assignment?.operatorName||'',assignmentTitle:assignment?.title||'',...(sessionAssignmentSnapshot?.schema?{assignmentSnapshotSha256:sessionAssignmentSnapshot.snapshotSha256,assignmentVersion:sessionAssignmentSnapshot.version,assignmentSnapshot:structuredClone(sessionAssignmentSnapshot)}:{}),startedAt:new Date(startedAt).toISOString(),endedAt:new Date(endedAt).toISOString(),durationSeconds:Math.round(elapsedMs/1000),turns:sessionTurns};
  // Enter review BEFORE waiting for IndexedDB: a stuck transaction must never trap the user in the live view.
  stopScene({finishSpeech:true});exitFocus();roomPhase='check';
  const log={id:uid(),anchorName:lastSessionSnapshot.anchorName,assignmentId:lastSessionSnapshot.assignmentId,boardId:selectedBoard,category:b.category,platform:activePlatform,trainedAt:nowIso(),submitted:false};
  lastTrainingLogId=log.id;
  void persistSessionCheckpoint();
  if(page==='training'&&runId===ownerRun&&userRole==='anchor'&&userName===ownerName&&lastSessionSnapshot?.id===ownerRun){
   if(deviceCheck.mode!=='text'){deviceCheck={camera:false,microphone:false,recorder:false,ready:false,mode:'hardware',checked:false};lastDeviceError='';}
   reviewParked=false;reviewStage='overview';page='sessionReview';render();
   void drainQuestionAsrQueue();window.scrollTo({top:0,behavior:'instant'});
   toast(sessionStopReason?sessionStopReason+'。已进入本场复盘。':'直播已结束，已进入本场复盘。');
  }
  try{
   // Saving is best-effort, bounded and never used as proof of persistence before transaction completion.
   localTrainingLogs=await awaitFinishLogSave(updatePrefList('trainingLogs',list=>[log,...list.filter(x=>x.id!==log.id)],{transactionTimeoutMs:finishLogTimeoutMs()-5}));
  }catch(e){
   if(!localTrainingLogs.some(x=>x.id===log.id))localTrainingLogs.unshift(log);
   toast('训练日志持久化尚未确认：'+(e?.message||e)+'。本页复盘可以继续使用，但刷新后记录可能丢失，请先下载录像。');
   return;
  }
  if(captureOk&&lastSessionSnapshot?.id===ownerRun)return lastSessionSnapshot;
 }catch(e){
  console.error('finishScene failed',e);
  // Do not leave the app stuck in a permanently locked "finishing" state on unexpected exceptions.
   if(runId===finishingRun){
    if(page==='training')try{stopScene({finishSpeech:true});exitFocus();roomPhase='check';}catch(err){console.error('finishScene recovery failed',err);}
    if(lastSessionSnapshot?.id===finishingRun){
     try{reviewParked=false;reviewStage='overview';page='sessionReview';render();}
     catch(err){
      console.error('finishScene review recovery failed',err);
      // A broken review render must not leave the only usable navigation locked.
      page='home';reviewParked=true;
      try{render()}catch(homeError){console.error('finishScene home fallback failed',homeError);}
     }
    }
   }
   toast('结束直播遇到异常：'+(e?.message||e)+'。已解除结束锁定；如可进入复盘请先下载录像，切勿直接刷新。');
 }finally{finishingSession=false;}
}
const finishLogTimeoutMs=()=>Math.min(10000,Math.max(25,Number(window.__FINISH_SAVE_TIMEOUT_MS)||5000));
async function awaitFinishLogSave(job){
  const ms=finishLogTimeoutMs();
 let timer;
 try{return await Promise.race([Promise.resolve(job),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('训练日志事务等待超时')),ms)})]);}
 finally{clearTimeout(timer);}
}
function updateSpeechUI(){for(const id of ['focusSpeak','speakQuestion']){const el=ELEM(id);if(el)el.textContent=ttsSpeaking?'■ 停止朗读':'🔊 朗读弹幕';}}
function cancelTTS(){ttsToken++;ttsSpeaking=false;try{window.speechSynthesis?.cancel()}catch{}updateSpeechUI()}
function speakCurrentQuestion(){
 const text=activeTurn?.prompt||questions[activeQuestionIndex]?.question;
 if(!liveStarted||!text)return toast('请先进入模拟直播间选择一条弹幕');
 if(ttsSpeaking){cancelTTS();return;}
 if(currentRecorder?.state==='recording'||recorderPending||recorderFinalizing||speechRecognizer)return toast('录音或语音识别时不能播放朗读，避免朗读声混入录音');
 if(!window.speechSynthesis||!window.SpeechSynthesisUtterance)return toast('当前浏览器不支持原生中文语音朗读');
 cancelTTS();const ticket=ttsToken;
 try{const u=new window.SpeechSynthesisUtterance(text);u.lang='zh-CN';u.rate=1.04;u.volume=0.9;
 const voice=window.speechSynthesis.getVoices?.().find(v=>/^zh(?:-|_)/i.test(v.lang||''));if(voice)u.voice=voice;
 u.onend=()=>{if(ticket===ttsToken){ttsSpeaking=false;updateSpeechUI()}};
 u.onerror=()=>{if(ticket===ttsToken){ttsSpeaking=false;updateSpeechUI();toast('系统朗读失败：请检查中文语音包和静音设置')}};
 ttsSpeaking=true;updateSpeechUI();window.speechSynthesis.speak(u);
 }catch(e){cancelTTS();toast('朗读启动失败：'+(e.message||e))}
}

function cancelChatTimer(){
 clearTimeout(chatTimer);clearInterval(chatTimer);chatTimer=null;chatQuestionSeq++;
 for(const timer of chatExtraTimers)clearTimeout(timer);chatExtraTimers=[];
}
function scheduleChatQuestion(){
 cancelChatTimer();const ticket=chatQuestionSeq,turnId=activeTurn?.id;
 const emit=()=>{
  if(ticket!==chatQuestionSeq||activeTurn?.id!==turnId||!liveStarted||roomPhase!=='live')return;
  if(document.hidden){chatTimer=setTimeout(emit,2500);return;}
  const b=boardById(selectedBoard),count=Math.random()<0.3?2+Math.floor(Math.random()*2):1;
  for(let i=0;i<count;i++){
   const t=pickDanmu(b,activePlatform,Math.random()<0.125?'complaint':'chatter');
   const timer=setTimeout(()=>{
    if(ticket===chatQuestionSeq&&liveStarted&&activeTurn?.id===turnId)addChat(viewerNick(),t.text,t.priority?'urgent':t.needsAnswer?'chat':'chatter');
   },i*150);
   chatExtraTimers.push(timer);
  }
  ELEM('viewer').textContent='模拟观众 · '+(120+Math.floor(Math.random()*110));
  chatTimer=setTimeout(emit,Math.max(30000,barrageIntervalMs));
 };
 chatTimer=setTimeout(emit,Math.min(5000,Math.max(2500,Math.round(barrageIntervalMs/6))));
}
function addChat(name,text,type='chat'){
 const list=ELEM('barrage');if(!list)return;
 const item=document.createElement('div');item.className='chat-line '+(type==='system'?'system':type==='urgent'?'urgent':type==='chatter'?'chatter':'');
 const nameEl=document.createElement('strong');nameEl.textContent=name;
 const txt=document.createElement('span');txt.textContent=text;
 item.append(nameEl,txt);
 if(type==='urgent'){const mark=document.createElement('em');mark.textContent='优先处理';item.append(mark)}
 if(type==='chatter'){const mark=document.createElement('small');mark.textContent='无需单独回答';item.append(mark)}
 list.append(item);while(list.children.length>7)list.firstChild.remove();
}
async function startScene(){
 if(roomPhase!=='ready'||capturePending)return toast('请先完成设备检查，然后点击开始直播');
 if(videoRecorderFinalizing)return toast('上一场录像尚在封装，请保存完成后再开播');
 if(sessionVideoBlob&&!sessionVideoDownloaded&&!window.confirm('上一场原视频还未下载。再次开播将覆盖本页录像，确定继续吗？'))return;
 if(deviceCheck.mode!=='text'&&(!camStream||!camStream.getVideoTracks().some(t=>t.readyState==='live'))){returnToCheck();deviceCheck.ready=false;deviceCheck.camera=false;lastDeviceError='摄像头预览已中断';updateDeviceStates();return toast('摄像头已中断，请重新检查设备')}
 const b=boardById(selectedBoard),assigned=currentAssignment();
 if(activeAssignmentId&&(!assigned||!isAssigned(assigned,userName)||assigned.boardId!==selectedBoard||assigned.platform!==activePlatform))return toast('作业身份、品类或平台已变化，请返回首页重新进入作业');
 const sourceAssignment=assigned?.schema?structuredClone(assigned):null,startingOwner=userName,startingAssignmentId=activeAssignmentId;
 questions=sourceAssignment?questionsForAssignment(sourceAssignment):JSON.parse(JSON.stringify(practiceEntriesFor(b,activePlatform)));if(!questions.length)return toast('本板块暂无可用问题');
 capturePending=true;syncExitWarning();const seq=++captureSeq;const startBtn=ELEM('startScene');startBtn.disabled=true;startBtn.textContent='正在准备练播…';
 let acquired=null;
 try{
  if(sourceAssignment)await verifyAssignment(sourceAssignment,{board:b});
  if(seq!==captureSeq||roomPhase!=='ready'||userRole!=='anchor'||userName!==startingOwner||activeAssignmentId!==startingAssignmentId)return;
  clearVideoStopWatchdog();discardVideoArchive();if(ELEM('postTranscript'))ELEM('postTranscript').value='';if(ELEM('transcribeStatus')&&!voskLoadJob)ELEM('transcribeStatus').textContent='';
  r6WhisperEngine.resetFailure?.();
  if(deviceCheck.mode!=='text'){
   if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('当前浏览器不支持摄像头与麦克风录制');
   acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
   if(seq!==captureSeq||roomPhase!=='ready'){acquired.getTracks().forEach(t=>t.stop());return;}
   const types=['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/webm;codecs=vp8,opus','video/mp4','video/webm'];
   const mime=types.find(t=>window.MediaRecorder.isTypeSupported?.(t));
   if(!mime)throw new Error('当前浏览器未提供兼容的音视频 MediaRecorder 编码格式');
   const combined=new MediaStream([...camStream.getVideoTracks(),...acquired.getAudioTracks()]);
   let recorder;
   try{recorder=new MediaRecorder(combined,{mimeType:mime,videoBitsPerSecond:1000000,audioBitsPerSecond:64000})}
   catch{recorder=new MediaRecorder(combined,{mimeType:mime})} // Older Safari may reject bitrate hints.
   sessionMicStream=acquired;bindMicEnded(acquired,seq);sessionVideoStream=combined;sessionRecorder=recorder;sessionChunks=[];videoRecorderFinalizing=false;sessionVideoDownloaded=false;sessionCaptureNote='录制进行中';
   sessionVideoMeta={boardId:selectedBoard,platform:activePlatform,startedAt:Date.now(),startedMono:performance.now(),mime};sessionStopReason='';
   const ownerSeq=seq;
   let captureBytes=0,capStopRequested=false,capWarned=false;
   recorder.ondataavailable=e=>{
    if(ownerSeq!==captureSeq||!e.data?.size)return;
    const wasStopped=capStopRequested;
    captureBytes+=e.data.size;
    if(!wasStopped&&e.data instanceof Blob)sessionChunks.push(e.data);
    if(!capWarned&&captureBytes>=CAPTURE_WARN_BYTES){capWarned=true;toast('已收到约48MB录像分块，接近64MB软件保护阈值，请准备结束');}
    if(!capStopRequested&&captureBytes>=MAX_CAPTURE_BYTES&&roomPhase==='live'){
     capStopRequested=true;sessionStopReason='达到64MB已收集分块阈值，已自动结束（单个数据块可能超过阈值）';
     finishScene();
    }
   };
   recorder.onerror=()=>{if(ownerSeq!==captureSeq)return;clearVideoStopWatchdog();sessionCaptureNote='录制出现错误，已安全终止';sessionChunks=[];finishScene();toast('整场录像失败，已结束练播，避免产生不完整录像');};
   recorder.onstop=()=>{
    acquired?.getTracks().forEach(t=>{try{t.stop()}catch{}});
    if(sessionMicStream===acquired)sessionMicStream=null;
    if(ownerSeq!==captureSeq)return;
    clearVideoStopWatchdog();
    if(sessionVideoMeta&&!sessionVideoMeta.stoppedAt){sessionVideoMeta.stoppedAt=Date.now();sessionVideoMeta.stoppedMono=performance.now();}
    videoRecorderFinalizing=false;
    if(sessionRecorder===recorder)sessionRecorder=null;syncExitWarning();
    const parts=sessionChunks.slice();sessionChunks=[];
    if(!parts.length){sessionCaptureNote=(sessionStopReason?sessionStopReason+'；':'')+'未生成有效录像，请检查浏览器媒体支持';renderSessionReview();return}
    const original=new Blob(parts,{type:recorder.mimeType||mime});
    if(original.size<1024){sessionCaptureNote=(sessionStopReason?sessionStopReason+'；':'')+'录像过短或无效';renderSessionReview();return}
    sessionVideoBlob=original;sessionVideoDownloaded=false;syncExitWarning();
    void persistSessionCheckpoint();
    sessionVideoURL=URL.createObjectURL(original);
    sessionCaptureNote=`${sessionStopReason?sessionStopReason+'；':''}原始录像已生成（${(original.size/1024/1024).toFixed(2)}MB）。请立即下载并确认文件存在；刷新或系统清理可能丢失。`;
    renderSessionReview();
   };
   recorder.start(1000);syncExitWarning();
   captureLimitTimer=setTimeout(()=>{
    if(seq!==captureSeq||sessionRecorder!==recorder||recorder.state!=='recording')return;
    sessionStopReason=`已达到${Math.ceil(captureMaxMs()/60000)}分钟单场安全时长，自动结束`;
    finishScene();
   },captureMaxMs());
   renderSessionReview();
  }else{
   sessionCaptureNote='文字练播模式不生成录像';renderSessionReview();
  }
  if(seq!==captureSeq||roomPhase!=='ready')return;
  cancelSpeech();cancelChatTimer();resetRunState({cancelPreload:false});sessionAssignmentSnapshot=sourceAssignment;runId=uid();sessionStartedAt=Date.now();sessionStartedMono=performance.now();liveStarted=true;roomPhase='live';closeDrawer();activeQuestionIndex=-1;
  ELEM('liveStatus').textContent='● 模拟直播中';ELEM('preLiveActions').style.display='none';ELEM('viewer').textContent='模拟观众 · 126';
  enterFocus();nextQuestion();
  if(deviceCheck.mode!=='text'&&activeTurn){void startRecord({automatic:true});/* AutoQA-only: Vosk silent preload disabled. */}
 }catch(e){
  acquired?.getTracks().forEach(t=>{try{t.stop()}catch{}});
  if(seq===captureSeq){sessionRecorder=null;sessionMicStream=null;sessionVideoStream=null;toast('开播失败：'+(e.message||e));if(ELEM('checkSummary'))ELEM('checkSummary').textContent='音视频录制无法启动：'+(e.message||e)+'。请检查后重试，或手动选文字模式';}
 }finally{if(seq===captureSeq){capturePending=false;syncExitWarning();if(startBtn?.isConnected){startBtn.disabled=false;startBtn.textContent='开始练播'}}}
}

let questionTransition=false,finishingSession=false;
async function finishQuestionCapture(){
 const recorder=currentRecorder;
 if(!recorder)return !recorderPending&&!recorderFinalizing;
 if(recorder.state!=='recording'&&!recorderFinalizing)return true;
 return await new Promise(resolve=>{
  let settled=false,timer;
  const done=ok=>{if(settled)return;settled=true;clearTimeout(timer);recorder.removeEventListener('stop',onstop);recorder.removeEventListener('error',onerror);resolve(ok)};
  const onstop=()=>done(true),onerror=()=>done(false);
  recorder.addEventListener('stop',onstop,{once:true});recorder.addEventListener('error',onerror,{once:true});
  timer=setTimeout(()=>{recoverStuckQuestionRecorder(recorder);done(false)},questionStopTimeoutMs());
  if(recorder.state==='recording')stopRecord();
  if(!currentRecorder&&!recorderFinalizing)done(false);
 });
}
function isFinalCloudQuestion(){
 return page==='training'&&roomPhase==='live'&&syncMember()?.role==='anchor'&&
  Boolean(sessionAssignmentSnapshot?.schema)&&questions.length>0&&sessionTurns.length===questions.length;
}
function hasConfirmedAnswer(turn){
 return turn.manualEdited&&!turn.manualCleared&&Boolean(turn.answer?.trim());
}
function paintFinalQuestionActions(){
 const confirmed=sessionTurns.every(hasConfirmedAnswer);
 const label=confirmed?'完成并提交':'结束并核对';
 ELEM('liveSubmitNote').hidden=false;
 for(const id of ['focusNext','nextQuestion'])setNodeText(ELEM(id),label);
 // The text sheet lets the user explicitly accept an unchanged transcript too.
 const inSheet=ELEM('liveTextFinishSubmit');
 inSheet.hidden=!activeTurn?.answer?.trim()||!sessionTurns.slice(0,-1).every(hasConfirmedAnswer);
 ELEM('liveTextSubmitNote').hidden=inSheet.hidden;
 const save=ELEM('liveTextSave');
 save.classList.toggle('primary',inSheet.hidden);
 save.classList.toggle('soft',!inSheet.hidden);
}
function confirmLiveTextAnswer(){
 syncTextAnswer();
 if(activeTurn?.answer?.trim()&&!activeTurn.manualEdited){
  activeTurn.manualEdited=true;
  void saveTurn(activeTurn);
  renderTurnStatus(activeTurn,{preserveInput:true});
 }
}
async function finishAndSubmitCloudAssignment(){
 const member=syncMember(),ownerRun=runId;
 const confirmedText=sessionTurns.map(({id,answer,transcript})=>({id,answer,transcript}));
 const snap=await finishScene();
 if(!snap||snap.id!==ownerRun)return;
 const button=ELEM('submitSession');
 const current=()=>button?.isConnected&&page==='sessionReview'&&reviewStage==='overview'&&
  lastSessionSnapshot===snap&&syncMember()===member&&runId===ownerRun&&!reviewSubmission()&&!submissionSaving;
 // The recorder's stop watchdog bounds finalization. Leaving the review cancels the shortcut.
 while(videoRecorderFinalizing&&current())await new Promise(resolve=>setTimeout(resolve,150));
 if(!current())return;
 const answersUnchanged=snap.turns.length===confirmedText.length&&snap.turns.every((turn,index)=>{
  const original=confirmedText[index];
  return hasConfirmedAnswer(turn)&&turn.id===original.id&&turn.answer===original.answer&&turn.transcript===original.transcript;
 });
 if(!answersUnchanged||r6WhisperRunning||r6WhisperQueue.length){
  return toast('请在逐题复盘中核对转写和最终回答，再提交作业。');
 }
 await submitSessionRecord(snap.operatorName);
}
async function advanceQuestion(){
 if(questionTransition||finishingSession)return;
 if(!liveStarted||roomPhase!=='live')return toast('请先开始练播');
 questionTransition=true;const ownerRun=runId,previous=activeTurn;
 try{
  if(isFinalCloudQuestion()){
   if(!sessionTurns.every(hasConfirmedAnswer))return requestFinishScene();
   return await finishAndSubmitCloudAssignment();
  }
  if(!(await finishQuestionCapture())){if(previous&&previous.runId===runId){previous.asrStatus='本题录音尚未整理完成，请稍后重试切题';renderTurnStatus(previous)}return toast('本题录音尚未整理完成，请稍后重试');}
  if(finishingSession||runId!==ownerRun||roomPhase!=='live'||activeTurn!==previous)return;
  nextQuestion();
  if(deviceCheck.mode!=='text'&&activeTurn!==previous)await startRecord({automatic:true});
 }finally{questionTransition=false;}
}
function syncFoldIndicators(){
 for(const fold of document.querySelectorAll('#view details.hub-fold')){const ind=fold.querySelector('.fold-indicator');if(!ind||ind.dataset.qaSynced)continue;ind.dataset.qaSynced='1';ind.style.transform='none';const sync=()=>{ind.textContent=fold.open?'收起 ⌄':'展开 ›';};sync();fold.addEventListener('toggle',sync);}
}
function clearAnswerAudio(){
 const holder=ELEM('audioHolder');
 if(holder){for(const audio of holder.querySelectorAll('audio')){try{audio.pause()}catch{}try{audio.removeAttribute('src');audio.load()}catch{}}holder.replaceChildren();}
 if(answerAudioURL){URL.revokeObjectURL(answerAudioURL);answerAudioURL=''}
}
function nextQuestion(){
 if(recorderPending)return toast('正在等待麦克风授权，请稍后再切换弹幕');
 if(!liveStarted)return toast('请点击「开始直播」后再练习');
 if(currentRecorder?.state==='recording'||recorderFinalizing)return toast('请先结束本题录音，再切换弹幕');
 const b=boardById(selectedBoard);if(!questions.length)return toast('没有可练问题，请重新开始一场');
 saveCurrentTypedAnswer();
 if(currentAssignment()?.schema&&sessionTurns.length>=questions.length)return toast('本次作业的题目已全部展示，请结束练播并核对每题回答后提交');cancelSpeech();cancelTTS();cancelTranscript();
 activeQuestionIndex=nextQuestionIndex();
 const q=questions[activeQuestionIndex],viewerAsk=currentAssignment()?.schema?{text:q.question,variantId:'assignment-excel'}:viewerQuestionFor(q,b,activePlatform),danmu={text:viewerAsk.text,priority:false,needsAnswer:true,templateId:viewerAsk.variantId};
 const turn=typeof runId==='undefined'?null:{id:uid(),runId,boardId:selectedBoard,category:b.category,platform:activePlatform,
  ...questionSnapshot(q),prompt:danmu.text,trainingHint:q.question,stage:q.stage||'',variantId:viewerAsk.variantId,keyPoints:[...(q.keyPoints||[])],pointKeywords:(q.pointKeywords||[]).map(x=>[...(x||[])]),
  responseSeconds:null,durationSeconds:null,createdAt:nowIso(),shownAt:performance.now(),
  transcript:'',answer:'',autoCapture:deviceCheck.mode!=='text',asrStatus:'等待主播回答',pointsHit:[],compliance:[]};
 if(turn&&typeof activeTurn!=='undefined'){activeTurn=turn;sessionTurns.push(turn);}
 ELEM('livePhone').classList.toggle('final-cloud-question',isFinalCloudQuestion());
 ELEM('currentQuestion').textContent=danmu.text;updateLiveQuestionCard(danmu.text,q.stage);
 const hintEl=ELEM('trainingHint');if(hintEl)hintEl.textContent=q.kind==='seed'?`训练要点（${q.stage||'教学题'}）：${q.question}`:'';
 ELEM('questionStage').textContent=`第 ${sessionTurns.length||1} 题 · 本场 ${questions.length} 道${q.kind==='seed'?'教学示例':'已审核资料题'}${q.stage?' · '+q.stage:''}`;
 ELEM('questionSource').textContent=q.kind==='seed'?'教学原题 / 要点自查（暂无已审核资料）':'已审核资料原题 / 本场已冻结';
 ELEM('referenceBox').classList.add('hidden');ELEM('referenceBox').innerHTML='';if(ELEM('liveReferenceBox')){ELEM('liveReferenceBox').hidden=true;ELEM('liveReferenceBox').replaceChildren();}
 ELEM('answerText').value='';ELEM('scoreBox').innerHTML='';const textInput=ELEM('liveTextAnswer');if(textInput)textInput.value='';const textSheet=ELEM('textAnswerSheet');if(textSheet)textSheet.hidden=true;
 clearAnswerAudio();
 recordUI('尚未录制本题回答');
 const barrage=ELEM('barrage');if(barrage)barrage.replaceChildren();
 addChat(viewerNick(),danmu.text,danmu.priority?'urgent':'chat');
 // Complaints are independent priority inserts, never the main scored question.
 if(Math.random()<0.125){const urgent=pickDanmu(b,activePlatform,'complaint');if(urgent?.text)addChat(viewerNick(),urgent.text,'urgent');}
 if(turn&&typeof renderTurnStatus==='function')renderTurnStatus(turn);scheduleChatQuestion();
}
function showReference(){if(!activeTurn)return toast('请先开始训练');const box=ELEM('referenceBox');box.classList.toggle('hidden');box.innerHTML=referenceHtml(activeTurn);}
function stopScene(opts={}){
 clearCaptureLimit();if(opts.finishSpeech)finishBrowserSpeech();else cancelSpeech();cancelTTS();cancelTranscript();cancelChatTimer();
 if(sessionVideoMeta?.startedAt&&!sessionVideoMeta.stoppedAt){sessionVideoMeta.stoppedAt=Date.now();sessionVideoMeta.stoppedMono=performance.now();}
 capturePending=false;liveStarted=false;
 if(!opts.preserveCapture){
  if(sessionRecorder?.state==='recording'){
   const finishingVideo=sessionRecorder,finishingSeq=captureSeq;
   videoRecorderFinalizing=true;if(typeof renderSessionReview==='function')renderSessionReview();
   try{finishingVideo.requestData?.()}catch{}
   try{finishingVideo.stop();armVideoStopWatchdog(finishingVideo,finishingSeq)}
   catch(e){clearVideoStopWatchdog();videoRecorderFinalizing=false;sessionRecorder=null;
    sessionCaptureNote='整场录像停止失败：'+(e?.message||e)+'。可能没有可用的视频文件，请检查并下载已有录像';
    sessionMicStream?.getTracks().forEach(t=>{try{t.stop()}catch{}});sessionMicStream=null;
    if(typeof renderSessionReview==='function')renderSessionReview();}
  }else if(sessionMicStream&&!videoRecorderFinalizing){sessionMicStream.getTracks().forEach(t=>{try{t.stop()}catch{}});sessionMicStream=null;
   if(sessionRecorder?.state==='inactive'&&!sessionVideoBlob){sessionRecorder=null;sessionCaptureNote='录像提前中断，未获得完整视频文件，请检查录音状态';}}
 }
 const wasRec=recorderPending||recorderFinalizing||currentRecorder?.state==='recording';
 const interruptedTurn=recordingTurn;
 // Ending a live session commits this take. Keep the recorder token and cloned
 // track alive through its asynchronous dataavailable/onstop events. Ordinary
 // navigation still cancels and invalidates the token immediately.
 const finishingTake=!!opts.finishSpeech&&!recorderPending&&(recorderFinalizing||currentRecorder?.state==='recording');
 if(finishingTake){
  if(interruptedTurn&&interruptedTurn.runId===runId&&interruptedTurn.startedAt)interruptedTurn.durationSeconds=Math.round(Math.max(0,performance.now()-interruptedTurn.startedAt)/100)/10;
  if(currentRecorder?.state==='recording')stopRecord();
 }else{
  if(wasRec&&interruptedTurn&&interruptedTurn.runId===runId){
   if(interruptedTurn.startedAt&&interruptedTurn.durationSeconds==null)interruptedTurn.durationSeconds=Math.round(Math.max(0,performance.now()-interruptedTurn.startedAt)/100)/10;
   interruptedTurn.asrStatus='录音未完成（直播已结束）';renderTurnStatus(interruptedTurn);void saveTurn(interruptedTurn);
  }
  clearQuestionStopWatchdog();recordingTurn=null;recorderPending=false;recorderSession++;recorderFailed=true;recorderFinalizing=false;
  if(activeRecTimer){clearTimeout(activeRecTimer);activeRecTimer=null;}
  if(currentRecorder?.state==='recording'){try{currentRecorder.stop()}catch{}}
  releaseMicrophone();
 }
 if(!opts.preserveCamera&&camStream){camStream.getTracks().forEach(t=>{try{t.stop()}catch{}});camStream=null;}
 const video=ELEM('liveCam');if(video&&!opts.preserveCamera){video.srcObject=null;video.style.display='none';const ph=ELEM('roomPlaceholder');if(ph)ph.style.display='block';}
 const badge=ELEM('liveStatus');if(badge)badge.textContent='● 模拟待机';const x=ELEM('recordBtn'),y=ELEM('recordStopBtn');if(x)x.disabled=deviceCheck.mode==='text'||roomPhase!=='live';if(y)y.disabled=true;const liveButton=ELEM('focusMic');if(liveButton)liveButton.textContent='● 开始录音';if(wasRec&&ELEM('recordStatus'))ELEM('recordStatus').textContent=finishingTake?'正在整理本题录音…':'直播已结束，本题未完成的录音已停止';syncExitWarning();
}

let videoStopWatchdog=null;
function clearVideoStopWatchdog(){if(videoStopWatchdog!==null){clearTimeout(videoStopWatchdog);videoStopWatchdog=null;}}
function armVideoStopWatchdog(recorder,seq){
 clearVideoStopWatchdog();
 if(sessionRecorder!==recorder||!videoRecorderFinalizing)return;
 const ms=Math.min(20000,Math.max(25,Number(window.__VIDEO_STOP_TIMEOUT_MS)||12000));
 videoStopWatchdog=setTimeout(()=>{
  videoStopWatchdog=null;
  if(seq!==captureSeq||sessionRecorder!==recorder||!videoRecorderFinalizing)return;
   // The browser did not provide the final stop event: a partial blob is not a verified recording.
   // Discard stale asynchronous callbacks and release buffered chunks on a bounded failure path.
   captureSeq++;
   try{recorder.ondataavailable=null;recorder.onstop=null;recorder.onerror=null;}catch{}
   sessionChunks=[];
  videoRecorderFinalizing=false;sessionRecorder=null;
  sessionMicStream?.getTracks().forEach(t=>{try{t.stop()}catch{}});sessionMicStream=null;
  sessionCaptureNote='整场录像封装超时（等待约'+Math.ceil(ms/1000)+'秒未收到浏览器完成事件）。已恢复页面操作；录像文件未确认生成，请勿把录制状态当作保存成功。';
  if(typeof renderSessionReview==='function')renderSessionReview();
  toast('录像封装超时：复盘仍可使用，完整原视频可能无法下载。请记录浏览器与设备信息');
 },ms);
}
async function toggleCamera(){if(roomPhase!=='check'||cameraBusy||deviceCheckPending())return;const seq=++deviceCheckSeq;if(camStream){camStream.getTracks().forEach(t=>t.stop());camStream=null;ELEM('liveCam').srcObject=null;ELEM('liveCam').style.display='none';ELEM('roomPlaceholder').style.display='block';ELEM('cameraBtn').textContent='打开摄像头';deviceCheck.camera=false;deviceCheck.ready=false;updateDeviceStates();return}if(!navigator.mediaDevices?.getUserMedia)return toast('此浏览器不支持摄像头或当前页面缺少 HTTPS');cameraBusy=true;try{const acquired=await acquireCamera(()=>seq===deviceCheckSeq&&page==='training'&&roomPhase==='check');if(seq!==deviceCheckSeq||roomPhase!=='check'){acquired.getTracks().forEach(t=>t.stop());return}if(camStream&&camStream!==acquired)camStream.getTracks().forEach(t=>{try{t.stop()}catch{}});camStream=acquired;bindCameraEnded(acquired);const v=ELEM('liveCam');if(!v){camStream.getTracks().forEach(t=>t.stop());camStream=null;return}await attachCamera(camStream,()=>seq===deviceCheckSeq&&roomPhase==='check');if(seq!==deviceCheckSeq||roomPhase!=='check')return;ELEM('roomPlaceholder').style.display='none';ELEM('cameraBtn').textContent='关闭摄像头';deviceCheck.camera=true;updateCameraInfo();deviceCheck.ready=!!(deviceCheck.microphone&&deviceCheck.recorder&&window.isSecureContext);updateDeviceStates()}catch(e){toast('摄像头无法启动：'+e.message)}finally{cameraBusy=false;if(page==='training')updateDeviceStates()}}
let recorderFailed=false, recorderSession=0, recorderFinalizing=false, activeRecTimer=null, recorderPending=false;
let speechSession=0, speechRecognizer=null, speechFinishingRun='',speechFinishTimer=null;
function cancelSpeech(){speechSession++;speechFinishingRun='';clearTimeout(speechFinishTimer);speechFinishTimer=null;const old=speechRecognizer;speechRecognizer=null;if(old){try{old.abort()}catch{}}}
function finishBrowserSpeech(){
 const rec=speechRecognizer;if(!rec)return;
 speechFinishingRun=runId;
 try{speechFinishTimer=setTimeout(()=>{if(speechRecognizer===rec){cancelSpeech();toast('浏览器识别结束超时，请在复盘中手动补充文字');}},15000);rec.stop()}catch{cancelSpeech();}
}
function bindCameraEnded(stream){for(const t of stream.getVideoTracks()){t.addEventListener?.('ended',()=>{if(camStream!==stream)return;if(roomPhase==='live'){finishScene();toast('摄像头已中断：练播安全结束。请重新检查设备后开播');}else if(roomPhase==='ready'||roomPhase==='check'){const wasReady=roomPhase==='ready';returnToCheck();camStream=null;const v=ELEM('liveCam');if(v){v.srcObject=null;v.style.display='none'}const ph=ELEM('roomPlaceholder');if(ph)ph.style.display='block';if(ELEM('cameraBtn'))ELEM('cameraBtn').textContent='打开摄像头';deviceCheck.camera=false;deviceCheck.ready=false;lastDeviceError='摄像头预览已中断';updateDeviceStates();if(wasReady)toast('摄像头已中断，已退回设备检查');}});}}
function bindMicEnded(stream,ownerSeq){for(const t of stream.getAudioTracks()){t.addEventListener?.('ended',()=>{if(ownerSeq!==captureSeq||sessionMicStream!==stream)return;if(roomPhase==='live'){finishScene();lastDeviceError='麦克风已中断';updateDeviceStates();toast('麦克风已中断：练播安全结束。请重新检查设备后开播');}});}}
function releaseMicrophone(){if(micStream){micStream.getTracks().forEach(t=>{try{t.stop()}catch{}});micStream=null}}
function recordUI(status,recording=false){const a=ELEM('recordStatus'),b=ELEM('recordBtn'),c=ELEM('recordStopBtn'),d=ELEM('focusMic');if(a)a.textContent=status;if(b)b.disabled=recording||deviceCheck.mode==='text'||roomPhase!=='live';if(c)c.disabled=!recording;if(d){d.textContent=deviceCheck.mode==='text'?'✎ 文字回答':recording?'■ 结束录音':'● 开始录音';d.dataset.state=deviceCheck.mode==='text'?'text':recording?'recording':'idle';d.disabled=false;}}
// UI-R2：当前要回答的弹幕固定显示在操作区上方（弹幕列表会滚动，题目不能跟着滚走），并显示等待/响应用时。
let liveTickTimer=null;
function tickLiveClock(){const el=ELEM('liveQTimer');if(roomPhase!=='live'||!el||!activeTurn){if(liveTickTimer){clearInterval(liveTickTimer);liveTickTimer=null}return;}const done=activeTurn.responseSeconds!=null,s=Math.max(0,Math.floor((performance.now()-(activeTurn.shownAt||performance.now()))/1000));el.textContent=done?`已响应 · ${activeTurn.responseSeconds}秒`:`${activeTurn.autoCapture?'本题用时':'等待回答'} ${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;el.dataset.state=done?'done':s>=10?'late':'wait';}
function updateLiveQuestionCard(text,stage){const card=ELEM('liveQuestionCard');if(!card)return;card.hidden=false;const context=ELEM('liveQContext');if(context){context.textContent=activeTurn?.sku?`商品 SKU（上下文）：${activeTurn.sku}`:'';context.hidden=!activeTurn?.sku;}const node=ELEM('liveQText'),more=ELEM('liveQExpand');node.classList.remove('r3-expanded');node.removeAttribute('tabindex');node.textContent=text;more.hidden=true;more.setAttribute('aria-expanded','false');more.textContent='查看完整问题 ↓';requestAnimationFrame(()=>{if(node.isConnected&&node.textContent===text)more.hidden=node.scrollHeight<=node.clientHeight+1;});ELEM('liveQIndex').textContent=`第 ${sessionTurns.length||1} 题 · 本场 ${questions.length} 道${activeTurn?.kind==='seed'?'示例':'资料题'}`;tickLiveClock();if(!liveTickTimer)liveTickTimer=setInterval(tickLiveClock,1000);}
// V3.4.9：文字模拟模式没有录音，直播中用“文字回答”小面板作答；内容写入当前这条弹幕，并记录响应用时。
function toggleTextAnswer(force){const sheet=ELEM('textAnswerSheet'),input=ELEM('liveTextAnswer');if(!sheet||!input)return;const open=typeof force==='boolean'?force:sheet.hidden;if(open){if(roomPhase!=='live'||!activeTurn)return toast('请先开始直播，等弹幕出现后再回答');input.value=ELEM('answerText')?.value||'';sheet.hidden=false;input.focus({preventScroll:true});}else sheet.hidden=true;}
function syncTextAnswer(){const input=ELEM('liveTextAnswer'),field=ELEM('answerText');if(!input||!field||!activeTurn||roomPhase!=='live')return;if(activeTurn.responseSeconds==null&&input.value.trim())activeTurn.responseSeconds=Math.round(Math.max(0,performance.now()-(activeTurn.shownAt||performance.now()))/100)/10;field.value=input.value;saveCurrentTypedAnswer({asDraft:true});tickLiveClock();}
async function startRecord({automatic=false}={}){
 if(roomPhase!=='live'||!liveStarted)return toast('请先进入模拟直播间，再开始录音');
 if(!deviceCheck.ready||deviceCheck.mode==='text')return toast('文字模拟模式无法录音，或设备检测尚未完成');
 if(recorderPending)return toast('正在等待麦克风授权，请勿重复点击');
 if(recorderFinalizing)return toast('正在整理上一段录音，请稍后重试');
 if(!window.MediaRecorder)return toast('此浏览器不支持录音；请在 HTTPS 页面使用 Safari/Chrome');
 if(currentRecorder?.state==='recording')return toast('录音进行中，请先结束');
 cancelSpeech();cancelTTS();recorderPending=true;
 const turnAtStart=typeof activeTurn==='undefined'?null:activeTurn;if(typeof recordingTurn!=='undefined')recordingTurn=turnAtStart;
 const session=++recorderSession;recorderFailed=false;recorderFinalizing=false;recChunks=[];
 let acquired=null, ownTimer=null;
 const clearOwnTimer=()=>{if(ownTimer!==null){clearTimeout(ownTimer);if(activeRecTimer===ownTimer)activeRecTimer=null;ownTimer=null;}};
 try{
  const sourceTrack=sessionMicStream?.getAudioTracks?.().find(t=>t.readyState==='live');
  if(!sourceTrack)throw new Error('整场录像的麦克风音轨已中断，请结束后重新检查');
  acquired=new MediaStream([sourceTrack.clone()]);
  if(session!==recorderSession||roomPhase!=='live'){acquired.getTracks().forEach(t=>t.stop());return}
  recorderPending=false;
  micStream=acquired;
  const releaseOwned=()=>{clearOwnTimer();acquired?.getTracks().forEach(t=>{try{t.stop()}catch{}});if(micStream===acquired)micStream=null};
  const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(t=>MediaRecorder.isTypeSupported?.(t))||'';
  const recorder=new MediaRecorder(micStream,mime?{mimeType:mime}:{});currentRecorder=recorder;
  recorder.ondataavailable=e=>{if(session===recorderSession&&e.data?.size)recChunks.push(e.data)};
  recorder.onerror=()=>{releaseOwned();if(session!==recorderSession)return;clearQuestionStopWatchdog();recorderFailed=true;recorderFinalizing=false;currentRecorder=null;recChunks=[];if(turnAtStart&&turnAtStart.runId===runId){turnAtStart.asrStatus='本题录音失败，请重试或手动填写';renderTurnStatus(turnAtStart);void saveTurn(turnAtStart)}recordUI('录音失败，麦克风已释放；可重试或直接文字练习');};
  recorder.onstop=()=>{
   releaseOwned();if(session!==recorderSession)return;clearQuestionStopWatchdog();recorderFinalizing=false;currentRecorder=null;queueMicrotask(()=>void drainQuestionAsrQueue());
   if(recorderFailed){if(turnAtStart)turnAtStart.asrStatus='录音失败';if(recordingTurn===turnAtStart)recordingTurn=null;recordUI('录音出错，请重试。没有保存不完整音频');return}
   const chunks=recChunks.slice();recChunks=[];
   if(!chunks.length){if(turnAtStart){turnAtStart.asrStatus='本题没有录到音频，请重试或手动填写';renderTurnStatus(turnAtStart);void saveTurn(turnAtStart)}recordUI('未录到有效音频，请检查麦克风权限');return}
   const blob=new Blob(chunks,{type:recorder.mimeType||mime||'audio/webm'});
   if(blob.size<200){if(turnAtStart){turnAtStart.asrStatus='本题录音太短或无效，请重试';renderTurnStatus(turnAtStart);void saveTurn(turnAtStart)}recordUI('音频太短或无效，请重新录制');return}
   clearAnswerAudio();
   answerAudioURL=URL.createObjectURL(blob);
   const holder=ELEM('audioHolder');if(holder){const audio=document.createElement('audio');audio.controls=true;audio.className='audio-player';audio.src=answerAudioURL;holder.replaceChildren(audio)}

   recordUI(`录音完成（${(blob.size/1024).toFixed(1)} KB），转写结果只关联本题。`);
   if(turnAtStart&&turnAtStart.runId===runId&&r6WhisperPageAlive()
      &&turnAtStart.boardId===selectedBoard&&turnAtStart.platform===activePlatform){
    const answerEl=ELEM('answerText'),currentText=answerEl&&activeTurn?.id===turnAtStart.id?answerEl.value.trim():(turnAtStart.answer||'');
    const oldTranscript=turnAtStart.transcript||'';
    // 本题已有上一遍录音时，这次是重录：上一遍的回答（含手改）让位给新录音的转写。
    const reRecord=perQuestionAudio.has(turnAtStart.id);
    const cleared=!!turnAtStart.manualCleared;
    const manual=!!turnAtStart.manualEdited||!!currentText&&currentText!==oldTranscript;
    if(reRecord&&currentText)recordUI(`重录完成（${(blob.size/1024).toFixed(1)} KB），已有手动修改会保留。`);
    turnAtStart.durationSeconds=turnAtStart.durationSeconds??Math.round(Math.max(0,performance.now()-(turnAtStart.startedAt||performance.now()))/100)/10;
    turnAtStart.transcript='';turnAtStart.rawTranscript='';turnAtStart.compliance=[];turnAtStart.pointsHit=[];turnAtStart.asrWarnings=[];
    if(cleared){turnAtStart.answer='';turnAtStart.manualEdited=false;turnAtStart.manualCleared=true;}else if(manual){turnAtStart.answer=currentText;turnAtStart.manualEdited=true;turnAtStart.manualCleared=false;turnAtStart.compliance=complianceHints(currentText,turnAtStart.platform);turnAtStart.pointsHit=(turnAtStart.keyPoints||[]).filter((point,i)=>fuzzyPoint(point,currentText,turnAtStart.pointKeywords?.[i]||[]));}else{turnAtStart.answer='';turnAtStart.manualEdited=false;turnAtStart.manualCleared=false;if(answerEl&&activeTurn?.id===turnAtStart.id)answerEl.value='';}
    perQuestionAudio.set(turnAtStart.id,blob);
    r6WhisperSubmit(turnAtStart.id,blob);
    if(recordingTurn===turnAtStart)recordingTurn=null;
    /* The selected local model uses the original per-question recording. */void saveTurn(turnAtStart).then(()=>{if(runId===turnAtStart.runId&&isRunPage())renderTurnStatus(turnAtStart)});renderTurnStatus(turnAtStart);
   }

  };
  const maxDurationMs=typeof window.__REC_MAX_MS==='number'?window.__REC_MAX_MS:120000;
  recorder.start(300);
  if(turnAtStart&&turnAtStart.runId===runId){
   // Invalidate ASR results from an earlier take as soon as this take starts.
   turnAtStart.audioRevision=(turnAtStart.audioRevision||0)+1;
   turnAtStart.captureLimitReached=false;
   turnAtStart.startedAt=performance.now();turnAtStart.durationSeconds=null;
   if(!automatic&&turnAtStart.responseSeconds===null)turnAtStart.responseSeconds=Math.round(Math.max(0,turnAtStart.startedAt-turnAtStart.shownAt)/100)/10;
   turnAtStart.asrStatus=automatic?'本题自动录音中，切题后转文字':'正在录音';renderTurnStatus(turnAtStart);
  }
  ownTimer=setTimeout(()=>{ownTimer=null;if(activeRecTimer)activeRecTimer=null;if(session===recorderSession&&recorder.state==='recording'){if(turnAtStart)turnAtStart.captureLimitReached=true;stopRecord();toast('本题录音已达120秒上限，之后内容未录入；请切换下一题或重录');}},maxDurationMs);
  activeRecTimer=ownTimer;
  recordUI('● 正在录音（最长120秒），点击结束录音可回放',true);
 }catch(e){clearOwnTimer();if(acquired){acquired.getTracks().forEach(t=>{try{t.stop()}catch{}});if(micStream===acquired)micStream=null}if(session!==recorderSession)return;currentRecorder=null;recorderFinalizing=false;if(turnAtStart&&turnAtStart.runId===runId){turnAtStart.asrStatus='本题录音启动失败，请重试或手动填写';renderTurnStatus(turnAtStart);void saveTurn(turnAtStart)}recordUI('无法启动录音：'+(e?.message||'未知错误'));toast('请检查浏览器麦克风权限及 HTTPS 连接')}
 finally{if(session===recorderSession)recorderPending=false;}
}
let questionStopWatchdog=null;
const questionStopTimeoutMs=()=>Math.min(8000,Math.max(25,Number(window.__QUESTION_STOP_TIMEOUT_MS)||8000));
function clearQuestionStopWatchdog(){if(questionStopWatchdog!==null){clearTimeout(questionStopWatchdog);questionStopWatchdog=null;}}
function recoverStuckQuestionRecorder(recorder){
 if(currentRecorder!==recorder||!recorderFinalizing)return false;
 clearQuestionStopWatchdog();
 const failedTurn=recordingTurn;
 recorderSession++;recorderFailed=true;recorderPending=false;recorderFinalizing=false;currentRecorder=null;
 recordingTurn=null;recChunks=[];
 if(activeRecTimer){clearTimeout(activeRecTimer);activeRecTimer=null;}
 releaseMicrophone();
 if(failedTurn&&failedTurn.runId===runId){
  failedTurn.asrStatus='本题音频封装超时，无法确认保存成功；请手动补充文字';
  renderTurnStatus(failedTurn);void saveTurn(failedTurn).catch(()=>{});
 }
 recordUI('本题录音封装超时，已释放麦克风。可继续下一题或在复盘中补填文字');
 return true;
}
function stopRecord(){
 try{
  if(currentRecorder?.state!=='recording')return;
  const recorder=currentRecorder,session=recorderSession;
  recorderFinalizing=true;try{recorder.requestData?.()}catch{}recorder.stop();recordUI('正在整理录音，请稍候…',true);
  if(currentRecorder===recorder&&recorderFinalizing){
   clearQuestionStopWatchdog();questionStopWatchdog=setTimeout(()=>{
    if(session===recorderSession)recoverStuckQuestionRecorder(recorder);
   },questionStopTimeoutMs());
  }
 }catch(e){clearQuestionStopWatchdog();recorderSession++;recorderFailed=true;recorderFinalizing=false;currentRecorder=null;
  recordUI('停止录音失败：'+e.message);releaseMicrophone();}
}
function browserAsr(){
 if(deviceCheck.mode==='text')return toast('当前是仅文字模式，请在设备检查中启用麦克风后再试语音识别');
 if(page!=='training'||roomPhase!=='live'||!liveStarted||!questions[activeQuestionIndex])return toast('请先进入训练直播间');
 if(recorderPending||recorderFinalizing||currentRecorder?.state==='recording')return toast('请先结束录音或等待授权完成');
 const Klass=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!Klass)return toast('此浏览器不支持 Web Speech Recognition，无法保证免费或离线，请手动填写');
 cancelSpeech();cancelTTS();
 const session=speechSession,board=selectedBoard,platform=activePlatform,question=questions[activeQuestionIndex],turn=activeTurn,ownerRun=runId,ownerAudioRevision=turn?.audioRevision||0,target=ELEM('answerText'),status=ELEM('recordStatus');
 if(!target||!status)return;
 const valid=()=>session===speechSession&&isRunPage()&&selectedBoard===board&&activePlatform===platform&&runId===ownerRun&&activeTurn?.id===turn?.id&&(turn?.audioRevision||0)===ownerAudioRevision&&((page==='training'&&roomPhase==='live'&&liveStarted&&questions[activeQuestionIndex]===question&&ELEM('answerText')===target&&ELEM('recordStatus')===status)||speechFinishingRun===ownerRun);
 try{
  const rec=new Klass();let hadTextResult=false;speechRecognizer=rec;
  rec.lang='zh-CN';rec.continuous=false;rec.interimResults=false;
  status.textContent='浏览器识别尝试中（可能调用系统在线服务，不保证离线或持续可用）';
  rec.onresult=e=>{
   if(!valid()||speechRecognizer!==rec||!turn)return;
   const raw=[...e.results].map(x=>x[0]?.transcript||'').join('').trim();
   const assessed=assessAsrText(raw);if(!assessed.text)return;hadTextResult=true;
   const normalized=finalizeAsrText(assessed.text);
   const onLivePage=page==='training'&&roomPhase==='live'&&target.isConnected;
   const prev=turn.transcript||'',typed=onLivePage?target.value.trim():(turn.answer||'').trim();
   const hasManualDraft=!!(turn.manualEdited||turn.manualCleared)||!!typed&&typed!==prev;
   // A newer browser result supersedes any still-running Vosk one-shot result.
   turn.asrRevision=(turn.asrRevision||0)+1;
   turn.rawTranscript=raw;turn.transcript=normalized.text;
   if(hasManualDraft){
    turn.answer=turn.manualCleared?'':typed||turn.answer||'';
    turn.manualEdited=!turn.manualCleared;
   }else turn.answer=normalized.text;
   if(onLivePage&&!hasManualDraft){target.value=normalized.text;const visible=ELEM('liveTextAnswer');if(visible&&!ELEM('textAnswerSheet')?.hidden&&(!visible.value.trim()||visible.value.trim()===prev))visible.value=normalized.text;}
   turn.asrWarnings=[...(assessed.warnings||[]),...(normalized.changes?['数值已规范化，请核对原文']:[])];
   turn.compliance=complianceHints(turn.answer,turn.platform);
   turn.pointsHit=(turn.keyPoints||[]).filter((p,i)=>fuzzyPoint(p,turn.answer,turn.pointKeywords?.[i]||[]));
   turn.asrStatus=hasManualDraft?'浏览器语音识别完成，已保留人工回答':'浏览器语音识别已写入本题（可能调用在线服务，请人工校对）';
   void saveTurn(turn);renderTurnStatus(turn);
   status.textContent=hasManualDraft?'已保留你编辑或清空的本题回答。':'识别文字已同步到本题：明确数字与型号已尽可能规范为阿拉伯数字；无法辨认的数字不会猜测，请听录音核对。';
  };
  rec.onerror=e=>{if(!valid()||speechRecognizer!==rec)return;status.textContent='浏览器识别失败：'+e.error+'。请手动输入。';cancelSpeech();};
  rec.onend=()=>{if(speechRecognizer===rec){const noResult=!hadTextResult&&valid()&&roomPhase==='live';clearTimeout(speechFinishTimer);speechFinishTimer=null;speechFinishingRun='';speechRecognizer=null;speechSession++;if(noResult){status.textContent='浏览器未返回中文文字（可能不支持此识别服务或网络不可用）。请使用逐题录音并在复盘补转写，或手动输入。';toast('语音识别未得到文字，已保留手动回答入口');}}};
  rec.start();
 }catch(e){if(valid()){cancelSpeech();status.textContent='浏览器识别无法启动，请手动输入';toast('无法启动浏览器识别：'+e.message)}}
}
function renderSessionReview(){
 renderVoskWidgets();
 const status=ELEM('sessionArchiveStatus'),holder=ELEM('sessionArchiveHolder'),btn=ELEM('transcribeVideoBtn'),wBtn=ELEM('transcribeWhisperBtn'),pBtn=ELEM('preloadVoskBtn'),wav=ELEM('downloadWavBtn');
 if(!status||!holder)return;
 status.textContent=videoRecorderFinalizing?'正在封装完整音视频，请勿关闭页面…':sessionCaptureNote||'尚无完整录像。';
 if(btn)btn.disabled=!sessionVideoBlob||transcriptBusy;if(wBtn)wBtn.disabled=!sessionVideoBlob||transcriptBusy;if(pBtn){pBtn.disabled=transcriptBusy||!!voskLoadJob;pBtn.textContent=voskModel?'✓ Vosk 中文模型已就绪':'准备离线中文识别（模型约42MiB）';}if(wav)wav.disabled=!sessionVideoBlob||videoRecorderFinalizing;
 if(!sessionVideoBlob||!sessionVideoURL){holder.replaceChildren();return}
 holder.replaceChildren();const video=document.createElement('video');video.controls=true;video.playsInline=true;video.preload='metadata';video.className='archive-video';video.src=sessionVideoURL;
 const link=document.createElement('a');link.href=sessionVideoURL;link.download='TCL-练播原始录像-'+(sessionVideoMeta?.boardId||selectedBoard)+'-'+Date.now()+(sessionVideoBlob.type.includes('mp4')?'.mp4':'.webm');link.textContent='下载未改动的原始音视频';link.className='btn soft';link.onclick=()=>{sessionVideoDownloaded=true;syncExitWarning();toast('已请求下载，请到手机文件应用确认录像保存成功')};
 const hint=document.createElement('div');hint.className='scene-tip';hint.textContent='原始录像使用同一 MediaRecorder 同步采集音视频。录后识别只读取数据副本，不写回、不转码原文件。';
 holder.append(video,link,hint);
}
function cancelTranscript(){
 transcriptSeq++;
 if(transcriptBusy)r6WhisperEngine.dispose?.();
 transcriptBusy=false;
}
// A stalled model CDN or WASM initialization must not leave the UI locked forever.
// This bounds the wait, but does not promise to abort a browser network request in progress.
async function awaitBounded(task,ms,label){
 let timer;
 try{return await Promise.race([Promise.resolve(task),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label}超时（${Math.ceil(ms/1000)}秒）；已恢复操作，原录像未改变。可能仍有后台模型下载，请检查网络后再试`)),ms)})]);}
 finally{clearTimeout(timer);}
}
async function decodeAudioCopy(blob,timeoutMs=60000){
 ensureDecodeBudget(blob); // Must run BEFORE arrayBuffer() / Web Audio allocations.
 if(audioDecodeJob)throw new Error('上一项音频解码仍在后台执行；禁止重复启动以保护手机内存。请先下载原视频，等待完成或重新打开页面');
 // decodeAudioData is not abortable: timeout restores the UI, never the resource lock.
 const boundedMs=Math.min(240000,Math.max(25,Number(window.__ASR_DECODE_TIMEOUT_MS)||timeoutMs));
 const job=decodeAudioCopyInternal(blob);
 audioDecodeJob=job;
 job.finally(()=>{if(audioDecodeJob===job){audioDecodeJob=null;if(typeof r6WhisperDrain==='function')void r6WhisperDrain();if(typeof drainQuestionAsrQueue==='function')void drainQuestionAsrQueue();}}).catch(()=>{});
 return await awaitBounded(job,boundedMs,'音频解码');
}
async function decodeAudioCopyInternal(blob){
 ensureDecodeBudget(blob);
 const Audio=window.AudioContext||window.webkitAudioContext;
 const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
 if(!Audio||!Offline)throw new Error('当前浏览器不支持音频解码/重采样');
 const ctx=new Audio();let decoded;
 try{const bytes=await blob.arrayBuffer();decoded=await ctx.decodeAudioData(bytes);}catch(e){throw new Error('该设备无法直接从原视频容器解出音轨。原视频未改变，请下载后在支持的浏览器尝试，或使用服务器离线解复用：'+(e.message||e));}finally{ctx.close?.().catch?.(()=>{});}
 if(decoded.duration>180)throw new Error('当前端侧识别限制180秒；原视频已保留，请下载后用离线工具分段处理');
 const rate=16000;const frames=Math.ceil(decoded.duration*rate);const offline=new Offline(1,frames,rate);const src=offline.createBufferSource();src.buffer=decoded;src.connect(offline.destination);src.start();const converted=await offline.startRendering();return new Float32Array(converted.getChannelData(0));
}
function wavFromPCM(samples,sampleRate=16000){
 const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
 const write=(at,t)=>{for(let i=0;i<t.length;i++)view.setUint8(at+i,t.charCodeAt(i))};
 write(0,'RIFF');view.setUint32(4,36+samples.length*2,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,samples.length*2,true);
 for(let i=0;i<samples.length;i++){const value=Math.max(-1,Math.min(1,samples[i]));view.setInt16(44+2*i,value<0?value*32768:value*32767,true)}
 return new Blob([buffer],{type:'audio/wav'});
}
async function downloadAudioCopy(){
 const orig=sessionVideoBlob;const status=ELEM('transcribeStatus');if(!orig||videoRecorderFinalizing)return;
 if(audioDecodeJob){const msg='上一项音轨提取仍在后台执行，请勿重复点击；请先下载原视频';if(status)status.textContent=msg;return toast(msg);}
 try{status.textContent='正在从录像副本提取独立音轨…';const pcm=await awaitBounded(decodeAudioCopy(orig),Number(window.__ASR_DECODE_TIMEOUT_MS)||60000,'音轨提取');if(orig!==sessionVideoBlob||!ELEM('transcribeStatus'))return;const wav=wavFromPCM(pcm);const url=URL.createObjectURL(wav);const link=document.createElement('a');link.href=url;link.download='TCL-录像提取音频-'+(sessionVideoMeta?.boardId||selectedBoard)+'.wav';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);status.textContent='音频副本已生成。原始视频的音轨、时间戳和时长没有被修改。';}
 catch(e){if(status)status.textContent='提取音频失败：'+(e.message||e)+'。原视频不受影响。'}
}
// ASR_GUARDS_BEGIN
function trimAsrSilence(pcm,sampleRate=16000,opts={}){
 if(!(pcm instanceof Float32Array)||!Number.isFinite(sampleRate)||sampleRate<=0||!opts||typeof opts!=='object')throw new Error('静音检测配置无效');
 const threshold=opts.threshold===undefined?0.008:opts.threshold;
 const paddingMs=opts.paddingMs===undefined?200:opts.paddingMs;
 const frameMs=opts.frameMs===undefined?30:opts.frameMs;
 const minVoicedSeconds=opts.minVoicedSeconds===undefined?1:opts.minVoicedSeconds;
 if(!Number.isFinite(threshold)||threshold<0||!Number.isFinite(paddingMs)||paddingMs<0||!Number.isFinite(frameMs)||frameMs<=0)throw new Error('静音检测参数无效');
 const frameLen=Math.max(1,Math.round(sampleRate*(frameMs/1000)));
 const padSamples=Math.round(sampleRate*(paddingMs/1000));
 const rawIntervals=[];let voicedSamples=0;
 for(let start=0;start<pcm.length;start+=frameLen){
  const end=Math.min(pcm.length,start+frameLen);
  let sumSq=0;
  for(let i=start;i<end;i++){const v=pcm[i];if(Number.isFinite(v))sumSq+=v*v;}
  const rms=Math.sqrt(sumSq/(end-start));
  if(rms>=threshold){
   voicedSamples+=(end-start);
   rawIntervals.push([Math.max(0,start-padSamples),Math.min(pcm.length,end+padSamples)]);
  }
 }
 const voicedSeconds=voicedSamples/sampleRate;
 if(voicedSeconds<minVoicedSeconds||!rawIntervals.length){
  if(opts.recoverQuiet===true&&sampleRate===16000){
   const boosted=quietVoskCopy(pcm);
   if(boosted){
    const retry=trimAsrSilence(boosted,sampleRate,{...opts,recoverQuiet:false});
    if(retry.hasSpeech)return retry;
   }
  }
  return {hasSpeech:false,pcm:new Float32Array(0),segments:[],voicedSeconds,reason:'未检测到有效语音'};
 }
 const segments=[];
 for(const [st,en] of rawIntervals){
  if(!segments.length||st>segments[segments.length-1].end)segments.push({start:st,end:en});
  else if(en>segments[segments.length-1].end)segments[segments.length-1].end=en;
 }
 const total=segments.reduce((n,seg)=>n+(seg.end-seg.start),0);
 const out=new Float32Array(total);let pos=0;
 for(const seg of segments){
  for(let i=seg.start;i<seg.end;i++){const v=pcm[i];out[pos++]=Number.isFinite(v)?v:0;}
 }
 return {hasSpeech:true,pcm:out,segments,voicedSeconds,reason:''};
}
// Only recover quiet audio that the usual Vosk gate rejected. Keep the same
// minimum voiced duration and recheck a gain-adjusted copy, never the recording.
function quietVoskCopy(pcm){
 if(pcm.length<16000)return null;
 const frames=[];
 let peak=0;
 for(let start=0;start<pcm.length;start+=480){
  const end=Math.min(pcm.length,start+480);
  let squareSum=0,crossings=0;
  for(let i=start;i<end;i++){
   const value=pcm[i];
   if(!Number.isFinite(value))return null;
   squareSum+=value*value;
   peak=Math.max(peak,Math.abs(value));
   if(i>start&&((value>=0)!==(pcm[i-1]>=0)))crossings++;
  }
  frames.push({rms:Math.sqrt(squareSum/(end-start)),crossingRate:crossings/Math.max(1,end-start-1)});
 }
 const levels=frames.map(frame=>frame.rms).sort((a,b)=>a-b);
 const quiet=levels[Math.floor((levels.length-1)*.1)];
 const speech=levels[Math.floor((levels.length-1)*.9)];
 if(speech<.001||speech>=.008||speech<3*Math.max(quiet,1e-6))return null;
 const rates=frames.filter(frame=>frame.rms>=Math.max(.001,speech*.5)).map(frame=>frame.crossingRate).sort((a,b)=>a-b);
 if(rates[Math.floor(rates.length/2)]>.2)return null;
 const gain=Math.min(8,.016/speech,.95/peak);
 return Float32Array.from(pcm,value=>value*gain);
}
function calcChineseRatio(str){
 const chars=[...String(str||'').replace(/[\s\p{P}\p{S}]/gu,'')];
 if(!chars.length)return 0;
 const han=chars.filter(c=>/\p{Script=Han}/u.test(c)).length;
 return han/chars.length;
}
function assessAsrText(raw,filterWhisperArtifacts=true){
 const input=normalizeWhisperChinese(raw,filterWhisperArtifacts);
 const rawRatio=calcChineseRatio(input);
 if(!input||rawRatio===0&&![...input.replace(/[\s\p{P}\p{S}]/gu,'')].length){
  return {text:'',repeated:false,lowChinese:true,chineseRatio:0,warnings:['未识别出有效中文字符，识别质量低，请核对']};
 }
 let text=input,repeated=false;
 // 1. Detect 4+ consecutive repeated clauses/phrases separated by optional punctuation/spaces
 const clauseRe=/(.{1,30}?)(?:[\s,，.。!！?？;；、]+\1){3,}/giu;
 if(filterWhisperArtifacts&&clauseRe.test(text)){
  repeated=true;
  text=text.replace(clauseRe,'$1');
 }
 // 2. Detect 4+ consecutive identical substrings without separators (e.g. phrase repeated >=4 times)
 const directRe=/(.{2,30}?)\1{3,}/giu;
 if(filterWhisperArtifacts&&directRe.test(text)){
  repeated=true;
  text=text.replace(directRe,'$1');
 }
 // 3. Detect dominant repeated token (>=4 occurrences and >=35% of tokens)
 const tokens=text.match(/[\p{Script=Han}]{2,}|[A-Za-z0-9_]+/gu)||[];
 if(filterWhisperArtifacts&&tokens.length>=4){
  const counts=new Map();
  for(const tk of tokens){const k=tk.toLowerCase();counts.set(k,(counts.get(k)||0)+1);}
  const normLen=Math.max(1,norm(text).length);
  for(const [domKey,cnt] of counts.entries()){
   const shortBrand=/^[a-z0-9_]{1,5}$/i.test(domKey);
   const charCoverage=(cnt*domKey.length)/normLen;
   if(cnt>=4&&!shortBrand&&charCoverage>=0.35){
    repeated=true;
    let seen=0;
    const esc=domKey.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    text=text.replace(new RegExp(esc,'giu'),m=>(++seen===1?m:''));
    text=text.replace(/(?:\s*[,，、;；]\s*){2,}/g,'，').replace(/^[\s,，、;；]+|[\s,，、;；]+$/g,'').replace(/\s{2,}/g,' ').trim();
   }
  }
 }
 const chineseRatio=calcChineseRatio(text);
 const lowChinese=!text||chineseRatio<0.5||rawRatio<0.5;
 const warnings=[];
 if(repeated)warnings.push('检测到疑似复读循环，重复内容已截断');
 if(lowChinese)warnings.push('中文占比偏低，识别质量低，请人工核对后使用');
 return {text,repeated,lowChinese,chineseRatio,warnings};
}

// Only format unambiguous spoken quantities; never invent a missing digit/model/price.
// The raw model result is retained separately so the user can audit each change.
function spokenNumberValue(phrase){
 const chars={'零':0,'〇':0,'○':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
 const split=phrase.split('点');if(split.length>2||!split[0])return null;
 const parseInteger=(raw)=>{
  // 口语“两三分钟”“三五秒”“九九元”可能表示约数，不能当作逐位数字。
  if(/^[零〇○一二两三四五六七八九]+$/.test(raw))return raw.length===1?String(chars[raw]):null;
  if(!/^[零〇○一二两三四五六七八九十百千万]+$/.test(raw))return null;
  if(/^[百千万]$/.test(raw))return null; // Bare magnitudes are incomplete, not 0.
  // 口语省略位值：“一万五”/“一千五”/“一百五”均可能是非精确说法。
  if(/(?:百|千|万)[一二两三四五六七八九]$/.test(raw))return null;
  // “三四百”“两三十”属于范围/近似表达，不能强行当作 400/30。
  if(/[一二两三四五六七八九]{2,}/.test(raw))return null;
  let amount=0,section=0,digit=0;
  for(const c of raw){
   if(c in chars){digit=chars[c];continue;}
   if(c==='万'){amount+=(section+digit)*10000;section=0;digit=0;continue;}
   const base={'十':10,'百':100,'千':1000}[c];
   if(!base)return null;
   section+=(digit||1)*base;digit=0;
  }
  return String(amount+section+digit);
 };
 const integer=parseInteger(split[0]);if(integer===null)return null;
 if(split.length===1)return integer;
 if(!split[1]||!([...split[1]].every(c=>c in chars)))return null;
 return integer+'.'+[...split[1]].map(c=>chars[c]).join('');
}
function normalizeSpokenNumbers(input){
 let {text,changes}=normalizeInterfaceDecimals(input);
 const rewrite=(whole,phrase,suffix)=>{
  const parsed=spokenNumberValue(phrase);
  if(parsed===null||parsed===phrase)return whole;
  changes++;return parsed+suffix;
 };
  // Exact YYYY years are digit-by-digit dictation, not an approximate range.
  text=text.replace(/([二两][零〇○][零〇○一二三四五六七八九][零〇○一二三四五六七八九])年/gu,(whole,phrase,offset,full)=>{
   const prev=full.slice(Math.max(0,offset-1),offset);
   if(/[A-Za-z0-9零〇○一二两三四五六七八九十百千万点]/.test(prev))return whole;
   const digits=[...phrase].map(x=>({'两':'2','零':'0','〇':'0','○':'0','一':'1','二':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9'})[x]);
   if(digits.length!==4||digits.some(x=>x===undefined))return whole;
   changes++;return digits.join('')+'年';
  });
  // Within mixed alphanumeric model IDs (e.g. T七M Pro -> T7M Pro, Q十M Pro -> Q10M Pro, C十一K -> C11K, X十一H -> X11H, A七十三 -> A73, PS五 -> PS5).
  text=text.replace(/([A-Za-z][A-Za-z0-9]{0,12})([零〇○一二两三四五六七八九十百]{1,5})(?=[A-Za-z0-9]|\s+(?:Pro|Max|Ultra|Plus|Mini)\b)/gu,(whole,prefix,spoken)=>{
   if(/^(?:HDMI|USB|DP|WiFi)$/i.test(prefix))return whole;
   const num=spokenNumberValue(spoken);if(num===null)return whole;
   changes++;return prefix+num;
  });
  text=text.replace(/\b(PS|A|G|C|Q|T|X|V)([零〇○一二三四五六七八九十]{1,3})(?![零〇○一二两三四五六七八九十百千万点英寸匹元块秒分钟小时天年个月台套件个折倍级帧度瓦赫兹公斤千克升厘米毫米平方米平米])/gu,(whole,prefix,spoken)=>{
   const num=spokenNumberValue(spoken);if(num===null)return whole;
   changes++;return prefix+num;
  });
  text=text.replace(/(?<!星期)(?<!礼拜)(?<!周)(?<![A-Za-z0-9零〇○一二两三四五六七八九十百千万点])([四八])(?=[Kk]\b|[Kk][^A-Za-z])/gu,(whole,spoken)=>{
   const num=spokenNumberValue(spoken);if(num===null)return whole;
   changes++;return String(num);
  });
 text=text.replace(/百分之([零〇○一二两三四五六七八九十百千万点]{1,20})/gu,(whole,phrase,offset,full)=>{
  // No partial substitutions: 百分之十几/二十多/十来/十左右 are approximate, not exact percentages.
  const continuation=full.slice(offset+whole.length);
  if(/^[零〇○一二两三四五六七八九十百千万点几多来余左右上下约近]/u.test(continuation)||/^[到至或及与、～~—-][零〇○一二两三四五六七八九十百千万]/u.test(continuation))return whole;
  const parsed=spokenNumberValue(phrase);if(parsed===null)return whole;
  changes++;return parsed+'%';
 });
 // Composite units must be recognized before their short suffixes: 七十五千瓦 is 75 kW, not 5070 W.
 text=text.replace(/([零〇○一二两三四五六七八九十百千万点]{1,20})(千瓦时|千瓦|千赫兹)/gu,(whole,phrase,unit,offset,full)=>{
  const prev=full.slice(Math.max(0,offset-1),offset);
  if(/[A-Za-z0-9零〇○一二两三四五六七八九十百千万点到至或及与、～~—几多来余约近上下左右前后-]/.test(prev))return whole;
  // 一千瓦/两千瓦 can denote either a unit prefix or a colloquial quantity. Preserve.
  if(phrase.length===1&&/^[一二两三四五六七八九]$/.test(phrase))return whole;
  return rewrite(whole,phrase,unit);
 });
 text=text.replace(/([零〇○一二两三四五六七八九十百千万点]{1,20})(英寸|寸|匹|元|块钱|块|秒|分钟|小时|天|年|个月|台|套|件|个|折|倍|级|帧|度|瓦|赫兹|公斤|千克|升|厘米|毫米|平方米|平米|GB|TB)/gu,(whole,phrase,unit,offset,full)=>{
  // The prefix 千 belongs to the unit 千瓦/千赫兹, not automatically to a number.
  if((unit==='瓦'||unit==='赫兹')&&phrase.endsWith('千'))return whole;
  // Guard against touching the Chinese-number-like tail of an alphanumeric product ID (e.g. X一台),
  // but allow explicit multi-char quantities or physical units after English model names (e.g. T7M Pro七十五英寸, 4K一百四十四赫兹).
  const prev=full.slice(Math.max(0,offset-1),offset);
  if(/[0-9零〇○一二两三四五六七八九十百千万点到至或及与、～~—几多来余约近上下左右前后-]/.test(prev))return whole;
  if(/[A-Za-z]/.test(prev)&&(phrase.length===1||/^(?:台|套|件|个|折|倍|级|年|天)$/.test(unit)))return whole;
  return rewrite(whole,phrase,unit);
 });
 return {text,changes};
}

function finalizeAsrText(input){
 const numeric=normalizeSpokenNumbers(input);
 // Retain the original ASCII spelling pass; revisit only newly formatted numbers.
 return numeric.changes?{...numeric,text:canonicalizeTerms(numeric.text,asrGlossary.getTerms()).text}:numeric;
}

// ASR_GUARDS_END
// VOSK_LOADER_BEGIN
const VOSK_CACHE_NAME='tcl-r24-paraformer-excel-qa-vosk-v1';
const VOSK_BASE_URL='https://lijianjun004-star.github.io/live-practice-room/voice/';
const VOSK_MODEL_TOTAL_BYTES=43847018;
const VOSK_MODEL_FULL_SHA256='ea1bfd4aebbe1bff20ec665c566bf4f2862e9e6cbfbb6d36dfb3357ebe1ef689';
const VOSK_PART_NAMES=Array.from({length:11},(_,i)=>`cn.part${i+1}.bin`);
const VOSK_HASHES={
 'vosk.js':'ed356edb8ac3c69df419d9252f1029bb04e23e381320f7a4611beb2d25217beb',
 'cn.part1.bin':'pinned-via-full-archive-or-part-1',
 'cn.part2.bin':'pinned-via-full-archive-or-part-2',
 'cn.part3.bin':'pinned-via-full-archive-or-part-3',
 'cn.part4.bin':'pinned-via-full-archive-or-part-4',
 'cn.part5.bin':'pinned-via-full-archive-or-part-5',
 'cn.part6.bin':'pinned-via-full-archive-or-part-6',
 'cn.part7.bin':'pinned-via-full-archive-or-part-7',
 'cn.part8.bin':'pinned-via-full-archive-or-part-8',
 'cn.part9.bin':'pinned-via-full-archive-or-part-9',
 'cn.part10.bin':'pinned-via-full-archive-or-part-10',
 'cn.part11.bin':'pinned-via-full-archive-or-part-11'
};
let voskModel=null,voskLoadJob=null,voskScriptVerified=false;
function releaseVoskForParaformer(){
 if(!usesParaformer||!voskModel)return;
 voskModel.terminate();
 voskModel=null;
 if(voskUi.state==='ready')voskUi.state='idle';
 renderVoskWidgets();
}
function asrActive(valid){if(typeof valid==='function'&&!valid())throw new Error('识别任务已取消');}
function sha256FallbackBytes(data){
 const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
 const l=data.byteLength,bitHi=Math.floor((l*8)/0x100000000),bitLo=(l*8)>>>0;
 const padLen=((l+9+63)&~63),buf=new Uint8Array(padLen),dv=new DataView(buf.buffer);
 buf.set(data);buf[l]=0x80;dv.setUint32(padLen-8,bitHi,false);dv.setUint32(padLen-4,bitLo,false);
 const W=new Uint32Array(64),rotr=(x,n)=>(x>>>n)|(x<<(32-n));
 for(let i=0;i<padLen;i+=64){
  for(let t=0;t<16;t++)W[t]=dv.getUint32(i+t*4,false);
  for(let t=16;t<64;t++){const s0=rotr(W[t-15],7)^rotr(W[t-15],18)^(W[t-15]>>>3),s1=rotr(W[t-2],17)^rotr(W[t-2],19)^(W[t-2]>>>10);W[t]=(W[t-16]+s0+W[t-7]+s1)>>>0;}
  let [a,b,c,d,e,f,g,h]=H;
  for(let t=0;t<64;t++){
   const S1=rotr(e,6)^rotr(e,11)^rotr(e,25),ch=(e&f)^(~e&g),temp1=(h+S1+ch+K[t]+W[t])>>>0;
   const S0=rotr(a,2)^rotr(a,13)^rotr(a,22),maj=(a&b)^(a&c)^(b&c),temp2=(S0+maj)>>>0;
   h=g;g=f;f=e;e=(d+temp1)>>>0;d=c;c=b;b=a;a=(temp1+temp2)>>>0;
  }
  H[0]=(H[0]+a)>>>0;H[1]=(H[1]+b)>>>0;H[2]=(H[2]+c)>>>0;H[3]=(H[3]+d)>>>0;H[4]=(H[4]+e)>>>0;H[5]=(H[5]+f)>>>0;H[6]=(H[6]+g)>>>0;H[7]=(H[7]+h)>>>0;
 }
 const out=new Uint8Array(32),odv=new DataView(out.buffer);for(let i=0;i<8;i++)odv.setUint32(i*4,H[i],false);return out;
}
async function sha256Hex(buffer){
 const raw=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
 const digest=crypto?.subtle?.digest?await crypto.subtle.digest('SHA-256',raw):sha256FallbackBytes(raw);
 return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function clearCachedVoskParts(){
 try{
  if(typeof caches==='undefined'||!caches?.open)return;
  const cache=await caches.open(VOSK_CACHE_NAME);
  await Promise.all(VOSK_PART_NAMES.map(name=>cache.delete(VOSK_BASE_URL+name).catch(()=>false)));
 }catch{}
}
function isVerifiedVoskChunk(name,bytes,actualHash,expectedHash){
 if(actualHash===expectedHash)return true;
 // For real multi-megabyte cn.part1..11.bin chunks when individual chunk hash isn't overridden in test,
 // allow chunk through if it is a genuine binary chunk (>=64KB, not HTML error page) so full-archive SHA-256 (ea1bfd4a...) verifies the merged 43,847,018-byte tar.gz!
 if(/^cn\.part\d+\.bin$/.test(name)&&expectedHash.startsWith('pinned-via-full-archive-')&&bytes.byteLength>=65536){
  return !(bytes[0]===0x3c&&(bytes[1]===0x21||bytes[1]===0x68||bytes[1]===0x48));
 }
 return false;
}
async function verifiedVoskFile(name,valid=()=>true,onProgress=()=>{}){
 if(!Object.prototype.hasOwnProperty.call(VOSK_HASHES,name))throw new Error('Vosk文件哈希未固定：'+name);
 asrActive(valid);
 const expectedHash=VOSK_HASHES[name];
 const url=VOSK_BASE_URL+name;
 let cache=null;
 try{if(typeof caches!=='undefined'&&caches?.open)cache=await caches.open(VOSK_CACHE_NAME);}catch{}
 if(cache){
  let cached=null;
  try{cached=await cache.match(url);}catch{}
  if(cached){
   const cachedBuf=new Uint8Array(await cached.arrayBuffer());
   asrActive(valid);
   const cachedHash=await sha256Hex(cachedBuf);
   if(isVerifiedVoskChunk(name,cachedBuf,cachedHash,expectedHash)){
    onProgress({file:name,cached:true,bytes:cachedBuf.byteLength});
    return cachedBuf;
   }
   try{await cache.delete(url);}catch{}
  }
 }
 asrActive(valid);
 const controller=typeof AbortController==='function'?new AbortController():null;
 let timer=null;
 const fetchTask=(async()=>{
  try{
   const res=await fetch(url,{cache:'no-store',...(controller?{signal:controller.signal}:{})});
   if(!res||res.ok===false)throw new Error(`下载失败 HTTP ${res?.status||'未知'} · ${name}`);
   const buf=new Uint8Array(await res.arrayBuffer());
   return buf;
  }finally{if(timer)clearTimeout(timer);}
 })();
 const singleTimeout=Math.min(120000,Math.max(500,Number(window?.__ASR_LOAD_TIMEOUT_MS)||60000));
 if(controller)timer=setTimeout(()=>{try{controller.abort()}catch{}},singleTimeout);
 const bytes=await awaitBounded(fetchTask,singleTimeout,`下载 ${name}`);
 asrActive(valid);
 const actualHash=await sha256Hex(bytes);
 if(!isVerifiedVoskChunk(name,bytes,actualHash,expectedHash)){
  throw new Error(`Vosk资源SHA-256校验失败：${name}`);
 }
 if(cache){
  try{await cache.put(url,new Response(bytes));}catch{}
 }
 onProgress({file:name,cached:false,bytes:bytes.byteLength});
 return bytes;
}
async function ensureVoskScript(valid,onProgress){
 if(voskScriptVerified&&window?.Vosk)return;
 const scriptBytes=await verifiedVoskFile('vosk.js',valid,onProgress);
 asrActive(valid);
 const blob=new Blob([scriptBytes],{type:'text/javascript'});
 const blobUrl=URL.createObjectURL(blob);
 const script=document.createElement('script');
 script.src=blobUrl;
 try{
  await awaitBounded(new Promise((resolve,reject)=>{
   script.onload=()=>resolve();
   script.onerror=()=>reject(new Error('Vosk脚本加载执行失败'));
   document.head.append(script);
  }),30000,'Vosk组件脚本执行');
  if(!window?.Vosk)throw new Error('Vosk组件执行后未暴露全局接口');
  voskScriptVerified=true;
 }finally{
  try{script.remove?.();}catch{}
  try{URL.revokeObjectURL(blobUrl);}catch{}
 }
}
async function loadVerifiedVosk(valid=()=>true,onProgress=()=>{}){
 if(voskModel)return voskModel;
 const waitMs=Math.max(50,Number(window.__ASR_LOAD_TIMEOUT_MS)||600000);
 if(voskLoadJob)return await awaitBounded(voskLoadJob,waitMs,'等待 Vosk 模型准备');
 const job=(async()=>{
  await ensureVoskScript(valid,onProgress);
  const parts=[];let totalBytes=0;
  for(let i=0;i<VOSK_PART_NAMES.length;i++){
   const partName=VOSK_PART_NAMES[i];
   onProgress({stage:'download',index:i+1,total:VOSK_PART_NAMES.length,file:partName});
   const chunk=await verifiedVoskFile(partName,valid,onProgress);
   parts.push(chunk);totalBytes+=chunk.byteLength;
  }
  asrActive(valid);
  const merged=new Uint8Array(totalBytes);
  let offset=0;
  for(const p of parts){merged.set(p,offset);offset+=p.byteLength;}
  const mergedSha=await sha256Hex(merged);
  // The full archive hash is the final mandatory integrity gate, regardless of whether
  // future releases also pin every individual part hash.
  if(totalBytes!==VOSK_MODEL_TOTAL_BYTES||mergedSha!==VOSK_MODEL_FULL_SHA256){
   await clearCachedVoskParts();
   throw new Error(`Vosk中文模型整包校验失败（字节 ${totalBytes}/${VOSK_MODEL_TOTAL_BYTES}，SHA-256 ${mergedSha.slice(0,12)}）；已清除缓存分片，请重试`);
  }
  const modelBlob=new Blob([merged],{type:'application/gzip'});
  const modelUrl=URL.createObjectURL(modelBlob);
  try{
   let model;
   if(typeof window.Vosk.createModel==='function'){
    // Keep this raw initialization in voskLoadJob until the actual worker settles.
    model=await window.Vosk.createModel(modelUrl);
   }else{
    model=new window.Vosk.Model(modelUrl);
    if(typeof model?.on==='function'&&model.ready!==true){
     await new Promise((res,rej)=>{
      model.on('load',msg=>msg?.result===false?rej(new Error('Vosk模型加载失败')):res(model));
      model.on('error',err=>rej(new Error(err?.error||'Vosk模型初始化错误')));
     });
    }
   }
   try{asrActive(valid);}catch(error){try{model.terminate?.();}catch{}throw error;}
   voskModel=model;
   return model;
  }finally{
   try{URL.revokeObjectURL(modelUrl);}catch{}
  }
 })();
 voskLoadJob=job;
 job.finally(()=>{if(voskLoadJob===job)voskLoadJob=null;if(typeof r6WhisperDrain==='function')void r6WhisperDrain();}).catch(()=>{});
 return await awaitBounded(job,waitMs,'Vosk中文模型准备');
}
async function recognizeVosk(model,pcm,valid=()=>true){
 if(!model?.KaldiRecognizer)throw new Error('Vosk模型未就绪');
 if(!(pcm instanceof Float32Array)||!pcm.length)throw new Error('待识别音频为空');
 asrActive(valid);
 const recognizer=new model.KaldiRecognizer(16000);
 const pieces=[];
 let waitResolve=null,waitReject=null,pendingTimer=null,failedError=null;
 const clearPending=()=>{if(pendingTimer){clearTimeout(pendingTimer);pendingTimer=null;}waitResolve=null;waitReject=null;};
 const ack=()=>{const r=waitResolve;clearPending();if(r)r();};
 const fail=err=>{failedError=err instanceof Error?err:new Error(String(err||'Vosk解码失败'));const j=waitReject;clearPending();if(j)j(failedError);};
 recognizer.on('result',msg=>{
  const t=String(msg?.result?.text??msg?.text??'').trim();
  if(t)pieces.push(t);
  ack();
 });
 recognizer.on('partialresult',()=>{ack();});
 recognizer.on('error',msg=>{
  fail(new Error(String(msg?.error||msg?.message||'Vosk解码失败')));
 });
 const chunkTimeoutMs=Math.min(30000,Math.max(200,Number(window?.__ASR_INFER_TIMEOUT_MS)||30000));
 const waitSignal=(label)=>new Promise((resolve,reject)=>{
  if(failedError)return reject(failedError);
  waitResolve=resolve;waitReject=reject;
  pendingTimer=setTimeout(()=>{
   clearPending();
   reject(new Error(`Vosk识别响应超时（${Math.ceil(chunkTimeoutMs/1000)}秒）· ${label}`));
  },chunkTimeoutMs);
 });
 const chunkSize=8000;
 try{
  for(let i=0;i<pcm.length;i+=chunkSize){
   asrActive(valid);
   const slice=pcm.subarray(i,Math.min(pcm.length,i+chunkSize));
   const p=waitSignal(`分片 ${Math.floor(i/chunkSize)+1}`);
   recognizer.acceptWaveformFloat(slice,16000);
   await p;
   asrActive(valid);
  }
  const finalP=waitSignal('最终汇总');
  recognizer.retrieveFinalResult();
  await finalP;
  asrActive(valid);
  return {text:pieces.join('').replace(/\s+/g,'').trim(),pieces};
 }catch(e){
  const cancelled=/识别任务已取消/.test(String(e?.message||e));
  if(!cancelled){if(voskModel===model)voskModel=null;try{model.terminate?.();}catch{}}
  throw e;
 }finally{
  clearPending();
  try{recognizer.remove?.();}catch{}
 }
}
// VOSK_LOADER_END
// UI-R2：中文识别模型是整页共用的，下载不再因为翻页、开播、下播而被悄悄取消；失败需手动重试（已下载的分片留在缓存里，不会重下）；
// 进度显示在所有 [data-vosk-widget] 位置（首页、开播预览、工具面板、复盘页）。
let voskUi={state:'idle',files:0,bytes:0,msg:'',attempt:1},voskAutoTried=false;
const VOSK_FILE_TOTAL=VOSK_PART_NAMES.length+1;
function setParaformerPreparation(state,note=''){
 if(state===paraformerState&&note===paraformerNote)return;
 paraformerState=state;paraformerNote=note;
 renderParaformerPreparation();
 const status=ELEM('liveTurnStatus');
 if(status&&activeTurn)status.textContent=liveTurnStatusText(activeTurn);
}
function renderParaformerPreparation(){
 const widget=document.querySelector('[data-vosk-widget="dark"]'),button=ELEM('prepPreloadVosk');
 const loading=paraformerState==='loading',ready=paraformerState==='ready',failed=paraformerState==='error';
 const label=ready?'✓ Paraformer 已就绪':loading?'正在准备 Paraformer…':failed?'重试准备 Paraformer':'准备 Paraformer';
 if(button){button.textContent=label;button.disabled=loading||ready;}
 if(!widget)return;
 const detail=loading||failed?paraformerNote:ready?'本题录音结束或切题后转写。':'首次约 94 MB，可提前加载；录音结束或切题后转写。';
 widget.innerHTML=`<div class="r2-model dark ${ready?'ready':loading?'busy':failed?'error':'idle'}"><b>普通话 · Paraformer-small</b><small role="status">${ESC(detail)}</small><button type="button" class="btn soft"${loading||ready?' disabled':''}>${label}</button></div>`;
 widget.querySelector('button').onclick=preparePracticeModel;
}
async function preparePracticeModel(){
 if(!usesParaformer)return preloadVoskModel();
 if(paraformerState==='loading'||paraformerState==='ready')return;
 if(voskLoadJob||oneShotAsrJob||asrInferJob||transcriptBusy||r6WhisperRunning)return toast('请等待当前转写处理完成');
 if(!r6WhisperEngine.resetFailure())return;
 releaseVoskForParaformer();
 try{await r6WhisperEngine.preload();}
 catch(e){if(paraformerState==='error')toast('Paraformer 准备失败：'+String(e.message||e).slice(0,100));}
}
function voskWidgetHtml(kind){
 const st=voskModel?'ready':voskUi.state,pct=Math.min(100,Math.round(voskUi.files/VOSK_FILE_TOTAL*100)),mb=(voskUi.bytes/1048576).toFixed(0);
 if(st==='ready')return `<div class="r2-model ready ${kind}"><span class="r2-model-dot"></span><b>备用 Vosk 已就绪</b><small>可用于录后转文字，结果请核对</small></div>`;
 if(st==='loading'||st==='init')return `<div class="r2-model busy ${kind}" role="status"><div class="r2-model-row"><b>${st==='init'?'正在启动备用 Vosk…':'正在下载备用 Vosk'}</b><span>${st==='init'?'约 10–30 秒':pct+'%'}</span></div><div class="r2-bar${st==='init'?' indet':''}"><i style="width:${st==='init'?100:Math.max(4,pct)}%"></i></div><small>${st==='init'?'下载完成，正在校验并启动；进入其他页面不影响下载':`已完成 ${voskUi.files}/${VOSK_FILE_TOTAL} 个文件 · 约 ${mb}/42MiB${voskUi.attempt>1?` · 网络较慢，第 ${voskUi.attempt} 次尝试`:''} · 可以继续操作，下载不会中断`}</small></div>`;
 if(st==='error')return `<div class="r2-model error ${kind}" role="alert"><b>备用 Vosk 没有下载完</b><small>${ESC(voskUi.msg)} 已下载的部分会保留，重试会接着下载。</small><button type="button" class="btn primary" data-vosk-action>${kind==='dark'?'重试':'重试下载'}</button></div>`;
 return `<div class="r2-model idle ${kind}"><b>备用 Vosk 中文识别</b><small>逐题使用 ${asrModelLabel}${usesParaformer?'，首次约94 MB':'，首次转写需联网'}。备用 Vosk 约42MiB，可在需要时手动准备。</small><button type="button" class="btn soft" data-vosk-action>准备备用 Vosk</button></div>`;
}
function renderVoskWidgets(){
 document.querySelectorAll('[data-vosk-widget]').forEach(el=>{if(usesParaformer&&el.dataset.voskWidget==='dark')return;el.innerHTML=voskWidgetHtml(el.dataset.voskWidget||'');el.querySelectorAll('[data-vosk-action]').forEach(btn=>btn.onclick=()=>preloadVoskModel());});
 if(usesParaformer)renderParaformerPreparation();
 if(activeTurn&&ELEM('liveTurnStatus'))ELEM('liveTurnStatus').textContent=liveTurnStatusText(activeTurn);
 const st=voskModel?'ready':voskUi.state,label=st==='ready'?'✓ 中文识别已就绪':st==='loading'?`下载中 ${Math.round(voskUi.files/VOSK_FILE_TOTAL*100)}%`:st==='init'?'正在启动模型…':st==='error'?'重试下载中文模型':'下载中文识别模型';
 for(const id of usesParaformer?['liveToolVosk']:['prepPreloadVosk','liveToolVosk']){const el=ELEM(id);if(el){el.textContent=usesParaformer&&!voskModel&&st==='idle'?'准备备用 Vosk':label;el.disabled=st==='loading'||st==='init';}}
}
async function autoLoadCachedVosk(){
 if(usesParaformer||voskAutoTried||voskModel||voskLoadJob||voskUi.state!=='idle')return;voskAutoTried=true;
 try{if(typeof caches==='undefined')return;const cache=await caches.open(VOSK_CACHE_NAME),keys=await cache.keys();if(keys.length>=VOSK_FILE_TOTAL)void preloadVoskModel({silent:true});}catch{}
}
async function preloadVoskModel(opts={}){
 if(r6WhisperEngine.isResourceBusy?.())return toast('本机转写资源仍被占用，请等待；若已超时，请备份后重新打开页面');
 if(r6WhisperRunning||r6WhisperQueue.length||transcriptBusy||oneShotAsrJob)return toast('当前转写仍在进行，请完成后再准备备用 Vosk');
 const silent=opts&&opts.silent===true;
 if(voskModel){voskUi.state='ready';const msg='中文识别模型已就绪，已准备好录后识别；请核对转写结果。';setVoskPreloadUi(msg,false);enqueueRecordedQuestions();renderQuestionSummary();if(!silent)toast(msg);return;}
 if(voskLoadJob||voskUi.state==='loading'||voskUi.state==='init'){setVoskPreloadUi('中文识别模型正在下载，进度见进度条。',true);if(!silent)toast('中文识别模型正在下载，进度见进度条');return;}
 if(transcriptBusy){const msg='整场转写正在进行，完成后再下载模型';setVoskPreloadUi(msg,false);if(!silent)toast(msg);return;}
 if(navigator.onLine===false&&!silent){voskUi={state:'error',files:0,bytes:0,msg:'当前没有网络。',attempt:1};setVoskPreloadUi('当前没有网络，无法下载中文识别模型。',false);return toast('当前没有网络，无法下载中文识别模型');}
 r6WhisperEngine.dispose?.();
 const always=()=>true,loadTimeout=Math.max(1000,Number(window.__ASR_LOAD_TIMEOUT_MS)||600000),maxAttempts=1;
 let lastError=null;
 for(let attempt=1;attempt<=maxAttempts;attempt++){
  voskUi={state:'loading',files:0,bytes:0,msg:'',attempt};setVoskPreloadUi('正在下载中文识别模型…',true);
  try{
   await awaitBounded(loadVerifiedVosk(always,(p)=>{
    if(p.stage==='download'||!p.file)return;
    voskUi.files=Math.min(VOSK_FILE_TOTAL,voskUi.files+1);voskUi.bytes+=p.bytes||0;if(voskUi.files>=VOSK_FILE_TOTAL)voskUi.state='init';
    setVoskPreloadUi(`中文识别模型 ${voskUi.files}/${VOSK_FILE_TOTAL}${p.cached?'（本机缓存）':''}`,true);
   }),loadTimeout,'中文识别模型准备');
   lastError=null;break;
  }catch(e){lastError=e;if(attempt<maxAttempts)await new Promise(r=>setTimeout(r,Number(window.__VOSK_RETRY_DELAY_MS)||1500));}
 }
 if(lastError){
  voskUi.state='error';voskUi.msg=String(lastError?.message||lastError).replace(/Vosk/g,'识别模型').slice(0,120)+'。';
  setVoskPreloadUi('中文识别模型没有下载完：'+voskUi.msg+' 已下载的部分会保留，可点「重试下载」。',false);renderQuestionSummary();if(!silent)toast('中文识别模型没有下载完，可重试');
 }else{
  voskUi.state='ready';setVoskPreloadUi('中文识别模型下载并校验完成，可用于录后转文字，结果请核对。',false);if(isRunPage()&&runId){enqueueRecordedQuestions();renderQuestionSummary();}toast('中文识别模型已就绪');
 }
 renderSessionReview();
}

async function transcribeSessionVideo(engine='selected'){
 const useVosk=engine==='vosk';
 if(r6WhisperEngine.isResourceBusy?.())return toast('本机转写资源仍被占用，请等待；若已超时，请备份后重新打开页面');
 if(transcriptBusy||oneShotAsrJob||r6WhisperRunning||r6WhisperQueue.length){toast('转写正在进行，请完成后再识别整场录像');return;}
 if(audioDecodeJob||asrInferJob||(voskLoadJob&&!voskModel)){
  const msg='上一次解码/模型加载/识别仍在后台执行，不能重复占用手机资源。请先下载原视频，等待完成后再试';
  if(ELEM('transcribeStatus'))ELEM('transcribeStatus').textContent=msg;
  return toast(msg);
 }
 if(!sessionVideoBlob||videoRecorderFinalizing)return toast('请先结束直播并等待原始录像封装完成');
 const board=selectedBoard,platform=activePlatform,source=sessionVideoBlob,session=++transcriptSeq;
 try{ensureDecodeBudget(source)}catch(e){if(ELEM('transcribeStatus'))ELEM('transcribeStatus').textContent=e.message;return toast(e.message)}
 const status=ELEM('transcribeStatus'),button=ELEM('transcribeVideoBtn'),wBtn=ELEM('transcribeWhisperBtn'),editor=ELEM('postTranscript');
 if(!status||!button||!editor)return;
 const snapshot=lastSessionSnapshot?.id===runId?lastSessionSnapshot:null;
 const originalDraft=editor.value;
 const alreadyEdited=snapshot?.postTranscriptManualEdited===true||
  !!(snapshot&&snapshot.postTranscriptManualEdited===undefined&&originalDraft.trim());
 let editedDuringRecognition=false;
 const markEdited=()=>{editedDuringRecognition=true;};
 editor.addEventListener('input',markEdited);
 transcriptBusy=true;button.disabled=true;if(wBtn)wBtn.disabled=true;
 const valid=()=>session===transcriptSeq&&source===sessionVideoBlob&&isRunPage()&&board===selectedBoard&&platform===activePlatform&&ELEM('transcribeStatus')===status&&ELEM('postTranscript')===editor&&(!snapshot||lastSessionSnapshot===snapshot);
 try{
  status.textContent='正在从原录像的独立数据副本解码音频（原文件及音画时间轴保持不变）…';
  const rawPcm=await awaitBounded(decodeAudioCopy(source),Number(window.__ASR_DECODE_TIMEOUT_MS)||60000,'原录像解码');
  asrActive(valid);
  if(rawPcm.length<16000)throw new Error('有效音频不足1秒，不能识别');
  const trimmed=usesParaformer&&!useVosk?null:trimAsrSilence(rawPcm,16000,{recoverQuiet:useVosk});
  if(trimmed&&!trimmed.hasSpeech){
   status.textContent='录后转写未执行：未检测到有效语音（有效人声不足1秒），未下载或调用识别模型。原视频未损坏。';
   return;
  }
  const pcm=trimmed?.pcm||rawPcm;
  let rawText='',engineLabel='';
  if(useVosk){
   engineLabel='Vosk 中文离线模型';
   // V3.3.10：静音检查之后再确认；真实浏览器与测试同一行为（不再区分测试替身）。若内置浏览器不支持确认框会返回取消，此时可改用预下载按钮。
   if(!voskModel&&!window.confirm('首次准备 Vosk 中文离线识别模型需下载约 48MB 资源（建议在 Wi-Fi 环境下进行，校验通过后本机缓存复用）。是否继续？')){
    status.textContent='已取消Vosk中文模型下载；原视频未改动。如果没有看到确认框，可点「预下载/校验 Vosk 中文模型（48MB）」直接下载，完成后再转文字。';
    return;
   }
   r6WhisperEngine.dispose?.();
   status.textContent='正在准备 Vosk 中文识别模型（首次需下载约48MB并校验SHA-256，完成后自动缓存）…';
   const loadTimeout=Math.max(1000,Number(window.__ASR_LOAD_TIMEOUT_MS)||300000);
   const model=await awaitBounded(loadVerifiedVosk(valid,(p)=>{
    if(!valid())return;
    if(p.stage==='download')status.textContent=`正在下载 Vosk 中文模型分片 (${p.index}/${p.total}) · ${p.file}…`;
   }),loadTimeout,'Vosk模型准备');
   asrActive(valid);
   status.textContent='Vosk 中文模型已就绪，正在本机识别有效语音片段…';
   const inferJob=recognizeVosk(model,pcm,valid);
   asrInferJob=inferJob;inferJob.finally(()=>{if(asrInferJob===inferJob){asrInferJob=null;void r6WhisperDrain();void drainQuestionAsrQueue();}}).catch(()=>{});
   const res=await awaitBounded(inferJob,Number(window.__ASR_INFER_TIMEOUT_MS)||240000,'Vosk端侧识别');
   asrActive(valid);
   rawText=String(res?.text||'').trim();
  }else{
   releaseVoskForParaformer();
   r6WhisperEngine.resetFailure?.();
   engineLabel=asrModelLabel;
   status.textContent='正在使用 '+asrModelLabel+' 识别整场音频，首次需下载模型…';
   const job=r6WhisperEngine.transcribePreparedAudio({data:pcm,sampleRate:16000,duration:pcm.length/16000});
   asrInferJob=job;job.finally(()=>{if(asrInferJob===job){asrInferJob=null;void r6WhisperDrain();void drainQuestionAsrQueue();}}).catch(()=>{});
   const result=await job;
   asrActive(valid);
   rawText=String(result?.text||'').trim();
  }
  if(!rawText)throw new Error('模型未返回有效文字');
  const assessed=assessAsrText(rawText,useVosk||!usesParaformer);
  if(!assessed.text)throw new Error('模型未返回有效中文内容');
  const numeric=finalizeAsrText(assessed.text);
  const keepDraft=alreadyEdited||editedDuringRecognition||editor.value!==originalDraft;
  if(!keepDraft)editor.value=numeric.text;
  if(snapshot){
   snapshot.postTranscript=editor.value;
   snapshot.postTranscriptRaw=rawText;
   snapshot.postTranscriptManualEdited=keepDraft;
   if(keepDraft)snapshot.postTranscriptCandidate=numeric.text;
   else delete snapshot.postTranscriptCandidate;
   void persistSessionCheckpoint();
  }
  const warnNote=assessed.warnings.length?`注意：${assessed.warnings.join('；')}。`:'';
  status.textContent=`录后识别完成（引擎：${engineLabel}）。${keepDraft?'已保留你编辑的整场文字。':''}${warnNote}${numeric.changes?'已规范化'+numeric.changes+'处口述数字（请重点核对）！':''}请对照原视频校对数字、型号、价格和同音字；不会自动将整场文字错误分配到单题。本次未修改原始录像。`;
 }catch(e){
  if(valid())status.textContent='录后转写未完成：'+(e.message||e)+'。原视频未损坏、可下载回放；可手动补录文字。';
 }finally{
  editor.removeEventListener('input',markEdited);
  if(session===transcriptSeq){
   transcriptBusy=false;
   if(ELEM('transcribeVideoBtn'))ELEM('transcribeVideoBtn').disabled=!sessionVideoBlob;
   if(ELEM('transcribeWhisperBtn'))ELEM('transcribeWhisperBtn').disabled=!sessionVideoBlob;
   void r6WhisperDrain();enqueueRecordedQuestions();
  }
 }
}

async function submitAnswer(){
 const turn=activeTurn;
 if(!turn)return toast('请先开始训练');
 const text=ELEM('answerText').value.trim();
 if(text.length<5)return toast('请先说出并填写至少5个字的练习回答');
 if(turn.runId!==runId||turn.boardId!==selectedBoard||turn.platform!==activePlatform)return toast('当前题目会话已过期');
 turn.answer=text;turn.manualEdited=true;turn.manualCleared=false;turn.compliance=complianceHints(text,turn.platform);
 turn.pointsHit=(turn.keyPoints||[]).filter((p,i)=>fuzzyPoint(p,text,turn.pointKeywords?.[i]||[]));
 turn.asrStatus=turn.transcript?'已转写并人工核对':'手动编辑回答';
 renderTurnStatus(turn);const saved=await saveTurn(turn);if(!saved||turn.runId!==runId||!ELEM('scoreBox'))return;renderTurnStatus(turn);
 ELEM('scoreBox').innerHTML=`<div class="notice green"><b>本题练习已保存（本机）</b><br>合规仅提供参考提示，需人工复核的规则不自动判违规；要点覆盖使用关键词/同义表达自查，不是正式AI评分。</div>`;
 toast('本题练习记录已保存');
}

function hasUnsavedReviewEdits(){
 return !!ELEM('questionSummary')?.querySelector('textarea[data-dirty="true"]');
}
function paintReviewEvaluation(){
 const panel=ELEM('reviewAiEvaluation'),submitted=reviewSubmission();
 if(!panel)return;
 panel.hidden=!submitted?.cloudConfirmed;
 if(!panel.hidden)setEvaluationReadback(panel.querySelector('[data-ai-eval-output]'),submitted);
}

function refreshReviewEvaluation({immediate=true}={}){
 const panel=ELEM('reviewAiEvaluation'),submitted=reviewSubmission(),snap=lastSessionSnapshot;
 if(!panel||!submitted?.cloudConfirmed||!snap?.assignmentId||syncMember()?.role!=='anchor')return;
 const refresh=ELEM('reviewAiRefresh'),message=panel.querySelector('[data-ai-eval-load]');
 if(refresh.disabled)return;
 const initial={id:submitted.cloudId,repositoryReview:submitted.repositoryReview};
 watchRepositoryReviews(panel,[initial],{
  immediate,
  visible:()=>page==='sessionReview'&&lastSessionSnapshot===snap&&reviewSubmission()===submitted,
  load:async()=>{
   refresh.disabled=true;
   setNodeText(message,'正在读取云端评选…');
   try{
    const rows=await assignmentSync.mySubmissions(snap.assignmentId);
    return rows.filter(row=>row.id===submitted.cloudId);
   }finally{refresh.disabled=false;}
  },
  update:rows=>{
   const record=rows[0];
   if(!record){setNodeText(message,'暂未读到这条云端提交，请刷新重试。');return;}
   submitted.evaluation ||= record.evaluation;
   submitted.repositoryReview=record.repositoryReview;
   setNodeText(message,'');
   paintReviewEvaluation();
  },
  onError:retry=>setNodeText(message,retry?'暂时无法读取评选状态，稍后会自动重试。':'评选状态读取未完成，请稍后刷新。'),
 });
}

function buildSessionIssues(snap){
 const turns=snap?.turns||[],unanswered=turns.filter(t=>t.manualCleared||!(t.answer||t.transcript)).length,risk=turns.reduce((n,t)=>n+(t.compliance||[]).length,0),hit=turns.reduce((n,t)=>n+(t.pointsHit||[]).length,0),total=turns.reduce((n,t)=>n+(t.keyPoints||[]).length,0);const issues=[];
 if(unanswered)issues.push(`${unanswered} 条弹幕还没有形成完整文字回答`);if(total&&hit<total)issues.push(`训练要点覆盖 ${hit}/${total}，可以针对遗漏点再练一次`);if(risk)issues.push(`有 ${risk} 条合规提示需要人工复核`);if(!issues.length)issues.push('本场逐题记录完整，可根据自己的直播表现决定是否提交');return {issues,unanswered,risk,hit,total};
}
function refreshReviewMetrics(){
 const snap=lastSessionSnapshot;if(page!=='sessionReview'||!snap)return;
 const stats=buildSessionIssues(snap),answered=ELEM('reviewAnswered'),coverage=ELEM('reviewCoverage'),issues=ELEM('reviewIssues');
 if(answered)answered.textContent=String(snap.turns.filter(t=>!t.manualCleared&&(t.answer||t.transcript)).length);
 if(coverage)coverage.textContent=stats.total?`${stats.hit}/${stats.total}`:'—';
 if(issues){issues.replaceChildren();stats.issues.slice(0,3).forEach((text,i)=>{const row=document.createElement('div'),number=document.createElement('span'),p=document.createElement('p');row.className='review-tip';number.textContent=String(i+1);p.textContent=text;row.append(number,p);issues.append(row)});}
}
// V3.5.2: three independent full-screen review views. All review DOM stays mounted
// while switching, so background video finalization and Vosk/ASR callbacks retain
// their element targets and ownership checks. No scrollIntoView navigation.
function showReviewStage(target,{recordHistory=true}={}){
 if(page!=='sessionReview'||!reviewAlive())return;
 const stage=['overview','replay','details'].includes(target)?target:'overview';
 const old=reviewStage;reviewStage=stage;
 [['overview','reviewOverview'],['replay','reviewReplayScreen'],['details','reviewDetailsScreen']].forEach(([key,id])=>{const node=ELEM(id);if(node){node.hidden=key!==stage;node.setAttribute('aria-hidden',String(key!==stage));}});
 document.body.dataset.reviewStage=stage;
 const title=stage==='replay'?'本场录像回放':stage==='details'?'逐题复盘':'练播复盘';
 if(ELEM('pageTitle'))ELEM('pageTitle').textContent=title;
 if(stage!==old){

  if(old==='details')for(const item of reviewQuestionAudioUrls){try{item.player.pause()}catch{}}
  const focusId=stage==='overview'?(old==='details'?'reviewDetails':'reviewReplay'):stage==='details'?'reviewDetailsBack':'reviewReplayBack';
  ELEM(focusId)?.focus?.({preventScroll:true});
  const currentVideo=ELEM('sessionArchiveHolder')?.querySelector('video');
  if(stage!=='replay'&&currentVideo&&!currentVideo.paused){try{currentVideo.pause()}catch{}}
  window.scrollTo({top:0,behavior:'instant'});
 }
 // Keep browser Back intuitive without treating a subpage as a new training run.
 if(recordHistory&&stage!=='overview'&&stage!==old){try{if(old==='overview')history.pushState({tclApp:true,reviewStage:stage},'');else history.replaceState({tclApp:true,reviewStage:stage},'')}catch{}}
 if(stage==='overview'){refreshReviewMetrics();}
 if(stage==='details'){renderQuestionSummary();}
}
function backToReviewOverview(){
 if(page!=='sessionReview'||reviewStage==='overview')return;
 showReviewStage('overview',{recordHistory:false});
 // Consume the single subpage history entry instead of accumulating stale overview entries.
 // Native browser Back also uses popstate to return to overview; no extra route is pushed.
 try{if(history.state?.reviewStage)history.back()}catch{}
}
function sessionReviewPage(){
 const snap=lastSessionSnapshot;if(!snap||!reviewAlive()){page='home';return render();}
 reviewParked=false;reviewStage='overview';setTitle('练播复盘');
 try{history.replaceState({tclApp:true,reviewRun:snap.id},'')}catch{}
 const stats=buildSessionIssues(snap),answered=snap.turns.filter(t=>!t.manualCleared&&(t.answer||t.transcript)).length,
 assignment=assignmentForReview(snap),operatorNames=[...new Set(localAssignments.map(x=>x.operatorName).filter(Boolean))],
 submitted=reviewSubmission();
 const iconReplay='<span class="review-tile-icon" aria-hidden="true">▶</span>';
 const iconDetail='<span class="review-tile-icon" aria-hidden="true">▤</span>';
 ELEM('view').innerHTML=`<section class="postlive-screen review-flow" id="postliveScreen">
 <div id="localSessionSaveStatus" class="notice" role="status"></div>
 <section id="reviewOverview" class="review-stage review-overview" aria-label="练播复盘总览">
  <div class="postlive-top"><button type="button" class="postlive-icon" id="reviewHome" aria-label="返回练播房首页">‹</button><div><strong>练播复盘</strong><small>${ESC(snap.category)} · ${ESC(snap.platform)}</small></div><span class="postlive-done">本场已结束</span></div>
  <div class="result-card"><span class="result-pill">本场训练记录</span><h2>练播完成！</h2><p>本场复盘已生成。这里是客观数据，不是正式 AI 评分。</p><div class="result-metrics"><div><b>${ESC(formatPracticeDuration(snap.durationSeconds))}</b><small>训练时长</small></div><div><b>${snap.turns.length}</b><small>弹幕题数</small></div><div><b id="reviewAnswered">${answered}</b><small>已有回答</small></div><div><b id="reviewCoverage">${stats.total?`${stats.hit}/${stats.total}`:'—'}</b><small>要点覆盖 · 参考</small></div></div></div>
  <div class="review-next-flow" aria-label="推荐复盘顺序"><span class="review-next-current">01 录像回看</span><span>02 校正逐题回答</span><span>03 决定是否提交</span></div><div class="review-priority"><div class="review-heading"><h3>下一步可以改进</h3><span>训练建议 · 非自动评分</span></div><div id="reviewIssues">${stats.issues.slice(0,2).map((x,i)=>`<div class="review-tip"><span>${i+1}</span><p>${ESC(x)}</p></div>`).join('')}</div></div>
  <div class="review-actions review-link-grid"><button type="button" class="review-action" id="reviewReplay">${iconReplay}<b>查看录像回放</b><small>独立播放页面</small><span aria-hidden="true">›</span></button><button type="button" class="review-action" id="reviewDetails">${iconDetail}<b>逐题复盘详情</b><small>查看、修正回答</small><span aria-hidden="true">›</span></button></div>
  ${reviewSubmitHtml(assignment,operatorNames,submitted)}
  <button type="button" id="reviewRetry" class="review-retry-link">↻ 不满意？再练一次</button>
 </section>
 <section id="reviewReplayScreen" class="review-stage review-replay-screen" aria-label="本场录像回放" hidden aria-hidden="true">
  <div class="review-subbar"><button type="button" id="reviewReplayBack" class="review-back" aria-label="返回复盘总览">‹ <span>返回复盘</span></button><div><h2>本场录像</h2><small>${ESC(snap.category)} · ${ESC(snap.platform)}</small></div><span class="review-subbadge">回放</span></div>
  <div class="review-player-panel"><div class="review-player-title"><span class="review-playing-dot"></span><b>本场原始录像</b><small>视频仅保存在当前浏览器</small></div><div id="sessionArchiveStatus" class="scene-tip" aria-live="polite">录像正在整理…</div><div id="sessionArchiveHolder" class="review-media-holder"></div></div>
  <div class="review-secondary-link"><button type="button" id="reviewGoDetails" class="review-inline-link">▤ 查看逐题复盘 <span>›</span></button></div>
  <details class="review-tools-fold" id="reviewToolsFold"><summary><span>⚙ 更多工具</span><small>录后识别 · 备用 Vosk · 音频导出</small></summary><div class="review-tools-content"><div data-vosk-widget="card" aria-label="中文语音模型进度"></div><div class="review-tool-grid"><button id="transcribeVideoBtn" type="button" class="btn primary" disabled>从录像转文字（${asrModelLabel}）</button><button id="transcribeWhisperBtn" type="button" class="btn soft" disabled>备用 Vosk 识别</button><button id="preloadVoskBtn" type="button" class="btn soft">准备 Vosk 中文模型（约48MB）</button><button id="downloadWavBtn" type="button" class="btn soft" disabled>导出 WAV 音频</button></div><p class="scene-tip">录后识别及 WAV 提取只支持不超过180秒、48MB的录像，识别结果必须人工校正。长录像请下载原文件另行处理。</p><div id="transcribeStatus" class="scene-tip" aria-live="polite"></div><div class="field"><label for="postTranscript">整场录后文字（不自动分配给单题）</label><textarea id="postTranscript" rows="5" placeholder="可以校正文本，再到逐题复盘选择具体题目填入"></textarea></div></div></details>
  <p class="review-foot-hint">请确认本机恢复保存状态，并下载原始录像备份；清理浏览器数据会删除本机保存。</p>
 </section>
 <section id="reviewDetailsScreen" class="review-stage review-details-screen" aria-label="逐题复盘详情" hidden aria-hidden="true">
  <div class="review-subbar"><button type="button" id="reviewDetailsBack" class="review-back" aria-label="返回复盘总览">‹ <span>返回复盘</span></button><div><h2>逐题复盘</h2><small>${snap.turns.length} 条弹幕 · 按题校正</small></div><span class="review-subbadge">详情</span></div>
  <div class="review-details-intro"><b>每道弹幕逐条查看</b><p>识别可能有错别字或型号偏差。你可以修改回答并单独保存。要点覆盖属于参考提示，不是 AI 自动打分。</p></div>
  <div id="questionSummary" class="review-question-cards" aria-live="polite"></div>
  <div class="review-secondary-link"><button type="button" id="reviewGoReplay" class="review-inline-link">▶ 打开本场录像 <span>›</span></button></div>
 </section>
 </section>`;
 ELEM('reviewHome').onclick=()=>{activeAssignmentId='';nav('home')};
 if(ELEM('exportAssignmentReceipt'))ELEM('exportAssignmentReceipt').onclick=()=>{const record=reviewSubmission();if(record?.assignmentReceipt)downloadJSON('TCL-主播作业提交回执-'+record.id+'.json',record.assignmentReceipt);};
 ELEM('reviewRetry').onclick=()=>openBoard(snap.boardId,snap.platform,{assignmentId:snap.assignmentId||'',checkDevicesOnOpen:true});
 ELEM('reviewReplay').onclick=()=>showReviewStage('replay');
 ELEM('reviewDetails').onclick=()=>showReviewStage('details');
 if(ELEM('reviewAiRefresh'))ELEM('reviewAiRefresh').onclick=()=>refreshReviewEvaluation();
 ELEM('reviewReplayBack').onclick=backToReviewOverview;
 ELEM('reviewDetailsBack').onclick=backToReviewOverview;
 ELEM('reviewGoDetails').onclick=()=>showReviewStage('details');
 ELEM('reviewGoReplay').onclick=()=>showReviewStage('replay');
 {const pt=ELEM('postTranscript');if(pt){pt.value=snap.postTranscript||'';pt.oninput=()=>{snap.postTranscript=pt.value;snap.postTranscriptManualEdited=true;void persistSessionCheckpoint()};}}
 ELEM('transcribeVideoBtn').onclick=()=>transcribeSessionVideo();
 ELEM('transcribeWhisperBtn').onclick=()=>transcribeSessionVideo('vosk');
 ELEM('preloadVoskBtn').onclick=preloadVoskModel;
 ELEM('downloadWavBtn').onclick=downloadAudioCopy;
 if(ELEM('submitSession'))ELEM('submitSession').onclick=()=>submitSessionRecord(assignment?.operatorName||ELEM('submitOperator')?.value.trim()||'');
 bindAudioRetries(ELEM('view'));
 renderSessionReview();renderQuestionSummary();showReviewStage('overview',{recordHistory:false});showSessionStorageState();
 paintReviewEvaluation();
 refreshReviewEvaluation();
}

async function submitSessionRecord(operatorName){
 const snap=lastSessionSnapshot;if(userRole!=='anchor'||!userName||!snap||snap.anchorName!==userName)return toast('当前身份不能提交该记录');
 if(submissionSaving)return toast('正在保存提交，请稍候');
 if(syncMember()&&snap.assignmentId&&hasUnsavedReviewEdits())return toast('请先在逐题复盘中保存已编辑的回答，再提交作业');
 if(oneShotAsrJob||questionAsrQueue.length||recorderFinalizing||speechRecognizer||videoRecorderFinalizing||transcriptBusy)return toast('识别或录音录像整理尚未完成，请等待后再提交');
 if(snap.assignmentId){const assignment=assignmentForReview(snap);if(!assignment||assignment.boardId!==snap.boardId||assignment.platform!==snap.platform||!assignment.operatorName||snap.operatorName!==assignment.operatorName||!isAssigned(assignment,snap.anchorName))return toast('作业信息不匹配，无法提交');operatorName=assignment.operatorName;}
 operatorName=String(operatorName||'').trim();if(!operatorName)return toast('请输入运营姓名');if(reviewSubmission())return toast(syncMember()?'这次训练已经提交到云端':'这次训练已经保存在本机');
 if(r6WhisperRunning||r6WhisperQueue.length){
  if(!syncMember()||!snap.assignmentId||!snap.turns.every(turn=>turn.answer?.trim()||turn.transcript?.trim()||turn.manualCleared))return toast('逐题转写尚未完成。你也可以在逐题复盘中核对并手动填写答案。');
  if(!window.confirm('部分录音仍在转写。是否提交目前的答案、已经生成的转写和逐题录音？'))return;
  r6WhisperCancelAll('本次提交使用已核对文字，原录音保留');
 }
 const lateAssignment=assignmentForReview(snap),late=!!(lateAssignment&&assignmentExpired(lateAssignment));
 const id=uid();const turns=snap.turns.map(t=>({id:t.id,...turnReferenceSnapshot(t),prompt:t.prompt,trainingHint:t.trainingHint||'',answer:t.answer||'',transcript:t.transcript||'',rawTranscript:t.rawTranscript||'',manualEdited:!!t.manualEdited,manualCleared:!!t.manualCleared,responseSeconds:t.responseSeconds??null,durationSeconds:t.durationSeconds??null,pointsHit:t.pointsHit||[],keyPoints:t.keyPoints||[],compliance:t.compliance||[],asrStatus:t.asrStatus||''}));
 const audio=snap.turns.filter(t=>perQuestionAudio.has(t.id)).map(t=>({id:t.id,questionId:t.questionId,prompt:t.prompt,blob:perQuestionAudio.get(t.id)}));
 const media={id:'submission-media:'+id,video:sessionVideoBlob||null,audio};
 const submission={id,sessionId:snap.id,assignmentId:snap.assignmentId||'',operatorName,anchorName:snap.anchorName,boardId:snap.boardId,category:snap.category,platform:snap.platform,submittedAt:nowIso(),durationSeconds:snap.durationSeconds,turns,videoRecorded:!!sessionVideoBlob,late};
 submissionSaving=true;const btn=ELEM('submitSession');if(btn)btn.disabled=true;
 const snapshotFingerprint=JSON.stringify(snap),current=()=>userRole==='anchor'&&userName===snap.anchorName&&runId===snap.id&&lastSessionSnapshot===snap&&JSON.stringify(snap)===snapshotFingerprint;
 try{
  if(lateAssignment?.schema){await verifyAssignmentSnapshot(lateAssignment,snap,{board:boardById(lateAssignment.boardId)});if(!current())throw new Error('本场回答或身份已变化，请重新核对后提交');submission.assignmentSnapshotSha256=snap.assignmentSnapshotSha256;submission.assignmentVersion=snap.assignmentVersion;if(!syncMember())submission.assignmentReceipt=toReceipt(lateAssignment,snap);}
  if(!await persistSessionCheckpoint())throw new Error('本场记录未成功保存，未提交给运营');
  if(userRole!=='anchor'||userName!==snap.anchorName||runId!==snap.id||lastSessionSnapshot!==snap)throw new Error('当前身份或场次已变化，未提交');
  if(syncMember()&&lateAssignment){
   if(!current())throw new Error('本场记录已变化，请核对后重试');
   const payload=cloudSubmissionPayload(snap);
   const result=await assignmentSync.submit(payload);
   const accepted=result.submission;
   if(accepted?.sessionId!==snap.id||accepted.assignmentId!==snap.assignmentId||!accepted.submittedAt||!accepted.id)throw new Error('云端回执未确认，请重试');
   submission.cloudId=accepted.id;
   if(accepted.evaluation)submission.evaluation=accepted.evaluation;
   if(accepted.repositoryReview)submission.repositoryReview=accepted.repositoryReview;
   submission.audioPendingIds=audio.filter(cloudAudioAcceptable).map(clip=>clip.questionId);
   submission.audioUploadedIds=[];
   submission.audioLocalOnly=audio.length-submission.audioPendingIds.length;
   fallbackSubmissionMedia=media;
   submission.cloudConfirmed=true;submission.submittedAt=accepted.submittedAt;submission.late=accepted.late===true;
   syncSubmitStatus.set(snap.id,submission);
   cloudAssignments=cloudAssignments.map(row=>row.assignment.id===snap.assignmentId?{...row,submitted:true}:row);
  }
  const committed=await commitSubmission(submission,lastTrainingLogId,media,checkpointCursor.token,current);localSubmissions=committed.submissions;localTrainingLogs=committed.logs;notifyWorkflowChange('submissions');if(userRole!=='anchor'||userName!==snap.anchorName)return;toast(submission.cloudConfirmed?'已提交到云端，接收运营可查看':submission.assignmentReceipt?'已保存到本机，请发送 JSON 回执':'已保存到本机');
   if(submission.assignmentReceipt)downloadJSON('TCL-主播作业提交回执-'+id+'.json',submission.assignmentReceipt);if(btn?.isConnected)btn.textContent=submitStatusText(submission);
   if(submission.cloudConfirmed){
    if(fallbackSubmissionMedia===media)fallbackSubmissionMedia=null;
    paintCloudAudioStatus(submission);
    void uploadCloudAudio(submission,media);
   }
  }
 catch(e){
  if(submission.cloudConfirmed){
   if(btn?.isConnected)btn.textContent=submitStatusText(submission);
   toast('文字已提交到云端。本机归档未确认，请下载录像备份');
   paintCloudAudioStatus(submission);
   void uploadCloudAudio(submission,media);
  }
  else{if(btn?.isConnected)btn.disabled=false;toast((syncMember()?'未收到云端确认，本机记录可重试：':'提交未保存：')+(e?.message||e));}
 }
 finally{
  submissionSaving=false;
  if(submission.cloudConfirmed){
   paintReviewEvaluation();
   refreshReviewEvaluation({immediate:!submission.repositoryReview&&!submission.evaluation});
  }
 }
}
// V3.4.9：搜索时只刷新结果列表，不重建输入框，连续输入和中文输入法组合输入不会失焦。
function libraryRows(){return getEntries().filter(e=>e.status==='published'&&(!librarySearch||norm([e.question,e.answer,e.category,e.platform,e.model,e.sku,e.sourceRef,...(e.keyPoints||[])].filter(Boolean).join(' ')).includes(norm(librarySearch)))&&(selectedLibraryBoard==='all'||e.boardId===selectedLibraryBoard||e.scope==='category'&&e.category===boardById(selectedLibraryBoard).category));}
function libraryCardHtml(q){return `<div class="q-card"><div class="q-meta"><span class="pill">${ESC(q.category)}</span><span class="pill">${ESC(q.platform||'公共')}</span><span class="pill ${q.kind==='seed'?'warn':'good'}">${q.kind==='seed'?'教学示例':modelRequiredForQuestion(q)?'待补型号 · 暂不出题':'已审核回答'}</span></div><h3>${q.danmuType?`<span class="pill">${ESC(q.danmuType)}</span> `:''}${ESC(q.question)}</h3>${questionMetadataHtml(q)}${q.intent?`<p class="r2-intent"><b>消费者意图：</b>${ESC(q.intent)}</p>`:''}<p class="r2-answer">${ESC(q.answer||'暂无审核完成的参考答案，先思考自己会如何回答。')}</p><div class="q-meta">${(q.keyPoints||[]).map(k=>`<span class="pill">${ESC(k)}</span>`).join('')}</div></div>`;}
let libraryVisibleCount=8;
function renderLibraryList(){const list=ELEM('libraryList'),count=ELEM('libraryCount'),more=ELEM('libraryMore');if(!list)return;const rows=libraryRows(),visible=Math.min(rows.length,libraryVisibleCount);list.innerHTML=rows.slice(0,visible).map(libraryCardHtml).join('')||'<div class="empty compact">没有找到相关问答，试试其他关键词或板块。</div>';if(count)count.textContent=`已显示 ${visible} / ${rows.length} 条`;if(more){more.hidden=visible>=rows.length;more.textContent=`再显示 ${Math.min(8,rows.length-visible)} 条`;}}
function library(){setTitle('问答知识库');libraryVisibleCount=8;ELEM('view').innerHTML=`<div class="section-title"><div><h2>从优秀回答中学习</h2><p>查看已审核发布的问答。原有教学题目只有训练要点，不伪造成熟参考答案。</p></div></div><div class="panel r3-library"><div class="cols-2"><div class="field"><label for="librarySearch">搜索问题、回答或知识点</label><div class="r3-search"><input id="librarySearch" value="${ESC(librarySearch)}" placeholder="例如：安装、噪音、耗电、退换货"><button type="button" id="libraryClear" aria-label="清除搜索内容">清除</button></div></div><div class="field"><label for="libraryBoard">筛选训练板块</label><select id="libraryBoard"><option value="all">全部板块</option>${BOARDS.map(b=>`<option value="${b.id}" ${b.id===selectedLibraryBoard?'selected':''}>${b.id} ${ESC(b.category)} · ${ESC(b.display_platform)}</option>`).join('')}</select></div></div><div class="notice blue">只有运营审核通过的资料才应进入正式学习库。当前本机演示数据不等于云端持久化；真正跨设备同步需要连接后端数据库。</div><div class="r3-library-count" id="libraryCount" role="status"></div><div class="question-list" id="libraryList"></div><button class="btn soft r3-library-more" type="button" id="libraryMore" hidden>显示更多</button></div>`;renderLibraryList();const search=ELEM('librarySearch');search.oninput=e=>{librarySearch=e.target.value;if(!e.isComposing){libraryVisibleCount=8;renderLibraryList()}};search.oncompositionend=e=>{librarySearch=e.target.value;libraryVisibleCount=8;renderLibraryList()};ELEM('libraryClear').onclick=()=>{librarySearch='';search.value='';libraryVisibleCount=8;renderLibraryList();search.focus()};ELEM('libraryMore').onclick=()=>{libraryVisibleCount+=8;renderLibraryList()};ELEM('libraryBoard').onchange=e=>{selectedLibraryBoard=e.target.value;libraryVisibleCount=8;renderLibraryList()};}
function progress(){setTitle('我的练习记录');ELEM('view').innerHTML=`<div class="section-title"><div><h2>逐题记录</h2><p>${syncMember()?'这里展示本机逐题练习。已提交作业的 AI 评选可在云端提交记录中查看。':'这些逐题记录保存在当前浏览器。'}</p></div><button class="btn" id="backupRecords">导出个人记录</button></div><div class="panel"><div class="question-list">${ownRecords().slice(0,100).map(r=>{const shown=r.manualCleared?'已清空回答':r.answer||r.transcript||(r.durationSeconds!=null?'仅录音，尚未转写':'尚无文字回答');return `<div class="q-card"><div class="q-meta"><span>${ESC(new Date(r.createdAt).toLocaleString('zh-CN'))}</span><span>${ESC(r.category)}</span><span>${ESC(r.platform)}</span><span>${ESC(r.asrStatus||'未转写')}</span><span>${r.durationSeconds==null?'—':ESC(r.durationSeconds)+'秒'}</span></div><h3>${ESC(r.prompt||r.question)}</h3><p>${ESC(shown)}</p>${referenceDetailsHtml(r)}<span class="pill warn">${ESC(r.result)}</span></div>`}).join('')||'<div class="empty">还没有练习记录，进入专项训练并提交回答即可保存。</div>'}</div></div>`;ELEM('backupRecords').onclick=()=>downloadJSON('TCL-我的练习记录.json',ownRecords());}
function legacy(){setTitle('原12周 · 进阶拓展');const mods=[...new Set(legacyCards.map(c=>c.module))];const rows=legacyCards.filter(c=>selectedLegacyFilter==='all'||c.module===selectedLegacyFilter);ELEM('view').innerHTML=`<div class="hero"><div><span class="eyebrow">LEGACY LEARNING · ARCHIVED</span><h2>原版 65 张话术卡 · 自由学习</h2><p>原 12 周养成体系完整保留，并与 16 个专项训练入口并列开放。历史卡片含未经核验的促销、价格、功能和服务承诺，仅供拆解表达方法，不作为真实直播标准答案。</p></div></div><div class="notice">历史话术只是学习材料。带有金额、时效、库存、服务范围等承诺的表达，必须在正式直播前验证商品及当期活动凭证。</div><div class="toolbar"><div class="segmented"><button data-legacy="all" class="${selectedLegacyFilter==='all'?'selected':''}">全部65张</button>${mods.map(m=>`<button data-legacy="${ESC(m)}" class="${m===selectedLegacyFilter?'selected':''}">${ESC(m)}</button>`).join('')}</div></div><div class="legacy-grid">${rows.map(c=>`<div class="legacy-card"><div class="q-meta"><span class="pill">${ESC(c.card_id)}</span><span class="pill">${ESC(c.module)}</span>${c.risk_labels.length?'<span class="pill warn">需核验</span>':'<span class="pill">结构参考</span>'}</div><p><b>${ESC(c.safe_teaching_objective)}</b> · ${ESC(c.group)}</p><p>历史原文：${ESC(c.original_text)}</p><div class="q-meta">${c.risk_labels.map(s=>`<span class="pill warn">${ESC(s)}</span>`).join('')}</div></div>`).join('')}</div>`;document.querySelectorAll('[data-legacy]').forEach(x=>x.onclick=()=>{selectedLegacyFilter=x.dataset.legacy;legacy()});}
// Source columns take priority. Interface choices fill only missing values.
function normalizedImportScope(row,ctx){
 const fallback=boardById(ctx.boardId),key=x=>String(x||'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
 const categories=new Map(BOARDS.map(b=>[key(b.category),b.category]));
 for(const [alias,canonical]of Object.entries({'空调':'TCL 空调','冰箱':'TCL 冰箱','洗衣机':'TCL 洗衣机','tcl全品类':'TCL 全品类','本地生活服务':'本地生活','tcl智能门锁':'智能门锁'}))categories.set(key(alias),canonical);
 const rawCategory=String(row.category||'').trim(),category=rawCategory?categories.get(key(rawCategory)):fallback.category;
 const location=(row.sourceLocators||[])[0]||row.locator||'导入资料';
 if(!category)throw new Error(`${location}：无法确定品类“${rawCategory}”，请填写完整品类，例如“TCL 电视”或“雷鸟电视”`);
 const aliases={'京东':'京东','jd':'京东','天猫':'天猫','tmall':'天猫','抖音':'抖音','douyin':'抖音','全部平台':'全部平台','全平台':'全部平台','京东/天猫':'京东/天猫','天猫/京东':'京东/天猫','京东、天猫':'京东/天猫','抖音生活服务':'抖音生活服务'};
 const rawPlatform=String(row.platform||'').trim()||(ctx.scope==='category'?'全部平台':ctx.platform);
 let platform=aliases[key(rawPlatform)];
 if(!platform)throw new Error(`${location}：无法识别平台“${rawPlatform}”，请使用京东、天猫、抖音、京东/天猫或全部平台`);
 if(platform==='抖音生活服务'){if(category!=='本地生活')throw new Error(`${location}：平台“${rawPlatform}”只适用于本地生活品类`);platform='抖音';}
 const supports=b=>b.category===category&&(platform==='全部平台'||platform==='京东/天猫'?platform==='全部平台'||['京东','天猫'].every(p=>b.platforms.includes(p)):b.platforms.includes(platform));
 const board=BOARDS.find(b=>b.id===ctx.boardId&&supports(b))||BOARDS.find(supports);
 if(!board)throw new Error(`${location}：品类“${category}”不支持平台“${platform}”，请核对来源范围后重新导入`);
 return {...row,category,platform,boardId:board.id,scope:ctx.scope==='category'||platform==='全部平台'?'category':'board',model:String(row.model||''),sku:String(row.sku||''),sourceRef:String(row.sourceRef||''),sourceLocators:[...(row.sourceLocators||[])]};
}
function importRowHasPII(row){return containsPII([row.question,row.answer,row.intent,row.danmuType,row.model,row.sku,row.category,row.platform,row.sourceRef,row.source,...(row.keyPoints||[]),...(row.sourceLocators||[])].filter(Boolean).join('\n'));}
function modelRequiredForQuestion(row){return !!missingModelHint(row)&&/(?:刷新率|分辨率|响应时间|接口|HDMI|HDR|杜比|DOLBY|投屏|蓝牙|WIFI|WLAN|\d+\s*(?:Hz|nits|dB|匹|升|寸)|分区|峰值|亮度|尺寸|容量|功率|能效|制冷量|噪[音声]|耗电|保鲜|参数|型号对比|支持.*(?:功能|技术)|对比.*(?:型号|产品|款))/i.test(row.question||'');}
function importReviewState(row){if(importRowHasPII(row))row.reviewStatus='sensitive';return row;}
// R24 import lifecycle: snapshots, cancellation and atomic local batches.
let importEpoch=0,importParsing=false,importSaving=false,importPreview=null;
function invalidateImportPreview(message=''){
 importEpoch++;importCandidate=[];importPreview=null;importParsing=false;
 const save=ELEM('saveImport'),parse=ELEM('parseFile');if(save)save.disabled=true;if(parse)parse.disabled=importSaving;
 if(message&&ELEM('importSummary'))ELEM('importSummary').textContent=message;
 if(message&&ELEM('importTable'))ELEM('importTable').replaceChildren();
}
function importContextCurrent(ctx){
 return page==='import'&&userRole===ctx.role&&userName===ctx.name&&ELEM('fileInput')===ctx.input&&ctx.input.files?.[0]===ctx.file&&importEpoch===ctx.epoch&&importBoardId===ctx.boardId&&importScope===ctx.scope&&importPlatform===ctx.platform&&cloud.base===ctx.cloud.base&&cloud.token===ctx.cloud.token;
}
function commitImportBatch(items){
 if(memoryFallback||!localDB)return Promise.reject(new Error('本机数据库不可用，无法可靠保存资料，请保留源文件后重试'));
 return new Promise((resolve,reject)=>{let tx;try{
  tx=localDB.transaction('items','readwrite');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('资料保存失败'));tx.onabort=()=>reject(tx.error||new Error('资料保存已取消'));
  const store=tx.objectStore('items');for(const item of items)store.add(item);
 }catch(error){try{tx?.abort()}catch{}reject(error)}});
}
function importPage(){invalidateImportPreview();setTitle('运营 · 导入问答文件');const b=boardById(importBoardId);ELEM('view').innerHTML=`<div class="section-title"><div><h2>运营上传 · 弹幕问答知识整理</h2><p>将老主播/运营已解答的用户问题导入，逐条审核后进入正式题库。</p></div><button class="btn" id="downloadTemplate">下载 CSV 模板</button></div>
<div class="notice">本地演示页没有真实运营身份认证，不应上传客户个人信息、订单号、手机号或敏感内部资料。正式多人数据库必须先连接受保护的云端 API。</div>
<div class="panel"><div class="cols-3"><div class="field"><label>缺失范围的默认板块</label><select id="importBoard">${BOARDS.map(b=>`<option value="${b.id}" ${b.id===importBoardId?'selected':''}>${b.id} ${ESC(b.category)} · ${ESC(b.display_platform)}</option>`).join('')}</select></div><div class="field"><label>知识类型</label><select id="importScope"><option value="platform" ${importScope==='platform'?'selected':''}>平台专项问答</option><option value="category" ${importScope==='category'?'selected':''}>本品类共享知识</option></select></div><div class="field"><label>缺失平台的默认值</label><select id="importPlatform">${b.platforms.map(p=>`<option value="${ESC(p)}" ${p===importPlatform?'selected':''}>${ESC(p)}</option>`).join('')}<option value="全部平台" ${importPlatform==='全部平台'?'selected':''}>全部平台（适用时）</option></select></div></div>
<div class="upload-drop" style="margin-top:20px"><div style="font-size:28px">⇧</div><strong>上传问答文件</strong><p>支持 DOCX / XLSX / XLS / 文本 PDF / CSV / TSV / TXT / JSON（全部在本地浏览器解析）。扫描版 PDF 暂不支持 OCR。</p><input type="file" id="fileInput" accept=".docx,.xlsx,.xls,.pdf,.csv,.tsv,.txt,.json" /></div>
<div class="toolbar"><button class="btn primary" id="parseFile">解析文件并预览</button><button class="btn dark" id="saveImport" disabled>保存为待审核资料</button></div>
<div id="importSummary" class="muted">尚未选择文件。推荐列名：问题、优秀回答、评分点、型号、SKU、品类、平台、来源。表内品类和平台优先，缺失时才使用上方选择；未知或不兼容范围会整批拒绝。</div><div class="table-wrap" id="importTable"></div></div>`;
ELEM('importBoard').onchange=e=>{importBoardId=e.target.value;importPlatform=boardById(importBoardId).platforms[0];importPage()};ELEM('importScope').onchange=e=>{importScope=e.target.value;invalidateImportPreview('知识类型已变更，请重新解析并预览');};ELEM('importPlatform').onchange=e=>{importPlatform=e.target.value;invalidateImportPreview('平台已变更，请重新解析并预览');};ELEM('fileInput').onchange=()=>invalidateImportPreview('文件已变更，请重新解析并预览');
ELEM('downloadTemplate').onclick=()=>{const sample='型号,SKU,品类,平台,来源,弹幕类型,弹幕内容,消费者意图分析,案例话术1\nTCL Q10L（人工示例）,DEMO-Q10L,TCL 电视,京东,人工填写示例：请替换为已核验资料,产品咨询,这款电视的接口信息在哪里核实？,了解连接设备的兼容性,人工示例：请先核对该型号官方参数表与连接设备需求，本行未提供真实接口规格\n';downloadText('TCL-问答导入模板.csv','\ufeff'+sample,'text/csv;charset=utf-8')};ELEM('parseFile').onclick=parseImport;ELEM('saveImport').onclick=saveImport;}
async function parseImport(){
 if(importParsing||importSaving||page!=='import')return;
 const input=ELEM('fileInput'),file=input?.files?.[0];if(!file)return toast('请先选择问答文件');
 invalidateImportPreview();
 if(file.size>15*1024*1024)return toast('文件超过15 MB，请拆分后上传');
 const ctx={input,file,epoch:importEpoch,boardId:importBoardId,scope:importScope,platform:importPlatform,role:userRole,name:userName,cloud:{base:cloud.base,token:cloud.token}};
 importParsing=true;ELEM('parseFile').disabled=true;ELEM('importSummary').textContent='正在本地解析：'+file.name;
 try{
  const parsed=await parseDocumentFile(file);if(!importContextCurrent(ctx))return;
  const candidates=extractQA(parsed).map(row=>normalizedImportScope(row,ctx));
  if(candidates.length>500)throw new Error(`识别到${candidates.length}条，单次最多500条，请拆分后导入`);
  if(!candidates.length)throw new Error('未识别到完整问答。可用“弹幕类型/弹幕内容/消费者意图分析/案例话术1”或“问题/优秀回答”列名。');
  detectReviewConflicts(candidates,{existing:localEntries});
  for(const row of candidates)importReviewState(row);
  importCandidate=candidates;importPreview=ctx;uploadedFileName=file.name;
  const counts={ready:candidates.filter(x=>x.reviewStatus==='needs_review').length,missing:candidates.filter(x=>x.reviewStatus==='incomplete').length,dup:candidates.filter(x=>x.reviewStatus==='duplicate').length,conflict:candidates.filter(x=>x.reviewStatus==='conflict').length,pii:candidates.filter(x=>x.reviewStatus==='sensitive').length};
  ELEM('importSummary').textContent=`文件：${file.name}；识别 ${candidates.length} 条。待审核 ${counts.ready}，缺话术 ${counts.missing}，重复 ${counts.dup}，冲突 ${counts.conflict}，疑似隐私 ${counts.pii}（此类禁止保存）。范围以表中有效值为准；使用具体产品指代但缺型号的参数题，需在审核页补型号后发布。`;
  ELEM('importTable').innerHTML=`<table><thead><tr><th>状态</th><th>型号 / SKU / 范围</th><th>弹幕类型</th><th>提问内容</th><th>消费者意图</th><th>运营/老主播参考回答</th><th>来源</th></tr></thead><tbody>${candidates.slice(0,100).map(r=>`<tr><td><span class="pill ${r.reviewStatus==='needs_review'?'warn':'danger'}">${r.reviewStatus==='needs_review'?'待审核':r.reviewStatus==='incomplete'?'缺少答案':r.reviewStatus==='duplicate'?'重复':r.reviewStatus==='sensitive'?'隐私风险':'答案冲突'}</span></td><td>${ESC(r.category)} · ${ESC(r.platform)}${questionMetadataHtml(r)}</td><td>${ESC(r.danmuType||'—')}</td><td>${ESC(r.question)}</td><td>${ESC(r.intent||'—')}</td><td>${ESC(r.answer||'—')}</td><td>${ESC(r.locator||'')}</td></tr>`).join('')}</tbody></table>`;
  ELEM('saveImport').disabled=false;toast('文件解析完成，请核对后保存待审');
 }catch(error){if(importContextCurrent(ctx)){importCandidate=[];importPreview=null;ELEM('saveImport').disabled=true;ELEM('importSummary').textContent='解析失败：'+error.message;toast('解析失败：'+error.message);}}
 finally{if(ctx.epoch===importEpoch){importParsing=false;if(ELEM('fileInput')===input&&ELEM('parseFile'))ELEM('parseFile').disabled=importSaving;}}
}
async function archiveSource(file,ctx){
 if(!ctx.cloud.base||!ctx.cloud.token)throw new Error('请先连接运营云数据库');
 if(!file||file.size===0||file.size>8*1024*1024)throw new Error('云端归档文件必须为1B至8MB，请拆分后重试');
 const r=await fetch(ctx.cloud.base+'/api/source-upload',{method:'POST',headers:{'Authorization':'Bearer '+ctx.cloud.token,'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(file.name),'X-Board-Id':ctx.boardId,'X-Platform':encodeURIComponent(ctx.scope==='category'?'全部平台':ctx.platform)},body:file});
 const j=await r.json().catch(()=>({error:'原件归档接口返回非JSON'}));if(!r.ok)throw new Error(j.error||'原件归档失败 '+r.status);return j;
}
async function saveImport(){
 if(importSaving||importParsing||!importCandidate.length||!importPreview)return;
 const ctx=importPreview;if(!importContextCurrent(ctx)){invalidateImportPreview('导入上下文已变化，请重新解析并核对');return;}
 const candidates=importCandidate.map(row=>({...row,keyPoints:[...(row.keyPoints||[])],sourceLocators:[...(row.sourceLocators||[])]}));
 const unsafe=candidates.filter(importRowHasPII);
 if(unsafe.length)return toast(`有 ${unsafe.length} 条内容包含疑似手机号/邮箱/订单号码。请先在源文件脱敏后重新上传`);
 importSaving=true;ELEM('saveImport').disabled=true;ELEM('parseFile').disabled=true;
 let saved=0,remoteStarted=false;
 try{
  if(!memoryFallback)localEntries=await dbAll('items');
  if(!importContextCurrent(ctx))throw new Error('页面或导入目标已变化，尚未保存，请重新解析');
  detectReviewConflicts(candidates,{existing:localEntries});
  const imported=candidates.map(r=>({id:uid(),boardId:r.boardId,category:r.category,scope:r.scope,platform:r.platform,model:r.model,sku:r.sku,sourceRef:r.sourceRef,sourceLocators:[...r.sourceLocators],question:r.question,answer:r.answer,keyPoints:r.keyPoints,intent:r.intent||'',danmuType:r.danmuType||'',source:'导入资料 · '+String(r.locator||'').replace(ctx.file.name,'源文件'),reviewStatus:r.reviewStatus,status:'draft',kind:'uploaded',createdAt:nowIso()}));
  if(ctx.cloud.base&&ctx.cloud.token){
   if(imported.some(it=>it.model||it.sku||it.sourceRef||it.sourceLocators.length))throw new Error('当前云端后端尚不支持完整保留型号和来源字段，未归档或提交。请在设置中手动断开云端后使用本机导入流程');
   remoteStarted=true;const archived=await archiveSource(ctx.file,ctx);for(const it of imported)it.sourceFileId=archived.id;
   for(let i=0;i<imported.length;i+=20){
    if(!importContextCurrent(ctx))throw new Error('页面或登录状态已变化，停止后续云端导入');
    const response=await fetch(ctx.cloud.base+'/api/import',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+ctx.cloud.token},body:JSON.stringify({items:imported.slice(i,i+20).map(({model,sku,sourceRef,sourceLocators,...legacy})=>legacy)})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||`请求失败：${response.status}`);saved+=Number(result.saved)||0;
    if(result.rejected?.length)throw new Error('云端拒绝了 '+result.rejected.length+' 条，原件已归档，请到后台核对');
   }
   toast(`已保存原始文件及${saved}条云端待审问答`);
  }else{
   await commitImportBatch(imported);localEntries.push(...imported);saved=imported.length;toast(`本机保存${saved}条待审核资料。注意：没有云端同步。`);
  }
  const current=importContextCurrent(ctx);invalidateImportPreview();if(current)nav('review');
 }catch(error){
  if(remoteStarted)invalidateImportPreview('云端提交已停止，结果可能部分完成；请先在后台核对，不要直接重复提交');
  toast('保存中断：'+error.message+'；已确认保存 '+saved+' 条'+(remoteStarted?'，请先到后台核对是否部分完成':'，本机保存事务未成功时不会保留部分记录'));
 }finally{
  importSaving=false;if(ELEM('fileInput')===ctx.input){if(ELEM('parseFile'))ELEM('parseFile').disabled=importParsing;if(ELEM('saveImport'))ELEM('saveImport').disabled=!importPreview||!importCandidate.length||!importContextCurrent(ctx);}
 }
}
let localReviewSaving=false;
function saveLocalReview(id,model,publish=false){
 if(memoryFallback||!localDB)return Promise.reject(new Error('本机数据库不可用，不能确认审核已保存'));
 if(model.length>200)return Promise.reject(new Error('型号超过200字，请核实后重新填写'));
 return new Promise((resolve,reject)=>{
  let tx,failure,updated;try{
   tx=localDB.transaction('items','readwrite');const store=tx.objectStore('items'),read=store.getAll();
   tx.oncomplete=()=>resolve(updated);tx.onerror=()=>reject(failure||tx.error||new Error('审核保存失败'));tx.onabort=()=>reject(failure||tx.error||new Error('审核保存已取消'));
   read.onsuccess=()=>{try{
    const rows=read.result||[],current=rows.find(x=>x.id===id);
    if(!current||(current.status!=='draft'&&!(current.status==='published'&&modelRequiredForQuestion(current))))throw new Error('该条目已变化，请刷新待审核列表');
    const row={...current,model,status:'draft',reviewStatus:current.answer?'needs_review':'incomplete'};
    if(importRowHasPII(row))throw new Error('资料或型号包含疑似手机号/邮箱/订单号码，请在源文件脱敏后重新导入');
    detectReviewConflicts([row],{existing:rows.filter(x=>x.id!==id)});
    if(publish){
     if(row.reviewStatus!=='needs_review'||!row.answer)throw new Error(`该题当前为${row.reviewStatus}，请先修正重复、冲突或缺失答案`);
     if(modelRequiredForQuestion(row))throw new Error('该参数问题指代了具体产品，请先依据原资料补充型号；不可凭空填写');
     row.status='published';row.reviewStatus='reviewed-demo';row.publishedAt=nowIso();
    }
    store.put(row);updated=rows.map(x=>x.id===id?row:x);
   }catch(error){failure=error;tx.abort();}};
  }catch(error){try{tx?.abort()}catch{}reject(error);}
 });
}
async function handleLocalReview(button,publish){
 if(localReviewSaving)return;const id=button.dataset.approve||button.dataset.saveModel,input=[...document.querySelectorAll('[data-model-for]')].find(x=>x.dataset.modelFor===id);
 if(!input)return;const model=input.value.trim(),view=ELEM('view')?.firstElementChild,owner=userName;
 localReviewSaving=true;button.disabled=true;
 try{localEntries=await saveLocalReview(id,model,publish);toast(publish?'仅本机审核通过，未同步云端':'型号已保存，答案原文未改动；请核实后手动审核');if(page==='review'&&userRole==='operator'&&userName===owner&&ELEM('view')?.firstElementChild===view)reviewPage();}
 catch(error){toast('未保存：'+error.message);if(button.isConnected)button.disabled=false;}
 finally{localReviewSaving=false;}
}
function reviewPage(){setTitle('审核 · 知识库发布');const pending=localEntries.filter(x=>x.status==='draft'||x.status==='published'&&modelRequiredForQuestion(x));ELEM('view').innerHTML=`<div class="section-title"><div><h2>运营上传审核</h2><p>核对原问题、型号、适用范围、答案和来源，再手动发布。补型号不会修改答案事实。旧已发布参数题如缺少型号会暂停出题；补全后需要重新手动审核。</p></div><button id="pullCloud" class="btn">刷新云端待审</button></div><div class="notice">当前界面的本机“审核通过”仅供演示流程。正式生产发布需使用云端管理员认证与操作审计，不能把客户端按钮当作权限控制。</div><div class="panel"><div class="question-list">${pending.slice(-150).reverse().map(x=>`<div class="q-card"><div class="q-meta"><span class="pill">${ESC(x.category)} / ${ESC(x.platform)}</span><span class="pill ${x.reviewStatus==='needs_review'?'warn':'danger'}">${ESC(x.reviewStatus)}</span><span class="pill">待审核</span></div><h3>${ESC(x.question)}</h3><p>${ESC(x.answer||'缺少答案')}</p>${questionMetadataHtml(x)}<p class="muted">${ESC(x.source)}</p><label class="field">核实或补充型号（通用流程问题可留空）<input data-model-for="${ESC(x.id)}" value="${ESC(x.model||'')}" maxlength="200" placeholder="只填写来源明确提供的型号，不用SKU猜测"></label>${modelRequiredForQuestion(x)?'<p class="notice">这道参数题需要明确产品；请补充并保存型号后再审核发布。</p>':''}<div class="toolbar"><button class="btn small" data-save-model="${ESC(x.id)}">保存型号并重新检查</button><button class="btn small primary" data-approve="${ESC(x.id)}" ${x.reviewStatus!=='needs_review'||!x.answer||modelRequiredForQuestion(x)?'disabled':''}>本机模拟发布</button><button class="btn small" data-discard="${ESC(x.id)}">拒绝/删除本机草稿</button></div></div>`).join('')||'<div class="empty">没有本机待审核问答。云端待审与本机数据是隔离的。</div>'}</div></div><div id="cloudPending"></div>`;
 ELEM('pullCloud').onclick=pullCloud;
 document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>handleLocalReview(b,true));
 document.querySelectorAll('[data-save-model]').forEach(b=>b.onclick=()=>handleLocalReview(b,false));
 document.querySelectorAll('[data-discard]').forEach(b=>b.onclick=async()=>{if(localReviewSaving)return;const owner=userName,view=ELEM('view')?.firstElementChild;localReviewSaving=true;b.disabled=true;try{await dbDelete('items',b.dataset.discard);localEntries=localEntries.filter(x=>x.id!==b.dataset.discard);if(page==='review'&&userRole==='operator'&&userName===owner&&ELEM('view')?.firstElementChild===view)reviewPage();}catch(e){toast('删除失败：'+e.message);if(b.isConnected)b.disabled=false;}finally{localReviewSaving=false;}});
}
async function pullCloud(){if(!cloud.base||!cloud.token)return toast('需要先在云端配置中登录管理员');try{const resp=await remote('/api/pending');const rows=resp.items||[];ELEM('cloudPending').innerHTML=`<div class="panel" style="margin-top:20px"><h2>云端待审核 · ${rows.length} 条</h2><div class="question-list">${rows.map(x=>`<div class="q-card"><div class="q-meta"><span class="pill">${ESC(x.category)}</span><span class="pill">${ESC(x.platform)}</span><span class="pill warn">${ESC(x.review_status)}</span></div><h3>${ESC(x.question)}</h3><p>${ESC(x.answer||'缺少答案')}</p><p class="muted">${ESC(x.source)}</p><button class="btn small primary" data-cloud-approve="${ESC(x.id)}" ${cloud.role!=='admin'||x.review_status!=='needs_review'||!x.answer?'disabled':''}>管理员审核发布</button><button class="btn small" data-cloud-edit="${ESC(x.id)}" ${cloud.role!=='admin'?'disabled':''}>编辑问答</button><button class="btn small" data-cloud-reject="${ESC(x.id)}" ${cloud.role!=='admin'?'disabled':''}>拒绝</button></div>`).join('')||'<div class="empty">暂无待审</div>'}</div></div>`;document.querySelectorAll('[data-cloud-approve]').forEach(b=>b.onclick=()=>cloudApprove(b.dataset.cloudApprove,'publish'));document.querySelectorAll('[data-cloud-reject]').forEach(b=>b.onclick=()=>cloudApprove(b.dataset.cloudReject,'reject'));document.querySelectorAll('[data-cloud-edit]').forEach(b=>b.onclick=async()=>{const x=rows.find(z=>z.id===b.dataset.cloudEdit);if(!x)return;const question=window.prompt('审核编辑：用户提问',x.question);if(question===null)return;const answer=window.prompt('审核编辑：成熟回答',x.answer||'');if(answer===null)return;try{await remote('/api/revise','POST',{id:x.id,question,answer});toast('修改已保存，需再次审核发布');pullCloud()}catch(e){toast('编辑失败：'+e.message)}});}catch(e){toast('读取云端待审失败：'+e.message)}}
async function cloudApprove(id,decision){try{await remote('/api/review','POST',{ids:[id],decision});toast('云端审核已提交');pullCloud()}catch(e){toast('审核失败：'+e.message)}}
function settingsPage(){setTitle('云端数据库与权限');ELEM('view').innerHTML=`<div class="section-title"><div><h2>数据库连接</h2><p>GitHub Pages 只托管页面。要让运营资料被所有新人长期查看，必须配置独立的受保护云端数据库。</p></div></div><div class="two-col"><div class="panel"><h2>Cloudflare Workers + D1（部署适配已附）</h2><div class="notice blue">免费额度适合小规模培训测试，但不是无限容量/永远不会停服的承诺；中国大陆访问速度及可达性必须通过真机验证。已有 CloudBase 也可作为后续正式后端迁移目标。</div><div class="field"><label>API 地址（必须 HTTPS）</label><input id="apiBase" placeholder="https://你的worker.workers.dev" value="${ESC(cloud.base)}"></div><div class="cols-2" style="margin:12px 0"><div class="field"><label>运营账号</label><input id="loginName" autocomplete="username" value="${ESC(cloud.name||'')}"></div><div class="field"><label>密码（只在登录时发送，前端不持久化）</label><input id="loginPassword" type="password" autocomplete="current-password"></div></div><div class="toolbar"><button class="btn primary" id="cloudLogin">连接并登录</button><button class="btn" id="cloudLogout">断开云端连接</button><button class="btn" id="cloudSync">同步已发布知识</button></div><p class="muted" id="cloudFeedback">当前：${cloud.token?'已登录 '+ESC(cloud.name)+' / '+ESC(cloud.role):'未登录，本机数据库模式'}。</p></div><div class="panel"><h2>运营账号管理</h2><p class="muted">只有超级管理员可以创建运营账号。运营账户负责提交资料，不可直接发布；创建后请通过安全渠道单独告知运营人员初始密码。</p>${cloud.role==='admin'?'<div class="field"><label>新运营登录名</label><input id="newOperator" placeholder="例如 ops001"></div><div class="field" style="margin-top:10px"><label>初始密码（至少12位）</label><input id="newOperatorPassword" type="password" autocomplete="new-password" placeholder="请输入安全密码"></div><div class="toolbar"><button class="btn" id="createOperatorBtn">创建运营账号</button></div>':'<div class="notice">需要超级管理员登录后才可管理运营账号。</div>'}</div><div class="panel"><h2>原始文件安全归档</h2><p class="muted">云端启用后，运营上传的原始文件存放在私有 R2，问答记录及文件哈希存放在 D1。仅超级管理员可读取并下载原始文件；无云端连接时按钮不可用。</p><div class="toolbar"><button class="btn" id="listSourcesBtn">查看云端原始文件</button></div><div class="question-list" id="sourceArchiveList"></div></div><div class="panel"><h2>运营入库安全原则</h2><ol class="note-list"><li>上传文件只在本地解析成问答行；服务器通过私有 R2 归档原始文件，通过 D1 保存问答、审核记录及文件哈希；运营必须先删除客户隐私信息。</li><li>老主播回答可作为候选内容；导入者只能提交待审，不可绕过管理员直接发布。</li><li>同一品类共用知识；各平台按当前板块过滤问题和优秀回答。</li><li>新主播只能读取已发布内容；原 65 张历史卡处于拓展学习区，默认不作为正式评分标准。</li><li>云端要独立管理账号、审计、容量告警及定期备份，不能依赖浏览器缓存做永久数据库。</li></ol></div></div>`;
 ELEM('cloudLogin').onclick=loginCloud;ELEM('cloudLogout').onclick=async()=>{if(cloud.token){try{await remote('/api/logout','POST',{})}catch{}}cloud.token='';cloud.role='';cloud.name='';updateMode();toast('已退出云端登录');settingsPage()};ELEM('cloudSync').onclick=syncCloud;ELEM('listSourcesBtn').onclick=loadSources;if(ELEM('createOperatorBtn'))ELEM('createOperatorBtn').onclick=createCloudOperator;}
async function createCloudOperator(){if(cloud.role!=='admin')return toast('需要超级管理员权限');const username=ELEM('newOperator').value.trim(),password=ELEM('newOperatorPassword').value;if(!username||password.length<12)return toast('账号必填，初始密码至少12位');try{await remote('/api/operators','POST',{username,password});ELEM('newOperatorPassword').value='';toast('运营账号已创建，请安全交付登录信息')}catch(e){toast('创建失败：'+e.message)}}
async function loadSources(){if(!cloud.base||!cloud.token||cloud.role!=='admin')return toast('仅云端超级管理员可查看和下载原始文件');try{const res=await remote('/api/sources');const items=res.items||[];const target=ELEM('sourceArchiveList');target.innerHTML=items.length?items.map(x=>`<div class="q-card"><strong>${ESC(x.file_name)}</strong> <span class="pill">${ESC(x.board_id)} / ${ESC(x.platform)}</span><p class="muted">${(x.size_bytes/1024).toFixed(1)}KB · SHA-256 ${ESC(x.sha256.slice(0,12))}… · ${ESC(x.created_at)}</p><button class="btn small" data-archive-download="${ESC(x.id)}">下载原始文件</button></div>`).join(''):'<div class="empty">云端暂无归档文件</div>';target.querySelectorAll('[data-archive-download]').forEach(b=>b.onclick=()=>downloadSource(items.find(x=>x.id===b.dataset.archiveDownload)));}catch(e){toast('查询云端归档失败：'+e.message)}}
async function downloadSource(item){if(!item||cloud.role!=='admin')return;try{const res=await fetch(cloud.base+'/api/source/'+encodeURIComponent(item.id),{headers:{Authorization:'Bearer '+cloud.token}});if(!res.ok){const j=await res.json().catch(()=>({}));throw new Error(j.error||res.status)}const blob=await res.blob();const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=item.file_name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)}catch(e){toast('下载归档失败：'+e.message)}}
async function loginCloud(){const base=ELEM('apiBase').value.trim().replace(/\/$/,'');const name=ELEM('loginName').value.trim(),password=ELEM('loginPassword').value;if(!/^https:\/\//.test(base))return toast('API 地址必须使用 HTTPS');if(!name||!password)return toast('请输入运营账号和密码');cloud.base=base;try{const res=await remote('/api/login','POST',{username:name,password});cloud.token=res.token;cloud.role=res.role;cloud.name=name;updateMode();toast('云端登录成功：'+res.role);settingsPage();await syncCloud();}catch(e){cloud.token='';toast('云端登录失败：'+e.message)}}
async function syncCloud(){try{if(!cloud.base)throw new Error('请先填写 API 地址');const result=await remote('/api/questions?limit=500');let added=0;for(const e of result.items||[]){const obj={id:'cloud-'+e.id,boardId:e.board_id,category:e.category,platform:e.platform,scope:e.scope,question:e.question,answer:e.answer,keyPoints:JSON.parse(e.key_points||'[]'),source:e.source,model:e.model||'',sku:e.sku||'',sourceRef:e.sourceRef||e.source_ref||'',sourceLocators:Array.isArray(e.sourceLocators)?e.sourceLocators:[],status:'published',reviewStatus:'approved',kind:'cloud',createdAt:e.created_at};const current=localEntries.find(x=>x.id===obj.id);if(!current){localEntries.push(obj);added++}else Object.assign(current,obj);await dbPut('items',obj)}toast(`同步完成：${added}条新增，${result.items?.length||0}条云端数据已更新`);}catch(e){toast('同步失败：'+e.message)}}
function downloadText(name,text,type='application/json'){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.download=name;a.href=url;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)}
const downloadJSON=(name,obj)=>downloadText(name,JSON.stringify(obj,null,2),'application/json;charset=utf-8');
async function initialiseStorage(storageName){
 attachWorkflowChannel(storageName);
 try{localDB=await dbOpen(storageName);localEntries=await dbAll('items');localRecords=(await dbAll('records')).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));const prefs=await loadPrefs();barrageIntervalMs=Number(prefGet(prefs,'barrageIntervalMs',60000))||60000;localAssignments=prefGet(prefs,'assignments',[]);localAssignmentJoins=prefGet(prefs,'assignmentJoins',[]);localTrainingLogs=prefGet(prefs,'trainingLogs',[]);localSubmissions=prefGet(prefs,'submissions',[]);}catch(e){memoryFallback=true;localEntries=[];localRecords=[];localAssignments=[];localAssignmentJoins=[];localTrainingLogs=[];localSubmissions=[];}
}
async function init(){
 let restoredMember=null;
 try{
  const cfg=await fetch('./app-config.json',{cache:'no-store'}).then(r=>r.ok?r.json():{});
  if(cfg.apiBase&&/^https:\/\//.test(cfg.apiBase))cloud.base=cfg.apiBase.replace(/\/$/,'');
  try{assignmentSync=createAssignmentSync(cfg.assignmentSync);}catch(error){syncConfigError=error.message;}
 }catch{}
 if(requiresAssignmentCloud&&!assignmentSync&&!syncConfigError)syncConfigError='云同步试点配置暂不可用，请刷新后重试';
 if(assignmentSync){
  try{
   restoredMember=await assignmentSync.restoreSession();
   if(restoredMember)await loadSyncIdentity(restoredMember);
  }catch(error){
   assignmentSync.signOut();restoredMember=null;
   syncSessionFeedback='暂时无法校验本机绑定，请核对网络后输入原姓名重试。';
  }
 }else if(!syncConfigError)await initialiseStorage(STORE_NAME);
 window.addEventListener('focus',()=>void refreshWorkflowState());window.addEventListener('pageshow',e=>{
 if(!e.persisted)return;
 void refreshWorkflowState();
 // pagehide intentionally invalidates active recording/ASR state. A browser
 // back-forward-cache restore must not leave its old review controls clickable.
 if(!runId&&(page==='training'||page==='sessionReview')){
  page='home';reviewParked=false;lastSessionSnapshot=null;render();
  void findSavedSession();
  toast('已返回练播房，录制已停止；可从首页恢复本机已保存的场次。');
 }
});
ELEM('menuBtn').onclick=toggleMenu;
ELEM('menuScrim').onclick=closeMenu;
ELEM('drawerScrim').onclick=closeDrawer;
window.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(ELEM('sidebar').classList.contains('open')){closeMenu();return}if(ELEM('trainingControls')?.classList.contains('show-live-controls')||ELEM('prepMoreSheet')?.hidden===false||ELEM('liveMoreSheet')?.hidden===false){closeDrawer();e.preventDefault();return}if(page==='sessionReview'&&reviewStage!=='overview'){backToReviewOverview();e.preventDefault();return}if(roomPhase==='ready'){ELEM('prepExit')?.click();return}if(roomPhase==='live'){requestFinishScene()}});
window.addEventListener('popstate',e=>{if(page==='sessionReview'){const stage=e.state?.reviewStage;if(stage==='replay'||stage==='details'){showReviewStage(stage,{recordHistory:false});return;}if(reviewStage!=='overview'){showReviewStage('overview',{recordHistory:false});return;}}if(e.state?.tclApp)return;const handled=(()=>{if(ELEM('sidebar').classList.contains('open')){closeMenu();return true}if(ELEM('trainingControls')?.classList.contains('show-live-controls')||ELEM('prepMoreSheet')?.hidden===false||ELEM('liveMoreSheet')?.hidden===false){closeDrawer();return true}const sheet=ELEM('textAnswerSheet');if(sheet&&!sheet.hidden){sheet.hidden=true;return true}if(page==='sessionReview'&&reviewStage!=='overview'){backToReviewOverview();return true}if(page==='training'&&(roomPhase==='ready'||roomPhase==='check')){ELEM('prepExit')?.click();return true}if(roomPhase==='live'){requestFinishScene();return true}if(page==='roleLogin'){pendingRole='';page='home';render();return true}if(page!=='home'){nav('home');return true}return false})();if(handled)syncHistoryEntry();});document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>nav(b.dataset.page));
document.querySelectorAll('[data-quick-page]').forEach(b=>b.onclick=()=>nav(b.dataset.quickPage));
ELEM('backupBtn').onclick=backupForIdentity;updateMode();render();
if(restoredMember)void refreshAfterSyncLogin(restoredMember,false);
if(cloud.base){syncCloud().catch(()=>{});}}
// V3.4.9：离开首页时压入一条站内历史记录，手机返回键/手势回到首页，而不是直接退出网站。
function syncHistoryEntry(){try{if(page!=='home'&&!history.state?.tclApp)history.pushState({tclApp:true},'');}catch{}}
function render(){clearSubmittedPlayback();clearReviewQuestionAudioUrls();if(!pageAllowed(page))page='home';document.body.dataset.page=page;if(page==='home')home();else if(page==='roleLogin')roleLogin();else if(page==='catalog')catalog();else if(page==='training')trainingHome();else if(page==='sessionReview')sessionReviewPage();else if(page==='library')library();else if(page==='legacy')legacy();else if(page==='progress')progress();else if(page==='import')importPage();else if(page==='review')reviewPage();else if(page==='settings')settingsPage();syncHistoryEntry();}
window.addEventListener('pagehide',()=>{saveCurrentTypedAnswer();void persistSessionCheckpoint();clearSubmittedPlayback();clearReviewQuestionAudioUrls();resetRunState();deviceCheckSeq++;stopScene();exitFocus();roomPhase='check';deviceCheck={camera:false,microphone:false,recorder:false,ready:false,mode:'hardware',checked:false};updateDeviceStates()});
let cameraFitFrame=0;window.addEventListener('resize',()=>{cancelAnimationFrame(cameraFitFrame);cameraFitFrame=requestAnimationFrame(applyCameraFit);});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refreshWorkflowState();if(document.visibilityState==='hidden'){if(!(speechFinishingRun&&speechFinishingRun===runId&&isRunPage()))cancelSpeech();cancelTTS();if(sessionRecorder?.state==='recording'){try{sessionRecorder.requestData?.()}catch{}}}if(document.visibilityState==='visible'&&roomPhase==='live'&&sessionVideoMeta?.startedAt&&Date.now()-sessionVideoMeta.startedAt>=captureMaxMs()){sessionStopReason='后台恢复时发现录制时长超过安全上限';finishScene();toast('已达到单场录制安全时长，正在封装原始录像');return;}if(document.visibilityState==='visible'&&roomPhase==='live'&&deviceCheck.mode!=='text'&&(!camStream||camStream.getVideoTracks().every(t=>t.readyState!=='live')||!sessionMicStream||sessionMicStream.getAudioTracks().every(t=>t.readyState!=='live'))){finishScene();toast('摄像头或麦克风已中断：练播安全结束。请重新检查设备后开播');}});
syncExitWarning();
const asrGlossary=initGlossaryUI({parseDocumentFile,isEditable:()=>page==='home'&&!r6WhisperRunning&&!oneShotAsrJob&&!transcriptBusy&&!speechRecognizer});
init();
