"""Freeze reviewed R25 name-entry static bytes after an explicit product freeze.

No deployment, git commit, root archive rewrite, or cloud operation is performed.
"""
from pathlib import Path
import argparse
import base64
import hashlib
import io
import json
import stat
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
SITE = ROOT / 'experiments/r25/tcl-v352-asr-r25-qa'
PREFIX = SITE.name + '/'
VERSION = 'r25-name-entry-20261118'
BASE = '5573b9901181539aeeee5b6b67367cc86366a203'
SOURCE_BASE = 'c3c4f8cb5bb93d132c7b18198eaf9e9e319b2317'
BASE_ARCHIVE_B64_SHA = 'b7de6c8cc7e5fd718156af495711c6b122438a623674bc6c67ded20c44e905fb'
EXPECTED_CHANGED = ['app-config.json', 'cloud-workflow.mjs', 'cloud-workspace.mjs',
                    'name-identity.mjs', 'static-manifest.json']
sha = lambda data: hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--freeze', action='store_true', help='Write manifest and candidate only after the final product freeze')
    args = parser.parse_args()
    if not args.freeze:
        parser.error('No files changed: --freeze requires an explicitly frozen product.')
    old_b64 = subprocess.check_output(['git', 'show', BASE + ':experiments/r25-release/site-only.zip.b64'], cwd=ROOT)
    assert sha(old_b64) == BASE_ARCHIVE_B64_SHA, 'Deployed archive baseline differs'
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(old_b64, validate=False))) as archive:
        assert archive.testzip() is None
        assert len(archive.namelist()) == len(set(archive.namelist())) == 29
        assert all(name.startswith(PREFIX) for name in archive.namelist())
        old = {name.removeprefix(PREFIX): archive.read(name) for name in archive.namelist()}
    paths = list(SITE.rglob('*'))
    assert not any(path.is_symlink() for path in paths), 'Symlinks cannot enter a static release'
    files = {path.relative_to(SITE).as_posix(): path.read_bytes() for path in paths if path.is_file()}
    assert set(files) == set(old), 'Unexpected product file added/removed'
    manifest = {'version': VERSION, 'files': {name: sha(data) for name, data in sorted(files.items()) if name != 'static-manifest.json'}}
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    files['static-manifest.json'] = manifest_bytes
    changed = sorted(name for name in files if files[name] != old[name])
    assert changed == EXPECTED_CHANGED, changed
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            entry = zipfile.ZipInfo(PREFIX + name, date_time=(2026, 11, 18, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(entry, data)
    raw = buffer.getvalue()
    encoded = base64.b64encode(raw) + b'\n'
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        assert archive.testzip() is None
        assert {name.removeprefix(PREFIX): archive.read(name) for name in archive.namelist()} == files
    # Validate every scope boundary before the first write, including the manifest.
    (SITE / 'static-manifest.json').write_bytes(manifest_bytes)
    candidate = OUT / 'candidate'
    candidate.mkdir(exist_ok=True)
    (candidate / 'site-only.zip').write_bytes(raw)
    (candidate / 'site-only.zip.b64').write_bytes(encoded)
    identity = {'version': VERSION, 'status': 'CANDIDATE_NOT_DEPLOYED', 'baselineMain': BASE,
                'sourceBaseline': SOURCE_BASE, 'baselineArchiveBase64Sha256': BASE_ARCHIVE_B64_SHA,
                'fileCount': len(files), 'zipSha256': sha(raw), 'base64Sha256': sha(encoded),
                'zipBytes': len(raw), 'changedFiles': changed,
                'assetSha256': {name: sha(data) for name, data in sorted(files.items())},
                'preservedProductFiles': len(files) - len(changed), 'cloudDeploymentVerified': False}
    (OUT / 'release-identity.json').write_text(json.dumps(identity, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: value for key, value in identity.items() if key != 'assetSha256'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
