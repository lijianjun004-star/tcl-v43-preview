// R2.5 链路测试：真实 Vosk 模型（本机按线上同 URL 提供）+ 可选的本机合成普通话 WAV（espeak-ng，非真人）。
// 外部请求（jsDelivr / HuggingFace / 镜像）全部在本机拦截：MODE=abort 直接失败，MODE=hang 挂起不响应。不访问外网。
// 环境变量：SITE 站点根  SUB 子路径  ENGINE vosk|tiny|base|''  MODE abort|hang  VOSKPRE none|ready  AUDIO wav路径(可空=合成正弦音)  REC_MS 录音毫秒  OUT 结果json
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const E = process.env; const SITE = E.SITE, SUB = E.SUB, MODE = E.MODE || 'abort', VOSKPRE = E.VOSKPRE || 'none', ENGINE = E.ENGINE || '', AUDIO = E.AUDIO || '', REC_MS = +(E.REC_MS || 3000);
const VOICE = process.env.R25_VOICE_DIR; const BASE = 'https://lijianjun004-star.github.io/';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const TRAD = /[這們來說會為麼與個時對動應裡後東車長門開關體電視畫質點錢萬機變頻壓縮氣環聲讓買賣價總經過還實現術轉換螢幕軟體]/;
(async () => {
  const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
  if (AUDIO) args.push('--use-file-for-fake-audio-capture=' + AUDIO);
  const b = await chromium.launch({ args, executablePath: '/usr/bin/chromium' });
  const ctx = await b.newContext({ permissions: ['camera', 'microphone'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(([engine]) => { globalThis.__WHISPER_LOAD_TIMEOUT_MS = 6000; if (engine) try { localStorage.setItem('tcl-r25-asr-engine', engine); } catch {} }, [ENGINE]);
  await ctx.addInitScript({ path: path.join(__dirname, AUDIO ? 'r25-media-init-realaudio.js' : 'r24-media-init.js') });
  const ext = {}; let voiceHits = 0;
  await ctx.route('**/*', async r => {
    const u=new URL(r.request().url());
    if(u.origin+'/'!==BASE){ext[u.host]=(ext[u.host]||0)+1;return r.abort('internetdisconnected');}
    if(u.pathname.startsWith('/live-practice-room/voice/'))voiceHits++;
    return r.continue();
  });
  const p = await ctx.newPage(); const loads=[],readbacks=[];p.on('response',r=>{if(/\/tcl-v352-asr-r25-qa\/(app\.js|static-manifest\.json)(?:\?|$)/.test(r.url()))loads.push(r.body().then(b=>readbacks.push({url:r.url(),status:r.status(),sha256:require('crypto').createHash('sha256').update(b).digest('hex')})));}); const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('dialog', d => d.accept());
  const out = { sub: SUB, engine: ENGINE || '(default)', mode: MODE, voskPre: VOSKPRE, audio: AUDIO ? path.basename(AUDIO) + '（espeak-ng 合成普通话，非真人）' : '合成正弦音（非语音）' };
  const status = () => p.evaluate(() => document.querySelector('#liveTurnStatus')?.textContent?.trim() || '');
  try {
    await p.goto(BASE + 'tcl-v43-preview/' + SUB + '/'); await p.waitForSelector('[data-role-pick]');
    await p.click('[data-role-pick="anchor"]'); await p.fill('#simpleName', '测试'); await p.click('#simpleLogin'); await p.waitForSelector('#freePractice');
    out.selector = await p.evaluate(() => { const s = document.querySelector('#r23ModelChoice'); return s ? { value: s.value, options: [...s.options].map(o => o.value) } : null; });
    await p.click('#freePractice'); await p.waitForSelector('#startScene'); await p.click('#prepQuickRecheck').catch(() => {});
    await p.waitForFunction(() => !document.querySelector('#startScene').disabled, null, { timeout: 30000 });
    if (VOSKPRE === 'ready') {
      await p.waitForTimeout(800); await p.getByRole('button', { name: /准备备用 ?Vosk|下载中文识别模型/ }).first().click();
      await p.waitForFunction(() => /模型已就绪|识别已就绪/.test(document.body.innerText), null, { timeout: 240000 });
    }
    if (E.SHOT) await p.screenshot({ path: E.SHOT + '-1-prelive.png' });
    out.prelive = await p.evaluate(() => ({ voskBtn: document.querySelector('#preloadBeforeStart')?.textContent, hint: document.querySelector('.prep-simulation-hint')?.textContent }));
    await p.click('#startScene'); await p.waitForFunction(() => document.querySelector('#livePhone')?.classList.contains('is-focused'), null, { timeout: 20000 });
    await p.waitForFunction(() => document.querySelector('#focusMic').dataset.state === 'recording', null, { timeout: 10000 }).catch(() => {});
    out.autoRecording = await p.evaluate(() => document.querySelector('#focusMic').dataset.state);
    await p.waitForTimeout(REC_MS);
    if (await p.evaluate(() => document.querySelector('#focusMic').dataset.state) === 'recording') await p.click('#focusMic');
    if (E.MULTI) {
      await p.waitForTimeout(600); await p.click('#focusNext'); await p.waitForTimeout(REC_MS);
      await p.click('#focusNext'); await p.waitForTimeout(2500);
      if (await p.evaluate(() => document.querySelector('#focusMic').dataset.state) === 'recording') await p.click('#focusMic');
      await p.waitForTimeout(90000);
    }
    const t0 = Date.now(), timeline = []; let last = '';
    while (Date.now() - t0 < 240000) {
      const s = await status();
      if (s !== last) { timeline.push([Math.round((Date.now() - t0) / 1000), s.slice(0, 170)]); last = s; }
      if (/已转写|已写入本题|没有返回有效|识别未完成|锁定|未检测到/.test(s)) break;
      await p.waitForTimeout(500);
    }
    out.timeline = timeline;
    if (E.SHOT) await p.screenshot({ path: E.SHOT + '-2-live-after.png' });
    await p.click('#focusClose'); await p.waitForTimeout(700); await p.getByText('结束并进入复盘').click().catch(() => {});
    await p.waitForSelector('#submitSession', { timeout: 25000 }); await p.waitForTimeout(1200);
    await p.locator('#reviewGoDetails, #reviewDetails').first().click(); await p.waitForTimeout(800);
    out.review = await p.evaluate(() => { const box = document.querySelector('#questionSummary'); const ed = box?.querySelector('textarea'); return { answer: ed?.value || '', text: box?.innerText.replace(/\s+/g, ' ').slice(0, 300) }; });
    if (E.MULTI) out.questions = await p.evaluate(() => [...document.querySelectorAll('#questionSummary textarea')].map(t => { const card = t.closest('article,li,section,.question-card,div'); return { answer: t.value, card: (card?.parentElement?.innerText || '').replace(/\s+/g, ' ').slice(0, 220) }; }));
    out.answerFilled = !!out.review.answer.trim();
    if (E.SHOT) await p.screenshot({ path: E.SHOT + '-3-review.png' });
    out.answerHasTraditional = TRAD.test(out.review.answer);
  } catch (e) { out.interrupted = String(e).split('\n')[0]; await p.screenshot({ path: (E.OUT || '/tmp/x') + '.png' }).catch(() => {}); }
  await Promise.all(loads);out.loadedResourceReadbacks=readbacks;out.externalRequests = ext; out.voskFileRequests = voiceHits; out.pageErrors = errs.slice(0, 3);
  const json = JSON.stringify(out, null, 1); if (E.OUT) fs.writeFileSync(E.OUT, json); console.log(json); await b.close();
})();
