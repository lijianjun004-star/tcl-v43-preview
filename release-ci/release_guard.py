#!/usr/bin/env python3
"""TCL Pages release gate (V2.2). Python stdlib only; does not access network or write to GitHub."""
import argparse
import base64
import hashlib
import io
import json
import pathlib
import re
import shutil
import sys
import stat
import zipfile
import struct
import zlib
import subprocess
import tempfile
import tarfile
from datetime import datetime, timezone
from pathlib import PurePosixPath

PREFIX = 'tcl-v09-ab/'
SPECIALTY = 'tcl-specialty-v33/'
SPECIALTY_FILES = {'index.html', 'app.js', 'style.css', 'training-boards.json', 'legacy-65.json', 'app-config.json', 'lib/qa-import.js', 'lib/parser.js', 'lib/xls.js', 'lib/pdf.js', 'lib/zip.js', 'static-manifest.json'}
QA_PREFIX = 'tcl-v352-mobile-qa/'
UI_R3_PREFIX = 'tcl-v352-ui-r3/'
UI_R4_PREFIX = 'tcl-v352-ui-r4/'
ASR_PREFIX = 'tcl-v352-asr/'
ASR_STOPFIX_BASELINE_SHA = 'c384b43c81327eddd2c21f4463845e05bbe2fd03737052a129785e3237d04a0b'
ASR_STOPFIX_TARGET_SHA = '7e9338775ab5afd29cdb75c5c4eb4c887337a8fa092428fb53286fe97923833f'
ASR_STOPFIX_JS_SHA = 'dfbcce274a65dc98ebebcaee9d6b775c527c4be6b72de2c38ccd6566220be12d'
ASR_ROUND2_BASELINE_SHA = '7e9338775ab5afd29cdb75c5c4eb4c887337a8fa092428fb53286fe97923833f'
ASR_ROUND2_TARGET_SHA = 'cdd32b5a7924fb959561d5980e9be0afd6f05d4df3b480578cc717a31b6a7dcc'
ASR_ROUND2_APP_SHA = '6b9fa1e2aadcccbce8120bd03ba9faf3b4ef0ae3d5cadd1818f874034f5893f7'
ASR_END_DIALOG_BASE_SHA = 'cdd32b5a7924fb959561d5980e9be0afd6f05d4df3b480578cc717a31b6a7dcc'
ASR_END_DIALOG_TARGET_SHA = '17c542a847161be845459c1a63911f57c6da59c2f0170eeb7f6171acb654882e'
ASR_END_DIALOG_APP_SHA = 'f6e75e3efeba0497e927b1f575903b8f79b9b9cf036e4a0d27c39f439b3b9e15'
ASR_RESTART_BASE_SHA = '17c542a847161be845459c1a63911f57c6da59c2f0170eeb7f6171acb654882e'
ASR_RESTART_TARGET_SHA = 'fc057e7a0c664b25ff40dda9937990641d1da39e7f9465e04bf7026cc7eddf27'
ASR_RESTART_APP_SHA = '74bb53a0c8861b3baff1d086d2aea5f74482a517758f20dc6d06671f385bbcf7'
ASR_RESTART_CSS_SHA = '5afd20bf9160aec238e2c4e5252693190d0690af908cd188b16004d1c09e9ba8'
ASR_R6_BASE_SHA = 'fc057e7a0c664b25ff40dda9937990641d1da39e7f9465e04bf7026cc7eddf27'
ASR_R6_TARGET_SHA = '099a57016c1ae24eab6b30cecfdc9ddaf3160571c6c500853f81bf5a654b924e'
ASR_R6_APP_SHA = '37cae0f8674e108041eeab317ca5632fa32456cd4bcdbccf2fc142f40bc1a298'

UI_R3_ROLLBACK_SHA256 = 'fa488483cd3489e47a976f4a745b588438a3f5f0680e6dedff05c81262902727'
MAX_FILE_COUNT = 500
MAX_SINGLE_FILE_BYTES = 25 * 1024 * 1024
MAX_TOTAL_UNCOMPRESSED_BYTES = 60 * 1024 * 1024
MAX_COMPRESSION_RATIO = 250
MAX_ARCHIVE_BYTES = 80 * 1024 * 1024

# One-time recovery for the exact malformed V3.4.3 archive that reached main.
# This is deliberately pinned to one baseline SHA and one exact byte-preserving filename rename.
KNOWN_BASELINE_FILENAME_REPAIRS = {
    'f2bae680a6262e41352e53f0f81edb68ad18dfb4769b2690da91e2e37db6e9dd': {
        'tcl-v09-ab/Φ«╛σñçµúÇµƒÑ.html': PREFIX + '设备检查.html',
    },
}


class GateFailure(Exception):
    pass


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def normalize_known_baseline_names(baseline_sha, files):
    """Repair only explicitly pinned malformed baseline names; never normalize arbitrary archives."""
    repaired = dict(files)
    mapping = KNOWN_BASELINE_FILENAME_REPAIRS.get(baseline_sha, {})
    if not mapping:
        return repaired, {}
    applied = {}
    for bad, good in mapping.items():
        if bad not in repaired:
            raise GateFailure(f'Known baseline filename repair source is missing: {bad}')
        if good in repaired:
            raise GateFailure(f'Known baseline filename repair target already exists: {good}')
        repaired[good] = repaired.pop(bad)
        applied[bad] = good
    return repaired, applied


def _preflight_container(raw):
    # Count central headers before ZipFile allocates its entry objects.
    end = raw.rfind(b'PK\x05\x06', max(0, len(raw) - 65557))
    if end < 0 or end + 22 > len(raw):
        raise GateFailure('Missing ZIP end record')
    _, disk, central_disk, disk_count, count, size, offset, comment = struct.unpack_from('<4s4H2IH', raw, end)
    if disk or central_disk or disk_count != count or count == 65535 or offset == 0xffffffff or size == 0xffffffff:
        raise GateFailure('Multi-disk and ZIP64 containers are not supported')
    if end + 22 + comment != len(raw) or offset + size != end:
        raise GateFailure('ZIP central directory boundary mismatch')
    cursor = offset
    actual = 0
    while cursor < end:
        if cursor + 46 > end or raw[cursor:cursor + 4] != b'PK\x01\x02':
            raise GateFailure('Malformed ZIP central directory')
        nlen, xlen, clen = struct.unpack_from('<3H', raw, cursor + 28)
        cursor += 46 + nlen + xlen + clen
        actual += 1
        if actual > MAX_FILE_COUNT:
            raise GateFailure(f'ZIP entry count exceeds limit {MAX_FILE_COUNT}')
    if cursor != end or actual != count or not actual:
        raise GateFailure('ZIP entry count or directory length mismatch')


def _preflight_entries(infolist):
    """Verify ZIP metadata *before* reading compressed contents/CRC/extracting."""
    if not infolist or len(infolist) > MAX_FILE_COUNT:
        raise GateFailure(f'ZIP entry count invalid or exceeds limit {MAX_FILE_COUNT}')
    seen = set()
    total = 0
    for info in infolist:
        name = info.filename
        p = PurePosixPath(name)
        if (not name or name.startswith('/') or '\\' in name or '\x00' in name
                or ':' in p.parts[0] or '..' in p.parts or '.' in p.parts
                or str(p) != name.rstrip('/') or '//' in name):
            raise GateFailure(f'Unsafe ZIP name: {name!r}')
        if info.flag_bits & 0x1:
            raise GateFailure(f'Encrypted ZIP entry is prohibited: {name}')
        if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise GateFailure(f'Unsupported ZIP compression method: {name}')
        mode = info.external_attr >> 16
        if stat.S_IFMT(mode) == stat.S_IFLNK:
            raise GateFailure(f'Symlink is not allowed: {name}')
        if info.is_dir():
            continue
        if name in seen:
            raise GateFailure(f'Duplicate ZIP name: {name}')
        seen.add(name)
        if info.file_size > MAX_SINGLE_FILE_BYTES:
            raise GateFailure(f'Single file exceeds size limit ({info.file_size} > {MAX_SINGLE_FILE_BYTES}): {name}')
        total += info.file_size
        if total > MAX_TOTAL_UNCOMPRESSED_BYTES:
            raise GateFailure(f'Total uncompressed size exceeds limit ({total} > {MAX_TOTAL_UNCOMPRESSED_BYTES})')
        if info.file_size > (1024 * 1024) and info.file_size / max(info.compress_size, 1) > MAX_COMPRESSION_RATIO:
            raise GateFailure(f'Compression ratio exceeds limit ({MAX_COMPRESSION_RATIO}): {name}')


def inspect_zip(path):
    if not path.is_file():
        raise GateFailure(f'ZIP file not found: {path}')
    # Refuse oversized compressed containers before loading the bytes.
    if path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise GateFailure(f'Archive compressed size exceeds limit ({MAX_ARCHIVE_BYTES})')
    # Metadata preflight occurs before any decompression/CRC reading.
    raw = path.read_bytes()
    _preflight_container(raw)
    files = {}
    with zipfile.ZipFile(path) as z:
        _preflight_entries(z.infolist())
        total = 0
        for info in z.infolist():
            if info.is_dir():
                continue
            # Bound zlib output itself; ZipExtFile may inflate beyond its declared size.
            start = info.header_offset
            if start < 0 or start + 30 > len(raw):
                raise GateFailure('Truncated ZIP local header')
            header = struct.unpack_from('<4s5H3I2H', raw, start)
            signature, _, flags, method, _, _, crc, packed, unpacked, nlen, xlen = header
            if signature != b'PK\x03\x04' or flags != info.flag_bits or method != info.compress_type:
                raise GateFailure('ZIP local/central header mismatch')
            if not flags & 8 and (crc, packed, unpacked) != (info.CRC, info.compress_size, info.file_size):
                raise GateFailure('ZIP local/central size or CRC mismatch')
            name_start = start + 30
            name_bytes = raw[name_start:name_start + nlen]
            encoding = 'utf-8' if flags & 0x800 else 'cp437'
            if name_bytes.decode(encoding) != info.orig_filename:
                raise GateFailure('ZIP local/central name mismatch')
            offset = name_start + nlen + xlen
            end = offset + info.compress_size
            if end > len(raw) or end > info._end_offset:
                raise GateFailure('ZIP compressed entry exceeds its boundary')
            if flags & 8:
                descriptor = end + (4 if raw[end:end + 4] == b'PK\x07\x08' else 0)
                if descriptor + 12 > info._end_offset or struct.unpack_from('<3I', raw, descriptor) != (info.CRC, info.compress_size, info.file_size):
                    raise GateFailure('ZIP data descriptor mismatch')
            limit = min(MAX_SINGLE_FILE_BYTES, MAX_TOTAL_UNCOMPRESSED_BYTES - total, info.file_size)
            if method == zipfile.ZIP_STORED:
                if info.compress_size != info.file_size:
                    raise GateFailure('Stored ZIP entry size mismatch')
                data = raw[offset:end]
            else:
                decoder = zlib.decompressobj(-15)
                chunks = []
                produced = 0
                cursor = offset
                while cursor < end:
                    block = raw[cursor:min(cursor + 65536, end)]
                    cursor += len(block)
                    while block:
                        output = decoder.decompress(block, min(65536, limit - produced + 1))
                        produced += len(output)
                        if produced > limit:
                            raise GateFailure('Actual decompressed output exceeds declared size or resource limit')
                        chunks.append(output)
                        block = decoder.unconsumed_tail
                        if decoder.eof:
                            if decoder.unused_data or block or cursor != end:
                                raise GateFailure('Trailing data after ZIP deflate stream')
                            break
                if not decoder.eof:
                    raise GateFailure('Truncated ZIP deflate stream')
                data = b''.join(chunks)
            if len(data) != info.file_size or zlib.crc32(data) & 0xffffffff != info.CRC:
                raise GateFailure(f'Actual byte length or CRC mismatch for {info.filename}')
            total += len(data)
            files[info.filename] = data
    if not files:
        raise GateFailure('ZIP is empty')
    return raw, files


def extract_zip_safely(path, destination):
    """No unvalidated extractall(): all entries inspected before writing anything."""
    _, files = inspect_zip(path)
    root = pathlib.Path(destination).resolve()
    root.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        target = (root / name).resolve()
        if not target.is_relative_to(root):
            raise GateFailure(f'ZIP extraction escaped destination: {name}')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return len(files)


def inspect_manifest(files):
    key = PREFIX + 'static-manifest.json'
    if key not in files:
        raise GateFailure('Missing tcl-v09-ab/static-manifest.json')
    obj = json.loads(files[key].decode('utf-8'))
    mapping = obj.get('files')
    if not isinstance(mapping, dict) or not mapping:
        raise GateFailure('Manifest file mapping is empty or invalid')
    expected_rel = {name[len(PREFIX):] for name in files if name.startswith(PREFIX) and name != key}
    if set(mapping) != expected_rel:
        missing_manifest = sorted(expected_rel - set(mapping))
        dangling_manifest = sorted(set(mapping) - expected_rel)
        raise GateFailure('Manifest coverage mismatch: ' + repr({'unlisted_files': missing_manifest, 'missing_files': dangling_manifest}))
    issues = []
    for rel, expected in mapping.items():
        k = PREFIX + rel
        if k not in files:
            issues.append(f'missing {k}')
        elif sha256(files[k]) != expected:
            issues.append(f'hash mismatch {k}')
    if issues:
        raise GateFailure('Manifest check failed: ' + '; '.join(issues[:10]))
    return len(mapping), obj.get('version')



def inspect_isolated_qa(files):
    """Validate a separate mobile QA path without sharing production local browser state."""
    qa = {name[len(QA_PREFIX):]: data for name, data in files.items() if name.startswith(QA_PREFIX)}
    if not qa:
        return 0
    if set(qa) != SPECIALTY_FILES:
        raise GateFailure('Isolated mobile QA allowlist mismatch')
    manifest = json.loads(qa['static-manifest.json'].decode('utf-8'))
    if set(manifest.get('files', {})) != SPECIALTY_FILES - {'static-manifest.json'}:
        raise GateFailure('Isolated mobile QA manifest coverage mismatch')
    for name, digest in manifest['files'].items():
        if sha256(qa[name]) != digest:
            raise GateFailure('Isolated mobile QA manifest hash mismatch: ' + name)
    js = qa['app.js'].decode('utf-8')
    for marker in (
        "const STORE_NAME='tcl-specialty-v352-mobile-qa';",
        "new BroadcastChannel('tcl-specialty-v352-mobile-qa-workflow')",
        "const VOSK_CACHE_NAME='tcl-specialty-v352-mobile-qa-vosk-v1';",
    ):
        if marker not in js:
            raise GateFailure('Isolated mobile QA browser state namespace missing: ' + marker)
    return len(qa)


def inspect_isolated_ui_r3(files):
    """Validate the UI test path and its independent browser storage."""
    ui = {name[len(UI_R3_PREFIX):]: data for name, data in files.items() if name.startswith(UI_R3_PREFIX)}
    if not ui:
        return 0
    if set(ui) != SPECIALTY_FILES:
        raise GateFailure('UI R3 allowlist mismatch')
    manifest = json.loads(ui['static-manifest.json'].decode('utf-8'))
    if set(manifest.get('files', {})) != SPECIALTY_FILES - {'static-manifest.json'}:
        raise GateFailure('UI R3 manifest coverage mismatch')
    for name, digest in manifest['files'].items():
        if sha256(ui[name]) != digest:
            raise GateFailure('UI R3 manifest hash mismatch: ' + name)
    js = ui['app.js'].decode('utf-8')
    for marker in (
        "const STORE_NAME='tcl-specialty-v352-ui-r3';",
        "new BroadcastChannel('tcl-specialty-v352-ui-r3-workflow')",
        "const VOSK_CACHE_NAME='tcl-specialty-v352-ui-r3-vosk-v1';",
    ):
        if marker not in js:
            raise GateFailure('UI R3 browser state namespace missing: ' + marker)
    # Reject direct reuse of already deployed browser data namespaces, even if
    # the required R3 marker was also added. Runtime review is still required.
    protected_names = (
        'tcl-specialty-v3', 'tcl-specialty-workflow', 'tcl-specialty-vosk-v1',
        'tcl-specialty-v352-mobile-qa', 'tcl-specialty-v352-mobile-qa-workflow',
        'tcl-specialty-v352-mobile-qa-vosk-v1',
    )
    for name in protected_names:
        if any(f'{quote}{name}{quote}' in js for quote in ("'", '"', '`')):
            raise GateFailure('UI R3 reuses protected browser state namespace: ' + name)
    return len(ui)



def inspect_isolated_ui_r4(files):
    """Allow only a distinct R4 mobile QA snapshot; preserve every deployed older version."""
    ui = {name[len(UI_R4_PREFIX):]: data for name, data in files.items() if name.startswith(UI_R4_PREFIX)}
    if not ui:
        return 0
    if set(ui) != SPECIALTY_FILES:
        raise GateFailure('UI R4 allowlist mismatch')
    manifest = json.loads(ui['static-manifest.json'].decode('utf-8'))
    if set(manifest.get('files', {})) != SPECIALTY_FILES - {'static-manifest.json'}:
        raise GateFailure('UI R4 manifest coverage mismatch')
    for name, digest in manifest['files'].items():
        if sha256(ui[name]) != digest:
            raise GateFailure('UI R4 manifest hash mismatch: ' + name)
    js = ui['app.js'].decode('utf-8')
    for marker in (
        "const STORE_NAME='tcl-specialty-v352-ui-r4';",
        "new BroadcastChannel('tcl-specialty-v352-ui-r4-workflow')",
        "const VOSK_CACHE_NAME='tcl-specialty-v352-ui-r4-vosk-v1';",
    ):
        if marker not in js:
            raise GateFailure('UI R4 browser state namespace missing: ' + marker)
    old_names = (
        'tcl-specialty-v3', 'tcl-specialty-workflow', 'tcl-specialty-vosk-v1',
        'tcl-specialty-v352-mobile-qa', 'tcl-specialty-v352-mobile-qa-workflow',
        'tcl-specialty-v352-mobile-qa-vosk-v1',
        'tcl-specialty-v352-ui-r3', 'tcl-specialty-v352-ui-r3-workflow',
        'tcl-specialty-v352-ui-r3-vosk-v1',
    )
    for name in old_names:
        if any(f'{quote}{name}{quote}' in js for quote in ("'", '"', '`')):
            raise GateFailure('UI R4 reuses protected browser state namespace: ' + name)
    return len(ui)


def inspect_isolated_asr(files):
    """Allow only a distinct ASR mobile QA snapshot; preserve every deployed older version."""
    ui = {name[len(ASR_PREFIX):]: data for name, data in files.items() if name.startswith(ASR_PREFIX)}
    if not ui:
        return 0
    if set(ui) != SPECIALTY_FILES:
        raise GateFailure('UI ASR allowlist mismatch')
    manifest = json.loads(ui['static-manifest.json'].decode('utf-8'))
    if set(manifest.get('files', {})) != SPECIALTY_FILES - {'static-manifest.json'}:
        raise GateFailure('UI ASR manifest coverage mismatch')
    for name, digest in manifest['files'].items():
        if sha256(ui[name]) != digest:
            raise GateFailure('UI ASR manifest hash mismatch: ' + name)
    js = ui['app.js'].decode('utf-8')
    for marker in (
        "const STORE_NAME='tcl-specialty-v352-asr';",
        "new BroadcastChannel('tcl-specialty-v352-asr-workflow')",
        "const VOSK_CACHE_NAME='tcl-specialty-v352-asr-vosk-v1';",
    ):
        if marker not in js:
            raise GateFailure('UI ASR browser state namespace missing: ' + marker)
    old_names = (
        'tcl-specialty-v3', 'tcl-specialty-workflow', 'tcl-specialty-vosk-v1',
        'tcl-specialty-v352-mobile-qa', 'tcl-specialty-v352-mobile-qa-workflow',
        'tcl-specialty-v352-mobile-qa-vosk-v1',
        'tcl-specialty-v352-ui-r3', 'tcl-specialty-v352-ui-r3-workflow',
        'tcl-specialty-v352-ui-r3-vosk-v1',
        'tcl-specialty-v352-ui-r4', 'tcl-specialty-v352-ui-r4-workflow',
        'tcl-specialty-v352-ui-r4-vosk-v1',
    )
    for name in old_names:
        if any(f'{quote}{name}{quote}' in js for quote in ("'", '"', '`')):
            raise GateFailure('UI ASR reuses protected browser state namespace: ' + name)
    return len(ui)


def allow_once_asr_stopfix(baseline, current, baseline_sha, candidate_sha):
    """One known ASR recorder deadlock fix only; all other deployed bytes are immutable."""
    old = {name: data for name, data in baseline.items() if name.startswith(ASR_PREFIX)}
    new = {name: data for name, data in current.items() if name.startswith(ASR_PREFIX)}
    if old == new:
        return False
    if baseline_sha != ASR_STOPFIX_BASELINE_SHA or candidate_sha != ASR_STOPFIX_TARGET_SHA:
        raise GateFailure('Existing ASR QA is immutable except exactly pinned stopfix release')
    changed = {name for name in set(old)|set(new) if old.get(name) != new.get(name)}
    expected = {ASR_PREFIX+'app.js', ASR_PREFIX+'static-manifest.json'}
    if changed != expected or len(old) != 12 or set(old) != set(new):
        raise GateFailure('Stopfix may only update app.js and its matching manifest')
    if sha256(new[ASR_PREFIX+'app.js']) != ASR_STOPFIX_JS_SHA:
        raise GateFailure('Stopfix JS SHA-256 mismatch')
    for name, value in baseline.items():
        if not name.startswith(ASR_PREFIX) and current.get(name) != value:
            raise GateFailure('Stopfix must preserve every existing non-ASR site file')
    return True



def allow_once_asr_round2(baseline, current, baseline_sha, candidate_sha):
    """Pin one independently reviewed ASR P2 candidate, without relaxing other releases."""
    if (baseline_sha, candidate_sha) != (ASR_ROUND2_BASELINE_SHA, ASR_ROUND2_TARGET_SHA):
        raise GateFailure('ASR round2 must match exact baseline and candidate SHA-256')
    old = {name: data for name, data in baseline.items() if name.startswith(ASR_PREFIX)}
    new = {name: data for name, data in current.items() if name.startswith(ASR_PREFIX)}
    expected = {ASR_PREFIX + 'app.js', ASR_PREFIX + 'static-manifest.json'}
    if len(baseline) != 154 or len(current) != 154 or len(old) != 12 or set(old) != set(new):
        raise GateFailure('ASR round2 must retain 154 files and all 12 ASR members')
    changed = {name for name in set(baseline)|set(current) if baseline.get(name) != current.get(name)}
    if changed != expected:
        raise GateFailure('ASR round2 may change only app.js and its static manifest')
    if sha256(new[ASR_PREFIX+'app.js']) != ASR_ROUND2_APP_SHA:
        raise GateFailure('ASR round2 app.js SHA-256 mismatch')
    # inspect_isolated_asr() independently validates manifest coverage and all 11 hashes.
    return True



def allow_once_asr_end_dialog(baseline, current, baseline_sha, candidate_sha):
    """Guard one accessible in-page end-live confirmation update to ASR QA only."""
    if (baseline_sha,candidate_sha)!=(ASR_END_DIALOG_BASE_SHA,ASR_END_DIALOG_TARGET_SHA):
        raise GateFailure('End dialog repair must match exact baseline and candidate SHA-256')
    if len(baseline)!=154 or len(current)!=154:
        raise GateFailure('End dialog repair requires exactly 154 ZIP members')
    changes={name for name in set(baseline)|set(current) if baseline.get(name)!=current.get(name)}
    expected={ASR_PREFIX+'app.js',ASR_PREFIX+'static-manifest.json'}
    if changes!=expected:
        raise GateFailure('End dialog repair may update only ASR app.js and matching manifest')
    if sha256(current[ASR_PREFIX+'app.js'])!=ASR_END_DIALOG_APP_SHA:
        raise GateFailure('End dialog repair JS SHA mismatch')
    # Main verify calls inspect_isolated_asr() and checks its 11 manifest entries.
    return True



def allow_once_asr_restart_fix(baseline, current, baseline_sha, candidate_sha):
    """Allow one exact re-practice/preview/typed-ASR QA patch; preserve all other files."""
    if (baseline_sha, candidate_sha) != (ASR_RESTART_BASE_SHA, ASR_RESTART_TARGET_SHA):
        raise GateFailure('Restart QA release needs exact baseline and candidate SHA-256')
    if len(baseline) != 154 or len(current) != 154:
        raise GateFailure('Restart QA release needs 154 ZIP members')
    changed = {name for name in set(baseline)|set(current) if baseline.get(name) != current.get(name)}
    expected = {ASR_PREFIX+'app.js', ASR_PREFIX+'style.css', ASR_PREFIX+'static-manifest.json'}
    if changed != expected:
        raise GateFailure('Restart QA may change only app.js, style.css and ASR manifest')
    if sha256(current[ASR_PREFIX+'app.js']) != ASR_RESTART_APP_SHA:
        raise GateFailure('Restart QA JavaScript SHA-256 mismatch')
    if sha256(current[ASR_PREFIX+'style.css']) != ASR_RESTART_CSS_SHA:
        raise GateFailure('Restart QA CSS SHA-256 mismatch')
    # inspect_isolated_asr() is separately called for the 11-member SHA-256 manifest.
    return True



def allow_once_asr_r6(baseline, current, baseline_sha, candidate_sha):
    """Exact R5 -> independently reviewed R6 QA release. Protect all older pages."""
    if (baseline_sha, candidate_sha) != (ASR_R6_BASE_SHA, ASR_R6_TARGET_SHA):
        raise GateFailure('R6 requires exact R5 baseline and reviewed candidate checksums')
    if len(baseline) != 154 or len(current) != 154:
        raise GateFailure('R6 must retain all 154 site.zip members')
    changes = {name for name in set(baseline) | set(current) if baseline.get(name) != current.get(name)}
    expected = {ASR_PREFIX + 'app.js', ASR_PREFIX + 'static-manifest.json'}
    if changes != expected:
        raise GateFailure('R6 may change only ASR app.js and static-manifest.json')
    if sha256(current[ASR_PREFIX + 'app.js']) != ASR_R6_APP_SHA:
        raise GateFailure('R6 app.js SHA-256 differs from independently reviewed candidate')
    # inspect_isolated_asr() additionally checks 12-file allowlist and 11-entry hash manifest.
    return True


def check_workflow(text, candidate_sha):
    # Match only the exact release checksum verification line.
    pattern = r'(run:\s*echo\s+["\'])([0-9a-f]{64})(\s{2}site\.zip["\']\s*\|\s*sha256sum\s+--check\s+--strict)'
    hits = list(re.finditer(pattern, text))
    if len(hits) != 1:
        raise GateFailure('Expected exactly one Pages ZIP SHA-256 check in workflow')
    return hits[0].group(2)



# Strict one-time QA gate. Official Pages ZIP remains byte-for-byte unchanged.
LAB_SOURCE = 'experiments/r6-asr-original-audio-qa/index.html'
LAB_TARGET = 'tcl-v352-asr-lab/index.html'
LAB_HTML_SHA256 = 'd1b8e9418b7dd811a6f995b41a6a01e2fc38a585ac16081d6b88810c3c87c9fd'
LAB_BASELINE_ZIP_SHA256 = '099a57016c1ae24eab6b30cecfdc9ddaf3160571c6c500853f81bf5a654b924e'
LAB_ANCHOR = '      - uses: actions/configure-pages@v5\n'


def lab_stage_step():
    return (
        '      - name: Stage isolated audio research preview\n'
        '        run: |\n'
        '          mkdir -p _site/tcl-v352-asr-lab\n'
        '          cp experiments/r6-asr-original-audio-qa/index.html _site/tcl-v352-asr-lab/index.html\n'
        f'          echo "{LAB_HTML_SHA256}  _site/tcl-v352-asr-lab/index.html" | sha256sum --check --strict\n'
    )


def verify_lab_addition(before, after, html, baseline_zip):
    if sha256(baseline_zip) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('Lab requires exact unchanged R6 baseline site.zip')
    if sha256(html) != LAB_HTML_SHA256:
        raise GateFailure('Lab HTML differs from reviewed exact SHA-256')
    if check_workflow(before, LAB_BASELINE_ZIP_SHA256) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('Original workflow must pin R6 baseline ZIP')
    if before.count(LAB_ANCHOR) != 1 or lab_stage_step() in before:
        raise GateFailure('Lab stage must be added exactly once')
    if after != before.replace(LAB_ANCHOR, lab_stage_step() + LAB_ANCHOR, 1):
        raise GateFailure('Unexpected workflow edit outside isolated QA stage')
    if check_workflow(after, LAB_BASELINE_ZIP_SHA256) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('Staged workflow must keep original R6 checksum')
    with zipfile.ZipFile(io.BytesIO(baseline_zip)) as archive:
        if LAB_TARGET in archive.namelist():
            raise GateFailure('Lab would overwrite an existing Pages ZIP file')
    return True



# One-time isolated R6 live-flow ASR AutoQA. No change to release ZIP.
AUTOQA_FILES = {
    'experiments/r6-asr-autoqa/build_qa.py': '0ccb522de2625d73b08d6b463e0b3e4c017b265a64262250bfad76751f8f8065',
    'experiments/r6-asr-autoqa/whisper-bridge.mjs': '61293bef617312ceb8476c154126e13d81bb7e1b1fc32ba62c1d45f19724524e',
    'experiments/r6-asr-autoqa/test_build_qa.py': 'e3b2afbe5065fe1dafe9fd1b4cbb3ce5d75ebfc8d2d587d84dc34d513a075c10',
}
AUTOQA_PATH = 'tcl-v352-asr-autoqa/'
AUTOQA_STEP = (
    '      - name: Stage isolated R6 original-audio AutoQA preview\n'
    '        run: |\n'
    '          python3 experiments/r6-asr-autoqa/build_qa.py _site experiments/r6-asr-autoqa\n'
    '          test -s _site/tcl-v352-asr-autoqa/index.html\n'
)


def verify_autoqa_release(before, after, old_zip, provided):
    if sha256(old_zip) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('R6 baseline ZIP changed; AutoQA release refused')
    if set(provided) != set(AUTOQA_FILES):
        raise GateFailure('AutoQA source file allowlist mismatch')
    for path, expected in AUTOQA_FILES.items():
        if sha256(provided[path]) != expected:
            raise GateFailure('AutoQA pinned file mismatch: ' + path)
    if check_workflow(before, LAB_BASELINE_ZIP_SHA256) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('Original Pages checksum changed')
    anchor = '      - uses: actions/configure-pages@v5\n'
    if before.count(anchor) != 1 or AUTOQA_STEP in before:
        raise GateFailure('AutoQA workflow insert anchor invalid')
    if after != before.replace(anchor, AUTOQA_STEP + anchor, 1):
        raise GateFailure('AutoQA changed workflow beyond the one allowed stage')
    if check_workflow(after, LAB_BASELINE_ZIP_SHA256) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('AutoQA cannot modify R6 release checksum')
    _, base_files = inspect_zip_bytes_for_autoqa(old_zip)
    if any(name.startswith(AUTOQA_PATH) for name in base_files):
        raise GateFailure('AutoQA path collision in site.zip')
    with tempfile.TemporaryDirectory() as temp:
        root = pathlib.Path(temp)
        site = root / '_site'
        for name, raw in base_files.items():
            target = site / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
        src = root / 'experiments' / 'r6-asr-autoqa'
        src.mkdir(parents=True)
        for path, raw in provided.items():
            (src / pathlib.Path(path).name).write_bytes(raw)
        subprocess.run([sys.executable, str(src / 'test_build_qa.py')], check=True, cwd=root)
        subprocess.run([sys.executable, str(src / 'build_qa.py'), str(site), str(src)], check=True, cwd=root)
        if not (site / AUTOQA_PATH / 'whisper-bridge.mjs').is_file():
            raise GateFailure('AutoQA output missing required engine')
        if not (site / ASR_PREFIX / 'app.js').is_file():
            raise GateFailure('R6 original ASR source lost')
        for name, raw in base_files.items():
            if (site / name).read_bytes() != raw:
                raise GateFailure('AutoQA changed original released asset: ' + name)
    return True


def inspect_zip_bytes_for_autoqa(raw):
    with tempfile.TemporaryDirectory() as d:
        file = pathlib.Path(d) / 'source.zip'
        file.write_bytes(raw)
        return inspect_zip(file)



# Exactly one namespace isolation correction to the newly staged AutoQA route.
AUTOQA_NAMESPACE_PATCH = {
    'experiments/r6-asr-autoqa/build_qa.py': 'd90831cba6f243a1975278bdea5437fb2849f33b5bc9882c250a7ca4bf3cbc9e',
    'experiments/r6-asr-autoqa/test_build_qa.py': '780f83c1180dc58875f9312a8b0cec7380d63619d9eb3c9625246a42e596db50',
}


def verify_autoqa_namespace_patch(workflow, bundle, source_files):
    if sha256(bundle) != LAB_BASELINE_ZIP_SHA256 or workflow.count(AUTOQA_STEP) != 1:
        raise GateFailure('AutoQA namespace patch requires exactly the existing immutable R6 Pages deployment')
    if set(source_files) != set(AUTOQA_FILES):
        raise GateFailure('AutoQA namespace patch files invalid')
    for name, expected in AUTOQA_FILES.items():
        wanted = AUTOQA_NAMESPACE_PATCH.get(name, expected)
        if sha256(source_files[name]) != wanted:
            raise GateFailure('AutoQA namespace patch SHA differs: ' + name)
    if check_workflow(workflow, LAB_BASELINE_ZIP_SHA256) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('AutoQA namespace patch cannot change site.zip checksum')
    _, baseline = inspect_zip_bytes_for_autoqa(bundle)
    if any(n.startswith(AUTOQA_PATH) for n in baseline):
        raise GateFailure('AutoQA path collision')
    with tempfile.TemporaryDirectory() as temp:
        root = pathlib.Path(temp)
        site = root / '_site'
        for name, value in baseline.items():
            dest = site / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(value)
        module_dir = root / 'experiments' / 'r6-asr-autoqa'
        module_dir.mkdir(parents=True)
        for name, value in source_files.items():
            (module_dir / pathlib.Path(name).name).write_bytes(value)
        subprocess.run([sys.executable,str(module_dir/'test_build_qa.py')],check=True,cwd=root)
        subprocess.run([sys.executable,str(module_dir/'build_qa.py'),str(site),str(module_dir)],check=True,cwd=root)
        js = (site / AUTOQA_PATH / 'app.js').read_text()
        for isolated in (
            "'tcl-specialty-v352-asr-autoqa'",
            "'tcl-specialty-v352-asr-autoqa-workflow'",
            "'tcl-specialty-v352-asr-autoqa-vosk-v1'",
        ):
            if isolated not in js:
                raise GateFailure('AutoQA state namespace not isolated: ' + isolated)
        for name, value in baseline.items():
            if (site / name).read_bytes() != value:
                raise GateFailure('AutoQA namespace patch altered released asset: ' + name)
    return True



# R2.1: one exact additional test route; input source is a SHA-pinned archive.
R21_ARCHIVE = 'experiments/r6-asr-autoqa-r2/audited-source.tar.gz.b64'
R21_ARCHIVE_B64_SHA = 'c5c4488a2590f71416714bcd08efdc46b6fcb9653359cda435b18edd9d8ede10'
R21_APP_SHA = '86ca65f2c0f898e0953193c1489ae6221c06aa3dea57b7187113465249d727e4'
R21_STEP = (
    '      - name: Stage R2.1 isolated original-audio ASR pilot\n'
    '        run: |\n'
    '          python3 release-ci/stage_r21.py --site-dir _site --archive experiments/r6-asr-autoqa-r2/audited-source.tar.gz.b64\n'
    '          echo "86ca65f2c0f898e0953193c1489ae6221c06aa3dea57b7187113465249d727e4  _site/tcl-v352-asr-autoqa-r2/app.js" | sha256sum --check --strict\n'
)


def verify_r21_release(before, after, archive_bytes, baseline_bytes):
    if sha256(baseline_bytes) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('R2.1 release would modify stable R6 site.zip')
    if sha256(archive_bytes) != R21_ARCHIVE_B64_SHA:
        raise GateFailure('R2.1 upload did not match SHA-pinned source')
    if check_workflow(before, LAB_BASELINE_ZIP_SHA256) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('R2.1 baseline workflow hash mismatch')
    anchor = '      - uses: actions/configure-pages@v5\n'
    if before.count(anchor) != 1 or R21_STEP in before:
        raise GateFailure('R2.1 workflow insertion anchor is invalid')
    if after != before.replace(anchor,R21_STEP+anchor,1):
        raise GateFailure('R2.1 attempted unrelated workflow modification')
    if check_workflow(after, LAB_BASELINE_ZIP_SHA256) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('R2.1 cannot change site.zip checksum')
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp)
        zip_file=root/'baseline.zip'
        zip_file.write_bytes(baseline_bytes)
        site=root/'_site'
        extract_zip_safely(zip_file,site)
        if (site/'tcl-v352-asr-autoqa-r2').exists():
            raise GateFailure('R2.1 would overwrite an existing Pages path')
        archive=root/'source.tar.gz.b64'
        archive.write_bytes(archive_bytes)
        runner=pathlib.Path('release-ci/stage_r21.py').resolve()
        if not runner.is_file():
            raise GateFailure('Trusted R2.1 builder missing from current main')
        try:
            subprocess.run([sys.executable,str(runner),'--site-dir',str(site),
                            '--archive',str(archive),'--browser'],
                           check=True,cwd=root,timeout=540)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise GateFailure('R2.1 independent QA or browser E2E failed: '+str(exc))
        if sha256((site/'tcl-v352-asr-autoqa-r2/app.js').read_bytes()) != R21_APP_SHA:
            raise GateFailure('R2.1 built app hash mismatch')
    return True



# Exact one-time R2.3 free Base/Tiny model test path. No official ZIP mutation.
R23_ARCHIVE='experiments/r6-asr-autoqa-r23/site-only.tar.gz.b64'
R23_ARCHIVE_SHA256='3876e40c30ac787f9833338fd4dce5d3df611f6120010174d82d3246e7f802c0'
R23_APP_SHA256='3507523677b209f157449ede0d285a967cb0f7117f807ecc4d7697ac7f3f2add'
R23_STEP=(
    '      - name: Stage R2.3 isolated free Mandarin ASR preview\n'
    '        run: |\n'
    '          python3 release-ci/stage_r23.py --site-dir _site --archive experiments/r6-asr-autoqa-r23/site-only.tar.gz.b64\n'
    '          echo "3507523677b209f157449ede0d285a967cb0f7117f807ecc4d7697ac7f3f2add  _site/tcl-v352-asr-autoqa-r23/app.js" | sha256sum --check --strict\n'
)

def verify_r23_additive_release(before, after, archive, zipbytes):
    if sha256(zipbytes)!=LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('R2.3 cannot change production site.zip')
    if sha256(archive)!=R23_ARCHIVE_SHA256:
        raise GateFailure('R2.3 release must use exact audited archive')
    if check_workflow(before,LAB_BASELINE_ZIP_SHA256)!=LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('Unexpected Pages deployment workflow baseline')
    anchor='      - uses: actions/configure-pages@v5\n'
    if before.count(anchor)!=1 or R23_STEP in before:
        raise GateFailure('R2.3 path must be staged once only')
    if after!=before.replace(anchor,R23_STEP+anchor,1):
        raise GateFailure('R2.3 altered unrelated Pages steps')
    if check_workflow(after,LAB_BASELINE_ZIP_SHA256)!=LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('R2.3 cannot change production ZIP digest')
    with tempfile.TemporaryDirectory() as temp:
        root=pathlib.Path(temp)
        zip_path=root/'site.zip'
        zip_path.write_bytes(zipbytes)
        site=root/'_site'
        extract_zip_safely(zip_path,site)
        if (site/'tcl-v352-asr-autoqa-r23').exists():
            raise GateFailure('R2.3 would overwrite existing test path')
        # Recreate the R2.1 stage from the unchanged main sources, exactly as
        # the Pages workflow does before the new R2.3 stage is reached.
        r21_runner=pathlib.Path('release-ci/stage_r21.py').resolve()
        r21_archive=pathlib.Path('experiments/r6-asr-autoqa-r2/audited-source.tar.gz.b64').resolve()
        if not r21_runner.is_file() or not r21_archive.is_file():
            raise GateFailure('Trusted preceding R2.1 stage inputs are missing')
        try:
            subprocess.run([sys.executable,str(r21_runner),'--site-dir',str(site),
                            '--archive',str(r21_archive)],
                           cwd=root,check=True,timeout=240)
        except (subprocess.CalledProcessError,subprocess.TimeoutExpired) as err:
            raise GateFailure('Prerequisite R2.1 stage failed: '+str(err))
        source=root/'r23-site.tar.gz.b64'
        source.write_bytes(archive)
        runner=pathlib.Path('release-ci/stage_r23.py').resolve()
        if not runner.is_file() or not runner.with_name('r23_browser_e2e.py').is_file():
            raise GateFailure('Required trusted R2.3 staging and browser tests not on main')
        try:
            subprocess.run([sys.executable,str(runner),'--site-dir',str(site),
                            '--archive',str(source),'--browser'],
                           cwd=root,check=True,timeout=500)
        except (subprocess.CalledProcessError,subprocess.TimeoutExpired) as err:
            raise GateFailure('R2.3 browser/asset QA FAILED: '+str(err))
        if sha256((site/'tcl-v352-asr-autoqa-r23/app.js').read_bytes())!=R23_APP_SHA256:
            raise GateFailure('R2.3 built app.js changed')
    return True


# R2.4 uses a separately reviewed, fixed static archive. This policy is merged
# first; the later release PR can only add that archive and one exact workflow
# stage. Parsing/syntax checking the static JS does not execute candidate code.
R24_ARCHIVE = 'experiments/r24-release/site-only.zip.b64'
R24_DEST = 'tcl-v352-asr-r24-qa'
R24_ARCHIVE_B64_SHA = '1e2135de3c602c1a934fbc86f1b14999899116d035fe01d627903fd1ceb0f456'
R24_ARCHIVE_SHA = '7dc19da8838015a9e870ac21c2672b57a273f342f657d9b254f495ee15ba08ef'
R24_ASSET_HASHES = {'app-config.json': '52a2881798fa934df390727eb8b71084c1e823bcef164207e6352e486c432511',
 'app.js': 'b086a0c5c9610f338d9c5ac86db631b191758c7bc4e7f50228777d6dd5144deb',
 'asr-glossary.mjs': 'cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245',
 'asr-normalize.mjs': '9d78f9e50c5bb8602e9cac37f72ca807776c9a2c966a7817f94ac88d8899ec13',
 'glossary-ui.mjs': 'e4569e13333eacd891bf6ea7f8b6920ad344faf6c02f934443ff4d150d5d19cb',
 'index.html': '39a04e9845975e7eb874401f6864f4facb12d498168d50570cc5e444e428d59e',
 'legacy-65.json': 'd122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f',
 'lib/parser.js': '7509eb3b9b43a5cec8aff80f2f6f3ccf4857e194608e87740ea117553cf225cd',
 'lib/pdf.js': '3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b',
 'lib/qa-import.js': 'bfe7562e3c2647693ce9d58f87f466acc8459aa06ab4e983115b012d754d155f',
 'lib/xls.js': '11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c',
 'lib/zip.js': '5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4',
 'r23-model-choice.js': 'c8dad8eb7a9e9a564e8013329f69c671f724ea38a15b1ee17299ac36b9e07596',
 'static-manifest.json': '1bd52fc2e11966101ed53309b8e6861bb05fbd8fa65f1a984463347945748ba8',
 'style.css': '9fd8d441e2e81bb6ab0cfa2e4d1d1120a60155dfc6ac12d748187b067f4400ed',
 'training-boards.json': 'e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11',
 'vendor/opencc/LICENSE': '960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e',
 'vendor/opencc/LICENSES/Apache-2.0.txt': 'b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308',
 'vendor/opencc/THIRD_PARTY_LICENSES.md': '42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806',
 'vendor/opencc/t2cn.mjs': 'b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6',
 'whisper-bridge.mjs': 'b93887710d61766d01396f9eb6da357c3460519877fca595b08e793d9a1b41c4'}
# A second, independently reviewed snapshot for the same route. Keep the
# original pins valid while this CI-only change deploys the existing archive.
R24_UPDATE_ARCHIVE_B64_SHA = '7bb350cdb4d909ed562fe9b734bc93867f56e7c01f2735c0bb5345381a7b7925'
R24_UPDATE_ARCHIVE_SHA = '621456a7a1b89a7183aa6babf00711a627f1959a3f880e086920886bf2688764'
R24_UPDATE_ASSET_HASHES = {'app-config.json': '52a2881798fa934df390727eb8b71084c1e823bcef164207e6352e486c432511',
 'app.js': '88b3ce2a8a9cf889f1579337f6d78f83e03dbf3c9bff6fffbb41f1ca0e25e900',
 'asr-glossary.mjs': 'cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245',
 'asr-normalize.mjs': '9d78f9e50c5bb8602e9cac37f72ca807776c9a2c966a7817f94ac88d8899ec13',
 'glossary-ui.mjs': 'e4569e13333eacd891bf6ea7f8b6920ad344faf6c02f934443ff4d150d5d19cb',
 'index.html': '39a04e9845975e7eb874401f6864f4facb12d498168d50570cc5e444e428d59e',
 'legacy-65.json': 'd122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f',
 'lib/parser.js': '8603c685ac21f0486756af8599be4379b5f855118372d9224c8260e279c942f8',
 'lib/pdf.js': '3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b',
 'lib/qa-import.js': 'bde9f1702b8d0975f4dc45e02eb2bf988bd318d3844a6a7d7e2467c39ec605c0',
 'lib/xls.js': '11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c',
 'lib/zip.js': '5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4',
 'r23-model-choice.js': 'c8dad8eb7a9e9a564e8013329f69c671f724ea38a15b1ee17299ac36b9e07596',
 'static-manifest.json': 'fb37d10358aa4a48e664efe52b72f466c90b873928f14ffb4b6cab92c4eed908',
 'style.css': '9fd8d441e2e81bb6ab0cfa2e4d1d1120a60155dfc6ac12d748187b067f4400ed',
 'training-boards.json': 'e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11',
 'vendor/opencc/LICENSE': '960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e',
 'vendor/opencc/LICENSES/Apache-2.0.txt': 'b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308',
 'vendor/opencc/THIRD_PARTY_LICENSES.md': '42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806',
 'vendor/opencc/t2cn.mjs': 'b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6',
 'whisper-bridge.mjs': 'b93887710d61766d01396f9eb6da357c3460519877fca595b08e793d9a1b41c4'}
R24_UPDATE_CHANGED_FILES = frozenset({
    'app.js', 'lib/parser.js', 'lib/qa-import.js', 'static-manifest.json',
})
# Exact third snapshot: imported-table-first, source-consistent question selection.
R24_QUESTION_ARCHIVE_B64_SHA = '5e72a5789ec67a1812827575419f8b65a4b009ba864041c934cd32fc3d3f7238'
R24_QUESTION_ARCHIVE_SHA = 'ae11a883568c8b16ce739640656a3c7ceba34f93bc9ec1db735832d210c269c0'
R24_QUESTION_ASSET_HASHES = {'app-config.json': '52a2881798fa934df390727eb8b71084c1e823bcef164207e6352e486c432511',
 'app.js': 'd090543e3bdd010dfa95580c4f6a5dcd7185f116225ff02674120954c10cbecf',
 'asr-glossary.mjs': 'cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245',
 'asr-normalize.mjs': '9d78f9e50c5bb8602e9cac37f72ca807776c9a2c966a7817f94ac88d8899ec13',
 'glossary-ui.mjs': 'e4569e13333eacd891bf6ea7f8b6920ad344faf6c02f934443ff4d150d5d19cb',
 'index.html': '39a04e9845975e7eb874401f6864f4facb12d498168d50570cc5e444e428d59e',
 'legacy-65.json': 'd122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f',
 'lib/parser.js': '8603c685ac21f0486756af8599be4379b5f855118372d9224c8260e279c942f8',
 'lib/pdf.js': '3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b',
 'lib/qa-import.js': 'fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86',
 'lib/xls.js': '11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c',
 'lib/zip.js': '5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4',
 'r23-model-choice.js': 'c8dad8eb7a9e9a564e8013329f69c671f724ea38a15b1ee17299ac36b9e07596',
 'static-manifest.json': 'e180ea95d363c6e63b11093696e4c3ac3358539687fa1425c5e8e98a07c9f386',
 'style.css': '9fd8d441e2e81bb6ab0cfa2e4d1d1120a60155dfc6ac12d748187b067f4400ed',
 'training-boards.json': 'e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11',
 'vendor/opencc/LICENSE': '960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e',
 'vendor/opencc/LICENSES/Apache-2.0.txt': 'b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308',
 'vendor/opencc/THIRD_PARTY_LICENSES.md': '42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806',
 'vendor/opencc/t2cn.mjs': 'b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6',
 'whisper-bridge.mjs': 'b93887710d61766d01396f9eb6da357c3460519877fca595b08e793d9a1b41c4'}
R24_QUESTION_CHANGED_FILES = frozenset({'app.js', 'lib/qa-import.js', 'static-manifest.json'})
# Exact fourth snapshot: mobile rendering and isolated ASR computation.
# Keep earlier snapshots pinned for the CI-only rollout and exact rollback.
R24_SMOOTH_ARCHIVE_B64_SHA = 'faf17c031db0dc12f6bd962c72bef2bc80891fcdb189841d7eb6de7b994ab3a1'
R24_SMOOTH_ARCHIVE_SHA = '42a36a4a706ebb621fb5bc1416ea1c223076e342a98db9d259c69885ece5dbdb'
R24_SMOOTH_ASSET_HASHES = {'app-config.json': '52a2881798fa934df390727eb8b71084c1e823bcef164207e6352e486c432511',
 'app.js': '1af535545457ba38a0ecd162020ee47ae43340f1855a6945a27fade10e461e80',
 'asr-glossary.mjs': 'cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245',
 'asr-normalize.mjs': '9d78f9e50c5bb8602e9cac37f72ca807776c9a2c966a7817f94ac88d8899ec13',
 'glossary-ui.mjs': 'e4569e13333eacd891bf6ea7f8b6920ad344faf6c02f934443ff4d150d5d19cb',
 'index.html': '39a04e9845975e7eb874401f6864f4facb12d498168d50570cc5e444e428d59e',
 'legacy-65.json': 'd122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f',
 'lib/parser.js': '8603c685ac21f0486756af8599be4379b5f855118372d9224c8260e279c942f8',
 'lib/pdf.js': '3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b',
 'lib/qa-import.js': 'fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86',
 'lib/xls.js': '11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c',
 'lib/zip.js': '5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4',
 'r23-model-choice.js': 'c8dad8eb7a9e9a564e8013329f69c671f724ea38a15b1ee17299ac36b9e07596',
 'static-manifest.json': '365f7345d4debdc15b10197a078f8867eef6a19657d2dcde48f6eadd1413216e',
 'style.css': '66a6d397a963532e9ef24223dd425867439528c22e5e2f998635bb30611a4ec4',
 'training-boards.json': 'e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11',
 'vendor/opencc/LICENSE': '960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e',
 'vendor/opencc/LICENSES/Apache-2.0.txt': 'b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308',
 'vendor/opencc/THIRD_PARTY_LICENSES.md': '42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806',
 'vendor/opencc/t2cn.mjs': 'b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6',
 'whisper-bridge.mjs': '01c07b050daacfdd94f6da6c50821d0645286dd956d1999bed2993e1240b97c2',
 'whisper-worker.mjs': '5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b'}
R24_SMOOTH_CHANGED_FILES = frozenset({
    'app.js', 'style.css', 'whisper-bridge.mjs', 'static-manifest.json', 'whisper-worker.mjs',
})
R24_SMOOTH_ADDED_FILES = frozenset({'whisper-worker.mjs'})
# Exact fifth snapshot: stable review rendering and immediate differential record writes.
R24_REVIEW_ARCHIVE_B64_SHA = 'f31dda6f04a1b32d2e38dba9e6db6b3f0c2d9ed62c84613caef1f7e78be4c3da'
R24_REVIEW_ARCHIVE_SHA = '8c569a3f9b2adee09cc6ca668b121ab2390321eb76ad5e12c011acc7b3778b1a'
R24_REVIEW_ASSET_HASHES = {'app-config.json': '52a2881798fa934df390727eb8b71084c1e823bcef164207e6352e486c432511',
 'app.js': '63519c50a5325056819bdaaffbcdbd59270fd47dbac6ac796f728b6cef9e1816',
 'asr-glossary.mjs': 'cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245',
 'asr-normalize.mjs': '9d78f9e50c5bb8602e9cac37f72ca807776c9a2c966a7817f94ac88d8899ec13',
 'glossary-ui.mjs': 'e4569e13333eacd891bf6ea7f8b6920ad344faf6c02f934443ff4d150d5d19cb',
 'index.html': '39a04e9845975e7eb874401f6864f4facb12d498168d50570cc5e444e428d59e',
 'legacy-65.json': 'd122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f',
 'lib/parser.js': '8603c685ac21f0486756af8599be4379b5f855118372d9224c8260e279c942f8',
 'lib/pdf.js': '3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b',
 'lib/qa-import.js': 'fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86',
 'lib/xls.js': '11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c',
 'lib/zip.js': '5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4',
 'r23-model-choice.js': 'c8dad8eb7a9e9a564e8013329f69c671f724ea38a15b1ee17299ac36b9e07596',
 'static-manifest.json': 'd44808ef010d6db8498885fc9e3805256face48090aaaeb05af0401df5a2e5a7',
 'style.css': '35a869c93470924b66ea01ffe65ef7a578b34e8f61ab4bf1b89d98485b8ec5f2',
 'training-boards.json': 'e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11',
 'vendor/opencc/LICENSE': '960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e',
 'vendor/opencc/LICENSES/Apache-2.0.txt': 'b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308',
 'vendor/opencc/THIRD_PARTY_LICENSES.md': '42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806',
 'vendor/opencc/t2cn.mjs': 'b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6',
 'whisper-bridge.mjs': '01c07b050daacfdd94f6da6c50821d0645286dd956d1999bed2993e1240b97c2',
 'whisper-worker.mjs': '5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b'}
R24_REVIEW_CHANGED_FILES = frozenset({'app.js', 'style.css', 'static-manifest.json'})
R24_MAX_ENCODED_BYTES = 2_000_000
R24_MAX_RAW_BYTES = 1_500_000
R24_MAX_RESOURCE_BYTES = 750_000
R24_MAX_TOTAL_BYTES = 3_000_000
R24_TRUSTED_INPUTS = (
    LAB_SOURCE,
    'experiments/r6-asr-autoqa/build_qa.py',
    'experiments/r6-asr-autoqa/whisper-bridge.mjs',
    'release-ci/stage_r21.py', R21_ARCHIVE,
    'release-ci/stage_r23.py', R23_ARCHIVE,
)
R24_REQUIRED_BASELINES = {
    ASR_PREFIX + 'app.js': ASR_R6_APP_SHA,
    'tcl-v352-asr-autoqa-r2/app.js': R21_APP_SHA,
    'tcl-v352-asr-autoqa-r23/app.js': R23_APP_SHA256,
}


def r24_stage_step():
    return (
        '      - name: Stage R2.4 isolated practice-room delivery\n'
        '        run: |\n'
        f'          python3 release-ci/release_guard.py --stage-r24 _site {R24_ARCHIVE}\n'
    )


def r24_resource_bytes(encoded):
    encoded_sha = sha256(encoded)
    snapshots = (
        (R24_ARCHIVE_B64_SHA, R24_ARCHIVE_SHA, R24_ASSET_HASHES),
        (R24_UPDATE_ARCHIVE_B64_SHA, R24_UPDATE_ARCHIVE_SHA, R24_UPDATE_ASSET_HASHES),
        (R24_QUESTION_ARCHIVE_B64_SHA, R24_QUESTION_ARCHIVE_SHA, R24_QUESTION_ASSET_HASHES),
        (R24_SMOOTH_ARCHIVE_B64_SHA, R24_SMOOTH_ARCHIVE_SHA, R24_SMOOTH_ASSET_HASHES),
        (R24_REVIEW_ARCHIVE_B64_SHA, R24_REVIEW_ARCHIVE_SHA, R24_REVIEW_ASSET_HASHES),
    )
    selected = [pins for pins in snapshots if pins[0] == encoded_sha]
    if len(encoded) > R24_MAX_ENCODED_BYTES or len(selected) != 1:
        raise GateFailure('R2.4 exact encoded archive hash/size mismatch')
    encoded_pin, zip_pin, asset_hashes = selected[0]
    if not asset_hashes or not all(re.fullmatch('[0-9a-f]{64}', digest)
            for digest in (encoded_pin, zip_pin, *asset_hashes.values())):
        raise GateFailure('R2.4 policy has not been frozen to reviewed content')
    try:
        raw = base64.b64decode(encoded.strip(), validate=True)
    except (ValueError, TypeError) as err:
        raise GateFailure('R2.4 invalid base64 archive') from err
    if len(raw) > R24_MAX_RAW_BYTES or sha256(raw) != zip_pin:
        raise GateFailure('R2.4 exact ZIP archive hash/size mismatch')
    _, resources = inspect_zip_bytes_for_autoqa(raw)
    allowed = {R24_DEST + '/' + name for name in asset_hashes}
    if set(resources) != allowed:
        raise GateFailure('R2.4 static resource allowlist mismatch')
    # A directory record is not a static resource; reject even harmless extras.
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        if len(archive.infolist()) != len(allowed):
            raise GateFailure('R2.4 archive entry count mismatch')
        if any(stat.S_IFMT(info.external_attr >> 16) not in (0, stat.S_IFREG)
               for info in archive.infolist()):
            raise GateFailure('R2.4 non-regular static resource')
        if any(not info.file_size or info.file_size > R24_MAX_RESOURCE_BYTES
               for info in archive.infolist()):
            raise GateFailure('R2.4 static resource size invalid')
    if sum(map(len, resources.values())) > R24_MAX_TOTAL_BYTES:
        raise GateFailure('R2.4 static resource total size exceeded')
    data = {name: resources[R24_DEST + '/' + name] for name in asset_hashes}
    for name, digest in asset_hashes.items():
        if sha256(data[name]) != digest:
            raise GateFailure('R2.4 resource hash mismatch: ' + name)
    manifest = json.loads(data['static-manifest.json'])
    expected = {name: sha256(value) for name, value in data.items()
                if name != 'static-manifest.json'}
    if manifest.get('files') != expected:
        raise GateFailure('R2.4 manifest coverage/hash mismatch')
    return data


def stage_r24(site_path, archive_path):
    site = pathlib.Path(site_path).resolve()
    archive = pathlib.Path(archive_path)
    if not site.is_dir() or archive.stat().st_size > R24_MAX_ENCODED_BYTES:
        raise GateFailure('R2.4 staging site absent or archive oversized')
    if any(path.is_symlink() for path in site.rglob('*')):
        raise GateFailure('R2.4 staging cannot traverse existing symlinks')
    output = site / R24_DEST
    if output.exists() or output.is_symlink():
        raise GateFailure('R2.4 target already exists; refuse overwrite')
    for name, digest in R24_REQUIRED_BASELINES.items():
        path = site / name
        if not path.is_file() or sha256(path.read_bytes()) != digest:
            raise GateFailure('R2.4 protected baseline absent/changed: ' + name)
    resources = r24_resource_bytes(archive.read_bytes())
    before = {path.relative_to(site).as_posix(): sha256(path.read_bytes())
              for path in site.rglob('*') if path.is_file()}
    # Validate every byte and JS syntax before publishing the new directory.
    # Use a sibling filesystem temporary directory so rename is atomic.
    with tempfile.TemporaryDirectory(prefix='.r24-stage-', dir=site.parent) as temp:
        staged = pathlib.Path(temp) / R24_DEST
        staged.mkdir()
        for name, data in resources.items():
            target = staged / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            if name.endswith(('.js', '.mjs')):
                try:
                    subprocess.run(['node', '--input-type=module', '--check'],
                                   input=data, check=True, capture_output=True, timeout=30)
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as err:
                    raise GateFailure('R2.4 JavaScript syntax check failed: ' + name) from err
        for name, digest in before.items():
            if sha256((site / name).read_bytes()) != digest:
                raise GateFailure('R2.4 altered protected resource: ' + name)
        staged.rename(output)
    report = {'files': len(resources), 'old_assets_unchanged': len(before),
              'app_sha': sha256(resources['app.js'])}
    print('R24_STAGE_PASS', json.dumps(report, sort_keys=True))
    return report


def r24_rebuild_previous_stages(root, zipbytes, trusted_inputs):
    """Rebuild only immutable older routes from explicit baseline-commit bytes."""
    if set(trusted_inputs) != set(R24_TRUSTED_INPUTS):
        raise GateFailure('R2.4 trusted baseline input set mismatch')
    zip_path = root / 'baseline.zip'
    zip_path.write_bytes(zipbytes)
    site = root / '_site'
    extract_zip_safely(zip_path, site)
    # These are read with git show(base, path), never from candidate paths.
    for name, data in trusted_inputs.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    if sha256(trusted_inputs[LAB_SOURCE]) != LAB_HTML_SHA256:
        raise GateFailure('R2.4 protected audio lab hash mismatch')
    lab = site / LAB_TARGET
    lab.parent.mkdir(parents=True, exist_ok=True)
    lab.write_bytes(trusted_inputs[LAB_SOURCE])
    commands = (
        [sys.executable, 'experiments/r6-asr-autoqa/build_qa.py',
         str(site), 'experiments/r6-asr-autoqa'],
        [sys.executable, 'release-ci/stage_r21.py', '--site-dir', str(site),
         '--archive', R21_ARCHIVE],
        [sys.executable, 'release-ci/stage_r23.py', '--site-dir', str(site),
         '--archive', R23_ARCHIVE],
    )
    for command in commands:
        try:
            subprocess.run(command, cwd=root, check=True, timeout=180)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as err:
            raise GateFailure('R2.4 protected preceding stage failed') from err
    return site


def verify_r24_additive_release(before, after, encoded, zipbytes, trusted_inputs):
    if sha256(zipbytes) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('R2.4 cannot change the protected site.zip')
    if check_workflow(before, LAB_BASELINE_ZIP_SHA256) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('R2.4 baseline workflow ZIP hash mismatch')
    if before.count(LAB_ANCHOR) != 1 or r24_stage_step() in before:
        raise GateFailure('R2.4 workflow insertion must occur exactly once')
    if any(before.count(step) != 1 for step in
           (lab_stage_step(), AUTOQA_STEP, R21_STEP, R23_STEP)):
        raise GateFailure('R2.4 requires the unchanged preceding Pages stages')
    if after != before.replace(LAB_ANCHOR, r24_stage_step() + LAB_ANCHOR, 1):
        raise GateFailure('R2.4 changed unrelated Pages workflow content')
    if set(trusted_inputs) != set(R24_TRUSTED_INPUTS):
        raise GateFailure('R2.4 trusted baseline input set mismatch')
    r24_resource_bytes(encoded)
    with tempfile.TemporaryDirectory() as temp:
        root = pathlib.Path(temp)
        site = r24_rebuild_previous_stages(root, zipbytes, trusted_inputs)
        source = root / 'r24-source.zip.b64'
        source.write_bytes(encoded)
        stage_r24(site, source)
    return True


def verify_r24_archive_update(workflow, old_encoded, new_encoded, zipbytes, trusted_inputs):
    """Allow only explicit adjacent frozen version pairs and their exact reversals."""
    pair = (sha256(old_encoded), sha256(new_encoded))
    transitions = (
        ((R24_ARCHIVE_B64_SHA, R24_UPDATE_ARCHIVE_B64_SHA), R24_UPDATE_CHANGED_FILES, frozenset()),
        ((R24_UPDATE_ARCHIVE_B64_SHA, R24_QUESTION_ARCHIVE_B64_SHA), R24_QUESTION_CHANGED_FILES, frozenset()),
        ((R24_QUESTION_ARCHIVE_B64_SHA, R24_SMOOTH_ARCHIVE_B64_SHA), R24_SMOOTH_CHANGED_FILES, R24_SMOOTH_ADDED_FILES),
        ((R24_SMOOTH_ARCHIVE_B64_SHA, R24_REVIEW_ARCHIVE_B64_SHA), R24_REVIEW_CHANGED_FILES, frozenset()),
    )
    matches = [(forward, changed, added) for forward, changed, added in transitions
               if pair in (forward, forward[::-1]) and pair[0] != pair[1]]
    if len(matches) != 1:
        raise GateFailure('R2.4 update requires the exact old/new snapshot pair')
    forward, expected_changed, added_forward = matches[0]
    added, removed = (added_forward, frozenset()) if pair == forward else (frozenset(), added_forward)
    if sha256(zipbytes) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('R2.4 update cannot change protected site.zip')
    if check_workflow(workflow, LAB_BASELINE_ZIP_SHA256) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('R2.4 update must retain the protected ZIP checksum')
    if workflow.count(r24_stage_step()) != 1 or any(workflow.count(step) != 1
            for step in (lab_stage_step(), AUTOQA_STEP, R21_STEP, R23_STEP)):
        raise GateFailure('R2.4 update must retain all existing Pages stages')
    old_data, new_data = r24_resource_bytes(old_encoded), r24_resource_bytes(new_encoded)
    if set(new_data) - set(old_data) != added or set(old_data) - set(new_data) != removed:
        raise GateFailure('R2.4 update cannot change the static resource set outside the exact reviewed additions/removals')
    changed = {name for name in set(old_data) | set(new_data) if old_data.get(name) != new_data.get(name)}
    if changed != expected_changed:
        scope = ('four files' if expected_changed == R24_UPDATE_CHANGED_FILES else
                 'three files' if expected_changed in (R24_QUESTION_CHANGED_FILES, R24_REVIEW_CHANGED_FILES) else 'five files')
        raise GateFailure('R2.4 update changed resources outside the exact reviewed ' + scope)
    with tempfile.TemporaryDirectory() as temp:
        root = pathlib.Path(temp)
        old_site = r24_rebuild_previous_stages(root, zipbytes, trusted_inputs)
        protected = {p.relative_to(old_site).as_posix(): p.read_bytes()
                     for p in old_site.rglob('*') if p.is_file()}
        new_site = root / '_updated_site'
        shutil.copytree(old_site, new_site)
        for label, encoded, site in (('old', old_encoded, old_site), ('new', new_encoded, new_site)):
            archive = root / (label + '-r24.zip.b64')
            archive.write_bytes(encoded)
            stage_r24(site, archive)
            for name, data in protected.items():
                if (site / name).read_bytes() != data:
                    raise GateFailure('R2.4 update modified an older Pages resource: ' + name)
        old_files = {p.relative_to(old_site).as_posix(): p.read_bytes()
                     for p in old_site.rglob('*') if p.is_file()}
        new_files = {p.relative_to(new_site).as_posix(): p.read_bytes()
                     for p in new_site.rglob('*') if p.is_file()}
        actual_changed = {name for name in set(old_files) | set(new_files)
                          if old_files.get(name) != new_files.get(name)}
        if (set(new_files) - set(old_files) != {R24_DEST + '/' + name for name in added}
                or set(old_files) - set(new_files) != {R24_DEST + '/' + name for name in removed}
                or actual_changed != {R24_DEST + '/' + name for name in changed}):
            raise GateFailure('R2.4 final Pages trees differ outside the exact update scope')
    result = {'direction': 'update' if pair == forward else 'rollback',
              'protected_assets': len(protected), 'total_assets': len(new_files),
              'changed': sorted(actual_changed)}
    print('R24_UPDATE_PASS', json.dumps(result, sort_keys=True))
    return result


def verify_r24_rollback(before, after, removed_archive, zipbytes):
    """Only undo this exact additive release; never erase older routes/data."""
    if sha256(zipbytes) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('R2.4 rollback cannot change protected site.zip')
    r24_resource_bytes(removed_archive)
    step = r24_stage_step()
    if before.count(step) != 1 or after != before.replace(step, '', 1):
        raise GateFailure('R2.4 rollback must remove only the exact R2.4 stage')
    if check_workflow(after, LAB_BASELINE_ZIP_SHA256) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('R2.4 rollback changed original ZIP checksum')
    if any(after.count(old) != 1 for old in
           (lab_stage_step(), AUTOQA_STEP, R21_STEP, R23_STEP)):
        raise GateFailure('R2.4 rollback must retain all preceding Pages stages')
    return True


# R2.5 is an additive, separately approved route. Existing R2.4 snapshots stay pinned.
R25_ARCHIVE = 'experiments/r25-release/site-only.zip.b64'
R25_DEST = 'tcl-v352-asr-r25-qa'
R25_VERSION = 'r25-asr-fallback-20261116'
R25_ARCHIVE_B64_SHA = 'd7105747e91bb3a4fc878624b343aa047d1ae142787d72afa1822b94b38cab51'
R25_ARCHIVE_SHA = '52a47cf131c8dc402747230c672d96dfb1d3a9805b8a3dd18fc3d000c2cbe9d5'
R25_ASSET_HASHES = {'app-config.json': '52a2881798fa934df390727eb8b71084c1e823bcef164207e6352e486c432511',
 'app.js': '2848488723324db8a897fcb0fc4cbe577916b0e3e01cce8e05922aed8c3d1bfc',
 'asr-glossary.mjs': 'cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245',
 'asr-normalize.mjs': '3887eb1461728995541f9226fa1824559c22416a1f56624a8b1258dfff147168',
 'glossary-ui.mjs': 'a9bb72e929da66a8c6ee380c98b0c398e0da122bca9abde911f0c85267de874f',
 'index.html': '86860ac49ae85c7338fb2946907d2a013b13a6824a128b447b10810cb2938470',
 'legacy-65.json': 'd122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f',
 'lib/parser.js': '8603c685ac21f0486756af8599be4379b5f855118372d9224c8260e279c942f8',
 'lib/pdf.js': '3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b',
 'lib/qa-import.js': 'fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86',
 'lib/xls.js': '11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c',
 'lib/zip.js': '5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4',
 'r23-model-choice.js': 'b4c113a63795930fe20168645e5a0b9203433eac486391bf0e1f41fc4683f3ec',
 'static-manifest.json': '858d1d25afb68cf2cd0b1968f5a57340ce8a16113c0b44e1ae51bf2ebc87015b',
 'style.css': '35a869c93470924b66ea01ffe65ef7a578b34e8f61ab4bf1b89d98485b8ec5f2',
 'training-boards.json': 'e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11',
 'vendor/opencc/LICENSE': '960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e',
 'vendor/opencc/LICENSES/Apache-2.0.txt': 'b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308',
 'vendor/opencc/THIRD_PARTY_LICENSES.md': '42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806',
 'vendor/opencc/t2cn.mjs': 'b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6',
 'whisper-bridge.mjs': '47c1c6f676d1189a2272cd0d72b2f5f3abed3a4a0efe82e5c591e70df1f053ee',
 'whisper-worker.mjs': '5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b'}
# A separately reviewed same-route cloud snapshot. Keep the deployed ASR pins
# valid while this CI-only change is deployed, and for exact version rollback.
R25_CLOUD_VERSION = 'r25-cloud-sync-20261117'
R25_CLOUD_ARCHIVE_B64_SHA = 'f28f374a625196033492e678cac00bf70579fcb8d3cf9377c5fd3b4d6966b89e'
R25_CLOUD_ARCHIVE_SHA = '226e91efc7a6503fd0ef824e6ff1ab7f736c285c62daf89193f3fb698ee32f13'
R25_CLOUD_ASSET_HASHES = {'app-config.json': '3df42c4f593e9c10776631bac75d5526e1e2a00bcd4e14e2e51627bf7b8c3dea',
 'app.js': '888d4781eec3aa202c8d9627dabbc44678bcc8988b3bb195972c16f5ddf2f56b',
 'asr-glossary.mjs': 'cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245',
 'asr-normalize.mjs': '3887eb1461728995541f9226fa1824559c22416a1f56624a8b1258dfff147168',
 'cloud-workflow.mjs': 'd894b9133e96726be58d748bd604808018f963d6bb42c60eb14487b3aadfb364',
 'cloud-workspace.mjs': '98f6c09907a97d43d6ee8f4e1f58db184cde71d175eead66e089a6473263dd15',
 'cloudbase-adapter.mjs': 'a5611a7d0d82ae574b587fe25863d07017823cfe82c78ce085e4833a3fad1524',
 'glossary-ui.mjs': 'a9bb72e929da66a8c6ee380c98b0c398e0da122bca9abde911f0c85267de874f',
 'index.html': '86860ac49ae85c7338fb2946907d2a013b13a6824a128b447b10810cb2938470',
 'legacy-65.json': 'd122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f',
 'lib/parser.js': '8603c685ac21f0486756af8599be4379b5f855118372d9224c8260e279c942f8',
 'lib/pdf.js': '3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b',
 'lib/qa-import.js': 'fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86',
 'lib/xls.js': '11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c',
 'lib/zip.js': '5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4',
 'r23-model-choice.js': 'b4c113a63795930fe20168645e5a0b9203433eac486391bf0e1f41fc4683f3ec',
 'static-manifest.json': '0809a058ee286e12e37ab6d25ba15d5eb62c1ae8392caf52e623d56e0f2f22b2',
 'style.css': '31b61b22ed66caec4dd8ee993b55e5306c79f5f27c9ec47113ca47296cf99109',
 'training-boards.json': 'e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11',
 'vendor/cloudbase/LICENSE': '92d7d7d2d4771b84f44e38dc59052faae8e3cd0a234a62de6180a1c6746c979e',
 'vendor/cloudbase/README.md': '48665329cfa0baee544a8c57f38eb1518c9809430ebb0647aa904061db9ac767',
 'vendor/cloudbase/cloudbase-sdk.mjs': 'df0dc3e681ecc72e238ebd79b1099344457aca3f51beaa37b6fa704954cdb675',
 'vendor/opencc/LICENSE': '960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e',
 'vendor/opencc/LICENSES/Apache-2.0.txt': 'b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308',
 'vendor/opencc/THIRD_PARTY_LICENSES.md': '42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806',
 'vendor/opencc/t2cn.mjs': 'b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6',
 'whisper-bridge.mjs': '47c1c6f676d1189a2272cd0d72b2f5f3abed3a4a0efe82e5c591e70df1f053ee',
 'whisper-worker.mjs': '5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b'}
R25_CLOUD_FILE_COUNT = 28
R25_CLOUD_CHANGED_FILES = frozenset({'app-config.json',
 'app.js',
 'cloud-workflow.mjs',
 'cloud-workspace.mjs',
 'cloudbase-adapter.mjs',
 'static-manifest.json',
 'style.css',
 'vendor/cloudbase/LICENSE',
 'vendor/cloudbase/README.md',
 'vendor/cloudbase/cloudbase-sdk.mjs'})
R25_CLOUD_ADDED_FILES = frozenset({'cloud-workflow.mjs',
 'cloud-workspace.mjs',
 'cloudbase-adapter.mjs',
 'vendor/cloudbase/LICENSE',
 'vendor/cloudbase/README.md',
 'vendor/cloudbase/cloudbase-sdk.mjs'})
R25_CLOUD_MAX_RESOURCE_BYTES = 1_000_000
# Exact next snapshot: restore the saved cursor after native-session reload.
# Previous snapshots stay pinned; only app.js and its manifest may change.
R25_RECOVERY_VERSION = 'r25-cloud-sync-recovery-20261117'
R25_RECOVERY_ARCHIVE_B64_SHA = 'ebe2f473c29e9717bc1c7ba6a70777afc5ac41351cd16ef57480e58b7f521661'
R25_RECOVERY_ARCHIVE_SHA = 'c71b8416733caf0b1e079771bc07a04be26257c76063e35a6385ab9c97ded5d8'
R25_RECOVERY_ASSET_HASHES = {'app-config.json': '3df42c4f593e9c10776631bac75d5526e1e2a00bcd4e14e2e51627bf7b8c3dea',
 'app.js': '684a244a1f62e15d9dbfddc88e8f314eedb416fecfb4ca3419115e60c6d57e16',
 'asr-glossary.mjs': 'cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245',
 'asr-normalize.mjs': '3887eb1461728995541f9226fa1824559c22416a1f56624a8b1258dfff147168',
 'cloud-workflow.mjs': 'd894b9133e96726be58d748bd604808018f963d6bb42c60eb14487b3aadfb364',
 'cloud-workspace.mjs': '98f6c09907a97d43d6ee8f4e1f58db184cde71d175eead66e089a6473263dd15',
 'cloudbase-adapter.mjs': 'a5611a7d0d82ae574b587fe25863d07017823cfe82c78ce085e4833a3fad1524',
 'glossary-ui.mjs': 'a9bb72e929da66a8c6ee380c98b0c398e0da122bca9abde911f0c85267de874f',
 'index.html': '86860ac49ae85c7338fb2946907d2a013b13a6824a128b447b10810cb2938470',
 'legacy-65.json': 'd122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f',
 'lib/parser.js': '8603c685ac21f0486756af8599be4379b5f855118372d9224c8260e279c942f8',
 'lib/pdf.js': '3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b',
 'lib/qa-import.js': 'fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86',
 'lib/xls.js': '11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c',
 'lib/zip.js': '5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4',
 'r23-model-choice.js': 'b4c113a63795930fe20168645e5a0b9203433eac486391bf0e1f41fc4683f3ec',
 'static-manifest.json': '736e1aa94d40a7cc44ba141825d3fc2524ba34a4c15c184727316733d3d55ec1',
 'style.css': '31b61b22ed66caec4dd8ee993b55e5306c79f5f27c9ec47113ca47296cf99109',
 'training-boards.json': 'e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11',
 'vendor/cloudbase/LICENSE': '92d7d7d2d4771b84f44e38dc59052faae8e3cd0a234a62de6180a1c6746c979e',
 'vendor/cloudbase/README.md': '48665329cfa0baee544a8c57f38eb1518c9809430ebb0647aa904061db9ac767',
 'vendor/cloudbase/cloudbase-sdk.mjs': 'df0dc3e681ecc72e238ebd79b1099344457aca3f51beaa37b6fa704954cdb675',
 'vendor/opencc/LICENSE': '960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e',
 'vendor/opencc/LICENSES/Apache-2.0.txt': 'b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308',
 'vendor/opencc/THIRD_PARTY_LICENSES.md': '42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806',
 'vendor/opencc/t2cn.mjs': 'b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6',
 'whisper-bridge.mjs': '47c1c6f676d1189a2272cd0d72b2f5f3abed3a4a0efe82e5c591e70df1f053ee',
 'whisper-worker.mjs': '5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b'}
R25_RECOVERY_FILE_COUNT = 28
R25_RECOVERY_CHANGED_FILES = frozenset({'app.js', 'static-manifest.json'})
# A separately reviewed same-route name/invitation entry snapshot.
# Native account provisioning is backend-only and is never staged from this archive.
R25_NAME_INVITE_VERSION = 'r25-name-invite-20261117'
R25_NAME_INVITE_ARCHIVE_B64_SHA = 'dee92ada3d1a657461fd79cc72554318fbf1cb1b2acfe7b5571d729601e0766b'
R25_NAME_INVITE_ARCHIVE_SHA = 'a6f76379262cdcf562983d3e3a3321b678f3485eaa04d22a85c9025bdc223317'
R25_NAME_INVITE_ASSET_HASHES = {'app-config.json': 'c757eae6eb5360a713980eda78bc6c2b4d1310b855a702ec542b3aaeb969e3a1',
 'app.js': '7c83ce664b2290be4d0d5326ef63ff7e3ca41f23436d3665e8f63a9ccf49ff1e',
 'asr-glossary.mjs': 'cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245',
 'asr-normalize.mjs': '3887eb1461728995541f9226fa1824559c22416a1f56624a8b1258dfff147168',
 'cloud-workflow.mjs': 'a592b2f79a7e80f1317b036352bdf9033182da0e4d26d5b3b65d0e845a156277',
 'cloud-workspace.mjs': 'efbabf6f3e2cf6f3a0a10fb6204884176fc44c513d57920fa347e63948beaff1',
 'cloudbase-adapter.mjs': 'a5611a7d0d82ae574b587fe25863d07017823cfe82c78ce085e4833a3fad1524',
 'glossary-ui.mjs': 'a9bb72e929da66a8c6ee380c98b0c398e0da122bca9abde911f0c85267de874f',
 'index.html': '86860ac49ae85c7338fb2946907d2a013b13a6824a128b447b10810cb2938470',
 'legacy-65.json': 'd122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f',
 'lib/parser.js': '8603c685ac21f0486756af8599be4379b5f855118372d9224c8260e279c942f8',
 'lib/pdf.js': '3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b',
 'lib/qa-import.js': 'fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86',
 'lib/xls.js': '11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c',
 'lib/zip.js': '5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4',
 'name-identity.mjs': '702a15438acc838d06a431553812b54d27d1fb7c21fae29f32861903181e83fa',
 'r23-model-choice.js': 'b4c113a63795930fe20168645e5a0b9203433eac486391bf0e1f41fc4683f3ec',
 'static-manifest.json': 'b13f8b70327032cfd8a276ac0806ec8eb2d69ddadcde1a5a56710a18ea28ac4a',
 'style.css': 'da42bfe81a6a5edfba41f5e66d81ebe224759843c259a9ceb21aff634727690e',
 'training-boards.json': 'e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11',
 'vendor/cloudbase/LICENSE': '92d7d7d2d4771b84f44e38dc59052faae8e3cd0a234a62de6180a1c6746c979e',
 'vendor/cloudbase/README.md': '48665329cfa0baee544a8c57f38eb1518c9809430ebb0647aa904061db9ac767',
 'vendor/cloudbase/cloudbase-sdk.mjs': 'df0dc3e681ecc72e238ebd79b1099344457aca3f51beaa37b6fa704954cdb675',
 'vendor/opencc/LICENSE': '960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e',
 'vendor/opencc/LICENSES/Apache-2.0.txt': 'b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308',
 'vendor/opencc/THIRD_PARTY_LICENSES.md': '42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806',
 'vendor/opencc/t2cn.mjs': 'b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6',
 'whisper-bridge.mjs': '47c1c6f676d1189a2272cd0d72b2f5f3abed3a4a0efe82e5c591e70df1f053ee',
 'whisper-worker.mjs': '5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b'}
R25_NAME_INVITE_FILE_COUNT = 29
R25_NAME_INVITE_CHANGED_FILES = frozenset({'app-config.json',
 'app.js',
 'cloud-workflow.mjs',
 'cloud-workspace.mjs',
 'name-identity.mjs',
 'static-manifest.json',
 'style.css'})
R25_NAME_INVITE_ADDED_FILES = frozenset({'name-identity.mjs'})
# Exact adjacent direct-registration snapshot; backend code is never staged.
R25_DIRECT_VERSION = 'r25-direct-registration-20261117'
R25_DIRECT_ARCHIVE_B64_SHA = '6eb7280d0e4cec88f2b8739ebb958c820d5ec47c073292eb6fefb559e3b008da'
R25_DIRECT_ARCHIVE_SHA = '80139ccbe642de5a2966a5896b6ece528ad9c0f62223eae1284a561235d58675'
R25_DIRECT_ASSET_HASHES = {'app-config.json': 'fab251e739687ad50d658058ca1696f523b56297282ecac369a10c874758c7ca',
 'app.js': '7c83ce664b2290be4d0d5326ef63ff7e3ca41f23436d3665e8f63a9ccf49ff1e',
 'asr-glossary.mjs': 'cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245',
 'asr-normalize.mjs': '3887eb1461728995541f9226fa1824559c22416a1f56624a8b1258dfff147168',
 'cloud-workflow.mjs': '229d932915109d081e92f5f8ceb10b39a029c20644cf97c27e611b07cba63ced',
 'cloud-workspace.mjs': '3ba47efbf182de948f4a3b60c04367c0272f70006d8981b98be5092d765c9e02',
 'cloudbase-adapter.mjs': 'a5611a7d0d82ae574b587fe25863d07017823cfe82c78ce085e4833a3fad1524',
 'glossary-ui.mjs': 'a9bb72e929da66a8c6ee380c98b0c398e0da122bca9abde911f0c85267de874f',
 'index.html': '86860ac49ae85c7338fb2946907d2a013b13a6824a128b447b10810cb2938470',
 'legacy-65.json': 'd122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f',
 'lib/parser.js': '8603c685ac21f0486756af8599be4379b5f855118372d9224c8260e279c942f8',
 'lib/pdf.js': '3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b',
 'lib/qa-import.js': 'fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86',
 'lib/xls.js': '11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c',
 'lib/zip.js': '5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4',
 'name-identity.mjs': '0b446f3dcf4c3f085c3ece71f699461cee43a338f35a90a535fa80850c006b60',
 'r23-model-choice.js': 'b4c113a63795930fe20168645e5a0b9203433eac486391bf0e1f41fc4683f3ec',
 'static-manifest.json': 'ce6503bec38b0f35f4ba491239c9f9180fc0902f2927c13ba8a773ff8eaa1e05',
 'style.css': 'da42bfe81a6a5edfba41f5e66d81ebe224759843c259a9ceb21aff634727690e',
 'training-boards.json': 'e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11',
 'vendor/cloudbase/LICENSE': '92d7d7d2d4771b84f44e38dc59052faae8e3cd0a234a62de6180a1c6746c979e',
 'vendor/cloudbase/README.md': '48665329cfa0baee544a8c57f38eb1518c9809430ebb0647aa904061db9ac767',
 'vendor/cloudbase/cloudbase-sdk.mjs': 'df0dc3e681ecc72e238ebd79b1099344457aca3f51beaa37b6fa704954cdb675',
 'vendor/opencc/LICENSE': '960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e',
 'vendor/opencc/LICENSES/Apache-2.0.txt': 'b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308',
 'vendor/opencc/THIRD_PARTY_LICENSES.md': '42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806',
 'vendor/opencc/t2cn.mjs': 'b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6',
 'whisper-bridge.mjs': '47c1c6f676d1189a2272cd0d72b2f5f3abed3a4a0efe82e5c591e70df1f053ee',
 'whisper-worker.mjs': '5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b'}
R25_DIRECT_FILE_COUNT = 29
R25_DIRECT_CHANGED_FILES = frozenset({'app-config.json', 'cloud-workflow.mjs',
 'cloud-workspace.mjs', 'name-identity.mjs', 'static-manifest.json'})
# Reviewed registration recovery candidate. Same static resource set; only the
# identity client, workflow facade, registration UI and manifest change from DIRECT.
R25_REGISTRATION_RECOVERY_VERSION = 'r25-registration-recovery-20261117'
R25_REGISTRATION_RECOVERY_ARCHIVE_B64_SHA = 'b7de6c8cc7e5fd718156af495711c6b122438a623674bc6c67ded20c44e905fb'
R25_REGISTRATION_RECOVERY_ARCHIVE_SHA = '365363d043f6aa88f43746373b9a1842c00d56e0a6b378073fc5b46eba3cc034'
R25_REGISTRATION_RECOVERY_ASSET_HASHES = {'app-config.json': 'fab251e739687ad50d658058ca1696f523b56297282ecac369a10c874758c7ca',
 'app.js': '7c83ce664b2290be4d0d5326ef63ff7e3ca41f23436d3665e8f63a9ccf49ff1e',
 'asr-glossary.mjs': 'cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245',
 'asr-normalize.mjs': '3887eb1461728995541f9226fa1824559c22416a1f56624a8b1258dfff147168',
 'cloud-workflow.mjs': 'b75895b5b31aa71505587b29dfac3f9e9f53297a8638aaa86286823164ca6a60',
 'cloud-workspace.mjs': 'c3c2a2fdcc4ca7ae0541f003044d3cdc689c756e270334adce176b5cd73415b0',
 'cloudbase-adapter.mjs': 'a5611a7d0d82ae574b587fe25863d07017823cfe82c78ce085e4833a3fad1524',
 'glossary-ui.mjs': 'a9bb72e929da66a8c6ee380c98b0c398e0da122bca9abde911f0c85267de874f',
 'index.html': '86860ac49ae85c7338fb2946907d2a013b13a6824a128b447b10810cb2938470',
 'legacy-65.json': 'd122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f',
 'lib/parser.js': '8603c685ac21f0486756af8599be4379b5f855118372d9224c8260e279c942f8',
 'lib/pdf.js': '3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b',
 'lib/qa-import.js': 'fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86',
 'lib/xls.js': '11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c',
 'lib/zip.js': '5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4',
 'name-identity.mjs': '39ffa832a7db658e2c1e26b096f89e091b3732264f7927e09db398eeefa71b54',
 'r23-model-choice.js': 'b4c113a63795930fe20168645e5a0b9203433eac486391bf0e1f41fc4683f3ec',
 'static-manifest.json': 'eefb3eb3b096976f629c82151bb027528a51a4211e6dfa9fd429909bae29dbe1',
 'style.css': 'da42bfe81a6a5edfba41f5e66d81ebe224759843c259a9ceb21aff634727690e',
 'training-boards.json': 'e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11',
 'vendor/cloudbase/LICENSE': '92d7d7d2d4771b84f44e38dc59052faae8e3cd0a234a62de6180a1c6746c979e',
 'vendor/cloudbase/README.md': '48665329cfa0baee544a8c57f38eb1518c9809430ebb0647aa904061db9ac767',
 'vendor/cloudbase/cloudbase-sdk.mjs': 'df0dc3e681ecc72e238ebd79b1099344457aca3f51beaa37b6fa704954cdb675',
 'vendor/opencc/LICENSE': '960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e',
 'vendor/opencc/LICENSES/Apache-2.0.txt': 'b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308',
 'vendor/opencc/THIRD_PARTY_LICENSES.md': '42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806',
 'vendor/opencc/t2cn.mjs': 'b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6',
 'whisper-bridge.mjs': '47c1c6f676d1189a2272cd0d72b2f5f3abed3a4a0efe82e5c591e70df1f053ee',
 'whisper-worker.mjs': '5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b'}
R25_REGISTRATION_RECOVERY_FILE_COUNT = 29
R25_REGISTRATION_RECOVERY_CHANGED_FILES = frozenset({'cloud-workflow.mjs',
 'cloud-workspace.mjs', 'name-identity.mjs', 'static-manifest.json'})
# DIRECT was a candidate only: the deployed NAME_INVITE snapshot can update
# straight to this repaired release, retaining its exact five-file boundary.
R25_REGISTRATION_RECOVERY_FROM_NAME_CHANGED_FILES = R25_DIRECT_CHANGED_FILES
# Device-bound name entry is a new exact static snapshot; backend credentials
# and management-only recovery tools must never enter this archive.
R25_NAME_ENTRY_VERSION = 'r25-name-entry-20261118'
R25_NAME_ENTRY_ARCHIVE_B64_SHA = 'd7d18bd64f466356015f3a73c3e61a5961a04776f885995708601cb42455751a'
R25_NAME_ENTRY_ARCHIVE_SHA = '41353b2031c058686c359a119427657cc4fd28dbb787bdf04eca3730e548a769'
R25_NAME_ENTRY_ASSET_HASHES = {'app-config.json': '9ac5a5b99b23805f7a20fd94f301bb89a490bf58df0a3db4825d477191e6ab98',
 'app.js': '7c83ce664b2290be4d0d5326ef63ff7e3ca41f23436d3665e8f63a9ccf49ff1e',
 'asr-glossary.mjs': 'cb8d3010dbb1b6ed1a838950e3e041e39df400cafae3a0a2fd76d6b75d626245',
 'asr-normalize.mjs': '3887eb1461728995541f9226fa1824559c22416a1f56624a8b1258dfff147168',
 'cloud-workflow.mjs': '3505674c002a486b8e1f955326d26c846e562f3fbe161a63ca0d6877f81707e5',
 'cloud-workspace.mjs': '7233ce965c0b86cc48d78b7c1be7a96efbaeda9317164c961cd79f39c67378fd',
 'cloudbase-adapter.mjs': 'a5611a7d0d82ae574b587fe25863d07017823cfe82c78ce085e4833a3fad1524',
 'glossary-ui.mjs': 'a9bb72e929da66a8c6ee380c98b0c398e0da122bca9abde911f0c85267de874f',
 'index.html': '86860ac49ae85c7338fb2946907d2a013b13a6824a128b447b10810cb2938470',
 'legacy-65.json': 'd122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f',
 'lib/parser.js': '8603c685ac21f0486756af8599be4379b5f855118372d9224c8260e279c942f8',
 'lib/pdf.js': '3694f1c388d657e99fef2604d43ac21fe598df3d99bf6dfd66be8c95af51c98b',
 'lib/qa-import.js': 'fac35e52b9a5effd3642919cc0ce6f60dc744b166639ebe8564b67841ad1ff86',
 'lib/xls.js': '11941a8ab338482ca1e575edf9e2b1478c437b8349b3a9b9447b16b5db3adc9c',
 'lib/zip.js': '5e9d7907a3f7d2b3022ba7f757a2d98f8c5daa009c89035b9106b196aae64fc4',
 'name-identity.mjs': 'f11ab18c56edbc56f65e50e8a8fa12cb7e265be61ff0c75f8fc1a91b1698ba6a',
 'r23-model-choice.js': 'b4c113a63795930fe20168645e5a0b9203433eac486391bf0e1f41fc4683f3ec',
 'static-manifest.json': '373f23b9d78d708264f7dc5c3ee87c34946fee37a8d297cb41ec9c7189cdcb53',
 'style.css': 'da42bfe81a6a5edfba41f5e66d81ebe224759843c259a9ceb21aff634727690e',
 'training-boards.json': 'e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11',
 'vendor/cloudbase/LICENSE': '92d7d7d2d4771b84f44e38dc59052faae8e3cd0a234a62de6180a1c6746c979e',
 'vendor/cloudbase/README.md': '48665329cfa0baee544a8c57f38eb1518c9809430ebb0647aa904061db9ac767',
 'vendor/cloudbase/cloudbase-sdk.mjs': 'df0dc3e681ecc72e238ebd79b1099344457aca3f51beaa37b6fa704954cdb675',
 'vendor/opencc/LICENSE': '960f7fc16d8baa126802316a7df9078a383af4fb6bc60033adb28e85c08d5e5e',
 'vendor/opencc/LICENSES/Apache-2.0.txt': 'b534e465949558eec2597b04f5092b5e161236a68dfbfd04d547592ac3964308',
 'vendor/opencc/THIRD_PARTY_LICENSES.md': '42c7dbe71c178fcca97ba945e9ac9ff360fb69bbfea4cb50556f6c65bfa59806',
 'vendor/opencc/t2cn.mjs': 'b78e83f940e73a022d8d996333e924edf07aa5b6133b8cddd46fbbff1ac339b6',
 'whisper-bridge.mjs': '47c1c6f676d1189a2272cd0d72b2f5f3abed3a4a0efe82e5c591e70df1f053ee',
 'whisper-worker.mjs': '5adda0d63879d2e7f09627655799e764036e88c3e301e48bcdc1f41350c6c32b'}
R25_NAME_ENTRY_FILE_COUNT = 29
R25_NAME_ENTRY_CHANGED_FILES = frozenset({'app-config.json', 'cloud-workflow.mjs',
 'cloud-workspace.mjs', 'name-identity.mjs', 'static-manifest.json'})
R25_BASELINE_WORKFLOW_SHA = 'e69778fb93e39cd241f9f7fe8c4a8e714d330b5b8d2310605f5aff98130aaf14'
R25_BASELINE_FILES = 217
R25_BASELINE_TREE_SHA = '13df1a6bac7a368dac95b336f17c89c8fda8c8460a98e38c868bed84092a1cc6'
R25_MAX_ENCODED_BYTES = 2_000_000
R25_MAX_RAW_BYTES = 1_500_000
R25_MAX_RESOURCE_BYTES = 750_000
R25_MAX_TOTAL_BYTES = 3_000_000
R25_TRUSTED_INPUTS = R24_TRUSTED_INPUTS + (R24_ARCHIVE,)


def r25_stage_step():
    return (
        '      - name: Stage R2.5 isolated Vosk-first test delivery\n'
        '        run: |\n'
        f'          python3 release-ci/release_guard.py --stage-r25 _site {R25_ARCHIVE}\n'
    )


def r25_tree_hashes(site):
    if any(path.is_symlink() for path in site.rglob('*')):
        raise GateFailure('R2.5 staging cannot traverse existing symlinks')
    return {path.relative_to(site).as_posix(): sha256(path.read_bytes())
            for path in site.rglob('*') if path.is_file()}


def r25_check_baseline(site):
    hashes = r25_tree_hashes(site)
    digest = sha256(json.dumps(hashes, sort_keys=True, separators=(',', ':')).encode())
    if len(hashes) != R25_BASELINE_FILES or digest != R25_BASELINE_TREE_SHA:
        raise GateFailure('R2.5 exact protected Pages tree mismatch')
    return hashes


def r25_resource_bytes(encoded):
    snapshots = (
        (R25_ARCHIVE_B64_SHA, R25_ARCHIVE_SHA, R25_ASSET_HASHES,
         R25_VERSION, 22, R25_MAX_RESOURCE_BYTES),
        (R25_CLOUD_ARCHIVE_B64_SHA, R25_CLOUD_ARCHIVE_SHA, R25_CLOUD_ASSET_HASHES,
         R25_CLOUD_VERSION, R25_CLOUD_FILE_COUNT, R25_CLOUD_MAX_RESOURCE_BYTES),
        (R25_RECOVERY_ARCHIVE_B64_SHA, R25_RECOVERY_ARCHIVE_SHA, R25_RECOVERY_ASSET_HASHES,
         R25_RECOVERY_VERSION, R25_RECOVERY_FILE_COUNT, R25_CLOUD_MAX_RESOURCE_BYTES),
        (R25_NAME_INVITE_ARCHIVE_B64_SHA, R25_NAME_INVITE_ARCHIVE_SHA, R25_NAME_INVITE_ASSET_HASHES,
         R25_NAME_INVITE_VERSION, R25_NAME_INVITE_FILE_COUNT, R25_CLOUD_MAX_RESOURCE_BYTES),
        (R25_DIRECT_ARCHIVE_B64_SHA, R25_DIRECT_ARCHIVE_SHA, R25_DIRECT_ASSET_HASHES,
         R25_DIRECT_VERSION, R25_DIRECT_FILE_COUNT, R25_CLOUD_MAX_RESOURCE_BYTES),
        (R25_REGISTRATION_RECOVERY_ARCHIVE_B64_SHA, R25_REGISTRATION_RECOVERY_ARCHIVE_SHA,
         R25_REGISTRATION_RECOVERY_ASSET_HASHES, R25_REGISTRATION_RECOVERY_VERSION,
         R25_REGISTRATION_RECOVERY_FILE_COUNT, R25_CLOUD_MAX_RESOURCE_BYTES),
        (R25_NAME_ENTRY_ARCHIVE_B64_SHA, R25_NAME_ENTRY_ARCHIVE_SHA, R25_NAME_ENTRY_ASSET_HASHES,
         R25_NAME_ENTRY_VERSION, R25_NAME_ENTRY_FILE_COUNT, R25_CLOUD_MAX_RESOURCE_BYTES),
    )
    selected = [snapshot for snapshot in snapshots if snapshot[0] == sha256(encoded)]
    if len(encoded) > R25_MAX_ENCODED_BYTES or len(selected) != 1:
        raise GateFailure('R2.5 exact encoded archive hash/size mismatch')
    encoded_pin, zip_pin, asset_hashes, version, count, resource_limit = selected[0]
    if count < 22 or len(asset_hashes) != count or not all(re.fullmatch('[0-9a-f]{64}', digest)
            for digest in (encoded_pin, zip_pin, *asset_hashes.values())):
        raise GateFailure('R2.5 policy has not been frozen to reviewed content')
    try:
        raw = base64.b64decode(encoded.strip(), validate=True)
    except (ValueError, TypeError) as err:
        raise GateFailure('R2.5 invalid base64 archive') from err
    if len(raw) > R25_MAX_RAW_BYTES or sha256(raw) != zip_pin:
        raise GateFailure('R2.5 exact ZIP archive hash/size mismatch')
    _, resources = inspect_zip_bytes_for_autoqa(raw)
    allowed = {R25_DEST + '/' + name for name in asset_hashes}
    if set(resources) != allowed:
        raise GateFailure('R2.5 static resource allowlist mismatch')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        if len(entries) != len(allowed):
            raise GateFailure('R2.5 archive entry count mismatch')
        if any(stat.S_IFMT(info.external_attr >> 16) not in (0, stat.S_IFREG) for info in entries):
            raise GateFailure('R2.5 non-regular static resource')
        if any(not info.file_size or info.file_size > resource_limit for info in entries):
            raise GateFailure('R2.5 static resource size invalid')
    if sum(map(len, resources.values())) > R25_MAX_TOTAL_BYTES:
        raise GateFailure('R2.5 static resource total size exceeded')
    data = {name: resources[R25_DEST + '/' + name] for name in asset_hashes}
    for name, digest in asset_hashes.items():
        if sha256(data[name]) != digest:
            raise GateFailure('R2.5 resource hash mismatch: ' + name)
    manifest = json.loads(data['static-manifest.json'])
    expected = {name: sha256(value) for name, value in data.items() if name != 'static-manifest.json'}
    if manifest.get('version') != version or manifest.get('files') != expected:
        raise GateFailure('R2.5 manifest version/coverage/hash mismatch')
    return data


def stage_r25(site_path, archive_path):
    site = pathlib.Path(site_path).resolve()
    archive = pathlib.Path(archive_path)
    if not site.is_dir() or archive.stat().st_size > R25_MAX_ENCODED_BYTES:
        raise GateFailure('R2.5 staging site absent or archive oversized')
    output = site / R25_DEST
    if output.exists() or output.is_symlink():
        raise GateFailure('R2.5 target already exists; refuse overwrite')
    before = r25_check_baseline(site)
    resources = r25_resource_bytes(archive.read_bytes())
    with tempfile.TemporaryDirectory(prefix='.r25-stage-', dir=site.parent) as temp:
        staged = pathlib.Path(temp) / R25_DEST
        staged.mkdir()
        for name, data in resources.items():
            target = staged / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            if name.endswith(('.js', '.mjs')):
                try:
                    subprocess.run(['node', '--input-type=module', '--check'],
                                   input=data, check=True, capture_output=True, timeout=30)
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as err:
                    raise GateFailure('R2.5 JavaScript syntax check failed: ' + name) from err
        if r25_check_baseline(site) != before:
            raise GateFailure('R2.5 altered protected resource')
        staged.rename(output)
    after = r25_tree_hashes(site)
    if any(after.get(name) != digest for name, digest in before.items()):
        raise GateFailure('R2.5 altered protected resource during staging')
    if set(after) - set(before) != {R25_DEST + '/' + name for name in resources}:
        raise GateFailure('R2.5 final Pages resource set mismatch')
    report = {'files': len(resources), 'old_assets_unchanged': len(before),
              'total_assets': len(after), 'app_sha': sha256(resources['app.js'])}
    print('R25_STAGE_PASS', json.dumps(report, sort_keys=True))
    return report


def r25_rebuild_previous_stages(root, zipbytes, trusted_inputs):
    if set(trusted_inputs) != set(R25_TRUSTED_INPUTS):
        raise GateFailure('R2.5 trusted baseline input set mismatch')
    if sha256(zipbytes) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('R2.5 cannot change protected site.zip')
    encoded = trusted_inputs[R24_ARCHIVE]
    if sha256(encoded) != R24_REVIEW_ARCHIVE_B64_SHA:
        raise GateFailure('R2.5 requires the exact current R2.4 archive')
    site = r24_rebuild_previous_stages(root, zipbytes,
        {name: trusted_inputs[name] for name in R24_TRUSTED_INPUTS})
    archive = root / 'r24-protected.zip.b64'
    archive.write_bytes(encoded)
    stage_r24(site, archive)
    r25_check_baseline(site)
    return site


def verify_r25_additive_release(before, after, encoded, zipbytes, trusted_inputs):
    if sha256(before.encode()) != R25_BASELINE_WORKFLOW_SHA or before.count(LAB_ANCHOR) != 1:
        raise GateFailure('R2.5 requires exact protected Pages workflow')
    if after != before.replace(LAB_ANCHOR, r25_stage_step() + LAB_ANCHOR, 1):
        raise GateFailure('R2.5 changed unrelated Pages workflow content')
    r25_resource_bytes(encoded)
    with tempfile.TemporaryDirectory() as temp:
        root = pathlib.Path(temp)
        site = r25_rebuild_previous_stages(root, zipbytes, trusted_inputs)
        archive = root / 'r25-source.zip.b64'
        archive.write_bytes(encoded)
        result = stage_r25(site, archive)
    print('R25_RELEASE_PASS', json.dumps(result, sort_keys=True))
    return result


def verify_r25_rollback(before, after, removed_archive, zipbytes, trusted_inputs):
    if sha256(after.encode()) != R25_BASELINE_WORKFLOW_SHA:
        raise GateFailure('R2.5 rollback must restore exact protected workflow')
    if before != after.replace(LAB_ANCHOR, r25_stage_step() + LAB_ANCHOR, 1):
        raise GateFailure('R2.5 rollback must remove only exact R2.5 stage')
    resources = r25_resource_bytes(removed_archive)
    with tempfile.TemporaryDirectory() as temp:
        root = pathlib.Path(temp)
        site = r25_rebuild_previous_stages(root, zipbytes, trusted_inputs)
        original = r25_check_baseline(site)
        archive = root / 'r25-removed.zip.b64'
        archive.write_bytes(removed_archive)
        stage_r25(site, archive)
        shutil.rmtree(site / R25_DEST)
        if r25_check_baseline(site) != original:
            raise GateFailure('R2.5 rollback changed older resources')
    result = {'removed_files': len(resources), 'protected_assets': len(original)}
    print('R25_ROLLBACK_PASS', json.dumps(result, sort_keys=True))
    return result


def verify_r25_archive_update(workflow, old_encoded, new_encoded, zipbytes, trusted_inputs):
    """Accept only explicit adjacent frozen R25 pairs and their exact reversals."""
    pair = (sha256(old_encoded), sha256(new_encoded))
    transitions = (
        ((R25_ARCHIVE_B64_SHA, R25_CLOUD_ARCHIVE_B64_SHA),
         R25_CLOUD_CHANGED_FILES, R25_CLOUD_ADDED_FILES),
        ((R25_CLOUD_ARCHIVE_B64_SHA, R25_RECOVERY_ARCHIVE_B64_SHA),
         R25_RECOVERY_CHANGED_FILES, frozenset()),
        ((R25_RECOVERY_ARCHIVE_B64_SHA, R25_NAME_INVITE_ARCHIVE_B64_SHA),
         R25_NAME_INVITE_CHANGED_FILES, R25_NAME_INVITE_ADDED_FILES),
        ((R25_NAME_INVITE_ARCHIVE_B64_SHA, R25_DIRECT_ARCHIVE_B64_SHA),
         R25_DIRECT_CHANGED_FILES, frozenset()),
        ((R25_NAME_INVITE_ARCHIVE_B64_SHA, R25_REGISTRATION_RECOVERY_ARCHIVE_B64_SHA),
         R25_REGISTRATION_RECOVERY_FROM_NAME_CHANGED_FILES, frozenset()),
        ((R25_DIRECT_ARCHIVE_B64_SHA, R25_REGISTRATION_RECOVERY_ARCHIVE_B64_SHA),
         R25_REGISTRATION_RECOVERY_CHANGED_FILES, frozenset()),
        ((R25_REGISTRATION_RECOVERY_ARCHIVE_B64_SHA, R25_NAME_ENTRY_ARCHIVE_B64_SHA),
         R25_NAME_ENTRY_CHANGED_FILES, frozenset()),
    )
    matches = [(forward, changed, added) for forward, changed, added in transitions
               if pair[0] != pair[1] and pair in (forward, forward[::-1])]
    if len(matches) != 1:
        raise GateFailure('R2.5 update requires the exact old/new snapshot pair')
    forward, expected_changed, added_forward = matches[0]
    if sha256(zipbytes) != LAB_BASELINE_ZIP_SHA256:
        raise GateFailure('R2.5 update cannot change protected site.zip')
    step = r25_stage_step()
    if (workflow.count(step) != 1 or
            sha256(workflow.replace(step, '', 1).encode()) != R25_BASELINE_WORKFLOW_SHA):
        raise GateFailure('R2.5 update must retain the exact existing Pages workflow')
    old_data, new_data = r25_resource_bytes(old_encoded), r25_resource_bytes(new_encoded)
    added, removed = ((added_forward, frozenset()) if pair == forward
                      else (frozenset(), added_forward))
    if set(new_data) - set(old_data) != added or set(old_data) - set(new_data) != removed:
        raise GateFailure('R2.5 update changed the exact reviewed resource set')
    changed = {name for name in set(old_data) | set(new_data)
               if old_data.get(name) != new_data.get(name)}
    if changed != expected_changed:
        raise GateFailure('R2.5 update changed resources outside the exact reviewed scope')
    with tempfile.TemporaryDirectory() as temp:
        root = pathlib.Path(temp)
        old_site = r25_rebuild_previous_stages(root, zipbytes, trusted_inputs)
        r25_check_baseline(old_site)
        protected = {path.relative_to(old_site).as_posix(): path.read_bytes()
                     for path in old_site.rglob('*') if path.is_file()}
        new_site = root / '_updated_site'
        shutil.copytree(old_site, new_site)
        for label, encoded, site in (('old', old_encoded, old_site), ('new', new_encoded, new_site)):
            archive = root / (label + '-r25.zip.b64')
            archive.write_bytes(encoded)
            stage_r25(site, archive)
            if any(not (site / name).is_file() or (site / name).is_symlink()
                   or (site / name).read_bytes() != data for name, data in protected.items()):
                raise GateFailure('R2.5 update modified an older Pages resource')
        old_files, new_files = r25_tree_hashes(old_site), r25_tree_hashes(new_site)
        actual_changed = {name for name in set(old_files) | set(new_files)
                          if old_files.get(name) != new_files.get(name)}
        if (set(new_files) - set(old_files) != {R25_DEST + '/' + name for name in added}
                or set(old_files) - set(new_files) != {R25_DEST + '/' + name for name in removed}
                or actual_changed != {R25_DEST + '/' + name for name in changed}):
            raise GateFailure('R2.5 final Pages trees differ outside the exact update scope')
    result = {'direction': 'update' if pair == forward else 'rollback',
              'protected_assets': len(protected), 'total_assets': len(new_files),
              'changed': sorted(actual_changed)}
    print('R25_UPDATE_PASS', json.dumps(result, sort_keys=True))
    return result


# Formal Paraformer deployment is additive to the audited historical routes.
# The small, reviewed frontend ZIP and upstream model pack have separate pins.
R24_PF_ARCHIVE = 'experiments/r24-paraformer-release/site-only.zip'
R24_PF_DEST = 'tcl-r24-paraformer'
R24_PF_VERSION = 'r24-paraformer-small-20261118-pages1'
R24_PF_SITE_SHA = '7d8bcb0c67baba530982c40b22e09cef1f71bf0ed8e9b147d59d7e0f646f2f20'
R24_PF_PAGES2_VERSION = 'r24-paraformer-small-20261118-pages2'
R24_PF_PAGES2_SITE_SHA = '8c87b25af1b680e603e1ee72c914ed69de2b5baba385e82ff41e5e2be11aabbd'
R24_PF_PAGES3_VERSION = 'r24-paraformer-small-20261118-pages3'
R24_PF_PAGES3_SITE_SHA = 'dec534aac5467b07fba730e422f14200d26e3293fd1f964bf1c4ff88d8f33fa5'
R24_PF_BASE_WORKFLOW_SHA = '9b43396eedbe3a833e18c5c635085e265741c33b97e3ef4d534c68a1082f4415'
R24_PF_MODEL_PREFIX = 'sherpa-onnx-wasm-simd-1.12.20-vad-asr-zh_en-paraformer_small/'
R24_PF_MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/' + R24_PF_MODEL_PREFIX.rstrip('/') + '.tar.bz2'
R24_PF_MODEL_ARCHIVE_BYTES = 80_161_695
R24_PF_MODEL_ARCHIVE_SHA = 'be25b1ef4dcb7a037cf6954ad878737ce7842fa0b512c991ebd39b95d2e6d548'
R24_PF_MODEL_MANIFEST_SHA = '9a9538a91e1ba4230577d1a4410fe4ac429039ced6478af15346e378cedc6df2'
R24_PF_MODEL_FILES = {
    'sherpa-onnx-asr.js': (41_274, 'ab619fbad082d474ef35616072d3ace7e8f533d3725c611c1c60d7b97cac41c9'),
    'sherpa-onnx-wasm-main-vad-asr.js': (95_311, '3e0cbcad90833164f04097e51fbc99b8812dc03977382578fb73eba7f5d13ec4'),
    'sherpa-onnx-wasm-main-vad-asr.wasm': (11_539_169, '2fc8dc389b23ad07f0d526b2e7c7c828543956d053db858d73cff192be7589e3'),
    'sherpa-onnx-wasm-main-vad-asr.data': (82_547_881, '9b89b7afaf5375704e758e85e88955abab381f81c466b24ecc7320b24d81b80f'),
}
R24_PF_FRONTEND_FILES = frozenset({
    'app-config.json', 'app.js', 'asr-glossary.mjs', 'asr-normalize.mjs', 'glossary-ui.mjs',
    'index.html', 'legacy-65.json', 'lib/parser.js', 'lib/pdf.js', 'lib/qa-import.js',
    'lib/xls.js', 'lib/zip.js', 'paraformer-bridge.mjs', 'paraformer-worker.js',
    'r23-model-choice.js', 'static-manifest.json', 'style.css', 'training-boards.json',
    'vendor/opencc/LICENSE', 'vendor/opencc/LICENSES/Apache-2.0.txt',
    'vendor/opencc/THIRD_PARTY_LICENSES.md', 'vendor/opencc/t2cn.mjs',
    'vendor/paraformer/LICENSE-Silero-VAD.txt', 'vendor/paraformer/LICENSE-onnxruntime.txt',
    'vendor/paraformer/LICENSE-sherpa-onnx.txt', 'vendor/paraformer/NOTICE.md',
    'vendor/paraformer/THIRD_PARTY_NOTICES-onnxruntime.txt', 'vendor/paraformer/license-sources.json',
    'vendor/paraformer/manifest.json', 'whisper-bridge.mjs', 'whisper-worker.mjs',
})

# Temporary device-check candidate. Same frontend allowlist and model pins as the
# official route, but its own route, ZIP pin, version and browser storage names.
# It is additive: the official route and every older route stay byte-identical.
R24_PF_RC_ARCHIVE = 'experiments/r24-paraformer-rc-release/site-only.zip'
R24_PF_RC_DEST = 'tcl-r24-paraformer-rc'
R24_PF_RC_VERSION = 'r24-paraformer-small-20261118-devicecheck-rc1'
R24_PF_RC_SITE_SHA = '69a49036041c5b0286aef87bb799ade1f3ceb454cc2076b20891cf77ccdf1f17'
R24_PF_RC_BASE_WORKFLOW_SHA = 'b14e77bf74f7c691a4b61e713eb0a45b71a0b6eb11effaa66f4227ee137f5d2c'

# Excel assignments are an isolated manual-exchange preview, never an update to
# the official Paraformer, historical R24, R25 or root routes.
R24_PF_EXCEL_ARCHIVE = 'experiments/r24-paraformer-excel-release/site-only.zip'
R24_PF_EXCEL_DEST = 'tcl-r24-paraformer-excel-qa'
R24_PF_EXCEL_VERSION = 'r24-paraformer-excel-assignment-20261123-qa1'
R24_PF_EXCEL_SITE_SHA = '29c2ac4c491b54c467aa31fcdfa68c0b882dbaf227b5869d977c81b11737396c'
# Second exact QA-only snapshot; reject unpinned versions and unrelated resource edits.
R24_PF_EXCEL_NEXT_SITE_SHA = 'a99012ad503baedd404a1c8ed6e4ffb304a07372e6641ec9367a42343035a9d6'
R24_PF_EXCEL_NEXT_VERSION = 'r24-paraformer-excel-assignment-20261123-qa2-operator-search'
R24_PF_EXCEL_NEXT_APP_SHA = '8af5310dbe54250c6a19dbe25f00cfc0d103a4b29fe0242bf2995522cd3f82f9'
R24_PF_EXCEL_NEXT_MODULE_SHA = 'e7bb2a73a2e63b35e687d7a0e4c3d4e996f0dd5330e312d055cbe79e373763af'
R24_PF_EXCEL_NEXT_CHANGED_FILES = frozenset({'app.js', 'assignment-excel.mjs', 'static-manifest.json'})
# Third exact QA-only snapshot after independent review of QA2 (PR169 source
# 882813e05d237dd18338d9818af0faf956522c19). Reachable only from/to QA2.
R24_PF_EXCEL_QA3_SITE_SHA = '7547f2bc5f1ae1dd76594ac77234227e5cf1dea0fbf1ed1ed207152b9513ad35'
R24_PF_EXCEL_QA3_VERSION = 'r24-paraformer-excel-assignment-20261123-qa3-review-fixes'
R24_PF_EXCEL_QA3_APP_SHA = 'd6b9f4891e409f330e928659e2bcde59a398bf3ccef1d088be4af3562a5f478a'
R24_PF_EXCEL_QA3_MODULE_SHA = 'd589ac9ef06b30047ad34c6d3729986e3758e120ea4c957da2d275e63c5e78a4'
R24_PF_EXCEL_BASE_WORKFLOW_SHA = '9903576514b72b45a5cee346c1f760fa9c4e6563fa474750e29eaea78db84955'
R24_PF_EXCEL_UI_PINS = {
    'index.html': '39a04e9845975e7eb874401f6864f4facb12d498168d50570cc5e444e428d59e',
    'style.css': '35a869c93470924b66ea01ffe65ef7a578b34e8f61ab4bf1b89d98485b8ec5f2',
    'training-boards.json': 'e42953870a0253eddd303361105b18ddc813e7640f73407627fbacec8df06d11',
    'legacy-65.json': 'd122314e4c4f457d2cdc45235321066ae3f53c10b7eeb2a3626fa5bdcf4dca8f',
}


def r24_pf_excel_stage_step():
    # Reuse the same upstream bytes already fetched for the protected official
    # route. stage_r24_pf rechecks the archive and every extracted model file.
    return (
        '      - name: Stage isolated R2.4 Excel assignment preview\n'
        '        run: |\n'
        '          MODEL="$RUNNER_TEMP/r24-paraformer-model.tar.bz2"\n'
        f'          python3 release-ci/release_guard.py --stage-r24-paraformer-excel _site {R24_PF_EXCEL_ARCHIVE} "$MODEL"\n'
    )


def verify_r24_pf_excel_release_workflow(before, after):
    if sha256(before.encode()) != R24_PF_EXCEL_BASE_WORKFLOW_SHA or before.count(LAB_ANCHOR) != 1:
        raise GateFailure('Excel preview requires the exact protected Pages workflow')
    if after != before.replace(LAB_ANCHOR, r24_pf_excel_stage_step() + LAB_ANCHOR, 1):
        raise GateFailure('Excel preview must add only its isolated stage before Pages configuration')


def verify_r24_pf_excel_rollback_workflow(before, after):
    verify_r24_pf_excel_release_workflow(after, before)


def r24_pf_excel_snapshots():
    # archive SHA -> (manifest version, pinned app.js SHA, pinned rules SHA)
    return {
        R24_PF_EXCEL_SITE_SHA: (R24_PF_EXCEL_VERSION, None, None),
        R24_PF_EXCEL_NEXT_SITE_SHA: (R24_PF_EXCEL_NEXT_VERSION, R24_PF_EXCEL_NEXT_APP_SHA, R24_PF_EXCEL_NEXT_MODULE_SHA),
        R24_PF_EXCEL_QA3_SITE_SHA: (R24_PF_EXCEL_QA3_VERSION, R24_PF_EXCEL_QA3_APP_SHA, R24_PF_EXCEL_QA3_MODULE_SHA),
    }


def r24_pf_excel_frontend(raw):
    archive_sha = sha256(raw)
    snapshots = r24_pf_excel_snapshots()
    if len(raw) > 1_500_000 or archive_sha not in snapshots:
        raise GateFailure('Excel preview frontend ZIP hash or size mismatch')
    _, resources = inspect_zip_bytes_for_autoqa(raw)
    if set(resources) != R24_PF_FRONTEND_FILES | {'assignment-excel.mjs'}:
        raise GateFailure('Excel preview frontend resource allowlist mismatch')
    for name, pin in R24_PF_EXCEL_UI_PINS.items():
        if sha256(resources[name]) != pin:
            raise GateFailure('Excel preview changed a preserved UI or public question resource: ' + name)
    if sha256(resources['vendor/paraformer/manifest.json']) != R24_PF_MODEL_MANIFEST_SHA:
        raise GateFailure('Excel preview model manifest identity mismatch')
    expected = {name: sha256(data) for name, data in resources.items() if name != 'static-manifest.json'}
    expected.update({f'vendor/paraformer/{name}': pin for name, (_, pin) in R24_PF_MODEL_FILES.items()})
    version, app_pin, module_pin = snapshots[archive_sha]
    if json.loads(resources['static-manifest.json']) != {'version': version, 'files': expected}:
        raise GateFailure('Excel preview static manifest version, coverage or hash mismatch')
    if app_pin is not None:
        if sha256(resources['app.js']) != app_pin or sha256(resources['assignment-excel.mjs']) != module_pin:
            raise GateFailure('Excel QA app or assignment rules differ from pinned tested sources')
    return resources


def verify_r24_pf_excel_archive_update(before, after):
    """Allow only adjacent QA1<->QA2 and QA2<->QA3, with the exact 3 reviewed resources changing."""
    before_sha, after_sha = sha256(before), sha256(after)
    if (before_sha, after_sha) not in (
        (R24_PF_EXCEL_SITE_SHA, R24_PF_EXCEL_NEXT_SITE_SHA),
        (R24_PF_EXCEL_NEXT_SITE_SHA, R24_PF_EXCEL_SITE_SHA),
        (R24_PF_EXCEL_NEXT_SITE_SHA, R24_PF_EXCEL_QA3_SITE_SHA),
        (R24_PF_EXCEL_QA3_SITE_SHA, R24_PF_EXCEL_NEXT_SITE_SHA),
    ):
        raise GateFailure('Excel QA update must be an exact pinned adjacent transition (QA1/QA2/QA3) or rollback')
    old, new = r24_pf_excel_frontend(before), r24_pf_excel_frontend(after)
    changes = {name for name in old if old[name] != new[name]}
    if set(old) != set(new) or changes != R24_PF_EXCEL_NEXT_CHANGED_FILES:
        raise GateFailure('Excel QA update may change only app.js, assignment-excel.mjs and their manifest')
    return changes


def r24_pf_stage_step():
    return (
        '      - name: Stage complete R2.4 Paraformer release\n'
        '        run: |\n'
        '          MODEL="$RUNNER_TEMP/r24-paraformer-model.tar.bz2"\n'
        '          curl --fail --location --silent --show-error --retry 3 --max-time 120 '
        '--max-filesize 80161695 --proto "=https" --proto-redir "=https" '
        f'--output "$MODEL" "{R24_PF_MODEL_URL}"\n'
        f'          python3 release-ci/release_guard.py --stage-r24-paraformer _site {R24_PF_ARCHIVE} "$MODEL"\n'
    )


def r24_pf_rc_stage_step():
    return (
        '      - name: Stage R2.4 Paraformer device-check candidate\n'
        '        run: |\n'
        '          MODEL="$RUNNER_TEMP/r24-paraformer-rc-model.tar.bz2"\n'
        '          curl --fail --location --silent --show-error --retry 3 --max-time 120 '
        '--max-filesize 80161695 --proto "=https" --proto-redir "=https" '
        f'--output "$MODEL" "{R24_PF_MODEL_URL}"\n'
        f'          python3 release-ci/release_guard.py --stage-r24-paraformer-rc _site {R24_PF_RC_ARCHIVE} "$MODEL"\n'
    )


def verify_r24_pf_rc_release_workflow(before, after):
    if sha256(before.encode()) != R24_PF_RC_BASE_WORKFLOW_SHA or before.count(LAB_ANCHOR) != 1:
        raise GateFailure('Paraformer RC requires the exact protected Pages workflow')
    if after != before.replace(LAB_ANCHOR, r24_pf_rc_stage_step() + LAB_ANCHOR, 1):
        raise GateFailure('Paraformer RC release must add only its stage before Pages configuration')


def verify_r24_pf_rc_rollback_workflow(before, after):
    verify_r24_pf_rc_release_workflow(after, before)


def verify_r24_pf_release_workflow(before, after):
    if sha256(before.encode()) != R24_PF_BASE_WORKFLOW_SHA or before.count(LAB_ANCHOR) != 1:
        raise GateFailure('Paraformer requires the exact protected Pages workflow')
    if after != before.replace(LAB_ANCHOR, r24_pf_stage_step() + LAB_ANCHOR, 1):
        raise GateFailure('Paraformer release must add only its stage before Pages configuration')


def verify_r24_pf_rollback_workflow(before, after):
    verify_r24_pf_release_workflow(after, before)


def r24_pf_frontend(raw, site_sha=None, version=None):
    if len(raw) > 1_500_000:
        raise GateFailure('Paraformer frontend ZIP hash or size mismatch')
    observed_sha = sha256(raw)
    later_versions = {
        R24_PF_PAGES2_SITE_SHA: R24_PF_PAGES2_VERSION,
        R24_PF_PAGES3_SITE_SHA: R24_PF_PAGES3_VERSION,
    }
    if site_sha is None and version is None and observed_sha in later_versions:
        site_sha, version = observed_sha, later_versions[observed_sha]
    site_sha = R24_PF_SITE_SHA if site_sha is None else site_sha
    version = R24_PF_VERSION if version is None else version
    if observed_sha != site_sha:
        raise GateFailure('Paraformer frontend ZIP hash or size mismatch')
    _, resources = inspect_zip_bytes_for_autoqa(raw)
    if set(resources) != R24_PF_FRONTEND_FILES:
        raise GateFailure('Paraformer frontend resource allowlist mismatch')
    if sha256(resources['vendor/paraformer/manifest.json']) != R24_PF_MODEL_MANIFEST_SHA:
        raise GateFailure('Paraformer model manifest identity mismatch')
    expected = {name: sha256(data) for name, data in resources.items() if name != 'static-manifest.json'}
    expected.update({f'vendor/paraformer/{name}': pin for name, (_, pin) in R24_PF_MODEL_FILES.items()})
    manifest = json.loads(resources['static-manifest.json'])
    if manifest != {'version': version, 'files': expected}:
        raise GateFailure('Paraformer static manifest version, coverage or hash mismatch')
    return resources


def r24_pf_rc_frontend(raw):
    return r24_pf_frontend(raw, R24_PF_RC_SITE_SHA, R24_PF_RC_VERSION)


def verify_r24_pf_archive_update(before, after):
    pair = (sha256(before), sha256(after))
    adjacent = ((R24_PF_SITE_SHA, R24_PF_PAGES2_SITE_SHA),
                (R24_PF_PAGES2_SITE_SHA, R24_PF_PAGES3_SITE_SHA))
    if pair[0] == pair[1] or not any(pair in (release, release[::-1]) for release in adjacent):
        raise GateFailure('Paraformer formal update requires the pinned forward or rollback archives')
    old_files = r24_pf_frontend(before)
    new_files = r24_pf_frontend(after)
    changed = {name for name in old_files if old_files[name] != new_files[name]}
    if changed != {'app.js', 'static-manifest.json'}:
        raise GateFailure('Paraformer formal update may change only app.js and its manifest')


def r24_pf_extract_model(model_archive, vendor):
    if model_archive.stat().st_size != R24_PF_MODEL_ARCHIVE_BYTES:
        raise GateFailure('Paraformer upstream archive size mismatch')
    with model_archive.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != R24_PF_MODEL_ARCHIVE_SHA:
            raise GateFailure('Paraformer upstream archive hash mismatch')
    written = set()
    with tarfile.open(model_archive, 'r|bz2') as archive:
        for entry in archive:
            path = entry.name.removeprefix('./')
            if not path.startswith(R24_PF_MODEL_PREFIX):
                if entry.isdir() and path == R24_PF_MODEL_PREFIX.rstrip('/'):
                    continue
                raise GateFailure('Paraformer upstream archive root mismatch')
            name = path[len(R24_PF_MODEL_PREFIX):]
            if name not in R24_PF_MODEL_FILES:
                continue
            size, pin = R24_PF_MODEL_FILES[name]
            if not entry.isfile() or entry.size != size or name in written:
                raise GateFailure('Paraformer invalid upstream member: ' + name)
            with archive.extractfile(entry) as source, (vendor / name).open('xb') as target:
                shutil.copyfileobj(source, target, 1024 * 1024)
            with (vendor / name).open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != pin:
                    raise GateFailure('Paraformer upstream member hash mismatch: ' + name)
            written.add(name)
    if written != R24_PF_MODEL_FILES.keys():
        raise GateFailure('Paraformer upstream archive is missing model resources')


def stage_r24_pf(site_path, app_zip, model_archive, dest=None, frontend=None):
    dest = R24_PF_DEST if dest is None else dest
    frontend = r24_pf_frontend if frontend is None else frontend
    site, app_zip, model_archive = map(pathlib.Path, (site_path, app_zip, model_archive))
    output = site / dest
    if not site.is_dir() or site.is_symlink() or output.exists() or output.is_symlink():
        raise GateFailure('Paraformer staging requires a site and a new route')
    if app_zip.stat().st_size > 1_500_000:
        raise GateFailure('Paraformer frontend ZIP exceeds size limit')
    resources = frontend(app_zip.read_bytes())
    before = r25_tree_hashes(site)
    with tempfile.TemporaryDirectory(prefix='.r24-paraformer-', dir=site.parent) as folder:
        staged = pathlib.Path(folder) / dest
        for name, data in resources.items():
            path = staged / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        r24_pf_extract_model(model_archive, staged / 'vendor/paraformer')
        if r25_tree_hashes(site) != before:
            raise GateFailure('Paraformer staging changed a protected Pages resource')
        staged.rename(output)
    after = r25_tree_hashes(site)
    added = set(resources) | {f'vendor/paraformer/{name}' for name in R24_PF_MODEL_FILES}
    if ({name: digest for name, digest in after.items() if not name.startswith(dest + '/')} != before
            or set(after) - set(before) != {f'{dest}/{name}' for name in added}):
        raise GateFailure('Paraformer final Pages tree does not preserve the protected routes')
    result = {'files': len(added), 'old_assets_unchanged': len(before), 'total_assets': len(after)}
    print('R24_PARAFORMER_STAGE_PASS', json.dumps(result, sort_keys=True))
    return result


def stage_r24_pf_rc(site_path, app_zip, model_archive):
    return stage_r24_pf(site_path, app_zip, model_archive, dest=R24_PF_RC_DEST, frontend=r24_pf_rc_frontend)


def stage_r24_pf_excel(site_path, app_zip, model_archive):
    return stage_r24_pf(site_path, app_zip, model_archive, dest=R24_PF_EXCEL_DEST, frontend=r24_pf_excel_frontend)


def verify_pr(base, head):
    """Classify every PR; release PRs execute only this baseline verifier."""
    for ref in (base, head):
        if not re.fullmatch('[0-9a-f]{40}', ref):
            raise GateFailure('Expected pinned Git commit SHA')
    def show(ref, path):
        return subprocess.check_output(['git', 'show', f'{ref}:{path}'])
    changed = set(subprocess.check_output(['git', 'diff', '--name-only', base, head], text=True).splitlines())
    release = {'site.zip', '.github/workflows/pages.yml'}
    ci = {'.github/workflows/verify-pages-pr.yml', '.github/workflows/r21-real-model-smoke.yml', 'release-ci/release_guard.py', 'release-ci/test_release_guard.py', 'release-ci/stage_r21.py', 'release-ci/stage_r23.py', 'release-ci/r23_browser_e2e.py', 'release-ci/r21_real_model_probe.py'}
    docs = {name for name in changed if name.endswith('.md') and not name.startswith(('.github/', 'release-ci/'))}
    if changed == {R24_PF_EXCEL_ARCHIVE, '.github/workflows/pages.yml'}:
        flags = [subprocess.check_output(
            ['git', 'ls-tree', '--name-only', ref, '--', R24_PF_EXCEL_ARCHIVE], text=True).strip()
            for ref in (base, head)]
        before, after = [show(ref, '.github/workflows/pages.yml').decode('utf-8') for ref in (base, head)]
        if flags == ['', R24_PF_EXCEL_ARCHIVE]:
            verify_r24_pf_excel_release_workflow(before, after)
            r24_pf_excel_frontend(show(head, R24_PF_EXCEL_ARCHIVE))
        elif flags == [R24_PF_EXCEL_ARCHIVE, '']:
            verify_r24_pf_excel_rollback_workflow(before, after)
            r24_pf_excel_frontend(show(base, R24_PF_EXCEL_ARCHIVE))
        else:
            raise GateFailure('Excel preview accepts only an exact additive release or full isolated route rollback')
        print('verify-pages-release PASS: exact isolated Excel assignment preview release/rollback')
    elif changed == {R24_PF_EXCEL_ARCHIVE}:
        verify_r24_pf_excel_archive_update(show(base, R24_PF_EXCEL_ARCHIVE), show(head, R24_PF_EXCEL_ARCHIVE))
        print('verify-pages-release PASS: pinned Excel QA1/QA2/QA3 adjacent archive-only upgrade or rollback')
    elif changed == {R24_PF_ARCHIVE}:
        verify_r24_pf_archive_update(show(base, R24_PF_ARCHIVE), show(head, R24_PF_ARCHIVE))
        print('verify-pages-release PASS: exact Paraformer formal same-route update/rollback')
    elif changed == {R24_PF_RC_ARCHIVE, '.github/workflows/pages.yml'}:
        flags = [subprocess.check_output(
            ['git', 'ls-tree', '--name-only', ref, '--', R24_PF_RC_ARCHIVE], text=True).strip()
            for ref in (base, head)]
        before, after = [show(ref, '.github/workflows/pages.yml').decode('utf-8') for ref in (base, head)]
        if flags == ['', R24_PF_RC_ARCHIVE]:
            verify_r24_pf_rc_release_workflow(before, after)
            r24_pf_rc_frontend(show(head, R24_PF_RC_ARCHIVE))
        elif flags == [R24_PF_RC_ARCHIVE, '']:
            verify_r24_pf_rc_rollback_workflow(before, after)
            r24_pf_rc_frontend(show(base, R24_PF_RC_ARCHIVE))
        else:
            raise GateFailure('Paraformer RC accepts only an exact additive release or full route rollback')
        print('verify-pages-release PASS: exact isolated Paraformer RC release/rollback')
    elif changed == {R24_PF_ARCHIVE, '.github/workflows/pages.yml'}:
        flags = [subprocess.check_output(
            ['git', 'ls-tree', '--name-only', ref, '--', R24_PF_ARCHIVE], text=True).strip()
            for ref in (base, head)]
        before, after = [show(ref, '.github/workflows/pages.yml').decode('utf-8') for ref in (base, head)]
        if flags == ['', R24_PF_ARCHIVE]:
            verify_r24_pf_release_workflow(before, after)
            r24_pf_frontend(show(head, R24_PF_ARCHIVE))
        elif flags == [R24_PF_ARCHIVE, '']:
            verify_r24_pf_rollback_workflow(before, after)
            r24_pf_frontend(show(base, R24_PF_ARCHIVE))
        else:
            raise GateFailure('Paraformer accepts only an exact additive release or full route rollback')
        print('verify-pages-release PASS: exact isolated Paraformer release/rollback')
    elif changed == {R25_ARCHIVE, '.github/workflows/pages.yml'}:
        archive_at_base = subprocess.check_output(
            ['git', 'ls-tree', '--name-only', base, '--', R25_ARCHIVE], text=True).strip()
        archive_at_head = subprocess.check_output(
            ['git', 'ls-tree', '--name-only', head, '--', R25_ARCHIVE], text=True).strip()
        trusted = {path: show(base, path) for path in R25_TRUSTED_INPUTS}
        if not archive_at_base and archive_at_head == R25_ARCHIVE:
            verify_r25_additive_release(
                show(base, '.github/workflows/pages.yml').decode('utf-8'),
                show(head, '.github/workflows/pages.yml').decode('utf-8'),
                show(head, R25_ARCHIVE), show(base, 'site.zip'), trusted,
            )
            print('verify-pages-release PASS: exact R2.5 additive route; all 217 older assets preserved')
        elif archive_at_base == R25_ARCHIVE and not archive_at_head:
            verify_r25_rollback(
                show(base, '.github/workflows/pages.yml').decode('utf-8'),
                show(head, '.github/workflows/pages.yml').decode('utf-8'),
                show(base, R25_ARCHIVE), show(base, 'site.zip'), trusted,
            )
            print('verify-pages-release PASS: exact R2.5 rollback; all older routes preserved')
        else:
            raise GateFailure('R2.5 release allows only exact additive release or full route rollback')
    elif changed == {R25_ARCHIVE}:
        verify_r25_archive_update(
            show(base, '.github/workflows/pages.yml').decode('utf-8')
            .replace(r24_pf_excel_stage_step(), '', 1).replace(r24_pf_rc_stage_step(), '', 1).replace(r24_pf_stage_step(), '', 1),
            show(base, R25_ARCHIVE), show(head, R25_ARCHIVE), show(base, 'site.zip'),
            {path: show(base, path) for path in R25_TRUSTED_INPUTS},
        )
        print('verify-pages-release PASS: exact R2.5 same-route update/rollback; 217 older assets preserved')
    elif changed == {R24_ARCHIVE}:
        verify_r24_archive_update(
            show(base, '.github/workflows/pages.yml').decode('utf-8')
            .replace(r24_pf_excel_stage_step(), '', 1).replace(r24_pf_rc_stage_step(), '', 1).replace(r24_pf_stage_step(), '', 1),
            show(base, R24_ARCHIVE), show(head, R24_ARCHIVE), show(base, 'site.zip'),
            {path: show(base, path) for path in R24_TRUSTED_INPUTS},
        )
        print('verify-pages-release PASS: exact R2.4 same-route update/rollback; old pages unchanged')
    elif changed == {R24_ARCHIVE, '.github/workflows/pages.yml'}:
        archive_at_head = subprocess.check_output(
            ['git', 'ls-tree', '--name-only', head, '--', R24_ARCHIVE], text=True).strip()
        if archive_at_head == R24_ARCHIVE:
            verify_r24_additive_release(
                show(base, '.github/workflows/pages.yml').decode('utf-8'),
                show(head, '.github/workflows/pages.yml').decode('utf-8'),
                show(head, R24_ARCHIVE), show(base, 'site.zip'),
                {path: show(base, path) for path in R24_TRUSTED_INPUTS},
            )
            print('verify-pages-release PASS: exact R2.4 static bundle; all preceding stages preserved')
        elif not archive_at_head:
            verify_r24_rollback(
                show(base, '.github/workflows/pages.yml').decode('utf-8'),
                show(head, '.github/workflows/pages.yml').decode('utf-8'),
                show(base, R24_ARCHIVE), show(base, 'site.zip'),
            )
            print('verify-pages-release PASS: exact R2.4 rollback; older routes unchanged')
        else:
            raise GateFailure('Unexpected R2.4 archive tree entry')
    elif changed == {R23_ARCHIVE,'.github/workflows/pages.yml'}:
        verify_r23_additive_release(
            show(base,'.github/workflows/pages.yml').decode('utf-8'),
            show(head,'.github/workflows/pages.yml').decode('utf-8'),
            show(head,R23_ARCHIVE),
            show(base,'site.zip'),
        )
        print('verify-pages-release PASS: R2.3 exact ZIP + 14 static resources + real Chromium 3-turn mocked speech')
    elif changed == {R21_ARCHIVE,'.github/workflows/pages.yml'}:
        verify_r21_release(
            show(base,'.github/workflows/pages.yml').decode('utf-8'),
            show(head,'.github/workflows/pages.yml').decode('utf-8'),
            show(head,R21_ARCHIVE),
            show(base,'site.zip'),
        )
        print('verify-pages-release PASS: pinned R2.1 sources, 7+5+4 tests and real Chromium UI with mocked speech')
    elif changed == set(AUTOQA_NAMESPACE_PATCH):
        contents = {p: show(head, p) for p in AUTOQA_FILES}
        verify_autoqa_namespace_patch(
            show(base, '.github/workflows/pages.yml').decode('utf-8'),
            show(base, 'site.zip'),
            contents,
        )
        print('verify-pages-release PASS: AutoQA namespace isolation fix, R6 ZIP unchanged')
    elif changed == set(AUTOQA_FILES) | {'.github/workflows/pages.yml'}:
        provided = {p: show(head, p) for p in AUTOQA_FILES}
        verify_autoqa_release(
            show(base, '.github/workflows/pages.yml').decode('utf-8'),
            show(head, '.github/workflows/pages.yml').decode('utf-8'),
            show(base, 'site.zip'),
            provided,
        )
        print('verify-pages-release PASS: unchanged R6 ZIP plus isolated AutoQA test copy')
    elif changed == {LAB_SOURCE, '.github/workflows/pages.yml'}:
        verify_lab_addition(
            show(base, '.github/workflows/pages.yml').decode('utf-8'),
            show(head, '.github/workflows/pages.yml').decode('utf-8'),
            show(head, LAB_SOURCE),
            show(base, 'site.zip'),
        )
        print('verify-pages-release PASS: R6 ZIP immutable; standalone lab exact SHA; additive workflow only')
    elif changed & release:
        if changed != release:
            raise GateFailure('Unexpected PR paths: release must change exactly site.zip and pages.yml')
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            for name, content in [('candidate.zip', show(head, 'site.zip')), ('baseline.zip', show(base, 'site.zip')), ('base.yml', show(base, '.github/workflows/pages.yml'))]:
                (root / name).write_bytes(content)
            subprocess.run([sys.executable, str(pathlib.Path(__file__).resolve()), '--candidate', str(root/'candidate.zip'), '--baseline', str(root/'baseline.zip'), '--workflow', str(root/'base.yml')], check=True)
            before = (root/'base.yml').read_text()
            after = show(head, '.github/workflows/pages.yml').decode()
            older = sha256((root/'baseline.zip').read_bytes())
            newer = sha256((root/'candidate.zip').read_bytes())
            if check_workflow(after, newer) != newer or after != before.replace(f'{older}  site.zip', f'{newer}  site.zip', 1):
                raise GateFailure('Workflow changed beyond ZIP checksum or candidate checksum mismatch')
        print('verify-pages-release PASS: release/root/manifest/checksum/paths')
    elif changed - docs and changed - docs <= ci:
        # Read-only runner, no secrets; CI updates are separately reviewed changes.
        for name in ('release-ci/release_guard.py', 'release-ci/test_release_guard.py'):
            compile(show(head, name), name, 'exec')
        if 'release-ci/stage_r21.py' in changed:
            compile(show(head, 'release-ci/stage_r21.py'), 'release-ci/stage_r21.py', 'exec')
        for new_ci_path in ('release-ci/stage_r23.py','release-ci/r23_browser_e2e.py'):
            if new_ci_path in changed:
                compile(show(head,new_ci_path),new_ci_path,'exec')
        if 'release-ci/r21_real_model_probe.py' in changed:
            compile(show(head,'release-ci/r21_real_model_probe.py'),'release-ci/r21_real_model_probe.py','exec')
        if '.github/workflows/r21-real-model-smoke.yml' in changed:
            model_yaml=show(head,'.github/workflows/r21-real-model-smoke.yml').decode('utf-8')
            if "workflow_dispatch:" not in model_yaml or "release-ci/r21_real_model_probe.py" not in model_yaml or "permissions:\n  contents: read" not in model_yaml:
                raise GateFailure('Model smoke workflow must be read-only, explicit, and manually repeatable')
        subprocess.run([sys.executable, 'release-ci/test_release_guard.py'], check=True)
        print('verify-pages-release PASS: dedicated CI update and regression tests')
    elif changed <= docs:
        print('verify-pages-release PASS: documentation only; no release changes')
    else:
        raise GateFailure('Unexpected PR paths: split release, CI and unrelated changes')
    return 0


def main():
    if len(sys.argv) == 5 and sys.argv[1] == '--stage-r24-paraformer-excel':
        try:
            stage_r24_pf_excel(sys.argv[2], sys.argv[3], sys.argv[4])
            return 0
        except (GateFailure, OSError, ValueError, KeyError, tarfile.TarError, zipfile.BadZipFile, zlib.error) as exc:
            print(f'R24_PARAFORMER_EXCEL_STAGE_FAILED: {exc}', file=sys.stderr)
            return 2
    if len(sys.argv) == 5 and sys.argv[1] == '--stage-r24-paraformer-rc':
        try:
            stage_r24_pf_rc(sys.argv[2], sys.argv[3], sys.argv[4])
            return 0
        except (GateFailure, OSError, ValueError, KeyError, tarfile.TarError, zipfile.BadZipFile, zlib.error) as exc:
            print(f'R24_PARAFORMER_RC_STAGE_FAILED: {exc}', file=sys.stderr)
            return 2
    if len(sys.argv) == 5 and sys.argv[1] == '--stage-r24-paraformer':
        try:
            stage_r24_pf(sys.argv[2], sys.argv[3], sys.argv[4])
            return 0
        except (GateFailure, OSError, ValueError, KeyError, tarfile.TarError, zipfile.BadZipFile, zlib.error) as exc:
            print(f'R24_PARAFORMER_STAGE_FAILED: {exc}', file=sys.stderr)
            return 2
    if len(sys.argv) == 4 and sys.argv[1] == '--stage-r25':
        try:
            stage_r25(sys.argv[2], sys.argv[3])
            return 0
        except (GateFailure, OSError, ValueError, subprocess.CalledProcessError) as exc:
            print(f'R25_STAGE_FAILED: {exc}', file=sys.stderr)
            return 1
    if len(sys.argv) == 4 and sys.argv[1] == '--stage-r24':
        try:
            stage_r24(sys.argv[2], sys.argv[3])
            return 0
        except (GateFailure, OSError, ValueError, subprocess.CalledProcessError) as exc:
            print(f'R24_STAGE_FAILED: {exc}', file=sys.stderr)
            return 2
    if len(sys.argv) == 4 and sys.argv[1] == '--verify-pr':
        try:
            return verify_pr(sys.argv[2], sys.argv[3])
        except (GateFailure, OSError, ValueError, subprocess.CalledProcessError) as exc:
            print(f'verify-pages-release FAILED: {exc}', file=sys.stderr)
            return 2
    p = argparse.ArgumentParser()
    p.add_argument('--candidate', required=True, type=pathlib.Path)
    p.add_argument('--baseline', type=pathlib.Path, help='Current main site.zip, for root byte preservation gate')
    p.add_argument('--workflow', type=pathlib.Path, help='Current main .github/workflows/pages.yml')
    p.add_argument('--expected-sha', help='Optional pinned intended candidate SHA-256')
    p.add_argument('--report', type=pathlib.Path)
    a = p.parse_args()
    out = {'checked_at_utc': datetime.now(timezone.utc).isoformat(), 'candidate': str(a.candidate), 'status': 'FAILED'}
    try:
        raw, current = inspect_zip(a.candidate)
        candidate_sha = sha256(raw)
        out.update({'candidate_sha256': candidate_sha, 'candidate_files': len(current)})
        if a.expected_sha and candidate_sha != a.expected_sha.lower():
            raise GateFailure(f'Unexpected candidate SHA-256: {candidate_sha}')
        prefix_names = [x for x in current if x.startswith(PREFIX)]
        root_names = [x for x in current if not x.startswith((PREFIX, SPECIALTY, QA_PREFIX, UI_R3_PREFIX, UI_R4_PREFIX, ASR_PREFIX))]
        if len(root_names) != 43:
            raise GateFailure(f'Expected 43 existing root files, found {len(root_names)}')
        for required in ('index.html', PREFIX + 'index.html', PREFIX + 'asr-check.html', PREFIX + '设备检查.html', PREFIX + 'src/offline-asr-worker.js'):
            if required not in current:
                raise GateFailure(f'Missing key entry: {required}')
        out['root_files'] = len(root_names)
        out['training_files'] = len(prefix_names)
        out['manifest_entries'], out['manifest_version'] = inspect_manifest(current)
        out['already_current'] = False
        specialty = {name[len(SPECIALTY):]: data for name, data in current.items() if name.startswith(SPECIALTY)}
        if specialty:
            if set(specialty) != SPECIALTY_FILES:
                raise GateFailure('Specialty frontend file allowlist mismatch')
            sm = json.loads(specialty['static-manifest.json'])
            if set(sm.get('files', {})) != SPECIALTY_FILES - {'static-manifest.json'}:
                raise GateFailure('Specialty manifest coverage mismatch')
            if any(sha256(specialty[name]) != digest for name, digest in sm['files'].items()):
                raise GateFailure('Specialty manifest hash mismatch')
            out['specialty_files'] = len(specialty)
        out['isolated_qa_files'] = inspect_isolated_qa(current)
        out['isolated_ui_r3_files'] = inspect_isolated_ui_r3(current)
        out['isolated_ui_r4_files'] = inspect_isolated_ui_r4(current)
        out['isolated_asr_files'] = inspect_isolated_asr(current)
        if a.baseline:
            base_raw, baseline = inspect_zip(a.baseline)
            out['baseline_sha256'] = sha256(base_raw)
            baseline, filename_repairs = normalize_known_baseline_names(out['baseline_sha256'], baseline)
            if filename_repairs:
                out['baseline_filename_repairs'] = filename_repairs
            changed_root = sorted(name for name, content in baseline.items() if not name.startswith((PREFIX, SPECIALTY, QA_PREFIX, UI_R3_PREFIX, UI_R4_PREFIX, ASR_PREFIX)) and current.get(name) != content)
            unexpected_new = sorted(name for name in current if name not in baseline and not name.startswith((PREFIX, SPECIALTY, QA_PREFIX, UI_R3_PREFIX, UI_R4_PREFIX, ASR_PREFIX)))
            if changed_root or unexpected_new:
                raise GateFailure('Root preservation failed: ' + repr({'changed_root': changed_root, 'unexpected_new': unexpected_new}))
            if len([n for n in baseline if not n.startswith((PREFIX, SPECIALTY, QA_PREFIX, UI_R3_PREFIX, UI_R4_PREFIX, ASR_PREFIX))]) != 43:
                raise GateFailure('Baseline root count is not 43')
            old_ui = {name: data for name, data in baseline.items() if name.startswith(UI_R3_PREFIX)}
            new_ui = {name: data for name, data in current.items() if name.startswith(UI_R3_PREFIX)}
            old_non_ui = {name: data for name, data in baseline.items() if not name.startswith(UI_R3_PREFIX)}
            new_non_ui = {name: data for name, data in current.items() if not name.startswith(UI_R3_PREFIX)}
            if old_ui and not new_ui:
                if candidate_sha != UI_R3_ROLLBACK_SHA256 or old_non_ui != new_non_ui:
                    raise GateFailure('UI R3 removal requires the pinned rollback and unchanged non-UI files')
            if old_ui != new_ui and old_non_ui != new_non_ui:
                raise GateFailure('UI R3 release must preserve every existing non-UI file')
            if specialty and any(current.get(name) != data for name, data in baseline.items() if not name.startswith((SPECIALTY, UI_R3_PREFIX, ASR_PREFIX))):
                raise GateFailure('Specialty release must preserve every existing non-specialty file')
            old_qa = {name: data for name, data in baseline.items() if name.startswith(QA_PREFIX)}
            new_qa = {name: data for name, data in current.items() if name.startswith(QA_PREFIX)}
            if old_qa:
                if old_qa != new_qa:
                    raise GateFailure('Existing mobile QA path must remain immutable')
            elif new_qa and any(current.get(name) != data for name, data in baseline.items()):
                raise GateFailure('Adding mobile QA must preserve all 106 baseline files byte-for-byte')
            old_r4 = {name: data for name, data in baseline.items() if name.startswith(UI_R4_PREFIX)}
            new_r4 = {name: data for name, data in current.items() if name.startswith(UI_R4_PREFIX)}
            if old_r4 and old_r4 != new_r4:
                raise GateFailure('Existing R4 QA assets must remain immutable')
            if new_r4 and not old_r4 and any(current.get(name) != data for name, data in baseline.items()):
                raise GateFailure('Adding R4 QA must preserve all 130 baseline files byte-for-byte')
            old_asr = {name: data for name, data in baseline.items() if name.startswith(ASR_PREFIX)}
            new_asr = {name: data for name, data in current.items() if name.startswith(ASR_PREFIX)}
            # The new path is additive and cannot change or remove any previous byte.
            if new_asr and not old_asr and any(current.get(name) != data for name, data in baseline.items()):
                raise GateFailure('Adding ASR QA must preserve all baseline files byte-for-byte')
            if old_asr and old_asr != new_asr:
                if (out['baseline_sha256'], candidate_sha) == (ASR_R6_BASE_SHA, ASR_R6_TARGET_SHA):
                    out['asr_r6_exact_pinned'] = allow_once_asr_r6(baseline, current, out['baseline_sha256'], candidate_sha)
                elif (out['baseline_sha256'], candidate_sha) == (ASR_RESTART_BASE_SHA, ASR_RESTART_TARGET_SHA):
                    out['asr_restart_pinned'] = allow_once_asr_restart_fix(baseline, current, out['baseline_sha256'], candidate_sha)
                elif (out['baseline_sha256'], candidate_sha) == (ASR_END_DIALOG_BASE_SHA, ASR_END_DIALOG_TARGET_SHA):
                    out['asr_end_dialog_pinned'] = allow_once_asr_end_dialog(baseline, current, out['baseline_sha256'], candidate_sha)
                elif (out['baseline_sha256'], candidate_sha) == (ASR_ROUND2_BASELINE_SHA, ASR_ROUND2_TARGET_SHA):
                    out['asr_round2_pinned'] = allow_once_asr_round2(baseline, current, out['baseline_sha256'], candidate_sha)
                else:
                    out['asr_stopfix_pinned'] = allow_once_asr_stopfix(baseline, current, out['baseline_sha256'], candidate_sha)
            out['root_preserved_bytewise'] = True
            out['already_current'] = base_raw == raw
            if a.workflow:
                workflow_sha = check_workflow(a.workflow.read_text(encoding='utf-8'), candidate_sha)
                if workflow_sha != out['baseline_sha256']:
                    raise GateFailure('Current workflow checksum does not match current main site.zip')
                out['current_workflow_checksum'] = workflow_sha
        elif a.workflow:
            out['workflow_checksum'] = check_workflow(a.workflow.read_text(encoding='utf-8'), candidate_sha)
        out['status'] = 'PASS'
    except (GateFailure, OSError, zipfile.BadZipFile, UnicodeError, ValueError, KeyError, zlib.error, struct.error) as exc:
        out['errors'] = [str(exc)]
    if a.report:
        a.report.parent.mkdir(parents=True, exist_ok=True)
        a.report.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if out['status'] == 'PASS' else 2


if __name__ == '__main__':
    sys.exit(main())


