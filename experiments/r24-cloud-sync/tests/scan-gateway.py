#!/usr/bin/env python3
"""Scan one Git tree, including supported archive members; print locations, never matching bytes."""
import argparse
import base64
import gzip
import hashlib
import io
import json
import re
import subprocess
import sys
import tarfile
import zipfile
import zlib
from collections import Counter

MIB = 1024 * 1024
MAX_MEMBER = 32 * MIB
MAX_TOTAL = 384 * MIB
MAX_ARCHIVE_MEMBERS = 12000
MAX_DEPTH = 5
KEY = rb"(?<![A-Za-z0-9_])" + b"sk" + rb"-[A-Za-z0-9_-]{12,}"
PUBLIC_HOST = b"api" + rb"\.openai\.com\b"
PUBLIC_KEY_NAME = b"OPENAI" + b"_API_KEY"
CHECKS = {
    "provider-key-like-literal": re.compile(KEY),
    "public-api-host": re.compile(PUBLIC_HOST, re.I),
    "public-api-key-variable": re.compile(PUBLIC_KEY_NAME),
}
# Heuristic for direct arguments to logging sinks. It cannot establish arbitrary data flow.
LOG_CALL = re.compile(rb"(?:console|logger)\s*\.\s*(?:log|info|warn|error|debug|trace)\s*\(([^;]{0,1000}?)\)\s*[;,\n}]", re.S)
SENSITIVE_ARGUMENT = re.compile(rb"\b(?:authorization|AI_GATEWAY_TOKEN|bearer|process\.env|headers|stack)\b", re.I)
RUNTIME = re.compile(r"^experiments/r24-cloud-sync/(?:backend|cloudbase|overlay)/[^/]+\.(?:m?js|cjs)$")


# These are public configuration declarations in the isolated Singapore runtime.
# Other files, archive members, duplicate declarations and all secret-shaped values remain subject to scanning.
SCF_RUNTIME = 'experiments/r24-cloud-sync/singapore-gateway/server.js'
SCF_DECLARATIONS = {
    'public-api-key-variable': b'    providerKey: process.env.' + PUBLIC_KEY_NAME + b',',
    'public-api-host': b"const CHAT_ENDPOINT = 'https://" + b'api' + b".openai.com/v1/chat/completions';",
}
SCF_LOG_ARGUMENT = re.compile(rb"\b(?:token|providerKey|auth|req|body|upstream|response|env)\b", re.I)

# Repository scoring runs in GitHub Actions. Treat a workflow's triggers,
# permissions and exact credential-consuming step as one reviewed unit.
# A change to any of those workflows requires reviewing the new blob.
SCORING_WORKFLOWS = {
    '.github/workflows/r24-private-score-archive.yml': '39541ee105c4620832948f1571ee4c366a0ca1665ccb39952e8e6591a4413433',
    '.github/workflows/r24-synthetic-score-acceptance.yml': '4c4dda37562878af6681ccaca664b77dbee492b5434967b9004dbb6384c25d12',
    '.github/workflows/r24-terra-first-pass.yml': '7ec5675e546958445c21085ed9d58ed2963b0b758007b5eb8bed8385e6fedf93',
}
SCORING = 'experiments/r24-cloud-sync/repository-scoring/'
CHAT_URL = b'https://api' + b'.openai.com/v1/chat/completions'
# Complete source lines. Each is allowed once in the exact tracked file.
# The placeholders keep this scanner from needing an exception for itself.
SCORING_LINES = {
    SCORING + 'worker.mjs': (b"const endpoint = '@url';",),
    SCORING + 'worker.test.mjs': (b"    called++;assert.equal(url,'@url');",),
    SCORING + 'run.mjs': (
        b"    const score = env.@key?.trim() ? createOpenAIScorer(env.@key) : null;",
    ),
    SCORING + 'acceptance.mjs': (
        b"    env.GITHUB_RUN_ATTEMPT === '1' && !!env.@key;",
        b"    const provider = live ? createOpenAIScorer(process.env.@key,{async fetchImpl(url, options) {",
        b"      assert.equal(url,'@url');",
    ),
    SCORING + 'terra-round1.mjs': (
        b"const endpoint = '@url';",
        b"    typeof env.@key==='string' && env.@key.trim().length>0;",
        b"  const token=live?env.@key:'offline-comparison-fixture';",
    ),
    SCORING + 'check-no-scoring-fallback.sh': (
        b"rg -nF \"const endpoint = '@url'\" \"$scoring/worker.mjs\"",
        b"rg -nF 'createOpenAIScorer(env.@key)' \"$scoring/run.mjs\"",
    ),
}
# Exact UTF-8 README setup sentence; edits to the rest of the guide do not affect the rule.
SCORING_README_LINE_SHA = '72a8af22fdf41aa68ef7a13b1dfc3e7d52326f850fb591df6aff475e61efd5ed'
SCORING_LOG_ARGUMENT = re.compile(rb'\b(?:apiKey|providerKey|credential|token|env|authorization|headers)\b', re.I)


def approved_scoring_reference(path, data, kind, pattern):
    if kind not in ('public-api-host', 'public-api-key-variable'):
        return False
    if path in SCORING_WORKFLOWS:
        return kind == 'public-api-key-variable' and hashlib.sha256(data).hexdigest() == SCORING_WORKFLOWS[path]
    if path not in SCORING_LINES and path != SCORING + 'README.md':
        return False
    # Do not strip whitespace or collapse duplicates. A repeated declaration,
    # suffix, or second reference in another context needs a fresh review.
    actual = [line for line in data.split(b'\n') if pattern.search(line)]
    if path == SCORING + 'README.md':
        return (kind == 'public-api-key-variable' and len(actual) == 1
                and hashlib.sha256(actual[0]).hexdigest() == SCORING_README_LINE_SHA)
    expected = {line.replace(b'@key', PUBLIC_KEY_NAME).replace(b'@url', CHAT_URL) for line in SCORING_LINES[path]}
    return len(actual) == len(set(actual)) and all(line in expected for line in actual)


def safe_name(path):
    name = re.sub(KEY, b"[REDACTED]", path.encode("utf-8", "backslashreplace"))
    return json.dumps(name.decode("utf-8", "replace"), ensure_ascii=True)


def git(*args):
    return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL)


class Scan:
    def __init__(self):
        self.counts = Counter()
        self.bytes = 0
        self.findings = set()
        self.gaps = set()
        self.public_declarations = set()
        self.scoring_declarations = set()

    def marked(self, path, data):
        for kind, pattern in CHECKS.items():
            if not pattern.search(data):
                continue
            if path == SCF_RUNTIME and kind in SCF_DECLARATIONS:
                expected = re.search(rb'^' + re.escape(SCF_DECLARATIONS[kind]) + rb'$', data, re.M)
                if expected and not (pattern.search(data, 0, expected.start()) or pattern.search(data, expected.end())):
                    self.public_declarations.add((kind, path))
                    continue
            if approved_scoring_reference(path, data, kind, pattern):
                self.scoring_declarations.add((kind, path))
                continue
            self.findings.add((kind, path))
        member_path = path.rsplit('!', 1)[-1]
        is_scoring_script = member_path.startswith(SCORING) and member_path.endswith(('.js', '.mjs', '.cjs'))
        if (RUNTIME.fullmatch(member_path) or member_path == SCF_RUNTIME or is_scoring_script) and any(
                SENSITIVE_ARGUMENT.search(m[1]) or (member_path == SCF_RUNTIME and SCF_LOG_ARGUMENT.search(m[1]))
                or (is_scoring_script and SCORING_LOG_ARGUMENT.search(m[1])) for m in LOG_CALL.finditer(data)):
            self.findings.add(("possible-sensitive-log-argument", path))

    def fits(self, path, size):
        if size < 0 or size > MAX_MEMBER or size + self.bytes > MAX_TOTAL:
            self.gaps.add(("size-budget", path))
            return False
        return True

    def member(self, path, data, depth=0):
        if not self.fits(path, len(data)):
            return
        self.bytes += len(data)
        self.marked(path, data)
        if data.startswith((b'\xff\xfe', b'\xfe\xff')):
            self.marked(path, data.decode('utf-16', errors='replace').encode('utf-8'))
        name = path.lower()
        if name.endswith('.b64'):
            kind = 'base64'
        elif data.startswith(b'PK\x03\x04') or name.endswith(('.zip', '.xlsx', '.docx', '.pptx', '.jar')):
            kind = 'zip'
        elif data.startswith(b'\x1f\x8b') or name.endswith(('.gz', '.tgz')):
            kind = 'gzip'
        elif data[257:262] == b'ustar' or name.endswith('.tar'):
            kind = 'tar'
        elif name.endswith(('.7z', '.rar', '.zst', '.bz2', '.xz')):
            self.gaps.add(('unsupported-archive', path))
            return
        else:
            return
        if depth >= MAX_DEPTH:
            self.gaps.add(('nesting-limit', path))
            return
        self.counts[kind] += 1
        try:
            if kind == 'base64':
                decoded = base64.b64decode(b''.join(data.split()), validate=True)
                self.member(path + '!' + path.rsplit('/', 1)[-1][:-4], decoded, depth + 1)
            elif kind == 'gzip':
                budget = min(MAX_MEMBER, MAX_TOTAL - self.bytes)
                with gzip.GzipFile(fileobj=io.BytesIO(data)) as gz:
                    decoded = gz.read(budget + 1)
                self.member(path + '!gzip-content', decoded, depth + 1)
            elif kind == 'zip':
                with zipfile.ZipFile(io.BytesIO(data)) as package:
                    for entry in package.infolist():
                        if not self.allow_member(path):
                            break
                        if not entry.is_dir():
                            child = path + '!' + entry.filename
                            if self.fits(child, entry.file_size):
                                self.member(child, package.read(entry), depth + 1)
            else:
                with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as package:
                    for entry in package:
                        if not self.allow_member(path):
                            break
                        if entry.isfile():
                            child = path + '!' + entry.name
                            if self.fits(child, entry.size):
                                with package.extractfile(entry) as member:
                                    self.member(child, member.read(entry.size + 1), depth + 1)
        except (OSError, ValueError, EOFError, RuntimeError, tarfile.TarError, zipfile.BadZipFile, zlib.error):
            self.gaps.add(('invalid-or-unreadable-archive', path))

    def allow_member(self, path):
        self.counts['archive-entries'] += 1
        if self.counts['archive-entries'] <= MAX_ARCHIVE_MEMBERS:
            return True
        self.gaps.add(('archive-entry-budget', path))
        return False

    def tree(self, ref):
        for record in git('ls-tree', '-rlz', '--full-tree', ref).split(b'\0'):
            if not record:
                continue
            header, raw_path = record.split(b'\t', 1)
            _, kind, oid, size = header.split()
            path = raw_path.decode('utf-8', 'surrogateescape')
            self.counts['tracked-entries'] += 1
            if kind != b'blob':
                self.gaps.add(('non-blob-entry', path))
            elif self.fits(path, int(size)):
                self.member(path, git('cat-file', 'blob', oid.decode()))


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    group = cli.add_mutually_exclusive_group()
    group.add_argument('--cached', action='store_true', help='scan the Git index, including staged changes')
    group.add_argument('--tree', default='HEAD', help='scan the named commit or tree (default HEAD)')
    args = cli.parse_args()
    try:
        ref = (git('write-tree') if args.cached else git('rev-parse', '--verify', '--end-of-options', args.tree + '^{tree}')).decode().strip()
        scan = Scan()
        scan.tree(ref)
    except (OSError, subprocess.CalledProcessError):
        print('INCOMPLETE: Git tree or blob unavailable', file=sys.stderr)
        return 2
    print('tree=' + ref, 'scope=git-blobs+zip+tar+gzip+b64', 'history=excluded', 'untracked=excluded')
    print('limits: member=32MiB total=384MiB nesting=5 archive-entries=12000')
    print('counts:', json.dumps(dict(scan.counts), sort_keys=True), 'scanned-bytes=' + str(scan.bytes))
    for label, issues in [('PUBLIC-SCF-DECLARATION', scan.public_declarations),
                          ('REPOSITORY-SCORING-DECLARATION', scan.scoring_declarations),
                          ('FINDING', scan.findings), ('COVERAGE-GAP', scan.gaps)]:
        for kind, path in sorted(issues):
            print(label, kind, safe_name(path))
    print('findings=' + str(len(scan.findings)), 'coverage-gaps=' + str(len(scan.gaps)), 'log-check=direct-sink-heuristic')
    return 2 if scan.gaps else int(bool(scan.findings))


if __name__ == '__main__':
    sys.exit(main())
