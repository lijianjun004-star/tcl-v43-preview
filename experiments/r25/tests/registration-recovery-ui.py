"""Real Chromium DOM and cross-page IndexedDB recovery checks with synthetic Auth.
No cloud calls, native password resets, or production data. Run with
CHROMIUM_EXECUTABLE=/usr/bin/chromium python3 registration-recovery-ui.py.
"""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
import base64
import json
import os

ROOT = Path(__file__).resolve().parents[1] / 'tcl-v352-asr-r25-qa'
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
checks = []
try:
    with sync_playwright() as p:
        options = {'headless': True, 'args': ['--no-sandbox']}
        if os.environ.get('CHROMIUM_EXECUTABLE'):
            options['executable_path'] = os.environ['CHROMIUM_EXECUTABLE']
        browser = p.chromium.launch(**options)
        try:
            context = browser.new_context()
            page = context.new_page()
            url = f'http://127.0.0.1:{server.server_port}/name-identity.mjs'
            page.goto(url)
            page.evaluate('''async () => {
                document.body.innerHTML='<div id="mount"></div>';
                const {createCloudWorkspace}=await import('/cloud-workspace.mjs');
                window.calls=[]; window.identityReady=0;window.failRecovery=false;
                window.wf={user:null,getState:()=>({error:'',capabilities:{media:false}}),
                    restoreRegistration:async code=>{calls.push({action:'restore',code});if(failRecovery)throw Error('恢复码未获服务端确认');return {name:'原注册运营',role:'operator',state:'reserved'};},
                    register:async values=>calls.push({action:'register',...values}),
                    signIn:async()=>calls.push({action:'signIn'})};
                window.workspace=createCloudWorkspace({workflow:wf,boards:[],onIdentityReady:async()=>identityReady++,onLogout:async()=>{},onStart:async()=>{}});
                await workspace.mount(document.querySelector('#mount'));
            }''')
            page.locator('summary', has_text='注册中断').click()
            assert page.locator('#cloudRecoveryCode').get_attribute('type') == 'password'
            assert page.locator('#cloudRecoveryCode').get_attribute('autocomplete') == 'off'
            checks.append('recovery code input is masked and excludes autofill')
            page.fill('#cloudRegisterPassword', 'Original123!')
            page.fill('#cloudRecoveryCode', 'SYNTHETIC-RECOVERY-CODE')
            page.click('#cloudRecoveryForm button')
            page.wait_for_function("document.querySelector('#cloudRegisterName').value==='原注册运营'")
            assert page.locator('#cloudRecoveryCode').input_value() == ''
            assert page.locator('#cloudRegisterRole').input_value() == 'operator'
            assert page.locator('#cloudRegisterPassword').input_value() == ''
            assert page.evaluate("identityReady===0 && calls.length===1 && calls[0].action==='restore'")
            assert '首次设置的密码' in page.locator('[data-cloud-status]').inner_text()
            checks.append('successful recovery clears secret input, prefills canonical name and role, requires original password without login')
            page.evaluate('failRecovery=true')
            page.fill('#cloudRecoveryCode', 'INVALID-SYNTHETIC-CODE')
            page.click('#cloudRecoveryForm button')
            page.wait_for_function("document.querySelector('[data-cloud-status]').textContent.includes('未获服务端确认')")
            assert page.locator('#cloudRecoveryCode').input_value() == ''
            assert page.locator('#cloudRegisterName').input_value() == '原注册运营'
            assert page.locator('#cloudRegisterRole').input_value() == 'operator'
            assert page.evaluate("identityReady===0 && !calls.some(c=>c.action==='register'||c.action==='signIn')")
            checks.append('failed recovery stays a failure, preserves form identity and never registers or signs in')
            # Actual shared IndexedDB, separate pages, delayed old-tab success response.
            page.evaluate('''async () => {
                const {createNameIdentityClient}=await import('/name-identity.mjs');
                window.oldRequest=null;window.releaseOld=null;
                window.oldClient=createNameIdentityClient({envId:'browser-race',config:{enabled:true,endpoint:'https://synthetic.invalid/identity'},
                    fetchImpl:async(url,options)=>{oldRequest=JSON.parse(options.body);return new Promise(resolve=>{releaseOld=()=>resolve({ok:true,json:async()=>({ok:true,data:{state:'ready',role:'anchor',username:'r25n_synthetic',uid:'same-native-uid'}})});});}});
                window.oldResult=oldClient.register({name:'跨页恢复测试',password:'Original123!',role:'anchor'}).then(()=>({unexpectedSuccess:true}),e=>({code:e.code}));
            }''')
            page.wait_for_function('oldRequest!==null')
            original = page.evaluate('({operationId:oldRequest.operationId,operationSecret:oldRequest.operationSecret})')
            new_secret = 'd' * 64
            payload = {'version': 1, 'envId': 'browser-race', 'name': '跨页恢复测试', 'role': 'anchor', 'operationId': original['operationId'], 'operationSecret': new_secret}
            code = 'R25REC1.' + base64.urlsafe_b64encode(json.dumps(payload, ensure_ascii=False).encode()).decode().rstrip('=')
            other = context.new_page()
            other.goto(url)
            result = other.evaluate('''async code => {
                const {createNameIdentityClient}=await import('/name-identity.mjs');
                window.newRequests=[];window.statusRole='anchor';
                window.newClient=createNameIdentityClient({envId:'browser-race',config:{enabled:true,endpoint:'https://synthetic.invalid/identity'},
                    fetchImpl:async(url,options)=>{newRequests.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true,data:{state:'reserved',requiresPassword:true,role:statusRole}})};}});
                return newClient.restoreRecovery(code);
            }''', code)
            assert result == {'name': '跨页恢复测试', 'role': 'anchor', 'state': 'reserved'}
            checks.append('second browser page imports server-validated recovery into actual shared IndexedDB')
            old_result = page.evaluate('async()=>{releaseOld();return await oldResult;}')
            assert old_result == {'code': 'REGISTRATION_STORAGE_CHANGED'}
            rows = other.evaluate('''async()=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('r25-name-identity:browser-race',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
                return await new Promise((resolve,reject)=>{const tx=db.transaction('operations','readonly');const req=tx.objectStore('operations').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}''')
            assert len(rows) == 1
            assert rows[0]['operationSecret'] == new_secret
            assert rows[0]['operationId'] == original['operationId']
            assert rows[0]['state'] == 'reserved'
            checks.append('late response from old browser page cannot overwrite rotated secret or allocate another operation')
            bad = other.evaluate('''async code=>{statusRole='operator';try{await newClient.restoreRecovery(code);return 'unexpected success';}catch(e){return e.code;}}''', code)
            assert bad == 'INVALID_IDENTITY_RESPONSE'
            checks.append('server role mismatch rejects recovery in browser')
            page.evaluate('''async code=>{
                const {createNameIdentityClient}=await import('/name-identity.mjs');
                window.releaseImport=null;
                const older=createNameIdentityClient({envId:'browser-race',config:{enabled:true,endpoint:'https://synthetic.invalid/identity'},
                    fetchImpl:async()=>new Promise(resolve=>{releaseImport=()=>resolve({ok:true,json:async()=>({ok:true,data:{state:'reserved',requiresPassword:true,role:'anchor'}})});})});
                window.importResult=older.restoreRecovery(code).then(()=>({unexpectedSuccess:true}),e=>({code:e.code}));
            }''', code)
            page.wait_for_function('releaseImport!==null')
            payload['operationSecret'] = 'e' * 64
            newer_code = 'R25REC1.' + base64.urlsafe_b64encode(json.dumps(payload, ensure_ascii=False).encode()).decode().rstrip('=')
            other.evaluate("async code=>{statusRole='anchor';return await newClient.restoreRecovery(code);}", newer_code)
            delayed = page.evaluate('async()=>{releaseImport();return await importResult;}')
            assert delayed == {'code': 'REGISTRATION_STORAGE_CHANGED'}
            saved = other.evaluate('''async()=>{const db=await new Promise(resolve=>{const request=indexedDB.open('r25-name-identity:browser-race',1);request.onsuccess=()=>resolve(request.result);});return await new Promise(resolve=>{const req=db.transaction('operations','readonly').objectStore('operations').getAll();req.onsuccess=()=>resolve(req.result);});}''')
            assert len(saved) == 1 and saved[0]['operationSecret'] == 'e' * 64
            checks.append('delayed older recovery import across browser pages cannot overwrite a newer validated code')
            # No fetch implementation used above makes network requests: all identity replies synthetic.
            context.close()
        finally:
            browser.close()
finally:
    server.shutdown()
    server.server_close()
print(json.dumps({'passed':len(checks),'checks':checks,'scope':'Real Chromium DOM and cross-page IndexedDB; synthetic identity responses, no cloud calls'},ensure_ascii=False,indent=2))
