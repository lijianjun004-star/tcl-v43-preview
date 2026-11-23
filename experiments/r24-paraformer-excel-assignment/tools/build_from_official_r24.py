#!/usr/bin/env python3
"""Codex offline build for the exact R24 Paraformer pages3 frontend package.

DO NOT RUN AGAINST UNCHECKED BRANCH CONTENT. Offline only, no deployment. The
official same-path release lives under `experiments/r24-paraformer-release/`.
"""
from __future__ import annotations
import argparse, hashlib, io, json, pathlib, stat, sys, tempfile, zipfile, subprocess
from apply_to_r24 import build

EXPECTED_ARCHIVE_SHA='dec534aac5467b07fba730e422f14200d26e3293fd1f964bf1c4ff88d8f33fa5'
EXPECTED_APP_SHA='37eb6128081571861c712c9c1e5d07c75fb498d08091e8f2ee94a48c00ef19ec'
R24_HISTORICAL_SHA='8c569a3f9b2adee09cc6ca668b121ab2390321eb76ad5e12c011acc7b3778b1a'

def digest(raw): return hashlib.sha256(raw).hexdigest()

def unzip_verified(file,dir):
    dir=pathlib.Path(dir)
    with zipfile.ZipFile(file) as z:
        records=z.infolist()
        if not 10<=len(records)<=75: raise ValueError('Unexpected R24 file count')
        if z.testzip(): raise ValueError('ZIP CRC failure')
        total=0
        for e in records:
            name=pathlib.PurePosixPath(e.filename)
            if e.is_dir():continue
            if name.is_absolute() or '..' in name.parts or '\\' in e.filename or len(name.parts)>8:
                raise ValueError('Invalid archive path: '+e.filename)
            if stat.S_ISLNK((e.external_attr >>16)&0xffff):raise ValueError('Symlink not permitted')
            if e.file_size>2_000_000:raise ValueError('Large unexpected member: '+e.filename)
            total+=e.file_size
            if total>12_000_000:raise ValueError('Oversized frontend bundle')
            dest=dir.joinpath(*name.parts);dest.parent.mkdir(parents=True,exist_ok=True)
            dest.write_bytes(z.read(e))

def run(package,target,allow_historical=False):
    package=pathlib.Path(package)
    sha=digest(package.read_bytes())
    expected=R24_HISTORICAL_SHA if allow_historical else EXPECTED_ARCHIVE_SHA
    if sha!=expected:
        raise ValueError(f'R24 archive SHA does not match pinned {"historical" if allow_historical else "Paraformer pages3"} input: actual={sha}, expected={expected}')
    target=pathlib.Path(target);target.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        root=pathlib.Path(tmp)
        unzip_verified(package,root)
        source_app=list(root.rglob('app.js'))
        if len(source_app)!=1:raise ValueError('Cannot isolate exactly one R24 app.js')
        app_sha=digest(source_app[0].read_bytes())
        if app_sha!=("63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816" if allow_historical else EXPECTED_APP_SHA):
            raise ValueError('Unexpected R24 app version. Do not mix features from newer/older UI.')
        build(source_app[0].parent,target/'frontend')
        target_dir=target/'frontend'/source_app[0].parent.name
        with zipfile.ZipFile(target/'R24_Excel_Assignment_Only_Offline_Candidate.zip','w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
            for p in sorted(target_dir.rglob('*')):
                if p.is_file():z.write(p,p.relative_to(target/'frontend').as_posix())
        script=target_dir/'app.js'
        subprocess.run(['node','--input-type=module','--check'],input=script.read_text(),text=True,check=True,timeout=12)
        subprocess.run(['node','--check',str(target_dir/'assignment-excel.mjs')],check=True,timeout=12)
        evidence={
          'type':'offline_candidate_not_production',
          'source_sha256':sha,'source_app_sha256':app_sha,
          'candidate_zip_sha256':digest((target/'R24_Excel_Assignment_Only_Offline_Candidate.zip').read_bytes()),
          'preserved_ui':True,'preserved_stylesheet':True,'preserved_model_assets':True,
          'asr_business_code_changed':False,'shared_cloud_backend':False,
          'cross_device_delivery':'manual JSON package/receipt, not automatic cloud delivery',
          'built_site':target_dir.name
        }
        (target/'BUILD_RESULT.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        return evidence

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('zip');a.add_argument('--out',default='r24-excel-build');a.add_argument('--historical-proof',action='store_true',help='Only for testing prior R24 review-stability archive; not for Paraformer release')
    p=a.parse_args();print(json.dumps(run(p.zip,p.out,p.historical_proof),ensure_ascii=False,indent=2))