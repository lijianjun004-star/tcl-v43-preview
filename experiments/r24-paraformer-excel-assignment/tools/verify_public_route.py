#!/usr/bin/env python3
"""Verify a public copy of the pinned R24 Excel QA3 route, file by file.

Standard library only. Read-only: it downloads every file listed in the route's
static-manifest.json and compares SHA-256 values; it never uploads or deletes.

    python3 -I verify_public_route.py https://<host>/tcl-r24-paraformer-excel-qa/

Exit 0 only if the manifest is the pinned QA3 manifest and all 36 files match.
"""
import hashlib
import json
import sys
import time
import urllib.request

QA3_VERSION = 'r24-paraformer-excel-assignment-20261123-qa3-review-fixes'
PINS = {
    'static-manifest.json': 'ce897151ee99aeed5b9b946c27119b3a6b9f74ab372903b147b68a7a0e2556e1',
    'app.js': 'd6b9f4891e409f330e928659e2bcde59a398bf3ccef1d088be4af3562a5f478a',
    'assignment-excel.mjs': '9dcbdb352cdaf01d597186a8b3ca9614b9b7c0fcf8b902597737f641216b77da',
    'vendor/paraformer/sherpa-onnx-wasm-main-vad-asr.data': '9b89b7afaf5375704e758e85e88955abab381f81c466b24ecc7320b24d81b80f',
}


def fetch(url, attempts=3):
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url + ('&' if '?' in url else '?') + 'qa3verify=' + str(time.time_ns()),
                                         headers={'User-Agent': 'r24-qa3-public-verify', 'Cache-Control': 'no-cache'})
            with urllib.request.urlopen(req, timeout=180) as response:
                return response.status, response.read()
        except Exception as error:  # report the final failure, keep earlier ones
            last = error
            time.sleep(2 * (i + 1))
    raise RuntimeError(f'{url}: {last}')


def main(base):
    base = base.rstrip('/') + '/'
    status, raw = fetch(base + 'static-manifest.json')
    manifest_sha = hashlib.sha256(raw).hexdigest()
    rows, ok = [], True
    rows.append(('static-manifest.json', status, manifest_sha == PINS['static-manifest.json']))
    manifest = json.loads(raw)
    if manifest.get('version') != QA3_VERSION or len(manifest.get('files', {})) != 35:
        print('FAIL manifest version or entry count:', manifest.get('version'), len(manifest.get('files', {})))
        return 1
    for name, expected in sorted(manifest['files'].items()):
        if name in PINS and PINS[name] != expected:
            print('FAIL manifest pin mismatch:', name)
            return 1
        try:
            status, body = fetch(base + name)
            rows.append((name, status, status == 200 and hashlib.sha256(body).hexdigest() == expected))
        except Exception as error:
            rows.append((name, str(error)[:80], False))
    for name, status, good in rows:
        ok &= good
        if not good:
            print('DIFF', status, name)
    print(json.dumps({'base': base, 'version': manifest['version'], 'files': len(rows),
                      'matched': sum(1 for row in rows if row[2]), 'pass': ok}, ensure_ascii=False))
    return 0 if ok and len(rows) == 36 else 1


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: verify_public_route.py https://<host>/tcl-r24-paraformer-excel-qa/')
    raise SystemExit(main(sys.argv[1]))
