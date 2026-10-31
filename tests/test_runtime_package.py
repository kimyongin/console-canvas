"""Only the supported desktop runtime is distributed; retired Chrome code stays archived."""
import hashlib
import json
from pathlib import Path
import unittest
import subprocess
import sys
import tempfile
import zipfile
ROOT = Path(__file__).resolve().parents[1]
class RuntimePackageTests(unittest.TestCase):
    def test_supported_runtime_integrity_and_retired_assets(self):
        manifest = json.loads((ROOT / 'runtime-manifest.json').read_text())
        with zipfile.ZipFile(ROOT / 'dist/console-canvas-runtime.zip') as package:
            names = {name.removeprefix('console-canvas/') for name in package.namelist()}
            self.assertEqual(names, set(manifest['files']) | {'runtime-manifest.json'})
            for name, digest in manifest['files'].items():
                self.assertEqual(hashlib.sha256(package.read('console-canvas/' + name)).hexdigest(), digest)
            for retired in ('manifest.json', 'background.js', 'chrome-capture.js', 'webmcp-client.js', 'capture-assets.js', 'snapshot-history.js', 'ai-provider.js', 'desktop/chatgpt.cjs', 'desktop/chatgpt-ipc.cjs', 'code-patches.js', 'ui/snapshot-panel.js'):
                self.assertNotIn(retired, names)
            self.assertFalse(any(name.startswith(('archive/', 'local/', 'tests/')) for name in names))
            self.assertTrue({'editor.html', 'engine.js', 'capture.js', 'desktop/main.cjs', 'mcp/server.py', 'tool-contract.json', 'edit-policy.json'} <= names)
            editor = package.read('console-canvas/editor-runtime.js').decode()
            self.assertNotIn('webmcp-enable', editor)
            self.assertNotIn('register_ai_candidate', editor)
            self.assertNotIn('snapshot-panel', editor)
            self.assertNotIn('canvas:chatgpt-', package.read('console-canvas/desktop/preload.cjs').decode())
            self.assertNotIn('Chrome 확장 프로그램 설치', editor)
            self.assertEqual(package.read('console-canvas/agent-guide.md'), (ROOT / 'skills/console-canvas/SKILL.md').read_bytes())
        for retired in ('console-canvas-chrome.zip', 'console-canvas-extension.zip', 'chrome-package.json'):
            self.assertFalse((ROOT / 'dist' / retired).exists())
        self.assertTrue((ROOT / 'archive/chrome-extension/manifest.json').is_file())

    def test_extracted_runtime_starts_native_mcp_without_repository_files(self):
        with tempfile.TemporaryDirectory() as folder:
            with zipfile.ZipFile(ROOT / 'dist/console-canvas-runtime.zip') as package:
                package.extractall(folder)
            runtime = Path(folder) / 'console-canvas'
            result = subprocess.run([sys.executable, str(runtime / 'mcp/server.py'), '--help'],
                                    cwd=folder, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('--app-dir', result.stdout)
