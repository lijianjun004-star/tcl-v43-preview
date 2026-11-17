#!/usr/bin/env python3
"""Public final product UI acceptance using existing synthetic accounts only.
Default has zero network/browser operations. No SDK/config/response injection,
request interception, credentials/HAR/screenshots/console dumps, hardware access,
or model/practice actions. All identity/business responses come from production.
"""
from pathlib import Path
from urllib.parse import urlsplit
import argparse, base64, hashlib, json, os

SITE = Path('/workspace/tcl-r25-fix/experiments/r25/tcl-v352-asr-r25-qa')
URL = 'https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r25-qa/'
ENV = 'unknown-roadrunner-d7cap6e21f517'
VERSION = 'r25-registration-recovery-20261117'
IMPORTANT_ASSETS = {'app.js', 'app-config.json', 'name-identity.mjs', 'cloud-workflow.mjs', 'cloud-workspace.mjs', 'cloudbase-adapter.mjs', 'vendor/cloudbase/cloudbase-sdk.mjs'}

def private_read(path):
    p = Path(path)
    if p.is_symlink() or not p.is_file() or p.stat().st_mode & 0o077:
        raise ValueError('PRIVATE_FILE_REQUIRED')
    return json.loads(p.read_text())

def private_save(path, value):
    p = Path(path)
    if p.is_symlink():
        raise ValueError('SYMLINK_REJECTED')
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    p.chmod(0o600)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--private-dir')
    args = parser.parse_args()
    if not args.execute:
        print(json.dumps({'status': 'DRY_RUN_ZERO_NETWORK', 'browserLaunches': 0, 'scope': 'public final product UI; existing synthetic accounts only'}))
        return 0
    if not args.private_dir:
        raise ValueError('PRIVATE_DIRECTORY_REQUIRED')
    directory = Path(args.private_dir)
    fixture = private_read(directory / 'fixture.json')
    if fixture.get('envId') != ENV or fixture.get('testOnly') is not True or fixture.get('executionApproved') is not True:
        raise ValueError('APPROVED_SYNTHETIC_FIXTURE_REQUIRED')
    accounts = {item['alias']: item for item in fixture['accounts']}
    if any(not accounts.get(alias, {}).get('uid') for alias in ['operator', 'anchor', 'outsider', 'hasNative']):
        raise ValueError('READY_SYNTHETIC_ACCOUNTS_REQUIRED')
    extras = fixture.get('extraAccounts', [])
    admin = next((item for item in extras if item.get('alias') == 'syntheticAdmin' and item.get('role') == 'admin' and item.get('businessCreated') and not item.get('retiredAt')), None)
    if admin:
        accounts['syntheticAdmin'] = admin
    expected = json.loads((SITE / 'static-manifest.json').read_text())
    if expected.get('version') != VERSION:
        raise ValueError('UNEXPECTED_LOCAL_CANDIDATE_VERSION')
    report = {'suite': 'REAL_PUBLIC_REGISTRATION_RECOVERY_PRODUCT_UI', 'status': 'RUNNING', 'url': URL, 'version': VERSION, 'checks': [], 'assetResponses': [], 'pageErrors': [], 'modelRequests': 0, 'sdkInjection': False, 'configurationOverride': False, 'responseMocks': False, 'requestInterception': False, 'testOnlyAccountsCreated': 0, 'notRun': ['Physical iPhone/Android', 'China mainland network', 'Media hardware and model inference', 'Original user password login']}
    result_path = directory / 'product-ui-result.json'
    def save():
        private_save(result_path, report)
    def check(label, value):
        report['checks'].append({'label': label, 'pass': bool(value)})
        save()
        if not value:
            raise AssertionError(label)
    contexts = []
    responses = []
    identity_events = []
    me_events = []
    client_pages = {}
    endpoint = fixture['registrationEndpoint']
    # Hooks compare private identifiers only in memory and persist booleans/hashes.
    def attach(page, alias, account):
        page.on('pageerror', lambda error: report['pageErrors'].append({'actor': alias, 'type': type(error).__name__}))
        def request(request):
            parsed = urlsplit(request.url)
            if parsed.hostname in ['huggingface.co', 'hf-mirror.com'] or parsed.path.lower().endswith(('.onnx', '.wasm')) or '/live-practice-room/voice/' in parsed.path.lower():
                report['modelRequests'] += 1
        def response(response):
            if response.url.startswith(URL):
                relative = response.url[len(URL):].split('?', 1)[0]
                if relative in IMPORTANT_ASSETS:
                    responses.append((alias, relative, response))
            if response.url == endpoint and response.request.method == 'POST':
                try:
                    body = response.request.post_data_json
                    result = response.json()
                    data = result.get('data', {})
                    identity_events.append({'actor': alias, 'action': body.get('action'), 'ok': result.get('ok') is True, 'sameOperation': body.get('operationId') == account.get('operationId'), 'sameSecret': body.get('operationSecret') == account.get('operationSecret'), 'sameUid': str(data.get('uid')) == str(account['uid']), 'canonicalRole': data.get('role') == account['role'], 'state': data.get('state') if data.get('state') in ['ready', 'reserved'] else None})
                except Exception:
                    identity_events.append({'actor': alias, 'parseFailed': True})
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
                            me_events.append({'actor': alias, 'sameUid': str(user.get('uid')) == str(account['uid']), 'expectedRole': user.get('role') == account['role'], 'uidSha256': hashlib.sha256(str(user.get('uid')).encode()).hexdigest()})
                            break
                        if isinstance(result, dict) and 'data' in result:
                            result = result['data']
                        else:
                            break
                except Exception:
                    pass
        page.on('request', request)
        page.on('response', response)
    def ready(page):
        page.locator('#cloudRefresh').wait_for(timeout=90000)
        page.wait_for_function("document.querySelector('[data-cloud-status]')?.textContent.includes('云端已更新')", timeout=90000)
    def page_for(browser, alias, account):
        context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='zh-CN')
        contexts.append(context)
        page = context.new_page()
        page.set_default_timeout(45000)
        attach(page, alias, account)
        page.goto(URL, wait_until='networkidle', timeout=90000)
        page.locator('#cloudRegisterForm').wait_for(timeout=90000)
        client_pages[alias] = page
        return page
    def identity_matches(alias):
        return any(event['actor'] == alias and event['sameUid'] and event['expectedRole'] for event in me_events)
    def dashboard(page, alias, account):
        ready(page)
        check(alias + '_profile_name_and_role_dashboard', page.locator('.r2-identity-text b').inner_text() == account['name'] and {'anchor': '我的云端提交与反馈', 'operator': '我的云端收件箱', 'admin': '全部主播交付作业'}[account['role']] in page.locator('#view').inner_text())
        check(alias + '_server_me_matches_exact_uid_role', identity_matches(alias))
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'], proxy={'server': os.environ['HTTPS_PROXY'], 'bypass': 'localhost,127.0.0.1'} if os.environ.get('HTTPS_PROXY') else None)
            try:
                recovery = accounts['hasNative']
                page = page_for(browser, 'recovery', recovery)
                check('registration_has_no_invitation_field', page.locator('#cloudInvitationCode').count() == 0 and page.locator('#cloudRegisterRole option').evaluate_all('(els)=>els.map(x=>x.value)') == ['anchor', 'operator'])
                remote_manifest = page.request.get(URL + 'static-manifest.json', timeout=60000)
                check('public_manifest_exact_candidate_version_and_hashes', remote_manifest.ok and remote_manifest.json() == expected)
                page.locator('summary', has_text='注册中断').click()
                check('public_recovery_input_masks_secret', page.locator('#cloudRecoveryCode').get_attribute('type') == 'password')
                before = len(identity_events)
                page.locator('#cloudRecoveryCode').fill('INVALID-SYNTHETIC-RECOVERY-CODE')
                page.locator('#cloudRecoveryForm button[type=submit]').click()
                page.wait_for_function("document.querySelector('[data-cloud-status]')?.classList.contains('error')", timeout=15000)
                check('invalid_code_rejected_cleared_without_network_or_login', page.locator('#cloudRecoveryCode').input_value() == '' and page.locator('#cloudRefresh').count() == 0 and len(identity_events) == before)
                payload = {'version': 1, 'envId': ENV, 'name': recovery['name'], 'role': recovery['role'], 'operationId': recovery['operationId'], 'operationSecret': recovery['operationSecret']}
                code = 'R25REC1.' + base64.urlsafe_b64encode(json.dumps(payload, ensure_ascii=False).encode()).decode().rstrip('=')
                page.locator('#cloudRecoveryCode').fill(code)
                page.locator('#cloudRecoveryForm button[type=submit]').click()
                page.wait_for_function("document.querySelector('[data-cloud-status]')?.textContent.includes('原注册已恢复')", timeout=90000)
                check('valid_code_restores_exact_name_role_without_auto_login', page.locator('#cloudRegisterName').input_value() == recovery['name'] and page.locator('#cloudRegisterRole').input_value() == recovery['role'] and page.locator('#cloudRegisterPassword').input_value() == '' and page.locator('#cloudRecoveryCode').input_value() == '' and page.locator('#cloudRefresh').count() == 0)
                restored = [event for event in identity_events if event.get('actor') == 'recovery' and event.get('action') == 'status']
                check('actual_recovery_status_same_operation_secret_uid_role', len(restored) == 1 and all(restored[0].get(key) for key in ['ok', 'sameOperation', 'sameSecret', 'sameUid', 'canonicalRole']) and restored[0]['state'] == 'ready')
                page.locator('#cloudRegisterPassword').fill(recovery['password'])
                page.locator('#cloudRegisterForm button[type=submit]').click()
                dashboard(page, 'recovery', recovery)
                events = [event for event in identity_events if event.get('actor') == 'recovery']
                check('join_continues_original_status_without_new_register', sum(event.get('action') == 'status' for event in events) == 2 and not any(event.get('action') == 'register' for event in events))
                storage = page.evaluate('''async x=>{const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('r25-name-identity:'+encodeURIComponent(x.env));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{return await new Promise((resolve,reject)=>{const tx=database.transaction('operations','readonly');const req=tx.objectStore('operations').getAll();tx.oncomplete=()=>{const rows=req.result;resolve({same:rows.length===1&&rows[0].operationId===x.operationId&&rows[0].operationSecret===x.secret&&rows[0].role===x.role,noPassword:!JSON.stringify(rows).includes(x.password)&&!rows.some(r=>Object.keys(r).some(k=>/password/i.test(k))),noCodeInWebStorage:![...Object.values(localStorage),...Object.values(sessionStorage)].some(v=>v.includes(x.code))});};tx.onabort=()=>reject(tx.error);});}finally{database.close();}}''', {'env': ENV, 'operationId': recovery['operationId'], 'secret': recovery['operationSecret'], 'role': recovery['role'], 'password': recovery['password'], 'code': code})
                check('public_recovery_storage_keeps_same_proof_not_password_or_raw_code', storage.get('same') and storage.get('noPassword') and storage.get('noCodeInWebStorage'))
                aliases = ['operator', 'anchor', 'outsider'] + (['syntheticAdmin'] if admin else [])
                for alias in aliases:
                    account = accounts[alias]
                    page = page_for(browser, alias, account)
                    page.locator('#cloudNameLoginTab').click()
                    # Test admin has no human alias; its original native username is intentionally used.
                    page.locator('#cloudUsername').fill(account['username'] if alias == 'syntheticAdmin' else account['name'])
                    page.locator('#cloudPassword').fill(account['password'])
                    page.locator('#cloudLoginForm button[type=submit]').click()
                    dashboard(page, alias, account)
                    wanted = [fixture['submissionId']] + fixture.get('extraSubmissionIds', [])
                    counts = page.locator('#cloudSubmissions [data-cloud-submission]').evaluate_all('(els,ids)=>({known:ids.filter(id=>els.some(el=>el.dataset.cloudSubmission===id)).length,total:els.length})', wanted)
                    check(alias + '_existing_synthetic_inbox_scope', counts['known'] == (0 if alias == 'outsider' else len(wanted)))
                    if alias in ['operator', 'anchor', 'syntheticAdmin']:
                        # Open only an explicitly known synthetic submission; do not inspect real user details.
                        page.locator('[data-cloud-submission="' + fixture['submissionId'] + '"]').click()
                        page.locator('#cloudDetail h2', has_text='已提交的训练记录').wait_for(timeout=60000)
                        check(alias + '_opens_only_scoped_synthetic_submission', page.locator('#cloudDetail').get_attribute('data-submission-id') == fixture['submissionId'])
                if not admin:
                    report['notRun'].append('Product administrator UI: no active synthetic admin fixture supplied')
                for alias, relative, response in responses:
                    data = response.body()
                    report['assetResponses'].append({'actor': alias, 'asset': relative, 'status': response.status, 'sha256': hashlib.sha256(data).hexdigest()})
                check('every_actual_important_static_response_matches_candidate', bool(responses) and all(item['status'] == 200 and item['sha256'] == expected['files'][item['asset']] for item in report['assetResponses']))
                observed = {item['asset'] for item in report['assetResponses']}
                check('new_identity_workflow_workspace_and_sdk_actually_loaded', IMPORTANT_ASSETS.issubset(observed))
                check('public_product_no_page_errors', not report['pageErrors'])
                check('no_model_downloads_or_practice_actions', report['modelRequests'] == 0)
                report['identityRequests'] = identity_events
                report['meChecks'] = me_events
                report['browser'] = browser.version
                report['status'] = 'PASS_WITH_NOT_RUN'
            finally:
                for context in contexts:
                    context.close()
                browser.close()
                report['contextsClosed'] = True
    except Exception as error:
        report['status'] = 'FAIL'
        report['error'] = {'type': type(error).__name__, 'summary': 'Raw errors and private request contents omitted'}
    save()
    print(json.dumps({'status': report['status'], 'checks': len(report['checks']), 'notRun': len(report['notRun']), 'result': str(result_path)}))
    return 1 if report['status'] == 'FAIL' else 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print(json.dumps({'status': 'FAIL', 'error': 'Controlled setup failure; raw private details omitted'}))
        raise SystemExit(1)
