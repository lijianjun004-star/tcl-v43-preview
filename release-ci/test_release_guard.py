#!/usr/bin/env python3
"""Bounded ZIP and PR policy regressions. Stdlib only, no network."""
import hashlib
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


if __name__=='__main__':
    unittest.main(verbosity=2)

