import { posix } from 'node:path';

const defaults = {category: '电视', platform: '京东', count: 10, model: 'gpt-4o-mini'};
const platforms = ['京东', '天猫', '抖音'];
const models = ['gpt-4o-mini', 'gpt-4o'];
const headerField = /^(?:#\s*|\/\/\s*)?(category|platform|count|model)\s*[:：]\s*(.*?)\s*$/iu;
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;

function fail(code) {
  throw Object.assign(new Error(code), {code});
}

export function detectSensitive(text) {
  const normalized = text.normalize('NFKC');
  if (/sk[-_][\w-]+/iu.test(normalized)) return 'API_KEY';
  if (/(?<!\d)\d{17}[\dX](?!\d)/iu.test(normalized)) return 'IDENTITY';
  if (/(?<!\d)(?:\+?86[ -]?)?1[3-9]\d{9}(?!\d)/u.test(normalized)) return 'MOBILE';
  if (normalized.includes('@') &&
      /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]{1,64}@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/u.test(normalized)) return 'EMAIL';
  if (/\bauthorization\s*:|\bbearer\s+\S|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bAKID[A-Za-z0-9]{16,}|\b(?:[A-Z][A-Z0-9_]*_)?(?:API_KEY|ACCESS_TOKEN|SECRET_KEY|TOKEN)\s*[:=]\s*\S/iu.test(normalized)) return 'CREDENTIAL';
  return null;
}

function validate(key, value) {
  switch (key) {
    case 'platform':
      if (!platforms.includes(value)) fail('INBOX_INVALID_PLATFORM');
      return value;
    case 'count':
      if (!/^(?:[1-9]|[1-4]\d|50)$/u.test(value)) fail('INBOX_INVALID_COUNT');
      return Number(value);
    case 'model':
      if (!models.includes(value)) fail('INBOX_INVALID_MODEL');
      return value;
    case 'category':
      if (!value || value.length > 100 || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value) ||
          /^[=+@-]/u.test(value.normalize('NFKC').trimStart())) fail('INBOX_INVALID_CATEGORY');
      return value;
  }
}

function fromFilename(path) {
  const filename = posix.basename(path, posix.extname(path));
  const [category, platform, countField] = filename.split('_');
  if (!countField || !(countField.endsWith('题') || platforms.includes(platform))) return {};
  if (!countField.endsWith('题')) fail('INBOX_INVALID_COUNT');
  return {
    category: validate('category', category.trim()),
    platform: validate('platform', platform.trim()),
    count: validate('count', countField.slice(0, -1).trim()),
  };
}

function fromHeader(text) {
  const lines = text.split('\n');
  // A leading Markdown horizontal rule is also legal prose. Interpret it as
  // settings only when this first block contains a recognized field.
  let fenced = false;
  if (lines[0].trim() === '---') {
    for (const line of lines.slice(1)) {
      if (line.trim() === '---') break;
      if (headerField.test(line.trim())) { fenced = true; break; }
    }
  }
  const fields = {};
  let index = fenced ? 1 : 0;
  for (; index < lines.length; index++) {
    const line = lines[index].trim();
    if (fenced && line === '---') break;
    const match = headerField.exec(line);
    if (!match) {
      if (fenced && (!line || line.startsWith('#'))) continue;
      if (fenced) fail('INBOX_INVALID_METADATA');
      break;
    }
    const key = match[1].toLowerCase();
    if (Object.hasOwn(fields, key)) fail('INBOX_INVALID_METADATA');
    let value = match[2].trim();
    if (/^['"]/u.test(value)) {
      if (value.length < 2 || !value.endsWith(value[0])) fail('INBOX_INVALID_METADATA');
      value = value.slice(1, -1).trim();
    }
    fields[key] = validate(key, value);
  }
  if (fenced && index === lines.length) fail('INBOX_INVALID_METADATA');
  const material = lines.slice(fenced ? index + 1 : index).join('\n').trim();
  if (!material) fail('INBOX_INVALID_MATERIAL');
  return {fields, material};
}

export function readMetadata({path, text}) {
  // Inspect the full input before removing a BOM, comments, or metadata.
  for (const input of [path, text]) {
    const category = detectSensitive(input);
    if (category) fail('INBOX_SENSITIVE_' + category);
  }
  const normalized = text.replace(/^\ufeff/u, '').replace(/\r\n?/gu, '\n');
  if (control.test(normalized)) fail('INBOX_INVALID_MATERIAL');
  const filenameFields = fromFilename(path);
  const {fields, material} = fromHeader(normalized.trim());
  return {...defaults, ...filenameFields, ...fields, material};
}
