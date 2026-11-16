import subprocess,pathlib,hashlib,json,os,platform,time,sys
repo=pathlib.Path('/workspace/tcl-r25-fix');out=pathlib.Path('/workspace/r25-codex-regression-final');(out/'logs').mkdir(exist_ok=True)
app=repo/'experiments/r25/tcl-v352-asr-r25-qa/app.js'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
base= {'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'app_sha256_before':digest(app),'environment':{'os':platform.platform(),'python':sys.version,'node':subprocess.check_output(['node','--version'],text=True).strip(),'chromium':subprocess.check_output(['/usr/bin/chromium','--version'],text=True).strip()},'scope':'Independent rerun of 15 Node groups with mocked inference and 4 Chromium groups with synthetic data/mocked Whisper. No real model accuracy or hardware claims. No product modifications.','executions':[],'git_status_before':subprocess.check_output(['git','status','--short'],cwd=repo,text=True).strip()}
(out/'execution-log.json').write_text(json.dumps(base,ensure_ascii=False,indent=2)+'\n')
env=os.environ.copy();env.update({'R24_PROGRESS_OUT':str(out/'progress'),'R24_RECORD_CACHE_OUT':str(out/'record-cache'),'R24_CONCURRENCY_OUT':str(out/'concurrency'),'R24_SESSION_OUT':str(out/'recovery'),'R23_BROWSER_REPORT':str(out/'recording/result.json')})
env['NODE_PATH']=subprocess.check_output(['npm','root','-g'],text=True).strip()
node_test={'r25-bridge-release.mjs','bridge-worker.mjs','bridge-delivery.mjs','app-queue-wakeup.mjs','audio-locks.mjs'}
tests=sorted((repo/'experiments/r25/tests').glob('*.cjs'))+sorted((repo/'experiments/r25/tests').glob('*.mjs'))
tests=[p for p in tests if p.name!='r25-flow.cjs']
commands=[(['node']+(['--test'] if p.name in node_test else [])+[str(p)],p.name,300,'MOCK') for p in tests]
commands.extend([(['python','-I',str(repo/'experiments/r25/tests'/n)],n,900,'Chromium synthetic/mocked Whisper') for n in ['record-cache.py','session_concurrency.py','session_smooth_recovery.py','browser_smooth_e2e.py']])
commands=sorted(commands,key=lambda x:x[1]=='regression.cjs')
for cmd,name,timeout,scope in commands:
 start=time.time();log=out/'logs'/f'{name}.log';rc=None;error=None
 try:
  with log.open('w') as f:r=subprocess.run(cmd,cwd=repo,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=timeout);rc=r.returncode
 except subprocess.TimeoutExpired as e:rc=124;error='TIMEOUT';
 record={'label':name,'command':cmd,'test_source_sha256':digest(pathlib.Path(cmd[-1])),'app_sha256_at_execution':digest(app),'exit_code':rc,'elapsed_seconds':round(time.time()-start,3),'scope':scope,'log':str(log),'log_sha256':digest(log),'status':'PASS' if rc==0 else 'FAIL'}
 if error:record['error']=error
 base['executions'].append(record);(out/'execution-log.json').write_text(json.dumps(base,ensure_ascii=False,indent=2)+'\n');print(f'{name}: {record["status"]} exit={rc} {record["elapsed_seconds"]}s',flush=True)
base['commit_after']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip();base['app_sha256_after']=digest(app);base['source_unchanged']=base['app_sha256_before']==base['app_sha256_after'];base['git_status_after']=subprocess.check_output(['git','status','--short'],cwd=repo,text=True).strip();base['status']='PASS' if all(x['exit_code']==0 for x in base['executions']) and base['source_unchanged'] else 'FAIL';(out/'execution-log.json').write_text(json.dumps(base,ensure_ascii=False,indent=2)+'\n');print('FINAL '+base['status'],flush=True)
