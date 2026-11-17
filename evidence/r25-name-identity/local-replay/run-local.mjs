/** Local-only replay. No CloudBase SDK, credentials or remote services are used. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../../..');
const args=process.argv.slice(2);
let deps=here;
for(let i=0;i<args.length;i++){
  if(args[i]==='--deps'&&args[i+1])deps=path.resolve(args[++i]);
  else throw new Error('Usage: node run-local.mjs [--deps DIRECTORY_CONTAINING_node_modules]');
}
await fs.access(path.join(deps,'node_modules/@electric-sql/pglite/package.json'));
await fs.access(path.join(deps,'node_modules/embedded-postgres/package.json'));
const stage=await fs.mkdtemp(path.join(os.tmpdir(),'r25ni-replay-'));
await fs.symlink(path.join(deps,'node_modules'),path.join(stage,'node_modules'),'dir');
const escapeForSingleQuote=value=>value.replaceAll('\\','\\\\').replaceAll("'","\\'").replaceAll('\n','\\n').replaceAll('\r','\\r');
for(const name of await fs.readdir(path.join(here,'source'))){
  const original=await fs.readFile(path.join(here,'source',name),'utf8');
  // Only filesystem locations are adapted in temporary copies. Source snapshots stay byte-identical.
  const adapted=original.replaceAll('/workspace/tcl-r25-name-login',escapeForSingleQuote(repo))
    .replaceAll('/workspace/r25-name-identity-tests',escapeForSingleQuote(stage));
  await fs.writeFile(path.join(stage,name),adapted);
}
const summary={scope:'Local actual PostgreSQL/PGlite; mocked Auth and Native. No cloud calls.',
  startedAt:new Date().toISOString(),outputDirectory:stage,pathAdaptationOnly:true,suites:[],sourceHashes:{}};
for(const name of ['backend/r25-cloudbase/schema.sql','backend/r25-name-identity/001-name-identity.sql','backend/r25-name-identity/handler.cjs']){
  summary.sourceHashes[name]=crypto.createHash('sha256').update(await fs.readFile(path.join(repo,name))).digest('hex');
}
const suites=[
  ['service-test.mjs','service-result.json',102],
  ['handler-test.mjs','handler-result.json',48],
  ['namespace-test.mjs','namespace-result.json',17],
  ['historical-alias-precedence-test.mjs','historical-alias-precedence-result.json',7],
  ['real-pg-concurrency.mjs','real-pg-concurrency-result.json',19]
];
let allPassed=true;
for(const [script,resultName,expectedChecks] of suites){
  const run=spawnSync(process.execPath,[path.join(stage,script)],{
    cwd:stage,env:{...process.env,IDENTITY_HANDLER:path.join(repo,'backend/r25-name-identity/handler.cjs')},
    encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024
  });
  await fs.writeFile(path.join(stage,script+'.stdout.log'),run.stdout||'');
  await fs.writeFile(path.join(stage,script+'.stderr.log'),run.stderr||'');
  let result;
  try{result=JSON.parse(await fs.readFile(path.join(stage,resultName),'utf8'))}catch{}
  const passed=run.status===0&&result?.status==='PASS'&&result.cloudCalls===0
    &&result.checks?.length===expectedChecks&&result.checks.every(check=>check.pass===true);
  summary.suites.push({script,exitCode:run.status,status:passed?'PASS':'FAIL',
    checks:result?.checks?.length??null,expectedChecks,cloudCalls:result?.cloudCalls??null,
    ...(run.error?{processErrorCode:run.error.code||'PROCESS_ERROR'}:{})});
  if(!passed){allPassed=false;break;}
}
summary.status=allPassed?'PASS':'FAIL';
summary.completedAt=new Date().toISOString();
await fs.writeFile(path.join(stage,'replay-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
process.exitCode=allPassed?0:1;
