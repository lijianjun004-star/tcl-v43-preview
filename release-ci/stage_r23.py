#!/usr/bin/env python3
"""R2.3 zero-API isolated, content-addressed staging. Never overwrite released assets."""
import argparse
import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

ARCHIVE_B64_SHA = '3876e40c30ac787f9833338fd4dce5d3df611f6120010174d82d3246e7f802c0'
ARCHIVE_SHA = 'd828fc8f370e6df384e3fd4e3da4702563e13de1d9b69b01b1171926b595fe6c'
DEST = 'tcl-v352-asr-autoqa-r23'
R21_ASR_APP_SHA = '86ca65f2c0f898e0953193c1489ae6221c06aa3dea57b7187113465249d727e4'
ASSET_HASHES = {
 'app-config.json':'52a2881798fa934df390727eb8b71084c1e823bcef164207e6352e486c432511',
 'app.js':'3507523677b209f157449ede0d285a967cb0f7117f807ecc4d7697ac7f3f2add',
 'index.html':'d52e764ca7c20dee5068514f09b66a1954f33ec81c1b8608eeca8a4be97fff21',
 'legacy-65.json':'d122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f',
 'lib/parser.js':'bd41beeece826d58ca8d4b41fee00137227defe9f355a55939db83f947a90f56',
 'lib/pdf.js':'3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b',
 'lib/qa-import.js':'bfe7562e3c2647693ce9d58f87f466acc8459aa06ab4e983115b012d754d155f',
 'lib/xls.js':'11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c',
 'lib/zip.js':'83dd040652016cabd947c0024db8e4f5d1fb7a741dd0956fba86629d551c75b3',
 'r23-model-choice.js':'ee96450cecf959005150df92c5fbbb4dabea4343892fec768d4776eb6f39b2ee',
 'static-manifest.json':'927eeb9b8f8bfb73d42029eb0d0e36fdd1d81093dac95ecd428d5420da3723b2',
 'style.css':'765b66a6116b5356700bff32f0d9a092ed67580810378a1804007fbe05f7bbec',
 'training-boards.json':'e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11',
 'whisper-bridge.mjs':'72df3364031e1c4bc1439ddeb1eb2dac4efaf985fedb00c7c963404fe039c190',
}

def sha(data): return hashlib.sha256(data).hexdigest()

def stage(site_path, archive_path, browser=False):
    site = Path(site_path).resolve()
    archive_b64 = Path(archive_path).read_bytes()
    if sha(archive_b64) != ARCHIVE_B64_SHA:
        raise ValueError('R2.3 exact base64 source digest mismatch')
    source=base64.b64decode(archive_b64.strip(),validate=True)
    if sha(source)!=ARCHIVE_SHA or len(source)>230_000:
        raise ValueError('R2.3 compressed source digest mismatch')
    if sha((site/'tcl-v352-asr-autoqa-r2/app.js').read_bytes())!=R21_ASR_APP_SHA:
        raise ValueError('Approved R2.1 pre-deploy baseline absent or altered')
    output=site/DEST
    if output.exists():raise ValueError('R2.3 path already exists: refuse overwrite')
    before={p.relative_to(site).as_posix():sha(p.read_bytes()) for p in site.rglob('*') if p.is_file()}
    with tarfile.open(fileobj=io.BytesIO(source), mode='r:gz') as tf:
        items=tf.getmembers()
        allowed={f'{DEST}/{x}' for x in ASSET_HASHES}
        if len(items)!=len(allowed) or {m.name for m in items}!=allowed:
            raise ValueError('Unexpected R2.3 member names or count')
        for entry in items:
            if not entry.isfile() or entry.size<1 or entry.size>400_000:
                raise ValueError('Unexpected R2.3 file type or size')
            relative=entry.name[len(DEST)+1:]
            data=tf.extractfile(entry).read()
            if len(data)!=entry.size or sha(data)!=ASSET_HASHES[relative]:
                raise ValueError('Unexpected static resource content: '+entry.name)
            dest=site/entry.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
    manifest=json.loads((output/'static-manifest.json').read_text(encoding='utf-8'))
    if manifest.get('files')!={name:sha((output/name).read_bytes()) for name in ASSET_HASHES if name!='static-manifest.json'}:
        raise ValueError('Manifest resources and SHA digests inconsistent')
    # The older routes must remain byte-for-byte untouched.
    for name,digest in before.items():
        if sha((site/name).read_bytes())!=digest:
            raise ValueError('Protected Pages resource was modified: '+name)
    if len([p for p in output.rglob('*') if p.is_file()])!=14:
        raise ValueError('Unexpected R2.3 file count')
    for js in ('app.js','whisper-bridge.mjs','r23-model-choice.js'):
        subprocess.run(['node','--input-type=module','--check'],input=(output/js).read_text(encoding='utf-8'),text=True,check=True,timeout=30)
    if browser:
        if importlib.util.find_spec('playwright') is None:
            subprocess.run([sys.executable,'-m','pip','install','--disable-pip-version-check',
                            'playwright==1.56.0'],check=True,timeout=180)
        if not any(Path(path).is_file() for path in
                   ('/usr/bin/google-chrome','/usr/bin/chromium','/opt/google/chrome/chrome')):
            subprocess.run([sys.executable,'-m','playwright','install','chromium'],check=True,timeout=240)
        with tempfile.TemporaryDirectory() as t:
            report=Path(t)/'browser_r23_result.json'
            env={**os.environ,'R23_SITE_ROOT':str(site),'R23_BROWSER_REPORT':str(report)}
            script=Path(__file__).with_name('r23_browser_e2e.py').resolve()
            subprocess.run([sys.executable,str(script)],check=True,env=env,timeout=200)
            data=json.loads(report.read_text())
            if not data.get('ok') or len(data.get('inspect',{}).get('calls',[]))<3:
                raise ValueError('Chromium 3-turn mock workflow did not pass')
            print('R23_BROWSER_E2E_PASS (recorded synthetic microphone; model output MOCKED)')
    print('R23_STAGE_PASS',json.dumps({'files':len(ASSET_HASHES),'old_assets_unchanged':len(before),'app_sha':ASSET_HASHES['app.js'],'browser_mock_e2e':browser}))
    return True

if __name__=='__main__':
    pa=argparse.ArgumentParser();pa.add_argument('--site-dir',required=True);pa.add_argument('--archive',required=True);pa.add_argument('--browser',action='store_true');arg=pa.parse_args()
    stage(arg.site_dir,arg.archive,arg.browser)