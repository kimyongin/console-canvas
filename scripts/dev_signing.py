#!/usr/bin/env python3
"""Persistent, local-only macOS development signing identity. No system trust changes."""
import argparse
from contextlib import contextmanager
import datetime
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import subprocess
import tempfile

DEFAULT_DIRECTORY = Path(os.environ.get('CONSOLE_CANVAS_SIGNING_DIR', str(Path.home() / 'Library' / 'Application Support' / 'Console Canvas Development Signing')))
FILES = ('identity.json', 'certificate.pem', 'identity.p12', 'password', 'development.keychain-db')


class SigningError(RuntimeError):
    pass


def command(args, secret='', env=None):
    result = subprocess.run(args, capture_output=True, text=True, env=env)
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()
        if secret:
            detail = detail.replace(secret, '[redacted]')
        raise SigningError(Path(args[0]).name + ' failed: ' + detail[:1500])
    return result.stdout, result.stderr


def private_write(path, value):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as output:
        output.write(value)


def certificate_fingerprint(path):
    out, _ = command(['/usr/bin/openssl', 'x509', '-in', str(path), '-noout', '-fingerprint', '-sha1'])
    value = out.strip().split('=')[-1].replace(':', '').upper()
    if not re.fullmatch(r'[A-F0-9]{40}', value):
        raise SigningError('Invalid development certificate fingerprint')
    return value


def search_list():
    out, _ = command(['/usr/bin/security', 'list-keychains', '-d', 'user'])
    return shlex.split(out)


@contextmanager
def signing_keychain(info):
    # codesign requires its identity keychain in the search list, even with
    # --keychain. Serialize builds and restore only our temporary addition.
    import fcntl
    lock_path = Path(info['directory']) / 'signing.lock'
    with os.fdopen(os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600), 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        keychain = info['keychain']
        before = search_list()
        added = keychain not in before
        if added:
            command(['/usr/bin/security', 'list-keychains', '-d', 'user', '-s', *before, keychain])
        try:
            yield
        finally:
            current = search_list()
            if added and keychain in current:
                command(['/usr/bin/security', 'list-keychains', '-d', 'user', '-s',
                         *[item for item in current if item != keychain]])


def load(directory=DEFAULT_DIRECTORY):
    directory = Path(directory).absolute()
    if directory.is_symlink() or not directory.is_dir():
        raise SigningError('Development signing directory is missing or is a symlink')
    if directory.stat().st_mode & 0o077:
        raise SigningError('Development signing directory must be private (0700)')
    for name in FILES:
        file = directory / name
        if file.is_symlink() or not file.is_file():
            raise SigningError('Incomplete signing identity; restore its backup instead of creating a new identity')
        if file.stat().st_mode & 0o077:
            raise SigningError('Signing credentials must be private (0600): ' + name)
    info = json.loads((directory / 'identity.json').read_text())
    actual = certificate_fingerprint(directory / 'certificate.pem')
    if info.get('fingerprint') != actual or info.get('kind') != 'local-development-certificate':
        raise SigningError('Development signing certificate does not match its recorded identity')
    return {**info, 'directory': str(directory), 'keychain': str(directory / 'development.keychain-db')}


def prepare(directory=DEFAULT_DIRECTORY):
    directory = Path(directory).absolute()
    if directory.is_symlink():
        raise SigningError('Development signing directory cannot be a symlink')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if (directory / 'identity.json').exists():
        return load(directory)
    if any((directory / name).exists() for name in FILES):
        raise SigningError('Incomplete signing identity; restore its backup instead of rotating the key')
    directory.chmod(0o700)
    password = secrets.token_urlsafe(48)
    private_write(directory / 'password', password)
    keychain = directory / 'development.keychain-db'
    before = search_list()
    try:
        with tempfile.TemporaryDirectory(prefix='prepare-', dir=directory) as temporary:
            temporary = Path(temporary)
            config = temporary / 'certificate.cnf'
            config.write_text('[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n'
                              '[dn]\nCN=Console Canvas Local Development\nO=Console Canvas Local\n'
                              '[ext]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n'
                              'extendedKeyUsage=critical,codeSigning\nsubjectKeyIdentifier=hash\n')
            key = temporary / 'key.pem'
            command(['/usr/bin/openssl', 'req', '-new', '-x509', '-newkey', 'rsa:3072', '-nodes',
                     '-sha256', '-days', '3650', '-config', str(config), '-keyout', str(key),
                     '-out', str(directory / 'certificate.pem')])
            key.chmod(0o600)
            (directory / 'certificate.pem').chmod(0o600)
            command(['/usr/bin/openssl', 'pkcs12', '-export', '-inkey', str(key), '-in',
                     str(directory / 'certificate.pem'), '-name', 'Console Canvas Local Development',
                     '-out', str(directory / 'identity.p12'), '-passout', 'env:CONSOLE_CANVAS_SIGN_PASSWORD'],
                    secret=password, env={**os.environ, 'CONSOLE_CANVAS_SIGN_PASSWORD': password})
            (directory / 'identity.p12').chmod(0o600)
            command(['/usr/bin/security', 'create-keychain', '-p', password, str(keychain)], password)
            keychain.chmod(0o600)
            command(['/usr/bin/security', 'unlock-keychain', '-p', password, str(keychain)], password)
            command(['/usr/bin/security', 'import', str(directory / 'identity.p12'), '-x', '-k',
                     str(keychain), '-P', password, '-T', '/usr/bin/codesign'], password)
            # Only the new signing key in our private keychain is configured.
            # Never alter the login keychain, its items, or a system trust setting.
            command(['/usr/bin/security', 'set-key-partition-list', '-S', 'apple:', '-s', '-t',
                     'private', '-k', password, str(keychain)], password)
        info = {'kind': 'local-development-certificate',
                'fingerprint': certificate_fingerprint(directory / 'certificate.pem'),
                'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        private_write(directory / 'identity.json', json.dumps(info, indent=2) + '\n')
    finally:
        # Security.framework may add newly created keychains to the search list.
        # Remove only our addition and retain any unrelated concurrent changes.
        current = search_list()
        if str(keychain) not in before and str(keychain) in current:
            command(['/usr/bin/security', 'list-keychains', '-d', 'user', '-s',
                     *[item for item in current if item != str(keychain)]])
    return load(directory)


def sign(target, directory=DEFAULT_DIRECTORY, identifier=None, deep=True):
    info = load(directory)
    password = (Path(info['directory']) / 'password').read_text()
    with signing_keychain(info):
        command(['/usr/bin/security', 'unlock-keychain', '-p', password, info['keychain']], password)
        args = ['/usr/bin/codesign', '--force', '--keychain', info['keychain'], '--sign', info['fingerprint']]
        if deep:
            args.append('--deep')
        if identifier:
            args.extend(['--identifier', identifier])
        command([*args, str(target)], password)
        command(['/usr/bin/codesign', '--verify', '--strict', *(['--deep'] if deep else []), str(target)])
        out, err = command(['/usr/bin/codesign', '-d', '-r-', str(target)])
    match = re.search(r'designated => (.+)', out + err)
    requirement = match.group(1) if match else ''
    if 'cdhash' in requirement or info['fingerprint'].lower() not in requirement.lower():
        raise SigningError('Signed build does not have a stable certificate-bound requirement')
    # A stable DR is not a stable Keychain partition. macOS classifies a
    # self-signed identity by cdhash, even when the certificate is trusted.
    return {'kind': info['kind'], 'fingerprint': info['fingerprint'], 'requirement': requirement,
            'keychainUpdateReapproval': 'possible-self-signed-cdhash-partition'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('prepare', 'info', 'sign'))
    parser.add_argument('--directory', type=Path, default=DEFAULT_DIRECTORY)
    parser.add_argument('--app', type=Path)
    args = parser.parse_args()
    if args.action == 'sign' and not args.app:
        parser.error('sign requires --app')
    result = prepare(args.directory) if args.action == 'prepare' else load(args.directory) if args.action == 'info' else sign(args.app, args.directory)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except SigningError as error:
        raise SystemExit(str(error))
