// Same-origin isolation: official and RC routes must not see each other's records or settings.
const {chromium}=require('playwright');
const S=process.env.S, ORIGIN=process.argv[2];
(async()=>{
 const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${S}/audio/0.wav`]});
 const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,permissions:['camera','microphone']});
 const page=await ctx.newPage();page.setDefaultTimeout(20000);const errs=[];page.on('pageerror',e=>errs.push(e.message));
 const enter=async(path,name)=>{await page.goto(ORIGIN+path,{waitUntil:'networkidle'});await page.click('[data-role-pick="anchor"]');await page.fill('#simpleName',name);await page.click('#simpleLogin');await page.waitForTimeout(1500);};
 const textPractice=async()=>{await page.click('#freePractice');await page.click('#prepQuickText');await page.waitForFunction(()=>!document.getElementById('startScene').disabled);await page.click('#startScene');await page.waitForTimeout(1500);await page.click('#focusClose');await page.click('#tclEndYes');await page.waitForSelector('#reviewRetry',{state:'visible'});await page.waitForTimeout(2500);};
 // official route: one text session
 await enter('/tcl-r24-paraformer/','隔离测试');const offTitle=await page.title();await textPractice();
 const off=await page.evaluate(async()=>({idb:(await indexedDB.databases()).map(d=>d.name).sort(),ls:Object.keys(localStorage).sort()}));
 // rc route: same name must NOT see the official session
 await enter('/tcl-r24-paraformer-rc/','隔离测试');const rcTitle=await page.title();
 const rcHome=await page.evaluate(()=>({restore:!!document.getElementById('restoreLocalSession'),eyebrow:[...document.querySelectorAll('.eyebrow')].map(e=>e.innerText).join('|'),body:document.querySelector('.main')?.innerText.match(/(\d+)\s*\n\s*累计练播/)?.[1]}));
 // auto device check on rc
 await page.click('#freePractice');let ready=false;for(let i=0;i<100;i++){ready=await page.evaluate(()=>!document.getElementById('startScene').disabled);if(ready)break;await page.waitForTimeout(100);}
 const after=await page.evaluate(async()=>({idb:(await indexedDB.databases()).map(d=>d.name).sort(),model:document.getElementById('r23ModelChoice')?.value}));
 // gateway eyebrow on rc landing
 await page.goto(ORIGIN+'/tcl-r24-paraformer-rc/',{waitUntil:'networkidle'});const gate=await page.evaluate(()=>document.querySelector('.role-gateway .eyebrow')?.innerText);
 await page.goto(ORIGIN+'/tcl-r24-paraformer/',{waitUntil:'networkidle'});const gateOff=await page.evaluate(()=>document.querySelector('.role-gateway .eyebrow')?.innerText);
 const out={offTitle,rcTitle,officialStorage:off,rcHomeSeesOfficialSession:rcHome.restore,rcPracticeCount:rcHome.body,rcAutoReady:ready,storageAfterRc:after,rcGateway:gate,officialGateway:gateOff,pageErrors:errs};
 console.log(JSON.stringify(out,null,1));
 const pass=!rcHome.restore&&ready&&after.idb.includes('tcl-specialty-r24-paraformer-rc1-v1')&&after.idb.includes('tcl-specialty-r24-paraformer-v1')&&/候选版 RC1/.test(gate)&&!/候选/.test(gateOff)&&/候选版 RC1/.test(rcTitle)&&!/候选/.test(offTitle)&&errs.length===0;
 console.log(pass?'ISOLATION PASS':'ISOLATION FAIL');await b.close();process.exit(pass?0:1);
})().catch(e=>{console.log('ERROR',e.message.split('\n')[0]);process.exit(2)});
