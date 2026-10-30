import json
from contextlib import nullcontext
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from scripts import dev_signing as signing


class DevelopmentSigningTests(unittest.TestCase):
    fingerprint = 'A' * 40

    def identity(self, root):
        root.chmod(0o700)
        for name in signing.FILES:
            signing.private_write(root / name, json.dumps({'kind': 'local-development-certificate', 'fingerprint': self.fingerprint}) if name == 'identity.json' else 'private-placeholder')

    def test_existing_identity_is_reused_without_creation_or_rotation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.identity(root)
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            with patch.object(signing, 'certificate_fingerprint', return_value=self.fingerprint), patch.object(signing, 'command', side_effect=AssertionError('Existing identity must not be recreated')):
                info = signing.prepare(root)
            self.assertEqual(info['fingerprint'], self.fingerprint)
            self.assertEqual(before, {p.name: p.read_bytes() for p in root.iterdir()})
            self.assertNotIn('password', info)

    def test_incomplete_identity_does_not_silently_generate_a_new_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            signing.private_write(root / 'password', 'preserved')
            with self.assertRaises(signing.SigningError), patch.object(signing, 'command', side_effect=AssertionError('Do not rotate incomplete identity')):
                signing.prepare(root)
            self.assertEqual((root / 'password').read_text(), 'preserved')

    def test_broad_file_permissions_and_changed_certificate_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.identity(root)
            (root / 'password').chmod(0o644)
            with self.assertRaises(signing.SigningError):
                signing.load(root)
            (root / 'password').chmod(0o600)
            with patch.object(signing, 'certificate_fingerprint', return_value='B' * 40), self.assertRaises(signing.SigningError):
                signing.load(root)

    def test_command_failure_never_exposes_password_or_full_arguments(self):
        secret = 'fixture-password'
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'Failed ' + secret)):
            with self.assertRaises(signing.SigningError) as failure:
                signing.command(['/usr/bin/security', 'unlock-keychain', '-p', secret], secret)
        self.assertNotIn(secret, str(failure.exception))
        self.assertNotIn('unlock-keychain', str(failure.exception))

    def test_ad_hoc_result_cannot_pass_as_stable_certificate_signing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.identity(root)
            with patch.object(signing, 'certificate_fingerprint', return_value=self.fingerprint), patch.object(signing, 'signing_keychain', return_value=nullcontext()), patch.object(signing, 'command', return_value=('', 'designated => cdhash H"123"')):
                with self.assertRaises(signing.SigningError):
                    signing.sign(root / 'fixture.app', root)

    def test_sign_uses_only_the_prepared_identity_and_private_keychain(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.identity(root)
            requirement = 'identifier "com.consolecanvas.desktop" and anchor H"' + self.fingerprint + '"'
            with patch.object(signing, 'certificate_fingerprint', return_value=self.fingerprint), patch.object(signing, 'signing_keychain', return_value=nullcontext()), patch.object(signing, 'command', return_value=('', 'designated => ' + requirement)) as run:
                result = signing.sign(root / 'fixture.app', root)
            args = run.call_args_list[1].args[0]
            self.assertIn(self.fingerprint, args)
            self.assertIn(str(root / 'development.keychain-db'), args)
            self.assertNotIn('-', args)
            self.assertEqual(result['requirement'], requirement)
            self.assertEqual(result['keychainUpdateReapproval'], 'possible-self-signed-cdhash-partition')

    def test_search_list_restores_our_addition_after_failure_without_removing_unrelated_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            info = {'directory': directory, 'keychain': directory + '/build.keychain-db'}
            with patch.object(signing, 'search_list', side_effect=[['login'], ['login', info['keychain'], 'user-added']]), patch.object(signing, 'command') as run:
                with self.assertRaises(RuntimeError):
                    with signing.signing_keychain(info):
                        raise RuntimeError('fixture signing failure')
            self.assertEqual(run.call_args_list[-1].args[0], ['/usr/bin/security', 'list-keychains', '-d', 'user', '-s', 'login', 'user-added'])


if __name__ == '__main__':
    unittest.main()
