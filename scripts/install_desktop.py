#!/usr/bin/env python3
"""Install the built macOS app without replacing an unrelated application."""
import argparse
from pathlib import Path
import plistlib
import shutil

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', type=Path, default=Path.home() / 'Applications' / 'Console Canvas.app')
    parser.add_argument('--update', action='store_true')
    args = parser.parse_args()
    source = ROOT / 'dist' / 'Console Canvas.app'
    target = args.target.expanduser().resolve()
    if not source.is_dir():
        parser.error('Build the app with python3 scripts/build_desktop.py first')
    if target.exists():
        plist = target / 'Contents' / 'Info.plist'
        if not args.update or not plist.is_file() or plistlib.loads(plist.read_bytes()).get('CFBundleIdentifier') != 'com.consolecanvas.desktop':
            parser.error('Existing application was not replaced; review it and use --update for Console Canvas only')
        shutil.rmtree(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target, symlinks=True)
    print(str(target))


if __name__ == '__main__':
    main()
