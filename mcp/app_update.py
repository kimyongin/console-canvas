#!/usr/bin/env python3
"""Download verified public GitHub releases and replace only the app bundle."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import posixpath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import zipfile

REPO = 'kimyongin/console-canvas'
BUNDLE_ID = 'com.consolecanvas.desktop'
APP_NAME = 'Console Canvas.app'
RELEASES = 'https://api.github.com/repos/' + REPO + '/releases?per_page=30'


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def version(value):
    match = re.fullmatch(r'v?(\d+)\.(\d+)\.(\d+)', value)
    if not match:
        raise ValueError('버전 형식을 확인해 주세요.')
    return tuple(int(x) for x in match.groups())


def select_release(releases, current, arch):
    if arch not in ('arm64', 'x64'):
        raise ValueError('지원하지 않는 Mac 아키텍처입니다.')
    candidates = []
    for release in releases:
        if release.get('draft'):
            continue
        try:
            number = version(release.get('tag_name', ''))
        except ValueError:
            continue
        if number <= version(current) or (release.get('prerelease') and version(current)[0] >= 1):
            continue
        name = 'console-canvas-desktop-macos-' + arch + '.zip'
        asset = next((item for item in release.get('assets', []) if item.get('name') == name and item.get('state') == 'uploaded'), None)
        if not asset or not re.fullmatch(r'sha256:[0-9a-f]{64}', asset.get('digest') or ''):
            continue
        url = asset.get('browser_download_url', '')
        expected = 'https://github.com/' + REPO + '/releases/download/' + release['tag_name'] + '/' + name
        if url != expected or not isinstance(asset.get('size'), int) or not 0 < asset['size'] < 600_000_000:
            continue
        candidates.append({'version': '.'.join(map(str, number)), 'tag': release['tag_name'], 'url': url,
                           'size': asset['size'], 'sha256': asset['digest'][7:], 'prerelease': bool(release.get('prerelease'))})
    return max(candidates, key=lambda r: version(r['version'])) if candidates else None


def check(current, arch):
    request = urllib.request.Request(RELEASES, headers={'User-Agent': 'ConsoleCanvas/' + current, 'Accept': 'application/vnd.github+json'})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            raw = response.read(4_000_001)
        if len(raw) > 4_000_000:
            raise ValueError('릴리스 응답이 너무 큽니다.')
        selected = select_release(json.loads(raw), current, arch)
    except urllib.error.HTTPError as error:
        if error.code in (403, 429):
            raise ValueError('GitHub 요청 제한에 도달했습니다. 잠시 후 다시 확인해 주세요.') from error
        raise ValueError('GitHub 릴리스를 확인하지 못했습니다. 네트워크와 저장소 공개 상태를 확인해 주세요.') from error
    return {'current_version': current, 'available': selected is not None, 'release': selected}


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def validate_archive(archive):
    with zipfile.ZipFile(archive) as bundle:
        if len(bundle.infolist()) > 100000 or sum(i.file_size for i in bundle.infolist()) > 2_000_000_000:
            raise ValueError('업데이트 ZIP의 크기가 허용 범위를 넘습니다.')
        for item in bundle.infolist():
            path = PurePosixPath(item.filename)
            if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] not in (APP_NAME, '__MACOSX'):
                raise ValueError('업데이트 ZIP의 경로가 올바르지 않습니다.')
            if stat.S_ISLNK(item.external_attr >> 16):
                link = bundle.read(item).decode('utf-8')
                resolved = posixpath.normpath(posixpath.join(str(path.parent), link))
                if link.startswith('/') or not resolved.startswith(APP_NAME + '/'):
                    raise ValueError('업데이트 ZIP에 앱 밖을 가리키는 링크가 있습니다.')


def validate_app(app_path, expected_version=None, arch=None):
    info = plistlib.loads((app_path / 'Contents/Info.plist').read_bytes())
    if info.get('CFBundleIdentifier') != BUNDLE_ID:
        raise ValueError('Console Canvas 앱만 업데이트할 수 있습니다.')
    found = info.get('CFBundleShortVersionString', '')
    version(found)
    if expected_version and found != expected_version:
        raise ValueError('앱 버전이 GitHub 릴리스와 일치하지 않습니다.')
    package = json.loads((app_path / 'Contents/Resources/app/package.json').read_text())
    if package.get('version') != found:
        raise ValueError('앱 내부 버전 정보가 일치하지 않습니다.')
    subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app_path)], check=True, capture_output=True)
    if arch:
        architectures = subprocess.check_output(['/usr/bin/lipo', '-archs', str(app_path / 'Contents/MacOS/Electron')], text=True).split()
        if ('x86_64' if arch == 'x64' else arch) not in architectures:
            raise ValueError('이 Mac에서 실행할 수 없는 업데이트입니다.')
    return found


def prepare(current, arch, cache, target):
    target = target.expanduser().resolve()
    if target.name != APP_NAME or str(target).startswith('/Volumes/'):
        raise ValueError('DMG 안에서 실행 중입니다. 앱을 응용 프로그램 폴더로 옮긴 뒤 업데이트해 주세요.')
    if not os.access(target.parent, os.W_OK):
        raise ValueError('앱 폴더에 쓰기 권한이 없습니다. DMG로 업데이트하거나 사용자 응용 프로그램 폴더로 옮겨 주세요.')
    validate_app(target, current, arch)
    selected = check(current, arch)['release']
    if not selected:
        raise ValueError('현재 앱이 최신 버전입니다.')
    cache = cache.expanduser().resolve()
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    archive = cache / ('release-' + selected['version'] + '.zip')
    if not archive.is_file() or digest(archive) != selected['sha256']:
        partial = archive.with_suffix('.part')
        request = urllib.request.Request(selected['url'], headers={'User-Agent': 'ConsoleCanvas/' + current})
        total = 0
        try:
            with urllib.request.urlopen(request, timeout=90) as response, partial.open('wb') as output:
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    total += len(block)
                    if total > selected['size']:
                        raise ValueError('업데이트 다운로드 크기가 일치하지 않습니다.')
                    output.write(block)
                    emit({'type': 'progress', 'percent': int(total * 100 / selected['size']), 'message': '업데이트 다운로드 중'})
            if total != selected['size'] or digest(partial) != selected['sha256']:
                raise ValueError('업데이트 SHA-256 체크섬이 일치하지 않아 적용하지 않았습니다.')
            partial.replace(archive)
        finally:
            partial.unlink(missing_ok=True)
    emit({'type': 'progress', 'message': '다운로드 검증 완료 · 앱 준비 중', 'percent': 100})
    validate_archive(archive)
    stage = Path(tempfile.mkdtemp(prefix='stage-', dir=cache))
    subprocess.run(['/usr/bin/ditto', '-x', '-k', str(archive), str(stage)], check=True, capture_output=True)
    staged = stage / APP_NAME
    validate_app(staged, selected['version'], arch)
    # A same-directory replacement is quick and can roll back if renaming fails.
    pending = target.parent / ('.ConsoleCanvas-update-' + uuid.uuid4().hex + '.app')
    subprocess.run(['/usr/bin/ditto', str(staged), str(pending)], check=True, capture_output=True)
    validate_app(pending, selected['version'], arch)
    plan = {'target': str(target), 'pending': str(pending), 'version': selected['version'], 'current': current, 'arch': arch,
            'archive': str(archive), 'sha256': selected['sha256'], 'status': 'ready'}
    plan_path = cache / 'pending-update.json'
    plan_path.write_text(json.dumps(plan))
    os.chmod(plan_path, 0o600)
    shutil.rmtree(stage)
    return {'ready': True, 'version': selected['version'], 'plan': str(plan_path)}


def apply_plan(plan_path, parent_pid=0, relaunch=True):
    plan = json.loads(plan_path.read_text())
    target, pending = Path(plan['target']), Path(plan['pending'])
    if target.name != APP_NAME or pending.parent != target.parent or not pending.name.startswith('.ConsoleCanvas-update-'):
        raise ValueError('업데이트 적용 경로가 올바르지 않습니다.')
    if digest(Path(plan['archive'])) != plan['sha256']:
        raise ValueError('준비된 업데이트 파일이 변경되었습니다.')
    validate_app(target, plan['current'], plan['arch'])
    validate_app(pending, plan['version'], plan['arch'])
    if version(plan['version']) <= version(plan['current']):
        raise ValueError('이전 또는 같은 버전으로 자동 교체하지 않습니다.')
    deadline = time.monotonic() + 60
    while parent_pid:
        try:
            os.kill(parent_pid, 0)
        except ProcessLookupError:
            break
        if time.monotonic() > deadline:
            raise ValueError('앱이 종료되지 않아 업데이트를 적용하지 않았습니다.')
        time.sleep(.2)
    backup = target.parent / ('.ConsoleCanvas-previous-' + plan['current'] + '-' + uuid.uuid4().hex[:8] + '.app')
    target.rename(backup)
    try:
        pending.rename(target)
        validate_app(target, plan['version'], plan['arch'])
    except Exception:
        if target.exists():
            target.rename(pending)
        backup.rename(target)
        raise
    plan.update({'status': 'installed', 'backup': str(backup)})
    plan_path.write_text(json.dumps(plan))
    if relaunch:
        subprocess.run(['/usr/bin/open', str(target)], check=True)
    return {'installed': True, 'version': plan['version'], 'backup': str(backup)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    for action in ('check', 'prepare'):
        child = sub.add_parser(action)
        child.add_argument('--current', required=True)
        child.add_argument('--arch', required=True)
        if action == 'prepare':
            child.add_argument('--cache', required=True, type=Path)
            child.add_argument('--target', required=True, type=Path)
    child = sub.add_parser('apply')
    child.add_argument('--plan', required=True, type=Path)
    child.add_argument('--parent-pid', type=int, default=0)
    args = parser.parse_args()
    try:
        if args.action == 'check':
            result = check(args.current, args.arch)
        elif args.action == 'prepare':
            result = prepare(args.current, args.arch, args.cache, args.target)
        else:
            result = apply_plan(args.plan, args.parent_pid)
        emit({'type': 'result', **result})
    except Exception as error:
        emit({'type': 'error', 'message': str(error)})
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
