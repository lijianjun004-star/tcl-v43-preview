"""Private-fixture loading and safe evidence helpers. No network on import."""
from pathlib import Path
from datetime import datetime,timezone
from urllib.parse import urlsplit
import hashlib,json,os,re,stat,time,unicodedata,urllib.request,urllib.error,uuid,secrets

def sha(value):return hashlib.sha256(value if isinstance(value,bytes) else str(value).encode()).hexdigest()
def utc():return datetime.now(timezone.utc).isoformat()
PASSWORD_SPECIAL='()!@#$%^&*|?><_-'
def valid_password(value):
 if not isinstance(value,str) or not 8<=len(value)<=32 or not re.fullmatch(r'[A-Za-z0-9]',value[0]):return False
 if any(not(c.isascii() and (c.isalnum() or c in PASSWORD_SPECIAL)) for c in value):return False
 return sum((bool(re.search(r'[a-z]',value)),bool(re.search(r'[A-Z]',value)),bool(re.search(r'[0-9]',value)),any(c in PASSWORD_SPECIAL for c in value)))>=3
def new_password():
 # Always starts with ASCII letter, includes all four classes, length 24.
 return 'A'+secrets.token_hex(10)+'9z!'
def private_fixture(path,execute=False):
 p=Path(path).absolute()
 if p.is_symlink() or not p.is_file() or p.stat().st_mode&0o077:raise ValueError('Fixture must be a regular owner-only file, mode 0600')
 data=json.loads(p.read_text());url=urlsplit(data['registrationEndpoint'])
 if url.scheme!='https' or not url.netloc or url.username or url.password or url.query:raise ValueError('Use the exact HTTPS endpoint without credentials or query string')
 if execute and not(data.get('executionApproved') is True and data.get('testOnly') is True):raise ValueError('Actual execution requires root-approved test-only fixture')
 if not data.get('fixtureId'):raise ValueError('Fixture ID required')
 for alias in ('anchor','operator','outsider'):
  row=data['newAccounts'][alias]
  if not all(row.get(k) for k in ('name','password','inviteCode')) or not valid_password(row['password']):raise ValueError('Synthetic new-account password violates native 8..32 / first ASCII alphanumeric / 3-of-4-class policy')
  if not any('\u3400'<=c<='\u9fff' for c in row['name']):raise ValueError('New-account fixtures must include Chinese display names')
  if row.get('role','operator' if alias=='operator' else 'anchor')!=('operator' if alias=='operator' else 'anchor'):raise ValueError('Fixture roles must match operator/anchor/outsider test scope')
 if len({unicodedata.normalize('NFKC',x['name']).strip().lower() for x in data['newAccounts'].values()})!=len(data['newAccounts']):raise ValueError('Distinct synthetic names required')
 return data

class Evidence:
 def __init__(self,out,config,suite):
  self.out=Path(out);self.out.mkdir(parents=True,exist_ok=True);self.config=config
  self.report={'suite':suite,'fixtureIdSha256':sha(config['fixtureId']),'startedAt':utc(),'status':'RUNNING','checks':[],'notRun':[],'operations':[],'network':'REAL HTTP + official native Auth/PG only; never mock success','secretsLogged':False}
 def save(self):(self.out/'result.json').write_text(json.dumps(self.report,ensure_ascii=False,indent=2)+'\n')
 def check(self,name,ok,detail=None):
  self.report['checks'].append({'name':name,'pass':bool(ok),'detail':detail});self.save()
  if not ok:raise AssertionError(name)
 def not_run(self,name,reason):self.report['notRun'].append({'name':name,'reason':reason});self.save()
 def finish(self,status=None):
  self.report['status']=status or ('PASS_WITH_NOT_RUN' if self.report['notRun'] else 'PASS');self.report['completedAt']=utc();self.save()
 def fail(self,error):self.report['error']={'type':type(error).__name__,'summary':'Controlled error; raw exception, headers, request payload and secrets omitted'};self.finish('FAIL')
 def broker(self,body):
  start=time.monotonic();request=urllib.request.Request(self.config['registrationEndpoint'],data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Origin':self.config.get('origin','https://lijianjun004-star.github.io')},method='POST')
  try:
   with urllib.request.urlopen(request,timeout=30) as response:status=response.status;raw=response.read(262144)
  except urllib.error.HTTPError as error:status=error.code;raw=error.read(262144)
  except Exception:
   self.report['operations'].append({'action':body.get('action'),'httpStatus':None,'errorCode':'TRANSPORT_FAILURE','elapsedMs':round((time.monotonic()-start)*1000)});self.save();return {'ok':False,'error':{'code':'TRANSPORT_FAILURE'}}
  try:reply=json.loads(raw)
  except Exception:reply={'ok':False,'error':{'code':'NON_JSON_RESPONSE'}}
  if not isinstance(reply,dict) or not isinstance(reply.get('ok'),bool):reply={'ok':False,'error':{'code':'INVALID_ENVELOPE'}}
  # All response diagnostics are projected; never print raw bodies/headers.
  self.report['operations'].append({'action':body.get('action'),'httpStatus':status,'ok':reply.get('ok'),'state':reply.get('data',{}).get('state'),'errorCode':reply.get('error',{}).get('code'),'elapsedMs':round((time.monotonic()-start)*1000)});self.save();return reply

def operation(account):return {'action':'register','name':account['name'],'password':account['password'],'inviteCode':account['inviteCode'],'operationId':str(uuid.uuid4()),'operationSecret':secrets.token_urlsafe(32)}
def safe_operation(body):return {'operationIdSha256':sha(body['operationId']),'nameSha256':sha(body['name'])}
