import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {lstat, readFile} from 'node:fs/promises';
import {makeAssignment} from '../../backend/vendor/assignment-excel.mjs';

const origin = 'https://unknown-roadrunner-d7cap6e21f517-1519058345.tcloudbaseapp.com';
const base = 'https://unknown-roadrunner-d7cap6e21f517-1519058345.ap-shanghai.app.tcloudbase.com/tcl-r24-sync';
const auth = 'https://unknown-roadrunner-d7cap6e21f517.api.tcloudbasegateway.com/auth/v1/signin';
const credentialsPath = process.env.TCL_PILOT_CREDENTIALS_FILE;
assert.ok(credentialsPath, 'Set TCL_PILOT_CREDENTIALS_FILE to a private test account file');
const credentialFile = await lstat(credentialsPath);
assert.ok(credentialFile.isFile() && (credentialFile.mode & 0o077) === 0);
const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
const checks = [];
let stage = 'auth', assignmentId, sessionId;
async function request(url, method, headers, body) {
  const response = await fetch(url, {method, headers, body, redirect:'error', signal:AbortSignal.timeout(20_000)});
  return {status:response.status, data:await response.json()};
}
async function login(account){
  const {status,data} = await request(auth,'POST',{'x-device-id':randomUUID(),'Content-Type':'application/json',Origin:origin},
    JSON.stringify({username:account.username,password:account.password}));
  assert.equal(status,200);
  assert.ok(data.access_token);
  return data.access_token;
}
async function call(token, path, method='GET', content) {
  return request(base+path,method,{Origin:origin,...token&&{Authorization:'Bearer '+token},...content!==undefined&&{'Content-Type':'application/json'}},
    content===undefined?undefined:JSON.stringify(content));
}
function expect(response, status) {
  if (response.status!==status) throw Object.assign(new Error('unexpected HTTP status'),{
    http:response.status, code:response.data?.error?.code});
  return response.data;
}
try {
  const [operator, anchor] = await Promise.all([login(credentials.operator),login(credentials.anchor)]);
  expect(await call(null,'/me'),401);
  assert.equal(expect(await call(operator,'/me'),200).principal.role,'operator');
  assert.equal(expect(await call(anchor,'/me'),200).principal.role,'anchor');
  checks.push('CloudBase Auth and database-driven identities');
  stage='publish';
  assignmentId=randomUUID();
  const assignment=await makeAssignment({id:assignmentId,title:'R24试点公网接口验收 · 合成三题',
    operatorName:credentials.operator.displayName,boardId:'01',platform:'京东',createdAt:new Date().toISOString(),
    assignedTo:[],questions:[1,2,3].map(x=>({ category:'TCL 电视',
      question:'验收合成测试机型 A'+x+' 有什么功能？',answer:'本题仅用于接口验收，模拟说明。',model:'TEST-A'+x,sku:'pilot'+x }))});
  expect(await call(anchor,'/assignments','POST',{assignment,recipientIds:[]}),403);
  const published=expect(await call(operator,'/assignments','POST',{assignment,recipientIds:[]}),201);
  assert.equal(published.assignment.snapshotSha256,assignment.snapshotSha256);
  const assigned=expect(await call(anchor,'/assignments'),200).assignments.find(row=>row.assignment.id===assignmentId);
  assert.equal(assigned.assignment.snapshotSha256,assignment.snapshotSha256);
  assert.equal(assigned.submitted,false);
  checks.push('Operator published and anchor fetched identical frozen questions');
  stage='submit';
  sessionId=randomUUID();
  const turns=assigned.assignment.questions.map(({id,question,model,sku},x)=>({questionId:id,question,model,sku,
    answer:'合成答复第'+(x+1)+'题，供试点验收。',transcript:'',asrStatus:'文字测试'}));
  const path='/assignments/'+assignmentId+'/submissions';
  const snapshot={id:sessionId,assignmentId,assignmentVersion:assignment.version,
    assignmentSnapshotSha256:assignment.snapshotSha256,operatorName:assignment.operatorName,
    boardId:assignment.boardId,platform:assignment.platform,anchorName:credentials.anchor.displayName,turns};
  const received=expect(await call(anchor,path,'POST',{snapshot}),201).submission;
  const replayed=expect(await call(anchor,path,'POST',{snapshot}),200);
  assert.equal(replayed.replayed,true);
  assert.equal(replayed.submission.id,received.id);
  assert.equal(replayed.submission.submittedAt,received.submittedAt);
  checks.push('Real PostgreSQL submission and same-session idempotent retry');
  stage='inbox';
  expect(await call(anchor,path),403);
  const {submissions}=expect(await call(operator,path),200);
  assert.equal(submissions.length,1);
  assert.deepEqual(submissions[0].turns.map(row=>row.answer),turns.map(row=>row.answer));
  assert.ok(expect(await call(anchor,'/assignments'),200).assignments.find(row=>row.assignment.id===assignmentId).submitted);
  checks.push('Publisher inbox contains one exact submission; anchor cannot read publisher inbox');
  console.log(JSON.stringify({pass:true,assignmentId,sessionId,checks}));
} catch (error) {
  console.error(JSON.stringify({pass:false,stage,assignmentId,sessionId,checks,http:error.http,code:error.code,name:error.name}));
  process.exitCode=1;
}
