import sys, hashlib, json, pathlib
root = pathlib.Path(sys.argv[1])
app = root / 'app.js'
s = app.read_text(encoding='utf-8')
def rep(old, new):
    global s
    n = s.count(old)
    assert n == 1, (n, old[:80])
    s = s.replace(old, new)

# 1) Start the device check inside the same tap that opened the room.
rep("roomPhase='check';deviceCheck={camera:false,microphone:false,recorder:false,ready:false,mode:'hardware',checked:false};page='training';render();\n}",
    "roomPhase='check';deviceCheck={camera:false,microphone:false,recorder:false,ready:false,mode:'hardware',checked:false};page='training';render();\n"
    " // Every caller is a visible tap such as “检查设备，准备练播”; start the check inside that same gesture.\n"
    " if(page==='training'&&roomPhase==='check'&&deviceCheck.mode==='hardware')void checkDevices();\n}")

# 2) Mark a check as in progress with its own sequence so a cancelled check never looks pending.
rep("const seq=++deviceCheckSeq;lastDeviceError='';deviceCheck={camera:false,microphone:false,recorder:false,ready:false,mode:'hardware',checked:true};",
    "const seq=++deviceCheckSeq;lastDeviceError='';deviceCheck={camera:false,microphone:false,recorder:false,ready:false,mode:'hardware',checked:true,pendingSeq:seq};updateDeviceStates();")
rep("if(seq!==deviceCheckSeq)return;\ndeviceCheck.ready=!!(",
    "if(seq!==deviceCheckSeq)return;\ndelete deviceCheck.pendingSeq;\ndeviceCheck.ready=!!(")

# 3) Honest status copy: checking only while a check really runs.
rep("function updateDeviceStates(){\n renderVoskWidgets();\nconst d=deviceCheck;",
    "function updateDeviceStates(){\n renderVoskWidgets();\nconst d=deviceCheck;const checking=d.mode==='hardware'&&d.pendingSeq===deviceCheckSeq;")
rep("setDeviceState('cameraState',!d.checked?null:d.camera,'摄像头：'+(!d.checked?'未检查':d.camera?",
    "setDeviceState('cameraState',!d.checked||checking?null:d.camera,'摄像头：'+(!d.checked?'未检查':checking?'检测中…':d.camera?")
rep("setDeviceState('micState',!d.checked?null:d.microphone,'麦克风：'+(!d.checked?'未检查':d.microphone?",
    "setDeviceState('micState',!d.checked||checking?null:d.microphone,'麦克风：'+(!d.checked?'未检查':checking?'检测中…':d.microphone?")
rep("ELEM('startScene').textContent=d.ready?'开始练播':d.checked?'设备未就绪':'准备中…';",
    "ELEM('startScene').textContent=d.ready?'开始练播':checking?'正在检测设备…':d.checked?'设备未就绪':'请先检测设备';")
rep("d.ready?'✓ 摄像头和麦克风已就绪':d.checked?'⚠ 设备未就绪，请在「更多」中重试或选文字练播':'正在检查摄像头和麦克风…';",
    "d.ready?'✓ 摄像头和麦克风已就绪':checking?'正在检查摄像头和麦克风…':d.checked?'⚠ 设备未就绪，请点击「检测摄像头与麦克风」重试，或选仅文字练播':'请点击「检测摄像头与麦克风」';")

# 4) Failure toast uses the same instruction as the status line.
rep("toast('\u8bbe\u5907\u5c1a\u672a\u5c31\u7eea\uff0c\u8bf7\u70b9\u300c\u66f4\u591a\u300d\u67e5\u770b\u6216\u5207\u6362\u6587\u5b57\u7ec3\u64ad')",
    "toast('\u8bbe\u5907\u5c1a\u672a\u5c31\u7eea\uff0c\u8bf7\u70b9\u51fb\u300c\u68c0\u6d4b\u6444\u50cf\u5934\u4e0e\u9ea6\u514b\u98ce\u300d\u91cd\u8bd5\uff0c\u6216\u9009\u4ec5\u6587\u5b57\u7ec3\u64ad')")

app.write_text(s, encoding='utf-8')
man = root / 'static-manifest.json'
m = json.loads(man.read_text(encoding='utf-8'))
m['version'] = 'r24-paraformer-small-20261118-devicecheck-rc1'
m['files']['app.js'] = hashlib.sha256(app.read_bytes()).hexdigest()
man.write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('patched app.js', m['files']['app.js'])
