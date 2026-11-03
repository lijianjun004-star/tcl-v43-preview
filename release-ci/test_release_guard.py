#!/usr/bin/env python3
"""Bounded ZIP and PR policy regressions. Stdlib only, no network."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest
import zipfile
import zlib

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('gate', HERE/'release_guard.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def archive(self, name='sample.zip', payload=b'hello', method=zipfile.ZIP_DEFLATED):
        p = self.root/name
        with zipfile.ZipFile(p, 'w', method) as z:
            z.writestr('sample.txt', payload)
        return p

    def test_valid_deflate(self):
        self.assertEqual(gate.inspect_zip(self.archive())[1]['sample.txt'], b'hello')

    def test_valid_stored(self):
        self.assertEqual(gate.inspect_zip(self.archive(method=zipfile.ZIP_STORED))[1]['sample.txt'], b'hello')

    def test_actual_output_bound(self):
        # Small fixture validates actual size without allocating a large archive.
        p = self.archive(payload=b'x'*65536)
        raw = bytearray(p.read_bytes())
        central = raw.index(b'PK\x01\x02')
        for start, crc_offset, size_offset in [(0,14,22),(central,16,24)]:
            struct.pack_into('<I',raw,start+crc_offset,zlib.crc32(b'x'))
            struct.pack_into('<I',raw,start+size_offset,1)
        p.write_bytes(raw)
        with self.assertRaisesRegex(gate.GateFailure, 'Actual decompressed output exceeds'):
            gate.inspect_zip(p)

    def test_local_header_mismatch(self):
        p=self.archive(); raw=bytearray(p.read_bytes()); struct.pack_into('<I',raw,22,2);p.write_bytes(raw)
        with self.assertRaisesRegex(gate.GateFailure,'local/central'):
            gate.inspect_zip(p)

    def test_crc_mismatch(self):
        p=self.archive(method=zipfile.ZIP_STORED); raw=bytearray(p.read_bytes());raw[40]^=1;p.write_bytes(raw)
        with self.assertRaisesRegex(gate.GateFailure,'CRC mismatch'):
            gate.inspect_zip(p)

    def test_traversal(self):
        p=self.root/'unsafe.zip'
        with zipfile.ZipFile(p,'w') as z:z.writestr('../outside','x')
        with self.assertRaises(gate.GateFailure):gate.inspect_zip(p)

    def test_limit(self):
        old=gate.MAX_SINGLE_FILE_BYTES
        try:
            gate.MAX_SINGLE_FILE_BYTES=8
            with self.assertRaises(gate.GateFailure):gate.inspect_zip(self.archive(payload=b'x'*9))
        finally:gate.MAX_SINGLE_FILE_BYTES=old

    def test_pr_policy(self):
        repo=self.root/'repo';repo.mkdir()
        def git(*args):
            return subprocess.check_output(['git',*args],cwd=repo,text=True,stderr=subprocess.DEVNULL).strip()
        git('init','-q','-b','main');git('config','user.name','Local QA');git('config','user.email','qa@example.invalid')
        (repo/'release-ci').mkdir();(repo/'.github/workflows').mkdir(parents=True)
        shutil.copy(HERE/'release_guard.py',repo/'release-ci/release_guard.py')
        shutil.copy(__file__,repo/'release-ci/test_release_guard.py')
        (repo/'.github/workflows/verify-pages-pr.yml').write_text('name: QA\n')
        def bundle(mark):
            prefix='tcl-v09-ab/'
            files={'index.html':b'old root',**{f'root-{i}.txt':b'old' for i in range(42)}}
            files.update({prefix+'index.html':mark,prefix+'asr-check.html':b'diagnostic',prefix+'设备检查.html':b'device',prefix+'src/offline-asr-worker.js':b'worker'})
            manifest={n[len(prefix):]:hashlib.sha256(v).hexdigest() for n,v in files.items() if n.startswith(prefix)}
            files[prefix+'static-manifest.json']=json.dumps({'files':manifest,'version':'QA'}).encode()
            with zipfile.ZipFile(repo/'site.zip','w',zipfile.ZIP_DEFLATED) as z:
                for n,v in files.items():z.writestr(n,v)
            sha=hashlib.sha256((repo/'site.zip').read_bytes()).hexdigest()
            (repo/'.github/workflows/pages.yml').write_text(f'run: echo "{sha}  site.zip" | sha256sum --check --strict\n')
        bundle(b'base');(repo/'README.md').write_text('base')
        git('add','.');git('commit','-qm','base');base=git('rev-parse','HEAD')
        def policy():
            git('add','.');git('commit','-qm','candidate')
            return subprocess.run([os.sys.executable,str(HERE/'release_guard.py'),'--verify-pr',base,git('rev-parse','HEAD')],cwd=repo,text=True,capture_output=True)
        (repo/'README.md').write_text('documentation');r=policy();self.assertEqual(r.returncode,0,r.stderr)
        git('reset','--hard',base);bundle(b'new');r=policy();self.assertEqual(r.returncode,0,r.stderr)
        (repo/'README.md').write_text('mixed');r=policy();self.assertNotEqual(r.returncode,0)
        git('reset','--hard',base);(repo/'unknown.txt').write_text('unrelated');r=policy();self.assertNotEqual(r.returncode,0)
        git('reset','--hard',base);bundle(b'new');p=repo/'.github/workflows/pages.yml';p.write_text(p.read_text()+'# unrelated workflow edit\n');r=policy();self.assertNotEqual(r.returncode,0)


if __name__=='__main__':
    unittest.main(verbosity=2)
