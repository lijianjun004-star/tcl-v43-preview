#!/usr/bin/env python3
"""Build a separate candidate from the exact unpacked QA3 site (models included)."""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit

BASE_PIN = "ce897151ee99aeed5b9b946c27119b3a6b9f74ab372903b147b68a7a0e2556e1"
VERSION = "r24-paraformer-excel-cloud-sync-v2-20261124.13-async-rc1"
SHORT_VERSION = "R24-20261124.13-async-rc1"
ASSET_REVISION = "r24-sync-v2-20261124.13-async-rc1"


def digest(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def update_assignment_excel_limit(parser_path):
    # Apply the pilot option to the verified QA3 parser without changing its defaults.
    source = parser_path.read_text(encoding="utf-8")
    replacements = (
        ("import { readZipEntries } from './zip.js';",
         "import { ZIP_LIMITS, readZipEntries } from './zip.js';"),
        ("export async function parseXlsxBuffer(buffer, fileName) {\n"
         "  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);\n"
         "  const zip = await readZipEntries(bytes);",
         "const ASSIGNMENT_XLSX_LIMITS = { ...ZIP_LIMITS, maxUncompressedBytes: 50 * 1024 * 1024 };\n\n"
         "export async function parseXlsxBuffer(buffer, fileName, { assignmentExcel = false } = {}) {\n"
         "  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);\n"
         "  const zip = await readZipEntries(bytes, assignmentExcel ? ASSIGNMENT_XLSX_LIMITS : ZIP_LIMITS);"),
        ("export async function parseDocumentFile(inputFile) {",
         "export async function parseDocumentFile(inputFile, { assignmentExcel = false } = {}) {"),
        ("return await parseXlsxBuffer(bytes, fileName);",
         "return await parseXlsxBuffer(bytes, fileName, { assignmentExcel });"),
    )
    for before, after in replacements:
        if source.count(before) != 1:
            raise ValueError("QA3 parser no longer matches the XLSX overlay")
        source = source.replace(before, after, 1)
    parser_path.write_text(source, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("qa3_site", type=Path, help="QA3 site directory containing all 36 verified files")
    parser.add_argument("output", type=Path, help="new directory outside the QA3 source")
    parser.add_argument("--env-id", help="isolated CloudBase Auth environment ID")
    parser.add_argument("--api-base", help="absolute HTTPS assignment service URL including path")
    args = parser.parse_args()
    source, target = args.qa3_site.resolve(), args.output.resolve()
    if target.exists() or target.is_relative_to(source):
        parser.error("output must be a new directory outside QA3")
    if bool(args.env_id) != bool(args.api_base):
        parser.error("--env-id and --api-base must be supplied together")
    if args.api_base:
        url = urlsplit(args.api_base)
        if (url.scheme != "https" or not url.hostname or url.username or url.password
                or url.query or url.fragment or not re.fullmatch(r"[a-z0-9][a-z0-9-]{2,63}", args.env_id)):
            parser.error("invalid CloudBase env ID or HTTPS service URL")

    manifest = source / "static-manifest.json"
    if digest(manifest) != BASE_PIN:
        parser.error("QA3 static manifest hash mismatch")
    known = json.loads(manifest.read_text())["files"]
    for name, expected in known.items():
        path = source / name
        if not path.resolve().is_relative_to(source) or not path.is_file() or digest(path) != expected:
            parser.error("missing or changed QA3 file: " + name)

    overlay = Path(__file__).resolve().parent / "overlay"
    target.mkdir(parents=True)
    for name in known:
        to = target / name
        to.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / name, to)
    entry = target / "index.html"
    html = entry.read_bytes()
    old_script = b'src="app.js"'
    if html.count(old_script) != 1:
        raise ValueError("QA3 module script could not be uniquely identified")
    head_end = b"</head>"
    if html.count(head_end) != 1:
        raise ValueError("QA3 head could not be uniquely identified")
    meta = f'<meta name="tcl-r24-sync-version" content="{SHORT_VERSION}">'.encode()
    meta += f'<link rel="stylesheet" href="assignment-evaluation.css?v={ASSET_REVISION}">'.encode()
    if args.api_base:
        meta += b'<meta name="tcl-r24-sync-mode" content="cloud">'
        mode = '<span id="modeText">本机独立预览</span>'.encode()
        view = b'<main class="content" id="view" aria-live="polite">'
        if html.count(mode) != 1 or html.count(view) != 1:
            raise ValueError("QA3 loading state could not be uniquely identified")
        html = html.replace(mode, '<span id="modeText">云同步试点 · 正在连接</span>'.encode()).replace(
            view, view + '<p class="notice" role="status">正在加载练播房，核对本机绑定…</p>'.encode()
        )
    entry.write_bytes(
        html.replace(head_end, meta + head_end)
        .replace(old_script, f'src="app.js?v={ASSET_REVISION}"'.encode())
    )
    for name in ("app.js", "assignment-sync.mjs", "assignment-drafts.mjs", "assignment-draft-panel.mjs",
                 "assignment-evaluation.mjs", "assignment-evaluation.css", "ai-model-label.mjs"):
        shutil.copyfile(overlay / name, target / name)
    update_assignment_excel_limit(target / "lib/parser.js")
    shutil.copyfile(overlay.parent / "backend/vendor/assignment-excel.mjs", target / "assignment-excel.mjs")
    if args.api_base:
        config = {"assignmentSync": {"envId": args.env_id, "apiBase": args.api_base}}
        (target / "app-config.json").write_text(json.dumps(config, indent=2) + "\n")
    files = {str(p.relative_to(target)): digest(p) for p in sorted(target.rglob("*")) if p.is_file()}
    (target / manifest.name).write_text(json.dumps({"version": VERSION, "files": files}, indent=2) + "\n")
    print(json.dumps({"version": VERSION, "files": len(files) + 1, "cloudConfigured": bool(args.api_base)}))


if __name__ == "__main__":
    main()
