#!/usr/bin/env python3
"""Read public deployment bytes only after the parent confirms Pages success.

All HTTP attempts are retained. One bounded reread is permitted only for failed
first-pass assets; the first-pass outcome remains explicit in the final result.
"""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--deployment-commit', required=True)
    parser.add_argument('--pages-run', required=True)
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    if not args.execute:
        parser.error('No requests sent: --execute is required after Pages success.')
    if not 1 <= args.workers <= 6:
        parser.error('workers must be between 1 and 6')
    here = pathlib.Path(__file__).resolve().parent
    expected_bytes = (here / 'expected-resources.json').read_bytes()
    spec = json.loads(expected_bytes)
    files = spec['expected_files']
    assert len(files) == 239
    run_id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output = here / ('run-' + run_id)
    output.mkdir(exist_ok=False)
    (output / 'anchor-bodies').mkdir()
    (output / 'failed-bodies').mkdir()
    lock = threading.Lock()
    attempts = []
    started = utc()
    manifest_path = 'tcl-v352-asr-r25-qa/static-manifest.json'
    app_path = 'tcl-v352-asr-r25-qa/app.js'

    def fetch(path, phase):
        url = spec['base_url'] + urllib.parse.quote(path, safe='/')
        url += '?' + urllib.parse.urlencode({'codex_verify': run_id})
        row = {'path': path, 'url': url, 'phase': phase, 'started_at': utc(),
               'expected_sha256': files[path]}
        start = time.monotonic()
        body = b''
        headers = {}
        request = urllib.request.Request(url, headers={
            'User-Agent': 'Codex-R25-ReadOnly-Resource-Verification/1.0',
            'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache'})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                row['http_status'] = response.status
                row['final_url'] = response.geturl()
                headers = dict(response.headers.items())
                body = response.read()
        except urllib.error.HTTPError as error:
            row['http_status'] = error.code
            row['final_url'] = error.geturl()
            headers = dict(error.headers.items())
            body = error.read()
            row['error'] = str(error)
        except Exception as error:
            row['http_status'] = None
            row['error'] = type(error).__name__ + ': ' + str(error)
        row.update({'finished_at': utc(), 'elapsed_seconds': round(time.monotonic()-start, 4),
                    'body_bytes': len(body), 'body_sha256': digest(body),
                    'response_headers': headers})
        row['hash_matches'] = row['body_sha256'] == files[path]
        row['pass'] = row['http_status'] == 200 and row['hash_matches']
        if path == manifest_path and row['http_status'] == 200:
            try:
                row['manifest_version'] = json.loads(body)['version']
            except Exception as error:
                row['manifest_parse_error'] = str(error)
        with lock:
            row['attempt_number'] = len(attempts) + 1
            attempts.append(row)
            with (output / 'attempts.jsonl').open('a', encoding='utf-8') as stream:
                stream.write(json.dumps(row, ensure_ascii=False) + '\n')
            if phase in ('start-anchor', 'end-anchor'):
                (output / 'anchor-bodies' / (phase + '-' + pathlib.PurePosixPath(path).name)).write_bytes(body)
            if not row['pass']:
                (output / 'failed-bodies' / (str(row['attempt_number']) + '.body')).write_bytes(body)
        return row

    start_anchors = [fetch(p, 'start-anchor') for p in (app_path, manifest_path)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        first_pass = list(pool.map(lambda p: fetch(p, 'first-pass'), files))
    failed_paths = [r['path'] for r in first_pass if not r['pass']]
    # One explicit reread of each failed asset, never a repeat of the whole suite.
    rereads = [fetch(p, 'bounded-reread') for p in failed_paths]
    end_anchors = [fetch(p, 'end-anchor') for p in (app_path, manifest_path)]
    latest = {r['path']: r for r in first_pass}
    latest.update({r['path']: r for r in rereads})
    all_assets_pass = all(r['pass'] for r in latest.values())
    anchors_pass = all(r['pass'] for r in start_anchors + end_anchors)
    versions_match = all(r.get('manifest_version') == spec['version']
                         for r in start_anchors + end_anchors if r['path'] == manifest_path)
    if not (all_assets_pass and anchors_pass and versions_match):
        status = 'FAIL'
    elif failed_paths:
        status = 'PASS_AFTER_BOUNDED_REREAD'
    else:
        status = 'PASS_FIRST_PASS'
    result = {
        'task_id': spec['task_id'], 'scope': 'Fresh public HTTP/status/body SHA checks only; no product flow, model accuracy or real-device acceptance.',
        'status': status, 'run_id': run_id, 'started_at': started, 'finished_at': utc(),
        'deployment_commit': args.deployment_commit, 'pages_run': args.pages_run,
        'source_commit': spec['source_commit'], 'archive_sha256': spec['archive_sha256'],
        'expected_version': spec['version'], 'expected_resources_sha256': digest(expected_bytes),
        'resource_count': len(files), 'old_count': 217, 'new_count': 22,
        'first_pass_count': len(first_pass), 'first_pass_passed': sum(r['pass'] for r in first_pass),
        'first_pass_failures': [r for r in first_pass if not r['pass']],
        'bounded_rereads': rereads, 'unresolved_assets': [r for r in latest.values() if not r['pass']],
        'start_anchors': start_anchors, 'end_anchors': end_anchors,
        'anchors_pass': anchors_pass, 'manifest_versions_match': versions_match,
        'total_http_attempts': len(attempts), 'retry_policy': 'One explicit reread only of each failed first-pass resource; failed anchors remain failures.',
    }
    (output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'status': status, 'first_pass_passed': result['first_pass_passed'],
                      'first_pass_failures': len(failed_paths), 'unresolved_assets': len(result['unresolved_assets']),
                      'anchors_pass': anchors_pass, 'versions_match': versions_match,
                      'output': str(output)}, ensure_ascii=False))
    return 0 if status.startswith('PASS') else 1


if __name__ == '__main__':
    raise SystemExit(main())
