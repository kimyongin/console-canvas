#!/usr/bin/env python3
"""Prepare the bundled editor or summarize a Console Canvas review. Stdlib only."""
import argparse
import hashlib
from collections import Counter, deque
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import sys
import zipfile

SKILL_ROOT = Path(__file__).resolve().parents[1]
MAX_MEMBER = 128 * 1024 * 1024
MAX_TOTAL = 384 * 1024 * 1024
RUNTIME_FILES = {
    'manifest.json', 'background.js', 'capture.js', 'db.js', 'engine.js',
    'export.js', 'editor.js', 'editor.css', 'editor.html', 'README.md',
    'preview.html', 'sample.uiclone.json', 'fixtures/console.html',
    'fixtures/console.css', 'fixtures/console.js',
    'bridge-client.js', 'editor-controller.js', 'snapshot-history.js', 'agent-guide.md', 'mcp/server.py', 'mcp/bridge.py', 'mcp/skill_install.py',
    'package.json', 'desktop/main.cjs', 'desktop/preload.cjs', 'desktop/shell-preload.cjs',
    'desktop/shell.html', 'desktop/shell.css', 'desktop/shell.cjs',
}
REVIEW_FILES = {
    'review.json', 'changes.json', 'instructions.txt', 'before.png', 'after.png',
    'source-viewport.png', 'before.html', 'after.html', 'review.html', 'READ-ME.txt',
}


def fail(message):
    raise ValueError(message)


def read_json(raw):
    if len(raw) > MAX_MEMBER:
        fail('JSON exceeds the 128 MiB limit')
    def invalid_constant(value):
        fail('Non-finite JSON number: ' + value)
    value = json.loads(raw.decode('utf-8-sig'), parse_constant=invalid_constant)
    if not isinstance(value, dict):
        fail('Expected a JSON object')
    if value.get('version') != 1:
        fail('Unsupported Console Canvas version')
    return value


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
    bundle = SKILL_ROOT / 'assets' / 'console-canvas-extension.zip'
    with zipfile.ZipFile(bundle) as archive:
        members = archive_members(archive)
        expected = {'console-canvas/' + name for name in RUNTIME_FILES}
        if set(members) != expected:
            fail('Runtime bundle file list is invalid; rebuild the skill assets')
        # Validate everything before creating the destination or writing files.
        files = {name: archive.read(info) for name, info in members.items()}
    output = new_output(output)
    for name, raw in files.items():
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(raw)
    runtime = output / 'console-canvas'
    return {'extension_directory': str(runtime), 'preview': str(runtime / 'preview.html'),
            'readme': str(runtime / 'README.md'), 'files': len(files)}


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def rect(value):
    if not isinstance(value, dict) or not all(finite(value.get(k)) for k in ('x', 'y', 'width', 'height')):
        fail('Invalid node rectangle')
    return {k: value[k] for k in ('x', 'y', 'width', 'height')}


def calculate_changes(snapshot, raw_edits):
    if (not isinstance(snapshot, dict) or snapshot.get('format') != 'console-canvas-snapshot'
            or snapshot.get('version') != 1 or not isinstance(snapshot.get('html'), str)):
        fail('Invalid snapshot')
    raw_nodes = snapshot.get('nodes')
    if not isinstance(raw_nodes, list) or len(raw_nodes) > 40000:
        fail('Invalid snapshot node list')
    nodes = {}
    children = {}
    roots = []
    for node in raw_nodes:
        if not isinstance(node, dict) or not re.fullmatch(r'n\d+', str(node.get('id', ''))):
            fail('Invalid node identifier')
        node_id = node['id']
        if node_id in nodes:
            fail('Duplicate node identifier: ' + node_id)
        rect(node.get('rect'))
        nodes[node_id] = node
        children[node_id] = []
    for node_id, node in nodes.items():
        parent = node.get('parentId')
        if parent:
            if not isinstance(parent, str) or parent not in nodes:
                fail('Missing parent for ' + node_id)
            children[parent].append(node_id)
        else:
            roots.append(node_id)
    edits = {}
    if not isinstance(raw_edits, dict):
        fail('Expected an edits object')
    for node_id, edit in raw_edits.items():
        if node_id not in nodes or not isinstance(edit, dict):
            continue  # Match the editor's cleanEdits behavior.
        dx, dy = edit.get('dx'), edit.get('dy')
        edits[node_id] = {
            'dx': max(-60000, min(60000, dx)) if finite(dx) else 0,
            'dy': max(-200000, min(200000, dy)) if finite(dy) else 0,
            'deleted': edit.get('deleted') is True,
        }
    queue = deque(roots)
    order, offsets, hidden, ancestor_hidden = [], {}, {}, {}
    while queue:
        node_id = queue.popleft()
        order.append(node_id)
        parent = nodes[node_id].get('parentId')
        edit = edits.get(node_id, {})
        previous = offsets.get(parent, {'x': 0, 'y': 0})
        offsets[node_id] = {'x': previous['x'] + edit.get('dx', 0),
                            'y': previous['y'] + edit.get('dy', 0)}
        ancestor_hidden[node_id] = hidden.get(parent, False)
        hidden[node_id] = ancestor_hidden[node_id] or edit.get('deleted', False)
        queue.extend(children[node_id])
    if len(order) != len(nodes):
        fail('Snapshot parent tree contains a cycle')
    descendants = dict.fromkeys(nodes, 0)
    for node_id in reversed(order):
        parent = nodes[node_id].get('parentId')
        if parent:
            descendants[parent] += descendants[node_id] + 1
    changes = []
    for node_id, edit in edits.items():
        if ancestor_hidden[node_id] or not (edit['deleted'] or edit['dx'] or edit['dy']):
            continue
        node = nodes[node_id]
        before = rect(node['rect'])
        after = None if edit['deleted'] else {
            **before, 'x': before['x'] + offsets[node_id]['x'],
            'y': before['y'] + offsets[node_id]['y'],
        }
        changes.append({
            'id': node_id, 'name': node.get('name', ''), 'kind': node.get('kind'),
            'tag': node.get('tag'), 'parentId': node.get('parentId'),
            'locator': node.get('locator', {}),
            'action': 'delete' if edit['deleted'] else 'move',
            'delta': {'x': edit['dx'], 'y': edit['dy']},
            'effectiveDelta': offsets[node_id], 'before': before, 'after': after,
            'affectedDescendants': descendants[node_id],
        })
    return changes


def summarize(data):
    kind = data.get('format')
    snapshot = None
    if kind == 'console-canvas-review':
        snapshot = data.get('snapshot')
        changes = calculate_changes(snapshot, data.get('edits', {}))
        source = snapshot.get('source', {})
    elif kind == 'console-canvas-snapshot':
        snapshot = data
        changes = calculate_changes(snapshot, data.get('edits', {}))
        source = snapshot.get('source', {})
    elif kind == 'console-canvas-changes':
        changes = data.get('changes')
        if not isinstance(changes, list) or len(changes) > 40000:
            fail('Invalid changes list')
        for change in changes:
            if not isinstance(change, dict) or change.get('action') not in ('move', 'delete'):
                fail('Invalid change entry')
        source = data.get('source', {})
    else:
        fail('Not a Console Canvas snapshot, review or changes file')
    if not isinstance(source, dict):
        fail('Invalid source metadata')
    counts = Counter(change['action'] for change in changes)
    comments = []
    if snapshot:
        nodes = {node['id']: node for node in snapshot['nodes']}
        annotations = data.get('annotations', {})
        edits = data.get('edits', {})
        if isinstance(annotations, dict):
            for node_id, text in annotations.items():
                if node_id not in nodes or not isinstance(text, str) or not text.strip():
                    continue
                node = nodes[node_id]
                current, dx, dy, deleted = node_id, 0, 0, False
                while current:
                    edit = edits.get(current, {})
                    if isinstance(edit, dict):
                        x, y = edit.get('dx'), edit.get('dy')
                        dx += max(-60000, min(60000, x)) if finite(x) else 0
                        dy += max(-200000, min(200000, y)) if finite(y) else 0
                        deleted = deleted or edit.get('deleted') is True
                    current = nodes[current].get('parentId')
                before = rect(node['rect'])
                comments.append({'id': node_id, 'name': node.get('name', ''),
                                 'kind': node.get('kind'), 'tag': node.get('tag'),
                                 'parentId': node.get('parentId'), 'locator': node.get('locator', {}),
                                 'text': text.strip()[:4000], 'before': before,
                                 'after': None if deleted else {**before, 'x': before['x'] + dx, 'y': before['y'] + dy},
                                 'targetDeleted': deleted})
    else:
        comments = data.get('comments', [])
        if not isinstance(comments, list) or any(not isinstance(c, dict) or not isinstance(c.get('text'), str) for c in comments):
            fail('Invalid component comments')
    summary = {
        'format': kind, 'source': source, 'note': data.get('note', ''),
        'capturedAt': snapshot.get('capturedAt') if snapshot else None,
        'nodeCount': len(snapshot['nodes']) if snapshot else None,
        'changes': len(changes), 'moves': counts['move'], 'deletions': counts['delete'],
        'warnings': snapshot.get('warnings', []) if snapshot else [],
        'canReopen': snapshot is not None,
        'changeBasis': 'snapshot+edits' if snapshot else 'changes-only',
        'commentCount': len(comments), 'componentComments': comments,
    }
    return summary, changes


def review(input_path, output):
    input_path = Path(input_path).expanduser().resolve()
    images = {}
    if zipfile.is_zipfile(input_path):
        with zipfile.ZipFile(input_path) as archive:
            members = archive_members(archive)
            selected = next((name for name in ('review.json', 'changes.json') if name in members), None)
            if selected is None:
                fail('ZIP must contain review.json or changes.json at its root')
            data = read_json(archive.read(members[selected]))
            for name in ('before.png', 'after.png', 'source-viewport.png'):
                if name in members:
                    raw = archive.read(members[name])
                    if not raw.startswith(b'\x89PNG\r\n\x1a\n'):
                        fail('Invalid PNG: ' + name)
                    images[name] = raw
            unknown = sorted(set(members) - REVIEW_FILES)
    else:
        if input_path.stat().st_size > MAX_MEMBER:
            fail('JSON exceeds the 128 MiB limit')
        data = read_json(input_path.read_bytes())
        selected, unknown = input_path.name, []
    summary, changes = summarize(data)
    comments = summary.pop('componentComments')
    summary.update({'input': str(input_path), 'selectedEntry': selected,
                    'ignoredZipEntries': unknown, 'images': list(images)})
    output = new_output(output)
    (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / 'changes.compact.json').write_text(json.dumps(changes, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / 'comments.compact.json').write_text(json.dumps(comments, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for name, raw in images.items():
        (output / name).write_bytes(raw)
    reopen = input_path if summary['canReopen'] else None
    if selected == 'review.json' and zipfile.is_zipfile(input_path):
        reopen = output / 'review.json'
        reopen.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    return {'summary': str(output / 'summary.json'),
            'changes': str(output / 'changes.compact.json'),
            'moves': summary['moves'], 'deletions': summary['deletions'],
            'comment_count': summary['commentCount'], 'comments': str(output / 'comments.compact.json'),
            'images': [str(output / name) for name in images],
            'reopen_input': str(reopen) if reopen else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prepare_parser = commands.add_parser('prepare', help='Extract the bundled editor into a new directory')
    prepare_parser.add_argument('--output', required=True, type=Path)
    review_parser = commands.add_parser('review', help='Summarize a review ZIP or JSON without executing HTML')
    review_parser.add_argument('input', type=Path)
    review_parser.add_argument('--output', required=True, type=Path)
    mcp_parser = commands.add_parser('mcp', help='Start the installed MCP stdio server; runtime is bundled')
    mcp_parser.add_argument('--state-dir', type=Path, default=Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'console-canvas')
    mcp_parser.add_argument('--port', type=int, default=8849)
    mcp_parser.add_argument('--start', action='store_true', help='Start bridge and print connection file location')
    mcp_parser.add_argument('--stop', action='store_true', help='Stop local bridge')
    args = parser.parse_args()
    try:
        if args.command == 'mcp':
            asset = SKILL_ROOT / 'assets' / 'console-canvas-extension.zip'
            key = hashlib.sha256(asset.read_bytes()).hexdigest()[:16]
            runtime = args.state_dir.expanduser().resolve() / 'runtimes' / key
            if not runtime.exists():
                prepare(runtime)
            server = runtime / 'console-canvas' / 'mcp' / 'server.py'
            options = [sys.executable, str(server), '--state-dir', str(args.state_dir.expanduser().resolve()), '--port', str(args.port)]
            if args.start:options.append('--start')
            if args.stop:options.append('--stop')
            os.execv(sys.executable, options)
        result = prepare(args.output) if args.command == 'prepare' else review(args.input, args.output)
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
