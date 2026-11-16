"""Actual local file UI/persistence + ASR glossary flow; model and mic are MOCKED."""
import functools, json, pathlib, threading, subprocess, os
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

repo=pathlib.Path(__file__).resolve().parents[3]
out=repo/'evidence/r24-domain';out.mkdir(exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(repo/'experiments/r24')))
threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/tcl-v352-asr-r24-qa/'
result={'mode':'browser UI and local storage; no real ASR accuracy claim','checks':[]}
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':390,'height':844})
  errors=[];external=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('request',lambda r:external.append(r.url) if not r.url.startswith(url.split('/tcl-')[0]) else None)
  page.goto(url)
  page.locator('[data-role-pick="anchor"]').click();page.locator('#simpleName').fill('本机词表测试');page.locator('#simpleLogin').click()
  page.locator('details.header-tools summary').click()
  page.locator('#asrGlossaryFile').set_input_files({'name':'synthetic-script.txt','mimeType':'text/plain','buffer':'合成测试资料：tcl、HDMI、T7M Pro。价格2500元，144Hz。不是用户原讲解词。'.encode()})
  page.wait_for_function("document.getElementById('asrGlossaryStatus').textContent.includes('请核对')")
  assert page.evaluate("localStorage.getItem('tcl-r24-private-asr-terms-v1')") is None
  assert '2500' not in page.locator('#asrGlossaryTerms').input_value()
  result['checks'].append('file preview is local, excludes price, does not save automatically')
  page.locator('#asrGlossaryTerms').fill('TCL\nHDMI\nT7M Pro')
  page.locator('#asrGlossarySave').click();page.reload()
  page.locator('[data-role-pick="anchor"]').click();page.locator('#simpleName').fill('本机词表测试');page.locator('#simpleLogin').click()
  page.locator('details.header-tools summary').click()
  assert page.locator('#asrGlossaryTerms').input_value()=='TCL\nHDMI\nT7M Pro'
  result['checks'].append('explicit save survives reload')
  actual=page.evaluate(r"""async()=>{const {canonicalizeTerms}=await import('./asr-glossary.mjs');return canonicalizeTerms('这台t c l电视t7m pro支持h d m i 2.1，2500元',localStorage.getItem('tcl-r24-private-asr-terms-v1').split('\n'));}""")
  assert actual['text']=='这台TCL电视T7M Pro支持HDMI 2.1，2500元'
  result['checks'].append('case/spacing corrected; Chinese prose, number and version preserved')
  page.locator('#asrGlossaryTerms').fill('HDMI\nhttps://private.example/secret')
  page.locator('#asrGlossarySave').click()
  assert page.evaluate("localStorage.getItem('tcl-r24-private-asr-terms-v1')")=='TCL\nHDMI\nT7M Pro'
  result['checks'].append('invalid source does not overwrite saved terms')
  page.locator('#asrGlossaryTerms').fill('TCL\nHDMI\nT7M Pro')
  page.locator('#asrGlossarySave').click()
  page.screenshot(path=str(out/'glossary-ui.png'),full_page=True)
  page.locator('details.header-tools summary').click();page.locator('#freePractice').click()
  assert page.locator('#asrGlossarySave').is_disabled()
  result['checks'].append('training locks glossary edits')
  assert not errors,errors
  assert not external,external
  result.update(status='PASS',browser=browser.version,errors=errors,external_requests=external)
  browser.close()
finally:
 server.shutdown()
 (out/'glossary-browser.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False,indent=2))
