import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright-core';

const envId = 'unknown-roadrunner-d7cap6e21f517';
const siteHost = envId + '-1519058345.tcloudbaseapp.com';
const apiHost = envId + '-1519058345.ap-shanghai.app.tcloudbase.com';
const expectedVersion = process.env.TCL_V2_EXPECTED_VERSION || 'R24-20261124.10';
const runTag = '验收' + randomBytes(4).toString('hex');
const names = { operator: runTag + '运营', anchor: runTag + '主播' };
const title = runTag + '三题作业';
const questions = [1, 2, 3].map(i => `请介绍 TEST-A${i} 的合成测试功能？`);
const answers = [1, 2, 3].map(i => `模拟回答第${i}题，TEST-A${i}仅用于验收。`);
const codePattern = /^R24-[0-9a-f]{24}$/;
const tokenPattern = /^r24d_[0-9a-f]{64}$/;
const rolePicker = '#syncRole';
const nameField = '#syncDisplayName';
const submit = '#syncLoginForm button[type="submit"]';
const activationField = '#syncActivationCode';
const checks = [];
const counts = Object.create(null);
const allowedCodes = new Set();
const errors = [];
const diagnostics = {};
let stage = 'configuration';
let assignmentId = null;
let submissionId = null;
let browser, work, server;
let audioConfirmed = false;

function settings() {
  if (process.env.TCL_V2_LOCAL === '1') return null;
  const site = new URL(process.env.TCL_PILOT_URL || `https://${siteHost}/tcl-r24-cloud-sync-pilot/`);
  const api = new URL(process.env.TCL_PILOT_API_BASE || `https://${apiHost}/tcl-r24-sync`);
  assert.equal(site.href, `https://${siteHost}/tcl-r24-cloud-sync-pilot/`);
  assert.equal(api.href.replace(/\/$/, ''), `https://${apiHost}/tcl-r24-sync`);
  return { site, api, local: false };
}

function routeName(url, config) {
  if (url.origin !== config.api.origin || !url.pathname.startsWith(config.api.pathname + '/')) return null;
  return url.pathname.slice(config.api.pathname.length);
}

function permit(request, config, label, ready) {
  const url = new URL(request.url());
  const method = request.method();
  if (url.origin === config.site.origin && url.pathname.startsWith(config.site.pathname) &&
    ['GET', 'HEAD'].includes(method)) return true;
  const path = routeName(url, config);
  if (!path || !ready) return false;
  const assignmentPath = assignmentId ? '/assignments/' + encodeURIComponent(assignmentId) : null;
  const subPath = assignmentPath && submissionId ? assignmentPath + '/submissions/' + encodeURIComponent(submissionId) : null;
  if (['GET','OPTIONS'].includes(method)) {
    return ['/me','/device/auto-enroll','/device/activate','/device/code','/assignments','/assignments?'].includes(path) ||
      Boolean(assignmentPath && path.startsWith(assignmentPath+'/')) ||
      ['/submissions','/records'].includes(path);
  }
  if (method !== 'POST' || url.search) return false;
  let body;
  try { body = request.postDataJSON(); } catch { return false; }
  const role = label === 'operator' ? 'operator' : 'anchor';
  if (path === '/device/auto-enroll') {
    return body.name === names[role] && tokenPattern.test(body.deviceCredential || '') &&
      (body.role === role || (label === 'recovery' && body.role === 'operator'));
  }
  if (path === '/device/activate') {
    return ['recovery','spent','replaced'].includes(label) && (body.displayName ?? body.name) === names.anchor &&
      allowedCodes.has(body.code) && tokenPattern.test(body.deviceToken || body.deviceCredential || '');
  }
  if (path === '/device/code') return label === 'anchor' && body && !Array.isArray(body) && Object.keys(body).length === 0;
  if (path === '/assignments') {
    return label === 'operator' && body.assignment?.title === title && body.assignment?.operatorName === names.operator &&
      body.assignment?.questions?.map(q => q.question).join() === questions.join() && body.recipientIds?.length === 0;
  }
  if (!assignmentPath || label !== 'anchor') return false;
  if (path === assignmentPath + '/claim') return body && Object.keys(body).length === 0;
  if (path === assignmentPath + '/submissions') {
    return body.snapshot?.assignmentId === assignmentId && body.snapshot?.anchorName === names.anchor &&
      body.snapshot?.turns?.map(turn => turn.answer).join() === answers.join();
  }
  return !!subPath && path === subPath + '/audio' && typeof body.questionId === 'string' &&
    /^(audio\/webm|audio\/ogg|audio\/mp4|audio\/wav)/.test(body.mimeType || '') &&
    typeof body.base64 === 'string' && body.base64.length > 0 && body.base64.length <= 700_000;
}

function apiResponse(page, config, method, path) {
  return page.waitForResponse(response => response.request().method() === method && routeName(new URL(response.url()),config) === path);
}

function expectStatus(response, expected, label) {
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status()), label + ' HTTP ' + response.status());
}

async function makeBrowser(config, label) {
  const context = await browser.newContext({
    viewport: {width:390,height:844}, serviceWorkers:'block', acceptDownloads:true,
    permissions: ['camera','microphone','clipboard-read','clipboard-write'],
  });
  let ready = false;
  const checkSlowModel = config.local && label === 'anchor' && process.env.TCL_V2_DELAY_ASR === '1';
  await context.route('**/*',route=>{
    const request=route.request();
    if(checkSlowModel && new URL(request.url()).pathname.endsWith('/vendor/paraformer/sherpa-onnx-wasm-main-vad-asr.data')){
      diagnostics.delayedModel = true;
      return new Promise(resolve=>setTimeout(resolve,25_000)).then(()=>route.continue()).catch(()=>{});
    }
    if(permit(request,config,label,ready))return route.continue();
    const url=new URL(request.url());
    // Platform favicon or cross-origin resources are blocked. Do not log URL query strings.
    if(url.pathname !== '/favicon.ico') counts.blocked=(counts.blocked||0)+1;
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25_000);
  page.on('pageerror',error=>{
    errors.push(error.name);
    diagnostics.pageErrorNames = [...new Set(errors)];
    if(process.env.TCL_V2_LOCAL==='1')console.error(String(error.stack).slice(0,1600));
  });
  page.on('dialog',dialog=>{
    if(dialog.message().includes('部分录音仍在转写'))diagnostics.confirmedPendingTranscription = true;
    void dialog.accept();
  });
  if(label==='anchor') page.on('requestfailed',request=>{
    const path=routeName(new URL(request.url()),config);
    if(path?.endsWith('/submissions')) diagnostics.textRequestFailed=true;
  });
  page.on('response',response=>{
    const path=routeName(new URL(response.url()),config);
    if(!path)return;
    if(response.request().method()==='POST' && path.endsWith('/submissions') && response.ok()){
      void response.json().then(data=>{submissionId=data.submission?.id||submissionId;}).catch(()=>{});
    }
    const key = response.request().method()+' '+path.replaceAll(assignmentId||'\0','[assignment]').replaceAll(submissionId||'\0','[submission]')+' '+response.status();
    counts[key]=(counts[key]||0)+1;
    if(path.endsWith('/audio')&&response.status()>=400){
      void response.json().then(data=>{
        const code=data.error?.code;
        if(typeof code==='string'&&/^[A-Z_]{1,50}$/.test(code)) diagnostics.audioFailureCodes=[...new Set([...(diagnostics.audioFailureCodes||[]),code])];
      }).catch(()=>{});
    }
  });

  const entry=new URL('index.html',config.site);
  let response=await page.goto(entry.href,{waitUntil:'domcontentloaded'});
  if(!config.local && response?.status()===404 && await page.title()==='风险提醒'){
    const text=await page.locator('.redirect-page__desc').innerText();
    assert.ok(text.includes(siteHost));
    [response]=await Promise.all([
      page.waitForResponse(r=>r.request().isNavigationRequest()&&r.url()===entry.href),
      page.getByRole('button',{name:'确定访问',exact:true}).and(page.locator('#submitBtn')).click(),
    ]);
  }
  expectStatus(response,200,'public application entry');
  assert.equal(page.url(),entry.href);
  await page.locator(nameField).waitFor();
  await page.locator('#syncReleaseVersion').filter({hasText:expectedVersion}).waitFor();
  if(!config.local){
    const publicConfig=await (await page.request.get(new URL('app-config.json',config.site).href)).json();
    assert.equal(publicConfig.assignmentSync.envId,envId);
    assert.equal(publicConfig.assignmentSync.apiBase.replace(/\/$/,''),config.api.href.replace(/\/$/,''));
  }
  ready=true;
  return {page,context};
}

async function setRole(page,role){
  const picker=page.locator(rolePicker);
  const tag=await picker.evaluate(node=>node.tagName);
  if(tag==='SELECT') await picker.selectOption(role);
  else await page.locator('input[name="syncRole"][value="'+role+'"]').check();
}

async function enter(page,config,role,name=names[role],expected=200){
  await setRole(page,role);
  await page.locator(nameField).fill(name);
  const [response]=await Promise.all([apiResponse(page,config,'POST','/device/auto-enroll'),page.locator(submit).click()]);
  expectStatus(response,expected,'auto enrollment');
  const result=await response.json();
  if(expected===200){
    assert.equal(result.status,'enrolled');
    assert.equal(result.name,name);
    assert.equal(result.role,role);
    assert.ok(result.deviceId);
    await page.locator('.identity-bar').filter({hasText:name}).waitFor();
  }
  return result;
}

async function publish(page,config,excel){
  await page.locator('[data-ops-tab="publish"]').click();
  await page.locator('#assignmentTitle').fill(title);
  await page.locator('#assignmentBoard').selectOption('01');
  await page.locator('#assignmentPlatform').selectOption('京东');
  await page.locator('#assignmentExcelFile').setInputFiles(excel);
  await page.locator('#assignmentExcelPreviewBtn').click();
  await page.locator('#assignmentExcelPreview').getByText('3 道',{exact:false}).waitFor();
  const [response]=await Promise.all([apiResponse(page,config,'POST','/assignments'),page.locator('#publishAssignment').click()]);
  expectStatus(response,[200,201],'publish assignment');
  const {assignment}=await response.json();
  assert.deepEqual(assignment.questions.map(q=>q.question),questions);
  assert.equal(assignment.assignedTo.length,0);
  assert.match(assignment.id,/^[a-zA-Z0-9_-]{1,128}$/);
  assignmentId=assignment.id;
  checks.push('新运营自动开通，合成 Excel 作业写入云端');
}

async function runPractice(page,config){
  const assignmentPath='/assignments/'+encodeURIComponent(assignmentId);
  await page.locator('#assignmentFold summary').click();
  await page.locator('#assignmentSearch').fill(names.operator);
  const join=page.locator(`[data-join-assignment="${assignmentId}"]`).last();
  const [claimed]=await Promise.all([apiResponse(page,config,'POST',assignmentPath+'/claim'),join.click()]);
  expectStatus(claimed,[200,201],'claim assignment');

  stage='prepare-synthetic-media';
  diagnostics.media = await page.evaluate(()=>({secure:isSecureContext, camera:Boolean(navigator.mediaDevices?.getUserMedia),
    recorder:Boolean(window.MediaRecorder)}));
  const ready=page.locator('#startScene');
  const check=page.locator('#prepQuickRecheck');
  await check.waitFor();
  if(!(await ready.isEnabled()))await check.click();
  await page.waitForFunction(()=>document.querySelector('#startScene')?.disabled===false);
  await ready.click();
  stage='record-synthetic-answers';
  for(let i=0;i<questions.length;i++){
    await page.locator('#liveQText').filter({hasText:questions[i]}).waitFor();
    await page.locator('#focusMic').filter({hasText:/结束|停止/}).waitFor();
    // Give the synthetic microphone enough frames to produce playable audio.
    await page.waitForTimeout(1050);
    if(i<questions.length-1) await page.locator('#focusNext').click();
  }
  await page.locator('#focusClose').click();
  await page.getByRole('button',{name:'结束并进入复盘',exact:true}).click();
  stage='review-synthetic-answers';
  await page.locator('#reviewDetails').click();
  const rows=page.locator('#questionSummary tr').filter({has:page.locator('textarea')});
  for(let i=0;i<answers.length;i++){
    const row=rows.nth(i);
    await row.locator('audio').waitFor();
    await row.locator('textarea').fill(answers[i]);
    await row.getByRole('button',{name:'保存本题修改',exact:true}).click();
  }
  await page.locator('#reviewDetailsBack').click();
  stage='submit-text';
  const [submitted]=await Promise.all([apiResponse(page,config,'POST',assignmentPath+'/submissions'),page.locator('#submitSession').click()]);
  expectStatus(submitted,[200,201],'submit assignment text');
  const {submission}=await submitted.json();
  submissionId=submission.id;
  assert.deepEqual(submission.turns.map(t=>t.answer),answers);
  if(config.local && process.env.TCL_V2_DELAY_ASR==='1')assert.equal(diagnostics.confirmedPendingTranscription,true);
  stage='upload-audio';
  const uploaded=page.locator('#syncAudioUploadStatus').filter({hasText:'3 段逐题录音已上传'});
  const retry=page.locator('#syncReviewAudioStatus [data-retry-cloud-audio]:enabled:not([hidden])');
  await uploaded.or(retry).waitFor({timeout:60_000});
  if(await retry.isVisible())await retry.click();
  try {
    await uploaded.waitFor({timeout:60_000});
    audioConfirmed = true;
  } catch (error) {
    if(error.name !== 'TimeoutError' || process.env.TCL_V2_COMPLETE_OTHER_CHECKS !== '1')throw error;
    diagnostics.audioNotConfirmed = true;
  }
  checks.push('新主播自动开通并领取，录制三段合成音频，文字回答提交成功');
}

async function verifyInbox(page,config){
  const assignmentPath='/assignments/'+encodeURIComponent(assignmentId);
  await page.locator('[data-ops-tab="tracking"]').click();
  await page.locator('#syncRefresh').click();
  const open=page.locator(`[data-sync-submissions="${assignmentId}"]`).first();
  const [response]=await Promise.all([apiResponse(page,config,'GET',assignmentPath+'/submissions'),open.click()]);
  expectStatus(response,200,'operator submissions');
  const {submissions}=await response.json();
  assert.equal(submissions.length,1);
  assert.equal(submissions[0].anchorName,names.anchor);
  assert.deepEqual(submissions[0].turns.map(turn=>turn.answer),answers);
  await page.locator('#syncInbox').filter({hasText:/已提交/}).waitFor();
  await page.locator('#syncInbox details summary').click();
  for(const answer of answers)await page.locator('#syncInbox').getByText(answer,{exact:true}).waitFor();
  if(audioConfirmed) {
    assert.equal(submissions[0].audio?.length,answers.length);
    for(let i=0;i<answers.length;i++){
      const turn=page.locator('#syncInbox .submission-turn').nth(i);
      await turn.locator('[data-cloud-audio]').click();
      const audio=turn.locator('audio');
      await audio.waitFor();
      const advanced=await audio.evaluate(async element=>{
        await element.play();
        return new Promise(resolve=>{
          const timer=setTimeout(()=>resolve(false),3500);
          element.addEventListener('timeupdate',()=>{if(element.currentTime>0){clearTimeout(timer);element.pause();resolve(true);}},{passive:true});
        });
      });
      assert.ok(advanced,'authorized operator received playable small audio');
    }
  }
  await page.locator('[data-ops-tab="lookup"]').click();
  await page.locator('#syncRecordsAssignment').selectOption(assignmentId);
  await page.locator('#syncAnchorLookup').fill(names.anchor);
  const records=page.locator('#syncAnchorRecords');
  const matching=records.locator('details summary').filter({hasText:names.anchor});
  await matching.first().waitFor();
  assert.equal(await matching.count(),1);
  await matching.click();
  for(const answer of answers)await records.getByText(answer,{exact:true}).waitFor();
  checks.push('运营的作业进度与主播记录均显示唯一提交和三题文字'+(audioConfirmed?'，三段云端录音均实际播放':''));
}

async function verifyOperatorReturn(page,config){
  const [restored]=await Promise.all([apiResponse(page,config,'GET','/me'),page.reload({waitUntil:'domcontentloaded'})]);
  expectStatus(restored,200,'operator remembered binding');
  await page.locator('.identity-bar').filter({hasText:names.operator}).waitFor();
  await page.locator('#switchIdentity').click();
  await setRole(page,'anchor');
  await page.locator(nameField).fill(names.operator);
  const [checked]=await Promise.all([apiResponse(page,config,'GET','/me'),page.locator(submit).click()]);
  expectStatus(checked,200,'operator wrong role check');
  const accept=page.getByRole('button',{name:'以直播运营身份进入',exact:true});
  await accept.waitFor();
  assert.equal(await page.locator('.identity-bar').count(),0);
  assert.equal(await page.locator(activationField).isVisible(),false);
  await accept.click();
  await page.locator('.identity-bar').filter({hasText:names.operator}).waitFor();
  checks.push('运营刷新自动回访，退出后错选主播角色时须确认才以已绑定运营身份进入');
}

async function deviceCode(page,config,save=false){
  const tools=page.locator('#syncDeviceTools');
  if(await tools.getAttribute('open')===null)await tools.locator('summary').click();
  let issueButton=tools.locator('#syncGenerateDeviceCode');
  const confirmation=tools.locator('#syncRegenerateDialog');
  if(await tools.locator('#syncDeviceCodeResult').isVisible()&&await confirmation.count()){
    await issueButton.click();
    issueButton=confirmation.getByRole('button',{name:'确认重新生成',exact:true});
  }
  const [response]=await Promise.all([apiResponse(page,config,'POST','/device/code'),issueButton.click()]);
  expectStatus(response,200,'device code issue');
  const {code,expiresAt,name,role}=await response.json();
  assert.match(code,codePattern);
  assert.equal(name,names.anchor);
  assert.equal(role,'anchor');
  assert.ok(Date.parse(expiresAt)-Date.now()>=29*60*1000 && Date.parse(expiresAt)-Date.now()<=31*60*1000);
  allowedCodes.add(code);
  await page.waitForFunction(expected=>document.querySelector('#syncGeneratedDeviceCode')?.value===expected,code);
  await tools.locator('#syncDeviceOwner').filter({hasText:names.anchor}).waitFor();
  await tools.locator('#syncDeviceCountdown').filter({hasText:/剩余 [0-9]{2}:[0-9]{2}/}).waitFor();
  if(save){
    await tools.locator('#syncCopyDeviceCode').click();
    await page.waitForFunction(async expected=>(await navigator.clipboard.readText())===expected,code);
    const [download]=await Promise.all([page.waitForEvent('download'),tools.locator('#syncSaveDeviceCode').click()]);
    const saved=await readFile(await download.path(),'utf8');
    const codes=saved.match(/R24-[a-f0-9]{24}/g);
    assert.equal(codes?.length,1);
    assert.equal(saved,code);
    checks.push('28 字符 R24 码展示、剪贴板和下载内容完全一致');
  }
  return code;
}

async function activate(page,config,code,expected,decorate=false){
  const field=page.locator(activationField);
  if(decorate){
    await field.evaluate((input,value)=>{
      const clip=new DataTransfer();
      clip.setData('text/plain',' Ｒ２４—'+value.slice(4,12)+'\n\u200b '+value.slice(12)+' ');
      input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clip,bubbles:true,cancelable:true}));
    },code);
    assert.equal(await field.inputValue(),code);
  } else await field.fill(code);
  const [response]=await Promise.all([apiResponse(page,config,'POST','/device/activate'),page.locator(submit).click()]);
  expectStatus(response,expected===null?200:[400,401,403,409,410,422,429],'activate device');
  const data=await response.json();
  if(expected)assert.equal(data.errorCode??data.error?.code,expected);
  return data;
}

try {
  let config=settings();
  if(!config){
    const {startTestSite}=await import('./test-site.mjs');
    server=await startTestSite();
    config={site:new URL(server.origin+'/sync/'),api:new URL(server.origin+'/api/tcl-r24-sync'),local:true};
  }
  work=await mkdtemp(join(tmpdir(),'r24-v2-'));
  const excel=join(work,'synthetic-three-questions.xlsx');
  await promisify(execFile)('python3',[new URL('./fixtures.py',import.meta.url).pathname,excel]);
  const launch={
    executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',
    args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'],
  };
  if(process.env.TCL_PILOT_PROXY&&!config.local)launch.proxy={server:process.env.TCL_PILOT_PROXY};
  browser=await chromium.launch(launch);
  stage='auto-enroll-operator';
  const operator=await makeBrowser(config,'operator');
  await enter(operator.page,config,'operator');
  stage='publish-xlsx';
  await publish(operator.page,config,excel);
  stage='auto-enroll-anchor';
  const anchor=await makeBrowser(config,'anchor');
  await enter(anchor.page,config,'anchor');
  stage='claim-record-submit';
  await runPractice(anchor.page,config);
  stage='operator-return';
  await verifyOperatorReturn(operator.page,config);
  stage='operator-playback';
  await verifyInbox(operator.page,config);
  stage='code-generator';
  await anchor.page.locator('#reviewHome').click();
  const replaced=await deviceCode(anchor.page,config);
  const current=await deviceCode(anchor.page,config,true);
  assert.notEqual(replaced,current);
  stage='role-collision';
  const fresh=await makeBrowser(config,'recovery');
  const registered=await enter(fresh.page,config,'operator',names.anchor,409);
  assert.equal(registered.errorCode??registered.error?.code,'ALREADY_ENROLLED');
  assert.equal(registered.registeredRole,'anchor');
  await fresh.page.locator(activationField).waitFor();
  assert.equal(await fresh.page.locator(rolePicker).inputValue(),'anchor');
  let invalidPost=false;
  const trapInvalid=request=>{
    if(request.method()==='POST'&&routeName(new URL(request.url()),config)==='/device/activate')invalidPost=true;
  };
  fresh.page.on('request',trapInvalid);
  await fresh.page.locator(activationField).fill('1234567890abcdef');
  await fresh.page.locator(submit).click();
  await fresh.page.locator('#syncLoginError').filter({hasText:/28/}).waitFor();
  fresh.page.off('request',trapInvalid);
  assert.equal(invalidPost,false);
  checks.push('本机拦截 16 位无前缀输入，未发送激活请求');
  checks.push('新浏览器选错角色自动纠正为已有主播身份，未覆盖');
  stage='activate-replacement-and-replay';
  await activate(fresh.page,config,replaced,'CODE_EXPIRED');
  const bound=await activate(fresh.page,config,current,null,true);
  assert.equal(bound.principal?.role??bound.role,'anchor');
  await fresh.page.locator('.identity-bar').filter({hasText:names.anchor}).waitFor();
  const fold=fresh.page.locator('#assignmentFold');
  if(await fold.getAttribute('open')===null)await fold.locator('summary').click();
  await fresh.page.locator('#assignmentSearch').fill(names.operator);
  await fresh.page.locator('#assignmentSearchResults .assignment-row').filter({hasText:title}).filter({hasText:/已提交/}).waitFor();
  const spent=await makeBrowser(config,'spent');
  await enter(spent.page,config,'anchor',names.anchor,409);
  await activate(spent.page,config,current,'CODE_USED');
  checks.push('被替换的未用码失效，含全角与空白的有效码绑定成功并读取原作业，第三浏览器复用得到 CODE_USED');
  stage='remembered-binding';
  const [me]=await Promise.all([apiResponse(fresh.page,config,'GET','/me'),fresh.page.reload({waitUntil:'domcontentloaded'})]);
  expectStatus(me,200,'remembered binding');
  await fresh.page.locator('.identity-bar').filter({hasText:names.anchor}).waitFor();
  checks.push('同一浏览器回访自动验证绑定并进入');
  assert.deepEqual(errors,[]);
  stage=audioConfirmed?'passed':'audio-unconfirmed';
  if(!audioConfirmed)process.exitCode=1;
} catch (error) {
  // Errors can contain request data or bearer keys. Record only safe classifications.
  if(process.env.TCL_V2_LOCAL==='1') console.error(error.stack);
  diagnostics.failure = error.name;
  diagnostics.testLine = /v2-smoke\.mjs:(\d+):/.exec(error.stack || '')?.[1];
  process.exitCode=1;
} finally {
  if(browser)await browser.close();
  if(server)await server.close();
  if(work)await rm(work,{recursive:true,force:true});
}
console.log(JSON.stringify({pass:!process.exitCode,stage,version:expectedVersion,runTag,checks,counts,pageErrors:errors.length,diagnostics}));
