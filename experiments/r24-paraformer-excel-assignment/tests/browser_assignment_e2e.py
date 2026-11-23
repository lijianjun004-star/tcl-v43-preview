#!/usr/bin/env python3
"""Real UI / IndexedDB / MediaRecorder tests; ASR worker alone is an explicit stub.

No successful business responses, application state, or database rows are injected.
Run against the staged official and candidate sites with the same origin.
"""
import argparse
import asyncio
import hashlib
import json
import math
import struct
import time
import traceback
import wave
from pathlib import Path
from urllib.parse import urlparse

from openpyxl import Workbook
import xlwt
from playwright.async_api import async_playwright, expect

QA = '/tcl-r24-paraformer-excel-qa/'
OFFICIAL = '/tcl-r24-paraformer/'
DB = 'tcl-specialty-r24-paraformer-excel-qa-v1'
OPERATOR = '合成验收运营'
ANCHOR = '合成文字主播'
MEDIA_ANCHOR = '合成媒体主播'
QUESTIONS = [f'请介绍 TEST-A{i} 的合成测试功能？' for i in range(1, 4)]
ANSWERS = [f'人工回答第{i}题：TEST-A{i} 为合成型号，信息仅用于流程测试。' for i in range(1, 4)]
MOCK_WORKER = """
// Explicit ASR-only fixture. This does not mock media, UI, storage or submission.
let n=0;
self.addEventListener('message', ({data:m}) => {
 if(!m || !Number.isSafeInteger(m.id)) return;
 const result=m.type==='load'?{heapBytes:1024}:{text:'合成识别候选'+(++n)+'请人工核对',heapBytes:1024};
 setTimeout(()=>self.postMessage({id:m.id,type:'result',result}),80);
});
"""
MEDIA_OBSERVER = r"""(() => {
 const log=[];Object.defineProperty(window,'__qaMediaTrace',{value:log});
 const add=(kind,data={})=>{log.push({kind,at:performance.now(),wall:Date.now(),...data});if(log.length>2000)log.shift();};
 const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
 URL.createObjectURL=function(value){const url=create(value);add('url-create',{url,bytes:value?.size??null,type:value?.type??null,stack:new Error().stack});return url;};
 URL.revokeObjectURL=function(url){add('url-revoke',{url:String(url),stack:new Error().stack});return revoke(url);};
 for(const name of ['loadstart','loadedmetadata','loadeddata','canplay','play','playing','pause','ended','abort','emptied','error']){
  document.addEventListener(name,event=>{const e=event.target;if(!(e instanceof HTMLMediaElement))return;
   add('media-'+name,{tag:e.tagName,id:e.id,src:e.getAttribute('src'),currentSrc:e.currentSrc,connected:e.isConnected,readyState:e.readyState,networkState:e.networkState,error:e.error?{code:e.error.code,message:e.error.message}:null});
  },true);
 }
 for(const name of ['pagehide','beforeunload'])window.addEventListener(name,()=>add(name));
})();"""


def fixtures(folder):
    folder.mkdir(parents=True, exist_ok=True)
    rows = [['题目', '参考答案', '型号', 'SKU', '评分要点']]
    rows += [[q, f'合成参考答案{i}，应说明测试信息。', f'TEST-A{i}', f'00000{i}', '合成测试；信息核对'] for i, q in enumerate(QUESTIONS, 1)]
    wb = Workbook(); ws = wb.active; ws.title = '运营原样作业'
    for row in rows: ws.append(row)
    path = folder / 'three_questions.xlsx'; wb.save(path)
    legacy = xlwt.Workbook(); legacy_sheet = legacy.add_sheet('合成旧版作业')
    for ri, row in enumerate(rows):
        for ci, value in enumerate(row): legacy_sheet.write(ri, ci, value)
    legacy.save(str(folder / 'three_questions.xls'))
    bad = Workbook(); sheet = bad.active
    for row in rows[:2]: sheet.append(row)
    sheet.append(['', '缺少题目的有答案行', '', '', ''])
    bad.save(folder / 'missing_question.xlsx')
    wav = folder / 'synthetic_mic.wav'
    with wave.open(str(wav), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000)
        samples = []
        for i in range(48000 * 6):
            t = i / 48000
            x = (.18 * math.sin(2 * math.pi * 211 * t) + .09 * math.sin(2 * math.pi * 443 * t)) * (.65 + .35 * math.sin(2 * math.pi * 4.2 * t))
            samples.append(struct.pack('<h', int(32767 * x)))
        w.writeframes(b''.join(samples))
    return path, wav


class Audit:
    def __init__(self, args):
        self.args = args; self.out = Path(args.evidence); self.out.mkdir(parents=True, exist_ok=True)
        self.rows = []; self.errors = []; self.requests = []; self.responses = []; self.contexts = []
        self.next_taps = {}; self.cooldown_waits = []
        self.phase = 'initialization'; self.page_labels = {}; self.request_failures = []; self.media_traces = []
        self.xlsx, self.wav = fixtures(self.out / 'fixtures')
        self.base = args.base_url.rstrip('/')

    def check(self, name, condition, detail=None):
        row = {'name': name, 'pass': bool(condition), 'detail': detail}
        self.rows.append(row); print(json.dumps(row, ensure_ascii=False), flush=True)
        if not condition: raise AssertionError(name + ': ' + str(detail))

    async def context(self, browser, width=390, mock_asr=False):
        ctx = await browser.new_context(viewport={'width': width, 'height': 844}, permissions=['camera', 'microphone'], accept_downloads=True)
        await ctx.add_init_script(MEDIA_OBSERVER)
        if mock_asr:
            await ctx.route('**/paraformer-worker.js', lambda route: route.fulfill(status=200, content_type='text/javascript', body=MOCK_WORKER))
        self.contexts.append(ctx)
        return ctx

    async def page(self, ctx, path=QA):
        p = await ctx.new_page(); p.set_default_timeout(20000)
        self.page_labels[p] = 'page-' + str(len(self.page_labels) + 1)
        p.on('pageerror', lambda e: self.errors.append({'url': p.url, 'page': self.page_labels[p], 'phase': self.phase, 'error': str(e)}))
        p.on('console', lambda msg: self.errors.append({'url': p.url, 'page': self.page_labels[p], 'phase': self.phase, 'console': msg.text, 'location': msg.location}) if msg.type == 'error' and urlparse(msg.location.get('url', '')).path != '/favicon.ico' else None)
        p.on('request', lambda r: self.requests.append({'url': r.url, 'method': r.method, 'type': r.resource_type}))
        p.on('requestfailed', lambda r: self.request_failures.append({'url': r.url, 'type': r.resource_type, 'failure': r.failure, 'page': self.page_labels[p], 'phase': self.phase, 'wall': time.time()}))
        p.on('response', lambda r: self.responses.append({'url': r.url, 'status': r.status}) if r.status >= 400 and urlparse(r.url).path != '/favicon.ico' else None)
        p.on('dialog', lambda d: d.accept())
        await p.goto(self.base + path, wait_until='networkidle')
        await expect(p.locator('[data-role-pick="anchor"]')).to_be_visible()
        return p

    async def login(self, p, role, name):
        await p.locator(f'[data-role-pick="{role}"]').click()
        await p.locator('#simpleName').fill(name)
        await p.locator('#simpleLogin').click()
        await expect(p.locator('#switchIdentity')).to_be_visible()

    async def db(self, p, store='prefs', key=None):
        return await p.evaluate("""async ({name,store,key}) => {
          const names=await indexedDB.databases(); if(!names.some(x=>x.name===name)) return null;
          return await new Promise((resolve,reject)=>{ const r=indexedDB.open(name);
            r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result;
              const t=d.transaction(store,'readonly');const q=key===null?t.objectStore(store).getAll():t.objectStore(store).get(key);
              q.onsuccess=()=>resolve(q.result??null);q.onerror=()=>reject(q.error);t.oncomplete=()=>d.close();
            };});
        }""", {'name': DB, 'store': store, 'key': key})

    async def pref(self, p, name):
        row = await self.db(p, key=name)
        return row.get('value', []) if row else []

    async def screenshot(self, p, name):
        await p.screenshot(path=str(self.out / (name + '.png')), full_page=True)

    async def no_overflow(self, p, name):
        dims = await p.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})')
        self.check(name, dims['scroll'] <= dims['width'] + 1, dims)

    async def open_import(self, p, package):
        fold = p.locator('#assignmentFold')
        if await fold.get_attribute('open') is None: await fold.locator('summary').click()
        await p.locator('#assignmentPackageImport').set_input_files(str(package))

    async def join(self, p, text=True):
        await p.locator('[data-join-assignment]').first.click()
        await expect(p.locator('#startScene')).to_be_visible()
        if text:
            if await p.locator('#prepQuickText').is_visible(): await p.locator('#prepQuickText').click()
        else: await p.locator('#prepQuickRecheck').click()
        await expect(p.locator('#startScene')).to_be_enabled(timeout=30000)
        await p.locator('#startScene').click()
        await expect(p.locator('#liveQText')).to_have_text(QUESTIONS[0])

    async def answer(self, p, i, media=False):
        self.phase = ('media' if media else 'text') + '-answer-' + str(i + 1)
        await expect(p.locator('#liveQText')).to_have_text(QUESTIONS[i])
        if media:
            # Real browser capture proceeds on a synthetic --use-file-for-fake-audio-capture device.
            await p.wait_for_timeout(1800)
            await p.locator('#focusReview').click()
            await p.locator('#liveToolText').click()
        else: await p.locator('#focusMic').click()
        await p.locator('#liveTextAnswer').fill(ANSWERS[i])
        await p.locator('#liveTextSave').click()
        if i < 2:
            await self.next_question(p)
            await expect(p.locator('#liveQText')).to_have_text(QUESTIONS[i + 1])

    async def next_question(self, p):
        # Official pages3 nextByTap deliberately ignores taps less than 700 ms
        # apart. Programmatic fill is faster than human typing, so respect that
        # existing guard using test-owned monotonic timestamps. Do not change
        # the product cooldown, bypass the handler, or weaken question assertions.
        button = p.locator('#focusNext')
        await expect(button).to_be_visible()
        await expect(button).to_be_enabled()
        now = time.monotonic(); prior = self.next_taps.get(p)
        remaining = max(0, .710 - (now - prior)) if prior is not None else 0
        if remaining:
            self.cooldown_waits.append({'guard_ms': 700, 'wait_ms': round(remaining * 1000, 2)})
            await asyncio.sleep(remaining)
        await button.click()
        self.next_taps[p] = time.monotonic()

    async def finish(self, p):
        self.phase = self.page_labels[p] + '-finish'
        await p.locator('#focusClose').click()
        # Chromium uses the app's accessible HTML dialog, not window.confirm.
        # Wait for its rendered button rather than probing visibility once.
        confirm = p.get_by_role('button', name='结束并进入复盘', exact=True)
        await expect(confirm).to_be_visible()
        await confirm.click()
        await expect(p.locator('#submitSession')).to_be_visible(timeout=30000)

    async def download(self, p, trigger, filename):
        async with p.expect_download(timeout=30000) as info: await trigger()
        d = await info.value; target = self.out / filename
        await d.save_as(str(target))
        return target, json.loads(target.read_text())

    async def import_receipt(self, operator, path):
        await operator.locator('[data-ops-tab="tracking"]').click()
        await operator.locator('#assignmentReceiptImport').set_input_files(str(path))

    async def collect_media_trace(self):
        for p, label in self.page_labels.items():
            if not p.is_closed():
                try:
                    self.media_traces.append({'page': label, 'url': p.url, 'events': await p.evaluate('window.__qaMediaTrace||[]')})
                except Exception as error:
                    self.media_traces.append({'page': label, 'trace_error': str(error)})

    async def play_media(self, element, label, end=False):
        # Load and play the application's actual retained object URL. No new
        # success source or media element is substituted for the product player.
        result = await element.evaluate("""async (e,shouldEnd) => {
          const state=()=>({src:e.currentSrc||e.src,duration:Number.isFinite(e.duration)?e.duration:null,currentTime:e.currentTime,ended:e.ended,readyState:e.readyState,error:e.error?{code:e.error.code,message:e.error.message}:null});
          await e.play();
          if(shouldEnd)await new Promise((resolve,reject)=>{
            const cleanup=()=>{clearTimeout(timer);e.removeEventListener('ended',ok);e.removeEventListener('error',bad)};
            const ok=()=>{cleanup();resolve()},bad=()=>{cleanup();reject(new Error('Actual player error '+JSON.stringify(state())))};
            const timer=setTimeout(()=>{cleanup();reject(new Error('Actual player did not finish '+JSON.stringify(state())))},15000);
            e.addEventListener('ended',ok,{once:true});e.addEventListener('error',bad,{once:true});if(e.ended)ok();
          });
          else await new Promise((resolve,reject)=>{const start=e.currentTime;let count=0;const timer=setInterval(()=>{
            if(e.error){clearInterval(timer);reject(new Error('Actual video failed '+JSON.stringify(state())))}
            else if(e.currentTime>start+.15){clearInterval(timer);resolve()}
            else if(++count>100){clearInterval(timer);reject(new Error('Actual video clock did not advance '+JSON.stringify(state())))}
          },50)});
          const value=state();e.pause();return value;
        }""", end)
        self.check(label, result['error'] is None and result['readyState'] >= 2 and result['currentTime'] > 0 and (not end or result['ended']), result)

    async def run(self, browser):
        # No layout rewrite: real static resources, role-gateway geometry at three widths.
        for width in (320, 390, 430):
            ctx = await self.context(browser, width); old = await self.page(ctx, OFFICIAL); new = await self.page(ctx)
            for resource in ('index.html', 'style.css', 'training-boards.json', 'legacy-65.json'):
                a = await ctx.request.get(self.base + OFFICIAL + resource); b = await ctx.request.get(self.base + QA + resource)
                self.check(f'{width}: unchanged {resource}', await a.body() == await b.body())
            geometry = """() => [...document.querySelectorAll('.role-grid,.role-card')].map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})"""
            self.check(f'{width}: original gateway geometry', await old.evaluate(geometry) == await new.evaluate(geometry))
            await self.no_overflow(new, f'{width}: gateway no overflow')
            await self.screenshot(new, f'gateway-{width}')
            await self.login(new, 'operator', OPERATOR)
            await self.no_overflow(new, f'{width}: operator no overflow')
            await self.screenshot(new, f'operator-{width}')
            await ctx.close()

        operator_ctx = await self.context(browser); operator = await self.page(operator_ctx)
        await self.login(operator, 'operator', OPERATOR)
        await operator.locator('#assignmentTitle').fill('合成三题专属作业')
        await operator.locator('#assignmentBoard').select_option('01')
        await operator.locator('#assignmentPlatform').select_option('京东')
        await operator.locator('#assignmentRecipients').fill(ANCHOR + '，' + MEDIA_ANCHOR)
        await operator.locator('#publishAssignment').click()
        self.check('publishing without Excel blocked', not await self.pref(operator, 'assignments'))
        await operator.locator('#assignmentExcelFile').set_input_files(str(self.out / 'fixtures/missing_question.xlsx'))
        await operator.locator('#assignmentExcelPreviewBtn').click()
        await expect(operator.locator('#assignmentExcelPreview')).to_contain_text('失败')
        self.check('incomplete Excel not silently truncated', not await self.pref(operator, 'assignments'))
        await operator.locator('#assignmentExcelFile').set_input_files(str(self.out / 'fixtures/three_questions.xls'))
        await operator.locator('#assignmentExcelPreviewBtn').click()
        await expect(operator.locator('#assignmentExcelPreview')).to_contain_text('3 道')
        self.check('actual legacy XLS parses three rows without publishing', not await self.pref(operator, 'assignments'))
        await operator.locator('#assignmentExcelFile').set_input_files(str(self.xlsx))
        await operator.locator('#assignmentExcelPreviewBtn').click()
        await expect(operator.locator('#assignmentExcelPreview')).to_contain_text('3 道')
        self.check('preview does not publish', not await self.pref(operator, 'assignments'))
        await operator.locator('#assignmentTitle').fill('合成三题专属作业修订')
        await operator.locator('#publishAssignment').click()
        self.check('changing preview fields invalidates publication', not await self.pref(operator, 'assignments'))
        await operator.locator('#assignmentExcelPreviewBtn').click()
        await expect(operator.locator('#assignmentExcelPreview')).to_contain_text('3 道')
        await operator.locator('#publishAssignment').click()
        await expect(operator.locator('[data-export-assignment]')).to_be_visible()
        items = await self.db(operator, 'items')
        self.check('assignment Excel leaves public question store empty', items == [], items)
        pkg_path, pkg = await self.download(operator, lambda: operator.locator('[data-export-assignment]').click(), 'assignment.json')
        assignment = pkg['assignment']; self.check('frozen Excel order and SKU', [q['question'] for q in assignment['questions']] == QUESTIONS and assignment['questions'][0]['sku'] == '000001', assignment)
        await self.screenshot(operator, 'published-assignment')

        wrong_ctx = await self.context(browser); wrong = await self.page(wrong_ctx)
        await self.login(wrong, 'anchor', '未被分配的合成主播'); await self.open_import(wrong, pkg_path)
        await expect(wrong.locator('#toast')).to_contain_text('不匹配')
        self.check('unassigned anchor import rejected', not await self.pref(wrong, 'assignments'))
        await wrong_ctx.close()

        # Incomplete and wrong-version submission are negative tests; no row injection.
        anchor_ctx = await self.context(browser); anchor = await self.page(anchor_ctx)
        await self.login(anchor, 'anchor', ANCHOR); await self.open_import(anchor, pkg_path)
        await expect(anchor.locator('[data-join-assignment]').first).to_be_visible()
        self.check('assigned pending task visible before joining', assignment['id'] in await anchor.locator('#view').inner_html())
        await self.join(anchor); await self.finish(anchor)
        await anchor.locator('#submitSession').click()
        await expect(anchor.locator('#toast')).to_contain_text('全部题目')
        self.check('missing two questions cannot submit', not await self.pref(anchor, 'submissions'))
        await anchor.locator('#reviewRetry').click()
        await expect(anchor.locator('#tclRestartYes')).to_be_visible()
        await anchor.locator('#tclRestartYes').click()
        await expect(anchor.locator('#startScene')).to_be_visible()
        if await anchor.locator('#prepQuickText').is_visible(): await anchor.locator('#prepQuickText').click()
        await expect(anchor.locator('#startScene')).to_be_enabled()
        await anchor.locator('#startScene').click()
        for i in range(3): await self.answer(anchor, i)
        await self.next_question(anchor)
        await expect(anchor.locator('#liveQText')).to_have_text(QUESTIONS[2])
        await self.finish(anchor)
        await anchor.locator('#reviewDetails').click()
        editors = anchor.locator('textarea[aria-label="编辑本题回答"]')
        self.check('review includes all three exact questions', await editors.count() == 3)
        edited = ANSWERS[0] + ' 已人工校正。'
        await editors.nth(0).fill(edited); await anchor.get_by_role('button', name='保存本题修改', exact=True).nth(0).click()
        await anchor.locator('#reviewDetailsBack').click()
        receipt_path, receipt = await self.download(anchor, lambda: anchor.locator('#submitSession').click(), 'receipt-text.json')
        self.check('submission preserves exact question order', [t['question'] for t in receipt['turns']] == QUESTIONS)
        self.check('manual edit persists into explicit submission', receipt['turns'][0]['answer'] == edited)
        self.check('local submit does not auto-send operator', not await self.pref(operator, 'submissions'))
        await anchor.reload(wait_until='networkidle')
        if await anchor.locator('[data-role-pick="anchor"]').count(): await self.login(anchor, 'anchor', ANCHOR)
        await expect(anchor.locator('#restoreLocalSession')).to_be_visible()
        await anchor.locator('#restoreLocalSession').click()
        await expect(anchor.locator('#exportAssignmentReceipt')).to_be_visible()
        _, again = await self.download(anchor, lambda: anchor.locator('#exportAssignmentReceipt').click(), 'receipt-after-refresh.json')
        self.check('refresh restores immutable receipt and answers', again == receipt)

        broken = dict(receipt); broken['snapshotSha256'] = '0' * 64
        invalid = self.out / 'receipt-wrong-version.json'; invalid.write_text(json.dumps(broken, ensure_ascii=False))
        await self.import_receipt(operator, invalid); await expect(operator.locator('#toast')).to_contain_text('版本不一致')
        self.check('wrong-version receipt rejected', not await self.pref(operator, 'submissions'))
        await self.import_receipt(operator, receipt_path)
        await expect(operator.locator('#ops-tracking')).to_contain_text('回执待核实')
        self.check('manual receipt marked unauthenticated', (await self.pref(operator, 'submissions'))[0]['manuallyImported'] is True)
        # Clear the file input using normal UI then import exact same file again.
        await operator.locator('#assignmentReceiptImport').set_input_files([])
        await self.import_receipt(operator, receipt_path)
        await expect(operator.locator('#toast')).to_contain_text('回执已导入')
        self.check('duplicate receipt is idempotent', len(await self.pref(operator, 'submissions')) == 1)
        conflict = json.loads(json.dumps(receipt)); conflict['turns'][0]['answer'] += '冲突'
        invalid.write_text(json.dumps(conflict, ensure_ascii=False)); await self.import_receipt(operator, invalid)
        await expect(operator.locator('#toast')).to_contain_text('冲突')
        self.check('conflicting same-session receipt cannot overwrite', (await self.pref(operator, 'submissions'))[0]['turns'][0]['answer'] == edited)
        await self.screenshot(operator, 'received-pending-verification')

        # Real native MediaRecorder with synthetic devices. Only model inference is stubbed.
        media_ctx = await self.context(browser, mock_asr=True); media = await self.page(media_ctx)
        self.page_labels[media] = 'native-media-anchor'; self.phase = 'native-media-start'
        await self.login(media, 'anchor', MEDIA_ANCHOR); await self.open_import(media, pkg_path)
        await expect(media.locator('[data-join-assignment]').first).to_be_visible(); await self.join(media, text=False)
        for i in range(3): await self.answer(media, i, media=True)
        await self.finish(media); await media.wait_for_timeout(1500)
        await media.locator('#reviewDetails').click()
        await expect(media.locator('#questionSummary audio')).to_have_count(3)
        blobs = await media.locator('#questionSummary audio').evaluate_all("async es => Promise.all(es.map(async e=>{const b=await (await fetch(e.src)).blob();return {bytes:b.size,type:b.type}}))")
        self.check('three distinct original audio blobs recorded', len(blobs) == 3 and all(x['bytes'] > 200 for x in blobs), blobs)
        self.phase = 'actual-audio-playback'
        for i in range(3): await self.play_media(media.locator('#questionSummary audio').nth(i), f'actual recorded answer {i + 1} plays to completion', end=True)
        await media.locator('#reviewDetailsBack').click()
        await media.locator('#reviewReplay').click(); self.phase = 'actual-video-playback'
        await expect(media.locator('#sessionArchiveHolder video')).to_be_visible()
        await self.play_media(media.locator('#sessionArchiveHolder video'), 'actual recorded session video plays')
        await media.locator('#reviewReplayBack').click(); self.phase = 'native-media-submit'
        media_receipt, media_data = await self.download(media, lambda: media.locator('#submitSession').click(), 'receipt-media.json')
        self.check('ASR cannot overwrite manual answers or reorder questions', [t['answer'] for t in media_data['turns']] == ANSWERS and [t['question'] for t in media_data['turns']] == QUESTIONS)
        records = await self.db(media, 'prefs')
        stored = [r for r in records if r.get('id', '').startswith('submission-media:')]
        self.check('submitted media stored in IndexedDB', len(stored) == 1)
        await self.import_receipt(operator, media_receipt)
        await expect(operator.locator('#ops-tracking')).to_contain_text(MEDIA_ANCHOR + ' · 回执待核实')

        # Same browser, same origin, separate DB namespaces: official has no QA assignment.
        original = await self.page(operator_ctx, OFFICIAL); await self.login(original, 'operator', OPERATOR)
        await original.locator('[data-ops-tab="tracking"]').click()
        self.check('official site cannot see QA assignment', assignment['title'] not in await original.locator('#ops-tracking').inner_text())
        dbnames = await original.evaluate('async()=> (await indexedDB.databases()).map(x=>x.name)')
        self.check('official and QA storage are separate', DB in dbnames and 'tcl-specialty-r24-paraformer-v1' in dbnames, dbnames)
        host = urlparse(self.base).netloc
        external = [r for r in self.requests if r['url'].startswith(('http://', 'https://')) and urlparse(r['url']).netloc != host]
        mutations = [r for r in self.requests if r['method'] not in ('GET', 'HEAD', 'OPTIONS')]
        self.check('no external data requests', not external, external)
        self.check('no data-upload requests', not mutations, mutations)
        self.check('no browser page or console errors', not self.errors, self.errors)
        self.check('no failing HTTP resources', not self.responses, self.responses)
        self.check('no missing blob media resources', not [r for r in self.request_failures if r['type'] == 'media' and r['url'].startswith('blob:') and 'ERR_FILE_NOT_FOUND' in str(r['failure'])], self.request_failures)

    async def main(self):
        failure = None
        try:
            async with async_playwright() as pw:
                browser = await pw.chromium.launch(headless=True, args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-audio-capture=' + str(self.wav.resolve()), '--autoplay-policy=no-user-gesture-required'])
                try: await self.run(browser)
                except Exception:
                    failure = traceback.format_exc()
                    for ci, ctx in enumerate(self.contexts):
                        for pi, p in enumerate(ctx.pages):
                            if not p.is_closed():
                                try:
                                    await self.screenshot(p, f'failure-{ci}-{pi}')
                                    (self.out / f'failure-{ci}-{pi}.txt').write_text(await p.locator('body').inner_text())
                                except Exception: pass
                await self.collect_media_trace()
                await browser.close()
        except Exception: failure = traceback.format_exc()
        result = {'passed': sum(x['pass'] for x in self.rows), 'checks': self.rows, 'failure': failure, 'page_errors': self.errors, 'failed_http': self.responses, 'requests': self.requests, 'request_failures': self.request_failures, 'media_traces': self.media_traces, 'explicit_next_button_cooldown_waits': self.cooldown_waits, 'scope': 'real Chromium UI, XLSX parser, IndexedDB and MediaRecorder; synthetic identities/devices; ASR Worker explicitly mocked only for media flow; no physical phone, human speech accuracy or automatic cloud delivery claims'}
        (self.out / 'browser-assignment-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
        print(json.dumps({'passed': result['passed'], 'failure': failure}, ensure_ascii=False), flush=True)
        if failure: raise SystemExit(1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--base-url', required=True); parser.add_argument('--evidence', required=True)
    asyncio.run(Audit(parser.parse_args()).main())
