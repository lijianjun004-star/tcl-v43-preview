"""Build protections exercised against the real pinned pages3 frontend ZIP."""
import contextlib
import hashlib
import io
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

SOURCE = pathlib.Path(__file__).resolve().parents[1]
REPO = SOURCE.parents[1]
sys.path.insert(0, str(SOURCE / 'tools'))
from apply_to_r24 import build, patch_app, EXTERNAL_MODEL_FILES, ISOLATED_MODULE_KEYS, VERSION

ARCHIVE = REPO / 'experiments/r24-paraformer-release/site-only.zip'
ARCHIVE_SHA = 'dec534aac5467b07fba730e422f14200d26e3293fd1f964bf1c4ff88d8f33fa5'


class R24PatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.base = pathlib.Path(cls.temp.name) / 'tcl-r24-paraformer-excel-qa'
        cls.base.mkdir()
        raw = ARCHIVE.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == ARCHIVE_SHA, 'Official pages3 ZIP changed'
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            archive.extractall(cls.base)
        cls.app = (cls.base / 'app.js').read_text('utf-8')
        cls.output = pathlib.Path(cls.temp.name) / 'build'
        with contextlib.redirect_stdout(io.StringIO()):
            build(cls.base, cls.output)
        cls.site = cls.output / cls.base.name

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_01_unknown_code_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'expected exactly one anchor'):
            patch_app(self.app.replace('let operatorActiveTab="publish";', 'let operatorActiveTab="latest";'))

    def test_02_ui_training_and_asr_implementations_preserved(self):
        for name in ['index.html', 'style.css', 'training-boards.json', 'legacy-65.json',
                     'whisper-bridge.mjs', 'whisper-worker.mjs', 'paraformer-bridge.mjs',
                     'asr-glossary.mjs', 'asr-normalize.mjs']:
            self.assertEqual((self.base / name).read_bytes(), (self.site / name).read_bytes(), name)
        for name, (before, after) in ISOLATED_MODULE_KEYS.items():
            self.assertEqual((self.site / name).read_text(), (self.base / name).read_text().replace(before, after, 1), name)

    def test_03_complete_manifest_and_exact_external_models(self):
        manifest = json.loads((self.site / 'static-manifest.json').read_text())
        self.assertEqual(manifest['version'], VERSION)
        missing = {}
        for name, expected in manifest['files'].items():
            path = self.site / name
            if path.exists():
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), expected, name)
            else:
                missing[name] = expected
        self.assertEqual(missing, EXTERNAL_MODEL_FILES)
        self.assertEqual(len(manifest['files']), 35)

    def test_04_assignment_pool_and_snapshots_are_separate(self):
        script = (self.site / 'app.js').read_text()
        self.assertIn('questionsForAssignment(sourceAssignment)', script)
        self.assertIn('assignmentSnapshot:structuredClone(sessionAssignmentSnapshot)', script)
        self.assertIn('await verifyAssignmentSnapshot(lateAssignment,snap,', script)
        self.assertNotIn('localEntries.push(...assignment', script)
        self.assertNotIn("assignment.questions.forEach(q=>localEntries", script)

    def test_05_only_reviewed_frontend_files_change(self):
        changed = {p.relative_to(self.base).as_posix() for p in self.base.rglob('*')
                   if p.is_file() and p.read_bytes() != (self.site / p.relative_to(self.base)).read_bytes()}
        added = {p.relative_to(self.site).as_posix() for p in self.site.rglob('*')
                 if p.is_file() and not (self.base / p.relative_to(self.site)).exists()}
        self.assertEqual(changed, {'app.js', 'static-manifest.json', 'lib/parser.js', 'lib/qa-import.js', *ISOLATED_MODULE_KEYS})
        self.assertEqual(added, {'assignment-excel.mjs'})

    def test_06_database_preferences_and_caches_are_isolated(self):
        script = (self.site / 'app.js').read_text()
        self.assertIn("const STORE_NAME='tcl-specialty-r24-paraformer-excel-qa-v1'", script)
        self.assertIn("new BroadcastChannel(STORE_NAME+'-workflow')", script)
        self.assertNotIn("'tcl-specialty-r24-paraformer-v1'", script)
        self.assertNotIn("'tcl-r24-paraformer-asr-model-v1'", script)
        self.assertNotIn("'tcl-specialty-v352-asr-r24-qa-vosk-v1'", script)
        for name, (before, after) in ISOLATED_MODULE_KEYS.items():
            data = (self.site / name).read_text()
            self.assertNotIn(before, data)
            self.assertIn(after, data)

    def test_07_generated_app_and_module_are_valid_javascript(self):
        for name in ['app.js', 'assignment-excel.mjs', 'paraformer-worker.js', 'glossary-ui.mjs']:
            result = subprocess.run(['node', '--input-type=module', '--check'],
                                    input=(self.site / name).read_text(), text=True,
                                    capture_output=True, timeout=15)
            self.assertEqual(result.returncode, 0, name + ': ' + result.stderr)

    def _bad_manifest(self, extra_name, digest):
        with tempfile.TemporaryDirectory() as temp:
            source = pathlib.Path(temp) / 'source'
            shutil.copytree(self.base, source)
            path = source / 'static-manifest.json'
            manifest = json.loads(path.read_text())
            manifest['files'][extra_name] = digest
            path.write_text(json.dumps(manifest))
            with contextlib.redirect_stdout(io.StringIO()):
                build(source, pathlib.Path(temp) / 'output')

    def test_08_arbitrary_missing_model_path_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Unexpected missing static resource'):
            self._bad_manifest('models/unreviewed.data', '0' * 64)

    def test_09_pinned_model_hash_cannot_be_relaxed(self):
        with self.assertRaisesRegex(ValueError, 'Unexpected missing static resource'):
            self._bad_manifest(next(iter(EXTERNAL_MODEL_FILES)), '0' * 64)

    def test_10_open_excel_assignments_keep_existing_search_and_no_required_roster(self):
        app = (self.site / 'app.js').read_text('utf-8')
        module = (self.site / 'assignment-excel.mjs').read_text('utf-8')
        self.assertNotIn('assignmentRecipients', app)
        self.assertNotIn('请填写接收作业的主播姓名', app)
        self.assertIn('assignedTo:[]', app)
        self.assertIn('本次作业面向所有主播开放领取', app)
        self.assertIn("localAssignments.filter(a=>isAssigned(a,userName)", app)
        self.assertIn('a.assignedTo.length === 0 || a.assignedTo.includes(anchorName.trim())', module)
        self.assertIn('已有的作业，跨手机须先导入', app)


if __name__ == '__main__':
    unittest.main(verbosity=2)
