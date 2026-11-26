import { execFileSync } from 'node:child_process';

const prefix = 'materials-inbox/';
const maxUnits = 20_000;
const maxBytes = 3 * maxUnits + 3; // UTF-8 may use three bytes per UTF-16 unit, plus BOM.
const sha = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const invalidText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;
const credential = /sk[-_][\w-]+|\bauthorization\s*:|\bbearer\s+\S|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bAKID[A-Za-z0-9]{16,}|\b(?:[A-Z][A-Z0-9_]*_)?(?:API_KEY|ACCESS_TOKEN|SECRET_KEY|TOKEN)\s*[:=]\s*\S/iu;
const decoder = new TextDecoder('utf-8', { fatal: true });

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function git(cwd, args, maxBuffer = 8 * 1024 * 1024) {
  try {
    return execFileSync('git', ['--literal-pathspecs', ...args], {
      cwd, maxBuffer, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // Git errors can contain untrusted revision/path text. Only expose a stable error code.
    fail('INBOX_GIT_READ_FAILED');
  }
}

function checkCommit(cwd, id) {
  if (typeof id !== 'string' || !sha.test(id) || /^0+$/u.test(id)) fail('INBOX_INVALID_COMMIT');
  if (git(cwd, ['cat-file', '-t', id]).toString().trim() !== 'commit') fail('INBOX_INVALID_COMMIT');
}

function eligible(path) {
  if (!path.startsWith(prefix) || !/\.(?:md|txt|csv)$/iu.test(path)) return false;
  return !/(?:^|\/)README\.md$/iu.test(path);
}

function checkPath(path) {
  if (!eligible(path) || path.includes('\\') || /[\r\n\t]/u.test(path) || invalidText.test(path) ||
      credential.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
    fail('INBOX_INVALID_PATH');
  }
}

function decode(bytes) {
  try {
    return decoder.decode(bytes);
  } catch {
    fail('INBOX_INVALID_UTF8');
  }
}

function additions(cwd, before, after) {
  // Detect moves and identical copies across the entire tree, including moves into the inbox.
  const changes = git(cwd, ['diff', '--raw', '-z', '--no-abbrev', '--no-ext-diff', '--no-textconv',
    '--find-renames=100%', '--find-copies=100%', '--find-copies-harder', '--diff-filter=A', before, after, '--']);
  // latin1 preserves every path byte until a candidate can receive strict UTF-8 decoding.
  const fields = changes.toString('latin1').split('\0');
  const result = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [, mode, , id, status] = fields[i].split(' ');
    const rawPath = fields[i + 1];
    if (status !== 'A' || mode !== '100644' || !eligible(rawPath)) continue;
    const path = decode(Buffer.from(rawPath, 'latin1'));
    checkPath(path);
    result.push({ path, id });
  }
  return result;
}

function weeklyEntry(cwd, after, path) {
  checkPath(path);
  const entry = git(cwd, ['ls-tree', '-z', '--full-tree', after, '--', path]);
  const match = /^100644 blob ([0-9a-f]+)\t([^\0]+)\0$/u.exec(decode(entry));
  if (!match || match[2] !== path) fail('INBOX_WEEKLY_FILE_UNAVAILABLE');
  return { path, id: match[1] };
}

function readMaterial(cwd, id) {
  if (!sha.test(id)) fail('INBOX_GIT_READ_FAILED');
  const size = Number(git(cwd, ['cat-file', '-s', id]).toString().trim());
  if (!Number.isSafeInteger(size) || size > maxBytes) fail('INBOX_TOO_LARGE');
  const text = decode(git(cwd, ['cat-file', 'blob', id], maxBytes + 1));
  if (text.length > maxUnits) fail('INBOX_TOO_LARGE');
  if (!text.trim() || invalidText.test(text) || credential.test(text)) fail('INBOX_INVALID_MATERIAL');
  return text.trim().replace(/\r\n?/gu, '\n');
}

export function collectMaterial({ cwd, before, after, weeklyFile }) {
  if (weeklyFile === '') return null;
  checkCommit(cwd, after);
  let candidates;
  if (weeklyFile === undefined) {
    checkCommit(cwd, before);
    candidates = additions(cwd, before, after);
  } else {
    if (typeof weeklyFile !== 'string') fail('INBOX_INVALID_PATH');
    candidates = [weeklyEntry(cwd, after, weeklyFile)];
  }
  candidates.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const ids = new Set();
  const files = [];
  let material = '';
  for (const { path, id } of candidates) {
    if (ids.has(id)) continue;
    const text = readMaterial(cwd, id);
    // Keep one-file input identical to manually supplied material. Separate distinct source documents.
    material += (files.length ? '\n\n' : '') + text;
    if (material.length > maxUnits) fail('INBOX_TOO_LARGE');
    ids.add(id);
    files.push(path);
  }
  return files.length ? { material, files } : null;
}
