import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const reader = fileURLToPath(new URL('./inbox-xlsx.py', import.meta.url));

export function extractXlsx(bytes) {
  const result = spawnSync('python3', ['-I', reader], {
    input: bytes, encoding: 'utf8', timeout: 15_000, maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    const message = result.stderr?.trim();
    const code = /^INBOX_XLSX_[A-Z_]+$/u.test(message) ? message : 'INBOX_XLSX_INVALID';
    throw Object.assign(new Error(code), { code });
  }
  return JSON.parse(result.stdout);
}
