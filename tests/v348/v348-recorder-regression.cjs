// Browser integration using delayed simulated MediaRecorder and ASR, not real hardware.
const {chromium}=require('playwright'); const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const page=await browser.newPage();
 await page.route('**/app.js',async route=>{const resp=await route.fetch();const body=await resp.text();await route.fulfill({response:resp,body:body+`
 window.__recTest={
 setup(){userRole='anchor';userName='测试主播';page='training';selectedBoard='01';activePlatform=boardById('01').platforms[0];trainingHome();runId='r';roomPhase='live';liveStarted=true;deviceCheck={mode:'hardware',ready:true};
 const turn={id:'t',runId,boardId:selectedBoard,category:boardById(selectedBoard).category,platform:activePlatform,prompt:'测试',keyPoints:[],pointKeywords:[],answer:'',transcript:'',asrStatus:'',compliance:[],pointsHit:[],audioRevision:0,asrRevision:0,responseSeconds:null,shownAt:performance.now(),durationSeconds:null};sessionTurns=[turn];activeTurn=turn;
 const track=()=>({readyState:'live',stop(){this.readyState='ended'},clone(){return track()}});sessionMicStream={getAudioTracks(){return [track()]},getTracks(){return [track()]}};window.MediaStream=class{constructor(tracks){this.tracks=tracks}getTracks(){return this.tracks}};
 window.MediaRecorder=class{static isTypeSupported(){return true}constructor(){this.state='inactive';this.mimeType='audio/webm';window.__mockRecorder=this}start(){this.state='recording'}stop(){this.state='inactive';window.__stopped=true}deliver(){this.ondataavailable({data:new Blob([new Uint8Array(1024).fill(1)])});this.onstop()}};
 voskModel={};decodeAudioCopy=async()=>new Float32Array(32000).fill(.1);recognizeVosk=async()=>({text:'尾音转写保留'});
 },start(){return startRecord()},stop(){stopRecord()},finish(){return finishScene()},deliver(){window.__mockRecorder.deliver()},snapshot(){return {page,runId,transcript:lastSessionSnapshot?.turns?.[0]?.transcript,audio:perQuestionAudio.has('t'),pending:recorderFinalizing}},leave(){nav('home')}
 };
 `});});
 await page.goto(process.env.TCL_URL || 'http://localhost:8765/tcl-specialty-v33/',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__recTest);
 for(const priorStop of [false,true]){
  await page.reload({waitUntil:'networkidle'});await page.evaluate(()=>__recTest.setup());await page.evaluate(()=>__recTest.start());if(priorStop)await page.evaluate(()=>__recTest.stop());
  await page.evaluate(()=>__recTest.finish());await page.waitForSelector('#reviewDetails');assert.equal(await page.evaluate(()=>__recTest.snapshot().pending),true);
  await page.evaluate(()=>__recTest.deliver());await page.waitForFunction(()=>__recTest.snapshot().transcript==='尾音转写保留');assert.equal(await page.evaluate(()=>__recTest.snapshot().audio),true);
  console.log(`PASS delayed final recording retained and transcribed (${priorStop?'stop then finish':'finish while recording'})`);
 }
 await page.reload({waitUntil:'networkidle'});await page.evaluate(()=>__recTest.setup());await page.evaluate(()=>__recTest.start());await page.evaluate(()=>__recTest.finish());await page.waitForSelector('#reviewDetails');page.once('dialog',dialog=>dialog.accept());await page.evaluate(()=>__recTest.leave());await page.evaluate(()=>__recTest.deliver());await page.waitForTimeout(100);const stale=await page.evaluate(()=>__recTest.snapshot());assert.equal(stale.page,'home');assert.equal(stale.audio,false);assert.notEqual(stale.transcript,'尾音转写保留');console.log('PASS delayed old recording cannot write after leaving review');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
