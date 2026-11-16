#!/usr/bin/env python3
"""Create an isolated QA-only R6 copy from an already verified site.zip extract.
Never mutate an existing Pages route or the original ZIP. Run AFTER unzip.
"""
import hashlib
import json
from pathlib import Path
import shutil
import sys

BASE_NAME = 'tcl-v352-asr'
PILOT_NAME = 'tcl-v352-asr-autoqa'
PATCH_HEADER = "import { createLocalWhisper } from './whisper-bridge.mjs';\n"
SOURCE_MARKER = 'const perQuestionAudio=new Map();'
AUDIO_MARKER = 'perQuestionAudio.set(turnAtStart.id,blob);'
VOSK_MARKER = 'if(voskModel)enqueueQuestionAsr(turnAtStart.id);'
VOSK_PRELOAD_MARKER = 'if(!voskModel&&!voskLoadJob)void preloadVoskModel({silent:true});'
NAMESPACE_BASE = 'tcl-specialty-v352-asr'
NAMESPACE_PILOT = 'tcl-specialty-v352-asr-autoqa'

INTEGRATION = r'''
// ---------- ASR AutoQA isolation patch: SINGLE-QUESTION ORIGINAL AUDIO ----------
// This is intentionally not present in the approved R6 route.
// No credentials or cloud APIs. Whisper downloads third-party weights on first run.
const r6WhisperEngine=createLocalWhisper({onProgress:note=>{
  const cur=r6WhisperQueue[0];
  const target=cur&&sessionTurns.find(t=>t.id===cur.turnId);
  if(target&&r6WhisperValid(cur,target)){
    target.asrStatus='实验 Whisper：'+note;
    renderTurnStatus(target);
  }
}});
const r6WhisperQueue=[];
let r6WhisperRunning=false;
const r6WhisperValid=(task,turn)=>!!(
  task&&turn&&runId===task.runId&&isRunPage()&&
  turn.runId===task.runId&&turn.boardId===task.boardId&&
  turn.platform===task.platform&&
  perQuestionAudio.get(task.turnId)===task.blob&&
  (turn.audioRevision||0)===task.audioRevision
);
function r6WhisperSubmit(turnId,blob){
  const turn=sessionTurns.find(t=>t.id===turnId);
  if(!turn||!blob||blob.size===0||turn.runId!==runId)return;
  r6WhisperQueue.push({turnId,blob,runId:turn.runId,boardId:turn.boardId,
    platform:turn.platform,audioRevision:turn.audioRevision||0});
  turn.asrStatus='原始录音已保存，等待实验 Whisper 转写（首次下载模型可能较慢）';
  renderTurnStatus(turn);
  void r6WhisperDrain();
}
async function r6WhisperDrain(){
  if(r6WhisperRunning)return;
  r6WhisperRunning=true;
  try{
    while(r6WhisperQueue.length){
      const task=r6WhisperQueue[0];
      const turn=sessionTurns.find(t=>t.id===task.turnId);
      if(!r6WhisperValid(task,turn)){r6WhisperQueue.shift();continue;}
      const baselineAnswer=turn.answer||'';
      const baselineTranscript=turn.transcript||'';
      const startedWithManual=!!(turn.manualEdited||turn.manualCleared);
      turn.asrStatus='实验 Whisper：读取本题原始录音';
      renderTurnStatus(turn);
      try{
        const result=await r6WhisperEngine(task.blob);
        if(!r6WhisperValid(task,turn)){r6WhisperQueue.shift();continue;}
        const text=String(result?.text||'').trim();
        const manuallyChanged=startedWithManual||turn.manualEdited||turn.manualCleared||
          (turn.answer||'')!==baselineAnswer||(turn.transcript||'')!==baselineTranscript;
        if(!text){
          turn.asrStatus='Whisper 未检测到有效中文语音；原音频已保留，可手动补文字';
        }else if(manuallyChanged){
          turn.asrStatus='Whisper 已识别但人工回答已编辑，原文字保留（试验结果不覆盖）';
          turn.whisperCandidate=text;
        }else{
          turn.rawTranscript=text;
          turn.transcript=text;
          turn.answer=text;
          turn.manualEdited=false;
          turn.manualCleared=false;
          const input=ELEM('answerText');
          if(activeTurn?.id===turn.id&&input)input.value=text;
          const visible=ELEM('liveTextAnswer');
          if(activeTurn?.id===turn.id&&visible&&!ELEM('textAnswerSheet')?.hidden&&!visible.value.trim())visible.value=text;
          turn.compliance=complianceHints(text,turn.platform);
          turn.pointsHit=(turn.keyPoints||[]).filter((point,i)=>fuzzyPoint(point,text,turn.pointKeywords?.[i]||[]));
          turn.asrStatus='Whisper 本题原始录音转写完成（实验版，型号数字请人工核对）';
        }
        renderTurnStatus(turn);
        await saveTurn(turn);
      }catch(err){
        if(r6WhisperValid(task,turn)){
          turn.asrStatus='实验 Whisper 识别失败：'+String(err?.message||err||'未知错误').slice(0,100)+'；原录音仍可回听';
          renderTurnStatus(turn);
          await saveTurn(turn).catch(()=>{});
        }
      }finally{
        r6WhisperQueue.shift();
      }
    }
  }finally{r6WhisperRunning=false;}
}
// ---------- END isolated ASR AutoQA ----------
'''

def expect_one(text, term):
    if text.count(term) != 1:
        raise ValueError('Expected exactly one source anchor: '+term+'; actual='+str(text.count(term)))

def patch_app(source):
    for marker in (SOURCE_MARKER,AUDIO_MARKER,VOSK_MARKER,VOSK_PRELOAD_MARKER):
        expect_one(source,marker)
    if PATCH_HEADER in source or 'r6WhisperDrain()' in source:
        raise ValueError('Already patched source')
    if source.count(NAMESPACE_BASE) != 3:
        raise ValueError('Unexpected R6 storage/channel/cache namespace count')
    source = PATCH_HEADER + source.replace(NAMESPACE_BASE,NAMESPACE_PILOT)
    source = source.replace(SOURCE_MARKER, SOURCE_MARKER+'\n'+INTEGRATION, 1)
    source = source.replace(AUDIO_MARKER,AUDIO_MARKER+'\nif(turnAtStart)r6WhisperSubmit(turnAtStart.id,blob);',1)
    source = source.replace(VOSK_MARKER,'/* AutoQA-only: Vosk auto-turn queue disabled; Whisper uses original recording. */',1)
    source = source.replace(VOSK_PRELOAD_MARKER,'/* AutoQA-only: Vosk silent preload disabled. */',1)
    return source

def build(site_root, files_dir):
    root=Path(site_root).resolve(); base=root/BASE_NAME;target=root/PILOT_NAME
    if not base.is_dir() or not (base/'app.js').is_file():
        raise FileNotFoundError('Released ASR base app missing; refuse to stage QA')
    if target.exists():raise ValueError('Target QA path already exists; refuse overwrite')
    original=base/'app.js';raw=original.read_bytes()
    text=raw.decode('utf-8')
    modified=patch_app(text)
    src=Path(files_dir).resolve()/'whisper-bridge.mjs'
    if not src.is_file():raise FileNotFoundError(src)
    shutil.copytree(base,target)
    (target/'app.js').write_text(modified,encoding='utf-8')
    shutil.copyfile(src,target/'whisper-bridge.mjs')
    # Keep the QA copy's manifest internally consistent without changing the R6 one.
    manifest_file=target/'static-manifest.json'
    if not manifest_file.exists():raise ValueError('Required QA manifest missing')
    old_manifest=json.loads(manifest_file.read_text(encoding='utf-8'))
    # Only after modifying HTML, recompute all expected resource digests below.
    # Explicitly mark the QA route so no one misidentifies it as reviewed R6.
    index=target/'index.html'
    html=index.read_text(encoding='utf-8')
    html=html.replace('</title>','｜ASR自动转写实验版</title>',1)
    if '</title>' not in html:raise ValueError('Missing HTML title')
    index.write_text(html,encoding='utf-8')
    sha_by_file={p.relative_to(target).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in target.rglob('*') if p.is_file() and p!=manifest_file}
    old_manifest['files']=dict(sorted(sha_by_file.items()))
    old_manifest['version']='v3.5.2-ASR-AutoQA-experimental'
    manifest_file.write_text(json.dumps(old_manifest,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    if original.read_bytes()!=raw:raise ValueError('Source changed unexpectedly')
    paths=sorted(p for p in target.rglob('*') if p.is_file())
    return {'base_sha256':hashlib.sha256(raw).hexdigest(),
            'pilot_sha256':hashlib.sha256((target/'app.js').read_bytes()).hexdigest(),
            'pilot_files':len(paths), 'source_preserved':True}

if __name__=='__main__':
    if len(sys.argv)!=3:sys.exit('usage: build_qa.py path/to/_site path/to/experiment')
    print(build(sys.argv[1],sys.argv[2]))
