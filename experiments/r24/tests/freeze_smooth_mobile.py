"""Freeze reviewed performance patch; exact old assets stay immutable outside five paths."""
from pathlib import Path
import hashlib,json,base64,io,zipfile,stat
repo=Path(__file__).resolve().parents[3];source=repo/'experiments/r24/tcl-v352-asr-r24-qa'
old=json.loads((repo/'evidence/r24-question-bank/release/freeze.json').read_text())
sha=lambda v:hashlib.sha256(v).hexdigest()
files={p.relative_to(source).as_posix():p.read_bytes() for p in source.rglob('*') if p.is_file()}
assert set(files)==set(old['files'])|{'whisper-worker.mjs'}
allowed={'app.js','style.css','whisper-bridge.mjs','whisper-worker.mjs','static-manifest.json'}
assert all(sha(v)==old['files'][n] for n,v in files.items() if n not in allowed)
manifest={'version':'r24-smooth-mobile-20261116','files':{n:sha(v) for n,v in sorted(files.items()) if n!='static-manifest.json'}}
files['static-manifest.json']=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode();(source/'static-manifest.json').write_bytes(files['static-manifest.json'])
b=io.BytesIO()
with zipfile.ZipFile(b,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for n,v in sorted(files.items()):
  e=zipfile.ZipInfo('tcl-v352-asr-r24-qa/'+n,(2000,1,1,0,0,0));e.create_system=3;e.external_attr=(stat.S_IFREG|0o644)<<16;e.compress_type=zipfile.ZIP_DEFLATED;z.writestr(e,v,compresslevel=9)
raw=b.getvalue();encoded=base64.b64encode(raw)+b'\n'
with zipfile.ZipFile(io.BytesIO(raw)) as z:assert z.testzip() is None
out=repo/'evidence/r24-smooth-mobile/release';out.mkdir(parents=True,exist_ok=True)
report={'manifest_version':manifest['version'],'archive_b64_sha256':sha(encoded),'archive_b64_bytes':len(encoded),'zip_sha256':sha(raw),'zip_bytes':len(raw),'files':{n:sha(v) for n,v in sorted(files.items())},'changed_files':sorted(n for n,v in files.items() if sha(v)!=old['files'].get(n)),'previous_freeze':'evidence/r24-question-bank/release/freeze.json'}
(repo/'experiments/r24-release/site-only.zip.b64').write_bytes(encoded)
(out/'freeze.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,indent=2))
