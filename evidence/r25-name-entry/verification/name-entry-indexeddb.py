"""Exercise device entry through the real Chromium IndexedDB implementation."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
from playwright.sync_api import sync_playwright

site = Path('/workspace/tcl-r25-name-entry/experiments/r25/tcl-v352-asr-r25-qa')

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(site)))
Thread(target=server.serve_forever, daemon=True).start()
entry = f'http://127.0.0.1:{server.server_port}/name-identity.mjs'
setup = '''async (canRegister) => {
  const { createNameIdentityClient } = await import('/name-identity.mjs');
  window.requests = [];
  const ok = { ok: true, data: { state: 'ready', username: 'synthetic_host', uid: 'synthetic-uid', role: 'operator' } };
  window.identity = createNameIdentityClient({envId: 'real-indexeddb-test', config: { enabled: true, endpoint: 'https://synthetic.invalid/' },
    fetchImpl: async (_url, options) => {
      const { action } = JSON.parse(options.body);
      requests.push(action);
      const response = action === 'resolve' && canRegister ? { ok: false, error: { code: 'NOT_FOUND' } } : ok;
      return { ok: response.ok, json: async () => response };
    }
  });
}'''
checks = []
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        context = browser.new_context()
        first = context.new_page()
        first.goto(entry)
        first.evaluate(setup, True)
        assert first.evaluate("async()=>{const out=await identity.enterWithName({name:'合成运营',role:'operator'});return out.uid==='synthetic-uid'&&out.role==='operator'&&requests.join(',')==='resolve,register';}")
        first.close()
        same = context.new_page()
        same.goto(entry)
        same.evaluate(setup, False)
        assert same.evaluate("async()=>{const out=await identity.enterWithName({name:'合成运营',role:'anchor'});return out.uid==='synthetic-uid'&&out.role==='operator'&&requests.length===0;}")
        checks.append('actual IndexedDB supplies the original UID and role on a new tab')
        new = browser.new_context().new_page()
        new.goto(entry)
        new.evaluate(setup, False)
        deny = "async()=>{try{await identity.enterWithName({name:'合成运营'});return false;}catch(error){return error.code==='DEVICE_VERIFICATION_REQUIRED';}}"
        assert new.evaluate(deny) and new.evaluate("requests.join(',')==='resolve'")
        checks.append('independent browser storage cannot use the public name to claim identity')
        same.evaluate("identity.forgetDevice('合成运营','synthetic-uid')")
        assert same.evaluate(deny) and same.evaluate('requests.length===0')
        checks.append('forgetting the device disables name-only reentry in real browser storage')
        browser.close()
finally:
    server.shutdown()
    server.server_close()
print(json.dumps({'checks': checks, 'passed': len(checks), 'scope': 'Chromium IndexedDB and synthetic identity HTTP responses, zero cloud calls'}))
