#!/usr/bin/env python3
"""Package only the pinned R24 Excel QA release, sources and synthetic evidence.

Run in the dedicated kit workflow checkout. No GitHub writes occur here.
ZIP_STORED and fixed metadata make identical inputs produce identical ZIP bytes.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import urllib.parse
import urllib.request
import zipfile

REPO = 'lijianjun004-star/tcl-v43-preview'
SOURCE_SHA = 'ceee762ef092837e17ab680bdb41c0d1ba55e229'
SOURCE_BRANCH = 'fix/r24-excel-assignment-deploy-20261123'
PUBLISHED_SHA = '1ff721925f826717fb63a8594766e35a812d08ab'
QA_RUN, PAGES_RUN, ARTIFACT_ID = 45135920009, 45136397011, 14799911900
ARTIFACT_NAME = 'r24-excel-qa-45135920009'
ARTIFACT_SHA = '75dd903dd595e3a79953fc892e1e198856068b98e7022412b6a1e2aaf166ae17'
PRODUCT_SHA = '29c2ac4c491b54c467aa31fcdfa68c0b882dbaf227b5869d977c81b11737396c'
APP_SHA = 'bb652c23ee3523e3415f4fbe5941b94c8765c0940063e8d5c47583903ff1ab82'
MANIFEST_SHA = '8494b0f4334c3cef445beb3ee2a2349b85cb893b3471b99b4569943a0f9f7d35'
OFFICIAL_SHA = 'dec534aac5467b07fba730e422f14200d26e3293fd1f964bf1c4ff88d8f33fa5'
MODEL_SHA = 'be25b1ef4dcb7a037cf6954ad878737ce7842fa0b512c991ebd39b95d2e6d548'
LIVE_TREE_SHA = 'f200858e5c5ec363ab7f183b113683e1f21f4299be7980c9f331af4847315716'
ROUTE = 'tcl-r24-paraformer-excel-qa'
VERSION = 'r24-paraformer-excel-assignment-20261123-qa1'
TAG = 'r24-excel-qa-20261123'
ZIP_NAME = 'R24_Excel_QA_20261123.zip'
PUBLIC_URL = 'https://lijianjun004-star.github.io/tcl-v43-preview/' + ROUTE + '/'
SOURCE_DIR = 'experiments/r24-paraformer-excel-assignment/'
OFFICIAL_ARCHIVE = 'experiments/r24-paraformer-release/site-only.zip'
PUBLISHED_ARCHIVE = 'experiments/r24-paraformer-excel-release/site-only.zip'
CANDIDATE_ARCHIVE = 'build/R24_Excel_Assignment_Only_Offline_Candidate.zip'
FRONTEND_FILES = frozenset('''app-config.json app.js asr-glossary.mjs asr-normalize.mjs
assignment-excel.mjs glossary-ui.mjs index.html legacy-65.json lib/parser.js lib/pdf.js
lib/qa-import.js lib/xls.js lib/zip.js paraformer-bridge.mjs paraformer-worker.js
r23-model-choice.js static-manifest.json style.css training-boards.json
vendor/opencc/LICENSE vendor/opencc/LICENSES/Apache-2.0.txt vendor/opencc/THIRD_PARTY_LICENSES.md
vendor/opencc/t2cn.mjs vendor/paraformer/LICENSE-Silero-VAD.txt
vendor/paraformer/LICENSE-onnxruntime.txt vendor/paraformer/LICENSE-sherpa-onnx.txt
vendor/paraformer/NOTICE.md vendor/paraformer/THIRD_PARTY_NOTICES-onnxruntime.txt
vendor/paraformer/license-sources.json vendor/paraformer/manifest.json whisper-bridge.mjs
whisper-worker.mjs'''.split())
MODEL_FILES = {
    'sherpa-onnx-asr.js': (41274, 'ab619fbad082d474ef35616072d3ace7e8f533d3725c611c1c60d7b97cac41c9'),
    'sherpa-onnx-wasm-main-vad-asr.js': (95311, '3e0cbcad90833164f04097e51fbc99b8812dc03977382578fb73eba7f5d13ec4'),
    'sherpa-onnx-wasm-main-vad-asr.wasm': (11539169, '2fc8dc389b23ad07f0d526b2e7c7c828543956d053db858d73cff192be7589e3'),
    'sherpa-onnx-wasm-main-vad-asr.data': (82547881, '9b89b7afaf5375704e758e85e88955abab381f81c466b24ecc7320b24d81b80f'),
}
SOURCE_FILES = tuple(SOURCE_DIR + n for n in (
    'assignment-excel.mjs', 'tools/apply_to_r24.py', 'tools/build_from_official_r24.py',
    'tools/prepare_browser_site.py', 'tests/assignment-excel.test.mjs',
    'tests/ui-lifecycle.test.mjs', 'tests/test_patcher.py',
    'tests/browser_assignment_e2e.py', 'tests/browser_real_model.py',
)) + (OFFICIAL_ARCHIVE, 'release-ci/release_guard.py', '.github/workflows/r24-excel-assignment-qa.yml')
EVIDENCE_FILES = tuple('evidence/' + n for n in (
    'node-tests.log', 'patcher-tests.log', 'browser-assignment-result.json',
    'browser-real-model-result.json', 'built-site-hashes.json', 'public-speech-source.json',
    'assignment.json', 'receipt-text.json', 'receipt-media.json', 'receipt-after-refresh.json',
    'receipt-wrong-version.json', 'http-server.log', 'http-model-server.log',
    'fixtures/three_questions.xlsx', 'fixtures/three_questions.xls', 'fixtures/missing_question.xlsx',
)) + ('build/BUILD_RESULT.json',)
PAGES_STEP = (
    '      - name: Stage isolated R2.4 Excel assignment preview\n'
    '        run: |\n'
    '          MODEL="$RUNNER_TEMP/r24-paraformer-model.tar.bz2"\n'
    '          python3 release-ci/release_guard.py --stage-r24-paraformer-excel _site '
    + PUBLISHED_ARCHIVE + ' "$MODEL"\n'
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()


def read_safe(root, relative, limit=110_000_000):
    root, relative = Path(root).resolve(), PurePosixPath(relative)
    require(not relative.is_absolute() and '..' not in relative.parts, 'Unsafe input path')
    path = root.joinpath(*relative.parts)
    require(path.is_file() and path.resolve().is_relative_to(root), 'Missing/outside input: ' + str(relative))
    require(not any(p.is_symlink() for p in (path, *path.parents) if p != root and p.is_relative_to(root)),
            'Symlink input: ' + str(relative))
    require(path.stat().st_size <= limit, 'Oversized input: ' + str(relative))
    return path.read_bytes()


def git_bytes(root, revision, relative):
    current = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    require(current == revision, 'Checkout is not the pinned commit: ' + str(root))
    raw = subprocess.check_output(['git', '-C', str(root), 'show', revision + ':' + relative])
    require(read_safe(root, relative) == raw, 'Tracked source differs from pinned commit: ' + relative)
    return raw


def zip_files(raw, expected=None):
    result = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for item in archive.infolist():
            if item.is_dir():
                continue
            name = PurePosixPath(item.filename)
            require(not name.is_absolute() and '..' not in name.parts and '\\' not in item.filename,
                    'Unsafe ZIP member')
            require(item.filename not in result and not stat.S_ISLNK(item.external_attr >> 16),
                    'Duplicate or symlink ZIP member')
            require(not item.flag_bits & 1 and item.file_size <= 12_000_000, 'Invalid ZIP member')
            result[item.filename] = archive.read(item)
    if expected is not None:
        require(set(result) == set(expected), 'ZIP file allowlist mismatch')
    return result


def verify_run(data, run_id, revision, branch, workflow):
    expected = {'id': run_id, 'head_sha': revision, 'head_branch': branch,
                'path': workflow, 'status': 'completed', 'conclusion': 'success'}
    require(all(data.get(k) == v for k, v in expected.items()), 'Workflow identity/status mismatch')
    require(data.get('repository', {}).get('full_name') == REPO, 'Workflow repository mismatch')
    require(data.get('event') in ('push', 'workflow_dispatch'), 'Unexpected workflow event')
    return expected


def verify_evidence(evidence):
    build = json.loads(evidence['build/BUILD_RESULT.json'])
    require(build.get('candidate_zip_sha256') == PRODUCT_SHA
            and build.get('source_sha256') == OFFICIAL_SHA
            and build.get('isolated_test_route') == ROUTE
            and build.get('shared_cloud_backend') is False, 'Artifact build identity mismatch')
    for filename, count in [('browser-assignment-result.json', 54), ('browser-real-model-result.json', 13)]:
        result = json.loads(evidence['evidence/' + filename])
        require(result.get('failure') is None and result.get('passed') == count
                and len(result.get('checks', [])) == count
                and all(c.get('pass') is True for c in result['checks']), 'Browser checks failed: ' + filename)
    node = evidence['evidence/node-tests.log'].decode()
    for key, value in [('tests', 78), ('pass', 78), ('fail', 0), ('cancelled', 0), ('skipped', 0), ('todo', 0)]:
        require(re.search(r'(?m)^(?:ℹ |# )?' + key + r'\s+' + str(value) + r'\s*$', node), 'Node summary mismatch')
    patcher = evidence['evidence/patcher-tests.log'].decode()
    require(re.search(r'Ran 9 tests in ', patcher) and patcher.rstrip().endswith('OK'), 'Patcher tests failed')


def preflight(args):
    qa = verify_run(json.loads(read_safe(args.metadata, 'qa-run.json')), QA_RUN, SOURCE_SHA,
                    SOURCE_BRANCH, '.github/workflows/r24-excel-assignment-qa.yml')
    pages = verify_run(json.loads(read_safe(args.metadata, 'pages-run.json')), PAGES_RUN, PUBLISHED_SHA,
                       'main', '.github/workflows/pages.yml')
    artifact = json.loads(read_safe(args.metadata, 'artifact.json'))
    require(artifact.get('id') == ARTIFACT_ID and artifact.get('name') == ARTIFACT_NAME
            and artifact.get('expired') is False
            and artifact.get('workflow_run', {}).get('id') == QA_RUN
            and artifact.get('workflow_run', {}).get('head_sha') == SOURCE_SHA, 'Artifact identity mismatch')
    artifact_raw = read_safe(args.artifact_zip.parent, args.artifact_zip.name)
    require(sha(artifact_raw) == ARTIFACT_SHA, 'Final QA artifact archive SHA mismatch')
    artifact_files = zip_files(artifact_raw)
    evidence = {}
    for name in (*EVIDENCE_FILES, CANDIDATE_ARCHIVE):
        raw = read_safe(args.artifact_dir, name, 12_000_000)
        require(artifact_files.get(name) == raw, 'gh download differs from pinned artifact: ' + name)
        evidence[name] = raw
    require(sha(evidence[CANDIDATE_ARCHIVE]) == PRODUCT_SHA, 'QA product ZIP mismatch')
    verify_evidence(evidence)
    source = {name: git_bytes(args.source, SOURCE_SHA, name) for name in SOURCE_FILES}
    require(sha(source[OFFICIAL_ARCHIVE]) == OFFICIAL_SHA, 'Official frontend input mismatch')
    published = {name: git_bytes(args.published, PUBLISHED_SHA, name) for name in (
        PUBLISHED_ARCHIVE, '.github/workflows/pages.yml', 'release-ci/release_guard.py', 'release-ci/test_release_guard.py')}
    require(published[PUBLISHED_ARCHIVE] == evidence[CANDIDATE_ARCHIVE], 'Published ZIP differs from final QA')
    require(published['.github/workflows/pages.yml'].decode().count(PAGES_STEP) == 1, 'Published QA stage mismatch')
    readme = read_safe(args.readme.parent, args.readme.name, 100_000)
    require(len(readme) > 300 and PRODUCT_SHA in readme.decode(), 'Release README lacks final product identity')
    require(not re.search(r'【待回填|__PUBLISHED|__PAGES_RUN|PUBLIC_[A-Z_]+', readme.decode()), 'Unfilled release README')
    return source, published, evidence, readme, {'qa_run': qa, 'pages_run': pages}


def verify_frontend(frontend, product):
    expected = FRONTEND_FILES | {'vendor/paraformer/' + n for n in MODEL_FILES}
    require(len(expected) == 36 and set(frontend) == expected, 'Full QA tree must contain exactly 36 allowed files')
    require(sha(product) == PRODUCT_SHA, 'Rebuilt frontend ZIP mismatch')
    small = zip_files(product, FRONTEND_FILES)
    require(all(frontend[n] == raw for n, raw in small.items()), 'Staged frontend differs from product ZIP')
    require(sha(frontend['app.js']) == APP_SHA and sha(frontend['static-manifest.json']) == MANIFEST_SHA,
            'App or static manifest identity mismatch')
    for name, (size, pin) in MODEL_FILES.items():
        raw = frontend['vendor/paraformer/' + name]
        require(len(raw) == size and sha(raw) == pin, 'Pinned model member mismatch: ' + name)
    manifest = json.loads(frontend['static-manifest.json'])
    expected_manifest = {'version': VERSION, 'files': {n: sha(b) for n, b in frontend.items() if n != 'static-manifest.json'}}
    require(manifest == expected_manifest, 'Static manifest coverage/version/hash mismatch')


def verify_live(frontend):
    def fetch(name):
        url = PUBLIC_URL + urllib.parse.quote(name, safe='/')
        request = urllib.request.Request(url, headers={'User-Agent': 'R24-Excel-release-kit-verifier'})
        expected = frontend[name]
        with urllib.request.urlopen(request, timeout=120) as response:
            require(response.status == 200 and response.geturl() == url, 'Unexpected live HTTP result: ' + name)
            digest, size = hashlib.sha256(), 0
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                require(size <= len(expected), 'Oversized live resource: ' + name)
                digest.update(chunk)
        require(size == len(expected) and digest.hexdigest() == sha(expected), 'Live resource differs: ' + name)
        return {'path': name, 'http': 200, 'bytes': size, 'sha256': digest.hexdigest()}
    first = fetch('static-manifest.json')
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        rows = list(pool.map(fetch, sorted(set(frontend) - {'static-manifest.json'})))
    require(fetch('static-manifest.json') == first, 'Live manifest changed during verification')
    return {'url': PUBLIC_URL, 'files': sorted([first, *rows], key=lambda r: r['path']),
            'requests': 37, 'manifest_rechecked': True, 'scope': 'HTTP bytes only; not live UI or real phone acceptance'}


def verify_supplied_live(raw, frontend):
    report = json.loads(raw)
    require(report.get('release_commit') == PUBLISHED_SHA and report.get('total') == 352
            and report.get('passed') == 352 and len(report.get('rows', [])) == 352,
            'Full live proof is incomplete, failed, or for another commit')
    require(report.get('base_url') == PUBLIC_URL.removesuffix(ROUTE + '/'), 'Live proof origin mismatch')
    rows = report['rows']
    require(all(r.get('pass') is True and r.get('status') == 200
                and r.get('sha256') == r.get('expected_sha256')
                and re.fullmatch('[0-9a-f]{64}', r.get('sha256', '')) for r in rows),
            'A live proof row failed or has invalid hashes')
    hashes = {r['path']: r['sha256'] for r in rows}
    require(len(hashes) == 352 and sha(json.dumps(hashes, sort_keys=True, separators=(',', ':'),
            ensure_ascii=False).encode()) == LIVE_TREE_SHA, 'Live proof differs from the pinned full 352-file tree')
    selected = {r['path'].removeprefix(ROUTE + '/'): r for r in rows if r['path'].startswith(ROUTE + '/')}
    require(set(selected) == set(frontend) and all(selected[n]['sha256'] == sha(b)
            and selected[n].get('bytes') == len(b) for n, b in frontend.items()), 'Live QA36 bytes differ')


def write_zip(payload, out):
    require('SHA256SUMS' not in payload, 'Checksum file must be generated, never supplied')
    payload = dict(payload)
    payload['SHA256SUMS'] = ''.join(sha(raw) + '  ' + name + '\n' for name, raw in sorted(payload.items())).encode()
    out.mkdir(parents=True, exist_ok=False)
    target = out / ZIP_NAME
    with target.open('xb') as stream, zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name, raw in sorted(payload.items()):
            require(not PurePosixPath(name).is_absolute() and '..' not in PurePosixPath(name).parts, 'Unsafe output name')
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 23, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(info, raw)
    with zipfile.ZipFile(target) as archive:
        require(archive.namelist() == sorted(payload) and archive.testzip() is None, 'Delivery ZIP verification failed')
        require(all(sha(archive.read(n)) == sha(b) for n, b in payload.items()), 'Delivery readback hash mismatch')
    with target.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    (out / 'SHA256SUMS').write_text(digest + '  ' + ZIP_NAME + '\n')
    return {'zip': ZIP_NAME, 'bytes': target.stat().st_size, 'sha256': digest, 'files': len(payload)}


def main():
    parser = argparse.ArgumentParser()
    for name, default in [('source', '_kit/source'), ('published', '_kit/published'),
                          ('artifact-dir', '_kit/qa-artifact'), ('artifact-zip', '_kit/qa-artifact.zip'),
                          ('metadata', '_kit/meta'), ('rebuild', '_kit/rebuild'), ('out', 'dist'),
                          ('live-proof', 'evidence/r24-excel-public-352.json'),
                          ('readme', 'README_RELEASE.md'), ('workflow', '.github/workflows/r24-excel-qa-release-kit.yml')]:
        parser.add_argument('--' + name, type=Path, default=Path(default))
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    source, published, evidence, readme, runs = preflight(args)
    if args.verify_only:
        print('RELEASE_KIT_PREFLIGHT_PASS: fixed commits, successful runs, exact artifact and approved README')
        return
    product = read_safe(args.rebuild, CANDIDATE_ARCHIVE)
    require(product == published[PUBLISHED_ARCHIVE], 'Rebuild differs from published and tested product')
    route = args.rebuild / 'site' / ROUTE
    require(route.is_dir() and not route.is_symlink(), 'Missing full QA route')
    require(not any(p.is_symlink() for p in route.rglob('*')), 'Symlink in full QA route')
    frontend = {p.relative_to(route).as_posix(): read_safe(route, p.relative_to(route).as_posix())
                for p in route.rglob('*') if p.is_file()}
    verify_frontend(frontend, product)
    official = zip_files(source[OFFICIAL_ARCHIVE])
    for name in ('index.html', 'style.css', 'training-boards.json', 'legacy-65.json'):
        require(frontend[name] == official[name], 'Preserved UI/question file differs: ' + name)
    if args.live_proof.exists():
        live_raw = read_safe(args.live_proof.parent, args.live_proof.name, 2_000_000)
        verify_supplied_live(live_raw, frontend)
        live_name = 'evidence/live-pages-352.json'
    else:
        live_raw, live_name = encoded(verify_live(frontend)), 'evidence/live-qa-hashes.json'
    payload = {'frontend/' + ROUTE + '/' + n: b for n, b in frontend.items()}
    payload.update({'source/' + n: b for n, b in source.items()})
    payload.update({'release-policy/' + n: b for n, b in published.items()})
    payload.update({'evidence/final-run/' + n: evidence[n] for n in EVIDENCE_FILES})
    payload[live_name] = live_raw
    payload['README_RELEASE.md'] = readme
    payload['tools/build_release_kit.py'] = Path(__file__).read_bytes()
    payload['tools/release-kit-workflow.yml'] = read_safe(args.workflow.parent, args.workflow.name)
    payload['RELEASE_IDENTITY.json'] = encoded({
        'repository': REPO, 'source_sha': SOURCE_SHA, 'published_sha': PUBLISHED_SHA,
        'qa_run': QA_RUN, 'pages_run': PAGES_RUN, 'artifact_id': ARTIFACT_ID, 'artifact_sha256': ARTIFACT_SHA,
        'product_zip_sha256': PRODUCT_SHA, 'app_sha256': APP_SHA, 'static_manifest_sha256': MANIFEST_SHA,
        'official_input_sha256': OFFICIAL_SHA, 'model_archive_sha256': MODEL_SHA,
        'route': ROUTE, 'version': VERSION, 'tag': TAG, 'frontend_files': 36,
        'tests': {'node': 78, 'patcher': 9, 'ui': 54, 'real_model': 13}, 'successful_runs': runs,
        'excluded': ['old sites', 'historical source README/reports', 'screenshots', 'audio/video', 'user data', 'credentials'],
        'not_run': ['real business Excel', 'physical iPhone/Android', 'real mainland network', 'real TCL speech'],
        'backend': 'local IndexedDB and manual JSON exchange; no new authentication or automatic cloud delivery',
        'packaging': 'sorted ZIP_STORED entries, fixed 2026-11-23 UTC metadata; SHA256SUMS excludes itself',
    })
    payload['ROLLBACK.md'] = ('''# 独立 QA 回滚

通过新 PR，只删除 `experiments/r24-paraformer-excel-release/site-only.zip`，并从
`.github/workflows/pages.yml` 删除以下唯一 staging 步骤，运行精确反向门禁后合并。
不还原整份旧工作流，不覆盖原 R24/R25 或其他站点，不清理浏览器数据。
GitHub prerelease 交付资产独立保留，不能把删除资产当成网站回滚。

```yaml
''' + PAGES_STEP + '```\n\n发布基准：`' + PUBLISHED_SHA + '`；源码及门禁原件见包内 source/ 与 release-policy/。\n').encode()
    print(json.dumps(write_zip(payload, args.out), ensure_ascii=False, sort_keys=True))


if __name__ == '__main__':
    main()
