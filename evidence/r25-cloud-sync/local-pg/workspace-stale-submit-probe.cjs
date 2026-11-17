const fs=require('node:fs'),crypto=require('node:crypto');
const {chromium}=require('/workspace/r25-tools/node_modules/playwright');
(async()=>{
 const source=fs.readFileSync(process.env.WORKSPACE_SOURCE||'/workspace/r25-backend-tests/local-pg/workspace-source-before-review.mjs','utf8');
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();await page.setContent('<main><div id="panel"></div></main>');
 await page.evaluate(async source=>{
  const mod=await import('data:text/javascript;base64,'+btoa(unescape(encodeURIComponent(source))));
  let identity={uid:'anchor-A',role:'anchor',displayName:'A'};
  window.__sent=[];window.__beforeEntered=false;
  const gate=new Promise(resolve=>{window.__releaseBefore=resolve});
  const workflow={get user(){return identity},getState:()=>({capabilities:{media:false}}),pendingOperations:async()=>[],listAll:async()=>[{uid:'operator-X',displayName:'X'}],durableWrite:async(action,payload,key)=>{window.__sent.push({actor:identity.uid,action,payload,key});return {receiptId:key,submission:{id:key,submittedAt:'2026-11-17T00:00:00Z',media:[]}}}};
  window.__switchAccount=()=>{identity={uid:'anchor-B',role:'anchor',displayName:'B'};document.querySelector('#panel').remove();};
  const ui=mod.createCloudWorkspace({workflow,boards:[{id:'01',category:'电视',platforms:['京东']}],onIdentityReady:()=>{},onLogout:()=>{},onStart:()=>{}});
  await ui.mountSubmissionPanel(document.querySelector('#panel'),{getSnapshot:()=>({id:'private-session-A',anchorName:'anchor-A',turns:[{answer:'A的私人回答'}]}),beforeSubmit:async()=>{window.__beforeEntered=true;await gate;},onConfirmed:()=>{}});
 },source);
 await page.locator('#cloudSubmitOperator').selectOption('operator-X');await page.locator('#cloudTextOnlyConsent').check();await page.locator('#cloudSubmitText').click();
 await page.waitForFunction(()=>window.__beforeEntered);await page.evaluate(()=>{window.__switchAccount();window.__releaseBefore();});await page.waitForTimeout(100);
 const sent=await page.evaluate(()=>window.__sent);const result={scope:'real Chromium DOM, mocked cloud workflow; no network/Auth/database writes',sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),sent,wrongActorSend:sent.some(x=>x.actor==='anchor-B'&&x.payload.snapshot.anchorName==='anchor-A')};
 console.log(JSON.stringify(result,null,2));fs.writeFileSync('/workspace/r25-backend-tests/local-pg/workspace-stale-submit-result.json',JSON.stringify(result,null,2)+'\n');await browser.close();
})();
