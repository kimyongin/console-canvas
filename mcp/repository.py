"""Identify a local Git repository without following remotes or trusting a display label."""
import hashlib
import os
from pathlib import Path
import subprocess


def repository_identity(value):
    if not isinstance(value, str) or not value or len(value) > 4096:
        raise ValueError('Provide the current local Git repository path')
    path = Path(value).expanduser().resolve(strict=True)
    def git(*args):
        return subprocess.check_output(['git', '-C', str(path), 'rev-parse', *args],
                                       timeout=5, stderr=subprocess.DEVNULL, env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}).decode().strip()
    try:
        root = Path(git('--show-toplevel')).resolve(strict=True)
        common = Path(git('--path-format=absolute', '--git-common-dir')).resolve(strict=True)
    except (subprocess.SubprocessError, OSError) as exc:
        raise ValueError('The path must be a local Git working tree') from exc
    return {'identity': hashlib.sha256(str(common).encode()).hexdigest(),
            'root': str(root), 'common_dir': str(common)}
