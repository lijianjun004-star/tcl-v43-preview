import {cp, lstat, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const destination = process.argv[2];
if (!destination || process.argv.length !== 3) {
  throw new Error('Usage: npm run stage -- <new-empty-directory>');
}

const target = resolve(destination);
const files = [
  'package.json', 'package-lock.json', 'index.js', 'function.mjs', 'gateway.mjs',
  'cloudbase-identity.mjs', 'cloudbase-store.mjs', 'function-config.mjs',
  'device-access.mjs', 'device-grants-store.mjs', 'cloudbase-audio.mjs', 'ai-draft-provider.mjs',
].map(name => [new URL(name, import.meta.url), name]);
files.push(
  [new URL('../backend/api.mjs', import.meta.url), 'portable/api.mjs'],
  [new URL('../backend/assignment-draft-service.mjs', import.meta.url), 'portable/assignment-draft-service.mjs'],
  [new URL('../backend/evaluation-schema.mjs', import.meta.url), 'portable/evaluation-schema.mjs'],
  [new URL('../backend/ai-gateway-client.mjs', import.meta.url), 'portable/ai-gateway-client.mjs'],
  [new URL('../backend/vendor/assignment-excel.mjs', import.meta.url), 'portable/vendor/assignment-excel.mjs'],
  [new URL('../backend/vendor/qa3-boards.mjs', import.meta.url), 'portable/vendor/qa3-boards.mjs'],
  [new URL('../overlay/assignment-drafts.mjs', import.meta.url), 'overlay/assignment-drafts.mjs'],
);

for (const [source] of files) {
  if (!(await lstat(source)).isFile()) throw new Error(`Invalid source: ${fileURLToPath(source)}`);
}
await mkdir(target); // refuse to touch an existing destination
await mkdir(resolve(target, 'portable/vendor'), {recursive: true});
await mkdir(resolve(target, 'overlay'));
for (const [source, output] of files) {
  await cp(source, resolve(target, output), {force: false, errorOnExist: true});
}
console.log(target);
