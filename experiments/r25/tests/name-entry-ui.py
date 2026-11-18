"""Actual Chromium UI checks for name entry with synthetic identity outcomes.
No cloud, native Auth, model downloads or hardware. Tests product DOM/events,
not the security of the separately tested workflow/provider implementation.
"""
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
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
            page = browser.new_page(viewport={'width': 390, 'height': 844})
            errors = []
            page.on('pageerror', lambda error: errors.append(type(error).__name__))
            page.goto(f'http://127.0.0.1:{server.server_port}/name-identity.mjs')
            page.evaluate('''async()=>{
                document.body.innerHTML='<div id="mount"></div>';
                const {createCloudWorkspace}=await import('/cloud-workspace.mjs');
                window.calls=[];window.deviceCredential=false;window.enterBehavior='new';window.bindBehavior='success';window.identityReady=0;window.recoveryDevice=false;
                window.wf={user:null,getState:()=>({error:'',deviceCredential,capabilities:{media:false}}),
                    enterWithName:async v=>{calls.push({action:'enter',...v});if(enterBehavior==='verify')throw Object.assign(Error('server verification required'),{code:'DEVICE_VERIFICATION_REQUIRED'});if(enterBehavior==='hold')await new Promise(resolve=>window.releaseEntry=resolve);deviceCredential=true;wf.user={uid:'actual-uid',displayName:v.name,role:enterBehavior==='known'?'operator':v.role};},
                    bindDevice:async code=>{calls.push({action:'bindDevice',code});if(bindBehavior==='fail')throw Object.assign(Error('设备码无效'),{code:'INVALID_DEVICE_CODE'});deviceCredential=true;wf.user={uid:'device-uid',displayName:'原设备账号',role:'operator'};},
                    signIn:async(name,password)=>{calls.push({action:'signIn',name,password});deviceCredential=false;wf.user={uid:'original-admin',displayName:name,role:'admin'};},
                    restoreRegistration:async code=>{calls.push({action:'restore',code});return{name:'原注册运营',role:'operator',state:'reserved',deviceCredential:recoveryDevice};},
                    register:async v=>{calls.push({action:'register',...v});deviceCredential=false;wf.user={uid:'original-registration',displayName:v.name,role:v.role};},
                    forgetDevice:async()=>{calls.push({action:'forgetDevice'});deviceCredential=false;},refreshIdentity:async()=>{},listAll:async()=>[],pendingOperations:async()=>[]};
                window.workspace=createCloudWorkspace({workflow:wf,boards:[{id:'b',category:'板块',platforms:['平台']}],onIdentityReady:async()=>{identityReady++;await workspace.mount(document.querySelector('#mount'));},onLogout:async()=>{wf.user=null;await workspace.mount(document.querySelector('#mount'));},onStart:async()=>{}});
                window.reset=async()=>{wf.user=null;enterBehavior='new';await workspace.mount(document.querySelector('#mount'));};
                await reset();
            }''')
            assert page.locator('input[type=text]:visible, input:not([type]):visible').count() == 1
            assert page.locator('input[type=password]:visible').count() == 0
            assert not page.locator('#cloudLegacyAccountDetails').evaluate('(el)=>el.open')
            assert page.locator('#cloudLegacyRegisterPanel').is_hidden()
            assert page.locator('#cloudEntryName').get_attribute('maxlength') == '64'
            assert page.locator('#cloudEntryRole option').evaluate_all('(els)=>els.map(x=>x.value)') == ['anchor', 'operator']
            checks.append('default entry has one name field, first-use role and no visible password or recovery controls')
            page.fill('#cloudEntryName', '  新运营  ')
            page.select_option('#cloudEntryRole', 'operator')
            page.click('#cloudEnterWithName')
            page.locator('#cloudRefresh').wait_for()
            assert page.evaluate("calls.length===1 && JSON.stringify(calls[0])===JSON.stringify({action:'enter',name:'新运营',role:'operator'})")
            assert '我的云端收件箱' in page.locator('#mount').inner_text()
            assert page.locator('#cloudPasswordForm').count() == 0
            checks.append('primary name entry sends only trimmed name and role, device dashboard has no password-change form')
            assert page.locator('#cloudSignOut').inner_text() == '退出工作台'
            page.locator('#cloudDeviceSettings > summary').click()
            def accept_forget(dialog):
                assert '设备码' in dialog.message and '云端账号和练习记录会保留' in dialog.message
                dialog.accept()
            page.once('dialog', accept_forget)
            page.click('#cloudForgetDevice')
            page.locator('#cloudNameEntryForm').wait_for()
            assert page.evaluate("calls.filter(c=>c.action==='forgetDevice').length===1")
            checks.append('explicit device removal confirms recovery requirement then forgets binding before logout')
            page.evaluate("async()=>{await reset();enterBehavior='known';}")
            page.fill('#cloudEntryName', '已注册运营')
            page.select_option('#cloudEntryRole', 'anchor')
            page.click('#cloudEnterWithName')
            page.locator('#cloudRefresh').wait_for()
            assert '我的云端收件箱' in page.locator('#mount').inner_text()
            assert '运营 · 正式账号' in page.locator('.r2-identity-text').inner_text()
            checks.append('known-device success renders workflow authoritative operator despite different first-use selection')
            page.evaluate("async()=>{await reset();enterBehavior='verify';}")
            page.fill('#cloudEntryName', '原账号姓名')
            page.click('#cloudEnterWithName')
            page.wait_for_function("document.querySelector('#cloudLegacyAccountDetails').open")
            assert page.locator('#cloudEntryName').input_value() == '原账号姓名'
            assert page.locator('#cloudUsername').input_value() == '原账号姓名'
            assert page.locator('#cloudRefresh').count() == 0
            assert '设备码' in page.locator('[data-cloud-status]').inner_text()
            assert page.locator('#cloudDeviceCode').is_visible()
            checks.append('unverified device keeps name and exposes device-code or original-account verification without signup')
            page.evaluate("bindBehavior='fail'")
            page.fill('#cloudDeviceCode', 'INVALID-SYNTHETIC-DEVICE-CODE')
            page.click('#cloudBindDevice')
            page.wait_for_function("document.querySelector('[data-cloud-status]').textContent==='设备码无效'")
            assert page.locator('#cloudDeviceCode').input_value() == ''
            assert page.locator('#cloudRefresh').count() == 0
            assert page.evaluate("calls.filter(c=>c.action==='bindDevice').length===1")
            checks.append('failed device-code validation clears code and never reports successful entry')
            page.evaluate("bindBehavior='success'")
            page.fill('#cloudDeviceCode', 'VALID-SYNTHETIC-DEVICE-CODE')
            page.click('#cloudBindDevice')
            page.locator('#cloudRefresh').wait_for()
            assert page.locator('.r2-identity-text b').inner_text() == '原设备账号'
            assert page.locator('#cloudPasswordForm').count() == 0
            assert page.evaluate("calls.filter(c=>c.action==='bindDevice').at(-1).code==='VALID-SYNTHETIC-DEVICE-CODE'")
            checks.append('verified device code calls bindDevice then mounts authoritative device account')
            page.evaluate('reset()')
            page.locator('#cloudLegacyAccountDetails > summary').click()
            page.fill('#cloudUsername', '原管理员')
            page.fill('#cloudPassword', 'Original123!')
            page.click('#cloudLoginForm button')
            page.locator('#cloudRefresh').wait_for()
            assert '全部主播交付作业' in page.locator('#mount').inner_text()
            assert page.locator('#cloudPasswordForm').count() == 1
            assert page.evaluate("calls.some(c=>c.action==='signIn'&&c.name==='原管理员'&&c.password==='Original123!')")
            checks.append('original administrator password verification stays inside alternate entry and retains password settings')
            page.evaluate('reset()')
            page.locator('#cloudLegacyAccountDetails > summary').click()
            page.locator('#cloudRegistrationRecoveryDetails > summary').click()
            page.fill('#cloudRecoveryCode', 'SYNTHETIC-R25REC1-CODE')
            page.click('#cloudRecoveryForm button')
            page.wait_for_function("!document.querySelector('#cloudLegacyRegisterPanel').hidden")
            assert page.locator('#cloudRecoveryCode').input_value() == ''
            assert page.locator('#cloudRegisterName').input_value() == '原注册运营'
            assert page.locator('#cloudRegisterName').get_attribute('readonly') is not None
            assert page.locator('#cloudRegisterRole').input_value() == 'operator'
            assert page.locator('#cloudRegisterRole').is_disabled()
            assert page.locator('#cloudRegisterPassword').input_value() == ''
            assert page.locator('#cloudRefresh').count() == 0
            checks.append('R25REC1 recovery reveals original manual continuation with locked name and role, no automatic enrollment')
            page.fill('#cloudRegisterPassword', 'Original123!')
            page.click('#cloudRegisterForm button')
            page.locator('#cloudRefresh').wait_for()
            assert page.evaluate("JSON.stringify(calls.filter(c=>c.action==='register').at(-1))===JSON.stringify({action:'register',name:'原注册运营',password:'Original123!',role:'operator'})")
            assert page.locator('#cloudPasswordForm').count() == 1
            checks.append('restored legacy registration continues original workflow.register with first password')
            page.evaluate('async()=>{await reset();recoveryDevice=true;}')
            page.locator('#cloudLegacyAccountDetails > summary').click()
            page.locator('#cloudRegistrationRecoveryDetails > summary').click()
            page.fill('#cloudRecoveryCode', 'SAME-OPERATION-DEVICE-RECOVERY')
            page.click('#cloudRecoveryForm button')
            page.wait_for_function("document.querySelector('[data-cloud-status]').textContent.includes('恢复成功')")
            assert page.locator('#cloudEntryName').input_value() == '原注册运营'
            assert page.locator('#cloudEntryRole').input_value() == 'operator'
            assert page.locator('#cloudLegacyRegisterPanel').is_hidden()
            assert page.locator('input[type=password]:visible').count() == 0
            assert page.locator('#cloudRefresh').count() == 0
            checks.append('recovery with surviving same-operation device key returns to primary without password or automatic entry')
            page.evaluate("async()=>{await reset();enterBehavior='hold';}")
            page.fill('#cloudEntryName', '并发点击测试')
            before = page.evaluate("calls.filter(c=>c.action==='enter').length")
            page.locator('#cloudNameEntryForm').dispatch_event('submit')
            page.locator('#cloudNameEntryForm').dispatch_event('submit')
            assert page.evaluate("calls.filter(c=>c.action==='enter').length") == before + 1
            assert page.locator('#cloudEnterWithName').is_disabled()
            page.evaluate('releaseEntry()')
            page.locator('#cloudRefresh').wait_for()
            checks.append('busy name entry ignores duplicate submits and restores UI only after authoritative success')
            assert not errors
            checks.append('all name, device, legacy and recovery UI transitions have no page errors')
        finally:
            browser.close()
finally:
    server.shutdown()
    server.server_close()
print(json.dumps({'passed':len(checks),'checks':checks,'scope':'Chromium product DOM/events with synthetic workflow; no cloud/native Auth calls'},ensure_ascii=False,indent=2))
