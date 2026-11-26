"""Read public teaching material from a bounded, values-only OOXML workbook on stdin."""
import io
import json
import posixpath
import re
import sys
from decimal import Decimal, InvalidOperation
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZIP_DEFLATED, ZIP_STORED, ZipFile
from zlib import error as ZlibError

SHEET = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
REL = '{http://schemas.openxmlformats.org/package/2006/relationships}'
MAX_INPUT = 100 * 1024
MAX_XML = 4 * 1024 * 1024
MAX_SCAN = 8 * 1024 * 1024
MAX_CELLS = 20000
ESCAPED = re.compile(r'_x([0-9a-fA-F]{4})_')
CELL = re.compile(r'([A-Z]{1,3})([1-9][0-9]{0,6})')
ALLOWED_PART = re.compile(
    r'(?:\[Content_Types\]\.xml|_rels/\.rels|docProps/(?:app|core|custom)\.xml|'
    r'xl/(?:workbook|styles|sharedStrings)\.xml|xl/_rels/workbook\.xml\.rels|'
    r'xl/theme/[^/]+\.xml|xl/worksheets/(?:[^/]+\.xml|_rels/[^/]+\.xml\.rels))'
)


class WorkbookError(ValueError):
    pass


def fail(reason):
    raise WorkbookError('INBOX_XLSX_' + reason)


def value(text):
    # Excel escapes some characters in ST_Xstring, including a literal underscore.
    decoded = ESCAPED.sub(lambda m: chr(int(m[1], 16)), text)
    if any(0xd800 <= ord(c) <= 0xdfff for c in decoded):
        decoded = decoded.encode('utf-16-le', 'surrogatepass').decode('utf-16-le')
    return decoded


def rich(cell):
    if cell is None:
        fail('INVALID')
    return ''.join(value(n.text or '') for n in cell.findall(SHEET + 't')
                   + cell.findall(SHEET + 'r/' + SHEET + 't'))


def numeric_identity(raw):
    # Some editors serialize long integer cells in scientific notation.
    if not raw or 'e' not in raw.lower() or len(raw) > 64:
        return None
    try:
        number = Decimal(raw)
        if number.is_finite() and number.adjusted() in (10, 17) and number == number.to_integral_value():
            return str(int(number))
    except InvalidOperation:
        pass
    return None


def read_package(data):
    trees = {}
    scan = []
    with ZipFile(io.BytesIO(data)) as archive:
        parts = archive.infolist()
        if len(parts) > 128 or sum(p.file_size for p in parts) > MAX_XML:
            fail('LIMIT')
        for p in parts:
            if p.is_dir():
                continue
            name = p.filename
            if not ALLOWED_PART.fullmatch(name):
                fail('UNSUPPORTED_PART')
            if name in trees or p.flag_bits & 1 or p.compress_type not in (ZIP_STORED, ZIP_DEFLATED):
                fail('INVALID')
            source = archive.read(p).decode('utf-8-sig')
            if re.search(r'<!\s*(?:DOCTYPE|ENTITY)\b', source, re.I):
                fail('UNSUPPORTED_XML')
            # Decode as Unicode first; the input XML encoding is limited to UTF-8.
            tree = ET.fromstring(source)
            trees[name] = tree
            scan.append(name)
            for node in tree.iter():
                if node.tag == REL + 'Relationship' and node.get('TargetMode', '').lower() == 'external':
                    fail('EXTERNAL_LINK')
                if node.tag == SHEET + 'f':
                    fail('FORMULA')
                scan.extend(value(attr) for attr in node.attrib.values())
                if node.text and node.text.strip():
                    scan.append(value(node.text))
                if node.tag == SHEET + 'c' and node.get('t', 'n') == 'n':
                    digits = numeric_identity(node.findtext(SHEET + 'v', ''))
                    if digits:
                        scan.append(digits)
                if node.tag in (SHEET + 'si', SHEET + 'is'):
                    scan.append(rich(node))  # Include unreferenced and hidden rich strings.
    return trees, scan


def position(ref):
    match = CELL.fullmatch(ref)
    if not match:
        fail('INVALID')
    number = 0
    for char in match[1]:
        number = number * 26 + ord(char) - ord('A') + 1
    if number > 16384 or int(match[2]) > 1048576:
        fail('INVALID')
    return number


def sheet_rows(tree, strings):
    if tree.tag != SHEET + 'worksheet':
        fail('INVALID')
    boundaries = [0] * 16386
    for column in tree.findall(SHEET + 'cols/' + SHEET + 'col'):
        if column.get('hidden') in ('1', 'true'):
            lo, hi = int(column.attrib['min']), int(column.attrib['max'])
            if not 1 <= lo <= hi <= 16384:
                fail('INVALID')
            boundaries[lo] += 1
            boundaries[hi + 1] -= 1
    for idx in range(1, 16385):
        boundaries[idx] += boundaries[idx - 1]
    for row in tree.findall(SHEET + 'sheetData/' + SHEET + 'row'):
        if row.get('hidden') in ('1', 'true'):
            continue
        parts = []
        row_size = last = 0
        for cell in row.findall(SHEET + 'c'):
            idx = position(cell.attrib['r']) if 'r' in cell.attrib else last + 1
            if idx <= last or idx > 16384:
                fail('INVALID')
            last = idx
            if boundaries[idx]:
                continue
            kind = cell.get('t', 'n')
            raw = cell.findtext(SHEET + 'v', '')
            if kind == 's':
                if not raw.isascii() or not raw.isdigit() or int(raw) >= len(strings):
                    fail('INVALID')
                field = strings[int(raw)]
            elif kind == 'inlineStr':
                field = rich(cell.find(SHEET + 'is'))
            elif kind in ('n', 'd', 'str', 'b'):
                field = value(raw)
            else:
                fail('UNSUPPORTED_CELL')
            if field:
                row_size += len(field.encode()) + idx - len(parts)
                if row_size > MAX_INPUT + 1:
                    fail('LIMIT')
                parts.extend([''] * (idx - len(parts) - 1))
                parts.append(field)
        if parts:
            yield '\t'.join(parts)


def extract(data):
    if len(data) > MAX_INPUT:
        fail('LIMIT')
    trees, scan = read_package(data)
    if sum(len(s.encode()) + 1 for s in scan) > MAX_SCAN:
        fail('LIMIT')
    if '[Content_Types].xml' not in trees:
        fail('INVALID')
    workbook = trees['xl/workbook.xml']
    rels = trees['xl/_rels/workbook.xml.rels']
    if workbook.tag != SHEET + 'workbook' or rels.tag != REL + 'Relationships':
        fail('INVALID')
    relationships = {r.attrib['Id']: r for r in rels.findall(REL + 'Relationship')}
    strings = []
    if 'xl/sharedStrings.xml' in trees:
        strings = [rich(si) for si in trees['xl/sharedStrings.xml'].findall(SHEET + 'si')]
    sheets = workbook.findall(SHEET + 'sheets/' + SHEET + 'sheet')
    if not sheets or len(sheets) > 32:
        fail('LIMIT')
    tables = []
    used = set()
    length = count = 0
    for sheet in sheets:
        rel = relationships[sheet.attrib['{' + OFFICE + '}id']]
        target = rel.attrib['Target']
        path = posixpath.normpath(posixpath.join('xl', target)).lstrip('/')
        if (rel.get('Type') != OFFICE + '/worksheet' or not path.startswith('xl/worksheets/')
                or path in used or path not in trees):
            fail('INVALID')
        used.add(path)
        tree = trees[path]
        count += sum(1 for _ in tree.iter(SHEET + 'c'))
        if count > MAX_CELLS:
            fail('LIMIT')
        if sheet.get('state', 'visible') != 'visible':
            continue
        rows = []
        for row in sheet_rows(tree, strings):
            length += len(row.encode()) + 1
            if length > MAX_INPUT + 1:
                fail('LIMIT')
            rows.append(row)
        if rows:
            tables.append('\n'.join(rows))
    text = '\n\n'.join(tables)
    if len(text.encode()) > MAX_INPUT:
        fail('LIMIT')
    if not text.strip():
        fail('EMPTY')
    return {'text': text, 'scanText': '\n'.join(scan)}


if __name__ == '__main__':
    try:
        result = extract(sys.stdin.buffer.read(MAX_INPUT + 1))
        print(json.dumps(result, ensure_ascii=False))
    except WorkbookError as exc:
        sys.exit(str(exc))
    except (BadZipFile, ValueError, OverflowError, KeyError, RuntimeError, ET.ParseError,
            EOFError, ZlibError, NotImplementedError, OSError):
        sys.exit('INBOX_XLSX_INVALID')
