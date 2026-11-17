#!/usr/bin/env python3
"""Optional real Auth/PG/Storage harness for exact synthetic fixture only.
Default: no browser launch or cloud calls. Candidate static adapter modules are
served locally at the already-approved Pages origin; all API replies are real.
No HAR/traces/screenshots/console forwarding, private credentials stay private.
"""
from pathlib import Path
import argparse, hashlib, json, math, os, struct, uuid

SITE = Path('/workspace/tcl-r25-fix/experiments/r25/tcl-v352-asr-r25-qa')
ENV = 'unknown-roadrunner-d7cap6e21f517'
STATIC_PREFIX = 'https://lijianjun004-star.github.io/tcl-v43-preview/_r25-acceptance-local/'
STATIC_FILES = {'cloudbase-adapter.mjs', 'cloud-workflow.mjs', 'name-identity.mjs', 'vendor/cloudbase/cloudbase-sdk.mjs'}

def private_read(path):
    p = Path(path)
    if p.is_symlink() or not p.is_file() or p.stat().st_mode & 0o077:
        raise ValueError('PRIVATE_FILE_REQUIRED')
    return json.loads(p.read_text())

def private_save(path, data):
    p = Path(path)
    if p.is_symlink():
        raise ValueError('SYMLINK_REJECTED')
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    p.chmod(0o600)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--private-dir')
    args = parser.parse_args()
    if not args.execute:
        print(json.dumps({'status': 'DRY_RUN_ZERO_NETWORK', 'browserLaunches': 0, 'scope': 'synthetic administrator and tiny synthetic private WAV'}))
        return 0
    if not args.private_dir:
        raise ValueError('PRIVATE_DIRECTORY_REQUIRED')
    directory = Path(args.private_dir)
    f = private_read(directory / 'fixture.json')
    if f.get('envId') != ENV or f.get('testOnly') is not True or f.get('executionApproved') is not True:
        raise ValueError('APPROVED_SYNTHETIC_FIXTURE_REQUIRED')
    if len(f.get('extraAccounts', [])) != 1:
        raise ValueError('SYNTHETIC_ADMIN_REQUIRED')
    admin = f['extraAccounts'][0]
    if admin.get('alias') != 'syntheticAdmin' or admin.get('testOnly') is not True or admin.get('role') != 'admin' or not admin.get('businessCreated') or admin.get('retiredAt'):
        raise ValueError('ACTIVE_SYNTHETIC_ADMIN_REQUIRED')
    accounts = {x['alias']: x for x in f['accounts']}
    for alias in ['anchor', 'operator', 'outsider']:
        if not accounts.get(alias, {}).get('uid'):
            raise ValueError('REGISTERED_SYNTHETIC_ACCOUNTS_REQUIRED')
    accounts['syntheticAdmin'] = admin
    if f.get('extraSubmissionIds') or f.get('extraMedia'):
        raise ValueError('EXTRA_MEDIA_ALREADY_PLANNED_NO_AUTOMATIC_RETRY')
    sid = 'recovery-media-' + str(uuid.uuid4())
    media_path = str(accounts['anchor']['uid']) + '/recovery-media-' + str(uuid.uuid4()) + '.wav'
    # Real valid PCM WAV with a quiet 440 Hz synthetic tone, 0.1 seconds.
    samples = [int(1600 * math.sin(2 * math.pi * 440 * n / 16000)) for n in range(1600)]
    pcm = struct.pack('<' + 'h' * len(samples), *samples)
    wav = b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, 16000, 32000, 2, 16) + b'data' + struct.pack('<I', len(pcm)) + pcm
    digest = hashlib.sha256(wav).hexdigest()
    f['extraSubmissionIds'] = [sid]
    f['extraMedia'] = [{'path': media_path, 'mime': 'audio/wav', 'size': len(wav), 'sha256': digest, 'submissionId': sid, 'ownerUid': str(accounts['anchor']['uid'])}]
    private_save(directory / 'fixture.json', f)  # Intent saved before upload/mutations.
    report = {'suite': 'REAL_SYNTHETIC_ADMIN_AND_PRIVATE_MEDIA', 'status': 'RUNNING', 'checks': [], 'scope': 'Actual candidate official SDK adapter with real Auth/PG/Storage; synthetic WAV and test-only accounts; no original passwords', 'notRun': ['Physical phones and mainland network', 'Original administrator password login']}
    def save():
        private_save(directory / 'extra-browser-result.json', report)
    def check(label, value):
        report['checks'].append({'label': label, 'pass': bool(value)})
        save()
        if not value:
            raise AssertionError(label)
    clients = {}
    contexts = []
    save()
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'], proxy={'server': os.environ['HTTPS_PROXY'], 'bypass': 'localhost,127.0.0.1'} if os.environ.get('HTTPS_PROXY') else None)
            try:
                for alias in ['anchor', 'operator', 'outsider', 'syntheticAdmin']:
                    account = accounts[alias]
                    context = browser.new_context(locale='zh-CN')
                    contexts.append(context)
                    page = context.new_page()
                    page.route(f['browserUrl'], lambda route: route.fulfill(content_type='text/html', body='<!doctype html><meta charset="utf-8"><title>Official SDK private-media acceptance</title>'))
                    def static_route(route):
                        relative = route.request.url.removeprefix(STATIC_PREFIX)
                        if relative not in STATIC_FILES:
                            route.abort()
                            return
                        route.fulfill(status=200, content_type='text/javascript', body=(SITE / relative).read_bytes())
                    page.route(STATIC_PREFIX + '**', static_route)
                    page.goto(f['browserUrl'], wait_until='domcontentloaded')
                    page.evaluate('''async x=>{
                        const {createOfficialCloudBaseAdapter}=await import(x.staticPrefix+'cloudbase-adapter.mjs');
                        window.adapter=await createOfficialCloudBaseAdapter({envId:x.env,region:'ap-shanghai',functionName:'r25wf_api',mediaBucket:'r25wf-private'});
                    }''', {'staticPrefix': STATIC_PREFIX, 'env': ENV})
                    result = page.evaluate('''async account=>{await adapter.__r25Auth.signIn(account.username,account.password);const session=await adapter.__r25Auth.getSession();const me=await adapter.rpc({action:'me'});return {uid:session?.uid,ok:me?.ok,role:me?.data?.user?.role,profileUid:me?.data?.user?.uid,media:me?.data?.capabilities?.privateMedia};}''', {'username': account['username'], 'password': account['password']})
                    check(alias + '_real_login_same_uid_role', str(result.get('uid')) == str(account['uid']) and result.get('ok') is True and result.get('role') == account['role'] and str(result.get('profileUid')) == str(account['uid']))
                    if alias == 'anchor':
                        check('private_media_already_enabled_no_setting_changes', result.get('media') is True)
                    clients[alias] = page
                def rpc(alias, action, payload=None, op=None):
                    return clients[alias].evaluate('event=>adapter.rpc(event)', {'action': action, 'payload': payload or {}, 'operationId': op})
                existing = rpc('syntheticAdmin', 'submissions.get', {'id': f['submissionId']})
                check('synthetic_admin_reads_existing_synthetic_submission', existing.get('ok') is True)
                uploaded = clients['anchor'].evaluate('''async x=>{const blob=new Blob([new Uint8Array(x.bytes)],{type:'audio/wav'});const reply=await adapter.__r25Media.upload(x.path,blob,'audio/wav');return {path:reply?.path,size:blob.size};}''', {'path': media_path, 'bytes': list(wav)})
                check('owner_real_private_upload_receipt', uploaded.get('path') == media_path and uploaded.get('size') == len(wav))
                payload = {'id': sid, 'operatorId': accounts['operator']['uid'], 'snapshot': {'id': sid, 'category': '合成私有附件验收', 'turns': [{'id': str(uuid.uuid4()), 'prompt': '合成音频验收', 'answer': '仅用于新版本私有附件权限验收，无真人内容。'}]}, 'media': [{'path': media_path, 'mime': 'audio/wav', 'size': len(wav), 'sha256': digest}]}
                submitted = rpc('anchor', 'submissions.create', payload, str(uuid.uuid4()))
                check('private_media_submission_real_receipt', submitted.get('ok') is True and submitted.get('data', {}).get('receiptId') == sid)
                for alias in ['anchor', 'operator', 'syntheticAdmin']:
                    result = rpc(alias, 'submissions.get', {'id': sid})
                    check(alias + '_reads_private_media_submission', result.get('ok') is True)
                    fetched = clients[alias].evaluate('''async path=>{const blob=await adapter.__r25Media.download(path);const data=await blob.arrayBuffer();const hash=await crypto.subtle.digest('SHA-256',data);return {size:data.byteLength,sha256:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')};}''', media_path)
                    check(alias + '_downloads_exact_private_wav', fetched.get('size') == len(wav) and fetched.get('sha256') == digest)
                denial = rpc('outsider', 'submissions.get', {'id': sid})
                check('unrelated_operator_submission_denied', denial.get('ok') is False and denial.get('error', {}).get('code') in ['FORBIDDEN', 'NOT_FOUND'])
                denied_media = clients['outsider'].evaluate('''async path=>{try{const blob=await adapter.__r25Media.download(path);return {denied:false,size:blob?.size};}catch(error){return {denied:true};}}''', media_path)
                check('unrelated_operator_private_download_denied', denied_media.get('denied') is True)
                seen = set()
                cursor = None
                for _ in range(1000):
                    request = {'limit': 100}
                    if cursor:
                        request['cursor'] = cursor
                    listing = rpc('syntheticAdmin', 'submissions.list', request)
                    check('synthetic_admin_list_page_' + str(len(seen) // 100 + 1), listing.get('ok') is True)
                    items = listing.get('data', {}).get('items', [])
                    seen.update(str(item['id']) for item in items)
                    next_cursor = listing.get('data', {}).get('nextCursor')
                    if not next_cursor:
                        break
                    if next_cursor == cursor:
                        raise AssertionError('NON_ADVANCING_CURSOR')
                    cursor = next_cursor
                else:
                    raise AssertionError('ADMIN_LIST_PAGE_LIMIT')
                check('synthetic_admin_lists_both_synthetic_submissions', sid in seen and f['submissionId'] in seen)
                index_file = directory / 'submission-index-before-extra.json'
                if index_file.exists():
                    expected = private_read(index_file)
                    check('synthetic_admin_lists_every_authoritative_submission_id', seen == set(expected['ids']) | {sid})
                else:
                    report['notRun'].append('Full ID-set comparison against trusted management snapshot: optional submission-index-before-extra.json absent')
                report['status'] = 'PASS_WITH_NOT_RUN'
            finally:
                for context in contexts:
                    context.close()
                browser.close()
    except Exception as error:
        report['status'] = 'FAIL'
        report['error'] = {'type': type(error).__name__, 'summary': 'Raw errors and request details omitted'}
    save()
    print(json.dumps({'status': report['status'], 'checks': len(report['checks']), 'notRun': len(report['notRun'])}))
    return 1 if report['status'] == 'FAIL' else 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print(json.dumps({'status': 'FAIL', 'error': 'Controlled setup failure; no raw details'}))
        raise SystemExit(1)
