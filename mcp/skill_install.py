#!/usr/bin/env python3
"""Install the app-bundled skill locally, keeping a backup of replaced files."""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

MANAGED = ('SKILL.md', 'agents/openai.yaml', 'scripts/console_canvas.py', 'assets/console-canvas-extension.zip')


def default_target():
    legacy = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'skills' / 'console-canvas'
    modern = Path.home() / '.agents' / 'skills' / 'console-canvas'
    if legacy.exists() or os.environ.get('CODEX_HOME'):
        return legacy
    if modern.exists():
        return modern
    return modern


def packaged_files(archive):
    with zipfile.ZipFile(archive) as bundle:
        expected = {'console-canvas/' + name for name in MANAGED}
        if len(bundle.namelist()) != len(expected) or set(bundle.namelist()) != expected:
            raise ValueError('앱에 포함된 스킬 ZIP의 파일 구성이 올바르지 않습니다.')
        if any(info.file_size > 8_000_000 or info.flag_bits & 1 for info in bundle.infolist()):
            raise ValueError('스킬 ZIP의 크기 또는 암호화 형식을 확인해 주세요.')
        values = {name: bundle.read('console-canvas/' + name) for name in MANAGED}
    if not re.search(r'^name: console-canvas\s*$', values['SKILL.md'].decode(), re.M):
        raise ValueError('Console Canvas 스킬이 아닙니다.')
    return values


def status(archive, target):
    values = packaged_files(archive)
    target = target.expanduser().resolve()
    installed = (target / 'SKILL.md').is_file()
    matches = installed and all((target / name).is_file() and (target / name).read_bytes() == raw for name, raw in values.items())
    return {'path': str(target), 'installed': installed, 'current': matches}


def install(archive, target):
    values = packaged_files(archive)
    target = target.expanduser().resolve()
    if target.exists():
        manifest = target / 'SKILL.md'
        if not manifest.is_file() or not re.search(r'^name: console-canvas\s*$', manifest.read_text(), re.M):
            raise ValueError('같은 위치의 다른 스킬을 덮어쓰지 않았습니다. ZIP으로 저장해 별도 설치해 주세요.')
    changed = []
    for name, raw in values.items():
        path = target / name
        if target not in path.resolve().parents or path.is_symlink() or (path.exists() and not path.is_file()):
            raise ValueError('설치 경로의 파일 또는 링크를 확인해 주세요: ' + name)
        if not path.is_file() or path.read_bytes() != raw:
            changed.append(name)
    backup = None
    old = [name for name in changed if (target / name).is_file()]
    if old:
        directory = target.parent.parent / 'console-canvas-skill-backups'
        directory.mkdir(parents=True, exist_ok=True)
        backup = Path(tempfile.mkdtemp(prefix=datetime.now().strftime('%Y%m%d-%H%M%S-'), dir=directory))
        for name in old:
            destination = backup / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target / name, destination)
    for name in changed:
        path = target / name
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix='.console-canvas-', dir=path.parent)
        try:
            with os.fdopen(descriptor, 'wb') as output:
                output.write(values[name])
            os.chmod(temporary, 0o644)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return {**status(archive, target), 'changed_files': changed, 'backup': str(backup) if backup else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--target', type=Path, default=default_target())
    parser.add_argument('--status', action='store_true')
    args = parser.parse_args()
    try:
        result = status(args.archive, args.target) if args.status else install(args.archive, args.target)
        print(json.dumps(result, ensure_ascii=False))
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
