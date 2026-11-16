#!/usr/bin/env python3
"""Question bank acceptance: real Chromium UI + native IndexedDB, synthetic data.

R24_QUESTION_URL optionally selects the deployed app; OUT selects evidence output.
No private operating table, Gemini, audio model or physical device is involved.
All imports/approvals/training/submission use UI. IndexedDB is read for assertions;
one explicitly recorded fixture mutation models a later edit to published material.
"""
import csv
import functools
import hashlib
import io
import json
import os
import pathlib
import re
import threading
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from docx import Document
from openpyxl import Workbook
from playwright.sync_api import sync_playwright

REPO = pathlib.Path(__file__).resolve().parents[3]
SITE = REPO / 'experiments/r24/tcl-v352-asr-r24-qa'
OUT = pathlib.Path(os.environ.get('OUT', str(REPO / 'evidence/r24-question-bank/browser')))
OUT.mkdir(parents=True, exist_ok=True)
ASSETS = ['app.js', 'lib/parser.js', 'lib/qa-import.js']
EXPECTED_APP_SHA = os.environ.get('R24_EXPECT_APP_SHA', '').strip()
DB = 'tcl-specialty-v352-asr-r24-qa'
CATEGORY = 'TCL 电视'
QUESTION = '这款电视的接口如何核对？'
FIELDS = ['model', 'sku', 'category', 'platform', 'sourceRef']
SNAP_FIELDS = ['questionId', 'question', 'prompt', 'referenceAnswer', 'model', 'sku',
               'source', 'sourceRef', 'sourceLocators', 'kind']
HEADERS = ['型号', 'SKU', '品类', '平台', '来源', '问题', '优秀回答']
report = {'fixture_kind': 'artificial fixtures; not TCL approved operating material',
          'method': 'real desktop Chromium UI and native IndexedDB; text-only training',
          'checks': {}, 'fixtures': [], 'errors': [], 'limitations':
          ['No Gemini review', 'No physical mobile-device or speech-model test',
           'Synthetic records do not validate actual product facts or private operating documents']}
report['script_sha256'] = hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
EXPECTED_CHECKS = [
    item for ext in ('json', 'csv', 'docx', 'xlsx') for item in
    (f'{ext}_metadata_row_platform_overrides_ui_and_maps_board',
     f'{ext}_import_approve_training_reference_review_preserve_metadata')
] + [
    'download_template_explicit_example_and_metadata',
    'same_question_models_skus_platforms_not_merged',
    'same_identity_merges_variants_and_preserves_both_locations',
    'drafts_do_not_replace_seed_examples', 'seed_question_matches_original_training_point',
    'review_can_supply_ambiguous_missing_model', 'generic_and_question_embedded_model_allow_blank_model',
    'missing_answer_stays_unpublished', 'home_uses_same_reviewed_pool_count',
    'frozen_pool_full_round_has_no_repeat_or_seed', 'frozen_pool_does_not_grow_on_next_round',
    'review_keeps_original_model_reference_source', 'restored_session_reference_snapshot_does_not_drift',
    'restored_review_displays_snapshot_not_current_library',
    'submission_preserves_same_question_metadata_snapshot', 'durable_records_preserve_same_reference_snapshot',
    '抖音_platform_isolation_and_generic_question_text', '天猫_platform_isolation_and_generic_question_text',
    'missing_answer_other_category_uses_labelled_seed', 'new_session_reads_latest_reviewed_pool',
    'live_sku_context_exact_or_hidden_for_empty',
    'no_application_page_errors', 'source_unchanged_during_acceptance',
]
if EXPECTED_APP_SHA:
    EXPECTED_CHECKS.append('browser_app_response_matches_expected_release')
    report['expected_app_sha256'] = EXPECTED_APP_SHA
    report['browser_app_responses'] = []
server = None


def check(name, condition, detail=None):
    report['checks'][name] = {'pass': bool(condition), 'detail': detail}
    assert condition, (name, detail)


def csv_bytes(headers, rows):
    out = io.StringIO(newline='')
    writer = csv.writer(out)
    writer.writerow(headers)
    writer.writerows(rows)
    return out.getvalue().encode('utf-8-sig')


def document_bytes(ext, headers, rows):
    if ext == 'csv':
        return csv_bytes(headers, rows)
    out = io.BytesIO()
    if ext == 'docx':
        doc = Document()
        doc.add_paragraph('人工构造验收资料，不是真实商品标准答案。')
        table = doc.add_table(rows=1, cols=len(headers))
        for cell, value in zip(table.rows[0].cells, headers):
            cell.text = value
        for row in rows:
            for cell, value in zip(table.add_row().cells, row):
                cell.text = str(value)
        doc.save(out)
    else:
        wb = Workbook()
        wb.active.title = '人工构造资料'
        wb.active.append(headers)
        for row in rows:
            wb.active.append(row)
        wb.save(out)
    return out.getvalue()


def fixture(name, data):
    path = OUT / 'fixtures' / name
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(data)
    report['fixtures'].append({'file': name, 'sha256': hashlib.sha256(data).hexdigest(),
                               'kind': 'artificial test data'})
    return path


def read_store(page, store):
    return page.evaluate('''async ({name,store}) => {
      const db=await new Promise((resolve,reject)=>{const q=indexedDB.open(name);
        q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
      try{return await new Promise((resolve,reject)=>{const q=db.transaction(store).objectStore(store).getAll();
        q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})}finally{db.close()}
    }''', {'name': DB, 'store': store})


def checkpoint(page, name):
    return next(row for row in read_store(page, 'prefs')
                if row['id'].startswith('draft-session:') and row.get('owner') == name)


def wait_saved(page):
    page.wait_for_function("document.querySelector('#localSessionSaveStatus')?.dataset.status==='saved'", timeout=15000)


def login(page, role, name):
    page.locator(f'[data-role-pick="{role}"]').click()
    page.locator('#simpleName').fill(name)
    page.locator('#simpleLogin').click()
    page.locator('#switchIdentity').wait_for()


def nav(page, target):
    if page.locator('body').get_attribute('data-page') == target:
        return
    button = page.locator(f'button[data-page="{target}"]')
    if page.locator('#menuBtn').is_visible() and not page.locator('#sidebar').evaluate("el=>el.classList.contains('open')"):
        page.locator('#menuBtn').click()
    if target in ('import', 'review', 'library', 'settings'):
        if not page.locator('#navExtras').evaluate('el=>el.open'):
            page.locator('#navExtras > summary').click()
    button.click()
    page.wait_for_function('(target)=>document.body.dataset.page===target', arg=target)


def import_file(page, path, board='01', platform='京东'):
    nav(page, 'import')
    page.locator('#importBoard').select_option(board)
    page.locator('#importPlatform').select_option(platform)
    page.locator('#fileInput').set_input_files(str(path))
    page.locator('#parseFile').click()
    page.wait_for_function("!document.querySelector('#parseFile').disabled")
    summary = page.locator('#importSummary').inner_text()
    assert not page.locator('#saveImport').is_disabled(), summary
    page.locator('#saveImport').click()
    page.wait_for_function("document.body.dataset.page==='review'")
    return read_store(page, 'items')


def approve(page, predicate=lambda row: True):
    for row in read_store(page, 'items'):
        if row['status'] == 'draft' and row.get('answer') and predicate(row):
            page.locator(f'[data-approve="{row["id"]}"]').click()
            page.wait_for_function('(id)=>!document.querySelector(`[data-approve="${id}"]`)', arg=row['id'])


def open_training(page, platform, expected_count, category=CATEGORY, board=None):
    page.locator('#r2ChangeBoard').click()
    page.locator(f'[data-cat="{category}"]').click()
    board = board or ('02' if platform == '抖音' else '01')
    choice = page.locator(f'[data-open-board="{board}"][data-platform="{platform}"]')
    assert re.search(rf'\b{expected_count}\s*(?:个训练点|道)', choice.inner_text()), choice.inner_text()
    choice.click()
    if page.locator('#tclRestartYes').count():
        page.locator('#tclRestartYes').click()
    count_text = page.locator('#questionCount').text_content()
    assert re.search(rf'^{expected_count}(?:\s|$)', count_text), count_text
    page.locator('#prepQuickText').click()
    page.locator('#startScene').click()
    page.wait_for_function("document.body.classList.contains('room-live')")


def capture_turn(page, name, expected_count):
    prompt = page.locator('#liveQText').inner_text()
    assert re.search(rf'(?:/{expected_count}\b|本场\s*{expected_count}\s*道)', page.locator('#questionStage').text_content())
    page.locator('#focusReview').click()
    page.locator('#liveToolReference').click()
    reference = page.locator('#liveReferenceBox').text_content()
    page.locator('#liveMoreClose').click()
    page.locator('#focusReview').click()
    page.locator('#liveToolText').click()
    page.locator('#liveTextAnswer').fill('人工构造主播回答：已核对本条题目与参考资料。')
    page.locator('#liveTextSave').click()
    # Saving text closes its sheet; close the tools if this version leaves them open.
    if page.locator('#liveMoreClose').is_visible():
        page.locator('#liveMoreClose').click()
    wait_saved(page)
    turn = checkpoint(page, name)['snapshot']['turns'][-1]
    assert turn['prompt'] == prompt
    context = page.locator('#liveQContext')
    sku = turn.get('sku', '')
    actual = {'turnId': turn['id'], 'sku': sku, 'text': context.text_content(), 'visible': context.is_visible()}
    if sku:
        assert actual['visible'] and actual['text'] == f'商品 SKU（上下文）：{sku}', actual
    else:
        assert not actual['visible'] and actual['text'] == '', actual
    report.setdefault('sku_context_observations', []).append(actual)
    return turn, reference


def finish(page):
    page.locator('#focusClose').click()
    page.locator('#tclEndYes').click()
    page.locator('#reviewDetails').wait_for()
    wait_saved(page)


def advance(page):
    # Respect the app's deliberate 700 ms duplicate-tap protection and require
    # a new turn index, including when two SKUs share the same displayed question.
    page.wait_for_timeout(750)
    previous = page.locator('#liveQIndex').text_content()
    page.locator('#focusNext').click()
    page.wait_for_function('(previous)=>document.querySelector("#liveQIndex").textContent!==previous', arg=previous)


def expand_references(page):
    for summary in page.locator('#questionSummary details > summary').all():
        if summary.inner_text() == '查看本题参考与来源':
            if not summary.locator('..').evaluate('el=>el.open'):
                summary.click()


def assert_material_turn(turn, reference, items):
    source = next(row for row in items if row['id'] == turn.get('questionId'))
    assert turn['question'] == source['question'], (turn, source)
    assert turn['referenceAnswer'] == source['answer'], (turn, source)
    assert source['answer'] in reference, (turn, reference)
    for field in FIELDS:
        assert turn.get(field, '') == source.get(field, ''), (field, turn, source)
    assert turn['sourceLocators'] == source['sourceLocators']
    if source.get('model'):
        assert source['model'] in turn['prompt'], turn
    else:
        assert turn['prompt'] == source['question'], turn
    assert source.get('sourceRef', '') in reference, (reference, source)
    assert turn['kind'] != 'seed'
    return source


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


try:
    url = os.environ.get('R24_QUESTION_URL', '').strip()
    if not url:
        server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(SITE.parent)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f'http://127.0.0.1:{server.server_port}/{SITE.name}/'
    if not url.endswith('/'):
        url += '/'
    report['url'] = url
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        report['browser'] = browser.version

        def remote_hashes():
            result = {}
            for asset in ASSETS:
                # urllib follows the execution environment's existing HTTPS
                # proxy. Node's APIRequestContext may select unreachable IPv6.
                request = Request(urljoin(url, asset), headers={'Cache-Control': 'no-cache'})
                with urlopen(request, timeout=20) as response:
                    assert response.status == 200, (asset, response.status)
                    result[asset] = hashlib.sha256(response.read()).hexdigest()
            return result

        browser_request = pw.request.new_context()
        report['source_hashes'] = remote_hashes()
        if EXPECTED_APP_SHA:
            assert report['source_hashes']['app.js'] == EXPECTED_APP_SHA, 'Remote app does not match expected release'

        def observe_app_response(request):
            if request.url.split('?', 1)[0] != urljoin(url, 'app.js'):
                return
            row = {'url': request.url}
            try:
                response = request.response()
                row['status'] = response.status
                row['sha256'] = hashlib.sha256(response.body()).hexdigest()
                row['matches_expected'] = row['status'] == 200 and row['sha256'] == EXPECTED_APP_SHA
            except Exception as error:
                row['error'] = str(error)
                row['matches_expected'] = False
            report['browser_app_responses'].append(row)

        def new_context():
            context = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
            if EXPECTED_APP_SHA:
                context.on('requestfinished', observe_app_response)
            return context

        def new_page(ctx, role, name):
            page = ctx.new_page()
            page.set_default_timeout(10000)
            page.on('pageerror', lambda error: report['errors'].append(str(error)))
            page.on('dialog', lambda dialog: dialog.accept())
            page.goto(url)
            login(page, role, name)
            return page

        # Every supported structured format uses a real file picker, parser, saved
        # draft, approval, training, reference and review. 型号 intentionally first.
        for ext in ['json', 'csv', 'docx', 'xlsx']:
            ctx = new_context()
            operator = new_page(ctx, 'operator', f'人工格式审核-{ext}')
            expected = {'model': f'QA-{ext.upper()}', 'sku': f'SKU-{ext.upper()}',
                        'category': CATEGORY, 'platform': '抖音',
                        'sourceRef': f'人工构造来源-{ext}',
                        'question': f'{ext.upper()}接口如何核对？',
                        'answer': f'人工构造-{ext}-参考答案，仅作软件验收。'}
            if ext == 'json':
                data = json.dumps([{**expected, 'source': expected['sourceRef']}], ensure_ascii=False).encode()
            else:
                data = document_bytes(ext, HEADERS, [[expected[key] for key in FIELDS] +
                                                      [expected['question'], expected['answer']]])
            path = fixture(f'synthetic-metadata.{ext}', data)
            rows = import_file(operator, path)
            assert len(rows) == 1, rows
            row = rows[0]
            for field in FIELDS + ['question', 'answer']:
                assert row.get(field) == expected[field], (ext, field, row)
            assert row['boardId'] == '02' and row['sourceLocators'] and row['status'] == 'draft', row
            check(f'{ext}_metadata_row_platform_overrides_ui_and_maps_board', True)
            approve(operator)
            anchor_name = f'人工格式主播-{ext}'
            anchor = new_page(ctx, 'anchor', anchor_name)
            open_training(anchor, '抖音', 1)
            turn, reference = capture_turn(anchor, anchor_name, 1)
            assert_material_turn(turn, reference, rows)
            finish(anchor)
            anchor.locator('#reviewDetails').click()
            expand_references(anchor)
            text = anchor.locator('#questionSummary').text_content()
            assert expected['model'] in text and expected['answer'] in text and expected['sourceRef'] in text, text
            check(f'{ext}_import_approve_training_reference_review_preserve_metadata', True)
            ctx.close()

        ctx = new_context()
        operator = new_page(ctx, 'operator', '人工题库审核员')
        nav(operator, 'import')
        with operator.expect_download() as download:
            operator.locator('#downloadTemplate').click()
        template = OUT / 'downloaded-template.csv'
        download.value.save_as(str(template))
        template_text = template.read_text(encoding='utf-8-sig')
        check('download_template_explicit_example_and_metadata',
              all(word in template_text for word in ['型号', 'SKU', '品类', '平台', '来源', '示例']),
              template_text)

        op_headers = ['弹幕类型', '型号', 'SKU', '品类', '平台', '来源', '弹幕内容', '案例话术1']
        def operating(model, sku, platform, question, answer, source='人工构造来源-主表', category=CATEGORY):
            return ['人工构造', model, sku, category, platform, source, question, answer]
        main_rows = [
            operating('QA-A', 'SKU-A', '京东', QUESTION, '人工构造答案 A-A 一', '人工构造来源-首行'),
            operating('QA-A', 'SKU-A', '京东', QUESTION, '人工构造答案 A-A 二', '人工构造来源-续行'),
            operating('QA-A', 'SKU-B', '京东', QUESTION, '人工构造答案 A-B'),
            operating('QA-B', 'SKU-A', '京东', QUESTION, '人工构造答案 B-A'),
            operating('QA-A', 'SKU-A', '抖音', QUESTION, '人工构造答案 抖音专用'),
            operating('', '', '天猫', '售后安装如何预约？', '人工构造答案 通用售后'),
            operating('', 'SKU-GENERIC', '天猫', '售后服务的入口在哪里？', '人工构造答案 仅SKU通用问题'),
            operating('QA-GENERIC', 'SKU-SERVICE', '天猫', '安装服务应该如何预约？', '人工构造答案 有型号通用问题'),
            operating('', '', '天猫', '这台 QA42C 的接口如何核对？', '人工构造答案 题内已有型号'),
            operating('', '', '京东', '这台电视的功能如何核对？', '人工构造答案 审核补型号'),
            operating('', '', '京东', '空调安装的要求是什么？', '', category='TCL 空调'),
        ]
        rows = import_file(operator, fixture('synthetic-operating.csv', csv_bytes(op_headers, main_rows)))
        check('same_question_models_skus_platforms_not_merged', len(rows) == 10,
              [{'question': r['question'], 'model': r.get('model'), 'sku': r.get('sku'),
                'platform': r['platform'], 'answer': r['answer']} for r in rows])
        merged = next(r for r in rows if r.get('model') == 'QA-A' and r.get('sku') == 'SKU-A' and r['platform'] == '京东')
        check('same_identity_merges_variants_and_preserves_both_locations',
              all(s in merged['answer'] for s in ['A-A 一', 'A-A 二']) and len(merged['sourceLocators']) == 2
              and all(s in merged['sourceRef'] for s in ['首行', '续行']), merged)

        # Complete but unreviewed imports must not replace teaching examples.
        draft_anchor = new_page(ctx, 'anchor', '人工待审回退主播')
        open_training(draft_anchor, '京东', 3)
        seed, seed_ref = capture_turn(draft_anchor, '人工待审回退主播', 3)
        check('drafts_do_not_replace_seed_examples', seed.get('kind') == 'seed' and
              '教学示例' in (seed.get('source', '') + seed_ref), seed)
        check('seed_question_matches_original_training_point', seed.get('prompt') == seed.get('question'), seed)
        finish(draft_anchor)
        draft_anchor.close()

        ambiguous = next(r for r in rows if r['question'] == '这台电视的功能如何核对？')
        operator.locator(f'[data-model-for="{ambiguous["id"]}"]').fill('QA-REVIEW')
        operator.locator(f'[data-save-model="{ambiguous["id"]}"]').click()
        operator.wait_for_function('''(id)=>document.querySelector(`[data-model-for="${id}"]`)?.value==='QA-REVIEW'
          && !document.querySelector(`[data-approve="${id}"]`).disabled''', arg=ambiguous['id'])
        approve(operator)
        rows = read_store(operator, 'items')
        edited = next(r for r in rows if r['id'] == ambiguous['id'])
        check('review_can_supply_ambiguous_missing_model', edited.get('model') == 'QA-REVIEW', edited)
        check('generic_and_question_embedded_model_allow_blank_model',
              all(r['status'] == 'published' for r in rows if r['platform'] == '天猫') and
              all(not r.get('model') for r in rows if r['question'] in
                  ['售后安装如何预约？', '售后服务的入口在哪里？', '这台 QA42C 的接口如何核对？']))
        incomplete = next(r for r in rows if not r['answer'])
        check('missing_answer_stays_unpublished', incomplete['status'] == 'draft', incomplete)

        name = '人工题库主流程主播'
        anchor = new_page(ctx, 'anchor', name)
        check('home_uses_same_reviewed_pool_count', bool(re.search(r'\b4\s*(?:个训练点|道)', anchor.locator('.r2-start-meta').inner_text())))
        open_training(anchor, '京东', 4)
        observed = []
        turn, reference = capture_turn(anchor, name, 4)
        assert_material_turn(turn, reference, rows)
        observed.append(turn)
        anchor.screenshot(path=str(OUT / 'question-bank-live.png'), full_page=True)

        # New reviewed material arrives through another real operator tab after
        # this session has started. The current session keeps its original pool.
        newcomer = operating('QA-NEW', 'SKU-NEW', '京东', '新增题目如何核对？', '人工构造答案 会话后新增')
        import_file(operator, fixture('synthetic-later.csv', csv_bytes(op_headers, [newcomer])))
        approve(operator)
        for _ in range(3):
            advance(anchor)
            turn, reference = capture_turn(anchor, name, 4)
            assert_material_turn(turn, reference, rows)
            observed.append(turn)
            if turn.get('sku'):
                anchor.screenshot(path=str(OUT / 'question-bank-live.png'), full_page=True)
        check('frozen_pool_full_round_has_no_repeat_or_seed', len({t['questionId'] for t in observed}) == 4 and
              all(t['kind'] != 'seed' and t['model'] != 'QA-NEW' and t['platform'] == '京东' for t in observed), observed)
        advance(anchor)
        repeat, reference = capture_turn(anchor, name, 4)
        assert_material_turn(repeat, reference, rows)
        check('frozen_pool_does_not_grow_on_next_round', repeat['questionId'] in {t['questionId'] for t in observed})
        finish(anchor)
        before = checkpoint(anchor, name)['snapshot']['turns']
        anchor.locator('#reviewDetails').click()
        expand_references(anchor)
        review_text = anchor.locator('#questionSummary').text_content()
        check('review_keeps_original_model_reference_source', all(
            t['model'] in review_text and t['referenceAnswer'] in review_text and t['sourceRef'] in review_text
            for t in before))
        anchor.screenshot(path=str(OUT / 'question-bank-review.png'), full_page=True)

        # Explicit synthetic fixture mutation: emulate a later published-row edit.
        ids = [r['id'] for r in rows if r['status'] == 'published' and r['platform'] == '京东']
        anchor.evaluate('''async ({name,ids})=>{
          const db=await new Promise((resolve,reject)=>{const q=indexedDB.open(name);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
          await new Promise((resolve,reject)=>{const tx=db.transaction('items','readwrite'),s=tx.objectStore('items');
            for(const id of ids){const q=s.get(id);q.onsuccess=()=>{const row=q.result;row.answer='人工构造后续修订，不得改写旧场次';row.model='QA-CHANGED';row.sourceRef='人工构造后续来源';s.put(row)}}
            tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});db.close();
        }''', {'name': DB, 'ids': ids})
        report['synthetic_injection'] = 'Only published items were edited in native IndexedDB after review; session/records/submissions were never injected.'
        anchor.reload()
        login(anchor, 'anchor', name)
        anchor.locator('#restoreLocalSession').click()
        anchor.locator('#reviewDetails').wait_for()
        after = checkpoint(anchor, name)['snapshot']['turns']
        project = lambda turns: [{k: t.get(k) for k in SNAP_FIELDS} for t in turns]
        check('restored_session_reference_snapshot_does_not_drift', project(before) == project(after))
        anchor.locator('#reviewDetails').click()
        expand_references(anchor)
        restored = anchor.locator('#questionSummary').text_content()
        check('restored_review_displays_snapshot_not_current_library', 'QA-CHANGED' not in restored and
              all(t['referenceAnswer'] in restored for t in before))
        anchor.locator('#reviewDetailsBack').click()
        anchor.locator('#submitOperator').fill('人工题库审核员')
        anchor.locator('#submitSession').click()
        anchor.wait_for_function("document.querySelector('#submitSession').textContent.includes('已提交给')")
        submissions = next(r['value'] for r in read_store(anchor, 'prefs') if r['id'] == 'submissions')
        submitted = next(s for s in submissions if s['anchorName'] == name)
        check('submission_preserves_same_question_metadata_snapshot', project(submitted['turns']) == project(before))
        records = [r for r in read_store(anchor, 'records') if r.get('anchorName') == name or r.get('userName') == name]
        report['record_sample'] = records
        records_by_id = {r['id']: r for r in records}
        check('durable_records_preserve_same_reference_snapshot',
              project([records_by_id[t['id']] for t in before]) == project(before))

        for platform, count in [('抖音', 1), ('天猫', 4)]:
            platform_name = f'人工平台隔离-{platform}'
            p = new_page(ctx, 'anchor', platform_name)
            open_training(p, platform, count)
            seen = []
            for i in range(count):
                if i:
                    advance(p)
                t, ref = capture_turn(p, platform_name, count)
                assert_material_turn(t, ref, rows)
                seen.append(t)
            check(f'{platform}_platform_isolation_and_generic_question_text',
                  len({t['questionId'] for t in seen}) == count and all(t['platform'] == platform for t in seen), seen)
            finish(p)
            p.close()

        # No approved air-conditioner material exists: an incomplete import is not
        # a reason to leave training empty or to borrow TV questions.
        fallback = new_page(ctx, 'anchor', '人工无资料回退主播')
        open_training(fallback, '京东', 3, category='TCL 空调', board='03')
        seed, seed_ref = capture_turn(fallback, '人工无资料回退主播', 3)
        check('missing_answer_other_category_uses_labelled_seed', seed.get('kind') == 'seed' and
              seed.get('category') == 'TCL 空调' and '教学示例' in (seed.get('source', '') + seed_ref), seed)
        finish(fallback)
        fresh = new_page(ctx, 'anchor', '人工新场读取新题库')
        open_training(fresh, '京东', 5)
        seen = []
        for i in range(5):
            if i:
                advance(fresh)
            t, ref = capture_turn(fresh, '人工新场读取新题库', 5)
            seen.append(t)
        check('new_session_reads_latest_reviewed_pool', len({t['questionId'] for t in seen}) == 5 and
              any(t.get('model') == 'QA-NEW' for t in seen), seen)
        finish(fresh)
        check('live_sku_context_exact_or_hidden_for_empty',
              any(row['sku'] for row in report['sku_context_observations']) and
              any(not row['sku'] for row in report['sku_context_observations']))
        check('no_application_page_errors', not report['errors'], report['errors'])
        report['source_hashes_after'] = remote_hashes()
        check('source_unchanged_during_acceptance', report['source_hashes'] == report['source_hashes_after'])
        if EXPECTED_APP_SHA:
            check('browser_app_response_matches_expected_release', bool(report['browser_app_responses']) and
                  all(row['matches_expected'] for row in report['browser_app_responses']),
                  report['browser_app_responses'])
        ctx.close()
        browser_request.dispose()
        browser.close()
    report['status'] = 'PASS'
except Exception as error:
    report['status'] = 'FAIL'
    report['exception'] = str(error)
    report['traceback'] = traceback.format_exc()
finally:
    report['not_completed'] = [name for name in EXPECTED_CHECKS if name not in report['checks']]
    if report.get('url') and report.get('source_hashes'):
        try:
            final_hashes = {}
            for asset in ASSETS:
                request = Request(urljoin(report['url'], asset), headers={'Cache-Control': 'no-cache'})
                with urlopen(request, timeout=20) as response:
                    final_hashes[asset] = hashlib.sha256(response.read()).hexdigest()
            report['source_hashes_after'] = final_hashes
            report['source_unchanged'] = final_hashes == report['source_hashes']
            if not report['source_unchanged']:
                report['status'] = 'FAIL'
        except Exception as error:
            report['final_hash_error'] = str(error)
            report['status'] = 'FAIL'
    if server:
        server.shutdown()
    (OUT / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({**{key: report.get(key) for key in ['status', 'url', 'source_hashes', 'source_unchanged', 'exception']},
                      'checks': {key: value['pass'] for key, value in report['checks'].items()}},
                     ensure_ascii=False, indent=2))
if report['status'] != 'PASS':
    raise SystemExit(1)
