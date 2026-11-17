// Actual complete app and native IndexedDB. SDK/Auth/PG/name HTTP are synthetic to place exact race barriers.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const{chromium}=require(process.env.PLAYWRIGHT_MODULE||'/workspace/r25-tools/node_modules/playwright');
const source=path.resolve(__dirname,'../tcl-v352-asr-r25-qa'),out=process.env.R25_NAME_RACE_EVIDENCE,checks=[];
const check=(name,value)=>{assert.ok(value,name);checks.push({name,passed:true});};
const server=http.createServer((req,res)=>{const file=path.resolve(source,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(source+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',/\.(?:mjs|js)$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/json');fs.createReadStream(file).pipe(res);});
const sdk=`const current=()=>window.__nativeUid?{user:{id:window.__nativeUid}}:null;const auth={getSession:async()=>({data:{session:current()},error:null}),signInWithPassword:async()=>{window.__nativeUid='A';return{data:{session:current()},error:null}},signOut:async()=>{window.__nativeUid=null;return{data:{},error:null}},onAuthStateChange:callback=>{window.__emitAuth=(event,uid)=>callback(event,uid?{user:{id:uid}}:null);return{data:{subscription:{unsubscribe(){}}}}}};export default{init:()=>({auth:()=>auth,rdb:()=>({rpc:async(name,args)=>{if(args.action==='me'){window.__meStarted=true;if(window.__raceMode==='me')await new Promise(resolve=>window.__releaseMe=resolve);return{data:{ok:true,data:{registered:true,user:{uid:'A',role:'anchor',displayName:'私有主播A'},capabilities:{privateMedia:false}}},error:null}}return{data:{ok:true,data:{items:[]}},error:null}}})})};`;
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{for(const mode of ['me','partition','partition-auth-event']){
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await context.addInitScript(mode=>{window.__raceMode=mode;window.__nativeUid=null;localStorage.setItem('tcl-r25-asr-engine','tiny');},mode);
 await page.route('**/app-config.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({apiBase:'',cloudbase:{enabled:true,envId:'name-race-test',functionName:'r25wf_api',nameIdentity:{enabled:true,endpoint:'https://identity.example/name'}}})}));
 await page.route('**/vendor/cloudbase/cloudbase-sdk.mjs',route=>route.fulfill({contentType:'text/javascript',body:sdk}));
 await page.route('https://identity.example/name',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,data:{state:'ready',username:'r25n_opaque',uid:'A'}})}));
 await page.goto(base+'/index.html');await page.waitForSelector('#cloudNameLoginTab');
 const seeded=await page.evaluate(async mode=>{
  const key='tcl-specialty-v352-asr-r25-qa:cloud:name-race-test:A';const db=await new Promise((resolve,reject)=>{const req=indexedDB.open(key,1);req.onupgradeneeded=()=>{for(const name of ['items','records','prefs'])req.result.createObjectStore(name,{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  const record={id:'private-A-record',answer:'A私有文字应继续保留',createdAt:'2026-11-17T00:00:00Z'};await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put(record);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
  window.__aReads=0;const realGetAll=IDBObjectStore.prototype.getAll;IDBObjectStore.prototype.getAll=function(...args){if(this.transaction.db.name===key)window.__aReads++;return realGetAll.apply(this,args);};
  if(mode!=='me'){const realOpen=indexedDB.open.bind(indexedDB);indexedDB.open=function(...args){const request=realOpen(...args);if(args[0]===key){Object.defineProperty(request,'onsuccess',{set(fn){request.addEventListener('success',event=>{window.__partitionWaiting=true;window.__releasePartition=()=>fn.call(request,event);},{once:true});}});}return request;};}
  return record;
 },mode);
 await page.click('#cloudNameLoginTab');await page.fill('#cloudUsername','私有主播A');await page.fill('#cloudPassword','old');await page.locator('#cloudLoginForm button').click();
 if(mode==='me'){await page.waitForFunction(()=>!!window.__releaseMe);await page.evaluate(()=>{__nativeUid='B';__releaseMe();});}
 else{await page.waitForFunction(()=>!!window.__partitionWaiting);await page.evaluate(mode=>{__nativeUid='B';if(mode==='partition-auth-event')__emitAuth('SIGNED_IN','B');__releasePartition();},mode);}
 try{await page.waitForSelector('[data-cloud-status].error');}catch(error){if(out){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,mode+'-failed.json'),JSON.stringify({mode,errors,body:await page.locator('body').innerText(),state:await page.evaluate(()=>({uid:window.__nativeUid,reads:window.__aReads,me:window.__meStarted}))},null,2));await page.screenshot({path:path.join(out,mode+'-failed.png'),fullPage:true});}throw error;}await page.waitForTimeout(50);
 check(mode+' rejects stale identity before successful workspace',await page.locator('#cloudFreePractice').count()===0&&await page.locator('#cloudNameLoginTab').count()===1);
 check(mode+' shows explicit changed-session error',(await page.locator('[data-cloud-status]').innerText()).includes('改变'));
 check(mode+' has no browser error',errors.length===0);
 if(mode==='me')check('me drift never reads A local records',await page.evaluate(()=>__aReads===0));
 else check(mode+' exercises delayed actual A IndexedDB read',await page.evaluate(()=>__aReads>0));
 const preserved=await page.evaluate(async()=>{const req=indexedDB.open('tcl-specialty-v352-asr-r25-qa:cloud:name-race-test:A',1);const db=await new Promise(resolve=>req.addEventListener('success',()=>resolve(req.result),{once:true}));const record=await new Promise(resolve=>{const request=db.transaction('records','readonly').objectStore('records').get('private-A-record');request.onsuccess=()=>resolve(request.result);});db.close();return record;});
 check(mode+' leaves original A record byte-equivalent',JSON.stringify(seeded)===JSON.stringify(preserved));
 if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,mode+'.png'),fullPage:true});}await context.close();
}
const result={scope:'Complete app Chromium DOM and native IndexedDB; official SDK/Auth/PG and name HTTP replaced only to control exact race timing. No cloud requests.',passed:checks.length,total:checks.length,checks,sha256:Object.fromEntries(['app.js','cloud-workflow.mjs','cloud-workspace.mjs','name-identity.mjs'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(source,name))).digest('hex')]))};if(out)fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await browser.close();server.close();}})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
