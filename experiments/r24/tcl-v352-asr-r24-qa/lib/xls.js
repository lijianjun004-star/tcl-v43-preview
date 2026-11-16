// Pure-JS parser for legacy Excel (.xls) files (OLE2 Compound File Binary + BIFF8 Workbook stream, plus XML/HTML table .xls).
// Also detects OLE2 WordDocument (.doc) to give an explicit conversion message without false compatibility claims.

export function isOle2Magic(bytes) {
  return bytes.byteLength >= 8 &&
    bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 && bytes[5] === 0xb1 && bytes[6] === 0x1a && bytes[7] === 0xe1;
}

export function parseCfbStreams(bytes) {
  if (!isOle2Magic(bytes)) throw new Error('不是有效的 OLE2 复合文档');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectorShift = view.getUint16(30, true);
  const miniSectorShift = view.getUint16(32, true);
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniSectorShift;
  const numFatSectors = view.getUint32(44, true);
  const firstDirSector = view.getUint32(48, true);
  const miniStreamCutoff = view.getUint32(56, true);
  const firstMiniFatSector = view.getUint32(60, true);
  const numMiniFatSectors = view.getUint32(64, true);
  const firstDifatSector = view.getUint32(68, true);
  const numDifatSectors = view.getUint32(72, true);

  const sectorOffset = secId => (secId + 1) * sectorSize;
  const difat = [];
  for (let i = 0; i < 109 && difat.length < numFatSectors; i++) {
    const sec = view.getUint32(76 + i * 4, true);
    if (sec < 0xfffffffe) difat.push(sec);
  }
  let difatSec = firstDifatSector;
  for (let n = 0; n < numDifatSectors && difatSec < 0xfffffffe; n++) {
    const off = sectorOffset(difatSec);
    if (off + sectorSize > bytes.byteLength) break;
    const entriesPerSector = (sectorSize / 4) - 1;
    for (let i = 0; i < entriesPerSector && difat.length < numFatSectors; i++) {
      const sec = view.getUint32(off + i * 4, true);
      if (sec < 0xfffffffe) difat.push(sec);
    }
    difatSec = view.getUint32(off + sectorSize - 4, true);
  }

  const fat = [];
  for (const fatSec of difat) {
    const off = sectorOffset(fatSec);
    if (off + sectorSize > bytes.byteLength) break;
    for (let i = 0; i < sectorSize; i += 4) {
      fat.push(view.getUint32(off + i, true));
    }
  }

  const readSectorChain = (startSec, maxBytes = 15 * 1024 * 1024) => {
    const chunks = [];
    let total = 0;
    let sec = startSec;
    const visited = new Set();
    while (sec < 0xfffffffe && sec < fat.length) {
      if (visited.has(sec)) throw new Error('OLE2 扇区链循环引用，文件已损坏');
      visited.add(sec);
      const off = sectorOffset(sec);
      if (off + sectorSize > bytes.byteLength) break;
      chunks.push(bytes.subarray(off, off + sectorSize));
      total += sectorSize;
      if (total > maxBytes) throw new Error('OLE2 流大小超出安全上限');
      sec = fat[sec];
    }
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.byteLength; }
    return out;
  };

  const dirBytes = readSectorChain(firstDirSector);
  const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  const entries = [];
  for (let off = 0; off + 128 <= dirBytes.byteLength; off += 128) {
    const nameLen = dirView.getUint16(off + 64, true);
    const type = dirBytes[off + 66];
    if (type === 0 || nameLen < 2) continue;
    let name = '';
    for (let i = 0; i < nameLen - 2; i += 2) {
      name += String.fromCharCode(dirView.getUint16(off + i, true));
    }
    const startSec = dirView.getUint32(off + 116, true);
    const size = dirView.getUint32(off + 120, true);
    entries.push({ name, type, startSec, size });
  }

  const rootEntry = entries.find(e => e.type === 5) || entries[0];
  let miniFat = [];
  if (numMiniFatSectors > 0 && firstMiniFatSector < 0xfffffffe) {
    const mfBytes = readSectorChain(firstMiniFatSector);
    const mfView = new DataView(mfBytes.buffer, mfBytes.byteOffset, mfBytes.byteLength);
    for (let i = 0; i < mfBytes.byteLength; i += 4) miniFat.push(mfView.getUint32(i, true));
  }
  const miniStreamBytes = rootEntry && rootEntry.startSec < 0xfffffffe ? readSectorChain(rootEntry.startSec) : new Uint8Array(0);

  const readEntryStream = entry => {
    if (!entry || entry.size === 0) return new Uint8Array(0);
    if (entry.size < miniStreamCutoff && miniStreamBytes.byteLength > 0 && miniFat.length > 0) {
      const out = new Uint8Array(entry.size);
      let pos = 0, mSec = entry.startSec;
      const visited = new Set();
      while (mSec < 0xfffffffe && pos < entry.size) {
        if (visited.has(mSec)) break;
        visited.add(mSec);
        const mOff = mSec * miniSectorSize;
        const copyLen = Math.min(miniSectorSize, entry.size - pos);
        if (mOff + copyLen > miniStreamBytes.byteLength) break;
        out.set(miniStreamBytes.subarray(mOff, mOff + copyLen), pos);
        pos += copyLen;
        mSec = miniFat[mSec] ?? 0xfffffffe;
      }
      return out;
    }
    const full = readSectorChain(entry.startSec);
    return full.subarray(0, Math.min(entry.size, full.byteLength));
  };

  return {
    entries,
    hasStream: name => entries.some(e => e.name.toLowerCase() === name.toLowerCase()),
    getStream: name => {
      const found = entries.find(e => e.name.toLowerCase() === name.toLowerCase());
      return found ? readEntryStream(found) : null;
    }
  };
}

function decodeBiff8String(chunks, state) {
  const ensureChunk = () => {
    while (state.chunkIndex < chunks.length && state.offset >= chunks[state.chunkIndex].byteLength) {
      state.chunkIndex++;
      state.offset = 0;
    }
    return state.chunkIndex < chunks.length;
  };
  const readByte = () => {
    if (!ensureChunk()) throw new Error('BIFF8 字符串流截断');
    return chunks[state.chunkIndex][state.offset++];
  };
  const readUInt16 = () => readByte() | (readByte() << 8);
  const readUInt32 = () => (readByte() | (readByte() << 8) | (readByte() << 16) | (readByte() << 24)) >>> 0;

  const charCount = readUInt16();
  const flags = readByte();
  let is16Bit = (flags & 0x01) !== 0;
  const hasExtended = (flags & 0x04) !== 0;
  const hasRichText = (flags & 0x08) !== 0;
  const richRuns = hasRichText ? readUInt16() : 0;
  const extSize = hasExtended ? readUInt32() : 0;

  let charsRead = 0;
  let result = '';
  while (charsRead < charCount) {
    if (!ensureChunk()) break;
    if (state.offset === 0 && charsRead > 0) {
      // At the start of a CONTINUE record, the first byte is the new option flags byte (bit 0 = is16Bit)
      const contFlag = readByte();
      is16Bit = (contFlag & 0x01) !== 0;
    }
    if (is16Bit) {
      const lo = readByte();
      const hi = readByte();
      result += String.fromCharCode(lo | (hi << 8));
    } else {
      result += String.fromCharCode(readByte());
    }
    charsRead++;
  }

  let skipBytes = richRuns * 4 + extSize;
  while (skipBytes > 0 && ensureChunk()) {
    const avail = chunks[state.chunkIndex].byteLength - state.offset;
    const step = Math.min(avail, skipBytes);
    state.offset += step;
    skipBytes -= step;
  }
  return result;
}

function decodeRkValue(rk) {
  const isMul100 = (rk & 0x01) !== 0;
  const isInt = (rk & 0x02) !== 0;
  let val;
  if (isInt) {
    val = rk >> 2;
  } else {
    const buf = new ArrayBuffer(8);
    const dv = new DataView(buf);
    dv.setUint32(0, 0, true);
    dv.setUint32(4, rk & 0xfffffffc, true);
    val = dv.getFloat64(0, true);
  }
  return isMul100 ? val / 100 : val;
}

export function parseBiff8Workbook(stream) {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const records = [];
  let pos = 0;
  while (pos + 4 <= stream.byteLength) {
    const id = view.getUint16(pos, true);
    const len = view.getUint16(pos + 2, true);
    pos += 4;
    if (pos + len > stream.byteLength) break;
    records.push({ id, data: stream.subarray(pos, pos + len) });
    pos += len;
  }

  // Parse SST (0x00FC) + following CONTINUE (0x003C)
  let sstStrings = [];
  for (let i = 0; i < records.length; i++) {
    if (records[i].id === 0x00fc) {
      const rData = records[i].data;
      if (rData.byteLength < 8) break;
      const rView = new DataView(rData.buffer, rData.byteOffset, rData.byteLength);
      const uniqueStrings = rView.getUint32(4, true);
      const chunks = [rData.subarray(8)];
      while (i + 1 < records.length && records[i + 1].id === 0x003c) {
        i++;
        chunks.push(records[i].data);
      }
      const state = { chunkIndex: 0, offset: 0 };
      for (let s = 0; s < uniqueStrings; s++) {
        try {
          sstStrings.push(decodeBiff8String(chunks, state));
        } catch {
          break;
        }
      }
      break;
    }
  }

  // Parse BOUNDSHEET (0x0085) for sheet names
  const sheetNames = [];
  for (const rec of records) {
    if (rec.id === 0x0085 && rec.data.byteLength >= 8) {
      const nameLen = rec.data[6];
      const flags = rec.data[7];
      const is16 = (flags & 0x01) !== 0;
      let name = '';
      let p = 8;
      for (let c = 0; c < nameLen && p < rec.data.byteLength; c++) {
        if (is16 && p + 1 < rec.data.byteLength) {
          name += String.fromCharCode(rec.data[p] | (rec.data[p + 1] << 8));
          p += 2;
        } else {
          name += String.fromCharCode(rec.data[p++]);
        }
      }
      sheetNames.push(name || `Sheet${sheetNames.length + 1}`);
    }
  }

  // Walk BOF (0x0809) .. EOF (0x000A) substreams
  const sheets = [];
  let currentSheet = null;
  let worksheetIndex = 0;
  let lastFormulaCell = null;

  const putCell = (row, col, val) => {
    if (!currentSheet) return;
    if (!currentSheet.rows.has(row)) currentSheet.rows.set(row, new Map());
    currentSheet.rows.get(row).set(col, String(val ?? '').trim());
  };

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const d = rec.data;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);

    if (rec.id === 0x0809 && d.byteLength >= 4) {
      const substreamType = dv.getUint16(2, true);
      if (substreamType === 0x0010) {
        currentSheet = {
          name: sheetNames[worksheetIndex] || `Sheet${worksheetIndex + 1}`,
          rows: new Map()
        };
        worksheetIndex++;
        sheets.push(currentSheet);
      } else {
        currentSheet = null;
      }
      continue;
    }
    if (rec.id === 0x000a) {
      currentSheet = null;
      lastFormulaCell = null;
      continue;
    }
    if (!currentSheet) continue;

    if (rec.id === 0x00fd && d.byteLength >= 10) {
      // LABELSST
      const row = dv.getUint16(0, true);
      const col = dv.getUint16(2, true);
      const sstIdx = dv.getUint32(6, true);
      putCell(row, col, sstStrings[sstIdx] ?? '');
    } else if (rec.id === 0x0204 && d.byteLength >= 8) {
      // LABEL
      const row = dv.getUint16(0, true);
      const col = dv.getUint16(2, true);
      const state = { chunkIndex: 0, offset: 6 };
      try {
        putCell(row, col, decodeBiff8String([d], state));
      } catch {}
    } else if (rec.id === 0x0203 && d.byteLength >= 14) {
      // NUMBER
      const row = dv.getUint16(0, true);
      const col = dv.getUint16(2, true);
      putCell(row, col, dv.getFloat64(6, true));
    } else if (rec.id === 0x027e && d.byteLength >= 10) {
      // RK
      const row = dv.getUint16(0, true);
      const col = dv.getUint16(2, true);
      putCell(row, col, decodeRkValue(dv.getInt32(6, true)));
    } else if (rec.id === 0x00bd && d.byteLength >= 6) {
      // MULRK
      const row = dv.getUint16(0, true);
      const firstCol = dv.getUint16(2, true);
      const lastCol = dv.getUint16(d.byteLength - 2, true);
      let offset = 4;
      for (let col = firstCol; col <= lastCol && offset + 6 <= d.byteLength - 2; col++) {
        putCell(row, col, decodeRkValue(dv.getInt32(offset + 2, true)));
        offset += 6;
      }
    } else if (rec.id === 0x0006 && d.byteLength >= 14) {
      // FORMULA
      const row = dv.getUint16(0, true);
      const col = dv.getUint16(2, true);
      if (d[12] === 0xff && d[13] === 0xff) {
        if (d[6] === 0) {
          lastFormulaCell = { row, col };
        }
      } else {
        putCell(row, col, dv.getFloat64(6, true));
        lastFormulaCell = null;
      }
    } else if (rec.id === 0x0207 && lastFormulaCell && d.byteLength >= 3) {
      // STRING following FORMULA
      const state = { chunkIndex: 0, offset: 0 };
      try {
        putCell(lastFormulaCell.row, lastFormulaCell.col, decodeBiff8String([d], state));
      } catch {}
      lastFormulaCell = null;
    }
  }

  return sheets.map(sheet => {
    const sortedRows = Array.from(sheet.rows.entries()).sort((a, b) => a[0] - b[0]);
    const rows = sortedRows.map(([rowIndex, colMap]) => {
      const maxCol = Math.max(0, ...colMap.keys());
      const cells = [];
      for (let c = 0; c <= maxCol; c++) cells.push(colMap.get(c) || '');
      return { rowNumber: rowIndex + 1, cells };
    });
    return { name: sheet.name, rows };
  });
}

export function parseXlsBuffer(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (isOle2Magic(bytes)) {
    const cfb = parseCfbStreams(bytes);
    if (cfb.hasStream('WordDocument') && !cfb.hasStream('Workbook') && !cfb.hasStream('Book')) {
      throw new Error('检测到旧版 Word (.doc) 二进制文件，请在 Word 或 WPS 中「另存为 .docx」后再导入');
    }
    const wbStream = cfb.getStream('Workbook') || cfb.getStream('Book');
    if (!wbStream) {
      throw new Error('XLS 文件中未找到 Workbook 工作簿流，文件可能已损坏或受密码加密');
    }
    return parseBiff8Workbook(wbStream);
  }

  // Fallback for XML Spreadsheet 2003 / HTML table saved with .xls extension
  const text = new TextDecoder('utf-8').decode(bytes);
  if (text.includes('<Row') || text.includes('<tr') || text.includes('<TR')) {
    const rows = [];
    const rowRegex = /<(?:ss:)?Row[^>]*>([\s\S]*?)<\/(?:ss:)?Row>|<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m, rIdx = 1;
    while ((m = rowRegex.exec(text)) !== null) {
      const body = m[1] || m[2] || '';
      const cells = [];
      const cellRegex = /<(?:ss:)?Data[^>]*>([\s\S]*?)<\/(?:ss:)?Data>|<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cm;
      while ((cm = cellRegex.exec(body)) !== null) {
        const raw = (cm[1] ?? cm[2] ?? '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
        cells.push(raw);
      }
      if (cells.some(Boolean)) rows.push({ rowNumber: rIdx, cells });
      rIdx++;
    }
    if (rows.length) return [{ name: 'Sheet1', rows }];
  }

  throw new Error('无法识别的 .xls 文件格式（既非标准 BIFF8 复合文档，也非 SpreadsheetML 表格）');
}
