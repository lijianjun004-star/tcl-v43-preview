import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { collectMaterials } from '../scripts/inbox-materials.mjs';

const inbox = 'materials-inbox/';

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'r24-inbox-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  function git(...args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  }
  function write(path, content) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
  function commit() {
    git('add', '--all');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture', '--allow-empty');
    return git('rev-parse', 'HEAD');
  }
  git('init', '--quiet');
  git('config', 'core.autocrlf', 'false');
  return { cwd, git, write, commit };
}

test('a multi-commit push selects added and modified files only, at their committed revision', async t => {
  const { cwd, write, commit } = repository(t);
  const old = inbox + 'a/旧资料.txt';
  write(old, '最早的说明');
  write(inbox + '保持不变.md', '略过该文件');
  write(inbox + 'old.csv', '删除的文件');
  write(inbox + 'previous.txt', '仅改名的文件');
  const before = commit();
  const tsv = inbox + '产品.TSV';
  const csv = inbox + '公开.CSV';
  write(old, '电视使用说明');
  write(csv, '问题,依据\n安装范围,商品页面');
  commit();
  write(tsv, '\ufeff需求\t答复\r\n安装\t请核对条件');
  renameSync(join(cwd, inbox + 'previous.txt'), join(cwd, inbox + 'new-name.txt'));
  rmSync(join(cwd, inbox + 'old.csv'));
  write(inbox + 'README.md', '说明');
  write(inbox + '.gitkeep', '忽略');
  write(inbox + '资料.pdf', Buffer.from([0xff]));
  write('outside.txt', '其他业务');
  const after = commit();
  write(old, '未提交的修改');
  const files = await collectMaterials({ cwd, before, after });
  assert.equal(files.length, 3);
  assert.deepEqual(Object.fromEntries(files.map(x => [x.path, x.material])), {
    [old]: '电视使用说明', [csv]: '问题,依据\n安装范围,商品页面', [tsv]: '需求\t答复\n安装\t请核对条件',
  });
  for (const file of files) {
    assert.deepEqual([file.category, file.platform, file.count, file.model], ['电视', '京东', 10, 'gpt-4o-mini']);
  }
  assert.deepEqual(await collectMaterials({ cwd, before: after, after }), []);
});

test('two new files with identical contents are independent sources and outputs', async t => {
  const { cwd, write, commit } = repository(t);
  const before = commit();
  write(inbox + 'a.txt', '同一公开资料');
  write(inbox + 'b.md', '同一公开资料');
  const files = await collectMaterials({ cwd, before, after: commit() });
  assert.deepEqual(files.map(x => x.path), [inbox + 'a.txt', inbox + 'b.md']);
});

test('enforces three file count and 100 KiB byte boundaries before making any model request', async t => {
  const { cwd, write, commit } = repository(t);
  const http = t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected HTTP'));
  const before = commit();
  for (let i = 0; i < 4; i++) write(inbox + i + '.txt', i === 0 ? Buffer.from([0xff]) : '公开资料');
  const four = commit();
  await assert.rejects(collectMaterials({ cwd, before, after: four }), { code: 'INBOX_TOO_MANY_FILES' });
  write(inbox + '0.txt', Buffer.from([0xc3]));
  write(inbox + '1.txt', Buffer.alloc(102401, 97));
  // 0.txt cannot be decoded, but all files' sizes are checked first.
  await assert.rejects(collectMaterials({ cwd, before: four, after: commit() }),
    { code: 'INBOX_FILE_TOO_LARGE', safePath: inbox + '1.txt' });
  write(inbox + '1.txt', Buffer.alloc(102400, 97));
  const [accepted] = await collectMaterials({ cwd, after: commit(), selectedFile: inbox + '1.txt' });
  assert.equal(accepted.material.length, 102400);
  assert.equal(http.mock.callCount(), 0);
});

test('sensitive material aborts the entire selection with only category and safe filename, zero HTTP', async t => {
  const { cwd, write, commit } = repository(t);
  const http = t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected HTTP'));
  const safe = inbox + 'a.txt';
  const path = inbox + 'z.txt';
  const cases = [
    [['13', '8000', '00123'].join(''), 'MOBILE'],
    [['110101', '19990420', '123X'].join(''), 'IDENTITY'],
    [['synthetic', '@', 'example.invalid'].join(''), 'EMAIL'],
    [['sk', 'syntheticTestOnly'].join('-'), 'API_KEY'],
    [['sk', 'syntheticTestOnly'].join('_'), 'API_KEY'],
  ];
  let before = commit();
  for (const [secret, kind] of cases) {
    write(safe, '公开说明 ' + kind);
    write(path, '资料内的合成测试值 ' + secret);
    const after = commit();
    await assert.rejects(collectMaterials({ cwd, before, after }), error => {
      assert.equal(error.code, 'INBOX_SENSITIVE_' + kind);
      assert.equal(error.message, error.code);
      assert.equal(error.safePath, path);
      assert.ok(!JSON.stringify(error).includes(secret));
      return true;
    });
    before = after;
  }
  const privateName = inbox + cases[0][0] + '.txt';
  write(privateName, '公开产品信息');
  await assert.rejects(collectMaterials({ cwd, before, after: commit() }),
    { code: 'INBOX_SENSITIVE_MOBILE', safePath: '[文件名已隐藏]' });
  assert.equal(http.mock.callCount(), 0);
});

test('single-file selection reads only a regular tracked file from the specified commit', async t => {
  const { cwd, write, commit } = repository(t);
  const path = inbox + '公开/送装.csv';
  write(path, '场景,确认通道尺寸');
  write(inbox + '其他.txt', '与定时选择无关');
  write('outside.md', '外部资料');
  write(inbox + 'executable.txt', '属性为可执行的文件');
  chmodSync(join(cwd, inbox + 'executable.txt'), 0o755);
  symlinkSync('../outside.md', join(cwd, inbox + 'link.md'));
  const after = commit();
  write(path, '尚未提交的更新');
  const [file] = await collectMaterials({ cwd, after, selectedFile: path });
  assert.deepEqual([file.path, file.material], [path, '场景,确认通道尺寸']);
  for (const selectedFile of ['outside.md', inbox + '../outside.md', inbox + '/电视.txt',
    '/tmp/电视.txt', inbox + 'link.md', inbox + 'executable.txt', inbox + 'missing.md', inbox + 'README.md',
    inbox + 'unsafe\\name.md', inbox + '*.txt', '', null]) {
    await assert.rejects(collectMaterials({ cwd, after, selectedFile }), Error);
  }
});

test('malformed, empty or unsafe material and unsafe paths are rejected without reflecting raw text', async t => {
  const { cwd, git, write, commit } = repository(t);
  const path = inbox + '有效.txt';
  write(path, '公开商品卖点');
  let before = commit();
  for (const [content, expected] of [
    [Buffer.from([0xe4, 0xb8]), 'INBOX_INVALID_UTF8'],
    [' \t\r\n', 'INBOX_INVALID_MATERIAL'],
    ['输入\u0000结尾', 'INBOX_INVALID_MATERIAL'],
    ['输入\u202e结尾', 'INBOX_INVALID_MATERIAL'],
  ]) {
    write(path, content);
    const after = commit();
    await assert.rejects(collectMaterials({ cwd, before, after }), { code: expected, message: expected });
    before = after;
  }
  write(inbox + 'bad\nname.txt', '业务说明');
  const after = commit();
  await assert.rejects(collectMaterials({ cwd, before, after }), { code: 'INBOX_INVALID_PATH' });
  for (const id of ['HEAD', '--all', '0'.repeat(40), git('rev-parse', before + ':' + path)]) {
    await assert.rejects(collectMaterials({ cwd, before: id, after }), { code: 'INBOX_INVALID_COMMIT' });
    await assert.rejects(collectMaterials({ cwd, before, after: id }), { code: 'INBOX_INVALID_COMMIT' });
  }
});
