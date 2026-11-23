#!/usr/bin/env python3
"""Deterministic, SHA-pinned QA2 full and mobile-lite review ZIPs.
Only synthetic QA evidence; no user media, secrets, private Excel, or claims of cloud sync.
"""
from __future__ import annotations
from pathlib import Path, PurePosixPath
import hashlib
import io
import json
import re
import stat
import zipfile

REPO = 'lijianjun004-star/tcl-v43-preview'
ROUTE = 'tcl-r24-paraformer-excel-qa'
VERSION = 'r24-paraformer-excel-assignment-20261123-qa2-operator-search'
FRONT_SHA = 'a99012ad503baedd404a1c8ed6e4ffb304a07372e6641ec9367a42343035a9d6'
PREVIOUS_SHA = '29c2ac4c491b54c467aa31fcdfa68c0b882dbaf227b5869d977c81b11737396c'
PREVIOUS_KIT_SHA = '30233880a3d03fb9c6b8c260c4bada17d706b6465ca4911fa543af97a133db2a'
APP_SHA = '8af5310dbe54250c6a19dbe25f00cfc0d103a4b29fe0242bf2995522cd3f82f9'
MODULE_SHA = 'e7bb2a73a2e63b35e687d7a0e4c3d4e996f0dd5330e312d055cbe79e373763af'
SOURCE_SHA = '33fdfa6298bba31cba2b98f5e12231acd0d09718'
PAGES_SHA = 'ac64863acdb3238ee2efaa3765c14b24659b9e43'
DOC_SHA = '9e1c287a3f9737e34c066c5fe708c1dfe9d78bab'
MODEL_PINS = {
 'sherpa-onnx-asr.js': (41274, 'ab619fbad082d474ef35616072d3ace7e8f533d3725c611c1c60d7b97cac41c9'),
 'sherpa-onnx-wasm-main-vad-asr.js': (95311, '3e0cbcad90833164f04097e51fbc99b8812dc03977382578fb73eba7f5d13ec4'),
 'sherpa-onnx-wasm-main-vad-asr.wasm': (11539169, '2fc8dc389b23ad07f0d526b2e7c7c828543956d053db858d73cff192be7589e3'),
 'sherpa-onnx-wasm-main-vad-asr.data': (82547881, '9b89b7afaf5375704e758e85e88955abab381f81c466b24ecc7320b24d81b80f'),
}
RUNS = {
 'qa2-full-browser-and-model': (45141448081, SOURCE_SHA),
 'qa2-fast-tests': (45141447932, SOURCE_SHA),
 'qa2-release-gate': (45142668104, '1d26fb5b0d3c25068effe6fd51a227207846a3af'),
 'qa2-pages-deployment': (45142722021, PAGES_SHA),
 'qa2-public-eight-hashes': (45142987868, '62e8df2830cc601058defd242060ef742fd973f5'),
 'qa2-final-doc-pages': (45143395686, DOC_SHA),
}
SOURCE_FILES = (
 'assignment-excel.mjs',
 'tools/apply_to_r24.py',
 'tools/build_from_official_r24.py',
 'tools/prepare_browser_site.py',
 'tests/assignment-excel.test.mjs',
 'tests/ui-lifecycle.test.mjs',
 'tests/test_patcher.py',
 'tests/browser_assignment_e2e.py',
 'tests/browser_real_model.py',
)
EVIDENCE_FILES = (
 'node-tests.log', 'patcher-tests.log',
 'browser-assignment-result.json', 'browser-real-model-result.json',
 'built-site-hashes.json', 'public-speech-source.json',
 'assignment.json', 'receipt-text.json', 'receipt-media.json',
 'receipt-after-refresh.json', 'receipt-wrong-version.json',
 'http-server.log', 'http-model-server.log',
 'fixtures/three_questions.xlsx', 'fixtures/three_questions.xls',
 'fixtures/missing_question.xlsx',
)
CHANGED = {'app.js', 'assignment-excel.mjs', 'static-manifest.json'}
OUTPUT_FULL = 'TCL_R24_Excel_QA2_Gemini_Claude_Review_FULL_20261123.zip'
OUTPUT_LITE = 'TCL_R24_Excel_QA2_Gemini_Claude_Review_LITE_20261123.zip'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def demand(condition, reason):
    if not condition:
        raise ValueError(reason)


def jsonbytes(data):
    return (json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + '\n').encode('utf-8')


def safe_read(path, limit=120_000_000):
    path = Path(path)
    demand(path.is_file() and not path.is_symlink() and path.stat().st_size <= limit, 'Missing or oversized file ' + str(path))
    return path.read_bytes()


def safe_zip(data):
    found = {}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        demand(z.testzip() is None, 'Corrupt ZIP')
        for item in z.infolist():
            if item.is_dir():
                continue
            name = PurePosixPath(item.filename)
            demand(not name.is_absolute() and '..' not in name.parts and '\\' not in item.filename
                   and item.filename not in found and not stat.S_ISLNK(item.external_attr >> 16)
                   and item.file_size <= 115_000_000 and not (item.flag_bits & 1),
                   'Invalid ZIP member ' + item.filename)
            found[item.filename] = z.read(item)
    return found


def run_metadata():
    result = {}
    for name, (run_id, expected_sha) in RUNS.items():
        data = json.loads(safe_read(Path('meta') / (name + '.json'), 200_000))
        demand(data['id'] == run_id and data['head_sha'] == expected_sha
               and data['status'] == 'completed' and data['conclusion'] == 'success'
               and data['repository']['full_name'] == REPO, 'Run identity/status mismatch ' + name)
        result[name] = {'id': run_id, 'head_sha': expected_sha, 'url': data['html_url'],
                        'status': data['status'], 'conclusion': data['conclusion']}
    return result


def test_evidence():
    root = Path('qa2-artifact/evidence')
    node = safe_read(root / 'node-tests.log').decode('utf-8')
    for key, value in [('tests', 80), ('pass', 80), ('fail', 0), ('cancelled', 0), ('skipped', 0)]:
        demand(re.search(r'(?m)^(?:ℹ |# )?' + key + r'\s+' + str(value) + r'\s*$', node),
               'Node tests mismatch ' + key)
    patcher = safe_read(root / 'patcher-tests.log').decode('utf-8')
    demand(re.search(r'Ran 10 tests in ', patcher) and patcher.rstrip().endswith('OK'),
           'Patcher 10/10 mismatch')
    for filename, count in [('browser-assignment-result.json', 57), ('browser-real-model-result.json', 13)]:
        data = json.loads(safe_read(root / filename))
        demand(data.get('passed') == count and data.get('failure') is None
               and len(data.get('checks', [])) == count
               and all(test.get('pass') is True for test in data['checks']),
               'Browser/model checks mismatch ' + filename)
    return {'node': 80, 'patcher': 10, 'chromium': 57, 'real_paraformer': 13}


def review_notes():
    return """# TCL 智能练播房 R24 Excel QA2｜Gemini / Claude 独立复验任务

**本包是 QA2（主播按运营姓名搜索、自主领取），不是历史 QA1。**
固定测试站：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-r24-paraformer-excel-qa/
线上版本：r24-paraformer-excel-assignment-20261123-qa2-operator-search

## 复验步骤

1. **校验交付包**：在 ZIP 内使用 SHA256SUMS 校验所有源文件；顶层另有交付 ZIP 的 SHA256SUMS。对照 RELEASE_IDENTITY.json、QA2 发行 ZIP 的固定 SHA256 和源码冻结提交。
2. **对照冻结版本**：应存在 frontend/tcl-r24-paraformer-excel-qa/ 的 36 个文件（32 前端 + 4 Paraformer 固定模型）。其中 index.html、style.css、training-boards.json、legacy-65.json 与旧正式 pages3 字节不变，只有 app.js、assignment-excel.mjs、static-manifest.json 与 QA1 不同。
3. **运营发布**：用任意运营姓名进入运营页，创建作业、上传 XLSX/XLS、检查预览和固定题目快照。**没有必填主播名单**。重复题、空答案、不匹配品类/平台要拦截；Excel 作业不能污染公共题库。
4. **主播自主领取**：新主播 A 与 B 用不同姓名，在收到同一 JSON 并分别导入后，都可以按运营姓名搜索并领取。公开作业 assignedTo 是空数组，身份不是预选白名单；**旧的明确名单作业继续受限**。
5. **逐题和回执**：验证 Excel 原题按顺序变为弹幕、逐题录音/转写/编辑/完整提交。漏答、空答、混题、换型号/SKU、篡改快照或同场冲突回执均不能通过。运营导入新主播提交回执应能显示该主播，并标记“回执待核实”。
6. **旧站隔离**：正式 R24、R25、历史 Pages、旧本地 IndexedDB 和固定公开题库不受影响；检查静态 manifest、缓存、媒体录制停止与回放。
7. **核实真实范围**：evidence/ 中为 GitHub Actions 自动实测；Chromium 使用合成 XLSX/XLS、合成摄像头和话筒，业务流 ASR 使用测试替身；独立模型测试使用真实 Paraformer Worker/WASM 和公开中文短音频。
8. **未通过一律如实报告**：真实 TCL Excel、物理 iPhone/Android、中国大陆网络、真实 TCL 语音识别准确率均未验收。不要把浏览器本地 IndexedDB + 人工传 JSON 称为已实现跨手机自动搜索或实时运营后台。

## 交付要求

请输出 P0/P1/P2 问题清单，逐项列出处、复现步骤、实际结果、预期结果；
核对 80/80 Node、10/10 patcher、57/57 Chromium、13/13 真实 Paraformer 证据及对应 SHA。
如果没有执行真实手机、真实 Excel 或共享后台验收，写 NOT RUN，严禁推测 PASS。
给出继续改进建议，保持 PR + 复验 + 安全发布流程；不得直接改正式站。

## 结构说明

- frontend/：QA2 完整可独立预览的静态站（FULL 包包含已发布的四个 Paraformer 模型文件）。
- source/：冻结 QA2 业务代码、自动化测试、构建工具及原正式 R24 输入包。
- release/：QA1 和 QA2 两版的小型前端 ZIP（用于 SHA 和三文件精确差分/回滚）。
- release-policy/：当前 GitHub Pages 发布及严格 QA1/QA2 门禁代码。
- evidence/：GitHub Actions 合成样本、测试日志、运行状态、真实公网验证日志。
- SHA256SUMS、RELEASE_IDENTITY.json：完整性校验、固定版本、已执行/未执行范围。

**重要：** LITE 包不含大型模型文件，只用于源码和业务逻辑复验，不能据此判断实际 Paraformer 模型文件/独立全站离线运行正常。FULL 包才包含全部 36 个前端及模型文件。
""".encode('utf-8')


def make_zip(payload, target):
    names = sorted(payload)
    demand('SHA256SUMS' not in names, 'Checksum duplication')
    checks = ''.join(sha(payload[n]) + '  ' + n + '\n' for n in names).encode()
    payload = {**payload, 'SHA256SUMS': checks}
    with zipfile.ZipFile(target, mode='x', compression=zipfile.ZIP_STORED, allowZip64=True) as z:
        for name, data in sorted(payload.items()):
            p = PurePosixPath(name)
            demand(not p.is_absolute() and '..' not in p.parts, 'Unsafe package path')
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 23, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_STORED
            z.writestr(info, data)
    raw = safe_read(target)
    verified = safe_zip(raw)
    demand(verified == payload, 'Review package ZIP readback mismatch')
    return {'asset': target.name, 'files': len(payload), 'bytes': len(raw), 'sha256': sha(raw)}


def main():
    previous_package = safe_read('qa1_kit/R24_Excel_QA_20261123.zip')
    demand(sha(previous_package) == PREVIOUS_KIT_SHA, 'Historical kit SHA mismatch')
    previous = safe_zip(previous_package)
    prefix = 'frontend/' + ROUTE + '/'
    oldfull = {name.removeprefix(prefix): raw for name, raw in previous.items() if name.startswith(prefix)}
    demand(len(oldfull) == 36, 'Historical QA1 full frontend must have 36 exact assets')
    raw = safe_read('experiments/r24-paraformer-excel-release/site-only.zip', 1_500_000)
    demand(sha(raw) == FRONT_SHA, 'QA2 frontend pin mismatch')
    small = safe_zip(raw)
    prev_raw = previous['release-policy/experiments/r24-paraformer-excel-release/site-only.zip']
    demand(sha(prev_raw) == PREVIOUS_SHA, 'QA1 small ZIP pin mismatch')
    oldsmall = safe_zip(prev_raw)
    demand(set(oldsmall) == set(small) and len(small) == 32, 'QA2 frontend exact 32-file allowlist mismatch')
    demand({n for n in small if small[n] != oldsmall[n]} == CHANGED,
           'QA2 changed more or less than approved app/module/manifest')
    demand(all(oldfull[n] == oldsmall[n] for n in oldsmall), 'QA1 package files disagree with QA1 source')
    model = {'vendor/paraformer/' + name: oldfull['vendor/paraformer/' + name] for name in MODEL_PINS}
    for name, (size, digest) in MODEL_PINS.items():
        data = model['vendor/paraformer/' + name]
        demand(len(data) == size and sha(data) == digest, 'Model SHA/length mismatch: ' + name)
    frontend = {**small, **model}
    demand(len(frontend) == 36 and set(frontend) == set(oldfull), 'QA2 full frontend file coverage mismatch')
    manifest = json.loads(frontend['static-manifest.json'])
    demand(manifest == {'version': VERSION,
                        'files': {name: sha(data) for name, data in frontend.items() if name != 'static-manifest.json'}},
           'QA2 full asset static manifest mismatch')
    demand(sha(frontend['app.js']) == APP_SHA
           and sha(frontend['assignment-excel.mjs']) == MODULE_SHA, 'QA2 script pins mismatch')
    official = safe_zip(safe_read('experiments/r24-paraformer-release/site-only.zip', 2_000_000))
    for name in ('index.html', 'style.css', 'training-boards.json', 'legacy-65.json'):
        demand(frontend[name] == oldfull[name] == official[name], 'Historical UI or question file changed: ' + name)
    source_root = Path('qa2_source/experiments/r24-paraformer-excel-assignment')
    demand(sha(safe_read(source_root / 'assignment-excel.mjs')) == MODULE_SHA, 'QA2 source module mismatch')
    from importlib.util import module_from_spec, spec_from_file_location
    spec = spec_from_file_location('gate', 'release-ci/release_guard.py')
    gate = module_from_spec(spec)
    spec.loader.exec_module(gate)
    demand(gate.verify_r24_pf_excel_archive_update(prev_raw, raw) == CHANGED,
           'Current main release policy does not approve exact QA2 upgrade')
    tests = test_evidence()
    runs = run_metadata()
    core = {
      'README-给Gemini和Claude的复验任务.md': review_notes(),
      'release/QA1-site-only-rollback.zip': prev_raw,
      'release/QA2-site-only.zip': raw,
      'release-policy/.github/workflows/pages.yml': safe_read('.github/workflows/pages.yml'),
      'release-policy/release-ci/release_guard.py': safe_read('release-ci/release_guard.py'),
      'release-policy/release-ci/test_release_guard.py': safe_read('release-ci/test_release_guard.py'),
      'handoff/QA2-current-README.md': safe_read('experiments/r24-paraformer-excel-release/README.md'),
      'handoff/AI_CONTEXT.md': safe_read('AI_CONTEXT.md'),
      'source/experiments/r24-paraformer-release/site-only.zip':
          safe_read('experiments/r24-paraformer-release/site-only.zip', 2_000_000),
      'source/.github/workflows/r24-excel-assignment-qa.yml':
          safe_read('qa2_source/.github/workflows/r24-excel-assignment-qa.yml'),
      'tools/build_qa2_review.py': safe_read(__file__),
      'evidence/fast-test-run.log': safe_read('meta/fast-run.log', 2_000_000),
      'evidence/public-pages-eight-sha-run.log': safe_read('meta/public-run.log', 2_000_000),
      'evidence/qa2-pages-deploy-run.log': safe_read('meta/pages-run.log', 2_000_000),
      'evidence/qa2-browser-run-summary.json': jsonbytes(runs['qa2-full-browser-and-model']),
      'evidence/qa2-fast-run-summary.json': jsonbytes(runs['qa2-fast-tests']),
      'evidence/qa2-pages-run-summary.json': jsonbytes(runs['qa2-pages-deployment']),
      'evidence/qa2-http-run-summary.json': jsonbytes(runs['qa2-public-eight-hashes']),
      'evidence/qa2-gate-run-summary.json': jsonbytes(runs['qa2-release-gate']),
    }
    for name in SOURCE_FILES:
        core['source/experiments/r24-paraformer-excel-assignment/' + name] = safe_read(source_root / name)
    for name in EVIDENCE_FILES:
        path = Path('qa2-artifact/evidence') / name
        demand(path.is_file(), 'Missing QA2 test artifact member ' + name)
        core['evidence/qa2-tested/' + name] = safe_read(path, 15_000_000)
    core['evidence/qa2-tested/BUILD_RESULT.json'] = safe_read('qa2-artifact/build/BUILD_RESULT.json')
    source_matches = safe_zip(safe_read('qa2-artifact/build/R24_Excel_Assignment_Only_Offline_Candidate.zip', 1_500_000))
    demand(source_matches == small, 'Actions test candidate differs from published QA2 site-only.zip')
    identity = {'repository': REPO, 'route': ROUTE, 'version': VERSION,
                'source_sha': SOURCE_SHA, 'pages_release_sha': PAGES_SHA,
                'docs_sha': DOC_SHA, 'site_zip_sha256': FRONT_SHA, 'app_sha256': APP_SHA,
                'assignment_module_sha256': MODULE_SHA,
                'old_qa1_site_sha256': PREVIOUS_SHA, 'old_qa1_full_kit_sha256': PREVIOUS_KIT_SHA,
                'changed_from_qa1': sorted(CHANGED),
                'frontend_assets': 36, 'frontend_static_assets': 32, 'model_assets': 4,
                'model_pins': MODEL_PINS, 'tests_passed': tests, 'successful_runs': runs,
                'not_run': ['TCL real company spreadsheet', 'physical iPhone/Android',
                            'mainland China network and human TCL speech accuracy',
                            'authenticated shared backend', 'automatic cross-device homework search/receipt sync'],
                'disclosure': 'Local IndexedDB + manual JSON package/receipt; name and SHA are not real user authentication',
                'packaging': 'Deterministic sorted ZIP_STORED, each member SHA256 in SHA256SUMS, fixed metadata',
                'excluded': ['private Excel', 'credentials', 'user media recordings',
                             'full browser screenshots', 'full QA1 package duplicate'],
               }
    core['RELEASE_IDENTITY.json'] = jsonbytes(identity)
    out = Path('dist')
    out.mkdir(exist_ok=False)
    with_full = {**core, **{'frontend/' + ROUTE + '/' + name: data for name, data in frontend.items()}}
    lite_front = {name: data for name, data in frontend.items() if name not in model}
    without_model = {**core, **{'frontend/' + ROUTE + '/' + name: data for name, data in lite_front.items()}}
    full_result = make_zip(with_full, out / OUTPUT_FULL)
    lite_result = make_zip(without_model, out / OUTPUT_LITE)
    (out / 'SHA256SUMS').write_text(
        ''.join(obj['sha256'] + '  ' + obj['asset'] + '\n' for obj in (full_result, lite_result)), encoding='utf-8')
    (out / 'PACKAGING_RESULT.json').write_bytes(jsonbytes(
        {'full': full_result, 'lite': lite_result, 'identity': identity,
         'tests': tests, 'runs': runs, 'deployment': 'already deployed; packaging does not change Pages'}))
    print(json.dumps({'full': full_result, 'lite': lite_result, 'tests': tests,
                      'status': 'QA2 review kits verified; no main branch mutations'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
