'use strict';
// Management operations are restricted to the synthetic identities generated
// by name-entry-accept.py. No cloud calls without an explicit operation.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { management, pg } = require('./accept-cloud.cjs');
const { prepare, verifyAndApply } = require('/workspace/tcl-r25-name-entry/backend/r25-name-identity/prepare-device-recovery.cjs');
const envId = 'unknown-roadrunner-d7cap6e21f517';
const sqlText = value => `convert_from(decode('${Buffer.from(value).toString('base64')}','base64'),'UTF8')`;

async function run(action, directory) {
  const file = path.join(directory, 'fixture.json');
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077));
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(fixture.testOnly && fixture.executionApproved && fixture.envId === envId);
  const runId = /^nameentry-([a-f0-9]{14})$/.exec(fixture.fixtureId)?.[1];
  assert.ok(runId && fixture.accounts?.length === 2);
  const managementApi = await management();
  const accounts = [];
  for (const account of fixture.accounts) {
    assert.ok(['anchor', 'operator'].includes(account.role) && account.role === account.alias);
    assert.equal(account.name, `R25姓名验收${runId}_${account.role}`);
    if (!account.operationId) continue;
    const row = await pg(managementApi, `SELECT jsonb_build_object('uid', uid, 'name', display_name, 'role', role, 'username', native_username, 'nativeMarker', native_marker, 'state', state)::text AS result FROM public.r25wf_name_registrations WHERE operation_id=${sqlText(account.operationId)}`);
    assert.ok(row && row.name === account.name && row.role === account.role && row.state === 'ready');
    assert.ok(/^r25n_[a-f0-9]{24}$/.test(row.username) && /^r25wf-name-v1:[a-f0-9-]{36}$/.test(row.nativeMarker));
    assert.ok(row.uid && (!account.uid || account.uid === row.uid) && (!account.username || account.username === row.username));
    const native = await managementApi.user.describeUserList({ name: row.username, pageNo: 1, pageSize: 100 });
    const exact = native?.Data?.UserList?.filter(item => item.Name === row.username);
    assert.ok(exact?.length === 1 && String(exact[0].Uid) === row.uid && exact[0].Description === row.nativeMarker && exact[0].Type === 'externalUser');
    accounts.push(row);
  }
  if (action === '--rotate-anchor') {
    const { state, ...account } = accounts.find(item => item.role === 'anchor');
    const plan = prepare({ envId, ...account });
    fs.writeFileSync(path.join(directory, 'anchor-device-code.txt'), plan.code + '\n', { mode: 0o600, flag: 'wx' });
    await verifyAndApply({ ...plan, manager: managementApi });
    console.log(JSON.stringify({ status: 'SYNTHETIC_ANCHOR_DEVICE_CODE_READY' }));
    return;
  }
  for (const account of accounts) {
    const modified = await managementApi.user.modifyUser({ uid: account.uid, userStatus: 'BLOCKED' });
    assert.equal(modified?.Data?.Success, true);
    const updated = await pg(managementApi, `WITH changed AS (UPDATE public.r25wf_users SET active=false WHERE uid=${sqlText(account.uid)} AND display_name=${sqlText(account.name)} AND role=${sqlText(account.role)} RETURNING uid) SELECT jsonb_build_object('count',count(*))::text AS result FROM changed`);
    assert.equal(Number(updated.count), 1);
  }
  console.log(JSON.stringify({ status: 'SYNTHETIC_SCOPE_RETIRED', accounts: accounts.length }));
}

const [action, directory] = process.argv.slice(2);
if (['--retire', '--rotate-anchor'].includes(action) && directory) {
  run(action, directory).catch(error => {
    console.error(JSON.stringify({ status: 'FAIL', code: error.code || error.name }));
    process.exitCode = 1;
  });
} else {
  console.log(JSON.stringify({ status: 'DRY_RUN_ZERO_NETWORK' }));
}
