"""Regression for staged trees, sparse paths, nested bundles, and safe scanner output."""
import base64
import gzip
import io
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile

SCANNER = Path(__file__).with_name('scan-gateway.py')


class ScanGatewayTest(unittest.TestCase):
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
