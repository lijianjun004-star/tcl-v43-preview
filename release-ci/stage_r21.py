#!/usr/bin/env python3
"""Strictly stage the user-supplied R2.1 sources as a NEW Pages path; never mutate old pages."""
import argparse
import base64
import hashlib
import importlib.util
import io
import json
import pathlib
import shutil
import subprocess
import sys
import tarfile
import tempfile

ARCHIVE_SHA = "de792669f4e3d8317199c37c835063d0ce2ced4fbc76304eb960479f59927c37"
B64_SHA = "c5c4488a2590f71416714bcd08efdc46b6fcb9653359cda435b18edd9d8ede10"
SOURCE_SHA = {
    "source/experiments/r6-asr-autoqa/build_qa.py": "92c6df299d9e06b0ea4df82bfd06f838badc53f035b4e3545c30e4966689af2b",
    "source/experiments/r6-asr-autoqa/test_build_qa.py": "b6a8329ee860faa9daa91a30d37a5bdf2e803221660ff1629d5e1fb7a66cf153",
    "source/experiments/r6-asr-autoqa/whisper-bridge.mjs": "23c9f96bc0416a8cb27f897fea8db893349cd4ba344dda0a58f4dbdfdc62b8cd",
    "tests/test_timeout_safety.mjs": "58142c6b4ca585131683b14f734ce4ee3175f294bbe14bac18d9f6c876351cf6",
    "tests/test_whisper_bridge.mjs": "da53f661d5e8fab396d48717cd4fb4fe6081499034bfac0b3dd173aa42d6b10d",
    "tests/browser_e2e_r2.py": "7f2f2959b0e11550bff39bfea333ffa175c39b6c8ba197c6f5e6fb13f0ce5fa4",
    "reference/gemini-r2-original-whisper-bridge.mjs": "84270d95cca431c2e4b0517efc176fca34f33b55b008711475ebba61bfc24a6c",
}
PILOT = "tcl-v352-asr-autoqa-r2"
APP_SHA = "7496a246552636f7d22d23826b520254bf41e1c500102bd3e5d268a8cabc83e8"
BASE_ASR_SHA = "37cae0f8674e108041eeab317ca5632fa32456cd4bcdbccf2fc142f40bc1a298"
PILOT_FILES = {"index.html","app.js","style.css","training-boards.json","legacy-65.json",
    "app-config.json","static-manifest.json","whisper-bridge.mjs",
    "lib/qa-import.js","lib/parser.js","lib/pdf.js","lib/xls.js","lib/zip.js"}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def extract_verified_archive(archive_path, root):
    encoded = pathlib.Path(archive_path).read_bytes()
    if sha(encoded) != B64_SHA:
        raise ValueError("R2.1 base64 container hash mismatch")
    raw = base64.b64decode(encoded.strip(), validate=True)
    if sha(raw) != ARCHIVE_SHA or len(raw) > 120_000:
        raise ValueError("R2.1 compressed archive SHA / size mismatch")
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
        entries = archive.getmembers()
        if len(entries) != len(SOURCE_SHA) or {e.name for e in entries} != set(SOURCE_SHA):
            raise ValueError("R2.1 archive member allowlist mismatch")
        for e in entries:
            if not e.isfile() or e.size > 100_000:
                raise ValueError("R2.1 unsafe archive member: "+e.name)
            data = archive.extractfile(e).read()
            if sha(data) != SOURCE_SHA[e.name] or len(data) != e.size:
                raise ValueError("R2.1 member hash mismatch: "+e.name)
            path = pathlib.Path(root) / e.name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

def stage(site_dir, archive_path, browser=False):
    site = pathlib.Path(site_dir).resolve()
    base = site / "tcl-v352-asr"
    dest = site / PILOT
    if not (base / "app.js").is_file() or sha((base/"app.js").read_bytes()) != BASE_ASR_SHA:
        raise ValueError("Stable R6 source SHA mismatch; do not publish")
    if dest.exists():
        raise ValueError("R2.1 target already exists; do not overwrite")
    original_hashes = {p.relative_to(site).as_posix():sha(p.read_bytes())
        for p in site.rglob("*") if p.is_file()}
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp)
        extract_verified_archive(archive_path, root)
        src = root / "source/experiments/r6-asr-autoqa"
        subprocess.run([sys.executable,str(src/"test_build_qa.py")],cwd=root,check=True,timeout=40)
        subprocess.run(["node","--test",str(root/"tests/test_whisper_bridge.mjs")],cwd=root,check=True,timeout=40)
        subprocess.run(["node","--test",str(root/"tests/test_timeout_safety.mjs")],cwd=root,check=True,timeout=40)
        sys.path.insert(0,str(src))
        from build_qa import build
        result = build(site,src,pilot_name=PILOT)
        if not result["source_preserved"] or result["pilot_files"] != 13:
            raise ValueError("R2.1 isolation test did not preserve source")
        app = dest / "app.js"
        if sha(app.read_bytes()) != APP_SHA:
            raise ValueError("R2.1 generated app differs from independently reviewed package")
        if {p.relative_to(dest).as_posix() for p in dest.rglob("*") if p.is_file()} != PILOT_FILES:
            raise ValueError("R2.1 output file allowlist mismatch")
        manifest = json.loads((dest/"static-manifest.json").read_text())
        expected = {name:sha((dest/name).read_bytes()) for name in PILOT_FILES - {"static-manifest.json"}}
        if manifest.get("files") != expected:
            raise ValueError("R2.1 output manifest does not match bytes")
        for name,digest in original_hashes.items():
            if sha((site/name).read_bytes()) != digest:
                raise ValueError("R2.1 altered an existing live file: "+name)
        if browser:
            # The model is MOCKED; real Chromium MediaRecorder and 3-turn UI are exercised.
            if importlib.util.find_spec("playwright") is None:
                subprocess.run([sys.executable,"-m","pip","install","--disable-pip-version-check",
                    "playwright==1.56.0"],check=True,timeout=180)
            if not any(pathlib.Path(p).is_file() for p in (
                "/usr/bin/google-chrome","/usr/bin/chromium","/opt/google/chrome/chrome")):
                subprocess.run([sys.executable,"-m","playwright","install","chromium"],check=True,timeout=240)
            preview = root / "preview" / PILOT
            preview.parent.mkdir(parents=True)
            shutil.copytree(dest,preview)
            (root/"evidence").mkdir()
            subprocess.run([sys.executable,str(root/"tests/browser_e2e_r2.py")],
                cwd=root,check=True,timeout=190)
            record = json.loads((root/"evidence/browser_r2_result.json").read_text())
            if not record.get("ok"):
                raise ValueError("R2.1 Chromium E2E failed: "+str(record.get("exception") or record))
            if not record.get("inspect",{}).get("calls"):
                raise ValueError("R2.1 Chromium E2E did not exercise mock Whisper")
            print("R21_BROWSER_E2E_PASS (synthesized audio; transcription MOCKED)")
        print("R21_STAGE_PASS",json.dumps({
            "files":len(PILOT_FILES),"app_sha256":sha(app.read_bytes()),
            "existing_assets_preserved":len(original_hashes),"mocked_browser_test":browser},sort_keys=True))
    return True

if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--site-dir",required=True)
    parser.add_argument("--archive",required=True)
    parser.add_argument("--browser",action="store_true")
    args=parser.parse_args()
    stage(args.site_dir,args.archive,args.browser)
