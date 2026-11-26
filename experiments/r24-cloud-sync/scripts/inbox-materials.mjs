import { execFileSync } from 'node:child_process';
import { detectSensitive, readMetadata } from './inbox-format.mjs';
import { extractXlsx } from './inbox-xlsx.mjs';

const prefix = 'materials-inbox/';
const maxFiles = 3;
const maxBytes = 100 * 1024;
const maxTextUnits = 102400;
const sha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const invalidText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;
const decoder = new TextDecoder('utf-8', { fatal: true });

function fail(code, safePath) {
  throw Object.assign(new Error(code), { code, safePath });
}

function git(cwd, args, maxBuffer = 8 * 1024 * 1024) {
  try {
    return execFileSync('git', ['--literal-pathspecs', ...args], {
      cwd, maxBuffer, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // A native Git diagnostic can contain the original path or revision.
    fail('INBOX_GIT_READ_FAILED');
  }
}

function checkCommit(cwd, id) {
  if (typeof id !== 'string' || !sha.test(id) || /^0+$/u.test(id)) fail('INBOX_INVALID_COMMIT');
  if (git(cwd, ['cat-file', '-t', id]).toString().trim() !== 'commit') fail('INBOX_INVALID_COMMIT');
}

function eligible(path) {
  return path.startsWith(prefix) && /\.(?:txt|md|csv|tsv|xlsx)$/iu.test(path) &&
    path.toLowerCase() !== prefix + 'readme.md';
}

function checkPath(path) {
  if (typeof path !== 'string' || !eligible(path)) fail('INBOX_INVALID_PATH');
  const kind = detectSensitive(path);
  if (kind) fail('INBOX_SENSITIVE_' + kind, '[文件名已隐藏]');
  if (path.includes('\\') || /[\p{Cc}\p{Cf}]/u.test(path) ||
      path.split('/').some(part => !part || part.startsWith('.'))) fail('INBOX_INVALID_PATH');
  // Keep characters interpreted by shells, Markdown, HTML and workflow commands out of diagnostics.
  return /^[\p{L}\p{M}\p{N} _./()（）-]+$/u.test(path) ? path : '[文件名已隐藏]';
}

function decode(bytes, safePath) {
  try {
    return decoder.decode(bytes);
  } catch {
    fail('INBOX_INVALID_UTF8', safePath);
  }
}

function changedPaths(cwd, before, after) {
  // Inspect only changed paths. NUL delimiters keep unusual Git names intact during validation.
  const bytes = git(cwd, ['diff', '--name-only', '--diff-filter=AM', '--find-renames=100%', '-z',
    '--no-ext-diff', '--no-textconv', before, after, '--', 'materials-inbox']);
  const names = bytes.toString('latin1').split('\0').filter(eligible);
  if (names.length > maxFiles) fail('INBOX_TOO_MANY_FILES');
  return names.map(name => decode(Buffer.from(name, 'latin1')));
}

function inspectFile(cwd, after, path) {
  const safePath = checkPath(path);
  const row = git(cwd, ['ls-tree', '-z', '--full-tree', after, '--', path]).toString('latin1');
  const metadata = row.slice(0, row.indexOf('\t'));
  const match = /^100644 blob ([0-9a-f]+)$/u.exec(metadata);
  if (!match || !sha.test(match[1])) fail('INBOX_FILE_UNAVAILABLE', safePath);
  const id = match[1];
  const size = Number(git(cwd, ['cat-file', '-s', id]).toString().trim());
  if (!Number.isSafeInteger(size) || size > maxBytes) fail('INBOX_FILE_TOO_LARGE', safePath);
  return { path, safePath, id };
}

function checkSensitive(text, safePath) {
  const kind = detectSensitive(text);
  if (kind) fail('INBOX_SENSITIVE_' + kind, safePath);
}

function readFile(cwd, { path, safePath, id }) {
  const bytes = git(cwd, ['cat-file', 'blob', id], maxBytes + 1);
  try {
    let text;
    if (/\.xlsx$/iu.test(path)) {
      const workbook = extractXlsx(bytes);
      checkSensitive(workbook.scanText, safePath);
      text = workbook.text;
    } else {
      text = decode(bytes, safePath);
    }
    checkSensitive(text, safePath);
    if (!text.trim() || invalidText.test(text)) fail('INBOX_INVALID_MATERIAL', safePath);
    const options = readMetadata({ path, text: text.replace(/\r\n?/gu, '\n') });
    if (options.material.length > maxTextUnits) fail('INBOX_TEXT_TOO_LARGE', safePath);
    return { path, ...options };
  } catch (error) {
    // Discard parser exception messages; only our local parsers' stable codes may reach logs.
    fail(/^INBOX_[A-Z0-9_]{1,48}$/u.test(error?.code) ? error.code : 'INBOX_INVALID_MATERIAL', safePath);
  }
}

export async function collectMaterials({ cwd, before, after, selectedFile }) {
  checkCommit(cwd, after);
  let paths;
  if (selectedFile === undefined) {
    checkCommit(cwd, before);
    paths = changedPaths(cwd, before, after);
  } else {
    paths = [selectedFile];
  }
  // Check sizes and file modes for the entire push before extracting any contents.
  const files = paths.map(path => inspectFile(cwd, after, path));
  return files.map(file => readFile(cwd, file));
}
