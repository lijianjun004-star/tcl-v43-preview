import functools,json,threading,pathlib
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[2]/'experiments/r24/tcl-v352-asr-r24-qa'
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
s=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(root)))
threading.Thread(target=s.serve_forever,daemon=True).start();results={}
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);pg=b.new_page();pg.goto(f'http://127.0.0.1:{s.server_port}/asr-glossary.mjs');pg.set_content('<div id="asrGlossaryPanel"></div>')
  pg.evaluate('''async()=>{const {initGlossaryUI}=await import('/glossary-ui.mjs');document.body.dataset.page='home';window.fake={getItem:()=> 'TCL',setItem:()=>{throw Error('quota');},removeItem:()=>{throw Error('blocked');}};window.gui=initGlossaryUI({storage:fake,isEditable:()=>document.body.dataset.page==='home',parseDocumentFile:()=>new Promise(r=>window.finishParse=r)});}''')
  pg.locator('#asrGlossaryTerms').fill('Q10M');pg.locator('#asrGlossarySave').click();results['blocked_save_preserves']=pg.evaluate('gui.getTerms()')==['TCL']
  pg.locator('#asrGlossaryClear').click();results['blocked_clear_preserves']=pg.evaluate('gui.getTerms()')==['TCL']
  pg.locator('#asrGlossaryTerms').fill('TCL');pg.locator('#asrGlossaryFile').set_input_files({'name':'terms.txt','mimeType':'text/plain','buffer':b'T7M'})
  pg.evaluate("document.body.dataset.page='training'");pg.evaluate("document.body.dataset.page='home'");pg.evaluate("finishParse({blocks:[{kind:'paragraph',text:'T7M'}]})")
  results['navigate_away_return_cancels']=pg.locator('#asrGlossaryTerms').input_value()=='TCL';results['status']=pg.locator('#asrGlossaryStatus').inner_text();results['saved']=pg.evaluate('gui.getTerms()');b.close()
finally:s.shutdown()
pathlib.Path(__file__).with_name('glossary-review-result.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(results)
