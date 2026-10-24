"""Exercise agent handoff semantics and portable skill preparation."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'skills' / 'console-canvas' / 'scripts' / 'console_canvas.py'
SPEC = importlib.util.spec_from_file_location('console_canvas', SCRIPT)
tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tool)


def snapshot():
    def node(node_id, parent, x):
        return {'id': node_id, 'parentId': parent, 'name': node_id, 'tag': 'div',
                'kind': 'element', 'locator': {'selector': '#' + node_id},
                'rect': {'x': x, 'y': 20, 'width': 100, 'height': 30}}
    return {'format': 'console-canvas-snapshot', 'version': 1,
            'html': '<html><body>fixture</body></html>',
            'source': {'url': 'https://example.com/console', 'title': 'Fixture'},
            'warnings': [], 'nodes': [node('n1', None, 10), node('n2', 'n1', 15), node('n3', 'n2', 20)]}


def review():
    return {'format': 'console-canvas-review', 'version': 1, 'snapshot': snapshot(),
            'edits': {'n1': {'dx': 10, 'dy': -2}, 'n2': {'dx': 3, 'dy': 4}},
            # The helper must recompute from snapshot+edits, rather than trust stale changes.
            'changes': [{'id': 'n1', 'action': 'delete'}], 'note': 'Move the group and label'}


class HandoffTests(unittest.TestCase):
    def test_nested_offsets_and_original_selectors(self):
        summary, changes = tool.summarize(review())
        self.assertEqual((summary['moves'], summary['deletions']), (2, 0))
        self.assertEqual(changes[0]['affectedDescendants'], 2)
        self.assertEqual(changes[1]['delta'], {'x': 3, 'y': 4})
        self.assertEqual(changes[1]['effectiveDelta'], {'x': 13, 'y': 2})
        self.assertEqual(changes[1]['after']['x'], 28)
        self.assertEqual(changes[1]['locator']['selector'], '#n2')

    def test_deleted_parent_hides_detached_child_changes(self):
        data = review()
        data['edits']['n1']['deleted'] = True
        data['edits']['n3'] = {'dx': 70, 'deleted': True}
        summary, changes = tool.summarize(data)
        self.assertEqual(summary['deletions'], 1)
        self.assertEqual(len(changes), 1)
        self.assertIsNone(changes[0]['after'])
        self.assertEqual(changes[0]['affectedDescendants'], 2)

    def test_offset_cleanup_matches_editor(self):
        data = review()
        data['edits'] = {'n1': {'dx': 999999, 'dy': -999999},
                         'n2': {'dx': True, 'deleted': 'yes'}, 'unknown': {'deleted': True}}
        _, changes = tool.summarize(data)
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]['delta'], {'x': 60000, 'y': -200000})

    def test_cycles_missing_parents_and_duplicates_fail(self):
        for mutation in ('cycle', 'missing', 'duplicate'):
            with self.subTest(mutation=mutation):
                data = snapshot()
                if mutation == 'cycle':
                    data['nodes'][0]['parentId'] = 'n3'
                elif mutation == 'missing':
                    data['nodes'][1]['parentId'] = 'n99'
                else:
                    data['nodes'].append(copy.deepcopy(data['nodes'][0]))
                with self.assertRaises(ValueError):
                    tool.summarize(data)

    def test_changes_only_has_no_reeditable_snapshot(self):
        data = {'format': 'console-canvas-changes', 'version': 1,
                'source': {}, 'changes': [{'action': 'delete', 'id': 'n1'}]}
        summary, changes = tool.summarize(data)
        self.assertFalse(summary['canReopen'])
        self.assertEqual(len(changes), 1)

    def test_json_version_and_nonfinite_fail(self):
        for raw in (b'{"version":2}', b'{"version":1,"value":NaN}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                tool.read_json(raw)

    def test_review_archive_extracts_only_data_and_images(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'review.zip'
            with zipfile.ZipFile(archive, 'w') as bundle:
                bundle.writestr('review.json', json.dumps(review()))
                bundle.writestr('after.png', b'\x89PNG\r\n\x1a\nfixture')
                bundle.writestr('review.html', '<script>doNotExecute()</script>')
                bundle.writestr('unexpected.txt', 'ignored')
            result = tool.review(archive, root / 'out')
            self.assertEqual(result['moves'], 2)
            self.assertTrue(Path(result['reopen_input']).is_file())
            self.assertFalse((root / 'out' / 'review.html').exists())
            summary = json.loads(Path(result['summary']).read_text())
            self.assertEqual(summary['ignoredZipEntries'], ['unexpected.txt'])
            with self.assertRaises(FileExistsError):
                tool.review(archive, root / 'out')

    def test_zip_path_traversal_and_duplicate_fail_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for bad_name in ('../escape.txt', '/escape.txt', 'a\\escape.txt'):
                with self.subTest(name=bad_name):
                    archive = root / 'bad.zip'
                    with zipfile.ZipFile(archive, 'w') as bundle:
                        bundle.writestr('review.json', json.dumps(review()))
                        bundle.writestr(bad_name, 'bad')
                    with self.assertRaises(ValueError):
                        tool.review(archive, root / 'out')
                    self.assertFalse((root / 'out').exists())
            import warnings
            with zipfile.ZipFile(root / 'duplicate.zip', 'w') as bundle, warnings.catch_warnings():
                warnings.simplefilter('ignore', UserWarning)
                bundle.writestr('review.json', json.dumps(review()))
                bundle.writestr('review.json', json.dumps(review()))
            with self.assertRaises(ValueError):
                tool.review(root / 'duplicate.zip', root / 'out')

    def test_install_then_prepare_without_repository(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installed = root / 'installed-skill'
            subprocess.run([sys.executable, str(ROOT / 'scripts' / 'install_skill.py'),
                            '--target', str(installed)], check=True, capture_output=True)
            result = subprocess.run([sys.executable, str(installed / 'scripts' / 'console_canvas.py'),
                                     'prepare', '--output', str(root / 'runtime')],
                                    check=True, capture_output=True, text=True)
            prepared = json.loads(result.stdout)
            extension = Path(prepared['extension_directory'])
            self.assertEqual(json.loads((extension / 'manifest.json').read_text())['manifest_version'], 3)
            self.assertIn('embedded-sample', Path(prepared['preview']).read_text())
            self.assertEqual(prepared['files'], 15)
            again = subprocess.run([sys.executable, str(ROOT / 'scripts' / 'install_skill.py'),
                                    '--target', str(installed)], capture_output=True)
            self.assertNotEqual(again.returncode, 0)


if __name__ == '__main__':
    unittest.main()
