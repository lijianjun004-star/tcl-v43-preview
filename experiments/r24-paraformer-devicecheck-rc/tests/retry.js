// "再练一次" after a finished session must auto-check devices with no extra tap.
const {chromium}=require('playwright');
const S=process.env.S, BASE=process.argv[2];
const st=page=>page.evaluate(()=>({start:document.getElementById('startScene')?.innerText.trim(),dis:document.getElementById('startScene')?.disabled,chk:document.getElementById('prepCheckStatus')?.innerText.trim()}));
(async()=>{
 const b=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${S}/audio/1.wav`]});
 const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,permissions:['camera','microphone']});
 const page=await ctx.newPage();page.setDefaultTimeout(15000);const errs=[];page.on('pageerror',e=>errs.push(e.message));
 await page.goto(BASE,{waitUntil:'networkidle'});await page.click('[data-role-pick="anchor"]');await page.fill('#simpleName','再练E');await page.click('#simpleLogin');await page.waitForTimeout(500);
 await page.click('#freePractice');
 await page.getByRole('button',{name:'准备 Paraformer'}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(x=>/Paraformer 已就绪/.test(x.innerText)),null,{timeout:120000});
 await page.waitForFunction(()=>!document.getElementById('startScene').disabled);
 await page.click('#startScene');await page.waitForTimeout(7000);
 await page.click('#focusClose');await page.click('#tclEndYes');
 await page.waitForSelector('#reviewRetry',{state:'visible',timeout:60000});await page.waitForTimeout(4000);
 const ans=await page.evaluate(()=>document.body.innerText.includes('已有回答'));
 await page.click('#reviewRetry');await page.waitForTimeout(500);
 const y=await page.$('#tclRestartYes');const dialog=!!(y&&await y.isVisible());if(dialog)await y.click();
 const t0=Date.now();let s;for(let i=0;i<150;i++){s=await st(page);if(s.start&&!s.dis)break;await page.waitForTimeout(100);}
 const pass=!!(s&&!s.dis&&s.start==='开始练播');
 console.log(JSON.stringify({restartDialog:dialog,reviewShown:ans,retryAutoReady:pass,ms:Date.now()-t0,state:s,pageErrors:errs}));
 await page.screenshot({path:`${S}/shots/cand-E-retry.png`});
 await b.close();process.exit(pass&&!errs.length?0:1);
})().catch(e=>{console.log('ERROR',e.message.split('\n')[0]);process.exit(2)});
