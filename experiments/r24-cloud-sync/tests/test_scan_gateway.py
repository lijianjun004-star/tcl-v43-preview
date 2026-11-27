"""Regression for staged trees, sparse paths, nested bundles, and safe scanner output."""
import base64
import gzip
import io
from pathlib import Path
import runpy
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile

SCANNER = Path(__file__).with_name('scan-gateway.py')
ROOT = SCANNER.resolve().parents[3]
MODULE = runpy.run_path(str(SCANNER))
PILOT = 'experiments/r24-cloud-sync/'
SCORING = PILOT + 'repository-scoring/'
WORKFLOWS = tuple('.github/workflows/' + name for name in (
    'r24-private-score-archive.yml', 'r24-synthetic-score-acceptance.yml', 'r24-terra-first-pass.yml',
))
HOST = b'api' + b'.openai.com'
KEY_NAME = b'OPENAI' + b'_API_KEY'


class ScanGatewayTest(unittest.TestCase):
    def test_only_fixed_singapore_declarations_are_allowed(self):
        mod = MODULE
        path = mod['SCF_RUNTIME']
        declarations = list(mod['SCF_DECLARATIONS'].values())
        good = b'\n'.join(declarations) + b'\n'
        scan = mod['Scan']()
        scan.marked(path, good)
        self.assertFalse(scan.findings)
        self.assertEqual(len(scan.public_declarations), 2)
        for filename, data, kind in [
            (path, good + declarations[0], 'public-api-key-variable'),
            (path, declarations[1] + b' // altered', 'public-api-host'),
            ('site.zip!' + path, good, 'public-api-host'),
            (path, good + b'console.log(providerKey);\n', 'possible-sensitive-log-argument'),
            (path, good + b'sk' + b'-ExampleNeverAUsableCredential', 'provider-key-like-literal'),
        ]:
            with self.subTest(kind=kind):
                scan = mod['Scan']()
                scan.marked(filename, data)
                self.assertIn((kind, filename), scan.findings)

    def test_reviewed_scoring_files_and_workflows(self):
        paths = [SCORING + name for name in (
            'acceptance.mjs', 'check-no-scoring-fallback.sh', 'terra-round1.mjs',
            'worker.mjs', 'worker.test.mjs', 'README.md', 'run.mjs',
        )]
        for path in [*paths, *WORKFLOWS]:
            with self.subTest(path=path):
                data = (ROOT / path).read_bytes()
                self.assertTrue(HOST in data or KEY_NAME in data)
                scan = MODULE['Scan']()
                scan.marked(path, data)
                self.assertFalse(scan.findings)
                self.assertTrue(scan.scoring_declarations)

    def test_reviewed_declarations_do_not_follow_the_file(self):
        declarations = []
        for name, marker in [('worker.mjs', HOST), ('run.mjs', KEY_NAME)]:
            lines = (ROOT / SCORING / name).read_bytes().splitlines()
            declarations.append(next(line for line in lines if marker in line))
        data = b'\n'.join(declarations)
        for path in [
            PILOT + 'overlay/app.js', PILOT + 'backend/worker.mjs',
            PILOT + 'cloudbase/function.mjs', PILOT + 'stage-site.py',
            SCORING + 'unreviewed.mjs', 'site.zip!' + SCORING + 'worker.mjs',
            'stage/function/' + SCORING + 'run.mjs',
        ]:
            with self.subTest(path=path):
                scan = MODULE['Scan']()
                scan.marked(path, data)
                self.assertIn(('public-api-host', path), scan.findings)
                self.assertIn(('public-api-key-variable', path), scan.findings)

    def test_reviewed_runtime_rejects_duplicates_literals_and_sensitive_logs(self):
        for filename, marker, kind in [
            ('worker.mjs', HOST, 'public-api-host'), ('run.mjs', KEY_NAME, 'public-api-key-variable'),
        ]:
            path = SCORING + filename
            data = (ROOT / path).read_bytes()
            original_line = next(line for line in data.splitlines() if marker in line)
            for revision, finding in [
                (data + original_line + b'\n', kind),
                (data.replace(original_line, original_line + b' // changed context'), kind),
                (data + b'const sample = "sk' + b'-NeverAnIssuedKeyFixture";\n', 'provider-key-like-literal'),
                (data + b'console.log(apiKey);\n', 'possible-sensitive-log-argument'),
            ]:
                with self.subTest(path=path, finding=finding):
                    scan = MODULE['Scan']()
                    scan.marked(path, revision)
                    self.assertIn((finding, path), scan.findings)

    def test_workflow_secret_is_scoped_to_reviewed_path_and_trigger(self):
        for approved in WORKFLOWS:
            original = (ROOT / approved).read_bytes()
            self.assertEqual(original.count(b'\non:\n'), 1)
            # Extend the event list without changing the reviewed Secret reference.
            other_trigger = original.replace(b'\non:\n', b'\non:\n  pull_request:\n')
            for path, data in [
                (approved, other_trigger),
                ('.github/workflows/unreviewed.yml', original),
                ('source.zip!' + approved, original),
            ]:
                with self.subTest(approved=approved, path=path):
                    scan = MODULE['Scan']()
                    scan.marked(path, data)
                    self.assertTrue(scan.findings)

    def test_cli_accepts_only_the_reviewed_top_level_files(self):
        path = SCORING + 'worker.mjs'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(['git', 'init', '--quiet'], cwd=root, check=True)
            for source in (path, WORKFLOWS[0]):
                target = root / source
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((ROOT / source).read_bytes())

            def staged_scan():
                subprocess.run(['git', 'add', '-A'], cwd=root, check=True)
                return subprocess.run([sys.executable, str(SCANNER.resolve()), '--cached'],
                                      cwd=root, capture_output=True)

            clean = staged_scan()
            self.assertEqual(clean.returncode, 0, clean.stdout)
            with zipfile.ZipFile(root / 'staged-site.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
                archive.write(root / path, path)
            blocked = staged_scan()
            self.assertEqual(blocked.returncode, 1)
            self.assertIn(('FINDING public-api-host "staged-site.zip!' + path + '"').encode(), blocked.stdout)

    def test_report_nested_fixtures_without_echoing_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def git(*args):
                subprocess.run(['git', *args], cwd=root, capture_output=True, check=True)

            def scan(*args):
                return subprocess.run([sys.executable, str(SCANNER.resolve()), *args], cwd=root, capture_output=True)

            git('init', '--quiet')
            (root / 'first').write_text('clean')
            git('add', 'first')
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'clean')
            self.assertEqual(scan().returncode, 0)
            key = b'sk' + b'-UnitTestOnlyFixtureNeverAValidCredential'
            fixture = key + b' https://api' + b'.openai.com OPENAI' + b'_API_KEY'
            package = io.BytesIO()
            with zipfile.ZipFile(package, 'w', zipfile.ZIP_DEFLATED) as archive:
                archive.writestr(key.decode() + '.txt', fixture)
            stream = io.BytesIO()
            with tarfile.open(fileobj=stream, mode='w') as archive:
                entry = tarfile.TarInfo('inner.zip')
                entry.size = len(package.getvalue())
                archive.addfile(entry, io.BytesIO(package.getvalue()))
            archive_path = root / 'fixture.tar.gz.b64'
            archive_path.write_bytes(base64.b64encode(gzip.compress(stream.getvalue())))
            source = root / 'experiments/r24-cloud-sync/backend/test-module.mjs'
            source.parent.mkdir(parents=True)
            source.write_text('console.error({headers});\n')
            git('add', '-A')
            archive_path.unlink()  # The staged blob remains visible, as in a sparse checkout.
            result = scan('--cached')
            self.assertEqual(result.returncode, 1)
            for kind in ['provider-key-like-literal', 'public-api-host', 'public-api-key-variable', 'possible-sensitive-log-argument']:
                self.assertIn(('FINDING ' + kind).encode(), result.stdout)
            self.assertNotIn(key, result.stdout + result.stderr)
            self.assertIn(b'[REDACTED]', result.stdout)
            self.assertEqual(scan().returncode, 0)
            (root / 'broken.zip').write_bytes(b'corrupt')
            git('add', 'broken.zip')
            failed = scan('--cached')
            self.assertEqual(failed.returncode, 2)
            self.assertIn(b'coverage-gaps=1', failed.stdout)


if __name__ == '__main__':
    unittest.main()
