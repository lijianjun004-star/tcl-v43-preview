const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const src = fs.readFileSync(process.argv[2] || './tcl-specialty-v33/app.js', 'utf8');
const from = src.indexOf('function cancelChatTimer(){');
const to = src.indexOf('function addChat(', from);
assert(from >= 0 && to > from, 'timer functions not found');
let checks = 0;
function scenario(interval) {
  let now = 0, next = 0, pending = new Map(), events = [];
  const ctx = {
    chatTimer: null, chatExtraTimers: [], chatQuestionSeq: 0,
    activeTurn: {id:'turn-a'}, liveStarted: true, roomPhase:'live', document:{hidden:false},
    selectedBoard:'01', activePlatform:'京东', barrageIntervalMs:interval,
    boardById: () => ({}), pickDanmu: () => ({text:'test'}), viewerNick: ()=>'观众',
    addChat: () => events.push(now), ELEM: () => ({}),
    Math: Object.assign(Object.create(Math), {random: () => .5}),
    setTimeout(fn, delay) {const id=++next; pending.set(id,{fn,at:now+delay}); return id;},
    clearTimeout(id) {pending.delete(id);}, clearInterval(id) {pending.delete(id);},
  };
  vm.createContext(ctx); vm.runInContext(src.slice(from,to),ctx);
  function advance(ms){const end=now+ms; while(true){let candidate;for(const [id,v] of pending){if(v.at<=end && (!candidate || v.at<candidate.v.at))candidate={id,v};}if(!candidate)break;now=candidate.v.at;pending.delete(candidate.id);candidate.v.fn();}now=end;}
  ctx.scheduleChatQuestion();advance(5000);assert.deepEqual(events,[5000]);checks++;
  advance(interval-1);assert.equal(events.length,1);checks++;
  advance(1);assert.deepEqual(events,[5000,5000+interval]);checks++;
  advance(interval);assert.deepEqual(events,[5000,5000+interval,5000+2*interval]);checks++;
  ctx.cancelChatTimer();advance(interval*2);assert.equal(events.length,3);checks++;
}
for(const interval of [30000,60000,120000]) scenario(interval);
console.log(`PASS ${checks}/${checks}: actual timer code uses each selected interval after the initial 5-second emission; cancellation stops further emissions`);
