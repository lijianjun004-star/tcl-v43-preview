const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../tcl-v352-asr-r25-qa');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 const {canonicalizeTerms}=await import(path.join(root,'asr-glossary.mjs'));
 const asrGlossary={getTerms:()=>['TCL','HDMI','T7M Pro']};
 const {toSimplified}=await import(path.join(root,'asr-normalize.mjs'));
 const cases=[
  ['這款電視支援語音辨識','这款电视支持语音辨识'] /* R2.5: OpenCC twp also converts Taiwan phrases */,
  ['我們今天介紹這台電視的優惠價格','我们今天介绍这台电视的优惠价格'],
  ['頭髮乾燥，乾坤與皇后','头发干燥，乾坤与皇后'],
  ['T7M Pro HDMI 2.1 144Hz 65英寸 2500元','T7M Pro HDMI 2.1 144Hz 65英寸 2500元'],
  ['75英吋','75英寸'],['八十五吋','八十五寸']
 ];
 for(const [raw,want] of cases)assert.equal(toSimplified(raw),want);
 let count=cases.length;
 const body=source.slice(source.indexOf('function r6WhisperSubmit('),source.indexOf('globalThis.r6WhisperSubmit='));
 const normalize=source.slice(source.indexOf('function normalizeWhisperChinese('),source.indexOf('function normalizeInterfaceDecimals('));
 const valid=source.slice(source.indexOf('const r6WhisperValid='),source.indexOf('function r6WhisperCancelAll('));
 const context=vm.createContext({assert,toSimplified,canonicalizeTerms,asrGlossary,setTimeout,clearTimeout,console});
 vm.runInContext(`
 let runId='run',alive=true,r6WhisperRunning=false,r6WhisperCancelSeq=0;
 const sessionTurns=[],perQuestionAudio=new Map(),r6WhisperQueue=[],pending=[],saved=[];
 const r6WhisperPageAlive=()=>alive;
 const r6WhisperEngine=blob=>new Promise((resolve,reject)=>pending.push({blob,resolve,reject}));
 const renderTurnStatus=()=>{},ELEM=()=>null,complianceHints=()=>[],readR23ModelPreference=()=> 'tiny';
 let activeTurn=null,transcriptBusy=false,oneShotAsrJob=null,asrInferJob=null,voskLoadJob=null; const drainQuestionAsrQueue=()=>{}; const saveTurn=async t=>saved.push({...t});
 const normalizeInterfaceDecimals=text=>({text,changes:0});
 function add(id){const t={id,runId,boardId:'b',platform:'p',answer:'',transcript:'',keyPoints:[]};sessionTurns.push(t);perQuestionAudio.set(id,{size:10,id});return t;}
 `+valid+normalize+body,context);
 const run=s=>vm.runInContext(s,context);
 run(source.slice(source.indexOf('function r6WhisperCancelAll('),source.indexOf('function r6WhisperSubmit(')));
 assert.equal(run(`normalizeWhisperChinese('感谢观看，这款电视支持HDMI。')`),'感谢观看，这款电视支持HDMI。');assert.equal(run(`normalizeWhisperChinese('谢谢观看！')`),'');count++;
 // First result becomes stale during inference; successor must still be processed.
 run(`add('one');add('two');add('three');for(const t of sessionTurns)r6WhisperSubmit(t.id,perQuestionAudio.get(t.id));sessionTurns[0].audioRevision=1;pending[0].resolve({text:'旧结果'});`);
 await tick();assert.equal(run('pending.length'),2);count++;
 run(`pending[1].resolve({text:'這款電視'});`);await tick();
 assert.equal(run('sessionTurns[1].answer'),'这款电视');count++;
 // Late third result must remain a candidate after manual edit, retaining raw text.
 run(`sessionTurns[2].answer='人工修订';sessionTurns[2].manualEdited=true;pending[2].resolve({text:'我們的電視'});`);await tick();
 assert.equal(run('sessionTurns[2].answer'),'人工修订');
 assert.equal(run('sessionTurns[2].whisperCandidate'),'我们的电视');
 assert.equal(run('sessionTurns[2].rawTranscript'),'我們的電視');count++;
 // Model failure does not poison the serial queue or invent text.
 run(`add('four');add('five');r6WhisperSubmit('four',perQuestionAudio.get('four'));r6WhisperSubmit('five',perQuestionAudio.get('five'));pending[3].reject(new Error('NETWORK_ERROR'));`);await tick();
 assert.match(run('sessionTurns[3].asrStatus'),/NETWORK_ERROR/);
 run(`pending[4].resolve({text:'價格優惠'});`);await tick();
 assert.equal(run('sessionTurns[4].answer'),'价格优惠');count++;
 assert.equal(run('r6WhisperQueue.length'),0);assert.equal(run('r6WhisperRunning'),false);count++;
 // Cancellation leaves audio available and blocks late writes.
 run(`add('six');r6WhisperSubmit('six',perQuestionAudio.get('six'));r6WhisperCancelSeq++;pending[5].resolve({text:'不得写入'});`);await tick();
 assert.equal(run('sessionTurns[5].answer'),'');assert.equal(run('perQuestionAudio.has("six")'),true);count++;
 run(`add('old-run');r6WhisperSubmit('old-run',perQuestionAudio.get('old-run'));r6WhisperCancelAll();runId='new-run';add('new-question');r6WhisperSubmit('new-question',perQuestionAudio.get('new-question'));pending[6].resolve({text:'旧场不得回写'});`);await tick();
 assert.equal(run('pending.length'),8);run(`pending[7].resolve({text:'新场回答'});`);await tick();assert.equal(run('sessionTurns.at(-1).answer'),'新场回答');count++;
 console.log(JSON.stringify({status:'PASS',checks:count,mode:'actual app functions in Node VM; mocked inference, not real speech'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
