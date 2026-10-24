"""App-bundled skill installation, backups, and guidance without an open screen."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'mcp'))
from skill_install import default_target, install, status, MANAGED
from bridge import Broker
from server import VERSION


class AppSkillTests(unittest.TestCase):
    def test_app_zip_installs_offline_and_repeated_install_is_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'skills/console-canvas'
            archive = ROOT / 'dist/console-canvas-skill.zip'
            result = install(archive, target)
            self.assertTrue(result['current'])
            self.assertEqual(set(result['changed_files']), set(MANAGED))
            second = install(archive, target)
            self.assertEqual(second['changed_files'], [])
            self.assertIsNone(second['backup'])
            self.assertTrue(status(archive, target)['current'])

    def test_updates_back_up_replaced_files_and_preserve_custom_files(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'skills/console-canvas'
            archive = ROOT / 'dist/console-canvas-skill.zip'
            install(archive, target)
            changed = (target / 'SKILL.md').read_text() + '\nPersonal customization\n'
            (target / 'SKILL.md').write_text(changed)
            (target / 'personal.txt').write_text('keep me')
            result = install(archive, target)
            self.assertEqual((Path(result['backup']) / 'SKILL.md').read_text(), changed)
            self.assertNotIn(target.parent, Path(result['backup']).parents)
            self.assertEqual((target / 'personal.txt').read_text(), 'keep me')
            self.assertTrue(result['current'])

    def test_other_skills_and_zip_path_traversal_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'skills/console-canvas'
            target.mkdir(parents=True)
            (target / 'SKILL.md').write_text('---\nname: unrelated-skill\n---\n')
            with self.assertRaises(ValueError):
                install(ROOT / 'dist/console-canvas-skill.zip', target)
            self.assertIn('unrelated-skill', (target / 'SKILL.md').read_text())
            archive = Path(directory) / 'bad.zip'
            with zipfile.ZipFile(archive, 'w') as bundle:
                bundle.writestr('../escape', 'do not write')
            with self.assertRaises(ValueError):
                install(archive, Path(directory) / 'new-skill')
            self.assertFalse((Path(directory) / 'escape').exists())

    def test_symlinked_managed_subdirectories_cannot_redirect_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'skills/console-canvas'
            outside = root / 'outside'
            target.mkdir(parents=True);outside.mkdir()
            (target / 'SKILL.md').write_text('---\nname: console-canvas\n---\n')
            (target / 'assets').symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError):
                install(ROOT / 'dist/console-canvas-skill.zip', target)
            self.assertEqual(list(outside.iterdir()), [])

    def test_fresh_install_uses_agents_and_existing_legacy_install_is_reused(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True), patch('skill_install.Path.home', return_value=Path(directory)):
            self.assertEqual(default_target(), Path(directory) / '.agents/skills/console-canvas')
            legacy = Path(directory) / '.codex/skills/console-canvas'
            legacy.mkdir(parents=True)
            self.assertEqual(default_target(), legacy)
            with patch.dict(os.environ, {'CODEX_HOME': str(Path(directory) / 'custom-codex')}):
                self.assertEqual(default_target(), Path(directory) / 'custom-codex/skills/console-canvas')

    def test_mcp_can_read_app_skill_without_any_connected_editor(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            markdown = (ROOT / 'skills/console-canvas/SKILL.md').read_text()
            (root / 'agent-guide.md').write_text(markdown)
            broker = Broker(root)
            guide = broker.call('get_agent_guide', {})
            self.assertTrue(guide['ok'])
            self.assertEqual(guide['markdown'], markdown)
            self.assertEqual(guide['version'], VERSION)
            self.assertEqual(broker.sessions, {})
            self.assertFalse(guide['installation_required_for_mcp'])
            self.assertEqual(broker.call('get_agent_guide', {'path': '/etc/passwd'})['error']['code'], 'invalid_arguments')


if __name__ == '__main__':
    unittest.main()
