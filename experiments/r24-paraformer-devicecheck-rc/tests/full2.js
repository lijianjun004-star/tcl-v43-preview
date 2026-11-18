const {chromium}=require('playwright');
const S=process.env.S, PAGE=process.argv[2];
(async()=>{ 
 const browser=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${S}/audio/0.wav`]});
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,permissions:['camera','microphone']});
 const page=await ctx.newPage();
 const errs=[]; page.on('pageerror',e=>errs.push('pageerror '+e.message)); page.on('console',m=>{if(m.type()==='error')errs.push('console '+m.text())});
 page.on('requestfailed',r=>errs.push('reqfail '+r.url().slice(0,80)+' '+(r.failure()&&r.failure().errorText)));
 const ext=new Set(); page.on('request',r=>{try{const h=new globalThis.URL(r.url()).host; if(h&&h!=='lijianjun004-star.github.io'&&h!=='127.0.0.1:8765')ext.add(h)}catch{}});
 const dump=async(tag)=>{await page.screenshot({path:`${S}/shots/${tag}.png`});console.log('==',tag);console.log(await page.evaluate(()=>[...document.querySelectorAll('button,input,textarea,select')].filter(e=>e.offsetParent).map(e=>`${e.tagName}#${e.id}[${(e.innerText||e.value||e.placeholder||'').trim().slice(0,24).replace(/\n/g,' ')}]${e.disabled?'(dis)':''}`).join(' | ')))};
 await page.goto(PAGE,{waitUntil:'networkidle'});
 await page.click('[data-role-pick="anchor"]'); await page.fill('#simpleName','复验主播C'); await page.click('#simpleLogin'); await page.waitForTimeout(800);
 await page.click('#freePractice'); await page.waitForTimeout(1000);
 const t0=Date.now();
 await page.getByRole('button',{name:'准备 Paraformer'}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>/Paraformer 已就绪/.test(b.innerText)),null,{timeout:300000});
 console.log('pf ready s',Math.round((Date.now()-t0)/1000));
 await page.waitForFunction(()=>!document.getElementById('startScene').disabled,null,{timeout:30000});
 await page.click('#startScene'); await page.waitForTimeout(3000); await dump('c10-live');
 const txt=async()=>page.evaluate(()=>document.querySelector('.main')?.innerText||document.body.innerText);
 for(let q=1;q<=3;q++){
  await page.waitForTimeout(9000);
  await page.screenshot({path:`${S}/shots/11-q${q}-rec.png`});
  if(q<3){await page.click('#focusNext');}
  else{await page.click('#focusClose'); await page.waitForTimeout(800); await dump('12-endconfirm'); const y=await page.$('#tclEndYes'); if(y&&await y.isVisible())await y.click();}
  await page.waitForTimeout(1500);
 }
 const t1=Date.now();
 for(let i=0;i<40;i++){await page.waitForTimeout(3000); const t=await txt(); if(!/转写中|正在转写|排队/.test(t)||i===39){console.log('transcribe wait s',Math.round((Date.now()-t1)/1000));break;}}
 await dump('c13-review');
 await page.click('#reviewDetails'); await page.waitForTimeout(1500); await dump('c14-details');
 console.log((await txt()).slice(0,3000));
 const vals=await page.evaluate(()=>[...document.querySelectorAll('textarea')].map(t=>t.value)); console.log('TEXTAREAS',JSON.stringify(vals));
 await page.goto('about:blank'); await page.goto(PAGE,{waitUntil:'networkidle'});
 await page.click('[data-role-pick="anchor"]'); await page.fill('#simpleName','复验主播C'); await page.click('#simpleLogin'); await page.waitForTimeout(3000); await dump('c15-relogin');
 await page.click('#restoreLocalSession'); await page.waitForTimeout(3000); await dump('c16-restored');
 console.log('RESTORED_HEAD',(await txt()).slice(0,400).replace(/\n+/g,' / '));
 await page.click('#reviewDetails'); await page.waitForTimeout(1500);
 console.log('RESTORED_TEXTAREAS',JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('textarea')].map(t=>t.value.slice(0,40)))));
 await page.click('#reviewDetailsBack'); await page.waitForTimeout(800);
 await page.click('#reviewReplay'); await page.waitForTimeout(4000); await dump('c17-replay');
 console.log('MEDIA',JSON.stringify(await page.evaluate(async()=>{const els=[...document.querySelectorAll('video,audio')].filter(e=>e.offsetParent||e.closest('#view'));const out=[];for(const e of els){try{e.muted=true;await e.play().catch(x=>x);await new Promise(r=>setTimeout(r,1500));}catch{}out.push({tag:e.tagName,id:e.id,src:(e.currentSrc||'').slice(0,30),rs:e.readyState,dur:e.duration,t:e.currentTime,err:e.error&&e.error.code});}return out})));
 console.log('STORAGE',JSON.stringify(await page.evaluate(async()=>({idb:(await indexedDB.databases()).map(d=>d.name),ls:Object.keys(localStorage)}))));
  console.log('errs',errs,'ext',[...ext]);
 await browser.close();
})();
