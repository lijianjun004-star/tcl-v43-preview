import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL('../cloudbase/' + name, import.meta.url), 'utf8');

test('the optional limit migration raises the shared daily cap from 20 to 10000', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(await migration('schema-ai-drafts.sql'));
  const reserve = async limit => (await db.query('select public.tcl_r24_sync_v1_reserve_ai_draft($1) as ok', [limit])).rows[0].ok;

  await assert.rejects(reserve(21), {code: '22023'});
  const limit = await migration('schema-ai-drafts-limit.sql');
  await db.exec(limit);
  await db.exec(limit);
  for (const bad of [0, 10001]) await assert.rejects(reserve(bad), {code: '22023'});
  for (let i = 0; i < 25; i++) assert.equal(await reserve(25), true);
  assert.equal(await reserve(25), false);
  assert.equal(await reserve(26), true);
  await assert.rejects(db.query('update public.tcl_r24_sync_v1_ai_draft_quota set reserved_calls = 10001'), {code: '23514'});

  await db.exec('set role service_role');
  await assert.rejects(db.query('select * from public.tcl_r24_sync_v1_ai_draft_quota'), {code: '42501'});
  assert.equal(await reserve(26), false);
});
