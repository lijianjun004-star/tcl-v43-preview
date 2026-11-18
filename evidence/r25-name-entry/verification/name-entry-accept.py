#!/usr/bin/env python3
"""Real name-entry product/Auth acceptance with unique synthetic fixtures.
Default: zero network/browser calls. Candidate mode serves only the 29 frozen
static product files at the exact existing Pages path; all cloud calls are real.
--public disables interception entirely. Never logs credentials or original data.
"""
from pathlib import Path
from urllib.parse import urlsplit
from datetime import datetime, timezone
import argparse, hashlib, json, os, uuid

SITE = Path('/workspace/tcl-r25-name-entry/experiments/r25/tcl-v352-asr-r25-qa')
URL = 'https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r25-qa/'
ENV = 'unknown-roadrunner-d7cap6e21f517'
ENDPOINT = 'https://unknown-roadrunner-d7cap6e21f517-1519058345.ap-shanghai.app.tcloudbase.com/r25-name-identity'

def now():
    return datetime.now(timezone.utc).isoformat()

def save_private(path, value):
    path = Path(path)
    if path.is_symlink():
        raise ValueError('SYMLINK_REJECTED')
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    path.chmod(0o600)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--public', action='store_true')
    parser.add_argument('--private-dir')
    args = parser.parse_args()
    if not args.execute:
        print(json.dumps({'status': 'DRY_RUN_ZERO_NETWORK', 'browserLaunches': 0, 'cloudCalls': 0, 'modes': ['candidate static-only interception', '--public without interception']}))
        return 0
    if not args.private_dir:
        raise ValueError('NEW_PRIVATE_DIRECTORY_REQUIRED')
    directory = Path(args.private_dir)
    directory.mkdir(mode=0o700, parents=False, exist_ok=False)
    manifest = json.loads((SITE / 'static-manifest.json').read_text())
    assets = {name: (SITE / name).read_bytes() for name in manifest['files']}
    assets['static-manifest.json'] = (SITE / 'static-manifest.json').read_bytes()
    if len(assets) != 29 or any(hashlib.sha256(assets[name]).hexdigest() != digest for name, digest in manifest['files'].items()):
        raise ValueError('FROZEN_CANDIDATE_HASHES_REQUIRED')
    run = uuid.uuid4().hex[:14]
    fixture = {'version': 1, 'envId': ENV, 'region': 'ap-shanghai', 'fixtureId': 'nameentry-' + run, 'testOnly': True, 'executionApproved': True, 'browserUrl': URL, 'registrationEndpoint': ENDPOINT, 'createdAt': now(), 'accounts': [{'alias': alias, 'role': alias, 'name': 'R25姓名验收' + run + '_' + alias} for alias in ['operator', 'anchor']]}
    save_private(directory / 'fixture.json', fixture)  # Intention persisted before any network call.
    report = {'suite': 'REAL_NAME_ENTRY_PRODUCT_AUTH', 'status': 'RUNNING', 'startedAt': now(), 'mode': 'public' if args.public else 'candidate-static-at-existing-origin', 'version': manifest['version'], 'checks': [], 'pageErrors': [], 'modelRequests': 0, 'businessMocks': False, 'sdkInjection': False, 'configOverride': False, 'staticInterceptionOnly': not args.public, 'assetResponses': [], 'identityActions': {}, 'notRun': ['Physical mobile devices and mainland network', 'Original user password or account changes', 'Media hardware, models, private attachments, assignments and submissions']}
    def save():
        save_private(directory / 'result.json', report)
        save_private(directory / 'fixture.json', fixture)
    def check(label, value):
        report['checks'].append({'label': label, 'pass': bool(value)})
        save()
        if not value:
            raise AssertionError(label)
    pages = {}
    contexts = []
    static_responses = []
    me_events = {}
    def retain_local_account(page, account):
        # Only our newly generated name is read; all private values go into fixture.json, never stdout.
        row = page.evaluate('''async x=>{const dbName='r25-name-identity:'+encodeURIComponent(x.env);if(!(await indexedDB.databases()).some(d=>d.name===dbName))return null;const db=await new Promise((resolve,reject)=>{const req=indexedDB.open(dbName);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});try{return await new Promise((resolve,reject)=>{const tx=db.transaction('operations','readonly');const req=tx.objectStore('operations').getAll();req.onsuccess=()=>resolve(req.result.find(row=>row.name?.normalize('NFKC').trim().toLowerCase()===x.name.normalize('NFKC').trim().toLowerCase())||null);req.onerror=()=>reject(req.error);});}finally{db.close();}}''', {'env': ENV, 'name': account['name']})
        if row:
            for key in ['name', 'role', 'uid', 'username', 'operationId', 'operationSecret', 'deviceKey', 'state']:
                if key in row:
                    account[key] = row[key]
            save_private(directory / 'fixture.json', fixture)
        return row
    def observe(page, actor, account):
        me_events[actor] = []
        report['identityActions'][actor] = {'resolve': 0, 'register': 0, 'status': 0, 'other': 0}
        page.on('pageerror', lambda error: report['pageErrors'].append({'actor': actor, 'type': type(error).__name__}))
        def request(request):
            parsed = urlsplit(request.url)
            if parsed.hostname in ['huggingface.co', 'hf-mirror.com'] or parsed.path.lower().endswith(('.onnx', '.wasm')) or '/live-practice-room/voice/' in parsed.path.lower():
                report['modelRequests'] += 1
            if request.url == ENDPOINT and request.method == 'POST':
                try:
                    action = request.post_data_json.get('action')
                    counter = action if action in ['resolve', 'register', 'status'] else 'other'
                    report['identityActions'][actor][counter] += 1
                except Exception:
                    report['identityActions'][actor]['other'] += 1
        def response(response):
            if response.url.startswith(URL):
                name = response.url[len(URL):].split('?', 1)[0] or 'index.html'
                if name in assets:
                    static_responses.append((actor, name, response))
            if '/rpc/r25wf_api' in urlsplit(response.url).path and response.request.method == 'POST':
                try:
                    body = response.request.post_data_json
                    if body.get('action') not in ['me', 'bootstrap']:
                        return
                    result = response.json()
                    for _ in range(4):
                        if isinstance(result, list) and len(result) == 1:
                            result = result[0]
                        if isinstance(result, dict) and result.get('ok') is True and isinstance(result.get('data'), dict) and 'user' in result['data']:
                            user = result['data']['user']
                            me_events[actor].append({'uidSha256': hashlib.sha256(str(user.get('uid')).encode()).hexdigest(), 'role': user.get('role') if user.get('role') in ['anchor', 'operator', 'admin', 'pending'] else None, 'sameUid': not account.get('uid') or str(user.get('uid')) == str(account.get('uid'))})
                            # Capture only the known generated name's real UID/profile for retirement.
                            if user.get('displayName') == account['name']:
                                account['uid'] = str(user['uid'])
                                save_private(directory / 'fixture.json', fixture)
                            break
                        if isinstance(result, dict) and 'data' in result:
                            result = result['data']
                        else:
                            break
                except Exception:
                    pass
        page.on('request', request)
        page.on('response', response)
    def static_route(route):
        # This is the only interception. Cloud hosts and non-product URLs are never mocked.
        parsed = urlsplit(route.request.url)
        prefix = urlsplit(URL)
        if parsed.scheme == prefix.scheme and parsed.netloc == prefix.netloc and parsed.path.startswith(prefix.path):
            relative = parsed.path[len(prefix.path):] or 'index.html'
            if relative in assets:
                content_type = 'text/html' if relative.endswith('.html') else 'application/json' if relative.endswith('.json') else 'text/css' if relative.endswith('.css') else 'text/javascript'
                route.fulfill(status=200, content_type=content_type, body=assets[relative])
                return
        route.continue_()
    def page_for(browser, actor, account):
        context = browser.new_context(locale='zh-CN', viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        contexts.append(context)
        if not args.public:
            context.route(URL + '**', static_route)
        page = context.new_page()
        page.set_default_timeout(60000)
        observe(page, actor, account)
        page.goto(URL, wait_until='networkidle', timeout=90000)
        page.locator('#cloudNameEntryForm').wait_for(timeout=90000)
        pages[actor] = page
        return page
    def ready(page):
        page.locator('#cloudRefresh').wait_for(timeout=90000)
        page.wait_for_function("document.querySelector('[data-cloud-status]')?.textContent.includes('云端已更新')", timeout=90000)
    def enter(page, account, role):
        page.locator('#cloudEntryName').fill(account['name'])
        page.locator('#cloudEntryRole').select_option(role)
        page.locator('#cloudEnterWithName').click()
    def dashboard(page, account, label):
        ready(page)
        check(label + '_expected_real_dashboard', page.locator('.r2-identity-text b').inner_text() == account['name'] and {'operator': '我的云端收件箱', 'anchor': '我的云端提交与反馈'}[account['role']] in page.locator('#view').inner_text())
        check(label + '_device_account_hides_password_form', page.locator('#cloudPasswordForm').count() == 0)
    save()
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'], proxy={'server': os.environ['HTTPS_PROXY'], 'bypass': 'localhost,127.0.0.1'} if os.environ.get('HTTPS_PROXY') else None)
            try:
                for account in fixture['accounts']:
                    actor = account['alias']
                    page = page_for(browser, actor, account)
                    check(actor + '_initial_name_only_no_visible_password', page.locator('input[type=password]:visible').count() == 0 and page.locator('#cloudLegacyAccountDetails').evaluate('(el)=>!el.open'))
                    enter(page, account, account['role'])
                    dashboard(page, account, actor + '_new')
                    row = retain_local_account(page, account)
                    check(actor + '_actual_private_device_identity_captured', row and row.get('state') == 'ready' and row.get('uid') and row.get('username') and row.get('operationId') and row.get('operationSecret') and row.get('deviceKey') and row.get('role') == actor)
                    expected_uid_hash = hashlib.sha256(account['uid'].encode()).hexdigest()
                    check(actor + '_real_me_matches_persisted_uid_role', any(event['uidSha256'] == expected_uid_hash and event['role'] == actor for event in me_events[actor]))
                    first_register_count = report['identityActions'][actor]['register']
                    check(actor + '_registered_once', first_register_count == 1)
                    page.locator('#cloudSignOut').click()
                    page.locator('#cloudNameEntryForm').wait_for(timeout=60000)
                    opposite = 'anchor' if actor == 'operator' else 'operator'
                    enter(page, account, opposite)
                    dashboard(page, account, actor + '_same_device_reenter')
                    after = retain_local_account(page, account)
                    check(actor + '_opposite_first_role_cannot_change_known_identity', after.get('uid') == row['uid'] and after.get('role') == row['role'] and after.get('operationId') == row['operationId'] and report['identityActions'][actor]['register'] == first_register_count)
                    check(actor + '_reentry_actual_me_same_uid_role', len(me_events[actor]) >= 2 and all(event['uidSha256'] == expected_uid_hash and event['role'] == actor for event in me_events[actor]))
                    fresh_actor = actor + '_fresh'
                    fresh = page_for(browser, fresh_actor, account)
                    enter(fresh, account, opposite)
                    fresh.wait_for_function("document.querySelector('#cloudLegacyAccountDetails')?.open && document.querySelector('[data-cloud-status]')?.classList.contains('error')", timeout=90000)
                    check(fresh_actor + '_same_name_requires_verification', fresh.locator('#cloudRefresh').count() == 0 and '这台设备尚未验证原账号' in fresh.locator('[data-cloud-status]').inner_text())
                    check(fresh_actor + '_does_not_register_duplicate', report['identityActions'][fresh_actor]['register'] == 0)
                    fresh.locator('#cloudDeviceCode').fill('INVALID-SYNTHETIC-DEVICE-CODE')
                    fresh.locator('#cloudBindDevice').click()
                    fresh.wait_for_function("document.querySelector('[data-cloud-status]')?.textContent.includes('设备码无效')", timeout=15000)
                    check(fresh_actor + '_invalid_code_clears_without_login', fresh.locator('#cloudDeviceCode').input_value() == '' and fresh.locator('#cloudRefresh').count() == 0)
                    # An unverified fresh context must never acquire a local device key for the known account.
                    fresh_row = fresh.evaluate('''async env=>{const dbName='r25-name-identity:'+encodeURIComponent(env);if(!(await indexedDB.databases()).some(d=>d.name===dbName))return {deviceRows:0};const db=await new Promise(resolve=>{const req=indexedDB.open(dbName);req.onsuccess=()=>resolve(req.result);});try{return await new Promise(resolve=>{const req=db.transaction('operations','readonly').objectStore('operations').getAll();req.onsuccess=()=>resolve({deviceRows:req.result.filter(r=>r.deviceKey).length});});}finally{db.close();}}''', ENV)
                    check(fresh_actor + '_has_no_device_credential', fresh_row['deviceRows'] == 0)
                for actor, name, response in static_responses:
                    digest = hashlib.sha256(response.body()).hexdigest()
                    report['assetResponses'].append({'actor': actor, 'asset': name, 'status': response.status, 'sha256': digest})
                check('all_observed_static_bytes_match_frozen_candidate', bool(static_responses) and all(item['status'] == 200 and item['sha256'] == hashlib.sha256(assets[item['asset']]).hexdigest() for item in report['assetResponses']))
                check('no_page_errors', not report['pageErrors'])
                check('no_model_downloads', report['modelRequests'] == 0)
                report['realMeEvents'] = me_events
                report['browser'] = browser.version
                report['status'] = 'PASS_WITH_NOT_RUN'
            finally:
                # Best-effort fixture capture even if UI/native auth failed after creation.
                for account in fixture['accounts']:
                    page = pages.get(account['alias'])
                    if page and not page.is_closed():
                        try:
                            retain_local_account(page, account)
                        except Exception:
                            pass
                for context in contexts:
                    context.close()
                browser.close()
                report['contextsClosed'] = True
    except Exception as error:
        report['status'] = 'FAIL'
        report['error'] = {'type': type(error).__name__, 'summary': 'Raw private request/error data omitted'}
    report['finishedAt'] = now()
    save()
    print(json.dumps({'status': report['status'], 'checks': len(report['checks']), 'notRun': len(report['notRun']), 'privateOutput': str(directory)}))
    return 1 if report['status'] == 'FAIL' else 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print(json.dumps({'status': 'FAIL', 'error': 'Controlled setup failure; private details omitted'}))
        raise SystemExit(1)
