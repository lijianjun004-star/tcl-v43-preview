"""Freeze only the reviewed R24 question-bank patch, without changing trusted CI policy."""
import argparse, base64, hashlib, io, json, stat, zipfile
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--app-sha', required=True)
a = p.parse_args()
repo = Path(__file__).resolve().parents[3]
source = repo / 'experiments/r24/tcl-v352-asr-r24-qa'
evidence = repo / 'evidence/r24-question-bank/release'
evidence.mkdir(parents=True, exist_ok=True)
old = json.loads((repo / 'evidence/r24-data-audit/release/freeze.json').read_text())
sha = lambda data: hashlib.sha256(data).hexdigest()
paths = list(source.rglob('*'))
assert not any(x.is_symlink() for x in paths)
files = {x.relative_to(source).as_posix(): x.read_bytes() for x in paths if x.is_file()}
assert set(files) == set(old['files'])
assert sha(files['app.js']) == a.app_sha, 'app changed after review'
allowed = {'app.js', 'lib/qa-import.js', 'static-manifest.json'}
assert all(sha(data) == old['files'][name] for name, data in files.items() if name not in allowed)
manifest = {'version': 'r24-question-bank-20261116', 'files': {name: sha(data) for name, data in sorted(files.items()) if name != 'static-manifest.json'}}
files['static-manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
(source / 'static-manifest.json').write_bytes(files['static-manifest.json'])
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name, data in sorted(files.items()):
        entry = zipfile.ZipInfo('tcl-v352-asr-r24-qa/' + name, date_time=(2000, 1, 1, 0, 0, 0))
        entry.create_system = 3
        entry.external_attr = (stat.S_IFREG | 0o644) << 16
        entry.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(entry, data, compresslevel=9)
raw = buffer.getvalue()
with zipfile.ZipFile(io.BytesIO(raw)) as z:
    assert z.testzip() is None
    assert {name.removeprefix('tcl-v352-asr-r24-qa/'): z.read(name) for name in z.namelist()} == files
encoded = base64.b64encode(raw) + b'\n'
archive = repo / 'experiments/r24-release/site-only.zip.b64'
archive.write_bytes(encoded)
zip_path = Path('/workspace/scratch/r24-question-bank-static.zip')
zip_path.write_bytes(raw)
report = {'source_app_sha': a.app_sha, 'source_bridge_sha': sha(files['whisper-bridge.mjs']), 'archive': str(archive), 'archive_b64_sha256': sha(encoded), 'archive_b64_bytes': len(encoded), 'zip_sha256': sha(raw), 'zip_bytes': len(raw), 'files': {name: sha(data) for name, data in sorted(files.items())}, 'file_count': len(files), 'manifest_version': manifest['version'], 'changed_files': sorted(name for name, data in files.items() if sha(data) != old['files'][name]), 'previous_freeze': 'evidence/r24-data-audit/release/freeze.json', 'zip_member_timestamp': '2000-01-01T00:00:00'}
(evidence / 'freeze.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k != 'files'}, ensure_ascii=False, indent=2))
