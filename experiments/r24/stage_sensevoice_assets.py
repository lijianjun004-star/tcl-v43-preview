#!/usr/bin/env python3
"""Stage the pinned, official SenseVoice WASM release without rebuilding it.

Python standard library only. No server, account, model API or git operation.
See SENSEVOICE-ASSETS.md for offline/local archive and ZIP examples.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
import urllib.request
import zipfile


HERE = Path(__file__).resolve().parent
SUPPORT = HERE / "sensevoice-support"
MANIFEST_SHA256 = "d63e3d6c587d49ac5a14508465afbb55db6a4f7e26cee934238e7b5ada43a90e"
PREFIX = "sherpa-onnx-wasm-simd-1.12.20-vad-asr-zh_en_ja_ko_cantonese-sense_voice_small/"
BLOCK = 1024 * 1024


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(BLOCK), b""):
            h.update(block)
    return h.hexdigest()


def checked(path, spec):
    if not path.is_file() or path.is_symlink():
        raise ValueError(f"Not a regular file: {path}")
    if path.stat().st_size != spec["bytes"] or digest(path) != spec["sha256"]:
        raise ValueError(f"Size/SHA256 mismatch: {path}")


def read_manifest():
    path = SUPPORT / "manifest.json"
    if digest(path) != MANIFEST_SHA256:
        raise ValueError("Pinned source manifest has changed")
    return json.loads(path.read_text())


def license_files():
    sources = json.loads((SUPPORT / "license-sources.json").read_text())
    names = ["license-sources.json", "NOTICE.md"]
    for name, spec in sources.items():
        if "error" in spec:
            raise ValueError(f"Unresolved license source: {name}")
        checked(SUPPORT / name, spec)
        names.append(name)
    return names


def physical_files(manifest):
    for key, spec in manifest["files"].items():
        if key == "data":
            yield from spec["parts"]
        else:
            yield spec


def verify_stage(dest, manifest):
    checked(dest / "manifest.json", {"bytes": (SUPPORT / "manifest.json").stat().st_size,
                                      "sha256": MANIFEST_SHA256})
    expected = {"manifest.json", *license_files()}
    for spec in physical_files(manifest):
        expected.add(spec["file"])
        checked(dest / spec["file"], spec)
    h = hashlib.sha256()
    total = 0
    for spec in manifest["files"]["data"]["parts"]:
        with (dest / spec["file"]).open("rb") as f:
            for block in iter(lambda: f.read(BLOCK), b""):
                total += len(block)
                h.update(block)
    spec = manifest["files"]["data"]
    if total != spec["bytes"] or h.hexdigest() != spec["sha256"]:
        raise ValueError("Reassembled .data hash mismatch")
    for name in license_files():
        if (dest / name).read_bytes() != (SUPPORT / name).read_bytes():
            raise ValueError(f"License/notice mismatch: {name}")
    actual = {str(p.relative_to(dest)) for p in dest.rglob("*") if p.is_file() or p.is_symlink()}
    if actual != expected:
        raise ValueError(f"Unexpected/missing files: {sorted(actual ^ expected)}")


def download_archive(cache, spec):
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / "sensevoice-v1.12.20.tar.bz2"
    if archive.exists():
        checked(archive, spec)
        return archive
    fd, name = tempfile.mkstemp(prefix=".sensevoice-download-", dir=cache)
    try:
        with os.fdopen(fd, "wb") as out:
            request = urllib.request.Request(spec["url"], headers={"User-Agent": "TCL-SenseVoice-stager/1"})
            with urllib.request.urlopen(request, timeout=60) as response:
                total = 0
                for block in iter(lambda: response.read(BLOCK), b""):
                    total += len(block)
                    if total > spec["bytes"]:
                        raise ValueError("Archive exceeds pinned size")
                    out.write(block)
        checked(Path(name), spec)
        os.replace(name, archive)
        return archive
    finally:
        Path(name).unlink(missing_ok=True)


def extract_assets(archive, stage, manifest):
    wanted = {s["file"]: s for s in manifest["files"].values()}
    seen = set()
    with tarfile.open(archive, "r|bz2") as tar:
        for member in tar:
            # Never extract paths, links, directories or upstream demo code.
            name = member.name.removeprefix("./")
            if member.isdir() and name.rstrip("/") == PREFIX.rstrip("/"):
                continue
            if not name.startswith(PREFIX):
                raise ValueError(f"Unexpected archive root: {name}")
            relative = name[len(PREFIX):]
            if relative not in wanted:
                continue
            spec = wanted[relative]
            if relative in seen or not member.isfile() or member.size != spec["bytes"]:
                raise ValueError(f"Unexpected/duplicate member: {name}")
            seen.add(relative)
            source = tar.extractfile(member)
            h = hashlib.sha256()
            if "parts" in spec:
                for part in spec["parts"]:
                    remaining = part["bytes"]
                    with (stage / part["file"]).open("wb") as out:
                        while remaining:
                            block = source.read(min(BLOCK, remaining))
                            if not block:
                                raise ValueError("Truncated .data member")
                            out.write(block)
                            h.update(block)
                            remaining -= len(block)
                    checked(stage / part["file"], part)
                if source.read(1):
                    raise ValueError("Overlong .data member")
            else:
                with (stage / relative).open("wb") as out:
                    for block in iter(lambda: source.read(BLOCK), b""):
                        out.write(block)
                        h.update(block)
                checked(stage / relative, spec)
            if h.hexdigest() != spec["sha256"]:
                raise ValueError(f"Upstream member SHA256 mismatch: {relative}")
    if seen != set(wanted):
        raise ValueError(f"Missing archive members: {sorted(set(wanted) - seen)}")


def deterministic_zip(dest, output):
    if output == dest or dest in output.parents:
        raise ValueError("ZIP output must be outside the asset directory")
    if output.exists():
        raise ValueError(f"ZIP output already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for path in sorted(dest.iterdir()):
            info = zipfile.ZipInfo("vendor/sensevoice/" + path.name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            with path.open("rb") as source, z.open(info, "w", force_zip64=True) as out:
                shutil.copyfileobj(source, out, length=BLOCK)
    return {"path": str(output), "bytes": output.stat().st_size, "sha256": digest(output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Use existing official tar.bz2; never contacts network")
    parser.add_argument("--cache-dir", type=Path, default=Path(tempfile.gettempdir()) / "tcl-sensevoice-assets")
    parser.add_argument("--dest", type=Path, default=HERE / "tcl-v352-asr-r24-qa/vendor/sensevoice")
    parser.add_argument("--verify-only", action="store_true", help="Verify staged bytes without archive/download")
    parser.add_argument("--zip", type=Path, help="Also create deterministic offline asset ZIP (outside git)")
    args = parser.parse_args()
    manifest = read_manifest()
    license_files()
    dest = args.dest.resolve()
    if args.verify_only:
        verify_stage(dest, manifest)
    else:
        archive = args.archive.resolve() if args.archive else download_archive(args.cache_dir, manifest["source"])
        # Check every byte before opening the archive, including local cached inputs.
        checked(archive, manifest["source"])
        if dest.exists():
            verify_stage(dest, manifest)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            stage = Path(tempfile.mkdtemp(prefix=".sensevoice-stage-", dir=dest.parent))
            try:
                extract_assets(archive, stage, manifest)
                for name in ["manifest.json", *license_files()]:
                    shutil.copyfile(SUPPORT / name, stage / name)
                verify_stage(stage, manifest)
                stage.rename(dest)
            finally:
                if stage.exists():
                    shutil.rmtree(stage)
    result = {"status": "PASS", "version": manifest["version"], "dest": str(dest),
              "manifestSha256": MANIFEST_SHA256,
              "files": len(list(dest.iterdir())),
              "totalBytes": sum(p.stat().st_size for p in dest.iterdir())}
    if args.zip:
        result["zip"] = deterministic_zip(dest, args.zip.resolve())
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, tarfile.TarError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
