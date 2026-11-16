#!/usr/bin/env python3
"""Port the R24 regression tests to the R2.5 path.

Usage: python3 -I port_tests_r25.py <r24-tests-dir> <out-tests-dir>
Only path/namespace strings change, plus two expectations whose behaviour R2.5
changes on purpose (each documented inline in the ported file).
"""
import pathlib, re, sys

SRC, OUT = map(pathlib.Path, sys.argv[1:3])
OUT.mkdir(parents=True, exist_ok=True)
NODE = ['regression.cjs', 'bridge-worker.mjs', 'bridge-delivery.mjs', 'performance-progress.mjs', 'app-queue-wakeup.mjs',
        'audio-locks.mjs', 'glossary.mjs', 'question-pool.mjs', 'manual-clear-regression.cjs', 'assignment-regression.cjs', 'bridge.mjs']
PY = ['performance.py', 'record-cache.py', 'session_concurrency.py', 'session_smooth_recovery.py', 'browser_smooth_e2e.py']
PIN = ("R25_PIN=\"try{localStorage.getItem('tcl-r25-asr-engine')||localStorage.setItem('tcl-r25-asr-engine','tiny')}catch(e){}\"  "
       "# R2.5 port: keep the R24 Whisper-path semantics and avoid the default Vosk auto-download (network)\n")


def once(s, old, new, name):
    assert s.count(old) == 1, f'{name}: anchor {old[:60]!r} found {s.count(old)}x'
    return s.replace(old, new)


for name in NODE + PY:
    s = (SRC / name).read_text(encoding='utf-8')
    s = s.replace('asr-r24-qa', 'asr-r25-qa')                       # product dir + IndexedDB name
    s = re.sub(r'evidence/r24-[a-z-]+/', 'evidence/r25-ported/', s)  # never overwrite R24 evidence
    s = s.replace("ROOT=ROOT/'experiments/r24'", "ROOT=ROOT/'experiments/r25'")
    if name == 'regression.cjs':
        s = once(s, "['這款電視支援語音辨識','这款电视支援语音辨识']",
                 "['這款電視支援語音辨識','这款电视支持语音辨识'] /* R2.5: OpenCC twp also converts Taiwan phrases */", name)
    if name == 'bridge-worker.mjs':
        s = once(s, "  assert.equal(engine.isResourceBusy(), true);\n});\n\ntest('Worker error",
                 "  // R2.5: the timed-out Worker is terminated, so it no longer locks the Vosk fallback.\n"
                 "  assert.equal(workers[0].terminated, true);\n  assert.equal(engine.isResourceBusy(), false);\n});\n\ntest('Worker error", name)
        s = once(s, "or releases unhealthy lock'", "and R2.5 terminates it instead of locking Vosk'", name)
    if name in PY:
        n = 0
        def add_pin(m):
            global n
            n += 1
            return f"{m.group(1)}=browser.new_context({m.group(2)});{m.group(1)}.add_init_script(R25_PIN)"
        s, k = re.subn(r'(\w+)=browser\.new_context\(([^()]*)\)', add_pin, s)
        assert k >= 1, f'{name}: no new_context found'
        lines = s.split('\n')
        idx = max(i for i, l in enumerate(lines[:40]) if l.startswith(('import ', 'from ')))
        lines.insert(idx + 1, PIN)
        s = '\n'.join(lines)
    assert 'r24-qa' not in s, f'{name}: leftover r24 path'
    (OUT / name).write_text(s, encoding='utf-8')
print('PORTED', len(NODE) + len(PY))
