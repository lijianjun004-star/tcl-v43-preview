import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../scripts/inbox-export.mjs', import.meta.url));

function runner(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'r24-runner-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const cwd = join(root, 'repo');
  const temp = join(root, 'runner');
  mkdirSync(join(cwd, 'materials-inbox'), {recursive: true});
  mkdirSync(temp);
  const git = (...args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const commit = () => {
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'test');
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  const before = commit();
  for (const [name, value] of files) writeFileSync(join(cwd, 'materials-inbox', name), value);
  git('add', '.');
  const after = commit();
  const ref = 'refs/heads/main';
  const env = {PATH: process.env.PATH, RUNNER_TEMP: temp, GITHUB_ACTIONS: 'true',
    GITHUB_RUN_ATTEMPT: '1', GITHUB_REF: ref, GITHUB_SHA: after, GITHUB_EVENT_PATH: join(root, 'event'),
    GITHUB_OUTPUT: join(root, 'output'), GITHUB_STEP_SUMMARY: join(root, 'summary')};
  function run(mode, eventName, payload, extra) {
    writeFileSync(env.GITHUB_EVENT_PATH, JSON.stringify(payload));
    writeFileSync(env.GITHUB_OUTPUT, '');
    return spawnSync(process.execPath, [cli, mode], {cwd, encoding: 'utf8',
      env: {...env, GITHUB_EVENT_NAME: eventName, ...extra}});
  }
  return {run, temp, output: env.GITHUB_OUTPUT, summary: env.GITHUB_STEP_SUMMARY, push: {ref, before, after}};
}

test('automatic switch is exact and a disabled push leaves no billable generation step', t => {
  const {run, push, output, summary, temp} = runner(t, [['电视.txt', '大屏安装说明']]);
  for (const value of ['', 'false', 'TRUE']) {
    const result = run('prepare', 'push', push, {R24_INBOX_AUTO_ENABLED: value});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), '');
    assert.match(readFileSync(summary, 'utf8'), /未启用，模型请求为 0/u);
    assert.deepEqual(readdirSync(temp), []);
  }
  const result = run('prepare', 'push', push, {R24_INBOX_AUTO_ENABLED: 'true'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(output, 'utf8'), 'mode=live\n');
});

test('sensitive CLI failures print only category and the safe filename', t => {
  const bad = 'user' + '@' + 'example.invalid';
  const {run, push, temp} = runner(t, [['送装资料.txt', bad], [bad + '.md', '测试资料']]);
  for (const [name, expected] of [['送装资料.txt', 'materials-inbox/送装资料.txt'], [bad + '.md', '[文件名已隐藏]']]) {
    const result = run('prepare', 'workflow_dispatch', {ref: push.ref, inputs: {file: 'materials-inbox/' + name}});
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), 'INBOX_SENSITIVE_EMAIL ' + JSON.stringify(expected));
    assert.equal(result.stdout, '');
    assert.deepEqual(readdirSync(temp), []);
  }
});

test('manual selected-file dry run needs no secret and escapes summary cells', t => {
  const path = 'materials-inbox/名称[1]|表.txt';
  const material = 'category: 电视<测试>\ncount: 1\n怎样确认入户条件？';
  const r = runner(t, [[path.slice('materials-inbox/'.length), material]]);
  const payload = {ref: r.push.ref, inputs: {file: path, dry_run: 'true'}};
  const preflight = r.run('prepare', 'workflow_dispatch', payload);
  assert.equal(preflight.status, 0, preflight.stderr);
  assert.equal(readFileSync(r.output, 'utf8'), 'mode=dry\n');
  assert.equal(r.run('live', 'workflow_dispatch', payload).status, 1);
  const result = r.run('dry', 'workflow_dispatch', payload);
  assert.equal(result.status, 0, result.stderr);
  const files = readdirSync(join(r.temp, 'r24-inbox-review/01')).sort();
  assert.deepEqual(files, ['questions.json', 'questions.tsv', 'questions.xlsx', 'run-summary.json']);
  const summary = readFileSync(r.summary, 'utf8');
  assert.ok(!summary.includes(path) && !summary.includes('<测试>'));
  assert.match(summary, /名称&#91;1&#93;&#124;表/u);
  assert.match(summary, /\| 0 \| [\da-f]{64} \|/u);
});

test('weekly selector uses a safe name index and the weekly job also honors the switch', t => {
  const bad = 'tester' + '@' + 'example.invalid';
  const r = runner(t, [['每周.txt', '请说明安装范围'], [bad + '.txt', '不放入公开索引']]);
  const payload = {schedule: '0 1 * * 1'};
  const index = r.run('weekly-index', 'schedule', payload);
  assert.equal(index.status, 0, index.stderr);
  const lookup = JSON.parse(readFileSync(r.output, 'utf8').trim().slice('lookup='.length));
  assert.deepEqual(Object.keys(lookup), ['materials-inbox/每周.txt']);
  assert.equal(r.run('prepare', 'schedule', payload).status, 0);
  assert.ok(!existsSync(join(r.temp, 'r24-inbox-prepared.json')));
  assert.equal(r.run('prepare', 'schedule', payload, {R24_INBOX_AUTO_ENABLED: 'true', R24_WEEKLY_INDEX: '99'}).status, 1);
  const result = r.run('prepare', 'schedule', payload, {R24_INBOX_AUTO_ENABLED: 'true', R24_WEEKLY_INDEX: lookup['materials-inbox/每周.txt']});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(r.output, 'utf8'), 'mode=live\n');
});
