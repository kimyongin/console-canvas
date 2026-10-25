"""Chrome artifact has the common runtime without native implementation files."""
import hashlib
import json
from pathlib import Path
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]


class ChromePackageTests(unittest.TestCase):
    def test_public_asset_parity_and_integrity(self):
        descriptor = json.loads((ROOT / 'dist/chrome-package.json').read_text())
        archive = ROOT / 'dist' / descriptor['archive']
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), descriptor['sha256'])
        with zipfile.ZipFile(archive) as package:
            names = {name.removeprefix('console-canvas/') for name in package.namelist()}
            self.assertEqual(names, set(descriptor['files']))
            for name, digest in descriptor['files'].items():
                data = package.read('console-canvas/' + name)
                self.assertEqual(hashlib.sha256(data).hexdigest(), digest)
                self.assertEqual(data, (ROOT / name).read_bytes())
            self.assertFalse(any(name.startswith(('desktop/', 'mcp/', 'local/', 'tests/')) for name in names))
            self.assertFalse(any(name.endswith(('.py', '.cjs', '.pem', '.key')) for name in names))
            manifest = json.loads(package.read('console-canvas/manifest.json'))
            self.assertEqual(manifest['version'], descriptor['version'])
            self.assertNotIn('nativeMessaging', manifest['permissions'])
            self.assertIn('tool-contract.json', names)
            self.assertIn('agent-guide.md', names)
            self.assertIn('review-image.html', names)
            self.assertEqual(package.read('console-canvas/agent-guide.md'),
                             (ROOT / 'skills/console-canvas/SKILL.md').read_bytes())
