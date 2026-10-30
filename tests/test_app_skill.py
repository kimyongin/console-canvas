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
from skill_install import default_target, install, status, sync_installed, MANAGED
from bridge import Broker
from server import VERSION


class AppSkillTests(unittest.TestCase):
    def test_explicit_skill_directory_never_scans_or_updates_user_roots(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = ROOT / 'dist/console-canvas-skill.zip'
            selected = root / 'qa/console-canvas'
            user = root / 'user/.codex/skills/console-canvas'
            install(archive, selected)
            install(archive, user)
            for target in (selected, user):
                (target / 'SKILL.md').write_text('---\nname: console-canvas\n---\nolder\n')
            with patch.dict(os.environ, {'CONSOLE_CANVAS_SKILL_DIR': str(selected)}, clear=True), patch('skill_install.Path.home', side_effect=AssertionError('OS home must not be queried for scoped QA')):
                self.assertEqual(default_target(), selected)
                result = sync_installed(archive)
                self.assertEqual([item['path'] for item in result['updated']], [str(selected.resolve())])
                self.assertEqual(result['errors'], [])
                self.assertIn('older', (user / 'SKILL.md').read_text())

    def test_retired_runtime_is_backed_up_without_losing_personal_files(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'console-canvas'
            archive = ROOT / 'dist/console-canvas-skill.zip'
            install(archive, target)
            old = target / 'assets/console-canvas-extension.zip'
            old.write_bytes(b'old managed runtime')
            (target / 'personal.txt').write_text('keep')
            self.assertFalse(status(archive, target)['current'])
            result = install(archive, target)
            self.assertFalse(old.exists())
            self.assertEqual((Path(result['backup']) / 'assets/console-canvas-extension.zip').read_bytes(), b'old managed runtime')
            self.assertEqual((target / 'personal.txt').read_text(), 'keep')
            self.assertTrue(status(archive, target)['current'])


    def test_auto_sync_does_not_create_an_uninstalled_skill(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True), patch('skill_install.Path.home', return_value=Path(directory)):
            result = sync_installed(ROOT / 'dist/console-canvas-skill.zip')
            self.assertEqual(result, {'updated': [], 'current': [], 'errors': []})
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_auto_sync_updates_all_existing_roots_and_preserves_personal_files(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True), patch('skill_install.Path.home', return_value=Path(directory)):
            root = Path(directory);archive = ROOT / 'dist/console-canvas-skill.zip'
            targets = [root / '.codex/skills/console-canvas', root / '.agents/skills/console-canvas', root / 'custom/skills/console-canvas']
            for target in targets:
                install(archive, target)
                (target / 'SKILL.md').write_text('---\nname: console-canvas\n---\nolder instructions\n')
                (target / 'personal.txt').write_text('keep this')
            with patch.dict(os.environ, {'CODEX_HOME': str(root / 'custom')}):
                result = sync_installed(archive)
                self.assertEqual(len(result['updated']), 3)
                self.assertEqual(result['errors'], [])
                for item in result['updated']:
                    self.assertIn('older instructions', (Path(item['backup']) / 'SKILL.md').read_text())
                    self.assertEqual((Path(item['path']) / 'personal.txt').read_text(), 'keep this')
                    self.assertTrue(status(archive, Path(item['path']))['current'])
                again = sync_installed(archive)
                self.assertEqual(again['updated'], [])
                self.assertEqual(len(again['current']), 3)
            # A CODEX_HOME alias must not update the same directory twice.
            with patch.dict(os.environ, {'CODEX_HOME': str(root / '.codex')}):
                self.assertEqual(len(sync_installed(archive)['current']), 2)

    def test_auto_sync_reports_one_failure_and_continues_other_installs(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True), patch('skill_install.Path.home', return_value=Path(directory)):
            root = Path(directory);archive = ROOT / 'dist/console-canvas-skill.zip'
            unrelated = root / '.codex/skills/console-canvas';unrelated.mkdir(parents=True)
            (unrelated / 'SKILL.md').write_text('---\nname: another-skill\n---\n')
            other = root / '.agents/skills/console-canvas';install(archive, other)
            (other / 'SKILL.md').write_text('---\nname: console-canvas\n---\nold\n')
            result = sync_installed(archive)
            self.assertEqual(len(result['errors']), 1)
            self.assertEqual(result['errors'][0]['path'], str(unrelated.resolve()))
            self.assertEqual(len(result['updated']), 1)
            self.assertIn('another-skill', (unrelated / 'SKILL.md').read_text())

    def test_partial_replacement_failure_restores_previous_managed_files(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'skills/console-canvas';archive = ROOT / 'dist/console-canvas-skill.zip'
            install(archive, target)
            (target / 'SKILL.md').write_text('---\nname: console-canvas\n---\nold guide\n')
            (target / 'agents/openai.yaml').write_text('old metadata')
            before = {name: (target / name).read_bytes() for name in MANAGED}
            replace = os.replace
            def fail_one(source, destination):
                if Path(destination).resolve() == (target / 'agents/openai.yaml').resolve():
                    raise PermissionError('simulated read-only file')
                return replace(source, destination)
            with patch('skill_install.os.replace', side_effect=fail_one):
                with self.assertRaises(PermissionError):
                    install(archive, target)
            self.assertEqual({name: (target / name).read_bytes() for name in MANAGED}, before)
            self.assertFalse(list(target.rglob('.console-canvas-*')))

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
