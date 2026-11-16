#!/usr/bin/env python3
"""Legacy bank compatibility in Chromium. Artificial old published IndexedDB row.

Only legacy fixture creation writes directly to IndexedDB. Model editing, approval
and training use visible UI. No real operating material, mobile device or model.
"""
import functools
import hashlib
import json
import os
import pathlib
import threading
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

REPO = pathlib.Path(__file__).resolve().parents[3]
SITE = REPO / 'experiments/r24/tcl-v352-asr-r24-qa'
OUT = pathlib.Path(os.environ.get('OUT', str(REPO / 'evidence/r24-question-bank/legacy')))
OUT.mkdir(parents=True, exist_ok=True)
FILES = ['app.js', 'lib/parser.js', 'lib/qa-import.js']
report = {'mode': 'Chromium real UI; one synthetic legacy published IndexedDB row',
          'checks': {}, 'errors': [], 'no_claims': ['Gemini', 'real operating table', 'physical phone', 'speech model']}


def hashes():
    return {name: hashlib.sha256((SITE / name).read_bytes()).hexdigest() for name in FILES}


def check(name, condition, details=None):
    report['checks'][name] = {'pass': bool(condition), 'details': details}
    assert condition, (name, details)


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(SITE.parent)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/{SITE.name}/'
report['source_hashes'] = hashes()
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        report['browser'] = browser.version
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')

        def login(page, role, name):
            page.locator(f'[data-role-pick="{role}"]').click()
            page.locator('#simpleName').fill(name)
            page.locator('#simpleLogin').click()
            page.locator('#switchIdentity').wait_for()

        def new_page(role, name):
            page = ctx.new_page()
            page.set_default_timeout(10000)
            page.on('pageerror', lambda error: report['errors'].append(str(error)))
            page.on('dialog', lambda dialog: dialog.accept())
            page.goto(url)
            login(page, role, name)
            return page

        def read_items(page):
            return page.evaluate('''async()=>{const db=await new Promise((resolve,reject)=>{
              const q=indexedDB.open('tcl-specialty-v352-asr-r24-qa');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
              try{return await new Promise((resolve,reject)=>{const q=db.transaction('items').objectStore('items').getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})}finally{db.close()}}''')

        def start(page):
            page.locator('#freePractice').click()
            page.locator('#prepQuickText').click()
            page.locator('#startScene').click()
            page.wait_for_function("document.body.classList.contains('room-live')")

        def end(page):
            page.locator('#focusClose').click()
            page.locator('#tclEndYes').click()
            page.locator('#reviewDetails').wait_for()

        operator = new_page('operator', '人工旧数据审核运营')
        # This is intentionally the shape of an old already-published row, not a
        # bypass of the current import/review UI represented as successful import.
        legacy = {'id': 'synthetic-legacy-published', 'boardId': '01', 'category': 'TCL 电视',
                  'scope': 'board', 'platform': '京东', 'question': '这台 SKU-X7 电视支持什么接口？',
                  'answer': '人工构造旧版答案：核对原资料，不代表真实商品参数。',
                  'sku': 'SKU-X7', 'source': '人工构造旧版资料', 'sourceLocators': [],
                  'keyPoints': ['核对原资料'], 'status': 'published', 'kind': 'uploaded',
                  'reviewStatus': 'reviewed-demo', 'createdAt': '2020-01-01T00:00:00.000Z'}
        report['synthetic_fixture'] = legacy
        operator.evaluate('''async(row)=>{const db=await new Promise((resolve,reject)=>{
          const q=indexedDB.open('tcl-specialty-v352-asr-r24-qa');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
          await new Promise((resolve,reject)=>{const tx=db.transaction('items','readwrite');tx.objectStore('items').add(row);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});db.close()}''', legacy)
        anchor = new_page('anchor', '人工旧题暂停检查')
        check('legacy_ambiguous_published_and_sku_token_do_not_override_seed',
              '3 道教学示例' in anchor.locator('.r2-start-meta').inner_text())
        start(anchor)
        legacy_prompt = anchor.locator('#liveQText').inner_text()
        live_index = anchor.locator('#liveQIndex').inner_text()
        check('legacy_ambiguous_published_not_drawn',
              'SKU-X7' not in legacy_prompt and '示例' in live_index,
              {'prompt': legacy_prompt, 'index': live_index})
        end(anchor)
        operator.reload()
        login(operator, 'operator', '人工旧数据审核运营')
        operator.locator('#menuBtn').click()
        operator.locator('#navExtras > summary').click()
        operator.locator('[data-page="review"]').click()
        model = operator.locator('[data-model-for="synthetic-legacy-published"]')
        model.wait_for()
        check('legacy_published_is_offered_for_review', model.input_value() == '')
        model.fill('QA-LEGACY42')
        operator.locator('[data-save-model="synthetic-legacy-published"]').click()
        operator.wait_for_function("document.querySelector('[data-model-for=synthetic-legacy-published]')?.value==='QA-LEGACY42' && !document.querySelector('[data-approve=synthetic-legacy-published]')?.disabled")
        saved = read_items(operator)[0]
        check('saving_model_returns_legacy_to_draft_and_preserves_source_text',
              saved['status'] == 'draft' and saved['model'] == 'QA-LEGACY42'
              and saved['question'] == legacy['question'] and saved['answer'] == legacy['answer'], saved)
        operator.locator('[data-approve="synthetic-legacy-published"]').click()
        operator.wait_for_function("!document.querySelector('[data-approve=synthetic-legacy-published]')")
        check('manual_approval_required_after_repair', read_items(operator)[0]['status'] == 'published')
        fresh = new_page('anchor', '人工旧题重新开练')
        check('repaired_record_replaces_seed_only_after_manual_approval',
              '1 道已审核资料题' in fresh.locator('.r2-start-meta').inner_text())
        start(fresh)
        fresh.locator('#focusReview').click()
        fresh.locator('#liveToolReference').click()
        ref = fresh.locator('#liveReferenceBox').text_content()
        check('repaired_legacy_question_model_and_original_reference_used',
              'QA-LEGACY42' in fresh.locator('#liveQText').inner_text() and
              legacy['answer'] in ref and legacy['source'] in ref)
        fresh.screenshot(path=str(OUT / 'legacy-repaired-reference.png'), full_page=True)
        check('no_application_page_errors', not report['errors'], report['errors'])
        ctx.close()
        browser.close()
    report['status'] = 'PASS'
except Exception as error:
    report.update(status='FAIL', exception=str(error), traceback=traceback.format_exc())
finally:
    report['source_hashes_after'] = hashes()
    report['source_unchanged'] = report['source_hashes'] == report['source_hashes_after']
    if not report['source_unchanged']:
        report['status'] = 'FAIL'
    server.shutdown()
    (OUT / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({key: report.get(key) for key in ['status', 'checks', 'source_hashes', 'source_unchanged', 'exception']}, ensure_ascii=False, indent=2))
if report['status'] != 'PASS':
    raise SystemExit(1)
