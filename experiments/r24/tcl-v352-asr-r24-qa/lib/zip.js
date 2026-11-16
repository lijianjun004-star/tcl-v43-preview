// Audited pure-JS ZIP reader + RFC1951 raw deflate decompression with ZIP-bomb guards.
// License: MIT (in-house audited implementation for TCL Streamer V4.3, zero external runtime dependencies).

export const ZIP_LIMITS = {
  maxArchiveBytes: 15 * 1024 * 1024,      // 15 MB max input archive
  maxUncompressedBytes: 25 * 1024 * 1024, // 25 MB max total extracted bytes
  maxSingleEntryBytes: 12 * 1024 * 1024,  // 12 MB max single entry
  maxEntries: 400,                        // Max central directory entries
  maxCompressionRatio: 120                // Guard against zip bombs
};

// Pure-JS RFC 1951 raw INFLATE fallback for environments where DecompressionStream('deflate-raw') is absent.
export function inflateRawSync(src, maxOutputBytes = ZIP_LIMITS.maxSingleEntryBytes) {
  let bitBuf = 0, bitCnt = 0, pos = 0;
  const out = [];
  const needBits = n => {
    while (bitCnt < n) {
      if (pos >= src.length) throw new Error('ZIP压缩流意外截断（文件可能已损坏）');
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
  };
  const bits = n => { needBits(n); const v = bitBuf & ((1 << n) - 1); bitBuf >>>= n; bitCnt -= n; return v; };
  const alignByte = () => { bitBuf = 0; bitCnt = 0; };

  const buildHuffman = lengths => {
    let maxBits = 0;
    for (let i = 0; i < lengths.length; i++) if (lengths[i] > maxBits) maxBits = lengths[i];
    if (maxBits === 0) return { counts: new Int32Array(1), symbols: new Int32Array(1), maxBits: 1 };
    const counts = new Int32Array(maxBits + 1);
    for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
    counts[0] = 0;
    const offsets = new Int32Array(maxBits + 1);
    let code = 0;
    for (let b = 1; b <= maxBits; b++) {
      code = (code + counts[b - 1]) << 1;
      offsets[b] = code;
    }
    const table = new Map();
    for (let sym = 0; sym < lengths.length; sym++) {
      const len = lengths[sym];
      if (len > 0) {
        const c = offsets[len]++;
        table.set((len << 16) | c, sym);
      }
    }
    return { table, maxBits };
  };

  const decodeSymbol = huff => {
    let code = 0;
    for (let len = 1; len <= huff.maxBits; len++) {
      code = (code << 1) | bits(1);
      const sym = huff.table.get((len << 16) | code);
      if (sym !== undefined) return sym;
    }
    throw new Error('ZIP Huffman 解码失败（压缩数据损坏）');
  };

  const fixedLitLengths = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) fixedLitLengths[i] = 8;
  for (let i = 144; i <= 255; i++) fixedLitLengths[i] = 9;
  for (let i = 256; i <= 279; i++) fixedLitLengths[i] = 7;
  for (let i = 280; i <= 287; i++) fixedLitLengths[i] = 8;
  const fixedDistLengths = new Uint8Array(32).fill(5);
  let fixedLitHuff = null, fixedDistHuff = null;

  const lenBase = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const lenExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const distBase = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const distExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  const clOrder = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  let bfinal = 0;
  while (!bfinal) {
    bfinal = bits(1);
    const btype = bits(2);
    if (btype === 0) {
      alignByte();
      if (pos + 4 > src.length) throw new Error('ZIP 非压缩块头部不完整');
      const len = src[pos] | (src[pos + 1] << 8);
      const nlen = src[pos + 2] | (src[pos + 3] << 8);
      pos += 4;
      if ((len ^ 0xffff) !== nlen) throw new Error('ZIP 非压缩块长度校验失败');
      if (pos + len > src.length) throw new Error('ZIP 非压缩块数据截断');
      if (out.length + len > maxOutputBytes) throw new Error('文件解压后体积超过安全上限');
      for (let i = 0; i < len; i++) out.push(src[pos++]);
    } else if (btype === 1 || btype === 2) {
      let litHuff, distHuff;
      if (btype === 1) {
        if (!fixedLitHuff) {
          fixedLitHuff = buildHuffman(fixedLitLengths);
          fixedDistHuff = buildHuffman(fixedDistLengths);
        }
        litHuff = fixedLitHuff;
        distHuff = fixedDistHuff;
      } else {
        const hlit = bits(5) + 257;
        const hdist = bits(5) + 1;
        const hclen = bits(4) + 4;
        const clLengths = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) clLengths[clOrder[i]] = bits(3);
        const clHuff = buildHuffman(clLengths);
        const allLengths = new Uint8Array(hlit + hdist);
        let idx = 0;
        while (idx < hlit + hdist) {
          const sym = decodeSymbol(clHuff);
          if (sym < 16) {
            allLengths[idx++] = sym;
          } else if (sym === 16) {
            if (idx === 0) throw new Error('ZIP 动态表重复长度非法');
            const prev = allLengths[idx - 1];
            const rep = bits(2) + 3;
            for (let r = 0; r < rep; r++) allLengths[idx++] = prev;
          } else if (sym === 17) {
            const rep = bits(3) + 3;
            for (let r = 0; r < rep; r++) allLengths[idx++] = 0;
          } else if (sym === 18) {
            const rep = bits(7) + 11;
            for (let r = 0; r < rep; r++) allLengths[idx++] = 0;
          }
        }
        litHuff = buildHuffman(allLengths.subarray(0, hlit));
        distHuff = buildHuffman(allLengths.subarray(hlit));
      }
      while (true) {
        const sym = decodeSymbol(litHuff);
        if (sym === 256) break;
        if (sym < 256) {
          if (out.length + 1 > maxOutputBytes) throw new Error('文件解压后体积超过安全上限');
          out.push(sym);
        } else {
          const lenIdx = sym - 257;
          if (lenIdx < 0 || lenIdx >= lenBase.length) throw new Error('ZIP 长度符号非法');
          const length = lenBase[lenIdx] + (lenExtra[lenIdx] ? bits(lenExtra[lenIdx]) : 0);
          const distSym = decodeSymbol(distHuff);
          if (distSym < 0 || distSym >= distBase.length) throw new Error('ZIP 距离符号非法');
          const dist = distBase[distSym] + (distExtra[distSym] ? bits(distExtra[distSym]) : 0);
          if (dist > out.length) throw new Error('ZIP 引用距离越界（压缩流损坏）');
          if (out.length + length > maxOutputBytes) throw new Error('文件解压后体积超过安全上限');
          for (let i = 0; i < length; i++) {
            out.push(out[out.length - dist]);
          }
        }
      }
    } else {
      throw new Error('ZIP 压缩块类型非法');
    }
  }
  return new Uint8Array(out);
}

export function inflateZlibSync(src, maxOutputBytes = ZIP_LIMITS.maxSingleEntryBytes) {
  if (src.length < 2) throw new Error('Zlib 数据过短');
  const cmf = src[0], flg = src[1];
  if ((cmf & 0x0f) === 8 && ((cmf * 256 + flg) % 31 === 0)) {
    const fdict = (flg & 0x20) !== 0;
    const start = fdict ? 6 : 2;
    return inflateRawSync(src.subarray(start), maxOutputBytes);
  }
  return inflateRawSync(src, maxOutputBytes);
}

export async function readZipEntries(buffer, limits = ZIP_LIMITS) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength > limits.maxArchiveBytes) {
    throw new Error(`文件大小超过 ${(limits.maxArchiveBytes / 1048576).toFixed(0)} MB 限制，请拆分后再导入`);
  }
  if (bytes.byteLength < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('不是有效的 ZIP/Office (DOCX/XLSX) 容器文件');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  const minEocd = Math.max(0, bytes.byteLength - 65557);
  for (let i = bytes.byteLength - 22; i >= minEocd; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('文件结构损坏：未找到 ZIP 目录尾部 (EOCD)');

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  if (totalEntries > limits.maxEntries) {
    throw new Error(`文档内包含子文件过多（${totalEntries} > ${limits.maxEntries}），拒绝解析以防止资源耗尽`);
  }
  if (cdOffset + cdSize > bytes.byteLength) {
    throw new Error('文件结构损坏：ZIP 中央目录超出文件边界');
  }

  const entries = new Map();
  let ptr = cdOffset;
  let totalUncompressed = 0;
  const decoder = new TextDecoder('utf-8');

  for (let i = 0; i < totalEntries; i++) {
    if (ptr + 46 > bytes.byteLength || view.getUint32(ptr, true) !== 0x02014b50) {
      throw new Error('文件结构损坏：ZIP 中央目录项签名无效');
    }
    const compressionMethod = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const uncompressedSize = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);

    if (uncompressedSize > limits.maxSingleEntryBytes) {
      throw new Error('文档内部单文件体积过大，已触发安全阻断');
    }
    if (compressedSize > 0 && uncompressedSize / compressedSize > limits.maxCompressionRatio) {
      throw new Error('检测到异常压缩比（疑似压缩炸弹），已拒绝解析');
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxUncompressedBytes) {
      throw new Error('文档解压后总容量超过安全限制，请拆分文档');
    }

    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    entries.set(name, {
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });
  }

  async function extractEntry(entryName) {
    const meta = entries.get(entryName);
    if (!meta) return null;
    const lh = meta.localHeaderOffset;
    if (lh + 30 > bytes.byteLength || view.getUint32(lh, true) !== 0x04034b50) {
      throw new Error(`ZIP 局部文件头损坏：${entryName}`);
    }
    const localNameLen = view.getUint16(lh + 26, true);
    const localExtraLen = view.getUint16(lh + 28, true);
    const dataStart = lh + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + meta.compressedSize;
    if (dataEnd > bytes.byteLength) {
      throw new Error(`ZIP 数据段超出文件范围：${entryName}`);
    }
    const slice = bytes.subarray(dataStart, dataEnd);
    if (meta.compressionMethod === 0) {
      return slice;
    }
    if (meta.compressionMethod === 8) {
      return inflateRawSync(slice, limits.maxSingleEntryBytes);
    }
    throw new Error(`不支持的 ZIP 压缩算法 (${meta.compressionMethod})：${entryName}`);
  }

  async function extractText(entryName) {
    const raw = await extractEntry(entryName);
    if (!raw) return null;
    return decoder.decode(raw);
  }

  return {
    entries,
    has: name => entries.has(name),
    list: () => Array.from(entries.keys()),
    extractEntry,
    extractText
  };
}
