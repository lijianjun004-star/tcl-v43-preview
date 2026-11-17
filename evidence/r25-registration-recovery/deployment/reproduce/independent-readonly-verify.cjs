'use strict';
// Independent read-only verification. No migration/function/deployment calls.
// Run only after the deploying agent confirms backend mutations have completed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { manager, sql, first, save, PRIVATE, ENV } = require('./cloud-utils.cjs');

const SOURCE = '/workspace/tcl-r25-fix/backend/r25-name-identity/003-registration-recovery.sql';
const TABLES = [
  'r25wf_users', 'r25wf_settings', 'r25wf_invites', 'r25wf_assignments',
  'r25wf_joins', 'r25wf_training', 'r25wf_submissions', 'r25wf_submission_media',
  'r25wf_feedback', 'r25wf_idempotency', 'r25wf_native_identities',
  'r25wf_name_aliases', 'r25wf_name_conflicts', 'r25wf_name_registrations'
];
const FUNCTIONS = [
  ['r25wf_name_identity_service', 'public.r25wf_name_identity_service(text,jsonb)', 'name_api'],
  ['r25wf_name_recovery_rotate', 'public.r25wf_name_recovery_rotate(jsonb)', 'recovery']
];

function sourceBodyHash(source, delimiter) {
  const opening = 'AS $' + delimiter + '$';
  const closing = '$' + delimiter + '$;';
  assert.equal(source.split(opening).length, 2, 'Source function opening must be unique');
  const after = source.split(opening)[1];
  assert.ok(after.includes(closing), 'Source function closing missing');
  return crypto.createHash('md5').update(after.split(closing)[0], 'utf8').digest('hex');
}

function counts(values) {
  const result = new Map();
  for (const value of values) {
    assert.match(value, /^[a-f0-9]{32}$/);
    result.set(value, (result.get(value) || 0) + 1);
  }
  return result;
}

async function main() {
  const source = fs.readFileSync(SOURCE, 'utf8');
  const original = JSON.parse(fs.readFileSync(path.join(PRIVATE, 'original-business-hashes.json'), 'utf8'));
  assert.deepEqual(Object.keys(original).sort(), [...TABLES].sort(), 'Original snapshot table coverage differs');
  for (const table of TABLES) assert.ok(Array.isArray(original[table]), 'Invalid original table snapshot');

  // All identifiers are hard-coded. The single SELECT observes one PG snapshot.
  const snapshots = TABLES.map(table => `'${table}',(SELECT coalesce(jsonb_agg(md5(row_to_json(t)::text) ORDER BY md5(row_to_json(t)::text)),'[]'::jsonb) FROM public.${table} t)`);
  const functionIds = FUNCTIONS.map(([, signature]) => `to_regprocedure('${signature}')`).join(',');
  const query = `SELECT jsonb_build_object(
    'functions',(SELECT jsonb_object_agg(p.proname,jsonb_build_object(
      'bodyMd5',md5(p.prosrc),'securityDefiner',p.prosecdef,
      'config',p.proconfig,
      'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service',has_function_privilege('service_role',p.oid,'EXECUTE'),
      'publicExecute',EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
    )) FROM pg_proc p WHERE p.oid IN (${functionIds})),
    'inviteColumns',(SELECT jsonb_object_agg(column_name,is_nullable)
      FROM information_schema.columns WHERE table_schema='public'
      AND table_name='r25wf_name_registrations' AND column_name IN ('invite_id','invite_hash')),
    'tables',jsonb_build_object(${snapshots.join(',')})
  )::text AS result`;
  const m = await manager();
  const current = first(await sql(m, query));
  assert.ok(current && typeof current === 'object', 'Missing read-only query result');
  assert.deepEqual(Object.keys(current.functions || {}).sort(), FUNCTIONS.map(([name]) => name).sort(), 'Live functions missing');
  for (const [name, , delimiter] of FUNCTIONS) {
    const actual = current.functions[name];
    assert.equal(actual.bodyMd5, sourceBodyHash(source, delimiter), 'Function source mismatch: ' + name);
    assert.equal(actual.securityDefiner, true, 'SECURITY DEFINER differs: ' + name);
    assert.ok(Array.isArray(actual.config) && actual.config.some(value => value.replace(/\s/g, '') === 'search_path=pg_catalog,public'), 'Search path differs: ' + name);
    for (const [key, expected] of Object.entries({ anon: false, authenticated: false, service: true, publicExecute: false })) {
      assert.equal(actual[key], expected, 'Function grant differs: ' + name + '/' + key);
    }
  }
  assert.deepEqual(current.inviteColumns, { invite_hash: 'YES', invite_id: 'YES' }, 'Direct registration columns are not both nullable');
  assert.deepEqual(Object.keys(current.tables || {}).sort(), [...TABLES].sort(), 'Live table coverage differs');
  let originalRows = 0;
  for (const table of TABLES) {
    assert.ok(Array.isArray(current.tables[table]), 'Missing current table hashes');
    const before = counts(original[table]), after = counts(current.tables[table]);
    for (const [hash, count] of before) assert.ok((after.get(hash) || 0) >= count, 'Original row altered or removed: ' + table);
    originalRows += original[table].length;
  }
  const aggregate = {
    status: 'PASS', scope: 'Independent read-only final PostgreSQL verification',
    envId: ENV, verifiedAt: new Date().toISOString(), cloudWrites: 0,
    exactFunctionBodies: FUNCTIONS.length, functionGrantsPassed: true,
    securityDefinerAndSearchPathPassed: true, directColumnsNullable: true,
    originalTablesChecked: TABLES.length, originalRowsPreserved: originalRows,
    includesBusinessAndIdentityTables: true,
    limitations: ['Does not verify Native Auth API or browser/mobile flows', 'Additional synthetic rows are allowed; original rows must remain byte-equivalent by row MD5']
  };
  save('independent-readonly-verification.json', aggregate);
  process.stdout.write(JSON.stringify(aggregate) + '\n');
}

if (require.main === module) main().catch(error => {
  const code = typeof error.code === 'string' && /^[A-Za-z0-9_.-]{1,96}$/.test(error.code) ? error.code : 'READONLY_VERIFICATION_FAILED';
  const aggregate = { status: 'FAIL', scope: 'Independent read-only final PostgreSQL verification', code, cloudWrites: 0, verifiedAt: new Date().toISOString() };
  // No row hashes, SQL responses, credentials or raw provider error messages.
  save('independent-readonly-verification.json', aggregate);
  process.stderr.write(JSON.stringify(aggregate) + '\n');
  process.exitCode = 1;
});

module.exports = { main, sourceBodyHash, counts };
