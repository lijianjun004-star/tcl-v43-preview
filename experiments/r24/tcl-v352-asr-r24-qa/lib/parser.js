// Local browser file parser for DOCX, XLSX, XLS, text-based PDF, UTF-8 TXT, and legacy JSON.
// Never uploads raw files to Gemini or external servers. Releases temporary buffers after extraction.

import { readZipEntries } from './zip.js';
import { parseXlsBuffer, isOle2Magic, parseCfbStreams } from './xls.js';
import { parsePdfBuffer } from './pdf.js';

export const PARSER_DEPENDENCY_MANIFEST = [
  {
    module: 'src/files/zip.js',
    purpose: 'ZIP / Deflate (RFC1951) 本地解压与防压缩炸弹保护（用于 DOCX/XLSX）',
    version: '4.3.0-local',
    license: 'MIT',
    offlineCapable: true
  },
  {
    module: 'src/files/xls.js',
    purpose: 'OLE2 Compound File Binary + BIFF8 本地解析（用于 XLS 与旧版 DOC 识别阻断）',
    version: '4.3.0-local',
    license: 'MIT',
    offlineCapable: true
  },
  {
    module: 'src/files/pdf.js',
    purpose: 'PDF FlateDecode + ToUnicode CMap + BT/ET 文本流提取与扫描件检测',
    version: '4.3.0-local',
    license: 'MIT',
    offlineCapable: true
  }
];

function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

function extractWordParagraphText(pXml) {
  let out = '';
  const tokenRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br(?:\s+[^>]*)?\/>/g;
  let m;
  while ((m = tokenRegex.exec(pXml)) !== null) {
    if (m[0].startsWith('<w:tab')) out += '\t';
    else if (m[0].startsWith('<w:br')) out += '\n';
    else out += decodeXmlEntities(m[1]);
  }
  return out.trim();
}

export async function parseDocxBuffer(buffer, fileName) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (isOle2Magic(bytes)) {
    throw new Error('该文件实为旧版二进制 .doc 格式（非标准 .docx），请在 Word 或 WPS 中「另存为 .docx」后再上传');
  }
  const zip = await readZipEntries(bytes);
  const docXml = await zip.extractText('word/document.xml');
  if (!docXml) {
    throw new Error('无效的 DOCX 文件：缺少 word/document.xml 正文结构');
  }

  const bodyMatch = docXml.match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/);
  const contentXml = bodyMatch ? bodyMatch[1] : docXml;

  const blocks = [];
  let paraIndex = 0;
  let tableIndex = 0;

  // Match top-level tables and paragraphs in document order
  const blockRegex = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g;
  let bm;
  while ((bm = blockRegex.exec(contentXml)) !== null) {
    const chunk = bm[0];
    if (chunk.startsWith('<w:tbl')) {
      tableIndex++;
      const rows = [];
      const rowRegex = /<w:tr\b[\s\S]*?<\/w:tr>/g;
      let rm, rowNo = 0;
      while ((rm = rowRegex.exec(chunk)) !== null) {
        rowNo++;
        const cells = [];
        const cellRegex = /<w:tc\b[\s\S]*?<\/w:tc>/g;
        let cm;
        while ((cm = cellRegex.exec(rm[0])) !== null) {
          const cellParas = [];
          const pRegex = /<w:p\b[\s\S]*?<\/w:p>/g;
          let pm;
          while ((pm = pRegex.exec(cm[0])) !== null) {
            const t = extractWordParagraphText(pm[0]);
            if (t) cellParas.push(t);
          }
          cells.push(cellParas.join('\n').trim());
        }
        if (cells.some(Boolean)) {
          rows.push({
            locator: `${fileName} · 表格#${tableIndex} 第${rowNo}行`,
            rowNumber: rowNo,
            cells
          });
        }
      }
      if (rows.length) {
        blocks.push({ kind: 'table', tableIndex, rows });
      }
    } else {
      paraIndex++;
      const text = extractWordParagraphText(chunk);
      if (text) {
        blocks.push({
          kind: 'paragraph',
          locator: `${fileName} · 第${paraIndex}段`,
          lineNumber: paraIndex,
          text
        });
      }
    }
  }

  if (!blocks.length) {
    throw new Error('DOCX 文档中未读取到任何有效文字或表格内容');
  }
  return { format: 'docx', fileName, blocks };
}

function colLettersToIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
}

export async function parseXlsxBuffer(buffer, fileName) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const zip = await readZipEntries(bytes);
  if (!zip.has('xl/workbook.xml')) {
    throw new Error('无效的 XLSX 文件：缺少 xl/workbook.xml');
  }

  const sharedStrings = [];
  if (zip.has('xl/sharedStrings.xml')) {
    const sstXml = await zip.extractText('xl/sharedStrings.xml');
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let sim;
    while ((sim = siRegex.exec(sstXml)) !== null) {
      let text = '';
      const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g;
      let tm;
      while ((tm = tRegex.exec(sim[1])) !== null) {
        text += decodeXmlEntities(tm[1]);
      }
      sharedStrings.push(text.trim());
    }
  }

  const wbXml = await zip.extractText('xl/workbook.xml');
  const sheetNames = [];
  const sheetRegex = /<sheet\b[^>]*name="([^"]+)"[^>]*\/?>/g;
  let sm;
  while ((sm = sheetRegex.exec(wbXml)) !== null) {
    sheetNames.push(decodeXmlEntities(sm[1]));
  }

  const worksheetEntries = zip.list()
    .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/sheet(\d+)/i)?.[1] || '0', 10);
      const nb = parseInt(b.match(/sheet(\d+)/i)?.[1] || '0', 10);
      return na - nb;
    });

  if (!worksheetEntries.length) {
    throw new Error('XLSX 文件中未找到工作表数据');
  }

  const blocks = [];
  for (let sIdx = 0; sIdx < worksheetEntries.length; sIdx++) {
    const entryName = worksheetEntries[sIdx];
    const sheetName = sheetNames[sIdx] || `Sheet${sIdx + 1}`;
    const sheetXml = await zip.extractText(entryName);
    const rows = [];
    const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
    let rm, fallbackRow = 0;
    while ((rm = rowRegex.exec(sheetXml)) !== null) {
      fallbackRow++;
      const rAttr = rm[1].match(/\br="(\d+)"/);
      const rowNo = rAttr ? parseInt(rAttr[1], 10) : fallbackRow;
      const cells = [];
      const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm, nextCol = 0;
      while ((cm = cellRegex.exec(rm[2])) !== null) {
        const cAttrs = cm[1] || '';
        const cBody = cm[2] || '';
        const refMatch = cAttrs.match(/\br="([A-Z]+)\d+"/);
        const colIdx = refMatch ? colLettersToIndex(refMatch[1]) : nextCol;
        nextCol = colIdx + 1;
        const typeMatch = cAttrs.match(/\bt="([^"]+)"/);
        const cType = typeMatch ? typeMatch[1] : '';
        let val = '';
        if (cType === 'inlineStr') {
          const tMatches = Array.from(cBody.matchAll(/<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g));
          val = tMatches.map(x => decodeXmlEntities(x[1])).join('');
        } else {
          const vMatch = cBody.match(/<v[^>]*>([\s\S]*?)<\/v>/);
          if (vMatch) {
            const rawV = decodeXmlEntities(vMatch[1]).trim();
            if (cType === 's') {
              val = sharedStrings[parseInt(rawV, 10)] ?? '';
            } else {
              val = rawV;
            }
          }
        }
        while (cells.length <= colIdx) cells.push('');
        cells[colIdx] = String(val ?? '').trim();
      }
      if (cells.some(Boolean)) {
        rows.push({
          locator: `${fileName} · 工作表「${sheetName}」第${rowNo}行`,
          rowNumber: rowNo,
          cells
        });
      }
    }
    if (rows.length) {
      blocks.push({ kind: 'table', sheetName, rows });
    }
  }

  if (!blocks.length) {
    throw new Error('XLSX 工作簿中没有任何非空单元格内容');
  }
  return { format: 'xlsx', fileName, blocks };
}

function parseCsvTable(text, delimiter) {
  const rows=[];let row=[],field='',inQuote=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(inQuote){
      if(c==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(c==='"')inQuote=false;
      else field+=c;
    }else if(c==='"'){inQuote=true;}
    else if(c===delimiter){row.push(field.trim());field='';}
    else if(c==='\r'||c==='\n'){
      if(c==='\r'&&text[i+1]==='\n')i++;
      row.push(field.trim());field='';
      if(row.some(Boolean)) rows.push({rowNumber:rows.length+1,locator:`表格第${rows.length+1}行`,cells:row});
      row=[];
    }else field+=c;
  }
  if(inQuote)throw new Error('CSV 引号没有正确闭合');
  row.push(field.trim());if(row.some(Boolean))rows.push({rowNumber:rows.length+1,locator:`表格第${rows.length+1}行`,cells:row});
  return rows;
}

export async function parseDocumentFile(inputFile) {
  const fileName = String(inputFile?.name || '未命名文件').trim();
  const lower = fileName.toLowerCase();
  const ext = lower.includes('.') ? '.' + lower.split('.').pop() : '';

  // Reject unsupported media/image/OCR/legacy .doc explicitly
  if (ext === '.doc') {
    throw new Error('不支持旧版二进制 .doc 格式，请在 Word 或 WPS 中「另存为 .docx」后再导入（严禁伪称兼容 .doc）');
  }
  if (['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tiff', '.mp3', '.wav', '.mp4', '.mov', '.webm'].includes(ext)) {
    throw new Error(`不支持图片 OCR 或音视频题目文件（${ext}），请上传 DOCX、XLSX、XLS、可复制文本 PDF 或 UTF-8 TXT 文件`);
  }
  if (!['.docx', '.xlsx', '.xls', '.pdf', '.txt', '.json', '.csv', '.tsv'].includes(ext)) {
    throw new Error(`不支持的文件格式（${ext || '无扩展名'}）。仅支持 .docx、.xlsx、.xls、可复制文本 .pdf、.txt、.csv、.tsv、.json`);
  }

  // Acquire bytes without retaining original Blob reference
  let arrayBuffer;
  if (inputFile instanceof Uint8Array) {
    arrayBuffer = inputFile.buffer.slice(inputFile.byteOffset, inputFile.byteOffset + inputFile.byteLength);
  } else if (inputFile instanceof ArrayBuffer) {
    arrayBuffer = inputFile;
  } else if (typeof inputFile?.arrayBuffer === 'function') {
    arrayBuffer = await inputFile.arrayBuffer();
  } else if (typeof inputFile?.text === 'function') {
    const txt = await inputFile.text();
    arrayBuffer = new TextEncoder().encode(txt).buffer;
  } else {
    throw new Error('无法读取上传文件数据');
  }

  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.byteLength === 0) {
    throw new Error('上传的文件为空（0 字节）');
  }
  if (bytes.byteLength > 15 * 1024 * 1024) {
    throw new Error('单个文件不得超过 15 MB，请拆分后导入');
  }

  if (ext === '.docx') {
    return await parseDocxBuffer(bytes, fileName);
  }
  if (ext === '.xlsx') {
    return await parseXlsxBuffer(bytes, fileName);
  }
  if (ext === '.xls') {
    const sheets = parseXlsBuffer(bytes);
    const blocks = sheets
      .filter(s => s.rows.length > 0)
      .map(s => ({
        kind: 'table',
        sheetName: s.name,
        rows: s.rows.map(r => ({
          locator: `${fileName} · 工作表「${s.name}」第${r.rowNumber}行`,
          rowNumber: r.rowNumber,
          cells: r.cells
        }))
      }));
    if (!blocks.length) throw new Error('XLS 文件中未提取到有效行数据');
    return { format: 'xls', fileName, blocks };
  }
  if (ext === '.pdf') {
    const pages = parsePdfBuffer(bytes);
    const blocks = [];
    for (const p of pages) {
      p.lines.forEach((line, idx) => {
        blocks.push({
          kind: 'paragraph',
          locator: `${fileName} · 第${p.pageNumber}页 第${idx + 1}行`,
          pageNumber: p.pageNumber,
          lineNumber: idx + 1,
          text: line
        });
      });
    }
    return { format: 'pdf', fileName, blocks };
  }
  if (ext === '.txt' || ext === '.json' || ext === '.csv' || ext === '.tsv') {
    if (bytes.byteLength > 2 * 1024 * 1024) {
      throw new Error('文本文件不得超过 2 MB，请分段导入');
    }
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
    } catch {
      throw new Error('TXT/JSON 文件不是有效的 UTF-8 编码，请另存为 UTF-8 编码后重试');
    }
    if (!text.trim()) throw new Error('文件没有可读取的文字');
    if (ext === '.csv' || ext === '.tsv') {
      return { format:ext.slice(1), fileName, blocks:[{kind:'table',rows:parseCsvTable(text,ext === '.tsv' ? '\t':',')}] };
    }
    if (ext === '.json') {
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('JSON 格式错误，无法解析');
      }
      return { format: 'json', fileName, jsonData: data, blocks: [] };
    }
    const blocks = text.split(/\r?\n/).map((line, i) => ({
      kind: 'paragraph',
      locator: `${fileName} · 第${i + 1}行`,
      lineNumber: i + 1,
      text: line.trim()
    })).filter(b => b.text);
    return { format: 'txt', fileName, blocks };
  }

  throw new Error('未知文件类型');
}
