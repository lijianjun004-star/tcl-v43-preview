#!/usr/bin/env python3
"""Scan one Git tree, including supported archive members; print locations, never matching bytes."""
import argparse
import base64
import gzip
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
HOST_NAME = b"api" + b".openai.com"
PUBLIC_HOST = re.escape(HOST_NAME) + rb"\b"
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
WORKFLOW = ".github/workflows/r24-batch-questions-export.yml"
INBOX_WORKFLOW = ".github/workflows/r24-materials-inbox.yml"
EXPORTER = "experiments/r24-cloud-sync/scripts/batch-questions-export.mjs"
INBOX_EXPORTER = "experiments/r24-cloud-sync/scripts/inbox-export.mjs"
KEY_BINDING = ("public-api-key-variable", b"          BATCH_API_TOKEN: ${{ secrets." + PUBLIC_KEY_NAME + b" }}")
EDITORIAL_BINDINGS = {
    WORKFLOW: KEY_BINDING,
    INBOX_WORKFLOW: KEY_BINDING,
    EXPORTER: ("public-api-host", b"const endpoint = 'https://" + HOST_NAME + b"/v1/chat/completions';"),
}
EDITORIAL_SENSITIVE = re.compile(rb"\b(?:BATCH_API_TOKEN|apiKey)\b", re.I)
SHELL_ECHO = re.compile(rb"\b(?:echo|printf)\s+[^\r\n]*(?:\$\{?BATCH_API_TOKEN\b|\$\{\{\s*secrets\.)", re.I)


def safe_name(path):
    name = re.sub(KEY, b"[REDACTED]", path.encode("utf-8", "backslashreplace"))
    return json.dumps(name.decode("utf-8", "replace"), ensure_ascii=True)


def git(*args):
    return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL)


class Scan:
    def __init__(self, strict_gateway=False):
        self.counts = Counter()
        self.bytes = 0
        self.findings = set()
        self.gaps = set()
        self.strict_gateway = strict_gateway
        self.public_identifiers = set()

    def marked(self, path, data):
        binding = None if self.strict_gateway else EDITORIAL_BINDINGS.get(path)
        for kind, pattern in CHECKS.items():
            if not pattern.search(data):
                continue
            if binding and binding[0] == kind:
                # Accept exactly one complete declaration. Other occurrences in the
                # same blob are findings even when their declaration is identical.
                declaration = re.search(rb'^' + re.escape(binding[1]) + rb'$', data, re.M)
                if declaration:
                    self.public_identifiers.add((kind, path))
                    if not (pattern.search(data, 0, declaration.start()) or pattern.search(data, declaration.end())):
                        continue
            self.findings.add((kind, path))
        member_path = path.rsplit('!', 1)[-1]
        editorial_runtime = member_path in (EXPORTER, INBOX_EXPORTER)
        if (RUNTIME.fullmatch(member_path) or editorial_runtime) and any(
            SENSITIVE_ARGUMENT.search(m[1]) or (editorial_runtime and EDITORIAL_SENSITIVE.search(m[1]))
            for m in LOG_CALL.finditer(data)
        ):
            self.findings.add(("possible-sensitive-log-argument", path))
        if member_path in (WORKFLOW, INBOX_WORKFLOW) and SHELL_ECHO.search(data):
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
    cli.add_argument('--strict-gateway', action='store_true',
                     help='also reject all public offline CI architecture declarations')
    group = cli.add_mutually_exclusive_group()
    group.add_argument('--cached', action='store_true', help='scan the Git index, including staged changes')
    group.add_argument('--tree', default='HEAD', help='scan the named commit or tree (default HEAD)')
    args = cli.parse_args()
    try:
        ref = (git('write-tree') if args.cached else git('rev-parse', '--verify', '--end-of-options', args.tree + '^{tree}')).decode().strip()
        scan = Scan(strict_gateway=args.strict_gateway)
        scan.tree(ref)
    except (OSError, subprocess.CalledProcessError):
        print('INCOMPLETE: Git tree or blob unavailable', file=sys.stderr)
        return 2
    print('tree=' + ref, 'scope=git-blobs+zip+tar+gzip+b64', 'history=excluded', 'untracked=excluded')
    print('limits: member=32MiB total=384MiB nesting=5 archive-entries=12000')
    print('counts:', json.dumps(dict(scan.counts), sort_keys=True), 'scanned-bytes=' + str(scan.bytes))
    for label, issues in [('PUBLIC-CI-IDENTIFIER', scan.public_identifiers),
                          ('FINDING', scan.findings), ('COVERAGE-GAP', scan.gaps)]:
        for kind, path in sorted(issues):
            print(label, kind, safe_name(path))
    print('findings=' + str(len(scan.findings)), 'coverage-gaps=' + str(len(scan.gaps)),
          'public-ci-identifiers=' + str(len(scan.public_identifiers)), 'log-check=direct-sink-heuristic')
    return 2 if scan.gaps else int(bool(scan.findings))


if __name__ == '__main__':
    sys.exit(main())
