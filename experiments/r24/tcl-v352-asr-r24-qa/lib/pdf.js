// Pure-JS text-based PDF parser with /FlateDecode decompression, /ToUnicode CMap decoding,
// BT..ET text operator extraction, and explicit scanned/image-only PDF detection.

import { inflateZlibSync } from './zip.js';

function decodePdfLiteralString(raw) {
  const bytes = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\') {
      i++;
      if (i >= raw.length) break;
      const next = raw[i];
      if (next === 'n') bytes.push(10);
      else if (next === 'r') bytes.push(13);
      else if (next === 't') bytes.push(9);
      else if (next === 'b') bytes.push(8);
      else if (next === 'f') bytes.push(12);
      else if (next === '(' || next === ')' || next === '\\') bytes.push(next.charCodeAt(0));
      else if (next >= '0' && next <= '7') {
        let oct = next;
        if (i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
        if (i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7') oct += raw[++i];
        bytes.push(parseInt(oct, 8) & 0xff);
      } else if (next === '\r' || next === '\n') {
        if (next === '\r' && raw[i + 1] === '\n') i++;
      } else {
        bytes.push(next.charCodeAt(0));
      }
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function decodeHexBytes(hexStr) {
  const clean = hexStr.replace(/\s+/g, '');
  const padded = clean.length % 2 === 1 ? clean + '0' : clean;
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < padded.length; i += 2) {
    out[i / 2] = parseInt(padded.slice(i, i + 2), 16) || 0;
  }
  return out;
}

function bytesToUnicodeString(bytes, cmap) {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return s;
  }
  if (cmap && cmap.size > 0) {
    if (cmap.twoByte && bytes.length >= 2 && bytes.length % 2 === 0) {
      let s = '';
      let matched = 0;
      for (let i = 0; i < bytes.length; i += 2) {
        const code = (bytes[i] << 8) | bytes[i + 1];
        const mapped = cmap.get(code);
        if (mapped !== undefined) {
          s += mapped;
          matched++;
        } else {
          s += String.fromCharCode(code);
        }
      }
      if (matched > 0) return s;
    }
    let s = '';
    let matched = 0;
    for (let i = 0; i < bytes.length; i++) {
      const mapped = cmap.get(bytes[i]);
      if (mapped !== undefined) {
        s += mapped;
        matched++;
      } else {
        s += String.fromCharCode(bytes[i]);
      }
    }
    if (matched > 0) return s;
  }
  // Try UTF-8 decoding first if valid non-ASCII UTF-8 sequences exist
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return utf8;
  } catch {}
  let latin = '';
  for (let i = 0; i < bytes.length; i++) latin += String.fromCharCode(bytes[i]);
  return latin;
}

function parseToUnicodeCMap(text, cmap) {
  const hexToStr = hex => {
    const b = decodeHexBytes(hex);
    let s = '';
    if (b.length >= 2 && b.length % 2 === 0) {
      for (let i = 0; i < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
    } else {
      for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    }
    return s;
  };

  const bfcharRegex = /beginbfchar([\s\S]*?)endbfchar/g;
  let m;
  while ((m = bfcharRegex.exec(text)) !== null) {
    const pairRegex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let pm;
    while ((pm = pairRegex.exec(m[1])) !== null) {
      if (pm[1].length > 2) cmap.twoByte = true;
      cmap.set(parseInt(pm[1], 16), hexToStr(pm[2]));
    }
  }

  const bfrangeRegex = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = bfrangeRegex.exec(text)) !== null) {
    const rangeRegex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
    let rm;
    while ((rm = rangeRegex.exec(m[1])) !== null) {
      if (rm[1].length > 2) cmap.twoByte = true;
      const start = parseInt(rm[1], 16);
      const end = parseInt(rm[2], 16);
      if (rm[3]) {
        let targetCode = parseInt(rm[3], 16);
        for (let c = start; c <= end && c - start < 4096; c++) {
          cmap.set(c, String.fromCodePoint(targetCode++));
        }
      } else if (rm[4]) {
        const items = Array.from(rm[4].matchAll(/<([0-9A-Fa-f]+)>/g)).map(x => hexToStr(x[1]));
        for (let idx = 0; idx < items.length && start + idx <= end; idx++) {
          cmap.set(start + idx, items[idx]);
        }
      }
    }
  }
}

function extractTextFromContentStream(streamText, cmap) {
  const lines = [];
  const btEtRegex = /BT([\s\S]*?)ET/g;
  let m;
  while ((m = btEtRegex.exec(streamText)) !== null) {
    const block = m[1];
    let currentLine = '';
    const tokenRegex = /(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\[(?:[\s\S]*?)\])\s*(Tj|TJ|'|")|(T\*|Td|TD|Tm)/g;
    let tm;
    while ((tm = tokenRegex.exec(block)) !== null) {
      if (tm[3]) {
        if (currentLine.trim()) {
          lines.push(currentLine.trim());
          currentLine = '';
        }
        continue;
      }
      const operand = tm[1];
      const op = tm[2];
      if (op === "'" || op === '"') {
        if (currentLine.trim()) {
          lines.push(currentLine.trim());
          currentLine = '';
        }
      }
      if (operand.startsWith('(')) {
        const rawBytes = decodePdfLiteralString(operand.slice(1, -1));
        currentLine += bytesToUnicodeString(rawBytes, cmap);
      } else if (operand.startsWith('<')) {
        const rawBytes = decodeHexBytes(operand.slice(1, -1));
        currentLine += bytesToUnicodeString(rawBytes, cmap);
      } else if (operand.startsWith('[')) {
        const inner = operand.slice(1, -1);
        const subRegex = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|-?\d+(?:\.\d+)?/g;
        let sm;
        while ((sm = subRegex.exec(inner)) !== null) {
          const tok = sm[0];
          if (tok.startsWith('(')) {
            currentLine += bytesToUnicodeString(decodePdfLiteralString(tok.slice(1, -1)), cmap);
          } else if (tok.startsWith('<')) {
            currentLine += bytesToUnicodeString(decodeHexBytes(tok.slice(1, -1)), cmap);
          } else {
            const kerning = parseFloat(tok);
            if (kerning < -180) currentLine += ' ';
          }
        }
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
  }
  return lines;
}

export function parsePdfBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 8) throw new Error('PDF 文件过小或已损坏');
  const latin1 = new TextDecoder('latin1').decode(bytes);
  if (!latin1.startsWith('%PDF-')) {
    throw new Error('不是有效的 PDF 文件（缺少 %PDF- 文件头）');
  }
  if (/\/Encrypt\b/.test(latin1)) {
    throw new Error('不支持受密码加密保护的 PDF 文件，请先解除密码保护');
  }

  const hasImages = /\/Subtype\s*\/Image\b/.test(latin1);
  const cmap = new Map();
  cmap.twoByte = false;

  // Collect all objects & decode streams
  const decodedStreams = [];
  const objRegex = /(\d+)\s+(\d+)\s+obj([\s\S]*?)endobj/g;
  let om;
  while ((om = objRegex.exec(latin1)) !== null) {
    const objNum = Number(om[1]);
    const body = om[3];
    const streamIdx = body.indexOf('stream');
    if (streamIdx < 0) continue;
    const dictPart = body.slice(0, streamIdx);
    // Avoid matching 'endstream'
    let dataStart = streamIdx + 6;
    if (body[dataStart] === '\r' && body[dataStart + 1] === '\n') dataStart += 2;
    else if (body[dataStart] === '\n' || body[dataStart] === '\r') dataStart += 1;
    const endStreamIdx = body.lastIndexOf('endstream');
    if (endStreamIdx <= dataStart) continue;

    const absStart = om.index + om[0].indexOf('stream') + (dataStart - streamIdx);
    let absEnd = om.index + om[0].lastIndexOf('endstream');
    while (absEnd > absStart && (bytes[absEnd - 1] === 0x0a || bytes[absEnd - 1] === 0x0d)) absEnd--;
    const rawSlice = bytes.subarray(absStart, absEnd);

    let decodedBytes = rawSlice;
    if (/\/Filter\s*(?:\[\s*)?\/FlateDecode\b/.test(dictPart)) {
      try {
        decodedBytes = inflateZlibSync(rawSlice);
      } catch {
        continue;
      }
    }
    const decodedLatin = new TextDecoder('latin1').decode(decodedBytes);
    if (decodedLatin.includes('beginbfchar') || decodedLatin.includes('beginbfrange')) {
      parseToUnicodeCMap(decodedLatin, cmap);
    }
    decodedStreams.push({ objNum, dictPart, decodedLatin });
  }

  const pages = [];
  let pageNo = 1;
  for (const s of decodedStreams) {
    if (s.decodedLatin.includes('BT') && s.decodedLatin.includes('ET')) {
      const lines = extractTextFromContentStream(s.decodedLatin, cmap)
        .flatMap(l => l.split(/\r?\n/))
        .map(l => l.trim())
        .filter(Boolean);
      if (lines.length > 0) {
        pages.push({ pageNumber: pageNo++, lines });
      }
    }
  }

  const totalChars = pages.reduce((acc, p) => acc + p.lines.join('').length, 0);
  if (totalChars === 0) {
    if (hasImages) {
      throw new Error('检测到扫描版或纯图片 PDF（无可复制文字层），本阶段不支持图片 OCR 解析，请上传可复制文本的 PDF、Word (.docx) 或 Excel 文件');
    }
    throw new Error('PDF 文件中未提取到可复制文本内容，请确认是否为文字型 PDF');
  }

  return pages;
}
