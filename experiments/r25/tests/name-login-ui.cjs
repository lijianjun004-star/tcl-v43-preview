// Actual Chromium DOM/IndexedDB checks. Identity HTTP/Auth/business responses are synthetic here.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/workspace/r25-tools/node_modules/playwright');
const source=path.resolve(__dirname,'../tcl-v352-asr-r25-qa'),results=[],out=process.env.R25_NAME_UI_EVIDENCE;
const check=(name,value)=>{assert.ok(value,name);results.push({name,passed:true});};
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname),file=path.resolve(source,'.'+pathname);
 if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><main id="view"></main>');return;}
 if(!file.startsWith(source+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');fs.createReadStream(file).pipe(res);
});
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));await page.goto(base);
 await page.evaluate(async()=>{const{createCloudWorkspace}=await import('/cloud-workspace.mjs');window.__calls=[];window.__identityReady=0;window.__rejectRegister=false;window.__release=null;
 const workflow={user:null,getState:()=>({error:'',capabilities:{media:false}}),refreshIdentity:async()=>{},listAll:async()=>[],pendingOperations:async()=>[],signIn:async(...args)=>{window.__calls.push({action:'signIn',args});},register:async values=>{window.__calls.push({action:'register',values});if(window.__rejectRegister)throw new Error('姓名已使用，请直接登录或加部门');await new Promise(resolve=>window.__release=resolve);}};
 window.__workflow=workflow;window.__ui=createCloudWorkspace({workflow,boards:[{id:'tv',category:'电视',platforms:['京东']}],onIdentityReady:async()=>{window.__identityReady++;},onLogout:()=>{},onStart:()=>{}});await __ui.mount(document.querySelector('#view'));
 });
 check('first tab is invitation joining',await page.locator('#cloudJoinTab').getAttribute('aria-selected')==='true');
 check('registration asks only name password invite',await page.locator('#cloudRegisterForm input').count()===3);
 check('technical account input is absent',await page.locator('#cloudDisplayName').count()===0);
 check('later login is initially hidden',await page.locator('#cloudLoginForm').isHidden());
 await page.fill('#cloudRegisterName','主播甲');await page.fill('#cloudRegisterPassword','Joinpass123!');await page.fill('#cloudInvitationCode','invite-only');await page.locator('#cloudRegisterForm button').click();
 await page.waitForFunction(()=>window.__release!==null);check('registration uses actual register action',await page.evaluate(()=>__calls[0].action==='register'));
 check('join handler sends no self selected role or username',await page.evaluate(()=>Object.keys(__calls[0].values).sort().join(',')==='inviteCode,name,password'));
 check('password input cleared before wait',await page.inputValue('#cloudRegisterPassword')==='');check('tabs cannot start competing login while joining',await page.locator('#cloudNameLoginTab').isDisabled());
 check('no successful entry before registration settles',await page.evaluate(()=>__identityReady===0));await page.evaluate(()=>__release());await page.waitForFunction(()=>__identityReady===1);
 await page.click('#cloudNameLoginTab');check('later tab shows only name and password',await page.locator('#cloudLoginForm').isVisible()&&await page.locator('#cloudLoginForm input').count()===2);
 await page.fill('#cloudUsername','旧姓名');await page.fill('#cloudPassword','old');await page.locator('#cloudLoginForm button').click();await page.waitForFunction(()=>__identityReady===2);
 check('daily login accepts existing short password',await page.evaluate(()=>__calls.at(-1).args[1]==='old'));check('daily password is cleared',await page.inputValue('#cloudPassword')==='');
 await page.click('#cloudJoinTab');await page.evaluate(()=>__rejectRegister=true);await page.fill('#cloudRegisterPassword','Joinpass123!');await page.locator('#cloudRegisterForm button').click();await page.waitForSelector('[data-cloud-status].error');
 check('conflict is shown without claiming login',await page.evaluate(()=>__identityReady===2&&document.querySelector('[data-cloud-status]').textContent.includes('姓名已使用')));
 check('mobile has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'name-entry-mobile.png'),fullPage:true});}
 for(const role of ['operator','admin']){
  await page.evaluate(async role=>{__workflow.user={uid:role,role,displayName:'测试姓名'};await __ui.mount(document.querySelector('#view'));},role);
  check(role+' invitation choices follow allowed roles',await page.locator('#cloudInviteRole option').evaluateAll(nodes=>nodes.map(node=>node.value).join(','))===(role==='admin'?'anchor,operator':'anchor'));
  check(role+' invitation describes direct name joining',await page.locator('body').innerText().then(text=>text.includes('自己设置的密码和邀请码，即可加入')));
 }
 const storageResult=await page.evaluate(async()=>{
  const{createNameIdentityClient}=await import('/name-identity.mjs');const requests=[];
  const fetchImpl=async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);return{ok:true,json:async()=>({ok:true,data:{state:'ready',uid:'real-uid-placeholder',username:'r25n_opaque'}})};};
  const config={enabled:true,endpoint:'https://identity.example/name'},envId='browser-concurrent';
  const first=createNameIdentityClient({config,envId,fetchImpl}),second=createNameIdentityClient({config,envId,fetchImpl});
  await Promise.all([first.register({name:'主播乙',password:'Joinpass123!',inviteCode:'invite-a'}),second.register({name:'主播乙',password:'Joinpass123!',inviteCode:'invite-a'})]);
  const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('r25-name-identity:'+encodeURIComponent(envId));req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  const rows=await new Promise((resolve,reject)=>{const req=db.transaction('operations','readonly').objectStore('operations').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();
  return{requestCount:requests.length,oneOperation:new Set(requests.map(row=>row.operationId)).size===1,oneSecret:new Set(requests.map(row=>row.operationSecret)).size===1,oneRow:rows.length===1,secretLength:rows[0].operationSecret.length,noPassword:!JSON.stringify(rows).includes('Joinpass123!'),noInvite:!JSON.stringify(rows).includes('invite-a'),state:rows[0].state};
 });
 check('concurrent browser attempts share persisted operation',storageResult.oneOperation&&storageResult.oneRow);check('concurrent browser attempts retain same 256 bit secret',storageResult.oneSecret&&storageResult.secretLength===64);check('native IndexedDB contains no password or invite',storageResult.noPassword&&storageResult.noInvite);check('no browser errors',pageErrors.length===0);
 const output={scope:'Actual Chromium DOM and native IndexedDB; identity HTTP/Auth/business are synthetic. No cloud writes.',passed:results.length,total:results.length,results,storageResult,pageErrors,sha256:Object.fromEntries(['app.js','cloud-workflow.mjs','cloud-workspace.mjs','name-identity.mjs','style.css'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(source,name))).digest('hex')]))};
 if(out)fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(output,null,2)+'\n');process.stdout.write(JSON.stringify(output,null,2)+'\n');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
