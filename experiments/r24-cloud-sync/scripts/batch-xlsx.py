"""Write one OOXML worksheet from a validated array of rows on stdin."""
import json
import sys
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


def write_workbook(filename, table):
    main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    relationships = 'http://schemas.openxmlformats.org/package/2006/relationships'
    office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    content = 'application/vnd.openxmlformats-officedocument.spreadsheetml'

    with ZipFile(filename, 'x', compression=ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            f'<Override PartName="/xl/workbook.xml" ContentType="{content}.sheet.main+xml"/>'
            f'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="{content}.worksheet+xml"/></Types>')
        archive.writestr('_rels/.rels',
            f'<Relationships xmlns="{relationships}"><Relationship Id="rId1" Type="{office}/officeDocument" '
            'Target="xl/workbook.xml"/></Relationships>')
        archive.writestr('xl/workbook.xml',
            f'<workbook xmlns="{main}" xmlns:r="{office}"><sheets><sheet name="练播作业" sheetId="1" '
            'r:id="rId1"/></sheets></workbook>')
        archive.writestr('xl/_rels/workbook.xml.rels',
            f'<Relationships xmlns="{relationships}"><Relationship Id="rId1" Type="{office}/worksheet" '
            'Target="worksheets/sheet1.xml"/></Relationships>')
        widths = [49, 82, 50, 18, 16, 13]
        columns = ''.join(f'<col min="{i}" max="{i}" width="{width}" customWidth="1"/>'
                          for i, width in enumerate(widths, 1))
        parts = [f'<worksheet xmlns="{main}"><dimension ref="A1:F{len(table)}"/>'
                 f'<cols>{columns}</cols><sheetData>']
        for number, row in enumerate(table, 1):
            parts.append(f'<row r="{number}">')
            for letter, text in zip('ABCDEF', row, strict=True):
                parts.append(f'<c r="{letter}{number}" t="inlineStr"><is><t>{escape(text)}</t></is></c>')
            parts.append('</row>')
        parts.append('</sheetData></worksheet>')
        archive.writestr('xl/worksheets/sheet1.xml', ''.join(parts))


if __name__ == '__main__':
    write_workbook(sys.argv[1], json.load(sys.stdin))
