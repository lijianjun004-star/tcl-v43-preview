import importlib.util,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('gate',root/'release-ci/release_guard.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
base='c658a4a7af6a608a22f2708d3832e67746ed8136'
def old(path):return subprocess.check_output(['git','show',f'{base}:{path}'],cwd=root)
workflow=old('.github/workflows/pages.yml').decode()
trusted={p:old(p) for p in g.R25_TRUSTED_INPUTS}
zipbytes=old('site.zip')
deployed=old(g.R25_ARCHIVE)
import base64,io,zipfile
# Recreate the frozen direct candidate from its original source release identity.
identity=__import__('json').loads(subprocess.check_output(['git','show','f5dee44471bb54c850118f9d94e1536e24df7ddc:evidence/r25-direct-registration/release-identity.json'],cwd=root))
buffer=io.BytesIO()
with zipfile.ZipFile(buffer,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
 for name in sorted(identity['assetSha256']):
  data=subprocess.check_output(['git','show','f5dee44471bb54c850118f9d94e1536e24df7ddc:experiments/r25/tcl-v352-asr-r25-qa/'+name],cwd=root)
  entry=zipfile.ZipInfo(g.R25_DEST+'/'+name,date_time=(2026,11,17,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;entry.external_attr=(0o100644)<<16
  archive.writestr(entry,data)
direct=base64.b64encode(buffer.getvalue())+b'\n'
import hashlib
assert hashlib.sha256(direct).hexdigest()==identity['base64Sha256']
new=(root/'evidence/r25-registration-recovery/candidate/site-only.zip.b64').read_bytes()
for label,previous in [('deployed-name-invite',deployed),('direct-candidate',direct)]:
 print('CHECK',label,'update',flush=True)
 g.verify_r25_archive_update(workflow,previous,new,zipbytes,trusted)
 print('CHECK',label,'rollback',flush=True)
 g.verify_r25_archive_update(workflow,new,previous,zipbytes,trusted)
print('FULL_REAL_UPDATE_ROLLBACK_PASS',flush=True)
