#!/usr/bin/env python3
"""Bounded ZIP and PR policy regressions. Stdlib only, no network."""
import hashlib
import base64
import importlib.util
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest
from unittest import mock
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

    def test_known_baseline_filename_repair_is_exact_and_byte_preserving(self):
        known = 'f2bae680a6262e41352e53f0f81edb68ad18dfb4769b2690da91e2e37db6e9dd'
        bad = 'tcl-v09-ab/Φ«╛σñçµúÇµƒÑ.html'
        good = 'tcl-v09-ab/设备检查.html'
        original = {bad: b'device-bytes', 'index.html': b'root'}
        repaired, mapping = gate.normalize_known_baseline_names(known, original)
        self.assertEqual(mapping, {bad: good})
        self.assertEqual(repaired[good], b'device-bytes')
        self.assertNotIn(bad, repaired)
        self.assertIn(bad, original)  # helper must not mutate its input

        unchanged, mapping = gate.normalize_known_baseline_names('0' * 64, original)
        self.assertEqual(mapping, {})
        self.assertEqual(unchanged, original)

        with self.assertRaisesRegex(gate.GateFailure, 'source is missing'):
            gate.normalize_known_baseline_names(known, {'index.html': b'root'})
        with self.assertRaisesRegex(gate.GateFailure, 'target already exists'):
            gate.normalize_known_baseline_names(known, {bad: b'a', good: b'b'})


    def test_isolated_mobile_qa_validation_and_browser_namespaces(self):
        import json
        prefix = gate.QA_PREFIX
        paths = {n: (b'qa-file-' + n.encode('utf-8')) for n in gate.SPECIALTY_FILES - {'static-manifest.json'}}
        paths['app.js'] = (
            b"const STORE_NAME='tcl-specialty-v352-mobile-qa';"
            b"new BroadcastChannel('tcl-specialty-v352-mobile-qa-workflow');"
            b"const VOSK_CACHE_NAME='tcl-specialty-v352-mobile-qa-vosk-v1';"
        )
        manifest = {'files': {n: hashlib.sha256(data).hexdigest() for n, data in paths.items()}}
        paths['static-manifest.json'] = json.dumps(manifest).encode('utf-8')
        bundle = {prefix + name: data for name, data in paths.items()}
        self.assertEqual(gate.inspect_isolated_qa(bundle), len(gate.SPECIALTY_FILES))
        self.assertEqual(gate.inspect_isolated_qa({}), 0)
        corrupt = dict(bundle)
        corrupt[prefix+'app.js'] = b'corrupt'
        with self.assertRaisesRegex(gate.GateFailure,'hash mismatch'):
            gate.inspect_isolated_qa(corrupt)
        absent = dict(bundle)
        absent.pop(prefix + 'style.css')
        with self.assertRaisesRegex(gate.GateFailure,'allowlist'):
            gate.inspect_isolated_qa(absent)
        wrong_namespace = dict(bundle)
        wrong_namespace[prefix+'app.js'] = b'not production safe'
        manifest['files']['app.js'] = hashlib.sha256(wrong_namespace[prefix+'app.js']).hexdigest()
        wrong_namespace[prefix+'static-manifest.json'] = json.dumps(manifest).encode('utf-8')
        with self.assertRaisesRegex(gate.GateFailure,'namespace'):
            gate.inspect_isolated_qa(wrong_namespace)


    def test_ui_r4_namespace_and_allowlist_gate(self):
        prefix = gate.UI_R4_PREFIX
        def make_files():
            payload = {name: ('R4-' + name).encode() for name in gate.SPECIALTY_FILES - {'static-manifest.json'}}
            payload['app.js'] = (
                b"const STORE_NAME='tcl-specialty-v352-ui-r4';"
                b"new BroadcastChannel('tcl-specialty-v352-ui-r4-workflow');"
                b"const VOSK_CACHE_NAME='tcl-specialty-v352-ui-r4-vosk-v1';"
            )
            payload['static-manifest.json'] = json.dumps({
                'files': {name: hashlib.sha256(content).hexdigest() for name, content in payload.items()}
            }).encode()
            return {prefix+name: data for name, data in payload.items()}
        data = make_files()
        self.assertEqual(gate.inspect_isolated_ui_r4(data), 12)
        self.assertEqual(gate.inspect_isolated_ui_r4({}), 0)
        missing = dict(data); missing.pop(prefix+'index.html')
        with self.assertRaisesRegex(gate.GateFailure, 'allowlist'):
            gate.inspect_isolated_ui_r4(missing)
        broken = dict(data);broken[prefix+'style.css']=b'forged'
        with self.assertRaisesRegex(gate.GateFailure, 'manifest hash'):
            gate.inspect_isolated_ui_r4(broken)
        injected = make_files()
        content = injected[prefix+'app.js'] + b";const previous='tcl-specialty-v352-ui-r3';"
        injected[prefix+'app.js'] = content
        m = json.loads(injected[prefix+'static-manifest.json'])
        m['files']['app.js'] = hashlib.sha256(content).hexdigest()
        injected[prefix+'static-manifest.json'] = json.dumps(m).encode()
        with self.assertRaisesRegex(gate.GateFailure, 'reuses protected'):
            gate.inspect_isolated_ui_r4(injected)





    def test_exact_r6_model_and_speech_gate(self):
        """Only an independently reviewed app.js + manifest can upgrade R5 QA."""
        p = gate.ASR_PREFIX
        old = {f'protected-{i}.txt': b'old' for i in range(142)}
        old.update({p+'app.js': b'old asr', p+'static-manifest.json': b'old manifest'})
        old.update({p+f'file-{i}': b'old' for i in range(10)})
        self.assertEqual(len(old), 154)
        new = dict(old)
        new[p+'app.js'] = b'R6 reviewed asr'
        new[p+'static-manifest.json'] = b'new manifest'
        constants = ('ASR_R6_BASE_SHA','ASR_R6_TARGET_SHA','ASR_R6_APP_SHA')
        prior = [getattr(gate,n) for n in constants]
        try:
            gate.ASR_R6_BASE_SHA = '1'*64
            gate.ASR_R6_TARGET_SHA = '2'*64
            gate.ASR_R6_APP_SHA = gate.sha256(new[p+'app.js'])
            self.assertTrue(gate.allow_once_asr_r6(old,new,'1'*64,'2'*64))
            with self.assertRaisesRegex(gate.GateFailure, 'exact R5 baseline'):
                gate.allow_once_asr_r6(old,new,'0'*64,'2'*64)
            with self.assertRaisesRegex(gate.GateFailure, 'exact R5 baseline'):
                gate.allow_once_asr_r6(old,new,'1'*64,'0'*64)
            tampered=dict(new);tampered['protected-0.txt']=b'changed'
            with self.assertRaisesRegex(gate.GateFailure, 'may change only'):
                gate.allow_once_asr_r6(old,tampered,'1'*64,'2'*64)
            tampered=dict(new);tampered[p+'file-0']=b'changed'
            with self.assertRaisesRegex(gate.GateFailure, 'may change only'):
                gate.allow_once_asr_r6(old,tampered,'1'*64,'2'*64)
            truncated=dict(new);truncated.pop(p+'file-0')
            with self.assertRaisesRegex(gate.GateFailure, '154'):
                gate.allow_once_asr_r6(old,truncated,'1'*64,'2'*64)
            gate.ASR_R6_APP_SHA='0'*64
            with self.assertRaisesRegex(gate.GateFailure, 'app.js SHA-256'):
                gate.allow_once_asr_r6(old,new,'1'*64,'2'*64)
        finally:
            for n,v in zip(constants, prior):setattr(gate,n,v)

    def test_exact_asr_restart_device_preview_and_digit_release(self):
        p=gate.ASR_PREFIX
        old={f'protected-{i}.txt':b'original' for i in range(142)}
        old.update({p+'app.js':b'old JS',p+'style.css':b'old CSS',p+'static-manifest.json':b'old manifest'})
        old.update({p+f'file-{i}':b'unchanged' for i in range(9)})
        self.assertEqual(len(old),154)
        new=dict(old)
        new[p+'app.js']=b'new JS';new[p+'style.css']=b'new CSS';new[p+'static-manifest.json']=b'new manifest'
        constants=('ASR_RESTART_BASE_SHA','ASR_RESTART_TARGET_SHA','ASR_RESTART_APP_SHA','ASR_RESTART_CSS_SHA')
        saved=[getattr(gate,k) for k in constants]
        try:
            gate.ASR_RESTART_BASE_SHA='a'*64
            gate.ASR_RESTART_TARGET_SHA='b'*64
            gate.ASR_RESTART_APP_SHA=gate.sha256(new[p+'app.js'])
            gate.ASR_RESTART_CSS_SHA=gate.sha256(new[p+'style.css'])
            self.assertTrue(gate.allow_once_asr_restart_fix(old,new,'a'*64,'b'*64))
            for baseline,target in [('x'*64,'b'*64),('a'*64,'x'*64)]:
                with self.assertRaisesRegex(gate.GateFailure,'exact baseline'):
                    gate.allow_once_asr_restart_fix(old,new,baseline,target)
            tampered=dict(new);tampered['protected-0.txt']=b'tampered'
            with self.assertRaisesRegex(gate.GateFailure,'only app'):
                gate.allow_once_asr_restart_fix(old,tampered,'a'*64,'b'*64)
            tampered=dict(new);tampered[p+'file-0']=b'tampered'
            with self.assertRaisesRegex(gate.GateFailure,'only app'):
                gate.allow_once_asr_restart_fix(old,tampered,'a'*64,'b'*64)
            tampered=dict(new);tampered.pop(p+'file-0')
            with self.assertRaisesRegex(gate.GateFailure,'154'):
                gate.allow_once_asr_restart_fix(old,tampered,'a'*64,'b'*64)
            gate.ASR_RESTART_APP_SHA='0'*64
            with self.assertRaisesRegex(gate.GateFailure,'JavaScript SHA'):
                gate.allow_once_asr_restart_fix(old,new,'a'*64,'b'*64)
            gate.ASR_RESTART_APP_SHA=gate.sha256(new[p+'app.js'])
            gate.ASR_RESTART_CSS_SHA='0'*64
            with self.assertRaisesRegex(gate.GateFailure,'CSS SHA'):
                gate.allow_once_asr_restart_fix(old,new,'a'*64,'b'*64)
        finally:
            for k,v in zip(constants,saved):setattr(gate,k,v)

    def test_exact_asr_accessible_end_dialog_release(self):
        p=gate.ASR_PREFIX
        old={f'protected-{i}.txt':b'untouched' for i in range(142)}
        old.update({p+'app.js':b'old',p+'static-manifest.json':b'old-manifest'})
        old.update({p+f'file-{i}':b'still-old' for i in range(10)})
        self.assertEqual(len(old),154)
        new=dict(old);new[p+'app.js']=b'new';new[p+'static-manifest.json']=b'new-manifest'
        names=('ASR_END_DIALOG_BASE_SHA','ASR_END_DIALOG_TARGET_SHA','ASR_END_DIALOG_APP_SHA')
        saved=[getattr(gate,n) for n in names]
        try:
            gate.ASR_END_DIALOG_BASE_SHA='a'*64
            gate.ASR_END_DIALOG_TARGET_SHA='b'*64
            gate.ASR_END_DIALOG_APP_SHA=gate.sha256(new[p+'app.js'])
            self.assertTrue(gate.allow_once_asr_end_dialog(old,new,'a'*64,'b'*64))
            with self.assertRaisesRegex(gate.GateFailure,'exact baseline'):
                gate.allow_once_asr_end_dialog(old,new,'0'*64,'b'*64)
            with self.assertRaisesRegex(gate.GateFailure,'exact baseline'):
                gate.allow_once_asr_end_dialog(old,new,'a'*64,'0'*64)
            bad=dict(new);bad['protected-0.txt']=b'changed'
            with self.assertRaisesRegex(gate.GateFailure,'only ASR'):
                gate.allow_once_asr_end_dialog(old,bad,'a'*64,'b'*64)
            bad=dict(new);bad[p+'file-0']=b'changed'
            with self.assertRaisesRegex(gate.GateFailure,'only ASR'):
                gate.allow_once_asr_end_dialog(old,bad,'a'*64,'b'*64)
            bad=dict(new);bad.pop(p+'file-0')
            with self.assertRaisesRegex(gate.GateFailure,'154'):
                gate.allow_once_asr_end_dialog(old,bad,'a'*64,'b'*64)
            gate.ASR_END_DIALOG_APP_SHA='0'*64
            with self.assertRaisesRegex(gate.GateFailure,'JS SHA'):
                gate.allow_once_asr_end_dialog(old,new,'a'*64,'b'*64)
        finally:
            for name,value in zip(names,saved):setattr(gate,name,value)

    def test_exact_asr_round2_one_time_release(self):
        """A second strict release cannot modify other 152 entries or evade exact pins."""
        p = gate.ASR_PREFIX
        old = {f'protected-{i}.txt': b'original' for i in range(142)}
        old.update({p+'app.js': b'original JS', p+'static-manifest.json': b'original manifest'})
        old.update({p+f'file-{i}': b'unchanged' for i in range(10)})
        self.assertEqual(len(old), 154)
        new = dict(old)
        new[p+'app.js'] = b'candidate JS'
        new[p+'static-manifest.json'] = b'candidate manifest'
        names = ('ASR_ROUND2_BASELINE_SHA', 'ASR_ROUND2_TARGET_SHA', 'ASR_ROUND2_APP_SHA')
        saved = [getattr(gate, name) for name in names]
        try:
            gate.ASR_ROUND2_BASELINE_SHA = 'a'*64
            gate.ASR_ROUND2_TARGET_SHA = 'b'*64
            gate.ASR_ROUND2_APP_SHA = gate.sha256(new[p+'app.js'])
            self.assertTrue(gate.allow_once_asr_round2(old, new, 'a'*64, 'b'*64))
            for badbase, badcandidate in [('0'*64, 'b'*64), ('a'*64, '0'*64)]:
                with self.assertRaisesRegex(gate.GateFailure, 'exact baseline'):
                    gate.allow_once_asr_round2(old, new, badbase, badcandidate)
            wrong = dict(new);wrong['protected-0.txt'] = b'mutated'
            with self.assertRaisesRegex(gate.GateFailure, 'only app'):
                gate.allow_once_asr_round2(old, wrong, 'a'*64, 'b'*64)
            wrong = dict(new);wrong[p+'file-0'] = b'mutated'
            with self.assertRaisesRegex(gate.GateFailure, 'only app'):
                gate.allow_once_asr_round2(old, wrong, 'a'*64, 'b'*64)
            wrong = dict(new);wrong.pop(p+'file-0')
            with self.assertRaisesRegex(gate.GateFailure, '154 files'):
                gate.allow_once_asr_round2(old, wrong, 'a'*64, 'b'*64)
            gate.ASR_ROUND2_APP_SHA = 'f'*64
            with self.assertRaisesRegex(gate.GateFailure, 'app.js SHA'):
                gate.allow_once_asr_round2(old, new, 'a'*64, 'b'*64)
        finally:
            for name, value in zip(names, saved):setattr(gate, name, value)

    def test_exact_asr_stopfix_one_time_release(self):
        old = {gate.ASR_PREFIX+'app.js': b'old', gate.ASR_PREFIX+'static-manifest.json': b'old-manifest', 'root.html': b'unchanged'}
        new = dict(old)
        new[gate.ASR_PREFIX+'app.js'] = b'new app'
        new[gate.ASR_PREFIX+'static-manifest.json'] = b'new-manifest'
        names = ('ASR_STOPFIX_BASELINE_SHA','ASR_STOPFIX_TARGET_SHA','ASR_STOPFIX_JS_SHA')
        original = [getattr(gate, name) for name in names]
        try:
            gate.ASR_STOPFIX_BASELINE_SHA = '1'*64
            gate.ASR_STOPFIX_TARGET_SHA = '2'*64
            gate.ASR_STOPFIX_JS_SHA = gate.sha256(new[gate.ASR_PREFIX+'app.js'])
            more = {gate.ASR_PREFIX+f'file-{i}': b'same' for i in range(10)}
            old.update(more);new.update(more)
            self.assertTrue(gate.allow_once_asr_stopfix(old,new,'1'*64,'2'*64))
            self.assertFalse(gate.allow_once_asr_stopfix(new,new,'1'*64,'2'*64))
            with self.assertRaisesRegex(gate.GateFailure,'immutable'):
                gate.allow_once_asr_stopfix(old,new,'0'*64,'2'*64)
            with self.assertRaisesRegex(gate.GateFailure,'immutable'):
                gate.allow_once_asr_stopfix(old,new,'1'*64,'0'*64)
            altered = dict(new); altered['root.html'] = b'changed'
            with self.assertRaisesRegex(gate.GateFailure,'preserve'):
                gate.allow_once_asr_stopfix(old,altered,'1'*64,'2'*64)
            altered = dict(new); altered[gate.ASR_PREFIX+'file-0']=b'changed'
            with self.assertRaisesRegex(gate.GateFailure,'only update'):
                gate.allow_once_asr_stopfix(old,altered,'1'*64,'2'*64)
            gate.ASR_STOPFIX_JS_SHA = '3'*64
            with self.assertRaisesRegex(gate.GateFailure,'JS SHA'):
                gate.allow_once_asr_stopfix(old,new,'1'*64,'2'*64)
        finally:
            for name,value in zip(names,original):setattr(gate,name,value)

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


class UIR3GateTests(unittest.TestCase):
    """A realistic 118-file baseline plus R3 isolation and mixed-release checks."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.base = self.base_files()
        self.assertEqual(len(self.base), 118)
        self.ui = self.isolated_files(gate.UI_R3_PREFIX, 'tcl-specialty-v352-ui-r3')

    def tearDown(self):
        self.tmp.cleanup()

    def isolated_files(self, prefix, namespace):
        files = {name: ('fixture:' + name).encode() for name in gate.SPECIALTY_FILES - {'static-manifest.json'}}
        files['app.js'] = (
            f"const STORE_NAME='{namespace}';"
            f"new BroadcastChannel('{namespace}-workflow')"
            f"const VOSK_CACHE_NAME='{namespace}-vosk-v1';"
        ).encode()
        files['static-manifest.json'] = json.dumps(
            {'files': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
        ).encode()
        return {prefix + name: data for name, data in files.items()}

    def rehash(self, files, prefix):
        members = {name[len(prefix):]: data for name, data in files.items()
                   if name.startswith(prefix) and name != prefix + 'static-manifest.json'}
        files[prefix + 'static-manifest.json'] = json.dumps(
            {'files': {name: hashlib.sha256(data).hexdigest() for name, data in members.items()}}
        ).encode()

    def base_files(self):
        files = {'index.html': b'root'}
        files.update({f'root-{n}.html': b'root' for n in range(42)})
        p = gate.PREFIX
        files.update({p+'index.html': b'i', p+'asr-check.html': b'a',
                      p+'设备检查.html': b'd', p+'src/offline-asr-worker.js': b'w'})
        files.update({f'{p}file-{n}.txt': b'training' for n in range(46)})
        self.rehash(files, p)
        files.update(self.isolated_files(gate.SPECIALTY, 'tcl-specialty'))
        files.update(self.isolated_files(gate.QA_PREFIX, 'tcl-specialty-v352-mobile-qa'))
        return files

    def verify(self, candidate, baseline=None, test_pin=None):
        def archive(path, files):
            with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
                for name, data in files.items():
                    z.writestr(name, data)
        base_path, candidate_path = self.root/'base.zip', self.root/'candidate.zip'
        archive(base_path, self.base if baseline is None else baseline)
        archive(candidate_path, candidate)
        if test_pin is not None:
            # A generated fixture cannot match the real historical ZIP hash.
            # Exercise the same gate with a fixture-only substituted pin.
            saved_pin, saved_argv = gate.UI_R3_ROLLBACK_SHA256, os.sys.argv
            gate.UI_R3_ROLLBACK_SHA256 = (
                hashlib.sha256(candidate_path.read_bytes()).hexdigest()
                if test_pin == 'candidate' else test_pin
            )
            os.sys.argv = ['release_guard.py', '--candidate', str(candidate_path),
                           '--baseline', str(base_path)]
            captured = io.StringIO()
            try:
                with contextlib.redirect_stdout(captured):
                    code = gate.main()
                return code, json.loads(captured.getvalue())
            finally:
                gate.UI_R3_ROLLBACK_SHA256, os.sys.argv = saved_pin, saved_argv
        result = subprocess.run([os.sys.executable, str(HERE/'release_guard.py'),
                                 '--candidate', str(candidate_path),
                                 '--baseline', str(base_path)], text=True, capture_output=True)
        return result.returncode, json.loads(result.stdout)

    def test_existing_118_file_baseline_is_valid(self):
        code, result = self.verify(self.base)
        self.assertEqual(code, 0, result)
        self.assertEqual(result['root_files'], 43)
        self.assertEqual(result['isolated_qa_files'], 12)

    def test_first_ui_addition_preserves_118_files(self):
        code, result = self.verify({**self.base, **self.ui})
        self.assertEqual(code, 0, result)
        self.assertEqual(result['candidate_files'], 130)
        self.assertEqual(result['isolated_ui_r3_files'], 12)

    def test_modified_or_deleted_existing_files_are_rejected(self):
        for name in ('index.html', gate.PREFIX+'index.html', gate.SPECIALTY+'style.css',
                     gate.QA_PREFIX+'style.css'):
            for action in ('edit', 'delete'):
                with self.subTest(name=name, action=action):
                    candidate = {**self.base, **self.ui}
                    if action == 'edit':
                        candidate[name] = b'tampered'
                    else:
                        del candidate[name]
                    # Rehash intact legacy manifests so the byte-preservation check,
                    # rather than merely stale hashes, must reject edits.
                    for prefix in (gate.PREFIX, gate.SPECIALTY, gate.QA_PREFIX):
                        if name.startswith(prefix):
                            self.rehash(candidate, prefix)
                    code, result = self.verify(candidate)
                    self.assertNotEqual(code, 0, result)

    def test_unexpected_file_and_missing_ui_file_rejected(self):
        for action in ('add', 'remove'):
            candidate = {**self.base, **self.ui}
            if action == 'add':
                candidate[gate.UI_R3_PREFIX+'extra.js'] = b'unsafe'
                self.rehash(candidate, gate.UI_R3_PREFIX)
            else:
                del candidate[gate.UI_R3_PREFIX+'style.css']
                self.rehash(candidate, gate.UI_R3_PREFIX)
            code, result = self.verify(candidate)
            self.assertNotEqual(code, 0, result)

    def test_manifest_hash_and_coverage_are_enforced(self):
        for action in ('hash', 'coverage'):
            candidate = {**self.base, **self.ui}
            if action == 'hash':
                candidate[gate.UI_R3_PREFIX+'style.css'] = b'tampered'
            else:
                m = json.loads(candidate[gate.UI_R3_PREFIX+'static-manifest.json'])
                del m['files']['style.css']
                candidate[gate.UI_R3_PREFIX+'static-manifest.json'] = json.dumps(m).encode()
            code, result = self.verify(candidate)
            self.assertNotEqual(code, 0, result)

    def test_all_three_browser_namespaces_are_enforced(self):
        for old in (b"const STORE_NAME='tcl-specialty-v352-ui-r3';",
                    b"new BroadcastChannel('tcl-specialty-v352-ui-r3-workflow')",
                    b"const VOSK_CACHE_NAME='tcl-specialty-v352-ui-r3-vosk-v1';"):
            candidate = {**self.base, **self.ui}
            app = gate.UI_R3_PREFIX+'app.js'
            candidate[app] = candidate[app].replace(old, b'/* absent */')
            self.rehash(candidate, gate.UI_R3_PREFIX)
            code, result = self.verify(candidate)
            self.assertNotEqual(code, 0, result)

    def test_existing_browser_namespaces_cannot_be_reused(self):
        for old in ('tcl-specialty-v3', 'tcl-specialty-workflow', 'tcl-specialty-vosk-v1',
                    'tcl-specialty-v352-mobile-qa', 'tcl-specialty-v352-mobile-qa-workflow',
                    'tcl-specialty-v352-mobile-qa-vosk-v1'):
            candidate = {**self.base, **self.ui}
            candidate[gate.UI_R3_PREFIX+'app.js'] += (f"\nlet unsafe = '{old}';").encode()
            self.rehash(candidate, gate.UI_R3_PREFIX)
            code, result = self.verify(candidate)
            self.assertNotEqual(code, 0, result)

    def test_ui_update_allows_only_ui_changes(self):
        baseline = {**self.base, **self.ui}
        candidate = dict(baseline)
        candidate[gate.UI_R3_PREFIX+'style.css'] = b'new style'
        self.rehash(candidate, gate.UI_R3_PREFIX)
        code, result = self.verify(candidate, baseline)
        self.assertEqual(code, 0, result)
        candidate[gate.SPECIALTY+'style.css'] = b'changed too'
        self.rehash(candidate, gate.SPECIALTY)
        code, result = self.verify(candidate, baseline)
        self.assertNotEqual(code, 0, result)

    def test_existing_ui_directory_cannot_be_removed(self):
        baseline = {**self.base, **self.ui}
        code, result = self.verify(self.base, baseline)
        self.assertNotEqual(code, 0, result)

    def test_production_rollback_pin_is_exact(self):
        self.assertEqual(gate.UI_R3_ROLLBACK_SHA256,
                         'fa488483cd3489e47a976f4a745b588438a3f5f0680e6dedff05c81262902727')

    def test_matching_pinned_archive_with_unchanged_non_ui_can_rollback(self):
        baseline = {**self.base, **self.ui}
        code, result = self.verify(self.base, baseline, test_pin='candidate')
        self.assertEqual(code, 0, result)
        self.assertEqual(result['isolated_ui_r3_files'], 0)

    def test_nonmatching_archive_cannot_remove_ui(self):
        baseline = {**self.base, **self.ui}
        code, result = self.verify(self.base, baseline, test_pin='0'*64)
        self.assertNotEqual(code, 0, result)
        self.assertIn('UI R3 removal requires the pinned rollback', result['errors'][0])

    def test_pinned_rollback_refuses_any_non_ui_change(self):
        baseline = {**self.base, **self.ui}
        baseline[gate.SPECIALTY+'style.css'] = b'changed after historical baseline'
        self.rehash(baseline, gate.SPECIALTY)
        code, result = self.verify(self.base, baseline, test_pin='candidate')
        self.assertNotEqual(code, 0, result)
        self.assertIn('UI R3 removal requires the pinned rollback', result['errors'][0])

    def test_qa_directory_remains_immutable(self):
        baseline = {**self.base, **self.ui}
        candidate = dict(baseline)
        candidate[gate.QA_PREFIX+'style.css'] = b'changed'
        self.rehash(candidate, gate.QA_PREFIX)
        code, result = self.verify(candidate, baseline)
        self.assertNotEqual(code, 0, result)



class ASRReleaseGateTests(unittest.TestCase):
    """The candidate adds exactly 12 isolated ASR files to a 142-file baseline."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.base = self.base_files()
        self.base.update(self.isolated_files(gate.UI_R3_PREFIX, 'tcl-specialty-v352-ui-r3'))
        self.base.update(self.isolated_files(gate.UI_R4_PREFIX, 'tcl-specialty-v352-ui-r4'))
        self.assertEqual(len(self.base), 142)
        self.asr = self.isolated_files(gate.ASR_PREFIX, 'tcl-specialty-v352-asr')

    isolated_files = UIR3GateTests.isolated_files
    base_files = UIR3GateTests.base_files
    rehash = UIR3GateTests.rehash
    verify = UIR3GateTests.verify

    def tearDown(self):
        self.tmp.cleanup()

    def test_asr_addition_preserves_existing_files(self):
        code, result = self.verify({**self.base, **self.asr})
        self.assertEqual(code, 0, result)
        self.assertEqual(result['candidate_files'], 154)
        self.assertEqual(result['isolated_asr_files'], 12)

    def test_each_baseline_file_cannot_change_or_disappear(self):
        for name in self.base:
            for action in ('edit', 'delete'):
                with self.subTest(name=name, action=action):
                    candidate = {**self.base, **self.asr}
                    if action == 'edit': candidate[name] += b' modified'
                    else: del candidate[name]
                    code, result = self.verify(candidate)
                    self.assertNotEqual(code, 0, (name, action, result))

    def test_asr_namespace_is_distinct_from_r4(self):
        for protected in ('tcl-specialty-v352-ui-r4', 'tcl-specialty-v352-ui-r4-workflow', 'tcl-specialty-v352-ui-r4-vosk-v1'):
            candidate = {**self.base, **self.asr}
            candidate[gate.ASR_PREFIX+'app.js'] += (";const bad='" + protected + "';").encode()
            self.rehash(candidate, gate.ASR_PREFIX)
            code, result = self.verify(candidate)
            self.assertNotEqual(code, 0, result)
            self.assertIn('reuses protected', result['errors'][0])

    def test_asr_manifest_and_allowlist_enforced(self):
        for action in ('missing', 'extra', 'tamper'):
            candidate = {**self.base, **self.asr}
            if action == 'missing': del candidate[gate.ASR_PREFIX+'style.css']
            if action == 'extra': candidate[gate.ASR_PREFIX+'extra.js'] = b'bad'
            if action == 'tamper': candidate[gate.ASR_PREFIX+'app.js'] += b'tamper'
            code, result = self.verify(candidate)
            self.assertNotEqual(code, 0, result)

    def test_asr_after_release_is_immutable(self):
        baseline = {**self.base, **self.asr}
        candidate = dict(baseline)
        candidate[gate.ASR_PREFIX+'style.css'] = b'changed'
        self.rehash(candidate, gate.ASR_PREFIX)
        code, result = self.verify(candidate, baseline)
        self.assertNotEqual(code, 0, result)



class StandaloneLabPolicyTests(unittest.TestCase):
    def setUp(self):
        self.html = b'fixture audio lab'
        self.old_html_pin = gate.LAB_HTML_SHA256
        self.old_zip_pin = gate.LAB_BASELINE_ZIP_SHA256
        gate.LAB_HTML_SHA256 = hashlib.sha256(self.html).hexdigest()
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as z:
            z.writestr('index.html', 'existing')
        self.zip = stream.getvalue()
        gate.LAB_BASELINE_ZIP_SHA256 = hashlib.sha256(self.zip).hexdigest()
        self.before = (
            'name: Deploy\n'
            f'run: echo "{gate.LAB_BASELINE_ZIP_SHA256}  site.zip" | sha256sum --check --strict\n'
            '      - name: Extract frontend only\n'
            '        run: unzip -q site.zip -d _site\n'
            + gate.LAB_ANCHOR
            + '      - uses: actions/upload-pages-artifact@v4\n'
        )
        self.after = self.before.replace(gate.LAB_ANCHOR, gate.lab_stage_step()+gate.LAB_ANCHOR, 1)

    def tearDown(self):
        gate.LAB_HTML_SHA256 = self.old_html_pin
        gate.LAB_BASELINE_ZIP_SHA256 = self.old_zip_pin

    def test_valid_exact_addition(self):
        self.assertTrue(gate.LAB_ANCHOR.endswith('\n'))
        self.assertTrue(gate.verify_lab_addition(self.before, self.after, self.html, self.zip))

    def test_rejects_tampering(self):
        for b,a,h,z in (
            (self.before,self.after,self.html+b'bad',self.zip),
            (self.before,self.after,self.html,b'bad'),
            (self.before,self.after+'#bad\n',self.html,self.zip),
            (self.before,self.after.replace('unzip -q','unzip -o'),self.html,self.zip),
            (self.before,self.before,self.html,self.zip),
        ):
            with self.assertRaises(gate.GateFailure):
                gate.verify_lab_addition(b,a,h,z)

    def test_rejects_collision(self):
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as z:
            z.writestr(gate.LAB_TARGET, 'existing')
        zipped=stream.getvalue()
        gate.LAB_BASELINE_ZIP_SHA256=hashlib.sha256(zipped).hexdigest()
        orig=hashlib.sha256(self.zip).hexdigest()
        before=self.before.replace(orig, gate.LAB_BASELINE_ZIP_SHA256)
        after=before.replace(gate.LAB_ANCHOR, gate.lab_stage_step()+gate.LAB_ANCHOR,1)
        with self.assertRaisesRegex(gate.GateFailure, 'overwrite'):
            gate.verify_lab_addition(before,after,self.html,zipped)



class AutoqaGateTests(unittest.TestCase):
    def test_pinned_sources_and_workflow_are_restrictive(self):
        self.assertEqual(len(gate.AUTOQA_FILES), 3)
        self.assertEqual(len(set(gate.AUTOQA_FILES.values())), 3)
        self.assertIn('tcl-v352-asr-autoqa/',gate.AUTOQA_PATH)
        self.assertIn('python3 experiments/r6-asr-autoqa/build_qa.py',gate.AUTOQA_STEP)
        self.assertEqual(gate.AUTOQA_STEP.count('build_qa.py'),1)


class AutoqaNamespaceFixGateTests(unittest.TestCase):
    def test_patch_is_two_source_files_only(self):
        self.assertEqual(set(gate.AUTOQA_NAMESPACE_PATCH),{
            'experiments/r6-asr-autoqa/build_qa.py',
            'experiments/r6-asr-autoqa/test_build_qa.py',
        })
        self.assertNotIn('site.zip',gate.AUTOQA_NAMESPACE_PATCH)
        self.assertNotIn('.github/workflows/pages.yml',gate.AUTOQA_NAMESPACE_PATCH)


class R21TrustedStageTests(unittest.TestCase):
    def test_r21_one_time_release_exact_workflow_addition(self):
        old=(
            'name: Deploy\n'
            f'run: echo "{gate.LAB_BASELINE_ZIP_SHA256}  site.zip" | sha256sum --check --strict\n'
            '      - uses: actions/configure-pages@v5\n'
        )
        self.assertIn('python3 release-ci/stage_r21.py',gate.R21_STEP)
        self.assertIn(gate.R21_ARCHIVE,gate.R21_STEP)
        self.assertIn(gate.R21_APP_SHA,gate.R21_STEP)
        self.assertEqual(gate.R21_STEP.count('tcl-v352-asr-autoqa-r2'),1)
        self.assertNotIn('unzip -o',gate.R21_STEP)
        self.assertEqual(old.count('      - uses: actions/configure-pages@v5\n'),1)


class RealModelOneShotGateTests(unittest.TestCase):
    def test_manual_asr_probe_is_separate_from_pages_release(self):
        policy=Path(gate.__file__).read_text(encoding='utf-8')
        self.assertIn('.github/workflows/r21-real-model-smoke.yml', policy)
        self.assertIn('release-ci/r21_real_model_probe.py', policy)
        self.assertIn("permissions:\\n  contents: read",policy)
        self.assertNotIn("r21-real-model-smoke.yml' |",policy)


class R23PinnedReleasePolicyTests(unittest.TestCase):
    def test_r23_verifier_reconstructs_r21_first(self):
        policy=Path(gate.__file__).read_text(encoding='utf-8')
        self.assertIn('r21_runner=pathlib.Path',policy)
        self.assertIn('Prerequisite R2.1 stage failed',policy)

    def test_only_exact_R23_stage_allowed(self):
        self.assertIn('python3 release-ci/stage_r23.py',gate.R23_STEP)
        self.assertIn('tcl-v352-asr-autoqa-r23',gate.R23_STEP)
        self.assertIn(gate.R23_APP_SHA256,gate.R23_STEP)
        self.assertEqual(gate.R23_STEP.count('site.zip'),0)
        self.assertEqual(len(gate.R23_ARCHIVE_SHA256),64)

class R24FrozenStaticReleaseTests(unittest.TestCase):
    """Adversarial fixtures exercise the actual decoder, stage and PR classifier."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.site = self.root / '_site'
        self.site.mkdir()
        self.baselines = {'old-root/index.html': b'old root',
                          'r6/app.js': b'old R6', 'r21/app.js': b'old R21',
                          'r23/app.js': b'old R23'}
        for name, data in self.baselines.items():
            p = self.site / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        self.resources = {'app.js': b'export const value = 1;\n',
                          'index.html': b'<!doctype html><title>fixture</title>'}
        self.archive = self.root / 'site-only.zip.b64'
        self.patcher = mock.patch.multiple(gate,
            R24_ASSET_HASHES={}, R24_ARCHIVE_B64_SHA='', R24_ARCHIVE_SHA='',
            R24_REQUIRED_BASELINES={name: gate.sha256(data)
                                    for name, data in self.baselines.items()})
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.freeze_fixture()

    def freeze_fixture(self):
        self.resources['static-manifest.json'] = json.dumps({'files': {
            name: gate.sha256(data) for name, data in self.resources.items()
            if name != 'static-manifest.json'}}).encode()
        gate.R24_ASSET_HASHES = {name: gate.sha256(data)
                                 for name, data in self.resources.items()}
        self.write_archive(self.resources)

    def write_archive(self, resources, extra=None):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as z:
            for name, value in resources.items():
                z.writestr(gate.R24_DEST + '/' + name, value)
            if extra:
                z.writestr(*extra)
        raw = data.getvalue()
        encoded = base64.b64encode(raw) + b'\n'
        gate.R24_ARCHIVE_SHA = gate.sha256(raw)
        gate.R24_ARCHIVE_B64_SHA = gate.sha256(encoded)
        self.archive.write_bytes(encoded)
        return encoded

    def assert_old_unchanged(self):
        for name, data in self.baselines.items():
            self.assertEqual((self.site / name).read_bytes(), data)

    def test_success_stages_exact_resources_and_preserves_old_routes(self):
        report = gate.stage_r24(self.site, self.archive)
        self.assertEqual(report['files'], len(self.resources))
        self.assertEqual(report['old_assets_unchanged'], len(self.baselines))
        for name, data in self.resources.items():
            self.assertEqual((self.site / gate.R24_DEST / name).read_bytes(), data)
        self.assert_old_unchanged()

    def test_existing_target_is_never_overwritten(self):
        target = self.site / gate.R24_DEST
        target.mkdir()
        (target / 'index.html').write_text('keep')
        with self.assertRaisesRegex(gate.GateFailure, 'refuse overwrite'):
            gate.stage_r24(self.site, self.archive)
        self.assertEqual((target / 'index.html').read_text(), 'keep')
        self.assert_old_unchanged()

    def test_missing_or_changed_preceding_route_fails(self):
        (self.site / 'r21/app.js').write_bytes(b'changed')
        with self.assertRaisesRegex(gate.GateFailure, 'baseline absent/changed'):
            gate.stage_r24(self.site, self.archive)
        self.assertFalse((self.site / gate.R24_DEST).exists())

    def test_symlink_in_existing_tree_is_rejected(self):
        (self.site / 'alias').symlink_to(self.root)
        with self.assertRaisesRegex(gate.GateFailure, 'existing symlinks'):
            gate.stage_r24(self.site, self.archive)

    def test_encoded_and_decoded_container_hashes_are_both_pinned(self):
        encoded = self.archive.read_bytes()
        with self.assertRaisesRegex(gate.GateFailure, 'encoded archive'):
            gate.r24_resource_bytes(encoded + b'\n')
        gate.R24_ARCHIVE_SHA = '0' * 64
        with self.assertRaisesRegex(gate.GateFailure, 'ZIP archive'):
            gate.r24_resource_bytes(encoded)

    def test_resource_changes_fail_even_with_new_outer_container_pins(self):
        changed = {**self.resources, 'app.js': b'export const changed = true;'}
        encoded = self.write_archive(changed)
        with self.assertRaisesRegex(gate.GateFailure, 'resource hash mismatch'):
            gate.r24_resource_bytes(encoded)

    def test_extra_resource_and_directory_entry_are_rejected(self):
        encoded = self.write_archive({**self.resources, 'secret.txt': b'no'})
        with self.assertRaisesRegex(gate.GateFailure, 'allowlist'):
            gate.r24_resource_bytes(encoded)
        encoded = self.write_archive(self.resources, (gate.R24_DEST + '/extra/', b''))
        with self.assertRaisesRegex(gate.GateFailure, 'entry count'):
            gate.r24_resource_bytes(encoded)

    def test_archive_traversal_and_symlink_are_rejected(self):
        encoded = self.write_archive(self.resources, ('../escape', b'no'))
        with self.assertRaisesRegex(gate.GateFailure, 'Unsafe ZIP name'):
            gate.r24_resource_bytes(encoded)
        info = zipfile.ZipInfo(gate.R24_DEST + '/link')
        info.create_system = 3
        info.external_attr = (0o120777 << 16)
        encoded = self.write_archive(self.resources, (info, b'../outside'))
        with self.assertRaisesRegex(gate.GateFailure, 'Symlink'):
            gate.r24_resource_bytes(encoded)

    def test_duplicate_archive_member_is_rejected(self):
        with self.assertWarns(UserWarning):
            encoded = self.write_archive(self.resources,
                (gate.R24_DEST + '/app.js', self.resources['app.js']))
        with self.assertRaisesRegex(gate.GateFailure, 'Duplicate ZIP'):
            gate.r24_resource_bytes(encoded)

    def test_manifest_must_cover_exact_files_and_hashes(self):
        self.resources['static-manifest.json'] = b'{"files":{}}'
        gate.R24_ASSET_HASHES = {name: gate.sha256(data)
                                for name, data in self.resources.items()}
        encoded = self.write_archive(self.resources)
        with self.assertRaisesRegex(gate.GateFailure, 'manifest coverage'):
            gate.r24_resource_bytes(encoded)

    def test_failed_syntax_does_not_publish_partial_directory(self):
        self.resources['app.js'] = b'export const = syntax error;'
        self.freeze_fixture()
        with self.assertRaisesRegex(gate.GateFailure, 'syntax check failed'):
            gate.stage_r24(self.site, self.archive)
        self.assertFalse((self.site / gate.R24_DEST).exists())
        self.assert_old_unchanged()
        self.assertFalse(list(self.root.glob('.r24-stage-*')))

    def test_exact_workflow_only_and_protected_zip(self):
        oldzip = b'baseline bytes'
        digest = gate.sha256(oldzip)
        before = (f'run: echo "{digest}  site.zip" | sha256sum --check --strict\n'
                  + gate.lab_stage_step() + gate.AUTOQA_STEP + gate.R21_STEP
                  + gate.R23_STEP + gate.LAB_ANCHOR)
        after = before.replace(gate.LAB_ANCHOR, gate.r24_stage_step() + gate.LAB_ANCHOR)
        inputs = {name: b'base-only' for name in gate.R24_TRUSTED_INPUTS}
        with mock.patch.object(gate, 'LAB_BASELINE_ZIP_SHA256', digest):
            with self.assertRaisesRegex(gate.GateFailure, 'protected site.zip'):
                gate.verify_r24_additive_release(before, after,
                    self.archive.read_bytes(), oldzip + b'changed', inputs)
            with self.assertRaisesRegex(gate.GateFailure, 'unrelated Pages'):
                gate.verify_r24_additive_release(before, after + '# unrelated',
                    self.archive.read_bytes(), oldzip, inputs)
            with self.assertRaisesRegex(gate.GateFailure, 'unchanged preceding'):
                gate.verify_r24_additive_release(before.replace(gate.R23_STEP, ''), after,
                    self.archive.read_bytes(), oldzip, inputs)

    def test_release_classifier_reads_old_builders_from_base_commit(self):
        base, head = 'a' * 40, 'b' * 40
        changed = gate.R24_ARCHIVE + '\n.github/workflows/pages.yml\n'
        calls = []
        def output(command, **kwargs):
            calls.append(command)
            if command[:3] == ['git', 'diff', '--name-only']:
                return changed
            if command[:3] == ['git', 'ls-tree', '--name-only']:
                return gate.R24_ARCHIVE + '\n'
            self.assertEqual(command[:2], ['git', 'show'])
            return command[2].encode()
        with mock.patch.object(gate.subprocess, 'check_output', side_effect=output):
            with mock.patch.object(gate, 'verify_r24_additive_release') as verify:
                self.assertEqual(gate.verify_pr(base, head), 0)
        args = verify.call_args.args
        self.assertEqual(args[3], (base + ':site.zip').encode())
        self.assertEqual(args[4], {name: (base + ':' + name).encode()
                                  for name in gate.R24_TRUSTED_INPUTS})
        self.assertFalse(any(head + ':release-ci/' in part for command in calls for part in command))

    def test_exact_reverse_release_is_rollbackable_without_touching_old_stages(self):
        oldzip = b'baseline bytes'
        digest = gate.sha256(oldzip)
        original = (f'run: echo "{digest}  site.zip" | sha256sum --check --strict\n'
                    + gate.lab_stage_step() + gate.AUTOQA_STEP + gate.R21_STEP
                    + gate.R23_STEP + gate.LAB_ANCHOR)
        released = original.replace(gate.LAB_ANCHOR,
                                     gate.r24_stage_step() + gate.LAB_ANCHOR)
        encoded = self.archive.read_bytes()
        with mock.patch.object(gate, 'LAB_BASELINE_ZIP_SHA256', digest):
            self.assertTrue(gate.verify_r24_rollback(released, original, encoded, oldzip))
            with self.assertRaisesRegex(gate.GateFailure, 'only the exact'):
                gate.verify_r24_rollback(released, original.replace(gate.R21_STEP, ''), encoded, oldzip)
            with self.assertRaisesRegex(gate.GateFailure, 'encoded archive'):
                gate.verify_r24_rollback(released, original, encoded + b'changed', oldzip)

    def test_unfrozen_policy_and_oversized_container_fail_closed(self):
        encoded = self.archive.read_bytes()
        with mock.patch.object(gate, 'R24_ARCHIVE_SHA', 'PENDING_SOURCE_FREEZE'):
            with self.assertRaisesRegex(gate.GateFailure, 'not been frozen'):
                gate.r24_resource_bytes(encoded)
        with mock.patch.object(gate, 'R24_MAX_ENCODED_BYTES', len(encoded) - 1):
            with self.assertRaisesRegex(gate.GateFailure, 'oversized'):
                gate.stage_r24(self.site, self.archive)
        self.assertFalse((self.site / gate.R24_DEST).exists())

    def test_mixed_ci_and_release_changes_remain_rejected(self):
        changed = gate.R24_ARCHIVE + '\n.github/workflows/pages.yml\nrelease-ci/release_guard.py\n'
        with mock.patch.object(gate.subprocess, 'check_output', return_value=changed):
            with self.assertRaisesRegex(gate.GateFailure, 'exactly site.zip and pages.yml'):
                gate.verify_pr('a' * 40, 'b' * 40)


class R24InPlaceUpdateTests(unittest.TestCase):
    freeze_fixture = R24FrozenStaticReleaseTests.freeze_fixture
    write_archive = R24FrozenStaticReleaseTests.write_archive

    def setUp(self):
        R24FrozenStaticReleaseTests.setUp(self)
        self.resources.update({'lib/parser.js': b'export const parser = 1;\n',
                               'lib/qa-import.js': b'export const qa = 1;\n'})
        self.freeze_fixture()
        self.old_encoded = self.archive.read_bytes()
        self.new_resources = {**self.resources,
            'app.js': b'export const value = 2;\n',
            'lib/parser.js': b'export const parser = 2;\n',
            'lib/qa-import.js': b'export const qa = 2;\n'}
        self.update_patcher = mock.patch.multiple(gate,
            R24_UPDATE_ASSET_HASHES={}, R24_UPDATE_ARCHIVE_B64_SHA='', R24_UPDATE_ARCHIVE_SHA='')
        self.update_patcher.start()
        self.addCleanup(self.update_patcher.stop)
        self.freeze_update()
        self.zipbytes = b'immutable older site.zip fixture'
        self.zip_patcher = mock.patch.object(gate, 'LAB_BASELINE_ZIP_SHA256', gate.sha256(self.zipbytes))
        self.zip_patcher.start()
        self.addCleanup(self.zip_patcher.stop)
        self.workflow = (f'run: echo "{gate.LAB_BASELINE_ZIP_SHA256}  site.zip" | sha256sum --check --strict\n'
            + gate.lab_stage_step() + gate.AUTOQA_STEP + gate.R21_STEP + gate.R23_STEP
            + gate.r24_stage_step() + gate.LAB_ANCHOR)
        self.trusted = {name: b'only from base commit' for name in gate.R24_TRUSTED_INPUTS}

    def freeze_update(self):
        self.new_resources['static-manifest.json'] = json.dumps({'files': {
            name: gate.sha256(data) for name, data in self.new_resources.items()
            if name != 'static-manifest.json'}}).encode()
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as z:
            for name, value in self.new_resources.items():
                z.writestr(gate.R24_DEST + '/' + name, value)
        raw = data.getvalue()
        self.new_encoded = base64.b64encode(raw) + b'\n'
        gate.R24_UPDATE_ARCHIVE_SHA = gate.sha256(raw)
        gate.R24_UPDATE_ARCHIVE_B64_SHA = gate.sha256(self.new_encoded)
        gate.R24_UPDATE_ASSET_HASHES = {name: gate.sha256(data)
                                       for name, data in self.new_resources.items()}

    def rebuild_fixture(self, root, zipbytes, trusted):
        self.assertEqual(zipbytes, self.zipbytes)
        self.assertEqual(trusted, self.trusted)
        site = root / '_site'
        for name, data in self.baselines.items():
            p = site / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        return site

    def verify(self, old=None, new=None, workflow=None):
        return gate.verify_r24_archive_update(self.workflow if workflow is None else workflow,
            self.old_encoded if old is None else old, self.new_encoded if new is None else new,
            self.zipbytes, self.trusted)

    def test_old_and_new_snapshots_remain_independently_readable(self):
        self.assertEqual(gate.r24_resource_bytes(self.old_encoded), self.resources)
        self.assertEqual(gate.r24_resource_bytes(self.new_encoded), self.new_resources)
        with mock.patch.object(gate, 'R24_UPDATE_ARCHIVE_SHA', 'PENDING_SOURCE_FREEZE'):
            self.assertEqual(gate.r24_resource_bytes(self.old_encoded), self.resources)
            with self.assertRaisesRegex(gate.GateFailure, 'not been frozen'):
                gate.r24_resource_bytes(self.new_encoded)

    def test_update_and_exact_reverse_rebuild_only_the_four_reviewed_resources(self):
        with mock.patch.object(gate, 'r24_rebuild_previous_stages', side_effect=self.rebuild_fixture):
            forward = self.verify()
            backward = self.verify(self.new_encoded, self.old_encoded)
        self.assertEqual(forward['direction'], 'update')
        self.assertEqual(backward['direction'], 'rollback')
        self.assertEqual(forward['protected_assets'], len(self.baselines))
        self.assertEqual(forward['total_assets'], len(self.baselines) + len(self.resources))
        self.assertEqual(forward['changed'], sorted(gate.R24_DEST + '/' + n for n in gate.R24_UPDATE_CHANGED_FILES))
        self.assertEqual(forward['changed'], backward['changed'])

    def test_same_version_or_third_snapshot_is_rejected(self):
        for old, new in ((self.old_encoded, self.old_encoded), (self.new_encoded, self.new_encoded),
                         (self.old_encoded, self.new_encoded + b'\n')):
            with self.assertRaisesRegex(gate.GateFailure, 'exact old/new snapshot pair'):
                self.verify(old, new)

    def test_changed_unreviewed_resource_is_rejected_even_if_both_archives_are_pinned(self):
        self.new_resources['index.html'] = b'changed unrelated page'
        self.freeze_update()
        with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed four files'):
            self.verify()

    def test_missing_resource_is_rejected_even_with_consistent_new_manifest(self):
        del self.new_resources['index.html']
        self.freeze_update()
        with self.assertRaisesRegex(gate.GateFailure, 'static resource set'):
            self.verify()

    def test_omitting_a_required_repair_does_not_match_the_frozen_scope(self):
        self.new_resources['lib/parser.js'] = self.resources['lib/parser.js']
        self.freeze_update()
        with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed four files'):
            self.verify()

    def test_existing_stage_and_protected_zip_cannot_be_removed_or_changed(self):
        with self.assertRaisesRegex(gate.GateFailure, 'existing Pages stages'):
            self.verify(workflow=self.workflow.replace(gate.R21_STEP, ''))
        with self.assertRaisesRegex(gate.GateFailure, 'protected site.zip'):
            gate.verify_r24_archive_update(self.workflow, self.old_encoded, self.new_encoded,
                self.zipbytes + b'changed', self.trusted)

    def test_archive_only_pr_reads_every_protected_input_from_base(self):
        base, head = 'a' * 40, 'b' * 40
        calls = []
        def output(command, **kwargs):
            calls.append(command)
            if command[:3] == ['git', 'diff', '--name-only']:
                return gate.R24_ARCHIVE + '\n'
            self.assertEqual(command[:2], ['git', 'show'])
            return command[2].encode()
        with mock.patch.object(gate.subprocess, 'check_output', side_effect=output):
            with mock.patch.object(gate, 'verify_r24_archive_update') as verify:
                self.assertEqual(gate.verify_pr(base, head), 0)
        args = verify.call_args.args
        self.assertEqual(args[0], base + ':.github/workflows/pages.yml')
        self.assertEqual(args[1:4], ((base + ':' + gate.R24_ARCHIVE).encode(),
            (head + ':' + gate.R24_ARCHIVE).encode(), (base + ':site.zip').encode()))
        self.assertEqual(args[4], {name: (base + ':' + name).encode() for name in gate.R24_TRUSTED_INPUTS})
        self.assertEqual([cmd[2] for cmd in calls if cmd[:2] == ['git', 'show'] and cmd[2].startswith(head + ':')],
                         [head + ':' + gate.R24_ARCHIVE])

    def test_update_cannot_be_mixed_with_ci_or_documentation_edits(self):
        for path in ('release-ci/release_guard.py', 'AI_CONTEXT.md'):
            changed = gate.R24_ARCHIVE + '\n' + path + '\n'
            with mock.patch.object(gate.subprocess, 'check_output', return_value=changed):
                with self.assertRaisesRegex(gate.GateFailure, 'split release, CI and unrelated'):
                    gate.verify_pr('a' * 40, 'b' * 40)


class R24QuestionBankUpdateTests(unittest.TestCase):
    freeze_fixture = R24InPlaceUpdateTests.freeze_fixture
    write_archive = R24InPlaceUpdateTests.write_archive
    freeze_update = R24InPlaceUpdateTests.freeze_update
    rebuild_fixture = R24InPlaceUpdateTests.rebuild_fixture

    def setUp(self):
        R24InPlaceUpdateTests.setUp(self)
        self.question_patcher = mock.patch.multiple(gate,
            R24_QUESTION_ASSET_HASHES={}, R24_QUESTION_ARCHIVE_B64_SHA='', R24_QUESTION_ARCHIVE_SHA='')
        self.question_patcher.start()
        self.addCleanup(self.question_patcher.stop)
        self.question_resources = {**self.new_resources,
            'app.js': b'export const value = 3;\n',
            'lib/qa-import.js': b'export const qa = 3;\n'}
        self.freeze_question()

    def freeze_question(self):
        self.question_resources['static-manifest.json'] = json.dumps({'files': {
            name: gate.sha256(data) for name, data in self.question_resources.items()
            if name != 'static-manifest.json'}}).encode()
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as z:
            for name, value in self.question_resources.items():
                z.writestr(gate.R24_DEST + '/' + name, value)
        raw = data.getvalue()
        self.question_encoded = base64.b64encode(raw) + b'\n'
        gate.R24_QUESTION_ARCHIVE_SHA = gate.sha256(raw)
        gate.R24_QUESTION_ARCHIVE_B64_SHA = gate.sha256(self.question_encoded)
        gate.R24_QUESTION_ASSET_HASHES = {name: gate.sha256(data)
                                         for name, data in self.question_resources.items()}

    def verify_question(self, old, new):
        return gate.verify_r24_archive_update(self.workflow, old, new, self.zipbytes, self.trusted)

    def test_all_three_fixed_snapshots_are_readable(self):
        self.assertEqual(gate.r24_resource_bytes(self.old_encoded), self.resources)
        self.assertEqual(gate.r24_resource_bytes(self.new_encoded), self.new_resources)
        self.assertEqual(gate.r24_resource_bytes(self.question_encoded), self.question_resources)

    def test_question_update_and_reverse_preserve_all_other_files(self):
        with mock.patch.object(gate, 'r24_rebuild_previous_stages', side_effect=self.rebuild_fixture):
            update = self.verify_question(self.new_encoded, self.question_encoded)
            rollback = self.verify_question(self.question_encoded, self.new_encoded)
        self.assertEqual(update['direction'], 'update')
        self.assertEqual(rollback['direction'], 'rollback')
        expected = sorted(gate.R24_DEST + '/' + name for name in gate.R24_QUESTION_CHANGED_FILES)
        self.assertEqual(update['changed'], expected)
        self.assertEqual(rollback['changed'], expected)
        self.assertEqual(update['protected_assets'], len(self.baselines))

    def test_skipping_the_data_integrity_version_is_rejected(self):
        for pair in ((self.old_encoded, self.question_encoded),
                     (self.question_encoded, self.old_encoded),
                     (self.question_encoded, self.question_encoded)):
            with self.assertRaisesRegex(gate.GateFailure, 'exact old/new snapshot pair'):
                self.verify_question(*pair)

    def test_question_update_cannot_rewrite_parser_even_with_pinned_outer_bytes(self):
        self.question_resources['lib/parser.js'] = b'export const parser = 3;'
        self.freeze_question()
        with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed three files'):
            self.verify_question(self.new_encoded, self.question_encoded)

    def test_unfrozen_third_snapshot_does_not_break_live_second_snapshot(self):
        with mock.patch.object(gate, 'R24_QUESTION_ARCHIVE_SHA', 'PENDING_SOURCE_FREEZE'):
            self.assertEqual(gate.r24_resource_bytes(self.new_encoded), self.new_resources)
            self.assertEqual(gate.r24_resource_bytes(self.old_encoded), self.resources)
            with self.assertRaisesRegex(gate.GateFailure, 'not been frozen'):
                gate.r24_resource_bytes(self.question_encoded)


class R24SmoothMobileUpdateTests(unittest.TestCase):
    freeze_fixture = R24InPlaceUpdateTests.freeze_fixture
    write_archive = R24InPlaceUpdateTests.write_archive
    freeze_update = R24InPlaceUpdateTests.freeze_update
    rebuild_fixture = R24InPlaceUpdateTests.rebuild_fixture
    freeze_question = R24QuestionBankUpdateTests.freeze_question

    def setUp(self):
        R24QuestionBankUpdateTests.setUp(self)
        self.question_resources.update({
            'style.css': b'body { color: black; }',
            'whisper-bridge.mjs': b'export const bridge = 1;',
        })
        self.freeze_question()
        self.smooth_patcher = mock.patch.multiple(gate,
            R24_SMOOTH_ASSET_HASHES={}, R24_SMOOTH_ARCHIVE_B64_SHA='', R24_SMOOTH_ARCHIVE_SHA='')
        self.smooth_patcher.start()
        self.addCleanup(self.smooth_patcher.stop)
        self.smooth_resources = {**self.question_resources,
            'app.js': b'export const value = 4;',
            'style.css': b'body { color: blue; }',
            'whisper-bridge.mjs': b'export const bridge = 2;',
            'whisper-worker.mjs': b'self.onmessage = () => {};',
        }
        self.freeze_smooth()

    def freeze_smooth(self):
        self.smooth_resources['static-manifest.json'] = json.dumps({'files': {
            name: gate.sha256(data) for name, data in self.smooth_resources.items()
            if name != 'static-manifest.json'}}).encode()
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as z:
            for name, value in self.smooth_resources.items():
                z.writestr(gate.R24_DEST + '/' + name, value)
        raw = data.getvalue()
        self.smooth_encoded = base64.b64encode(raw) + b'\n'
        gate.R24_SMOOTH_ARCHIVE_SHA = gate.sha256(raw)
        gate.R24_SMOOTH_ARCHIVE_B64_SHA = gate.sha256(self.smooth_encoded)
        gate.R24_SMOOTH_ASSET_HASHES = {name: gate.sha256(data)
                                       for name, data in self.smooth_resources.items()}

    def verify_smooth(self, old=None, new=None):
        return gate.verify_r24_archive_update(self.workflow,
            self.question_encoded if old is None else old,
            self.smooth_encoded if new is None else new, self.zipbytes, self.trusted)

    def test_all_four_frozen_snapshots_remain_readable(self):
        for encoded, resources in ((self.old_encoded, self.resources),
                (self.new_encoded, self.new_resources),
                (self.question_encoded, self.question_resources),
                (self.smooth_encoded, self.smooth_resources)):
            self.assertEqual(gate.r24_resource_bytes(encoded), resources)

    def test_exact_worker_addition_and_reverse_preserve_every_older_asset(self):
        with mock.patch.object(gate, 'r24_rebuild_previous_stages', side_effect=self.rebuild_fixture):
            update = self.verify_smooth()
            rollback = self.verify_smooth(self.smooth_encoded, self.question_encoded)
        self.assertEqual(update['direction'], 'update')
        self.assertEqual(rollback['direction'], 'rollback')
        self.assertEqual(update['total_assets'], len(self.baselines) + len(self.smooth_resources))
        self.assertEqual(rollback['total_assets'], len(self.baselines) + len(self.question_resources))
        self.assertEqual(update['protected_assets'], len(self.baselines))
        expected = sorted(gate.R24_DEST + '/' + name for name in gate.R24_SMOOTH_CHANGED_FILES)
        self.assertEqual(update['changed'], expected)
        self.assertEqual(rollback['changed'], expected)

    def test_smooth_cannot_skip_or_repeat_versions(self):
        for pair in ((self.old_encoded, self.smooth_encoded),
                     (self.new_encoded, self.smooth_encoded),
                     (self.smooth_encoded, self.new_encoded),
                     (self.smooth_encoded, self.smooth_encoded)):
            with self.assertRaisesRegex(gate.GateFailure, 'exact old/new snapshot pair'):
                self.verify_smooth(*pair)

    def test_only_the_one_worker_may_be_added_even_with_fully_repinned_archives(self):
        self.smooth_resources['another-worker.mjs'] = b'export const surprise = 1;'
        self.freeze_smooth()
        with self.assertRaisesRegex(gate.GateFailure, 'static resource set'):
            self.verify_smooth()

    def test_reviewed_worker_addition_cannot_be_omitted(self):
        del self.smooth_resources['whisper-worker.mjs']
        self.freeze_smooth()
        with self.assertRaisesRegex(gate.GateFailure, 'static resource set'):
            self.verify_smooth()

    def test_no_existing_resource_may_be_deleted_in_update(self):
        del self.smooth_resources['index.html']
        self.freeze_smooth()
        with self.assertRaisesRegex(gate.GateFailure, 'static resource set'):
            self.verify_smooth()

    def test_rollback_cannot_delete_anything_but_the_worker(self):
        del self.question_resources['index.html']
        self.freeze_question()
        with self.assertRaisesRegex(gate.GateFailure, 'static resource set'):
            self.verify_smooth(self.smooth_encoded, self.question_encoded)

    def test_smooth_cannot_rewrite_unrelated_resources_even_when_repinned(self):
        self.smooth_resources['lib/parser.js'] = b'export const parser = 4;'
        self.freeze_smooth()
        with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed five files'):
            self.verify_smooth()

    def test_omitting_any_expected_change_is_rejected(self):
        self.smooth_resources['whisper-bridge.mjs'] = self.question_resources['whisper-bridge.mjs']
        self.freeze_smooth()
        with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed five files'):
            self.verify_smooth()

    def test_unfrozen_smooth_does_not_block_existing_live_snapshot(self):
        with mock.patch.object(gate, 'R24_SMOOTH_ARCHIVE_SHA', 'PENDING_SOURCE_FREEZE'):
            self.assertEqual(gate.r24_resource_bytes(self.question_encoded), self.question_resources)
            with self.assertRaisesRegex(gate.GateFailure, 'not been frozen'):
                gate.r24_resource_bytes(self.smooth_encoded)


class R24ReviewStabilityUpdateTests(unittest.TestCase):
    freeze_fixture = R24InPlaceUpdateTests.freeze_fixture
    write_archive = R24InPlaceUpdateTests.write_archive
    freeze_update = R24InPlaceUpdateTests.freeze_update
    rebuild_fixture = R24InPlaceUpdateTests.rebuild_fixture
    freeze_question = R24QuestionBankUpdateTests.freeze_question
    freeze_smooth = R24SmoothMobileUpdateTests.freeze_smooth

    def setUp(self):
        R24SmoothMobileUpdateTests.setUp(self)
        self.review_patcher = mock.patch.multiple(gate,
            R24_REVIEW_ASSET_HASHES={}, R24_REVIEW_ARCHIVE_B64_SHA='', R24_REVIEW_ARCHIVE_SHA='')
        self.review_patcher.start()
        self.addCleanup(self.review_patcher.stop)
        self.review_resources = {**self.smooth_resources,
            'app.js': b'export const value = 5;',
            'style.css': b'body { color: blue; overflow-wrap: anywhere; }',
        }
        self.freeze_review()

    def freeze_review(self):
        self.review_resources['static-manifest.json'] = json.dumps({'files': {
            name: gate.sha256(data) for name, data in self.review_resources.items()
            if name != 'static-manifest.json'}}).encode()
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as z:
            for name, value in self.review_resources.items():
                z.writestr(gate.R24_DEST + '/' + name, value)
        raw = data.getvalue()
        self.review_encoded = base64.b64encode(raw) + b'\n'
        gate.R24_REVIEW_ARCHIVE_SHA = gate.sha256(raw)
        gate.R24_REVIEW_ARCHIVE_B64_SHA = gate.sha256(self.review_encoded)
        gate.R24_REVIEW_ASSET_HASHES = {name: gate.sha256(data)
                                       for name, data in self.review_resources.items()}

    def verify_review(self, old=None, new=None):
        return gate.verify_r24_archive_update(self.workflow,
            self.smooth_encoded if old is None else old,
            self.review_encoded if new is None else new, self.zipbytes, self.trusted)

    def test_all_five_frozen_snapshots_remain_readable(self):
        for encoded, resources in ((self.old_encoded, self.resources),
                (self.new_encoded, self.new_resources),
                (self.question_encoded, self.question_resources),
                (self.smooth_encoded, self.smooth_resources),
                (self.review_encoded, self.review_resources)):
            self.assertEqual(gate.r24_resource_bytes(encoded), resources)

    def test_review_update_and_reverse_keep_worker_and_every_older_asset(self):
        with mock.patch.object(gate, 'r24_rebuild_previous_stages', side_effect=self.rebuild_fixture):
            update = self.verify_review()
            rollback = self.verify_review(self.review_encoded, self.smooth_encoded)
        self.assertEqual(update['direction'], 'update')
        self.assertEqual(rollback['direction'], 'rollback')
        self.assertEqual(update['total_assets'], len(self.baselines) + len(self.smooth_resources))
        self.assertEqual(rollback['total_assets'], update['total_assets'])
        self.assertEqual(update['protected_assets'], len(self.baselines))
        expected = sorted(gate.R24_DEST + '/' + name for name in gate.R24_REVIEW_CHANGED_FILES)
        self.assertEqual(update['changed'], expected)
        self.assertEqual(rollback['changed'], expected)
        for name in ('whisper-worker.mjs', 'whisper-bridge.mjs'):
            self.assertEqual(self.review_resources[name], self.smooth_resources[name])

    def test_review_cannot_skip_or_repeat_versions(self):
        for encoded in (self.old_encoded, self.new_encoded, self.question_encoded, self.review_encoded):
            for pair in ((encoded, self.review_encoded), (self.review_encoded, encoded)):
                with self.assertRaisesRegex(gate.GateFailure, 'exact old/new snapshot pair'):
                    self.verify_review(*pair)

    def test_review_cannot_add_an_unreviewed_resource_even_when_repinned(self):
        self.review_resources['another-worker.mjs'] = b'export const surprise = 1;'
        self.freeze_review()
        with self.assertRaisesRegex(gate.GateFailure, 'static resource set'):
            self.verify_review()

    def test_review_cannot_remove_worker_even_when_repinned(self):
        del self.review_resources['whisper-worker.mjs']
        self.freeze_review()
        with self.assertRaisesRegex(gate.GateFailure, 'static resource set'):
            self.verify_review()

    def test_review_cannot_change_worker_or_bridge_even_when_repinned(self):
        for name in ('whisper-worker.mjs', 'whisper-bridge.mjs', 'lib/parser.js'):
            with self.subTest(resource=name):
                before = self.review_resources[name]
                self.review_resources[name] = b'export const unreviewed = 5;'
                self.freeze_review()
                with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed three files'):
                    self.verify_review()
                self.review_resources[name] = before

    def test_review_omitting_an_expected_change_is_rejected(self):
        self.review_resources['style.css'] = self.smooth_resources['style.css']
        self.freeze_review()
        with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed three files'):
            self.verify_review()

    def test_unfrozen_review_does_not_block_existing_four_snapshots(self):
        with mock.patch.object(gate, 'R24_REVIEW_ARCHIVE_SHA', 'PENDING_SOURCE_FREEZE'):
            for encoded, resources in ((self.old_encoded, self.resources),
                    (self.new_encoded, self.new_resources),
                    (self.question_encoded, self.question_resources),
                    (self.smooth_encoded, self.smooth_resources)):
                self.assertEqual(gate.r24_resource_bytes(encoded), resources)
            with self.assertRaisesRegex(gate.GateFailure, 'not been frozen'):
                gate.r24_resource_bytes(self.review_encoded)


class R25AdditiveReleaseTests(unittest.TestCase):
    """R2.5 archive validation and isolation, with no network or real model execution."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        names = tuple(gate.R25_ASSET_HASHES)
        self.resources = {name: (b'export const fixture = true;' if name.endswith(('.js', '.mjs'))
                                else b'fixture') for name in names}
        self.before = 'name: Protected fixture\n' + gate.LAB_ANCHOR
        self.baseline = {'index.html': b'old root',
                         'tcl-v352-asr-r24-qa/app.js': b'old R24'}
        self.site = self.root / 'site'
        self.make_site(self.site)
        patches = dict(R25_ARCHIVE_B64_SHA='', R25_ARCHIVE_SHA='', R25_ASSET_HASHES={},
                       R25_BASELINE_WORKFLOW_SHA=gate.sha256(self.before.encode()),
                       R25_BASELINE_FILES=len(self.baseline), R25_BASELINE_TREE_SHA='')
        patcher = mock.patch.multiple(gate, **patches)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.set_baseline_pin(self.site)
        self.freeze()

    def make_site(self, site):
        for name, data in self.baseline.items():
            target = site / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        return site

    def set_baseline_pin(self, site):
        hashes = gate.r25_tree_hashes(site)
        gate.R25_BASELINE_TREE_SHA = gate.sha256(json.dumps(
            hashes, sort_keys=True, separators=(',', ':')).encode())

    def freeze(self, resources=None, update_assets=True, version=None, entry_type=None):
        source = dict(self.resources if resources is None else resources)
        source['static-manifest.json'] = json.dumps({
            'version': version or gate.R25_VERSION,
            'files': {n: gate.sha256(v) for n, v in source.items() if n != 'static-manifest.json'},
        }, sort_keys=True).encode()
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, data in source.items():
                info = zipfile.ZipInfo(gate.R25_DEST + '/' + name)
                info.external_attr = (entry_type if entry_type is not None else 0o100644) << 16
                archive.writestr(info, data)
        self.raw = buf.getvalue()
        self.encoded = base64.b64encode(self.raw) + b'\n'
        gate.R25_ARCHIVE_SHA = gate.sha256(self.raw)
        gate.R25_ARCHIVE_B64_SHA = gate.sha256(self.encoded)
        if update_assets:
            gate.R25_ASSET_HASHES = {n: gate.sha256(v) for n, v in source.items()}
        self.frozen_resources = source
        self.archive = self.root / 'r25.zip.b64'
        self.archive.write_bytes(self.encoded)

    def test_exact_static_bundle_stages_and_preserves_all_older_bytes(self):
        self.assertEqual(gate.r25_resource_bytes(self.encoded), self.frozen_resources)
        report = gate.stage_r25(self.site, self.archive)
        self.assertEqual(report['files'], 22)
        self.assertEqual(report['old_assets_unchanged'], len(self.baseline))
        self.assertEqual(report['total_assets'], len(self.baseline) + 22)
        for name, data in self.baseline.items():
            self.assertEqual((self.site / name).read_bytes(), data)

    def test_encoded_hash_or_size_mutation_rejected(self):
        for data in (self.encoded + b'\n', b'x' * (gate.R25_MAX_ENCODED_BYTES + 1)):
            with self.assertRaisesRegex(gate.GateFailure, 'encoded archive'):
                gate.r25_resource_bytes(data)

    def test_zip_hash_mismatch_rejected(self):
        with mock.patch.object(gate, 'R25_ARCHIVE_SHA', '0' * 64):
            with self.assertRaisesRegex(gate.GateFailure, 'ZIP archive'):
                gate.r25_resource_bytes(self.encoded)

    def test_unfrozen_policy_rejected(self):
        with mock.patch.object(gate, 'R25_ARCHIVE_SHA', 'PENDING'):
            with self.assertRaisesRegex(gate.GateFailure, 'not been frozen'):
                gate.r25_resource_bytes(self.encoded)

    def test_repacked_resource_mutation_still_rejected_by_asset_pin(self):
        changed = dict(self.resources, **{'app.js': b'export const changed = 1;'})
        self.freeze(changed, update_assets=False)
        with self.assertRaisesRegex(gate.GateFailure, 'resource hash'):
            gate.r25_resource_bytes(self.encoded)

    def test_added_or_missing_resources_rejected_even_if_repinned(self):
        for add in (True, False):
            changed = dict(self.resources)
            if add:
                changed['extra.js'] = b'export const surprise = 1;'
            else:
                del changed['app.js']
            self.freeze(changed)
            with self.assertRaisesRegex(gate.GateFailure, 'not been frozen'):
                gate.r25_resource_bytes(self.encoded)

    def test_wrong_destination_is_rejected(self):
        raw = self.raw.replace(gate.R25_DEST.encode(), b'tcl-v352-asr-r24-qa')
        encoded = base64.b64encode(raw) + b'\n'
        with mock.patch.multiple(gate, R25_ARCHIVE_SHA=gate.sha256(raw),
                                 R25_ARCHIVE_B64_SHA=gate.sha256(encoded)):
            with self.assertRaises(gate.GateFailure):
                gate.r25_resource_bytes(encoded)

    def test_symlink_and_empty_members_rejected(self):
        self.freeze(entry_type=0o120777)
        with self.assertRaises(gate.GateFailure):
            gate.r25_resource_bytes(self.encoded)
        changed = dict(self.resources, **{'app.js': b''})
        self.freeze(changed)
        with self.assertRaisesRegex(gate.GateFailure, 'size invalid'):
            gate.r25_resource_bytes(self.encoded)

    def test_manifest_version_is_not_accepted_by_repinned_hash_alone(self):
        self.freeze(version='unreviewed-version')
        with self.assertRaisesRegex(gate.GateFailure, 'manifest version'):
            gate.r25_resource_bytes(self.encoded)

    def test_existing_route_is_never_overwritten(self):
        output = self.site / gate.R25_DEST
        output.mkdir()
        (output / 'index.html').write_bytes(b'keep')
        with self.assertRaisesRegex(gate.GateFailure, 'refuse overwrite'):
            gate.stage_r25(self.site, self.archive)
        self.assertEqual((output / 'index.html').read_bytes(), b'keep')

    def test_missing_extra_or_mutated_old_assets_fail_closed(self):
        for mode in ('missing', 'extra', 'changed'):
            site = self.make_site(self.root / mode)
            root = site / 'index.html'
            if mode == 'missing':
                root.unlink()
            elif mode == 'extra':
                (site / 'extra.html').write_bytes(b'extra')
            else:
                root.write_bytes(b'changed root')
            with self.assertRaisesRegex(gate.GateFailure, 'protected Pages tree'):
                gate.stage_r25(site, self.archive)
            self.assertFalse((site / gate.R25_DEST).exists())

    def test_existing_symlink_is_rejected(self):
        (self.site / 'outside').symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(gate.GateFailure, 'symlinks'):
            gate.stage_r25(self.site, self.archive)
        self.assertFalse((self.site / gate.R25_DEST).exists())

    def test_old_asset_change_during_final_rename_is_detected(self):
        original = Path.rename
        old = self.site / 'index.html'
        def concurrent_change(path, target):
            result = original(path, target)
            if Path(target) == self.site / gate.R25_DEST:
                old.write_bytes(b'changed during final rename')
            return result
        with mock.patch.object(Path, 'rename', concurrent_change):
            with self.assertRaisesRegex(gate.GateFailure, 'during staging'):
                gate.stage_r25(self.site, self.archive)

    def test_invalid_javascript_never_publishes_partial_route(self):
        changed = dict(self.resources, **{'app.js': b'function { invalid'})
        self.freeze(changed)
        with self.assertRaisesRegex(gate.GateFailure, 'syntax check'):
            gate.stage_r25(self.site, self.archive)
        self.assertFalse((self.site / gate.R25_DEST).exists())
        self.assertEqual((self.site / 'index.html').read_bytes(), self.baseline['index.html'])

    def rebuild_fixture(self, root, zipbytes, trusted):
        return self.make_site(root / '_site')

    def test_exact_addition_and_reverse_only_rollback(self):
        after = self.before.replace(gate.LAB_ANCHOR, gate.r25_stage_step() + gate.LAB_ANCHOR)
        with mock.patch.object(gate, 'r25_rebuild_previous_stages', self.rebuild_fixture):
            result = gate.verify_r25_additive_release(self.before, after, self.encoded, b'fixture', {})
            self.assertEqual(result['total_assets'], len(self.baseline) + 22)
            result = gate.verify_r25_rollback(after, self.before, self.encoded, b'fixture', {})
            self.assertEqual(result['protected_assets'], len(self.baseline))

    def test_workflow_changes_outside_single_insertion_or_removal_fail(self):
        after = self.before.replace(gate.LAB_ANCHOR, gate.r25_stage_step() + gate.LAB_ANCHOR)
        for before, newer in ((self.before + '# extra\n', after),
                              (self.before, after + '# extra\n'),
                              (self.before, self.before),
                              (self.before, after.replace('python3', 'python3 -I', 1))):
            with self.assertRaises(gate.GateFailure):
                gate.verify_r25_additive_release(before, newer, self.encoded, b'fixture', {})
        for current, rolled in ((after, self.before + '# extra\n'),
                                (after + '# extra\n', self.before), (after, after)):
            with self.assertRaises(gate.GateFailure):
                gate.verify_r25_rollback(current, rolled, self.encoded, b'fixture', {})

    def test_rebuild_requires_exact_trusted_set_zip_and_current_r24(self):
        trusted = {n: b'fixture' for n in gate.R25_TRUSTED_INPUTS}
        with self.assertRaisesRegex(gate.GateFailure, 'input set'):
            gate.r25_rebuild_previous_stages(self.root, b'', {})
        with self.assertRaisesRegex(gate.GateFailure, 'site.zip'):
            gate.r25_rebuild_previous_stages(self.root, b'', trusted)
        with mock.patch.object(gate, 'LAB_BASELINE_ZIP_SHA256', gate.sha256(b'fixture')):
            with self.assertRaisesRegex(gate.GateFailure, 'current R2.4'):
                gate.r25_rebuild_previous_stages(self.root, b'fixture', trusted)

    def test_source_edits_do_not_match_release_class(self):
        for paths in (gate.R25_ARCHIVE + '\nexperiments/r25/app.js\n',
                gate.R25_ARCHIVE + '\n.github/workflows/pages.yml\nexperiments/r25/app.js\n'):
            with mock.patch.object(gate.subprocess, 'check_output', return_value=paths):
                with self.assertRaises(gate.GateFailure):
                    gate.verify_pr('a' * 40, 'b' * 40)


class R25CloudUpdateTests(unittest.TestCase):
    """Frozen static release policy only; these fixtures do not test the cloud API."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.baseline = {'index.html': b'protected root',
                         'tcl-v352-asr-r24-qa/app.js': b'protected R24'}
        self.old_resources = {name: (b'export const old = 1;' if name.endswith(('.js', '.mjs'))
                                    else b'old fixture') for name in gate.R25_ASSET_HASHES}
        self.added = frozenset({'cloud-workflow.mjs', 'cloud-workspace.mjs',
                               'cloudbase-adapter.mjs', 'vendor/cloudbase/cloudbase-sdk.mjs'})
        self.cloud_resources = dict(self.old_resources)
        for name in ('app.js', 'app-config.json', 'index.html', 'style.css'):
            self.cloud_resources[name] = (b'export const cloud = 2;' if name.endswith('.js')
                                           else b'cloud fixture')
        for name in self.added:
            self.cloud_resources[name] = b'export const cloudModule = true;'
        self.before = 'name: Protected fixture\n' + gate.LAB_ANCHOR
        self.workflow = self.before.replace(gate.LAB_ANCHOR, gate.r25_stage_step() + gate.LAB_ANCHOR)
        self.zipbytes = b'protected older site.zip'
        self.trusted = {name: b'base commit input' for name in gate.R25_TRUSTED_INPUTS}
        protected_hashes = {name: gate.sha256(data) for name, data in self.baseline.items()}
        patches = dict(
            R25_ARCHIVE_B64_SHA='', R25_ARCHIVE_SHA='', R25_ASSET_HASHES={},
            R25_CLOUD_ARCHIVE_B64_SHA='', R25_CLOUD_ARCHIVE_SHA='', R25_CLOUD_ASSET_HASHES={},
            R25_CLOUD_FILE_COUNT=len(self.cloud_resources), R25_CLOUD_ADDED_FILES=self.added,
            R25_CLOUD_CHANGED_FILES=frozenset(self.added | {
                'app.js', 'app-config.json', 'index.html', 'style.css', 'static-manifest.json'}),
            R25_RECOVERY_ARCHIVE_B64_SHA='', R25_RECOVERY_ARCHIVE_SHA='',
            R25_RECOVERY_ASSET_HASHES={}, R25_RECOVERY_FILE_COUNT=len(self.cloud_resources),
            R25_NAME_INVITE_ARCHIVE_B64_SHA='', R25_NAME_INVITE_ARCHIVE_SHA='',
            R25_NAME_INVITE_ASSET_HASHES={}, R25_NAME_INVITE_FILE_COUNT=len(self.cloud_resources) + 1,
            R25_NAME_INVITE_CHANGED_FILES=frozenset({'app.js', 'app-config.json',
                'cloud-workflow.mjs', 'cloud-workspace.mjs', 'style.css',
                'name-identity.mjs', 'static-manifest.json'}),
            R25_NAME_INVITE_ADDED_FILES=frozenset({'name-identity.mjs'}),
            R25_DIRECT_ARCHIVE_B64_SHA='', R25_DIRECT_ARCHIVE_SHA='',
            R25_DIRECT_ASSET_HASHES={}, R25_DIRECT_FILE_COUNT=len(self.cloud_resources) + 1,
            R25_REGISTRATION_RECOVERY_ARCHIVE_B64_SHA='', R25_REGISTRATION_RECOVERY_ARCHIVE_SHA='',
            R25_REGISTRATION_RECOVERY_ASSET_HASHES={},
            R25_REGISTRATION_RECOVERY_FILE_COUNT=len(self.cloud_resources) + 1,
            R25_NAME_ENTRY_ARCHIVE_B64_SHA='', R25_NAME_ENTRY_ARCHIVE_SHA='',
            R25_NAME_ENTRY_ASSET_HASHES={}, R25_NAME_ENTRY_FILE_COUNT=len(self.cloud_resources) + 1,
            R25_BASELINE_WORKFLOW_SHA=gate.sha256(self.before.encode()),
            LAB_BASELINE_ZIP_SHA256=gate.sha256(self.zipbytes),
            R25_BASELINE_FILES=len(self.baseline),
            R25_BASELINE_TREE_SHA=gate.sha256(json.dumps(
                protected_hashes, sort_keys=True, separators=(',', ':')).encode()),
        )
        patcher = mock.patch.multiple(gate, **patches)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.old_encoded = self.freeze(self.old_resources, cloud=False)
        self.cloud_encoded = self.freeze(self.cloud_resources)
        self.recovery_resources = dict(self.cloud_resources, **{'app.js': b'export const recovery = 3;'})
        self.recovery_encoded = self.freeze(self.recovery_resources, recovery=True)
        self.name_resources = dict(self.recovery_resources)
        for name in ('app.js', 'app-config.json', 'cloud-workflow.mjs', 'cloud-workspace.mjs', 'style.css'):
            self.name_resources[name] = (b'export const nameInvite = 4;'
                                         if name.endswith(('.js', '.mjs')) else b'name fixture')
        self.name_resources['name-identity.mjs'] = b'export const nameIdentity = true;'
        self.name_encoded = self.freeze(self.name_resources, name_invite=True)
        self.direct_resources = dict(self.name_resources)
        for name in ('app-config.json', 'cloud-workflow.mjs', 'cloud-workspace.mjs', 'name-identity.mjs'):
            self.direct_resources[name] = (b'export const directRegistration = 5;'
                                           if name.endswith('.mjs') else b'direct fixture')
        self.direct_encoded = self.freeze(self.direct_resources, direct=True)
        self.registration_resources = dict(self.direct_resources)
        for name in ('cloud-workflow.mjs', 'cloud-workspace.mjs', 'name-identity.mjs'):
            self.registration_resources[name] = b'export const registrationRecovery = 6;'
        self.registration_encoded = self.freeze(self.registration_resources, registration_recovery=True)
        self.name_entry_resources = dict(self.registration_resources)
        for name in ('app-config.json', 'cloud-workflow.mjs', 'cloud-workspace.mjs', 'name-identity.mjs'):
            self.name_entry_resources[name] = (b'export const nameEntry = 7;'
                                                if name.endswith('.mjs') else b'name entry fixture')
        self.name_entry_encoded = self.freeze(self.name_entry_resources, name_entry=True)

    def freeze(self, resources, cloud=True, version=None, update_assets=True,
               recovery=False, name_invite=False, direct=False, registration_recovery=False,
               name_entry=False):
        if name_entry:
            prefix, default_version = 'R25_NAME_ENTRY_', gate.R25_NAME_ENTRY_VERSION
        elif registration_recovery:
            prefix, default_version = 'R25_REGISTRATION_RECOVERY_', gate.R25_REGISTRATION_RECOVERY_VERSION
        elif direct:
            prefix, default_version = 'R25_DIRECT_', gate.R25_DIRECT_VERSION
        elif name_invite:
            prefix, default_version = 'R25_NAME_INVITE_', gate.R25_NAME_INVITE_VERSION
        elif recovery:
            prefix, default_version = 'R25_RECOVERY_', gate.R25_RECOVERY_VERSION
        elif cloud:
            prefix, default_version = 'R25_CLOUD_', gate.R25_CLOUD_VERSION
        else:
            prefix, default_version = 'R25_', gate.R25_VERSION
        resources['static-manifest.json'] = json.dumps({
            'version': version or default_version,
            'files': {name: gate.sha256(data) for name, data in resources.items()
                      if name != 'static-manifest.json'},
        }, sort_keys=True).encode()
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, value in sorted(resources.items()):
                archive.writestr(gate.R25_DEST + '/' + name, value)
        raw = data.getvalue()
        encoded = base64.b64encode(raw) + b'\n'
        setattr(gate, prefix + 'ARCHIVE_SHA', gate.sha256(raw))
        setattr(gate, prefix + 'ARCHIVE_B64_SHA', gate.sha256(encoded))
        if update_assets:
            setattr(gate, prefix + 'ASSET_HASHES', {name: gate.sha256(value)
                                                   for name, value in resources.items()})
        return encoded

    def make_site(self, path):
        for name, data in self.baseline.items():
            dest = path / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
        return path

    def rebuild_fixture(self, root, zipbytes, trusted):
        self.assertEqual(zipbytes, self.zipbytes)
        self.assertEqual(trusted, self.trusted)
        return self.make_site(root / '_site')

    def verify(self, old=None, new=None, workflow=None, zipbytes=None):
        return gate.verify_r25_archive_update(
            self.workflow if workflow is None else workflow,
            self.old_encoded if old is None else old,
            self.cloud_encoded if new is None else new,
            self.zipbytes if zipbytes is None else zipbytes, self.trusted)

    def test_both_frozen_snapshots_remain_readable(self):
        self.assertEqual(gate.r25_resource_bytes(self.old_encoded), self.old_resources)
        self.assertEqual(gate.r25_resource_bytes(self.cloud_encoded), self.cloud_resources)

    def test_exact_update_and_reverse_preserve_all_older_assets(self):
        with mock.patch.object(gate, 'r25_rebuild_previous_stages', self.rebuild_fixture):
            update = self.verify()
            rollback = self.verify(self.cloud_encoded, self.old_encoded)
        self.assertEqual(update['direction'], 'update')
        self.assertEqual(rollback['direction'], 'rollback')
        self.assertEqual(update['protected_assets'], len(self.baseline))
        self.assertEqual(rollback['protected_assets'], len(self.baseline))
        self.assertEqual(update['total_assets'], len(self.baseline) + len(self.cloud_resources))
        self.assertEqual(rollback['total_assets'], len(self.baseline) + len(self.old_resources))
        expected = sorted(gate.R25_DEST + '/' + name for name in gate.R25_CLOUD_CHANGED_FILES)
        self.assertEqual(update['changed'], expected)
        self.assertEqual(rollback['changed'], expected)

    def test_repeated_unknown_or_nonadjacent_versions_are_rejected(self):
        for old, new in ((self.old_encoded, self.old_encoded),
                         (self.cloud_encoded, self.cloud_encoded),
                         (b'unreviewed older archive', self.cloud_encoded),
                         (self.old_encoded, self.cloud_encoded + b'\n')):
            with self.assertRaisesRegex(gate.GateFailure, 'exact old/new snapshot pair'):
                self.verify(old, new)

    def test_workflow_must_be_identical_including_every_old_stage(self):
        for workflow in (self.workflow + '# extra\n', self.before,
                         self.workflow.replace('Vosk-first', 'Cloud'),
                         self.workflow.replace(gate.r25_stage_step(), gate.r25_stage_step() * 2)):
            with self.assertRaisesRegex(gate.GateFailure, 'exact existing Pages workflow'):
                self.verify(workflow=workflow)

    def test_protected_site_zip_cannot_change(self):
        with self.assertRaisesRegex(gate.GateFailure, 'protected site.zip'):
            self.verify(zipbytes=self.zipbytes + b'changed')

    def test_fully_repinned_extra_resource_is_not_a_reviewed_addition(self):
        self.cloud_resources['another-worker.mjs'] = b'export const surprise = true;'
        gate.R25_CLOUD_FILE_COUNT += 1
        self.cloud_encoded = self.freeze(self.cloud_resources)
        with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed resource set'):
            self.verify()

    def test_fully_repinned_removal_of_old_resource_is_rejected(self):
        del self.cloud_resources['whisper-worker.mjs']
        gate.R25_CLOUD_FILE_COUNT -= 1
        self.cloud_encoded = self.freeze(self.cloud_resources)
        with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed resource set'):
            self.verify()

    def test_fully_repinned_unapproved_existing_change_is_rejected(self):
        self.cloud_resources['whisper-bridge.mjs'] = b'export const surprise = true;'
        self.cloud_encoded = self.freeze(self.cloud_resources)
        with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed scope'):
            self.verify()

    def test_omitting_a_required_reviewed_change_is_rejected(self):
        self.cloud_resources['app.js'] = self.old_resources['app.js']
        self.cloud_encoded = self.freeze(self.cloud_resources)
        with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed scope'):
            self.verify()

    def test_cloud_archive_repacking_cannot_bypass_individual_asset_pin(self):
        self.cloud_resources['cloud-workflow.mjs'] = b'export const surprise = true;'
        self.cloud_encoded = self.freeze(self.cloud_resources, update_assets=False)
        with self.assertRaisesRegex(gate.GateFailure, 'resource hash mismatch'):
            gate.r25_resource_bytes(self.cloud_encoded)

    def test_cloud_manifest_version_cannot_be_changed_by_repinning_hashes(self):
        self.cloud_encoded = self.freeze(self.cloud_resources, version='unreviewed-cloud')
        with self.assertRaisesRegex(gate.GateFailure, 'manifest version'):
            gate.r25_resource_bytes(self.cloud_encoded)

    def test_pending_cloud_policy_does_not_block_the_deployed_snapshot(self):
        with mock.patch.object(gate, 'R25_CLOUD_ARCHIVE_SHA', 'PENDING_SOURCE_FREEZE'):
            self.assertEqual(gate.r25_resource_bytes(self.old_encoded), self.old_resources)
            with self.assertRaisesRegex(gate.GateFailure, 'not been frozen'):
                gate.r25_resource_bytes(self.cloud_encoded)

    def test_larger_resource_limit_applies_only_to_cloud_snapshot(self):
        content = b'/*' + base64.b64encode(os.urandom(565_000)) + b'*/'
        self.assertGreater(len(content), gate.R25_MAX_RESOURCE_BYTES)
        self.cloud_resources['vendor/cloudbase/cloudbase-sdk.mjs'] = content
        self.cloud_encoded = self.freeze(self.cloud_resources)
        self.assertEqual(gate.r25_resource_bytes(self.cloud_encoded), self.cloud_resources)
        self.old_resources['app.js'] = content
        self.old_encoded = self.freeze(self.old_resources, cloud=False)
        with self.assertRaisesRegex(gate.GateFailure, 'size invalid'):
            gate.r25_resource_bytes(self.old_encoded)

    def test_cloud_resource_size_remains_bounded_even_when_repinned(self):
        content = b'/*' + base64.b64encode(os.urandom(750_001)) + b'*/'
        self.assertGreater(len(content), gate.R25_CLOUD_MAX_RESOURCE_BYTES)
        self.cloud_resources['vendor/cloudbase/cloudbase-sdk.mjs'] = content
        self.cloud_encoded = self.freeze(self.cloud_resources)
        with self.assertRaisesRegex(gate.GateFailure, 'size invalid'):
            gate.r25_resource_bytes(self.cloud_encoded)

    def test_invalid_new_javascript_never_stages_a_partial_route(self):
        self.cloud_resources['cloud-workspace.mjs'] = b'function { invalid'
        self.cloud_encoded = self.freeze(self.cloud_resources)
        site = self.make_site(self.root / 'invalid-script')
        archive = self.root / 'invalid-script.zip.b64'
        archive.write_bytes(self.cloud_encoded)
        with self.assertRaisesRegex(gate.GateFailure, 'syntax check'):
            gate.stage_r25(site, archive)
        self.assertFalse((site / gate.R25_DEST).exists())
        self.assertEqual((site / 'index.html').read_bytes(), self.baseline['index.html'])

    def test_older_asset_change_after_staging_is_rejected(self):
        original = gate.stage_r25
        def changing_stage(site, archive):
            result = original(site, archive)
            if Path(site).name == '_updated_site':
                (Path(site) / 'index.html').write_bytes(b'corrupted older root')
            return result
        with mock.patch.object(gate, 'r25_rebuild_previous_stages', self.rebuild_fixture):
            with mock.patch.object(gate, 'stage_r25', changing_stage):
                with self.assertRaisesRegex(gate.GateFailure, 'older Pages resource'):
                    self.verify()

    def test_extra_final_tree_resource_outside_r25_is_rejected(self):
        original = gate.stage_r25
        def extra_stage(site, archive):
            result = original(site, archive)
            if Path(site).name == '_updated_site':
                (Path(site) / 'surprise.html').write_bytes(b'unreviewed route')
            return result
        with mock.patch.object(gate, 'r25_rebuild_previous_stages', self.rebuild_fixture):
            with mock.patch.object(gate, 'stage_r25', extra_stage):
                with self.assertRaisesRegex(gate.GateFailure, 'final Pages trees'):
                    self.verify()

    def test_archive_only_pr_uses_only_base_commit_trusted_inputs(self):
        base, head = 'a' * 40, 'b' * 40
        calls = []
        def output(command, **options):
            calls.append(command)
            if command[:2] == ['git', 'diff']:
                return gate.R25_ARCHIVE + '\n'
            self.assertEqual(command[:2], ['git', 'show'])
            return command[2].encode()
        with mock.patch.object(gate.subprocess, 'check_output', side_effect=output):
            with mock.patch.object(gate, 'verify_r25_archive_update') as verify:
                self.assertEqual(gate.verify_pr(base, head), 0)
        args = verify.call_args.args
        self.assertEqual(args[0], base + ':.github/workflows/pages.yml')
        self.assertEqual(args[1:4], ((base + ':' + gate.R25_ARCHIVE).encode(),
            (head + ':' + gate.R25_ARCHIVE).encode(), (base + ':site.zip').encode()))
        self.assertEqual(args[4], {name: (base + ':' + name).encode() for name in gate.R25_TRUSTED_INPUTS})
        self.assertEqual([cmd[2] for cmd in calls if cmd[:2] == ['git', 'show'] and cmd[2].startswith(head + ':')],
                         [head + ':' + gate.R25_ARCHIVE])

    def test_archive_update_cannot_mix_with_ci_workflow_or_source_edits(self):
        for path in ('release-ci/release_guard.py', 'AI_CONTEXT.md',
                     'backend/schema.sql', 'experiments/r25/cloud-workflow.mjs'):
            with mock.patch.object(gate.subprocess, 'check_output',
                                   return_value=gate.R25_ARCHIVE + '\n' + path + '\n'):
                with self.assertRaisesRegex(gate.GateFailure, 'split release, CI and unrelated'):
                    gate.verify_pr('a' * 40, 'b' * 40)

    def test_existing_route_update_cannot_also_change_pages_workflow(self):
        def output(command, **options):
            if command[:2] == ['git', 'diff']:
                return gate.R25_ARCHIVE + '\n.github/workflows/pages.yml\n'
            if command[:2] == ['git', 'ls-tree']:
                return gate.R25_ARCHIVE + '\n'
            return b'base commit trusted input'
        with mock.patch.object(gate.subprocess, 'check_output', side_effect=output):
            with mock.patch.object(gate, 'verify_r25_archive_update') as verify:
                with self.assertRaisesRegex(gate.GateFailure, 'only exact additive release or full route rollback'):
                    gate.verify_pr('a' * 40, 'b' * 40)
                verify.assert_not_called()

    def test_all_three_snapshots_remain_independently_readable(self):
        for encoded, resources in ((self.old_encoded, self.old_resources),
                                   (self.cloud_encoded, self.cloud_resources),
                                   (self.recovery_encoded, self.recovery_resources)):
            self.assertEqual(gate.r25_resource_bytes(encoded), resources)

    def test_exact_recovery_update_and_reverse_keep_every_older_resource(self):
        with mock.patch.object(gate, 'r25_rebuild_previous_stages', self.rebuild_fixture):
            update = self.verify(self.cloud_encoded, self.recovery_encoded)
            rollback = self.verify(self.recovery_encoded, self.cloud_encoded)
        self.assertEqual(update['direction'], 'update')
        self.assertEqual(rollback['direction'], 'rollback')
        for result in (update, rollback):
            self.assertEqual(result['protected_assets'], len(self.baseline))
            self.assertEqual(result['total_assets'], len(self.baseline) + len(self.cloud_resources))
            self.assertEqual(result['changed'], [gate.R25_DEST + '/app.js',
                                                 gate.R25_DEST + '/static-manifest.json'])

    def test_recovery_cannot_skip_cloud_snapshot_or_repeat_itself(self):
        for old, new in ((self.old_encoded, self.recovery_encoded),
                         (self.recovery_encoded, self.old_encoded),
                         (self.recovery_encoded, self.recovery_encoded)):
            with self.assertRaisesRegex(gate.GateFailure, 'exact old/new snapshot pair'):
                self.verify(old, new)

    def test_recovery_cannot_add_or_remove_resources_even_when_fully_repinned(self):
        for add in (True, False):
            resources = dict(self.recovery_resources)
            if add:
                resources['another-worker.mjs'] = b'export const surprise = true;'
            else:
                del resources['whisper-worker.mjs']
            gate.R25_RECOVERY_FILE_COUNT = len(resources)
            encoded = self.freeze(resources, recovery=True)
            with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed resource set'):
                self.verify(self.cloud_encoded, encoded)

    def test_recovery_cannot_rewrite_config_sdk_or_asr_even_when_fully_repinned(self):
        for name in ('app-config.json', 'vendor/cloudbase/cloudbase-sdk.mjs',
                     'whisper-worker.mjs', 'cloud-workflow.mjs'):
            resources = dict(self.recovery_resources)
            resources[name] = b'export const unreviewed = true;'
            encoded = self.freeze(resources, recovery=True)
            with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed scope'):
                self.verify(self.cloud_encoded, encoded)

    def test_recovery_cannot_omit_the_app_change(self):
        self.recovery_resources['app.js'] = self.cloud_resources['app.js']
        encoded = self.freeze(self.recovery_resources, recovery=True)
        with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed scope'):
            self.verify(self.cloud_encoded, encoded)

    def test_pending_recovery_pins_do_not_block_asr_or_current_cloud(self):
        with mock.patch.object(gate, 'R25_RECOVERY_ARCHIVE_SHA', 'PENDING_SOURCE_FREEZE'):
            self.assertEqual(gate.r25_resource_bytes(self.old_encoded), self.old_resources)
            self.assertEqual(gate.r25_resource_bytes(self.cloud_encoded), self.cloud_resources)
            with self.assertRaisesRegex(gate.GateFailure, 'not been frozen'):
                gate.r25_resource_bytes(self.recovery_encoded)

    def test_all_four_snapshots_remain_independently_readable(self):
        for encoded, resources in ((self.old_encoded, self.old_resources),
                                   (self.cloud_encoded, self.cloud_resources),
                                   (self.recovery_encoded, self.recovery_resources),
                                   (self.name_encoded, self.name_resources)):
            self.assertEqual(gate.r25_resource_bytes(encoded), resources)

    def test_exact_name_invite_update_and_reverse_preserve_all_older_bytes(self):
        with mock.patch.object(gate, 'r25_rebuild_previous_stages', self.rebuild_fixture):
            update = self.verify(self.recovery_encoded, self.name_encoded)
            rollback = self.verify(self.name_encoded, self.recovery_encoded)
        self.assertEqual(update['direction'], 'update')
        self.assertEqual(rollback['direction'], 'rollback')
        self.assertEqual(update['total_assets'], len(self.baseline) + len(self.name_resources))
        self.assertEqual(rollback['total_assets'], len(self.baseline) + len(self.recovery_resources))
        for result in (update, rollback):
            self.assertEqual(result['protected_assets'], len(self.baseline))
            self.assertEqual(result['changed'], sorted(gate.R25_DEST + '/' + name
                                                       for name in gate.R25_NAME_INVITE_CHANGED_FILES))

    def test_name_invite_cannot_skip_asr_or_cloud_versions_or_repeat_itself(self):
        for old, new in ((self.old_encoded, self.name_encoded),
                         (self.name_encoded, self.old_encoded),
                         (self.cloud_encoded, self.name_encoded),
                         (self.name_encoded, self.cloud_encoded),
                         (self.name_encoded, self.name_encoded)):
            with self.assertRaisesRegex(gate.GateFailure, 'exact old/new snapshot pair'):
                self.verify(old, new)

    def test_name_invite_cannot_ship_backend_code_even_when_fully_repinned(self):
        self.name_resources['backend/account-create.js'] = b'export const secretServerCode = true;'
        gate.R25_NAME_INVITE_FILE_COUNT += 1
        encoded = self.freeze(self.name_resources, name_invite=True)
        with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed resource set'):
            self.verify(self.recovery_encoded, encoded)

    def test_name_invite_cannot_remove_an_existing_resource_even_when_fully_repinned(self):
        del self.name_resources['whisper-worker.mjs']
        gate.R25_NAME_INVITE_FILE_COUNT -= 1
        encoded = self.freeze(self.name_resources, name_invite=True)
        with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed resource set'):
            self.verify(self.recovery_encoded, encoded)

    def test_name_invite_cannot_rewrite_unreviewed_asr_or_sdk_even_when_repinned(self):
        for name in ('whisper-worker.mjs', 'asr-normalize.mjs',
                     'vendor/cloudbase/cloudbase-sdk.mjs'):
            resources = dict(self.name_resources)
            resources[name] = b'export const unreviewed = true;'
            encoded = self.freeze(resources, name_invite=True)
            with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed scope'):
                self.verify(self.recovery_encoded, encoded)

    def test_pending_name_invite_policy_does_not_block_the_three_deployed_snapshots(self):
        with mock.patch.object(gate, 'R25_NAME_INVITE_ARCHIVE_SHA', 'PENDING_SOURCE_FREEZE'):
            for encoded, resources in ((self.old_encoded, self.old_resources),
                                       (self.cloud_encoded, self.cloud_resources),
                                       (self.recovery_encoded, self.recovery_resources)):
                self.assertEqual(gate.r25_resource_bytes(encoded), resources)
            with self.assertRaisesRegex(gate.GateFailure, 'not been frozen'):
                gate.r25_resource_bytes(self.name_encoded)

    def test_name_invite_edge_still_checks_older_bytes_after_staging(self):
        original = gate.stage_r25
        def changing_stage(site, archive):
            result = original(site, archive)
            if Path(site).name == '_updated_site':
                (Path(site) / 'index.html').write_bytes(b'corrupted older root')
            return result
        with mock.patch.object(gate, 'r25_rebuild_previous_stages', self.rebuild_fixture):
            with mock.patch.object(gate, 'stage_r25', changing_stage):
                with self.assertRaisesRegex(gate.GateFailure, 'older Pages resource'):
                    self.verify(self.recovery_encoded, self.name_encoded)


    def test_direct_five_snapshots_remain_readable(self):
        for encoded, resources in ((self.old_encoded, self.old_resources),
                                   (self.cloud_encoded, self.cloud_resources),
                                   (self.recovery_encoded, self.recovery_resources),
                                   (self.name_encoded, self.name_resources),
                                   (self.direct_encoded, self.direct_resources)):
            self.assertEqual(gate.r25_resource_bytes(encoded), resources)

    def test_direct_exact_adjacent_update_reverse_preserve_older_assets(self):
        with mock.patch.object(gate, 'r25_rebuild_previous_stages', self.rebuild_fixture):
            update = self.verify(self.name_encoded, self.direct_encoded)
            rollback = self.verify(self.direct_encoded, self.name_encoded)
        self.assertEqual(update['direction'], 'update')
        self.assertEqual(rollback['direction'], 'rollback')
        for result in (update, rollback):
            self.assertEqual(result['protected_assets'], len(self.baseline))
            self.assertEqual(result['total_assets'], len(self.baseline) + len(self.name_resources))
            self.assertEqual(result['changed'], sorted(gate.R25_DEST + '/' + name
                                                       for name in gate.R25_DIRECT_CHANGED_FILES))

    def test_direct_cannot_skip_older_snapshots_or_repeat_itself(self):
        for encoded in (self.old_encoded, self.cloud_encoded, self.recovery_encoded, self.direct_encoded):
            for old, new in ((encoded, self.direct_encoded), (self.direct_encoded, encoded)):
                with self.assertRaisesRegex(gate.GateFailure, 'exact old/new snapshot pair'):
                    self.verify(old, new)

    def test_direct_cannot_ship_backend_or_remove_resources_when_repinned(self):
        for addition in (True, False):
            resources = dict(self.direct_resources)
            if addition:
                resources['backend/account-create.js'] = b'export const backend = true;'
            else:
                del resources['whisper-worker.mjs']
            gate.R25_DIRECT_FILE_COUNT = len(resources)
            encoded = self.freeze(resources, direct=True)
            with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed resource set'):
                self.verify(self.name_encoded, encoded)

    def test_direct_cannot_rewrite_app_asr_sdk_or_style_even_when_repinned(self):
        for name in ('app.js', 'whisper-worker.mjs', 'asr-normalize.mjs',
                     'cloudbase-adapter.mjs', 'vendor/cloudbase/cloudbase-sdk.mjs', 'style.css'):
            resources = dict(self.direct_resources)
            resources[name] = b'export const unreviewed = true;'
            encoded = self.freeze(resources, direct=True)
            with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed scope'):
                self.verify(self.name_encoded, encoded)

    def test_direct_requires_every_reviewed_change(self):
        for name in ('app-config.json', 'cloud-workflow.mjs', 'cloud-workspace.mjs', 'name-identity.mjs'):
            resources = dict(self.direct_resources)
            resources[name] = self.name_resources[name]
            encoded = self.freeze(resources, direct=True)
            with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed scope'):
                self.verify(self.name_encoded, encoded)

    def test_pending_direct_pins_preserve_all_four_earlier_snapshots(self):
        with mock.patch.object(gate, 'R25_DIRECT_ARCHIVE_SHA', 'PENDING_SOURCE_FREEZE'):
            for encoded in (self.old_encoded, self.cloud_encoded, self.recovery_encoded, self.name_encoded):
                gate.r25_resource_bytes(encoded)
            with self.assertRaisesRegex(gate.GateFailure, 'not been frozen'):
                gate.r25_resource_bytes(self.direct_encoded)

    def test_direct_edge_checks_old_217_bytes_and_protected_zip(self):
        with self.assertRaisesRegex(gate.GateFailure, 'protected site.zip'):
            self.verify(self.name_encoded, self.direct_encoded, zipbytes=b'changed protected bytes')
        original = gate.stage_r25
        def corrupt_older(site, archive):
            result = original(site, archive)
            if Path(site).name == '_updated_site':
                (Path(site) / 'index.html').write_bytes(b'corrupted older root')
            return result
        with mock.patch.object(gate, 'r25_rebuild_previous_stages', self.rebuild_fixture):
            with mock.patch.object(gate, 'stage_r25', corrupt_older):
                with self.assertRaisesRegex(gate.GateFailure, 'older Pages resource'):
                    self.verify(self.name_encoded, self.direct_encoded)

    def test_registration_recovery_all_six_frozen_snapshots_remain_readable(self):
        for encoded, resources in ((self.old_encoded, self.old_resources),
                                   (self.cloud_encoded, self.cloud_resources),
                                   (self.recovery_encoded, self.recovery_resources),
                                   (self.name_encoded, self.name_resources),
                                   (self.direct_encoded, self.direct_resources),
                                   (self.registration_encoded, self.registration_resources)):
            self.assertEqual(gate.r25_resource_bytes(encoded), resources)

    def test_registration_recovery_update_from_deployed_name_and_candidate_direct_and_reverse(self):
        with mock.patch.object(gate, 'r25_rebuild_previous_stages', self.rebuild_fixture):
            for previous, changed in ((self.name_encoded, gate.R25_REGISTRATION_RECOVERY_FROM_NAME_CHANGED_FILES),
                                      (self.direct_encoded, gate.R25_REGISTRATION_RECOVERY_CHANGED_FILES)):
                update = self.verify(previous, self.registration_encoded)
                rollback = self.verify(self.registration_encoded, previous)
                self.assertEqual(update['direction'], 'update')
                self.assertEqual(rollback['direction'], 'rollback')
                for result in (update, rollback):
                    self.assertEqual(result['protected_assets'], len(self.baseline))
                    self.assertEqual(result['total_assets'], len(self.baseline) + len(self.name_resources))
                    self.assertEqual(result['changed'], sorted(gate.R25_DEST + '/' + name for name in changed))

    def test_registration_recovery_rejects_unrelated_and_repeated_snapshot_pairs(self):
        for encoded in (self.old_encoded, self.cloud_encoded, self.recovery_encoded, self.registration_encoded):
            for old, new in ((encoded, self.registration_encoded), (self.registration_encoded, encoded)):
                with self.assertRaisesRegex(gate.GateFailure, 'exact old/new snapshot pair'):
                    self.verify(old, new)

    def test_registration_recovery_rejects_unpinned_bytes_and_wrong_zip_pin(self):
        with self.assertRaisesRegex(gate.GateFailure, 'encoded archive hash'):
            gate.r25_resource_bytes(self.registration_encoded + b' ')
        with mock.patch.object(gate, 'R25_REGISTRATION_RECOVERY_ARCHIVE_SHA', 'f' * 64):
            with self.assertRaisesRegex(gate.GateFailure, 'ZIP archive hash'):
                gate.r25_resource_bytes(self.registration_encoded)

    def test_registration_recovery_cannot_add_backend_or_remove_resources_when_repinned(self):
        for addition in (True, False):
            resources = dict(self.registration_resources)
            if addition:
                resources['backend/recovery-token.js'] = b'export const forbidden = true;'
            else:
                del resources['whisper-worker.mjs']
            gate.R25_REGISTRATION_RECOVERY_FILE_COUNT = len(resources)
            encoded = self.freeze(resources, registration_recovery=True)
            for previous in (self.name_encoded, self.direct_encoded):
                with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed resource set'):
                    self.verify(previous, encoded)

    def test_registration_recovery_cannot_rewrite_unreviewed_product_bytes_when_repinned(self):
        for name in ('app.js', 'app-config.json', 'whisper-worker.mjs', 'asr-normalize.mjs',
                     'cloudbase-adapter.mjs', 'vendor/cloudbase/cloudbase-sdk.mjs', 'style.css'):
            resources = dict(self.registration_resources)
            resources[name] = b'export const unreviewed = true;'
            encoded = self.freeze(resources, registration_recovery=True)
            with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed scope'):
                self.verify(self.direct_encoded, encoded)

    def test_registration_recovery_requires_all_four_reviewed_changes(self):
        for name in ('cloud-workflow.mjs', 'cloud-workspace.mjs', 'name-identity.mjs'):
            resources = dict(self.registration_resources)
            resources[name] = self.direct_resources[name]
            encoded = self.freeze(resources, registration_recovery=True)
            with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed scope'):
                self.verify(self.direct_encoded, encoded)

    def test_pending_registration_recovery_pins_do_not_affect_earlier_snapshots(self):
        with mock.patch.object(gate, 'R25_REGISTRATION_RECOVERY_ARCHIVE_SHA', 'PENDING_SOURCE_FREEZE'):
            for encoded in (self.old_encoded, self.cloud_encoded, self.recovery_encoded,
                            self.name_encoded, self.direct_encoded):
                gate.r25_resource_bytes(encoded)
            with self.assertRaisesRegex(gate.GateFailure, 'not been frozen'):
                gate.r25_resource_bytes(self.registration_encoded)

    def test_registration_recovery_checks_protected_zip_workflow_and_older_assets(self):
        with self.assertRaisesRegex(gate.GateFailure, 'protected site.zip'):
            self.verify(self.name_encoded, self.registration_encoded, zipbytes=b'changed protected bytes')
        with self.assertRaisesRegex(gate.GateFailure, 'exact existing Pages workflow'):
            self.verify(self.name_encoded, self.registration_encoded, workflow=self.workflow + '#changed')
        original = gate.stage_r25
        def corrupt_older(site, archive):
            result = original(site, archive)
            if Path(site).name == '_updated_site':
                (Path(site) / 'index.html').write_bytes(b'corrupted older root')
            return result
        with mock.patch.object(gate, 'r25_rebuild_previous_stages', self.rebuild_fixture):
            with mock.patch.object(gate, 'stage_r25', corrupt_older):
                with self.assertRaisesRegex(gate.GateFailure, 'older Pages resource'):
                    self.verify(self.name_encoded, self.registration_encoded)

    def test_name_entry_preserves_all_seven_frozen_snapshots(self):
        for encoded, resources in ((self.old_encoded, self.old_resources),
                                   (self.cloud_encoded, self.cloud_resources),
                                   (self.recovery_encoded, self.recovery_resources),
                                   (self.name_encoded, self.name_resources),
                                   (self.direct_encoded, self.direct_resources),
                                   (self.registration_encoded, self.registration_resources),
                                   (self.name_entry_encoded, self.name_entry_resources)):
            self.assertEqual(gate.r25_resource_bytes(encoded), resources)

    def test_name_entry_exact_adjacent_update_and_reverse_preserve_all_older_assets(self):
        with mock.patch.object(gate, 'r25_rebuild_previous_stages', self.rebuild_fixture):
            update = self.verify(self.registration_encoded, self.name_entry_encoded)
            rollback = self.verify(self.name_entry_encoded, self.registration_encoded)
        self.assertEqual(update['direction'], 'update')
        self.assertEqual(rollback['direction'], 'rollback')
        for result in (update, rollback):
            self.assertEqual(result['protected_assets'], len(self.baseline))
            self.assertEqual(result['total_assets'], len(self.baseline) + len(self.name_entry_resources))
            self.assertEqual(result['changed'], sorted(gate.R25_DEST + '/' + name
                                                       for name in gate.R25_NAME_ENTRY_CHANGED_FILES))

    def test_name_entry_rejects_skips_and_repeated_snapshot(self):
        for encoded in (self.old_encoded, self.cloud_encoded, self.recovery_encoded,
                        self.name_encoded, self.direct_encoded, self.name_entry_encoded):
            for old, new in ((encoded, self.name_entry_encoded), (self.name_entry_encoded, encoded)):
                with self.assertRaisesRegex(gate.GateFailure, 'exact old/new snapshot pair'):
                    self.verify(old, new)

    def test_name_entry_rejects_unpinned_encoding_and_zip(self):
        with self.assertRaisesRegex(gate.GateFailure, 'encoded archive hash'):
            gate.r25_resource_bytes(self.name_entry_encoded + b' ')
        with mock.patch.object(gate, 'R25_NAME_ENTRY_ARCHIVE_SHA', 'f' * 64):
            with self.assertRaisesRegex(gate.GateFailure, 'ZIP archive hash'):
                gate.r25_resource_bytes(self.name_entry_encoded)

    def test_name_entry_rejects_changed_resource_bytes_even_with_repacked_zip_pins(self):
        resources = dict(self.name_entry_resources)
        resources['name-identity.mjs'] += b'\nexport const tampered = true;'
        encoded = self.freeze(resources, name_entry=True, update_assets=False)
        with self.assertRaisesRegex(gate.GateFailure, 'resource hash mismatch'):
            gate.r25_resource_bytes(encoded)

    def test_name_entry_rejects_backend_or_removed_product_when_fully_repinned(self):
        for addition in (True, False):
            resources = dict(self.name_entry_resources)
            if addition:
                resources['backend/device-recovery.cjs'] = b'export const forbidden = true;'
            else:
                del resources['whisper-worker.mjs']
            gate.R25_NAME_ENTRY_FILE_COUNT = len(resources)
            encoded = self.freeze(resources, name_entry=True)
            with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed resource set'):
                self.verify(self.registration_encoded, encoded)

    def test_name_entry_cannot_rewrite_unreviewed_runtime_even_when_fully_repinned(self):
        for name in ('app.js', 'whisper-worker.mjs', 'asr-normalize.mjs', 'cloudbase-adapter.mjs',
                     'vendor/cloudbase/cloudbase-sdk.mjs', 'style.css', 'index.html'):
            resources = dict(self.name_entry_resources)
            resources[name] = b'export const unreviewed = true;'
            encoded = self.freeze(resources, name_entry=True)
            with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed scope'):
                self.verify(self.registration_encoded, encoded)

    def test_name_entry_requires_all_five_reviewed_changes(self):
        for name in ('app-config.json', 'cloud-workflow.mjs', 'cloud-workspace.mjs', 'name-identity.mjs'):
            resources = dict(self.name_entry_resources)
            resources[name] = self.registration_resources[name]
            encoded = self.freeze(resources, name_entry=True)
            with self.assertRaisesRegex(gate.GateFailure, 'exact reviewed scope'):
                self.verify(self.registration_encoded, encoded)

    def test_pending_name_entry_pins_do_not_affect_previous_snapshots(self):
        with mock.patch.object(gate, 'R25_NAME_ENTRY_ARCHIVE_SHA', 'PENDING_SOURCE_FREEZE'):
            for encoded in (self.old_encoded, self.cloud_encoded, self.recovery_encoded,
                            self.name_encoded, self.direct_encoded, self.registration_encoded):
                gate.r25_resource_bytes(encoded)
            with self.assertRaisesRegex(gate.GateFailure, 'not been frozen'):
                gate.r25_resource_bytes(self.name_entry_encoded)

    def test_name_entry_protects_root_zip_workflow_and_old_assets(self):
        with self.assertRaisesRegex(gate.GateFailure, 'protected site.zip'):
            self.verify(self.registration_encoded, self.name_entry_encoded, zipbytes=b'changed root zip')
        with self.assertRaisesRegex(gate.GateFailure, 'exact existing Pages workflow'):
            self.verify(self.registration_encoded, self.name_entry_encoded, workflow=self.workflow + '#changed')
        original = gate.stage_r25
        def corrupt_older(site, archive):
            result = original(site, archive)
            if Path(site).name == '_updated_site':
                (Path(site) / 'index.html').write_bytes(b'changed older root')
            return result
        with mock.patch.object(gate, 'r25_rebuild_previous_stages', self.rebuild_fixture):
            with mock.patch.object(gate, 'stage_r25', corrupt_older):
                with self.assertRaisesRegex(gate.GateFailure, 'older Pages resource'):
                    self.verify(self.registration_encoded, self.name_entry_encoded)


if __name__=='__main__':
    unittest.main(verbosity=2)

