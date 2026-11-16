#!/usr/bin/env python3
"""TCL Pages release gate (V2.2). Python stdlib only; does not access network or write to GitHub."""
import argparse
import hashlib
import io
import json
import pathlib
import re
import sys
import stat
import zipfile
import struct
import zlib
import subprocess
import tempfile
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


def verify_pr(base, head):
    """Classify every PR; release PRs execute only this baseline verifier."""
    for ref in (base, head):
        if not re.fullmatch('[0-9a-f]{40}', ref):
            raise GateFailure('Expected pinned Git commit SHA')
    def show(ref, path):
        return subprocess.check_output(['git', 'show', f'{ref}:{path}'])
    changed = set(subprocess.check_output(['git', 'diff', '--name-only', base, head], text=True).splitlines())
    release = {'site.zip', '.github/workflows/pages.yml'}
    ci = {'.github/workflows/verify-pages-pr.yml', 'release-ci/release_guard.py', 'release-ci/test_release_guard.py', 'release-ci/stage_r21.py'}
    docs = {name for name in changed if name.endswith('.md') and not name.startswith(('.github/', 'release-ci/'))}
    if changed == {R21_ARCHIVE,'.github/workflows/pages.yml'}:
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
        subprocess.run([sys.executable, 'release-ci/test_release_guard.py'], check=True)
        print('verify-pages-release PASS: dedicated CI update and regression tests')
    elif changed <= docs:
        print('verify-pages-release PASS: documentation only; no release changes')
    else:
        raise GateFailure('Unexpected PR paths: split release, CI and unrelated changes')
    return 0


def main():
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


