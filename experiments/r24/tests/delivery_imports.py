#!/usr/bin/env python3
"""Chromium native file-picker import and mobile viewport QA; synthetic documents only."""
import functools, io, json, pathlib, struct, threading, zipfile, os, hashlib
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = pathlib.Path(os.environ.get('R24_UI_OUTPUT',str(ROOT / 'evidence/r24-delivery/recheck')))
APP = ROOT/'experiments/r24/tcl-v352-asr-r24-qa/app.js'
APP_SHA = hashlib.sha256(APP.read_bytes()).hexdigest()
OUT.mkdir(parents=True, exist_ok=True)


def archive(entries, compression=zipfile.ZIP_DEFLATED):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', compression=compression) as z:
        for name, data in entries:
            z.writestr(name, data)
    return out.getvalue()


WORD = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>TCL HDMI 2.1 T7</w:t></w:r><w:r><w:t>M Pro，价格2500元，144Hz。</w:t></w:r></w:p></w:body></w:document>'
WB = '<workbook><sheets><sheet name="合成测试"/></sheets></workbook>'
SHEET = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>HDMI 2.1</t></is></c></row><row r="2"><c r="B2" t="inlineStr"><is><t>T7M Pro</t></is></c></row></sheetData></worksheet>'
DOCX = archive([('word/document.xml', WORD)])
# Streaming ZIP writers (including some Office exporters) use a data descriptor.
class NonSeekable(io.BytesIO):
    def seek(self, *_args):
        raise io.UnsupportedOperation('streaming fixture')
stream = NonSeekable()
with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    z.writestr('word/document.xml', WORD)
STREAM_DOCX = stream.getvalue()
XLSX = archive([('xl/workbook.xml', WB), ('xl/sharedStrings.xml', '<sst><si><t>TCL</t></si></sst>'), ('xl/worksheets/sheet1.xml', SHEET)])
CRC_BAD = bytearray(archive([('word/document.xml', WORD)], zipfile.ZIP_STORED))
struct.pack_into('<I', CRC_BAD, 14, 0)
struct.pack_into('<I', CRC_BAD, CRC_BAD.index(b'PK\x01\x02') + 16, 0)
SIZE_BAD = bytearray(DOCX)
struct.pack_into('<I', SIZE_BAD, 22, 1)
struct.pack_into('<I', SIZE_BAD, SIZE_BAD.index(b'PK\x01\x02') + 24, 1)


def xlsx_ref(ref, row=1):
    sheet = f'<worksheet><sheetData><row r="{row}"><c r="{ref}" t="inlineStr"><is><t>TCL</t></is></c></row></sheetData></worksheet>'
    return archive([('xl/workbook.xml', WB), ('xl/worksheets/sheet1.xml', sheet)])


VALID = [
    ('synthetic.txt', 'TCL HDMI 2.1 T7M Pro，价格2500元，144Hz。'.encode()),
    ('synthetic.csv', '品牌,接口,型号\r\nTCL,"HDMI 2.1","T7M Pro"\r\n'.encode()),
    ('synthetic.docx', DOCX), ('synthetic.xlsx', XLSX), ('streaming.docx', STREAM_DOCX),
    ('stored.docx', archive([('word/document.xml', WORD)], zipfile.ZIP_STORED)),
]
INVALID = [
    ('empty.txt', b''), ('utf8-invalid.txt', b'\xff\xfeTCL'),
    ('broken.csv', b'"TCL,HDMI'), ('broken.docx', b'not a zip'),
    ('no-workbook.xlsx', archive([('xl/worksheets/sheet1.xml', SHEET)])),
    ('bad-crc.docx', bytes(CRC_BAD)), ('forged-size.docx', bytes(SIZE_BAD)),
    ('duplicate.docx', archive([('word/document.xml', WORD), ('word/document.xml', WORD)])),
    ('over-column.xlsx', xlsx_ref('XFE1')),
    ('huge-column.xlsx', xlsx_ref('ZZZZZZZ1')),
    ('zero-row.xlsx', xlsx_ref('A0', 0)),
    ('mismatched-row.xlsx', xlsx_ref('A2')),
    ('over-row.xlsx', xlsx_ref('A1048577', 1048577)),
    ('oversize.txt', b'x' * (5 * 1024 * 1024 + 1)),
    ('wrong-extension.html', b'<script>throw new Error("MUST NOT EXECUTE")</script>'),
]


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT / 'experiments/r24')))
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
url = origin + '/tcl-v352-asr-r24-qa/'
report = {'mode': 'Desktop Chromium, 320/390 CSS-pixel mobile viewports, synthetic input documents; no device or speech-accuracy claim', 'imports': [], 'viewports': [], 'page_errors': [], 'external_requests': []}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 390, 'height': 844})
        page.on('pageerror', lambda err: report['page_errors'].append(str(err)))
        page.on('request', lambda req: report['external_requests'].append(req.url) if not req.url.startswith(origin) else None)
        page.goto(url)
        page.locator('[data-role-pick="anchor"]').click()
        page.locator('#simpleName').fill('交付导入测试')
        page.locator('#simpleLogin').click()
        page.locator('details.header-tools summary').click()
        page.locator('#asrGlossaryTerms').fill('TCL\nHDMI')
        page.locator('#asrGlossarySave').click()
        for name, data in VALID + INVALID:
            page.locator('#asrGlossaryFile').set_input_files({'name': name, 'mimeType': 'application/octet-stream', 'buffer': data})
            page.wait_for_function("!document.getElementById('asrGlossaryFile').disabled && !document.getElementById('asrGlossaryFile').value")
            status = page.locator('#asrGlossaryStatus').inner_text()
            expected_ok = any(name == n for n, _ in VALID)
            accepted = '请核对后点击保存' in status
            assert accepted == expected_ok, (name, status)
            assert page.evaluate("localStorage.getItem('tcl-r24-private-asr-terms-v1')") == 'TCL\nHDMI'
            if accepted:
                terms = page.locator('#asrGlossaryTerms').input_value().splitlines()
                assert terms == ['TCL', 'HDMI 2.1', 'T7M Pro'], (name, terms)
            report['imports'].append({'fixture': name, 'expected': 'preview' if expected_ok else 'rejected', 'status': status, 'saved_terms_unchanged': True})
        # Imported HTML-like strings remain text and cannot create markup or run scripts.
        page.locator('#asrGlossaryFile').set_input_files({'name': 'synthetic-markup.txt', 'mimeType': 'text/plain', 'buffer': b'<script>window.__injected=true</script> TCL https://example.com/T999 person@example.com'})
        page.wait_for_function("!document.getElementById('asrGlossaryFile').disabled && !document.getElementById('asrGlossaryFile').value")
        assert page.locator('#asrGlossaryTerms').input_value() == 'TCL'
        assert page.evaluate('window.__injected === undefined')
        report['markup_inert'] = True
        for width, height in [(320, 568), (390, 844)]:
            page.set_viewport_size({'width': width, 'height': height})
            page.locator('#asrGlossaryClear').scroll_into_view_if_needed()
            bounds = page.evaluate("({viewport:innerWidth, width:document.documentElement.scrollWidth, panel:document.querySelector('.asr-tools-panel').getBoundingClientRect().toJSON()})")
            assert bounds['width'] <= width, bounds
            assert bounds['panel']['x'] >= -1 and bounds['panel']['right'] <= width + 1, bounds
            page.screenshot(path=str(OUT / f'glossary-{width}.png'), full_page=True)
            report['viewports'].append({'width': width, 'height': height, 'horizontal_overflow': False, 'scrollable_tools': True})
        assert not report['page_errors'], report['page_errors']
        assert not report['external_requests'], report['external_requests']
        report.update(status='PASS', browser=browser.version)
        browser.close()
finally:
    report['app_sha256']=APP_SHA;report['app_sha256_after']=hashlib.sha256(APP.read_bytes()).hexdigest();report['source_unchanged']=report['app_sha256_after']==APP_SHA
    if not report['source_unchanged']:report['status']='FAIL'
    server.shutdown()
    (OUT / 'imports.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
print(json.dumps(report, ensure_ascii=False, indent=2))

assert report.get('status')=='PASS' and report.get('source_unchanged')
