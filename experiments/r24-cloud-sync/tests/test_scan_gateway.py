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
WORKFLOW = '.github/workflows/r24-batch-questions-export.yml'
EXPORTER = 'experiments/r24-cloud-sync/scripts/batch-questions-export.mjs'
KEY_NAME = b'OPENAI' + b'_API_KEY'
HOST = b'api' + b'.openai.com'
BINDING = b'          BATCH_API_TOKEN: ${{ secrets.' + KEY_NAME + b' }}'
ENDPOINT = b"const endpoint = 'https://" + HOST + b"/v1/chat/completions';"


class ScanGatewayTest(unittest.TestCase):
    def test_editorial_identifiers_are_reported_and_strict_gateway_still_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, contents in ((WORKFLOW, BINDING), (EXPORTER, ENDPOINT)):
                file = root / name
                file.parent.mkdir(parents=True)
                file.write_bytes(contents + b'\n')
            subprocess.run(['git', 'init', '--quiet'], cwd=root, check=True)
            subprocess.run(['git', 'add', '.'], cwd=root, check=True)
            cmd = [sys.executable, str(SCANNER.resolve()), '--cached']
            allowed = subprocess.run(cmd, cwd=root, capture_output=True)
            self.assertEqual(allowed.returncode, 0)
            self.assertEqual(allowed.stdout.count(b'PUBLIC-CI-IDENTIFIER '), 2)
            self.assertIn(b'findings=0 coverage-gaps=0', allowed.stdout)
            strict = subprocess.run([*cmd, '--strict-gateway'], cwd=root, capture_output=True)
            self.assertEqual(strict.returncode, 1)
            self.assertIn(b'findings=2 coverage-gaps=0', strict.stdout)
            self.assertNotIn(HOST, strict.stdout)
            self.assertNotIn(KEY_NAME, strict.stdout)

    def test_editorial_declarations_do_not_exempt_other_bytes(self):
        scanner = runpy.run_path(str(SCANNER))['Scan']
        fake_key = b'sk' + b'-UnitTestOnlyFixtureNeverAValidCredential'
        cases = [
            ('other.mjs', ENDPOINT, 'public-api-host'),
            ('bundle.zip!' + WORKFLOW, BINDING, 'public-api-key-variable'),
            (WORKFLOW, BINDING + b'\n' + BINDING, 'public-api-key-variable'),
            (WORKFLOW, BINDING + b' # ' + KEY_NAME, 'public-api-key-variable'),
            (EXPORTER, HOST + b'\n' + ENDPOINT, 'public-api-host'),
            (EXPORTER, ENDPOINT + b'\n' + HOST, 'public-api-host'),
            (EXPORTER, ENDPOINT.replace(b'/v1/', b'/v2/'), 'public-api-host'),
            (EXPORTER, ENDPOINT + b' ' + fake_key, 'provider-key-like-literal'),
            (WORKFLOW, BINDING + b'\n' + fake_key, 'provider-key-like-literal'),
            (EXPORTER, ENDPOINT + b'\nconsole.error(headers);\n', 'possible-sensitive-log-argument'),
            (EXPORTER, ENDPOINT + b'\nconsole.log(apiKey);\n', 'possible-sensitive-log-argument'),
            (WORKFLOW, BINDING + b'\n    run: echo "$BATCH_API_TOKEN"', 'possible-sensitive-log-argument'),
        ]
        for index, (name, contents, finding) in enumerate(cases):
            with self.subTest(case=index):
                scan = scanner()
                scan.member(name, contents, 0)
                self.assertIn((finding, name), scan.findings)

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
