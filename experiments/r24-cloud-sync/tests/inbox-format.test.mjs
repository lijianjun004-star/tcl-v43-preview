import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectSensitive, readMetadata } from '../scripts/inbox-format.mjs';

const material = '请对照京东商品页面核实安装范围。';
const defaults = {category: '电视', platform: '京东', count: 10, model: 'gpt-4o-mini'};
const path = 'materials-inbox/卖点.txt';

test('ordinary names use defaults and preserve the text and CSV or TSV body', () => {
  assert.deepEqual(readMetadata({path, text: material}), {...defaults, material});
  const markdown = '---\n\n# 安装须知\n' + material;
  assert.equal(readMetadata({path, text: markdown}).material, markdown);
  const sheet = '品类\t平台\r\n电视\t抖音';
  assert.deepEqual(readMetadata({path: path + '.tsv', text: sheet}),
    {...defaults, material: sheet.replace('\r\n', '\n')});
});

test('reads filename and leading metadata, preferring a valid header over filename defaults', () => {
  const file = 'materials-inbox/公开/空调_天猫_50题_节能_送装.TXT';
  const fields = readMetadata({path: file, text: material});
  assert.deepEqual(fields, {...defaults, category: '空调', platform: '天猫', count: 50, material});
  const frontmatter = '\ufeff---\r\n# 编辑说明\r\nplatform: "抖音"\r\ncount: 1\r\n---\r\n' + material;
  assert.deepEqual(readMetadata({path: file, text: frontmatter}),
    {...fields, platform: '抖音', count: 1});
  const commented = '# category: 冰箱\n// platform: 抖音\ncount: 15\nmodel: gpt-4o\n\n' + material;
  assert.deepEqual(readMetadata({path, text: commented}),
    {category: '冰箱', platform: '抖音', count: 15, model: 'gpt-4o', material});
  const body = material + '\nplatform: 这是正文';
  assert.equal(readMetadata({path, text: body}).material, body);
});

test('invalid declared filename or header fields fail without exposing their values', () => {
  for (const [file, firstLine, expected] of [
    ['电视_拼多多_10题_卖点.txt', 'platform: 京东', 'PLATFORM'],
    ['电视_抖音_0题_卖点.txt', '', 'COUNT'],
    ['电视_天猫_51题_卖点.txt', '', 'COUNT'],
    ['电视_京东_十题_卖点.txt', '', 'COUNT'],
    ['test.txt', 'platform: 拼多多', 'PLATFORM'],
    ['test.txt', 'category: ＝测试', 'CATEGORY'],
    ['test.txt', 'count: 3.5', 'COUNT'],
    ['test.txt', 'model: 未授权模型', 'MODEL'],
    ['test.txt', 'platform: 京东\nplatform: 天猫', 'METADATA'],
    ['test.txt', '---\ncount: 10', 'METADATA'],
  ]) {
    assert.throws(() => readMetadata({path: 'materials-inbox/' + file, text: firstLine + '\n' + material}),
      {message: 'INBOX_INVALID_' + expected});
  }
  assert.throws(() => readMetadata({path, text: 'count: 1'}), {code: 'INBOX_INVALID_MATERIAL'});
});

test('privacy categories include input in names and omitted headers, without sensitive literals in errors', () => {
  for (const [value, category] of [
    ['sk-' + 'fixture', 'API_KEY'],
    ['sk_' + 'fixture', 'API_KEY'],
    ['１３９' + '００００００００', 'MOBILE'],
    ['+86139' + '00000000', 'MOBILE'],
    ['000000' + '20000101' + '123X', 'IDENTITY'],
    ['000000' + '20000101' + '1234', 'IDENTITY'],
    ['fixture+qa' + '@example.invalid', 'EMAIL'],
    ['Bearer ' + 'fixture', 'CREDENTIAL'],
  ]) {
    assert.equal(detectSensitive('样例' + value + '。'), category);
    for (const input of [
      {path: 'materials-inbox/' + value + '.txt', text: material},
      {path, text: '---\n# ' + value + '\n---\n' + material},
    ]) assert.throws(() => readMetadata(input), {message: 'INBOX_SENSITIVE_' + category});
  }
  assert.equal(detectSensitive('型号 98T5M，净重按产品页确认。'), null);
});
