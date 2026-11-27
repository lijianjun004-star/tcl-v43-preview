import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const publicExample = 'experiments/r24-offline-asr/public-example/audio.wav';
const publicDigest = '1f057810087628dda970919ee85c2c377124f9d50813cdaf25e5119ee7c42f7c';
const extensions = new Set(['.mp3', '.mp4', '.m4a', '.mpga', '.mpeg', '.webm', '.ogg', '.wav', '.flac']);

function git(args, cwd) {
  return execFileSync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
}

export async function prepareSelection(event, env, cwd = process.cwd()) {
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_RUN_ATTEMPT !== '1' ||
      event.forced || event.deleted || event.created) return false;
  const privateBatch = event.repository?.private === true && event.ref === 'refs/heads/main';
  const publicTest = event.repository?.private === false && event.repository.full_name === 'lijianjun004-star/tcl-v43-preview' &&
    event.ref === 'refs/heads/feat/r24-offline-audio-transcription';
  if (!privateBatch && !publicTest) return false;
  if (![event.before, event.after].every(sha => /^[0-9a-f]{40}$/.test(sha) && !/^0+$/.test(sha)))
    throw new Error('Missing or invalid push range');
  const scope = privateBatch ? 'asr-review-inbox' : publicExample;
  const added = git(['diff', '--no-renames', '--name-only', '-z', '--diff-filter=A', event.before, event.after, '--', scope], cwd)
    .toString('utf8').split('\0').filter(Boolean);
  const seen = new Set(git(['rev-list', '--objects', event.before, '--', scope], cwd)
    .toString('utf8').split('\n').map(line => line.split(' ', 1)[0]));
  const files = [];
  for (const path of added) {
    if (privateBatch && !/^asr-review-inbox\/[a-zA-Z0-9_-]{1,40}\.[a-zA-Z0-9]{2,5}$/.test(path)) continue;
    const ext = extname(path).toLowerCase();
    if (!extensions.has(ext)) continue;
    const entry = git(['ls-tree', event.after, '--', path], cwd).toString('utf8');
    const oid = /^100(?:644|755) blob ([a-f0-9]{40})\t/.exec(entry)?.[1];
    if (!oid) throw new Error('Recording must be a regular Git file');
    if (seen.has(oid)) continue;
    seen.add(oid);
    if (Number(git(['cat-file', '-s', oid], cwd).toString()) > 512 * 1024)
      throw new Error('A recording exceeds the 512 KiB pilot limit');
    const bytes = git(['cat-file', 'blob', oid], cwd);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (publicTest && (path !== publicExample || sha256 !== publicDigest))
      throw new Error('Only the approved synthetic recording can run in the public repository');
    files.push({bytes, file: basename(path), sha256});
  }
  if (!files.length) return false;
  if (files.length > 3) throw new Error('The offline review accepts at most three new recordings per push');
  const dir = join(env.RUNNER_TEMP, 'r24-asr-in');
  await mkdir(dir, {recursive:true});
  const samples = [];
  for (const {bytes, file, sha256} of files) {
    await writeFile(join(dir, file), bytes, { flag: 'wx', mode: 0o600 });
    samples.push({id: basename(file, extname(file)), file, sha256});
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({samples}), {flag:'wx',mode:0o600});
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const ready = await prepareSelection(event, process.env);
  await appendFile(process.env.GITHUB_OUTPUT, 'ready=' + ready + '\n');
}
