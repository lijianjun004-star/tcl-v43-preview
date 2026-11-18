"""Isolate the temporary RC route's browser data from the official Paraformer route (same origin)."""
import sys, hashlib, json, pathlib
root = pathlib.Path(sys.argv[1])
RC = 'rc1'
edits = {
    'app.js': [
        ("'tcl-specialty-r24-paraformer-v1'", f"'tcl-specialty-r24-paraformer-{RC}-v1'", 1),
        ("'tcl-r24-paraformer-asr-model-v1'", f"'tcl-r24-paraformer-{RC}-asr-model-v1'", 1),
        ('<span class="eyebrow">TCL · PRACTICE HUB</span>', '<span class="eyebrow">TCL · PRACTICE HUB · 候选版 RC1</span>', 1),
    ],
    'r23-model-choice.js': [("'tcl-r24-paraformer-asr-model-v1'", f"'tcl-r24-paraformer-{RC}-asr-model-v1'", 1)],
    'glossary-ui.mjs': [("'tcl-r24-paraformer-private-asr-terms-v1'", f"'tcl-r24-paraformer-{RC}-private-asr-terms-v1'", 1)],
    'index.html': [('<title>TCL 智能练播房｜R2.4 本机练播版</title>', '<title>TCL 智能练播房｜R2.4 候选版 RC1</title>', 1)],
}
for name, reps in edits.items():
    p = root / name; s = p.read_text(encoding='utf-8')
    for old, new, n in reps:
        assert s.count(old) == n, (name, old, s.count(old)); s = s.replace(old, new)
    p.write_text(s, encoding='utf-8')
man = root / 'static-manifest.json'
m = json.loads(man.read_text(encoding='utf-8'))
for name in list(m['files']):
    f = root / name
    if f.exists(): m['files'][name] = hashlib.sha256(f.read_bytes()).hexdigest()
m['version'] = 'r24-paraformer-small-20261118-devicecheck-rc1'
man.write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('rc namespace applied')
