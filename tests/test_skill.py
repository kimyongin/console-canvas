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


class SkillRuntimeTests(unittest.TestCase):
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
            extension = Path(prepared['runtime_directory'])
            self.assertFalse((extension / 'manifest.json').exists())
            self.assertFalse((extension / 'background.js').exists())
            self.assertIn('embedded-sample', Path(prepared['preview']).read_text())
            self.assertGreater(prepared['files'], 31)
            self.assertTrue((extension / 'ui/workspace-layout.js').is_file())
            self.assertTrue((extension / 'edit-commands.js').is_file())
            public = json.loads((extension / 'runtime-manifest.json').read_text())['public']
            self.assertTrue(all((extension / name).is_file() for name in public))
            self.assertNotIn('desktop/main.cjs', public)
            self.assertTrue((extension / 'mcp/server.py').is_file())
            self.assertTrue((extension / 'desktop/main.cjs').is_file())
            again = subprocess.run([sys.executable, str(ROOT / 'scripts' / 'install_skill.py'),
                                    '--target', str(installed)], capture_output=True)
            self.assertNotEqual(again.returncode, 0)


if __name__ == '__main__':
    unittest.main()
