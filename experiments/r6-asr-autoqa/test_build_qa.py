import sys, pathlib, tempfile, unittest, json, hashlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from build_qa import patch_app,build,INTEGRATION, PATCH_HEADER

FIXTURE='''import { parseDocumentFile } from './lib/parser.js';
const perQuestionAudio=new Map();
function f(){
const blob=new Blob([]);
perQuestionAudio.set(turnAtStart.id,blob);
if(voskModel)enqueueQuestionAsr(turnAtStart.id);
if(!voskModel&&!voskLoadJob)void preloadVoskModel({silent:true});
}
'''
class BuildTests(unittest.TestCase):
    def test_all_hooks_present_exactly_once(self):
        out=patch_app(FIXTURE)
        self.assertTrue(out.startswith(PATCH_HEADER))
        self.assertIn('if(turnAtStart)r6WhisperSubmit(turnAtStart.id,blob);',out)
        self.assertEqual(out.count('r6WhisperSubmit(turnAtStart.id,blob)'),1)
        self.assertIn('Whisper 本题原始录音转写完成',out)
    def test_preserve_manual_and_revision(self):
        for marker in ('turn.manualEdited','turn.manualCleared','task.audioRevision','perQuestionAudio.get(task.turnId)===task.blob','turn.whisperCandidate=text'):
            self.assertIn(marker,INTEGRATION)
    def test_reject_wrong_source(self):
        with self.assertRaises(ValueError):patch_app(FIXTURE.replace('perQuestionAudio.set(turnAtStart.id,blob);','// lost'))
    def test_reject_duplicate_anchor(self):
        with self.assertRaises(ValueError):patch_app(FIXTURE+'\n'+FIXTURE)
    def test_reject_repatch(self):
        with self.assertRaises(ValueError):patch_app(patch_app(FIXTURE))
    def test_build_file_isolation(self):
        with tempfile.TemporaryDirectory() as tmp:
            t=pathlib.Path(tmp);site=t/'_site';base=site/'tcl-v352-asr';base.mkdir(parents=True)
            (base/'app.js').write_text(FIXTURE)
            (base/'index.html').write_text('<title>TCL</title>')
            (base/'other.bin').write_bytes(b'unchanged')
            (base/'static-manifest.json').write_text(json.dumps({'version':'R6','files':{}}))
            d=t/'src';d.mkdir();(d/'whisper-bridge.mjs').write_text('export const bridge = 1;')
            result=build(site,d)
            self.assertTrue(result['source_preserved']);self.assertEqual(result['pilot_files'],5)
            self.assertEqual((base/'app.js').read_text(),FIXTURE)
            self.assertEqual((site/'tcl-v352-asr-autoqa'/'other.bin').read_bytes(),b'unchanged')
            self.assertIn('ASR自动转写实验版',(site/'tcl-v352-asr-autoqa'/'index.html').read_text())
            m=json.loads((site/'tcl-v352-asr-autoqa'/'static-manifest.json').read_text())
            self.assertEqual(len(m['files']),4)
            self.assertEqual(m['files']['app.js'], hashlib.sha256((site/'tcl-v352-asr-autoqa'/'app.js').read_bytes()).hexdigest())
            with self.assertRaises(ValueError):build(site,d)
if __name__=='__main__':unittest.main(verbosity=2)
