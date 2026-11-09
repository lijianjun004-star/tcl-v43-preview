// Browser regression for local UI boundaries; these are not server-side authentication tests.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
(async () => {
 const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const page = await browser.newPage({acceptDownloads:true});
 // Test-only hooks expose module state, without changing the shipped application.
 await page.route('**/tcl-specialty-v33/app.js', async route => {
  const response=await route.fetch(); const body=await response.text();
  await route.fulfill({response,body:body+`\nwindow.__v348test={nav,getPage:()=>page,setData:(records,submissions)=>{localRecords=records;localSubmissions=submissions},showAnchorSummary,setAssignment:id=>activeAssignmentId=id,getAssignment:()=>activeAssignmentId,submitSessionRecord,setSubmissionScenario:(assignment,snapshot)=>{localAssignments=[assignment];lastSessionSnapshot=snapshot;localSubmissions=[]},getSubmissions:()=>localSubmissions};`});
 });
 try {
  await page.goto(process.env.TCL_URL || 'http://localhost:8765/tcl-specialty-v33/', {waitUntil:'load'});
  await page.waitForSelector('[data-role-pick="anchor"]');
  await page.click('[data-role-pick="anchor"]'); await page.fill('#simpleName','主播甲'); await page.click('#simpleLogin');
  await page.waitForSelector('#freePractice');
  assert.equal(await page.locator('[data-page="review"]').isVisible(),false);
  await page.evaluate(()=>__v348test.nav('review')); assert.equal(await page.evaluate(()=>__v348test.getPage()), 'home');
  await page.evaluate(()=>__v348test.setData([{id:'1',anchorName:'主播甲',answer:'甲私有'}, {id:'2',anchorName:'主播乙',answer:'乙私有'}, {id:'3',answer:'旧无归属私有'}],[{id:'s1',anchorName:'主播甲',operatorName:'运营甲',submittedAt:'2026-11-09T00:00:00Z',category:'电视',platform:'京东',turns:[{prompt:'问题',answer:'已提交给甲'}]},{id:'s2',anchorName:'主播甲',operatorName:'运营乙',submittedAt:'2026-11-09T00:00:00Z',category:'电视',platform:'京东',turns:[{prompt:'问题',answer:'已提交给乙'}]}]));
  await page.evaluate(()=>__v348test.nav('progress')); assert.match(await page.locator('#view').innerText(),/甲私有/); assert.doesNotMatch(await page.locator('#view').innerText(),/乙私有|旧无归属私有/);
  let [download] = await Promise.all([page.waitForEvent('download'),page.click('#backupBtn')]); let backup=JSON.parse(await fs.readFile(await download.path(),'utf8')); assert.deepEqual(backup.records.map(x=>x.answer),['甲私有']);
  await page.evaluate(()=>__v348test.nav('home')); await page.click('#switchIdentity'); await page.click('[data-role-pick="operator"]'); await page.fill('#simpleName','运营甲'); await page.click('#simpleLogin'); await page.waitForSelector('#anchorLookup');
  assert.equal(await page.locator('[data-page="progress"]').isVisible(),false); await page.evaluate(()=>__v348test.nav('progress')); assert.equal(await page.evaluate(()=>__v348test.getPage()),'home');
  await page.evaluate(()=>__v348test.showAnchorSummary('主播甲')); await page.locator('#anchorLookupResult details summary').click(); const summary=await page.locator('#anchorLookupResult').innerText(); assert.match(summary,/已提交给甲/); assert.doesNotMatch(summary,/已提交给乙|甲私有|乙私有|旧无归属私有/);
  [download] = await Promise.all([page.waitForEvent('download'),page.click('#backupBtn')]); backup=JSON.parse(await fs.readFile(await download.path(),'utf8')); assert.equal(backup.records,undefined); assert.deepEqual(backup.submissions.map(x=>x.turns[0].answer),['已提交给甲']); assert.doesNotMatch(JSON.stringify(backup),/乙私有|甲私有|旧无归属私有|已提交给乙/);
  for (const target of ['library','import','review','settings','home']) {
   await page.locator(`[data-page="${target}"]`).click();
   assert.doesNotMatch(await page.locator('#view').innerText(),/甲私有|乙私有|旧无归属私有|已提交给乙/);
  }
  await page.click('#switchIdentity'); await page.click('[data-role-pick="operator"]'); await page.fill('#simpleName','运营乙'); await page.click('#simpleLogin'); await page.waitForSelector('#anchorLookup');
  await page.fill('#anchorLookup','主播甲'); await page.locator('[data-anchor-name="主播甲"]').first().click(); await page.locator('#anchorLookupResult details summary').click();
  const otherSummary=await page.locator('#anchorLookupResult').innerText(); assert.match(otherSummary,/已提交给乙/); assert.doesNotMatch(otherSummary,/已提交给甲|甲私有|乙私有|旧无归属私有/);
  [download] = await Promise.all([page.waitForEvent('download'),page.click('#backupBtn')]); backup=JSON.parse(await fs.readFile(await download.path(),'utf8')); assert.deepEqual(backup.submissions.map(x=>x.turns[0].answer),['已提交给乙']); assert.doesNotMatch(JSON.stringify(backup),/甲私有|乙私有|旧无归属私有|已提交给甲/);
  await page.click('#switchIdentity'); await page.click('[data-role-pick="anchor"]'); await page.fill('#simpleName','主播甲'); await page.click('#simpleLogin'); await page.waitForSelector('#freePractice');
  await page.evaluate(()=>__v348test.setAssignment('old-assignment')); await page.click('[data-page="catalog"]'); assert.equal(await page.evaluate(()=>__v348test.getAssignment()),'');
  await page.evaluate(()=>{__v348test.setSubmissionScenario({id:'a1',operatorName:'原运营',boardId:'01',platform:'京东'},{id:'run1',anchorName:'主播甲',assignmentId:'a1',operatorName:'原运营',boardId:'01',category:'电视',platform:'京东',durationSeconds:10,turns:[{prompt:'问题',answer:'已提交答案'}]}); const button=document.createElement('button');button.id='submitSession';document.body.append(button)});
  await page.evaluate(()=>__v348test.submitSessionRecord('其他运营'));
  assert.equal(await page.evaluate(()=>__v348test.getSubmissions()[0].operatorName),'原运营');
  await page.evaluate(()=>__v348test.submitSessionRecord('其他运营'));
  assert.equal(await page.evaluate(()=>__v348test.getSubmissions().length),1);
  console.log('PASS: assignment submits only to publisher and cannot be resubmitted to another operator (browser simulation)');
  console.log('PASS: role navigation and display; anchor record ownership; role-scoped backup; assignment context reset (browser simulation)');
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
