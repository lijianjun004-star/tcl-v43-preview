// Candidate device-check scenarios. Usage: node devcheck.js <baseUrl> <tag>
const {chromium}=require('playwright');
const S=process.env.S, BASE=process.argv[2], TAG=process.argv[3]||'cand';
const results=[]; const ok=(name,pass,detail='')=>{results.push({name,pass,detail});console.log(pass?'PASS':'FAIL',name,detail)};
const st=page=>page.evaluate(()=>({start:document.getElementById('startScene')?.innerText.trim(),dis:document.getElementById('startScene')?.disabled,chk:document.getElementById('prepCheckStatus')?.innerText.trim()}));
async function enter(page,name){await page.goto(BASE,{waitUntil:'networkidle'});await page.click('[data-role-pick="anchor"]');await page.fill('#simpleName',name);await page.click('#simpleLogin');await page.waitForTimeout(500);}
(async()=>{
 const fakeArgs=['--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${S}/audio/0.wav`];
 // A: permission granted -> auto check after one tap, no second tap.
 {const b=await chromium.launch({args:['--use-fake-ui-for-media-stream',...fakeArgs]});const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,permissions:['camera','microphone']});const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
  await enter(page,'自动检测A');const seen=new Set();
  await page.click('#freePractice');const t0=Date.now();
  let s;for(let i=0;i<100;i++){s=await st(page);seen.add(s.chk+' | '+s.start);if(!s.dis)break;await page.waitForTimeout(100);}
  ok('A1 auto check reaches ready without second tap',!s.dis&&s.start==='开始练播'&&/已就绪/.test(s.chk),`${Date.now()-t0}ms ${JSON.stringify(s)}`);
  ok('A2 never shows legacy 准备中…',![...seen].some(x=>/准备中…/.test(x)),JSON.stringify([...seen]));
  ok('A3 camera preview live',await page.evaluate(()=>{const v=document.getElementById('liveCam');return !!(v&&v.srcObject&&v.srcObject.getVideoTracks().some(t=>t.readyState==='live'))}));
  // A4 manual recheck still works
  await page.click('#prepQuickRecheck');await page.waitForTimeout(200);let r;for(let i=0;i<100;i++){r=await st(page);if(!r.dis)break;await page.waitForTimeout(100);}
  ok('A4 manual recheck still reaches ready',!r.dis&&r.start==='开始练播',JSON.stringify(r));
  await page.screenshot({path:`${S}/shots/${TAG}-A-ready.png`});
  ok('A5 no page errors',errs.length===0,errs.join(';'));await b.close();}
 // B: permission denied (simulated NotAllowedError) -> honest copy; after "allow", manual retry works.
 {const b=await chromium.launch({args:['--use-fake-ui-for-media-stream',...fakeArgs]});const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,permissions:['camera','microphone']});
  await ctx.addInitScript(()=>{const real=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.__allow=false;window.__gumCalls=0;navigator.mediaDevices.getUserMedia=async c=>{window.__gumCalls++;if(!window.__allow)throw new DOMException('Permission denied','NotAllowedError');return real(c)};});
  const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
  await enter(page,'拒绝权限B');ok('B0 no media request before the tap',await page.evaluate(()=>window.__gumCalls===0));
  await page.click('#freePractice');let s;for(let i=0;i<100;i++){s=await st(page);if(/未就绪/.test(s.chk))break;await page.waitForTimeout(100);}
  ok('B1 denied shows click-to-retry copy',/请点击「检测摄像头与麦克风」重试/.test(s.chk)&&s.dis&&s.start==='设备未就绪',JSON.stringify(s));
  await page.screenshot({path:`${S}/shots/${TAG}-B-denied.png`});
  await page.evaluate(()=>{window.__allow=true});await page.click('#prepQuickRecheck');for(let i=0;i<100;i++){s=await st(page);if(!s.dis)break;await page.waitForTimeout(100);}
  ok('B2 after allowing, manual retry reaches ready',!s.dis&&s.start==='开始练播',JSON.stringify(s));
  ok('B3 no page errors',errs.length===0,errs.join(';'));await b.close();}
 // C: text-only during/after auto check.
 {const b=await chromium.launch({args:['--use-fake-ui-for-media-stream',...fakeArgs]});const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,permissions:['camera','microphone']});const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
  await enter(page,'文字C');await page.click('#freePractice');await page.click('#prepQuickText');await page.waitForTimeout(3000);const s=await st(page);
  ok('C1 text-only immediately after tap stays text mode',/文字练播已就绪/.test(s.chk)&&!s.dis,JSON.stringify(s));
  const cam=await page.evaluate(()=>{const v=document.getElementById('liveCam');return !!(v&&v.srcObject)});ok('C2 cancelled auto check left no camera attached',!cam);
  ok('C3 no page errors',errs.length===0,errs.join(';'));await b.close();}
 require('fs').writeFileSync(`${S}/e2e/${TAG}-devcheck.json`,JSON.stringify(results,null,1));
 console.log('SUMMARY',results.filter(r=>r.pass).length+'/'+results.length);
})();
