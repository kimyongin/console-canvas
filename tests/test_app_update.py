"""Release integrity, archive boundaries and transactional bundle replacement."""
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location('app_update', Path(__file__).resolve().parents[1] / 'mcp/app_update.py')
update = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(update)


def release(tag='v0.6.0', arch='arm64', **extra):
    name = 'console-canvas-desktop-macos-' + arch + '.zip'
    return {'tag_name': tag, 'prerelease': True, 'draft': False, 'assets': [{
        'name': name, 'state': 'uploaded', 'size': 100, 'digest': 'sha256:' + 'a' * 64,
        'browser_download_url': 'https://github.com/' + update.REPO + '/releases/download/' + tag + '/' + name}], **extra}


class UpdateTests(unittest.TestCase):
    def test_semantic_versions_architecture_and_channels(self):
        chosen = update.select_release([release('v0.9.0'), release('v0.10.0'), release('v0.11.0', 'x64')], '0.5.0', 'arm64')
        self.assertEqual(chosen['version'], '0.10.0')
        self.assertIsNone(update.select_release([release()], '0.6.0', 'arm64'))
        self.assertIsNone(update.select_release([release('v2.0.0')], '1.0.0', 'arm64'))
        self.assertEqual(update.select_release([release('v2.0.0', prerelease=False)], '1.0.0', 'arm64')['version'], '2.0.0')

    def test_missing_digest_foreign_url_draft_are_not_offered(self):
        for field, value in [('digest', None), ('browser_download_url', 'https://example.com/update.zip'), ('size', -1)]:
            item = release();item['assets'][0][field] = value
            self.assertIsNone(update.select_release([item], '0.5.0', 'arm64'))
        self.assertIsNone(update.select_release([release(draft=True)], '0.5.0', 'arm64'))

    def test_zip_paths_and_symlinks_cannot_leave_app(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'update.zip'
            for name in ['../escape', '/escape', 'Other.app/file', 'Console Canvas.app/../escape']:
                with self.subTest(name=name):
                    with zipfile.ZipFile(archive, 'w') as bundle:bundle.writestr(name, b'bad')
                    with self.assertRaises(ValueError):update.validate_archive(archive)
            for link in ['/Applications', '../../escape']:
                with zipfile.ZipFile(archive, 'w') as bundle:
                    item = zipfile.ZipInfo('Console Canvas.app/Contents/link');item.external_attr = (stat.S_IFLNK | 0o755) << 16
                    bundle.writestr(item, link)
                with self.assertRaises(ValueError):update.validate_archive(archive)
            with zipfile.ZipFile(archive, 'w') as bundle:
                item = zipfile.ZipInfo('Console Canvas.app/Contents/Frameworks/Current');item.external_attr = (stat.S_IFLNK | 0o755) << 16
                bundle.writestr(item, 'Versions/A')
            update.validate_archive(archive)

    def fixture(self, root):
        target = root / update.APP_NAME;target.mkdir();(target / 'version').write_text('0.5.0')
        pending = root / '.ConsoleCanvas-update-fixture.app';pending.mkdir();(pending / 'version').write_text('0.6.0')
        archive = root / 'release.zip';archive.write_bytes(b'archive fixture')
        plan = root / 'plan.json';plan.write_text(json.dumps({'target': str(target), 'pending': str(pending), 'current': '0.5.0', 'version': '0.6.0', 'arch': 'arm64', 'archive': str(archive), 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}))
        return target, pending, archive, plan

    def test_apply_keeps_previous_app_and_does_not_touch_user_data(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(update, 'validate_app'):
            root = Path(directory);target, pending, archive, plan = self.fixture(root)
            data = root / 'Application Support';data.mkdir();(data / 'scene').write_text('saved snapshots')
            result = update.apply_plan(plan, relaunch=False)
            self.assertEqual((target / 'version').read_text(), '0.6.0')
            self.assertEqual((Path(result['backup']) / 'version').read_text(), '0.5.0')
            self.assertEqual((data / 'scene').read_text(), 'saved snapshots')

    def test_failed_post_install_validation_rolls_back(self):
        with tempfile.TemporaryDirectory() as directory:
            target, pending, archive, plan = self.fixture(Path(directory))
            with patch.object(update, 'validate_app', side_effect=[None, None, ValueError('invalid installed app')]):
                with self.assertRaises(ValueError):update.apply_plan(plan, relaunch=False)
            self.assertEqual((target / 'version').read_text(), '0.5.0')
            self.assertEqual((pending / 'version').read_text(), '0.6.0')

    def test_tampered_archive_never_replaces_app(self):
        with tempfile.TemporaryDirectory() as directory:
            target, pending, archive, plan = self.fixture(Path(directory));archive.write_bytes(b'changed')
            with self.assertRaises(ValueError):update.apply_plan(plan, relaunch=False)
            self.assertEqual((target / 'version').read_text(), '0.5.0')


if __name__ == '__main__':unittest.main()
