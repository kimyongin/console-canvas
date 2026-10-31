#!/usr/bin/env python3
"""Prepare the bundled editor or start its local MCP server. Stdlib only."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
import zipfile

SKILL_ROOT = Path(__file__).resolve().parents[1]
MAX_MEMBER = 128 * 1024 * 1024
MAX_TOTAL = 384 * 1024 * 1024
def fail(message):
    raise ValueError(message)


def archive_members(archive):
    members = {}
    total = 0
    for info in archive.infolist():
        path = PurePosixPath(info.filename)
        if (path.is_absolute() or '..' in path.parts or '\\' in info.filename
                or info.filename in members):
            fail('Unsafe or duplicate ZIP member: ' + info.filename)
        if (info.external_attr >> 16) & 0o170000 == 0o120000:
            fail('ZIP symlinks are not supported')
        total += info.file_size
        if info.file_size > MAX_MEMBER or total > MAX_TOTAL:
            fail('ZIP exceeds the review size limits')
        if info.flag_bits & 1:
            fail('Encrypted ZIP files are not supported')
        members[info.filename] = info
    return members


def new_output(path):
    path = Path(path).expanduser().resolve()
    path.mkdir(parents=True, exist_ok=False)
    return path


def prepare(output):
    bundle = SKILL_ROOT / 'assets' / 'console-canvas-runtime.zip'
    with zipfile.ZipFile(bundle) as archive:
        members = archive_members(archive)
        manifest_name = 'console-canvas/runtime-manifest.json'
        if manifest_name not in members:
            fail('Runtime manifest is missing; rebuild the skill assets')
        manifest = json.loads(archive.read(members[manifest_name]))
        expected = {'console-canvas/' + name for name in manifest['files']} | {manifest_name}
        if set(members) != expected or not set(manifest['public']).issubset(manifest['files']):
            fail('Runtime bundle file list is invalid; rebuild the skill assets')
        for name, digest in manifest['files'].items():
            if hashlib.sha256(archive.read(members['console-canvas/' + name])).hexdigest() != digest:
                fail('Runtime checksum mismatch: ' + name)
        # Validate everything before creating the destination or writing files.
        files = {name: archive.read(info) for name, info in members.items()}
    output = new_output(output)
    for name, raw in files.items():
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(raw)
    runtime = output / 'console-canvas'
    return {'runtime_directory': str(runtime), 'preview': str(runtime / 'preview.html'),
            'readme': str(runtime / 'README.md'), 'files': len(files)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prepare_parser = commands.add_parser('prepare', help='Extract the bundled editor into a new directory')
    prepare_parser.add_argument('--output', required=True, type=Path)
    mcp_parser = commands.add_parser('mcp', help='Start the installed MCP stdio server; runtime is bundled')
    mcp_parser.add_argument('--state-dir', type=Path, default=Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'console-canvas')
    mcp_parser.add_argument('--port', type=int, default=8849)
    mcp_parser.add_argument('--start', action='store_true', help='Start bridge and print connection file location')
    mcp_parser.add_argument('--stop', action='store_true', help='Stop local bridge')
    args = parser.parse_args()
    try:
        if args.command == 'mcp':
            asset = SKILL_ROOT / 'assets' / 'console-canvas-runtime.zip'
            key = hashlib.sha256(asset.read_bytes()).hexdigest()[:16]
            runtime = args.state_dir.expanduser().resolve() / 'runtimes' / key
            if not runtime.exists():
                prepare(runtime)
            server = runtime / 'console-canvas' / 'mcp' / 'server.py'
            options = [sys.executable, str(server), '--state-dir', str(args.state_dir.expanduser().resolve()), '--port', str(args.port)]
            if args.start:options.append('--start')
            if args.stop:options.append('--stop')
            os.execv(sys.executable, options)
        result = prepare(args.output)
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
