#!/usr/bin/env python3
"""Install the self-contained Console Canvas skill into a Codex skills directory."""
import argparse
import os
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', type=Path, help='Full destination skill directory')
    args = parser.parse_args()
    source = ROOT / 'skills' / 'console-canvas'
    target = (args.target or Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'skills' / 'console-canvas').expanduser().resolve()
    if target.exists():
        parser.error('Destination already exists; review the existing skill before replacing it: ' + str(target))
    if not (source / 'assets' / 'console-canvas-extension.zip').is_file():
        parser.error('Runtime asset is missing; run python3 scripts/build.py first')
    if target == source or source in target.parents:
        parser.error('Destination cannot be inside the source skill')
    shutil.copytree(source, target, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.DS_Store'))
    print('Installed: ' + str(target))
    print('Invoke with $console-canvas in a chat where the skill is available.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
