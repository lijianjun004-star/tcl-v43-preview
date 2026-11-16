from pathlib import Path
import hashlib
import json

ROOT=Path(__file__).resolve().parent.parent
SITE=ROOT/'site'
APP=SITE/'app.js'
HTML=SITE/'index.html'

def change_once(src, old, new):
    if src.count(old)!=1:raise ValueError(f'Expected exactly one patch anchor; got {src.count(old)}: {old[:100]}')
    return src.replace(old,new,1)

def build():
    s=APP.read_text(encoding='utf-8')
    if "import { transcribePreferred } from './openai-asr-client.mjs';" not in s:
        s="import { transcribePreferred } from './openai-asr-client.mjs';\n"+s
        s=change_once(s,'const r6WhisperEngine=createLocalWhisper({onProgress:note=>{',
            'const r6LocalEngine=createLocalWhisper({onProgress:note=>{')
        s=change_once(s,'const r6WhisperQueue=[];',
            'const r6WhisperEngine=(blob,task)=>transcribePreferred(blob,task,r6LocalEngine);\nconst r6WhisperQueue=[];')
        s=change_once(s,'const result=await r6WhisperEngine(task.blob);',
            'const result=await r6WhisperEngine(task.blob,task);')
        s=s.replace('Whisper 本题原始录音转写完成（实验版，型号数字请人工核对）',
            '本题原始录音转写完成（'+"(result?.source==='openai-api'?'OpenAI API':'本地 Whisper')"+'，型号数字请人工核对）')
        # Preserve the original identifier and behavior; only change user-facing label.
        s=s.replace('实验 Whisper：','实验语音转写：').replace('实验 Whisper 识别失败','实验语音转写失败')
        APP.write_text(s,encoding='utf-8')
    h=HTML.read_text(encoding='utf-8')
    if '<script type="module" src="./openai-asr-ui.mjs"></script>' not in h:
        h=change_once(h,'</body>', '<script type="module" src="./openai-asr-ui.mjs"></script>\n</body>')
        h=h.replace('</title>','｜OpenAI API 可选实验</title>',1)
        HTML.write_text(h,encoding='utf-8')
    manifest=SITE/'static-manifest.json'
    old=json.loads(manifest.read_text(encoding='utf-8'))
    old['files']={p.relative_to(SITE).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in sorted(SITE.rglob('*')) if p.is_file() and p!=manifest}
    old['version']='v3.5.2-ASR-R2.2-OpenAI-optional-disabled-by-default'
    manifest.write_text(json.dumps(old,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return {'files':len(old['files'])+1,'app_sha256':old['files']['app.js']}

if __name__=='__main__': print(json.dumps(build()))