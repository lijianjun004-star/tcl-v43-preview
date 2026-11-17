"""Freeze only the reviewed R25 frontend; never deploy or modify other sites."""
from pathlib import Path
import base64, hashlib, io, json, stat, subprocess, zipfile

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
SITE = ROOT / "experiments/r25/tcl-v352-asr-r25-qa"
PREFIX = SITE.name + "/"
VERSION = "r25-registration-recovery-20261117"
BASE = "c658a4a7af6a608a22f2708d3832e67746ed8136"
sha = lambda data: hashlib.sha256(data).hexdigest()

old_b64 = subprocess.check_output(["git", "show", BASE + ":experiments/r25-release/site-only.zip.b64"], cwd=ROOT)
assert sha(old_b64) == "dee92ada3d1a657461fd79cc72554318fbf1cb1b2acfe7b5571d729601e0766b"
with zipfile.ZipFile(io.BytesIO(base64.b64decode(old_b64))) as old_zip:
    old = {name.removeprefix(PREFIX): old_zip.read(name) for name in old_zip.namelist()}
assert len(old) == 29
files = {p.relative_to(SITE).as_posix(): p.read_bytes() for p in SITE.rglob("*") if p.is_file()}
assert set(files) == set(old), "Unexpected product file added/removed"
manifest = {"version": VERSION, "files": {name: sha(data) for name, data in sorted(files.items()) if name != "static-manifest.json"}}
manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
(SITE / "static-manifest.json").write_bytes(manifest_bytes)
files["static-manifest.json"] = manifest_bytes
changed = sorted(name for name in files if files[name] != old[name])
assert changed == ["app-config.json", "cloud-workflow.mjs", "cloud-workspace.mjs", "name-identity.mjs", "static-manifest.json"], changed
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name, data in sorted(files.items()):
        entry = zipfile.ZipInfo(PREFIX + name, date_time=(2026, 11, 17, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = (stat.S_IFREG | 0o644) << 16
        archive.writestr(entry, data)
raw = buffer.getvalue()
encoded = base64.b64encode(raw) + b"\n"
candidate = OUT / "candidate"
candidate.mkdir(exist_ok=True)
(candidate / "site-only.zip").write_bytes(raw)
(candidate / "site-only.zip.b64").write_bytes(encoded)
with zipfile.ZipFile(io.BytesIO(raw)) as archive:
    assert archive.testzip() is None
    assert {name.removeprefix(PREFIX): archive.read(name) for name in archive.namelist()} == files
identity = {"version": VERSION, "status": "CANDIDATE_NOT_DEPLOYED", "baselineMain": BASE,
            "sourceBaseline": "f5dee44471bb54c850118f9d94e1536e24df7ddc", "fileCount": len(files),
            "zipSha256": sha(raw), "base64Sha256": sha(encoded), "zipBytes": len(raw), "changedFiles": changed,
            "assetSha256": {name: sha(data) for name, data in sorted(files.items())},
            "preservedProductFiles": len(files) - len(changed), "cloudDeploymentVerified": False}
(OUT / "release-identity.json").write_text(json.dumps(identity, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({k: v for k, v in identity.items() if k != "assetSha256"}, ensure_ascii=False, indent=2))
