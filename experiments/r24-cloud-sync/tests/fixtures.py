"""Create a synthetic three-question Excel assignment for browser tests."""
from sys import argv
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape


def make_rows():
    rows = [['题目', '参考答案', '型号', 'SKU', '评分要点']]
    for index in range(1, 4):
        rows.append([
            f'请介绍 TEST-A{index} 的合成测试功能？',
            f'合成参考答案{index}，应说明测试信息。',
            f'TEST-A{index}', f'{index:06d}', '合成测试；信息核对',
        ])
    return rows


def sheet_xml():
    rows = []
    for row_index, columns in enumerate(make_rows(), 1):
        cells = []
        for column, value in zip('ABCDE', columns):
            cells.append(
                f'<c r="{column}{row_index}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
            )
        rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    return (
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(rows)}</sheetData></worksheet>'
    )


with ZipFile(argv[1], 'w', ZIP_DEFLATED) as archive:
    archive.writestr('[Content_Types].xml', '''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>''')
    archive.writestr('_rels/.rels', '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>''')
    archive.writestr('xl/workbook.xml', '''<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="运营原样作业" sheetId="1" r:id="rId1"/></sheets>
</workbook>''')
    archive.writestr('xl/_rels/workbook.xml.rels', '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/>
</Relationships>''')
    archive.writestr('xl/worksheets/sheet1.xml', sheet_xml())
