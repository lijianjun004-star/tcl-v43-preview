// Actual app function bodies with deferred storage I/O; no browser/device claims.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const app = fs.readFileSync(path.join(__dirname, '../tcl-v352-asr-r24-qa/app.js'), 'utf8');
const start = app.indexOf('let assignmentPublishPending=');
assert.ok(start >= 0, 'assignment lifecycle guards must be present');
const code = app.slice(start, app.indexOf('function renderAnchorLookup(', start));
function fixture(role = 'operator') {
  const context = vm.createContext({console});
  vm.runInContext(`
    let userRole=${JSON.stringify(role)},userName='owner-A',page='home',localAssignments=[],localAssignmentJoins=[],operatorActiveTab='publish',activeAssignmentId='',selectedBoard='',activePlatform='',serial=0;
    const writes=[],notices=[],renders=[],opens=[];
    const elements={view:{firstElementChild:{}},publishAssignment:{disabled:false,isConnected:true},assignmentTitle:{value:'任务'},assignmentBoard:{value:'01'},assignmentPlatform:{value:'京东'},assignmentDeadline:{value:''}};
    const ELEM=id=>elements[id],uid=()=> 'id-'+(++serial),nowIso=()=>new Date().toISOString(),toast=t=>notices.push(t),operatorHome=()=>renders.push({role:userRole,name:userName});
    const updatePrefList=(key,mutate)=>new Promise((resolve,reject)=>writes.push({key,mutate,resolve,reject}));
    const assignment={id:'task',boardId:'01',platform:'京东',operatorName:'ops'};
    const assignmentById=id=>id==='task'?assignment:null,assignmentExpired=()=>false,pageAllowed=()=>true,canLeaveRecording=()=>true;
    const openBoard=(board,platform)=>opens.push({board,platform,role:userRole,name:userName});
    function complete(i=0,list=[]){writes[i].resolve(writes[i].mutate(list));}
  ` + code, context);
  return source => vm.runInContext(source, context);
}
(async () => {
  let checks = 0;
  {
    const run = fixture();
    const first = run('publishAssignment()'), second = run('publishAssignment()');
    assert.equal(run('writes.length'), 1);
    assert.equal(run('elements.publishAssignment.disabled'), true);
    run('complete()'); await Promise.all([first, second]);
    assert.equal(run('localAssignments.length'), 1);
    assert.equal(run('renders.length'), 1);
    assert.equal(run('assignmentPublishPending'), false); checks++;
  }
  {
    const run = fixture(), job = run('publishAssignment()');
    run("userRole='anchor';userName='owner-B';complete()"); await job;
    assert.equal(run('renders.length'), 0);
    assert.equal(run('localAssignments[0].operatorName'), 'owner-A'); checks++;
  }
  {
    const run = fixture(), job = run('publishAssignment()');
    run('elements.view.firstElementChild={};complete()'); await job;
    assert.equal(run('renders.length'), 0); checks++;
  }
  {
    const run = fixture(), job = run('publishAssignment()');
    run("writes[0].reject(new Error('QuotaExceededError'))"); await job;
    assert.equal(run('localAssignments.length'), 0);
    assert.equal(run('renders.length'), 0);
    assert.equal(run('assignmentPublishPending'), false);
    assert.equal(run('elements.publishAssignment.disabled'), false);
    assert.match(run('notices.at(-1)'), /作业未保存/); checks++;
  }
  {
    const run = fixture();run("elements.assignmentDeadline.value='invalid-date'");
    await run('publishAssignment()'); assert.equal(run('writes.length'), 0);
    assert.match(run('notices.at(-1)'), /截止时间无效/); checks++;
  }
  {
    const run = fixture('anchor');
    const first = run("joinAssignment('task')"), second = run("joinAssignment('task')");
    assert.equal(run('writes.length'), 1);run('complete()');await Promise.all([first, second]);
    assert.equal(run('opens.length'), 1);
    assert.equal(run('localAssignmentJoins[0].anchorName'), 'owner-A'); checks++;
  }
  {
    const run = fixture('anchor'), job = run("joinAssignment('task')");
    run("userName='owner-B';complete()");await job;
    assert.equal(run('opens.length'), 0);assert.equal(run('activeAssignmentId'), '');
    assert.equal(run('localAssignmentJoins[0].anchorName'), 'owner-A'); checks++;
  }
  {
    const run = fixture('anchor'), job = run("joinAssignment('task')");
    run("writes[0].reject(new Error('QuotaExceededError'))");await job;
    assert.equal(run('opens.length'), 0);assert.equal(run('localAssignmentJoins.length'), 0);
    assert.equal(run('assignmentJoinPending'), false);assert.match(run('notices.at(-1)'), /加入记录未保存/);checks++;
  }
  console.log(JSON.stringify({status:'PASS',checks,mode:'Node VM real app assignment functions; deferred mock IDB'},null,2));
})().catch(error => {console.error(error);process.exitCode=1;});
