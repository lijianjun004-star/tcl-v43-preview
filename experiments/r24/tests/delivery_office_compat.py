#!/usr/bin/env python3
"""Optional generator compatibility check; requires python-docx, openpyxl, Playwright."""
import functools,threading,json,io,os,hashlib
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
from docx import Document
from openpyxl import Workbook
root=Path(__file__).resolve().parents[3]
out=Path(os.environ.get('R24_UI_OUTPUT',str(root/'evidence/r24-delivery/recheck')));out.mkdir(parents=True,exist_ok=True)
app=root/'experiments/r24/tcl-v352-asr-r24-qa/app.js';app_sha=hashlib.sha256(app.read_bytes()).hexdigest()
a=io.BytesIO();doc=Document();doc.add_paragraph('TCL HDMI 2.1 T7M Pro');doc.save(a)
b=io.BytesIO();wb=Workbook();ws=wb.active;ws.append(['TCL','HDMI 2.1','T7M Pro']);wb.save(b)
class Q(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
s=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Q,directory=str(root/'experiments/r24')));threading.Thread(target=s.serve_forever,daemon=True).start()
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);page=browser.new_page();page.goto(f'http://127.0.0.1:{s.server_port}/tcl-v352-asr-r24-qa/')
 results=[]
 for name,data in [('python-docx-generated.docx',a.getvalue()),('openpyxl-generated.xlsx',b.getvalue())]:
  r=page.evaluate('''async ({name,data})=>{const {parseDocumentFile}=await import('./lib/parser.js');const {extractTerms}=await import('./asr-glossary.mjs');const parsed=await parseDocumentFile(new File([new Uint8Array(data)],name));return {format:parsed.format,terms:extractTerms(parsed)}}''',{'name':name,'data':list(data)})
  assert r['terms']==['TCL','HDMI 2.1','T7M Pro'];results.append({'file':name,'bytes':len(data),**r})
 browser.close()
s.shutdown();(out/'office-compatibility.json').write_text(json.dumps({'status':'PASS','mode':'Synthetic documents created by python-docx/openpyxl, actual browser parser','results':results,'app_sha256':app_sha,'app_sha256_after':hashlib.sha256(app.read_bytes()).hexdigest(),'source_unchanged':hashlib.sha256(app.read_bytes()).hexdigest()==app_sha},ensure_ascii=False,indent=2));print(results)

assert hashlib.sha256(app.read_bytes()).hexdigest()==app_sha
