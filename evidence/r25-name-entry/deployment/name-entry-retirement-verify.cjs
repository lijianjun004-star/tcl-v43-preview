'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { management, pg } = require('./accept-cloud.cjs');
const envId = 'unknown-roadrunner-d7cap6e21f517';
const sqlText = value => `convert_from(decode('${Buffer.from(value).toString('base64')}','base64'),'UTF8')`;
async function run(dirs) {
  const m = await management();
  let checked = 0;
  for (const dir of dirs) {
    const f = JSON.parse(fs.readFileSync(path.join(dir, 'fixture.json'), 'utf8'));
    const id = /^nameentry-([a-f0-9]{14})$/.exec(f.fixtureId)?.[1];
    assert.ok(id && f.testOnly && f.envId === envId && f.accounts.length === 2);
    for (const a of f.accounts) {
      assert.equal(a.name, `R25姓名验收${id}_${a.role}`);
      const row = await pg(m, `SELECT jsonb_build_object('uid',r.uid,'username',r.native_username,'marker',r.native_marker,'role',u.role,'active',u.active,'name',u.display_name)::text AS result FROM public.r25wf_name_registrations r JOIN public.r25wf_users u ON u.uid=r.uid WHERE r.operation_id=${sqlText(a.operationId)}`);
      assert.ok(row.uid === a.uid && row.name === a.name && row.role === a.role && row.username === a.username && row.active === false);
      const r = await m.user.describeUserList({ name: a.username, pageNo: 1, pageSize: 100 });
      const matched = r.Data.UserList.filter(x => x.Name === a.username);
      assert.ok(matched.length === 1 && String(matched[0].Uid) === a.uid && matched[0].Description === row.marker && matched[0].UserStatus === 'BLOCKED');
      checked++;
    }
  }
  console.log(JSON.stringify({ status: 'PASS', nativeBlocked: checked, businessInactive: checked, deletedRows: 0 }));
}
if (process.argv.length > 2) run(process.argv.slice(2)).catch(error => {
  console.error(JSON.stringify({ status: 'FAIL', code: error.code || error.name }));
  process.exitCode = 1;
});
