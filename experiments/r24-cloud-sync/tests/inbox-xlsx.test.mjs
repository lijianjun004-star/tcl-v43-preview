import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { extractXlsx } from '../scripts/inbox-xlsx.mjs';

const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pack = 'http://schemas.openxmlformats.org/package/2006/relationships';
const syntheticContact = ['sample', '@', 'example.invalid'].join('');

function zip(parts) {
  const program = [
    'import io,json,sys,zipfile',
    'out=io.BytesIO()',
    'with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:',
    '    for name, content in json.load(sys.stdin).items(): z.writestr(name,content.encode())',
    'sys.stdout.buffer.write(out.getvalue())',
  ].join('\n');
  return execFileSync('python3', ['-I', '-c', program], { input: JSON.stringify(parts) });
}

function workbook() {
  const inline = (ref, text) => '<c r="' + ref + '" t="inlineStr"><is><t>' + text + '</t></is></c>';
  return {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': '<workbook xmlns="' + main + '" xmlns:r="' + office + '"><sheets>' +
      '<sheet name="可见" sheetId="4" r:id="r1"/><sheet name="另一个" sheetId="1" r:id="r2"/>' +
      '<sheet name="隐藏" state="hidden" sheetId="3" r:id="r3"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase">可见!$A$1:$C$3</definedName></definedNames></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="' + pack + '">' +
      [3, 1, 2].map((id, i) => '<Relationship Type="' + office + '/worksheet" Id="r' + (i + 1) +
        '" Target="/xl/worksheets/sheet' + id + '.xml"/>').join('') + '</Relationships>',
    'xl/worksheets/sheet3.xml': '<worksheet xmlns="' + main + '"><cols><col min="2" max="2" hidden="true"/></cols>' +
      '<sheetData><row>' + inline('A1', 'category: 电视') + '</row><row>' +
      '<c t="s" r="A2"><v>1</v></c>' + inline('B2', '隐藏列') + '<c r="C2"><v>98</v></c></row>' +
      '<row hidden="1">' + inline('A3', '隐藏行') + '</row></sheetData></worksheet>',
    'xl/worksheets/sheet1.xml': '<worksheet xmlns="' + main + '"><sheetData><row>' +
      inline('A1', '选购&amp;送装') + '</row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet xmlns="' + main + '"><sheetData><row>' +
      inline('A1', '隐藏工作表文本') + '<c r="B1"><v>1.38E10</v></c></row></sheetData></worksheet>',
    'xl/sharedStrings.xml': '<sst xmlns="' + main + '"><si><r><t>sample</t></r><r><t>@example.invalid</t></r>' +
      '</si><si><r><t>大屏</t></r><r><t>电视</t></r></si></sst>',
  };
}

test('reads all visible sheets in workbook order, shared/inline text and numeric cells', () => {
  const { text, scanText } = extractXlsx(zip(workbook()));
  assert.equal(text, 'category: 电视\n大屏电视\t\t98\n\n选购&送装');
  for (const entry of [syntheticContact, '隐藏列', '隐藏行', '隐藏工作表文本', '13800000000']) {
    assert.ok(scanText.includes(entry));
    assert.ok(!text.includes(entry));
  }
});

test('rejects formulas, external relationships, embedded binaries and invalid cell references', () => {
  for (const [code, edit] of [
    ['FORMULA', p => { p['xl/worksheets/sheet3.xml'] = p['xl/worksheets/sheet3.xml'].replace('<v>98', '<f>1+1</f><v>98'); }],
    ['EXTERNAL_LINK', p => { p['xl/_rels/workbook.xml.rels'] = p['xl/_rels/workbook.xml.rels'].replace('<Relationship Type', '<Relationship TargetMode="External" Type'); }],
    ['UNSUPPORTED_PART', p => { p['xl/vbaProject.bin'] = 'placeholder'; }],
    ['INVALID', p => { p['xl/worksheets/sheet3.xml'] = p['xl/worksheets/sheet3.xml'].replace('>1</v>', '>999</v>'); }],
    ['UNSUPPORTED_XML', p => { p['xl/sharedStrings.xml'] = '<!DOCTYPE sst>' + p['xl/sharedStrings.xml']; }],
  ]) {
    const parts = workbook();
    edit(parts);
    assert.throws(() => extractXlsx(zip(parts)), { code: 'INBOX_XLSX_' + code, message: 'INBOX_XLSX_' + code });
  }
});

test('rejects oversize, excessive inflated data and shared string expansion without truncating', () => {
  assert.throws(() => extractXlsx(Buffer.alloc(102401)), { code: 'INBOX_XLSX_LIMIT' });
  const inflated = workbook();
  inflated['docProps/app.xml'] = 'a'.repeat(4 * 1024 * 1024);
  assert.throws(() => extractXlsx(zip(inflated)), { code: 'INBOX_XLSX_LIMIT' });
  const repeated = workbook();
  repeated['xl/sharedStrings.xml'] = repeated['xl/sharedStrings.xml'].replace('大屏', 'a'.repeat(65000));
  repeated['xl/worksheets/sheet3.xml'] = repeated['xl/worksheets/sheet3.xml'].replace('<c r="C2"><v>98', '<c r="C2" t="s"><v>1');
  assert.throws(() => extractXlsx(zip(repeated)), { code: 'INBOX_XLSX_LIMIT' });
});
