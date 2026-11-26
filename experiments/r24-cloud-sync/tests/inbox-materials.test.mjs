import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { collectMaterial } from '../scripts/inbox-materials.mjs';

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

test('one push collects new UTF-8 documents from all pushed commits in stable order', t => {
  const { cwd, write, commit } = repository(t);
  const before = commit();
  const csv = inbox + 'a/品类.CSV';
  const markdown = inbox + '公开.MD';
  const plain = inbox + '电视.txt';
  write(plain, '  请说明电视入户条件。\n');
  write(markdown, '\ufeff如何测量电梯？\r\n请以测量结果为准。');
  commit();
  write(csv, '问题,依据\n核对安装范围,商品页面');
  write('outside.txt', '其他业务资料');
  write(inbox + 'a/ReadMe.Md', '子目录说明');
  write(inbox + 'README.md', '上传说明');
  write(inbox + '资料.pdf', Buffer.from([1, 0xff]));
  const after = commit();
  write(plain, '此修改尚未提交');
  assert.deepEqual(collectMaterial({ cwd, before, after }), {
    files: [csv, markdown, plain],
    material: '问题,依据\n核对安装范围,商品页面\n\n如何测量电梯？\n请以测量结果为准。\n\n请说明电视入户条件。',
  });
});

test('edits, deletes, exact copies, moves into the inbox and links cannot start a batch', t => {
  const { cwd, write, commit } = repository(t);
  write(inbox + 'editable.txt', '旧作业');
  write(inbox + 'removed.txt', '下架作业');
  write('to-move.txt', '产品页参数');
  write('original.txt', '新设备送货范围');
  const before = commit();
  write(inbox + 'editable.txt', '编辑后的资料');
  rmSync(join(cwd, inbox, 'removed.txt'));
  renameSync(join(cwd, 'to-move.txt'), join(cwd, inbox, 'moved.txt'));
  write(inbox + 'copy.md', '新设备送货范围');
  write(inbox + 'executable.txt', '属性为可执行的文件');
  chmodSync(join(cwd, inbox, 'executable.txt'), 0o755);
  symlinkSync('../original.txt', join(cwd, inbox, 'alias.txt'));
  const after = commit();
  assert.equal(collectMaterial({ cwd, before, after }), null);
});

test('same new material uploaded twice in the same batch contributes only once', t => {
  const { cwd, write, commit } = repository(t);
  const before = commit();
  write(inbox + 'b.txt', '产品送装说明');
  write(inbox + 'a.md', '产品送装说明');
  const result = collectMaterial({ cwd, before, after: commit() });
  assert.equal(result.files.length, 1);
  assert.equal(result.material, '产品送装说明');
});

test('weekly collection uses only the selected committed regular inbox document', t => {
  const { cwd, write, commit } = repository(t);
  const path = inbox + '公开/送装.csv';
  write(path, '场景,确认通道尺寸');
  write(inbox + '电视.txt', '与本次定时资料无关');
  write('outside.md', '外部资料');
  write(inbox + 'executable.txt', '属性为可执行的定期文件');
  chmodSync(join(cwd, inbox, 'executable.txt'), 0o755);
  symlinkSync('../outside.md', join(cwd, inbox, 'link.md'));
  const after = commit();
  write(path, '尚未提交的更新');
  assert.deepEqual(collectMaterial({ cwd, after, weeklyFile: path }), {
    material: '场景,确认通道尺寸', files: [path],
  });
  assert.equal(collectMaterial({ cwd, after, weeklyFile: '' }), null);
  for (const weeklyFile of ['outside.md', inbox + '../outside.md', inbox + '/电视.txt',
    '/tmp/电视.txt', inbox + 'link.md', inbox + 'executable.txt', inbox + 'missing.md', inbox + 'README.md',
    inbox + 'unsafe\\name.md', inbox + '*.txt', inbox + 'Excel.xlsx']) {
    assert.throws(() => collectMaterial({ cwd, after, weeklyFile }), Error, weeklyFile);
  }
});

test('rejects malformed, empty or credential-shaped material without disclosing its content', t => {
  const { cwd, write, commit } = repository(t);
  const cases = [
    [Buffer.from([0xe4, 0xb8]), 'INBOX_INVALID_UTF8'],
    [' \t\r\n', 'INBOX_INVALID_MATERIAL'],
    ['输入\u0000结尾', 'INBOX_INVALID_MATERIAL'],
    ['输入\u202e结尾', 'INBOX_INVALID_MATERIAL'],
    [['sk', 'syntheticUnitTestValueOnly'].join('-'), 'INBOX_INVALID_MATERIAL'],
  ];
  let before = commit();
  for (const [index, [content, code]] of cases.entries()) {
    write(inbox + index + '.txt', content);
    const after = commit();
    assert.throws(() => collectMaterial({ cwd, before, after }), { code, message: code });
    before = after;
  }
});

test('limits the entire batch including separators and counts UTF-16 units', t => {
  const { cwd, write, commit } = repository(t);
  const baseline = commit();
  const path = inbox + '边界.txt';
  write(path, '电'.repeat(20_000));
  const exactly = commit();
  assert.equal(collectMaterial({ cwd, before: baseline, after: exactly }).material.length, 20_000);
  write(inbox + 'b.md', '字');
  assert.throws(() => collectMaterial({ cwd, before: baseline, after: commit() }), { code: 'INBOX_TOO_LARGE' });
  write(path, '📺'.repeat(10_001));
  assert.throws(() => collectMaterial({ cwd, weeklyFile: path, after: commit() }), { code: 'INBOX_TOO_LARGE' });
  write(path, Buffer.alloc(65_000, 97));
  assert.throws(() => collectMaterial({ cwd, weeklyFile: path, after: commit() }), { code: 'INBOX_TOO_LARGE' });
});

test('rejects non-commit objects, unbounded revisions and unsafe filenames', t => {
  const { cwd, git, write, commit } = repository(t);
  const path = inbox + '有效.txt';
  write(path, '公开商品卖点');
  const before = commit();
  write(inbox + 'bad\nname.txt', '业务说明');
  const after = commit();
  assert.throws(() => collectMaterial({ cwd, before, after }), { code: 'INBOX_INVALID_PATH' });
  for (const id of ['HEAD', '--all', '0'.repeat(40), git('rev-parse', before + ':' + path)]) {
    assert.throws(() => collectMaterial({ cwd, before: id, after }), { code: 'INBOX_INVALID_COMMIT' });
    assert.throws(() => collectMaterial({ cwd, before, after: id }), { code: 'INBOX_INVALID_COMMIT' });
  }
});
