import hashlib, json, pathlib, shutil, sys, tempfile, unittest, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'implementation/tools'))
from apply_to_r24 import build, patch_app
BASE=ROOT/'base/tcl-v352-asr-r24-qa'

class R24PatchTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls): cls.app=(BASE/'app.js').read_text('utf8')
 def test_01_unknown_code_fails_closed(self):
  with self.assertRaisesRegex(ValueError,'expected exactly one anchor'):patch_app(self.app.replace("let operatorActiveTab=\"publish\";",'let operatorActiveTab="latest";'))
 def test_02_no_reference_data_mutation(self):
  with tempfile.TemporaryDirectory() as d:
   out=pathlib.Path(d); build(BASE,out);site=out/BASE.name
   for name in ['index.html','style.css','training-boards.json','legacy-65.json','whisper-bridge.mjs','whisper-worker.mjs']:
    self.assertEqual((BASE/name).read_bytes(),(site/name).read_bytes(),name)
 def test_03_manifest_covers_new_module(self):
  with tempfile.TemporaryDirectory() as d:
   out=pathlib.Path(d);build(BASE,out);site=out/BASE.name
   files=json.loads((site/'static-manifest.json').read_text())['files']
   self.assertEqual(files['assignment-excel.mjs'],hashlib.sha256((site/'assignment-excel.mjs').read_bytes()).hexdigest())
   self.assertEqual(files['app.js'],hashlib.sha256((site/'app.js').read_bytes()).hexdigest())
 def test_04_questions_do_not_enter_public_pool(self):
  script=patch_app(self.app)
  self.assertIn('questionsForAssignment(assigned):JSON.parse(JSON.stringify(practiceEntriesFor(b,activePlatform)))',script)
  self.assertIn('if(currentAssignment()?.schema)return Math.min(sessionTurns.length,ids.length)',script)
  self.assertIn('nextQuestion()',script)
  self.assertNotIn('localEntries.push(...assignment',script)
 def test_05_only_allowed_app_and_manifest_modifications(self):
  with tempfile.TemporaryDirectory() as d:
   out=pathlib.Path(d);build(BASE,out);site=out/BASE.name
   changed={p.relative_to(BASE).as_posix() for p in BASE.rglob('*') if p.is_file() and p.read_bytes()!=(site/p.relative_to(BASE)).read_bytes()}
   added={p.relative_to(site).as_posix() for p in site.rglob('*') if p.is_file() and not (BASE/p.relative_to(site)).exists()}
   self.assertEqual(changed,{'app.js','static-manifest.json','lib/parser.js','lib/qa-import.js'})
   self.assertEqual(added,{'assignment-excel.mjs'})

if __name__=='__main__':unittest.main(verbosity=2)