from playwright.sync_api import sync_playwright
import functools, http.server, pathlib, shutil, sys, tempfile, threading

# Run: python test_ui.py /path/to/extracted/tcl-specialty-v33
# Instrument only a temporary copy; production bundle remains unchanged.
source=pathlib.Path(sys.argv[1]).resolve()
tmp=tempfile.TemporaryDirectory()
site=pathlib.Path(tmp.name)/'site'
shutil.copytree(source,site)
with (site/'app.js').open('a',encoding='utf8') as f:
    f.write("\nwindow.__uiTestSnapshot=()=>lastSessionSnapshot;\n")
    f.write("window.__uiSeed=()=>{localAssignments=[{id:'a',title:'空调练习',operatorName:'王运营',boardId:'03',platform:'京东',createdAt:new Date().toISOString()},{id:'b',title:'电视练习',operatorName:'李运营',boardId:'01',platform:'京东',createdAt:new Date().toISOString()}]};\n")
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(site)))
threading.Thread(target=server.serve_forever,daemon=True).start()

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page()
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'http://127.0.0.1:{server.server_port}/', wait_until='domcontentloaded')
    page.wait_for_selector('[data-role-pick="anchor"]')
    page.evaluate('window.__uiSeed()')
    page.locator('[data-role-pick="anchor"]').click()
    page.locator('#simpleName').fill('主播甲')
    page.locator('#simpleLogin').click()
    inp=page.locator('#assignmentSearch')
    inp.focus()
    result=page.evaluate('''() => {
      const e=document.querySelector('#assignmentSearch');
      e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
      e.value='电'; e.dispatchEvent(new InputEvent('input',{bubbles:true,data:'电',isComposing:true}));
      const first=document.activeElement===e && e.isConnected;
      e.value='电视'; e.dispatchEvent(new InputEvent('input',{bubbles:true,data:'视',isComposing:true}));
      const second=document.activeElement===e && e.isConnected;
      e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'电视'}));
      e.value='电视'; e.dispatchEvent(new InputEvent('input',{bubbles:true,data:'电视'}));
      return {first,second,final:document.activeElement===e && e.isConnected,value:e.value};
    }''')
    assert result == {'first':True,'second':True,'final':True,'value':'电视'}, result
    assert page.locator('.assignment-results .assignment-row').count() == 1
    assert '电视练习' in page.locator('.assignment-results').inner_text()
    print('PASS: 中文组合输入及连续输入保持原节点和焦点（合成 IME 事件）')
    page.locator('#freePractice').click()
    page.locator('[data-open-board]').first.click()
    page.locator('#textFallback').click()
    page.locator('#enterPrep').click()
    page.locator('#startScene').click()
    page.wait_for_timeout(2300)
    page.locator('#focusClose').click()
    page.wait_for_selector('#submitSession')
    snapshot=page.evaluate('window.__uiTestSnapshot()')
    print('snapshot',snapshot['startedAt'],snapshot['endedAt'],snapshot['durationSeconds'])
    assert 2 <= snapshot['durationSeconds'] <= 5, snapshot
    assert snapshot['endedAt'] > snapshot['startedAt'], snapshot
    print('PASS: 文字模式开始时间及真实时长（Chromium 模拟）')
    assert not errors,errors
    browser.close()

server.shutdown()
tmp.cleanup()
