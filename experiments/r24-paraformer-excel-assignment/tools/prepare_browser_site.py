#!/usr/bin/env python3
"""Build the pinned official route and Excel preview for read-only browser QA.

This creates local files only. It never deploys, authenticates a user, or loads
private spreadsheets. The production release gate separately pins the result.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import urllib.request

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))
from build_from_official_r24 import run, TEST_ROUTE
from apply_to_r24 import VERSION


def prepare(out: Path, model: Path):
    spec = importlib.util.spec_from_file_location('release_guard', REPO / 'release-ci/release_guard.py')
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    out = out.resolve()
    model = model.resolve()
    out.mkdir(parents=True, exist_ok=True)
    (out / 'evidence').mkdir(exist_ok=True)
    result = run(REPO / gate.R24_PF_ARCHIVE, out / 'build')
    site = out / 'site'
    site.mkdir(exist_ok=True)
    gate.stage_r24_pf(site, REPO / gate.R24_PF_ARCHIVE, model)
    candidate = out / 'build/R24_Excel_Assignment_Only_Offline_Candidate.zip'

    def frontend(raw):
        if hashlib.sha256(raw).hexdigest() != result['candidate_zip_sha256']:
            raise ValueError('Candidate changed after deterministic build')
        _, files = gate.inspect_zip_bytes_for_autoqa(raw)
        if set(files) != gate.R24_PF_FRONTEND_FILES | {'assignment-excel.mjs'}:
            raise ValueError('Unexpected preview resource')
        pins = {k: hashlib.sha256(v).hexdigest() for k, v in files.items() if k != 'static-manifest.json'}
        pins.update({'vendor/paraformer/' + k: v[1] for k, v in gate.R24_PF_MODEL_FILES.items()})
        manifest = json.loads(files['static-manifest.json'])
        if manifest != {'version': VERSION, 'files': pins}:
            raise ValueError('Preview manifest does not describe exact frontend and model')
        return files

    gate.stage_r24_pf(site, candidate, model, dest=TEST_ROUTE, frontend=frontend)
    hashes = gate.r25_tree_hashes(site)
    (out / 'evidence/built-site-hashes.json').write_text(json.dumps(hashes, indent=2) + '\n')
    sample_url = 'https://isv-data.oss-cn-hangzhou.aliyuncs.com/ics/MaaS/ASR/test_audio/asr_example_zh.wav'
    sample_pin = 'a1bd32dc78493c123f9625a66deee562aed2895f53fbc39f2cca3be7e6f4f20f'
    with urllib.request.urlopen(sample_url, timeout=30) as response:
        sample = response.read(177573)
    if len(sample) != 177572 or hashlib.sha256(sample).hexdigest() != sample_pin:
        raise ValueError('Public Mandarin test recording differs from the pinned sample')
    fixtures = site / 'fixtures'
    fixtures.mkdir(exist_ok=True)
    (fixtures / 'public-mandarin.wav').write_bytes(sample)
    (out / 'evidence/public-speech-source.json').write_text(json.dumps({
        'url': sample_url, 'sha256': sample_pin, 'bytes': len(sample),
        'source_documentation': 'https://github.com/modelscope/FunASR',
        'scope': 'Public example speech, not TCL/private voice. No accuracy claim from one sample.'
    }, indent=2) + '\n')
    print(json.dumps({'official': gate.R24_PF_DEST, 'preview': TEST_ROUTE, 'total_files': len(hashes), 'candidate_sha256': result['candidate_zip_sha256']}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--model', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.out, args.model)
