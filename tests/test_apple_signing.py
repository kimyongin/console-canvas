import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts import apple_signing as signing


class AppleDevelopmentSigningTests(unittest.TestCase):
    fingerprint = 'A' * 40
    team = 'TESTTEAM01'

    def details(self):
        return '\n'.join(['TeamIdentifier=' + self.team, 'CDHash=' + 'b' * 40,
                          'designated => identifier "com.consolecanvas.desktop" and anchor apple generic'])

    def selected(self):
        return {'kind': 'apple-development', 'fingerprint': self.fingerprint, 'teamId': self.team}

    def test_selection_pins_verified_public_identity_and_never_rotates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); root.chmod(0o700)
            with patch.object(signing, 'inspect', return_value=self.selected()):
                signing.select(root / 'fixture.app', root)
                first = signing.selection_path(root).read_bytes()
                signing.select(root / 'fixture.app', root)
            self.assertEqual(signing.load(root), self.selected())
            self.assertEqual(signing.selection_path(root).read_bytes(), first)
            with patch.object(signing, 'inspect', return_value={**self.selected(), 'fingerprint': 'B' * 40}):
                with self.assertRaises(signing.SigningError):
                    signing.select(root / 'fixture.app', root)
            self.assertEqual(signing.selection_path(root).read_bytes(), first)

    def test_pinned_selection_rejects_symlinks_and_broad_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); root.chmod(0o700)
            file = signing.selection_path(root)
            file.write_text(json.dumps(self.selected())); file.chmod(0o644)
            with self.assertRaises(signing.SigningError): signing.load(root)
            file.unlink(); file.symlink_to(root / 'missing')
            with self.assertRaises(signing.SigningError): signing.load(root)

    def test_missing_apple_identity_fails_before_signing_and_has_no_fallback(self):
        with patch.object(signing, 'load', return_value=self.selected()), patch.object(signing, 'command', return_value=('0 valid identities found', '')) as run:
            with self.assertRaises(signing.SigningError): signing.sign(Path('/fixture.app'))
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0][0], '/usr/bin/security')

    def test_inspection_requires_real_apple_chain_and_matching_fingerprint(self):
        def command(args):
            if '-vvv' in args: return ('', self.details())
            if args[0].endswith('openssl'): return ('sha1 Fingerprint=' + self.fingerprint, '')
            if args[0].endswith('security'): return ('1) ' + self.fingerprint + ' "Apple Development: Fixture"', '')
            return ('', '')
        with patch.object(signing, 'command', side_effect=command) as run:
            result = signing.inspect(Path('/fixture.app'), self.fingerprint, self.team)
            self.assertEqual(result['teamId'], self.team)
            self.assertTrue(any('=anchor apple generic and certificate leaf[subject.OU] = "TESTTEAM01"' in call.args[0] for call in run.call_args_list))
            self.assertTrue(any(any(arg.startswith('--extract-certificates=') for arg in call.args[0]) for call in run.call_args_list))
            self.assertFalse(any('-w' in call.args[0] or '-g' in call.args[0] for call in run.call_args_list))
            with self.assertRaises(signing.SigningError): signing.inspect(Path('/fixture.app'), 'B' * 40, self.team)

    def test_apple_chain_failure_stops_inspection(self):
        def command(args):
            if '-vvv' in args: return ('', self.details())
            if '-R' in args: raise signing.SigningError('Not Apple issued')
            return ('', '')
        with patch.object(signing, 'command', side_effect=command) as run:
            with self.assertRaises(signing.SigningError): signing.inspect(Path('/fixture.app'))
            self.assertFalse(any(any(arg.startswith('--extract-certificates') for arg in call.args[0]) for call in run.call_args_list))

    def test_team_change_is_rejected_before_any_certificate_read(self):
        with patch.object(signing, 'command', return_value=('', self.details())) as run:
            with self.assertRaises(signing.SigningError): signing.inspect(Path('/fixture.app'), team_id='OTHERTEAM1')
        self.assertEqual(run.call_count, 2)

    def test_build_specific_apple_requirement_is_not_pinned(self):
        details = self.details().replace('identifier "com.consolecanvas.desktop" and anchor apple generic', 'cdhash H"' + 'b' * 40 + '"')
        with patch.object(signing, 'command', return_value=('', details)):
            with self.assertRaises(signing.SigningError): signing.inspect(Path('/fixture.app'))


if __name__ == '__main__':
    unittest.main()
