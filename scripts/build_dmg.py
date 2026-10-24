#!/usr/bin/env python3
"""Create a drag-to-Applications disk image from the packaged macOS app."""
from pathlib import Path
import argparse
import json
import platform
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def build(app, output):
    with tempfile.TemporaryDirectory(prefix='console-canvas-dmg-') as directory:
        stage = Path(directory) / 'Console Canvas'
        stage.mkdir()
        shutil.copytree(app, stage / 'Console Canvas.app', symlinks=True)
        (stage / 'Applications').symlink_to('/Applications')
        (stage / '설치 안내.txt').write_text('Console Canvas.app을 Applications로 드래그한 뒤 DMG를 꺼내세요.\n앱 메뉴의 업데이트 확인으로 이후 버전을 설치할 수 있습니다.\n편집 화면과 스냅샷은 사용자 데이터 폴더에 보관됩니다.\n')
        subprocess.run(['/usr/bin/hdiutil', 'create', '-volname', 'Console Canvas', '-srcfolder', str(stage),
                        '-fs', 'HFS+', '-format', 'UDZO', '-ov', str(output)], check=True)
    subprocess.run(['/usr/bin/hdiutil', 'verify', str(output)], check=True)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, default=ROOT / 'dist/Console Canvas.app')
    arch = 'arm64' if platform.machine() == 'arm64' else 'x64'
    parser.add_argument('--output', type=Path, default=ROOT / ('dist/console-canvas-desktop-macos-' + arch + '.dmg'))
    args = parser.parse_args()
    print(json.dumps({'dmg': str(build(args.app, args.output))}))
