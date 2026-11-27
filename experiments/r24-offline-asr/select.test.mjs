import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {prepareSelection} from './select.mjs';

const repoName = 'lijianjun004-star/tcl-v43-preview';
const queue = 'asr-review-inbox/';
const publicClip = 'experiments/r24-offline-asr/public-example/audio.wav';
const exampleBytes = await readFile(new URL('./public-example/audio.wav',import.meta.url));
const exampleSha = '1f057810087628dda970919ee85c2c377124f9d50813cdaf25e5119ee7c42f7c';
const digest = b => createHash('sha256').update(b).digest('hex');

async function setup(t) {
  const folder=await mkdtemp(join(tmpdir(),'r24-asr-git-test-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const repo=join(folder,'repo'); await mkdir(repo);
  function git(...args) {
    return execFileSync('git',['-c','user.name=Synthetic','-c','user.email=qa@example.invalid',
      '-c','commit.gpgsign=false',...args],{cwd:repo,encoding:'utf8'}).trim();
  }
  git('init','-q','-b','main');
  let head=null;
  async function commit(changes) {
    for (const [file,bytes] of Object.entries(changes)) {
      const path=join(repo,file);
      if (bytes===null) { await rm(path); continue; }
      await mkdir(dirname(path),{recursive:true}); await writeFile(path,bytes);
    }
    git('add','--all'); git('commit','--no-gpg-sign','-qm','Synthetic fixture');
    const before=head; head=git('rev-parse','HEAD');return {before,after:head};
  }
  await commit({'README.md':'synthetic test repository'});
  async function select(range,{priv=true,repoOverride,ref,attempt='1',kind='push',flags={}}={}) {
    const temp=await mkdtemp(join(folder,'runner-'));
    const event={...range,repository:{private:priv,full_name:repoOverride??(priv?'qa/private':repoName)},
      ref:ref??(priv?'refs/heads/main':'refs/heads/feat/r24-offline-audio-transcription'),...flags};
    const picked=await prepareSelection(event,{GITHUB_EVENT_NAME:kind,GITHUB_RUN_ATTEMPT:attempt,RUNNER_TEMP:temp},repo);
    const manifest=join(temp,'r24-asr-in','manifest.json');
    if (!picked) { await assert.rejects(stat(manifest),{code:'ENOENT'}); return null; }
    const {samples}=JSON.parse(await readFile(manifest,'utf8'));
    for (const s of samples) assert.equal(digest(await readFile(join(dirname(manifest),s.file))),s.sha256);
    return samples;
  }
  return {commit,select};
}

test('private main selects two new files with exact bytes; unrelated files are excluded',async t=>{
  const {commit,select}=await setup(t);
  const range=await commit({[queue+'A.wav']:'audio-a',[queue+'B.mp3']:'audio-b',[queue+'notes.txt']:'notes','other.wav':'elsewhere'});
  assert.deepEqual(await select(range),[
    {id:'A',file:'A.wav',sha256:digest('audio-a')},{id:'B',file:'B.mp3',sha256:digest('audio-b')}]);
});

test('edits, a rename, re-adding after deletion, and same-content copies do not rebill',async t=>{
  const {commit,select}=await setup(t);
  let range=await commit({[queue+'A.wav']:'first'}); assert.equal((await select(range)).length,1);
  range=await commit({[queue+'A.wav']:'new bytes'}); assert.equal(await select(range),null);
  range=await commit({[queue+'A.wav']:null,[queue+'renamed.wav']:'new bytes'}); assert.equal(await select(range),null);
  range=await commit({[queue+'renamed.wav']:null}); assert.equal(await select(range),null);
  range=await commit({[queue+'back.wav']:'first'}); assert.equal(await select(range),null);
  range=await commit({[queue+'copy1.wav']:'third',[queue+'copy2.wav']:'third'}); assert.equal((await select(range)).length,1);
});

test('private batch rejects four distinct tracks or a file over the size limit before any manifest',async t=>{
  const {commit,select}=await setup(t);
  const four=Object.fromEntries(['A','B','C','D'].map(id=>[queue+id+'.wav','audio-'+id]));
  await assert.rejects(select(await commit(four)),/three new recordings/);
  await assert.rejects(select(await commit({[queue+'big.wav']:Buffer.alloc(512*1024+1)})),/512 KiB/);
});

test('public candidate permits exactly the pinned clip and skips a later replay',async t=>{
  const {commit,select}=await setup(t);
  assert.equal(digest(exampleBytes),exampleSha);
  const added=await commit({[publicClip]:exampleBytes});
  assert.deepEqual(await select(added,{priv:false}),[{id:'audio',file:'audio.wav',sha256:exampleSha}]);
  await commit({[publicClip]:null});
  const again=await commit({[publicClip]:exampleBytes});
  assert.equal(await select(again,{priv:false}),null);
});

test('public candidate rejects altered content at the pinned path; separate inbox alone cannot run',async t=>{
  const {commit,select}=await setup(t);
  const queueOnly=await commit({[queue+'other.wav']:'off-list content'});
  assert.equal(await select(queueOnly,{priv:false}),null);
  const wrong=await commit({[publicClip]:'wrong contents'});
  await assert.rejects(select(wrong,{priv:false}),/approved synthetic/);
});

test('public mixed push containing the pinned clip and another recording is denied as a batch',async t=>{
  const {commit,select}=await setup(t);
  const range=await commit({[publicClip]:exampleBytes,[queue+'other.wav']:'off-list content'});
  let result;
  try {result=await select(range,{priv:false});}
  catch (e) {assert.match(e.message,/public|synthetic|recording/i);return;}
  assert.equal(result,null,'Mixed public candidate must never reach the paid worker');
});

test('event source, first run, branch, repository identity, deletion and force flags gate selection',async t=>{
  const {commit,select}=await setup(t);
  const range=await commit({[publicClip]:exampleBytes,[queue+'X.wav']:'private'});
  for(const opt of [{kind:'schedule'},{kind:'pull_request'},{kind:'workflow_dispatch'},{attempt:'2'},{ref:'refs/heads/topic'},
    {flags:{forced:true}},{flags:{deleted:true}},{flags:{created:true}},{priv:false,ref:'refs/heads/main'},
    {priv:false,repoOverride:'other/test'}]) assert.equal(await select(range,opt),null);
  await assert.rejects(select({...range,before:'0'.repeat(40)}),/range/);
});

test('private paid step has an opt-in job condition and requires positive selection',async()=>{
  const workflow=await readFile(new URL('../../.github/workflows/r24-offline-audio.yml',import.meta.url),'utf8');
  assert.match(workflow,/github\.event\.repository\.private && github\.ref == 'refs\/heads\/main' && vars\.R24_OFFLINE_ASR_ENABLED == 'true'/);
  assert.match(workflow,/name: Transcribe the recordings\s+if: steps\.select\.outputs\.ready == 'true'\s+env:\s+OPENAI_API_KEY: \$\{\{ secrets\.OPENAI_API_KEY \}\}/);
});

test('public candidate rejects modifications to another media file elsewhere, including mixed-case extensions',async t=>{
  const {commit,select}=await setup(t);
  await commit({'elsewhere/old.M4A':'old'});
  const range=await commit({[publicClip]:exampleBytes,'elsewhere/old.M4A':'changed'});
  assert.equal(await select(range,{priv:false}),null);
});

test('non-media accompanying notes do not block the approved public example', async t=>{
  const {commit,select}=await setup(t);
  const range=await commit({[publicClip]:exampleBytes,'notes.md':'how to check the synthetic example'});
  assert.equal((await select(range,{priv:false}))[0].sha256,exampleSha);
});

test('private new audio with invalid path or identifier fails with a filename-free diagnostic',async t=>{
  const {commit,select}=await setup(t);
  for(const suffix of ['personal name.wav','subfolder/private-id.mp3','说明.ogg']){
    const range=await commit({[queue+suffix]:'recording-'+suffix});
    await assert.rejects(select(range),e=>e.message.startsWith('Invalid recording name')&&!e.message.includes(suffix));
  }
  const bad=await commit({[queue+'private-id.aac']:'wrong format'});
  await assert.rejects(select(bad),e=>e.message.includes('supported audio format')&&!e.message.includes('private-id'));
});
