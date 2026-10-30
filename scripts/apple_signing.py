#!/usr/bin/env python3
"""Pin an existing Apple Development identity without exporting its private key."""
import argparse
import json
from pathlib import Path
import re
import tempfile

try:
    from . import dev_signing
except ImportError:
    import dev_signing

SigningError = dev_signing.SigningError
command = dev_signing.command
DEFAULT_DIRECTORY = dev_signing.DEFAULT_DIRECTORY


def selection_path(directory=DEFAULT_DIRECTORY):
    return Path(directory) / 'apple-development.json'


def load(directory=DEFAULT_DIRECTORY):
    directory = Path(directory)
    file = selection_path(directory)
    if directory.is_symlink() or not directory.is_dir() or directory.stat().st_mode & 0o077:
        raise SigningError('Apple signing directory must be private (0700)')
    if file.is_symlink() or not file.is_file() or file.stat().st_mode & 0o077:
        raise SigningError('Apple identity selection must be private (0600)')
    info = json.loads(file.read_text())
    if (info.get('kind') != 'apple-development'
            or not re.fullmatch(r'[A-F0-9]{40}', info.get('fingerprint', ''))
            or not re.fullmatch(r'[A-Z0-9]{10}', info.get('teamId', ''))):
        raise SigningError('Invalid pinned Apple Development identity')
    return info


def available(fingerprint):
    out, _ = command(['/usr/bin/security', 'find-identity', '-v', '-p', 'codesigning'])
    for line in out.splitlines():
        match = re.search(r'\b([A-Fa-f0-9]{40})\s+"(Apple Development:[^"]+)"', line)
        if match and match.group(1).upper() == fingerprint:
            return True
    raise SigningError('Pinned Apple Development identity is unavailable; no fallback signing was performed')


def inspect(target, fingerprint=None, team_id=None):
    command(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(target)])
    out, err = command(['/usr/bin/codesign', '-d', '-vvv', '-r-', str(target)])
    details = out + err
    team = re.search(r'^TeamIdentifier=([A-Z0-9]{10})$', details, re.MULTILINE)
    requirement = re.search(r'^designated => (.+)$', details, re.MULTILINE)
    cdhash = re.search(r'^CDHash=([a-fA-F0-9]{40})$', details, re.MULTILINE)
    if not team or not requirement or not cdhash:
        raise SigningError('Signed app is missing its Apple team, designated requirement or code hash')
    if 'cdhash' in requirement.group(1).lower():
        raise SigningError('Apple app has a build-specific designated requirement')
    team = team.group(1)
    if team_id and team != team_id:
        raise SigningError('Apple signing team changed')
    # Verify Apple's chain; a locally trusted, self-signed certificate with a
    # forged name/OU must not pass as Apple Development.
    apple_requirement = 'anchor apple generic and certificate leaf[subject.OU] = "' + team + '"'
    command(['/usr/bin/codesign', '--verify', '--strict', '-R', '=' + apple_requirement, str(target)])
    with tempfile.TemporaryDirectory(prefix='console-canvas-public-certificate-') as temporary:
        prefix = str(Path(temporary) / 'certificate')
        command(['/usr/bin/codesign', '-d', '--extract-certificates=' + prefix, str(target)])
        out, _ = command(['/usr/bin/openssl', 'x509', '-inform', 'DER', '-in', prefix + '0',
                          '-noout', '-fingerprint', '-sha1'])
    actual = out.strip().split('=')[-1].replace(':', '').upper()
    if not re.fullmatch(r'[A-F0-9]{40}', actual) or (fingerprint and actual != fingerprint):
        raise SigningError('Apple certificate does not match the pinned fingerprint')
    available(actual)
    return {'kind': 'apple-development', 'fingerprint': actual, 'teamId': team,
            'requirement': requirement.group(1), 'cdhash': cdhash.group(1),
            'keychainUpdateReapproval': 'requires-actual-update-test'}


def select(target, directory=DEFAULT_DIRECTORY):
    info = inspect(target)
    directory = Path(directory)
    if directory.is_symlink():
        raise SigningError('Apple signing directory cannot be a symlink')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.stat().st_mode & 0o077:
        raise SigningError('Apple signing directory must be private (0700)')
    file = selection_path(directory)
    selected = {key: info[key] for key in ('kind', 'fingerprint', 'teamId')}
    if file.exists() or file.is_symlink():
        if load(directory) != selected:
            raise SigningError('A different Apple identity is already pinned; do not rotate it silently')
    else:
        dev_signing.private_write(file, json.dumps(selected, indent=2) + '\n')
    return info


def sign(target, directory=DEFAULT_DIRECTORY):
    info = load(directory)
    available(info['fingerprint'])
    command(['/usr/bin/codesign', '--force', '--deep', '--sign', info['fingerprint'], str(target)])
    return inspect(target, info['fingerprint'], info['teamId'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('inspect', 'select', 'info'))
    parser.add_argument('--app', type=Path)
    parser.add_argument('--directory', type=Path, default=DEFAULT_DIRECTORY)
    args = parser.parse_args()
    if args.action != 'info' and not args.app:
        parser.error('inspect/select requires --app')
    result = load(args.directory) if args.action == 'info' else select(args.app, args.directory) if args.action == 'select' else inspect(args.app)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except SigningError as error:
        raise SystemExit(str(error))
