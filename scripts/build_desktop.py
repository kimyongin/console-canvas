#!/usr/bin/env python3
"""Build a macOS app from the official, checksum-verified Electron distribution."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download-only', action='store_true')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('This packaging script targets macOS. Use npm install and npm start for development on other systems.')
    version = json.loads((ROOT / 'package.json').read_text())['devDependencies']['electron']
    arch = 'arm64' if platform.machine() == 'arm64' else 'x64'
    name = f'electron-v{version}-darwin-{arch}.zip'
    cache = ROOT / 'local' / 'electron'
    cache.mkdir(parents=True, exist_ok=True)
    base = f'https://github.com/electron/electron/releases/download/v{version}/'
    with urllib.request.urlopen(base + 'SHASUMS256.txt', timeout=60) as response:
        sums = response.read().decode()
    digest = next(line.split()[0] for line in sums.splitlines() if line.split()[-1].lstrip('*') == name)
    archive = cache / name
    def valid():
        return archive.is_file() and hashlib.sha256(archive.read_bytes()).hexdigest() == digest
    if not valid():
        temporary = archive.with_suffix('.download')
        print('Downloading official Electron ' + version + ' (' + arch + ')', flush=True)
        with urllib.request.urlopen(base + name, timeout=120) as response, temporary.open('wb') as output:
            total = int(response.headers.get('Content-Length', 0));received = 0;reported = -1
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                output.write(block);received += len(block)
                progress = received * 10 // total if total else received // (20 * 1024 * 1024)
                if progress > reported:
                    print(f'Downloaded {received // (1024*1024)} MiB', flush=True);reported = progress
        temporary.replace(archive)
    if not valid():
        raise ValueError('Electron checksum verification failed')
    print('Official SHA-256 verified: ' + name, flush=True)
    if args.download_only:
        return
    subprocess.run([sys.executable, str(ROOT / 'scripts' / 'build.py')], check=True)
    extracted = cache / ('v' + version + '-' + arch)
    if not (extracted / 'Electron.app').exists():
        extracted.mkdir(exist_ok=True)
        subprocess.run(['/usr/bin/ditto', '-x', '-k', str(archive), str(extracted)], check=True)
    app = ROOT / 'dist' / 'Console Canvas.app'
    if app.exists():
        shutil.rmtree(app)
    shutil.copytree(extracted / 'Electron.app', app, symlinks=True)
    resources = app / 'Contents' / 'Resources'
    # Keep the installable skill outside app/ to avoid recursive runtime archives.
    shutil.copyfile(ROOT / 'dist' / 'console-canvas-skill.zip', resources / 'console-canvas-skill.zip')
    runtime = resources / 'app'
    # Reuse the exact runtime already verified and packaged by build.py.
    import zipfile
    with zipfile.ZipFile(ROOT / 'dist' / 'console-canvas-extension.zip') as package:
        for name in package.namelist():
            relative = name.removeprefix('console-canvas/')
            target = runtime / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(package.read(name))
    for name in ('LICENSE', 'LICENSES.chromium.html'):
        if (extracted / name).exists():
            (resources / 'licenses').mkdir(exist_ok=True)
            shutil.copyfile(extracted / name, resources / 'licenses' / name)
    plist = app / 'Contents' / 'Info.plist'
    value = plistlib.loads(plist.read_bytes())
    value.update({'CFBundleName': 'Console Canvas', 'CFBundleDisplayName': 'Console Canvas',
                  'CFBundleIdentifier': 'com.consolecanvas.desktop',
                  'CFBundleShortVersionString': json.loads((ROOT / 'package.json').read_text())['version'],
                  'CFBundleVersion': json.loads((ROOT / 'package.json').read_text())['version']})
    plist.write_bytes(plistlib.dumps(value))
    subprocess.run(['/usr/bin/codesign', '--force', '--deep', '--sign', '-', str(app)], check=True)
    output = ROOT / 'dist' / ('console-canvas-desktop-macos-' + arch + '.zip')
    subprocess.run(['/usr/bin/ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(app), str(output)], check=True)
    print(json.dumps({'app': str(app), 'archive': str(output), 'electron': version, 'arch': arch}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
