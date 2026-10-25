#!/usr/bin/env python3
"""Bundle browser modules and package a standalone demo, extension and agent skill."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ZIP_DATE = (2026, 10, 24, 0, 0, 0)


def write_archive(destination, entries):
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for name, raw in entries:
            entry = zipfile.ZipInfo('console-canvas/' + name, ZIP_DATE)
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            package.writestr(entry, raw, compresslevel=9)


def build_standalone(output):
    html = (ROOT / 'editor.html').read_text()
    css = (ROOT / 'dist/editor.bundle.css').read_text()
    html = re.sub(r'<link\b[^>]*href="editor-runtime.css"[^>]*>', lambda _: '<style>' + css + '</style>', html)
    html = re.sub(r'<script\b[^>]*src="(?:capture|editor-runtime).js"[^>]*>\s*</script>', '', html)
    html = html.replace('href="editor.html"', 'href="preview.html"')
    bundle = (ROOT / 'dist/editor.bundle.js').read_text()
    bundle = re.sub(r'</script', lambda _: '<\\/script', bundle, flags=re.I)
    sample = json.loads((ROOT / 'sample.uiclone.json').read_text())
    data = json.dumps(sample, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    bootstrap = (
        '<script type="application/json" id="embedded-sample">' + data + '</script>'
        '<script>window.CONSOLE_CANVAS_SAMPLE=JSON.parse('
        'document.getElementById("embedded-sample").textContent);</script>'
        '<script>' + bundle + '</script>'
    )
    html = html.replace('</body>', bootstrap + '</body>')
    (ROOT / 'preview.html').write_text(html)
    (output / 'Console Canvas.html').write_text(html)


def runtime_files():
    public = json.loads((ROOT / 'runtime-manifest.json').read_text())['public']
    files = set(public) | {
        'runtime-manifest.json', 'manifest.json', 'background.js',
        'README.md', 'agent-guide.md', 'package.json',
    }
    for directory, extensions in [('desktop', {'.cjs', '.html', '.css'}), ('mcp', {'.py'})]:
        files.update(path.relative_to(ROOT).as_posix() for path in (ROOT / directory).iterdir()
                     if path.is_file() and path.suffix in extensions)
    checksums = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                 for name in sorted(files) if name != 'runtime-manifest.json'}
    (ROOT / 'runtime-manifest.json').write_text(
        json.dumps({'public': public, 'files': checksums}, indent=2) + '\n')
    return sorted(files)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    output = parser.parse_args().output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    node = os.environ.get('NODE_BINARY') or shutil.which('node')
    if not node:
        raise SystemExit('Node.js is required to build. Run npm ci first.')
    subprocess.run([node, str(ROOT / 'scripts/bundle.mjs')], cwd=ROOT, check=True)

    version = json.loads((ROOT / 'package.json').read_text())['version']
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    manifest['version'] = version
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    skill = ROOT / 'skills/console-canvas'
    (ROOT / 'agent-guide.md').write_text((skill / 'SKILL.md').read_text())
    build_standalone(output)

    files = runtime_files()
    archive = output / 'console-canvas-extension.zip'
    write_archive(archive, ((name, (ROOT / name).read_bytes()) for name in files))
    (skill / 'assets').mkdir(parents=True, exist_ok=True)
    shutil.copyfile(archive, skill / 'assets/console-canvas-extension.zip')
    skill_archive = output / 'console-canvas-skill.zip'
    write_archive(skill_archive, ((path.relative_to(skill).as_posix(), path.read_bytes())
                                 for path in sorted(skill.rglob('*'))
                                 if path.is_file() and '__pycache__' not in path.parts))
    print(json.dumps({
        'standalone': str(output / 'Console Canvas.html'),
        'extension': str(archive), 'skill': str(skill_archive),
        'files': len(files), 'bytes': archive.stat().st_size,
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
