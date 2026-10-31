#!/usr/bin/env python3
"""Authenticated loopback broker between MCP clients and opted-in editor tabs."""
import argparse
from collections import OrderedDict, deque
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import secrets
import threading
import time
from urllib.parse import urlsplit, unquote
import uuid

from server import VERSION, TOOLS

MAX_BODY = 18 * 1024 * 1024


def validate(value, rule):
    if 'oneOf' in rule:
        count = 0
        for option in rule['oneOf']:
            try:
                validate(value, option)
                count += 1
            except ValueError:
                pass
        if count != 1:
            raise ValueError('Value does not match an operation schema')
        return
    if 'const' in rule and value != rule['const']:
        raise ValueError('Invalid operation type')
    if 'enum' in rule and value not in rule['enum']:
        raise ValueError('Value is not in the allowed enumeration')
    kind = rule.get('type')
    if kind == 'object':
        if not isinstance(value, dict):
            raise ValueError('Expected an object')
        if any(key not in value for key in rule.get('required', [])):
            raise ValueError('Missing required argument')
        if rule.get('additionalProperties') is False and set(value) - set(rule.get('properties', {})):
            raise ValueError('Unknown argument')
        for key, item in value.items():
            if key in rule.get('properties', {}):
                validate(item, rule['properties'][key])
    elif kind == 'string':
        if not isinstance(value, str) or not rule.get('minLength', 0) <= len(value) <= rule.get('maxLength', 10000):
            raise ValueError('Invalid string argument')
    elif kind in ('integer', 'number'):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError('Expected a finite number')
        if kind == 'integer' and int(value) != value:
            raise ValueError('Expected an integer')
        if not rule.get('minimum', -math.inf) <= value <= rule.get('maximum', math.inf):
            raise ValueError('Numeric argument is outside the supported range')
    elif kind == 'boolean':
        if type(value) is not bool:
            raise ValueError('Expected a boolean')
    elif kind == 'array':
        if not isinstance(value, list) or not rule.get('minItems', 0) <= len(value) <= rule.get('maxItems', 10000):
            raise ValueError('Invalid array length')
        for item in value:
            validate(item, rule.get('items', {}))


def error(code, message):
    return {'ok': False, 'error': {'code': code, 'message': message}}


class Broker:
    def __init__(self, app_dir=None):
        self.app_dir = Path(app_dir) if app_dir else Path(__file__).resolve().parents[1]
        self.condition = threading.Condition()
        self.sessions = {}
        self.commands = OrderedDict()
        self.operation_keys = {}

    def poll(self, body):
        meta = body.get('screen')
        if not isinstance(meta, dict) or not isinstance(meta.get('editor_id'), str) or not 1 <= len(meta['editor_id']) <= 100:
            raise ValueError('Missing editor identity')
        for key in ('document_id', 'title', 'url'):
            if not isinstance(meta.get(key), str) or len(meta[key]) > 4096:
                raise ValueError('Invalid screen metadata')
        for key in ('revision', 'element_count', 'comment_count'):
            if type(meta.get(key)) is not int or meta[key] < 0:
                raise ValueError('Invalid screen revision or counts')
        ticket_revision = meta.get('ticket_revision')
        if ticket_revision is not None and (type(ticket_revision) is not int or ticket_revision < 0):
            raise ValueError('Invalid ticket revision')
        meta = {k: meta[k] for k in ('editor_id', 'document_id', 'title', 'url', 'revision', 'element_count', 'comment_count')}
        if ticket_revision is not None:
            meta['ticket_revision'] = ticket_revision
        project_id = body.get('screen', {}).get('project_id')
        if isinstance(project_id, str) and 0 < len(project_id) <= 300:
            meta['project_id'] = project_id
        with self.condition:
            editor_id = meta['editor_id']
            session = self.sessions.setdefault(editor_id, {'queue': deque(), 'closed': False})
            session.update({'screen': meta, 'seen': time.monotonic(), 'closed': False})
            ack = body.get('ack')
            if isinstance(ack, dict):
                command = self.commands.get(ack.get('command_id'))
                if command and command['editor_id'] == editor_id and command['result'] is None and isinstance(ack.get('result'), dict):
                    command['result'] = ack['result']
                    self.condition.notify_all()
            deadline = time.monotonic() + 4
            while not session['closed']:
                while session['queue']:
                    command_id = session['queue'].popleft()
                    command = self.commands[command_id]
                    if time.time() > command['deadline']:
                        command['result'] = error('expired', 'Command expired before delivery; nothing was applied')
                        self.condition.notify_all()
                        continue
                    command['delivered'] = True
                    return {'ok': True, 'command': {k: command[k] for k in ('command_id', 'document_id', 'name', 'arguments', 'deadline')}}
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return {'ok': True, 'command': None}
                self.condition.wait(remaining)
            return error('disconnected', 'Editor connection was closed')

    def disconnect(self, editor_id):
        with self.condition:
            session = self.sessions.get(editor_id)
            if session:
                session['closed'] = True
            for command in self.commands.values():
                if command['editor_id'] == editor_id and command['result'] is None:
                    command['result'] = error('disconnected', 'Editor disconnected; query the screen before retrying')
            self.condition.notify_all()
        return {'ok': True}

    def call(self, name, arguments):
        rules = {item[0]: item[2] for item in TOOLS}
        if name not in rules:
            return error('unknown_tool', 'Unknown Console Canvas tool')
        try:
            validate(arguments, rules[name])
        except ValueError as exc:
            return error('invalid_arguments', str(exc))
        if name == 'get_agent_guide':
            try:
                return {'ok': True, 'name': 'console-canvas', 'version': VERSION,
                        'markdown': (self.app_dir / 'agent-guide.md').read_text(encoding='utf-8'),
                        'source': 'app_bundle', 'installation_required_for_mcp': False,
                        'helper_scripts': 'Install the skill from the desktop app for prepare/review CLI helpers.'}
            except OSError:
                return error('guide_unavailable', 'The app-bundled skill guide is missing. Rebuild or update Console Canvas.')
        with self.condition:
            def live(session):
                return not session.get('closed') and time.monotonic() - session['seen'] < 20
            if name == 'list_screens':
                return {'ok': True, 'screens': [s['screen'] for s in self.sessions.values() if live(s)]}
            editor_id = arguments['editor_id']
            session = self.sessions.get(editor_id)
            if not session or not live(session):
                return error('not_connected', 'Open the editor and connect its MCP button first')
            fingerprint = json.dumps({'name': name, 'arguments': arguments}, sort_keys=True, ensure_ascii=False)
            key = (editor_id, arguments.get('operation_id')) if 'operation_id' in arguments else None
            previous = self.operation_keys.get(key) if key else None
            if previous:
                command = self.commands[previous]
                if command['fingerprint'] != fingerprint:
                    return error('operation_id_reused', 'Operation ID was already used with different arguments')
            else:
                # Bounded replay cache. Never evict an in-flight command.
                while len(self.commands) >= 1000:
                    oldest, item = next(iter(self.commands.items()))
                    if item['result'] is None:
                        return error('busy', 'Too many in-flight commands')
                    self.commands.pop(oldest)
                    if item['key']:
                        self.operation_keys.pop(item['key'], None)
                command_id = str(uuid.uuid4())
                command = {'command_id': command_id, 'editor_id': editor_id, 'document_id': session['screen']['document_id'],
                           'name': name, 'arguments': arguments, 'fingerprint': fingerprint, 'key': key,
                           'deadline': time.time() + (60 if name in ('get_review_image', 'get_design_context', 'register_ticket', 'get_ticket', 'update_ticket') else 12), 'delivered': False, 'result': None}
                self.commands[command_id] = command
                if key:
                    self.operation_keys[key] = command_id
                session['queue'].append(command_id)
                self.condition.notify_all()
            remaining = command['deadline'] - time.time()
            while command['result'] is None and remaining > 0:
                self.condition.wait(remaining)
                remaining = command['deadline'] - time.time()
            if command['result'] is not None:
                return command['result']
            if not command['delivered']:
                command['result'] = error('expired', 'Editor did not receive the command; nothing was applied')
                return command['result']
            return error('outcome_unknown', 'Editor did not acknowledge in time. Read state or retry with the SAME operation_id and arguments; do not issue a new write ID.')


def allowed_origin(origin):
    if origin in (None, 'null'):
        return True
    parsed = urlsplit(origin)
    return ((parsed.scheme == 'http' and parsed.hostname == '127.0.0.1') or
            (parsed.scheme == 'chrome-extension' and len(parsed.netloc) == 32 and all('a' <= c <= 'p' for c in parsed.netloc))) and not parsed.path and not parsed.username


class Handler(BaseHTTPRequestHandler):
    server_version = 'ConsoleCanvas'

    def log_message(self, *args):
        pass  # Never log pairing codes, captured URLs, or comment text.

    def send_json(self, value, status=200):
        raw = json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        origin = self.headers.get('Origin')
        if origin and allowed_origin(origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
            self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
            self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def valid_origin_host(self):
        return self.headers.get('Host') == '127.0.0.1:' + str(self.server.server_port) and allowed_origin(self.headers.get('Origin'))

    def authenticated(self):
        return self.valid_origin_host() and hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + self.server.token)

    def do_OPTIONS(self):
        self.send_json({}, 200 if self.valid_origin_host() else 403)

    def do_GET(self):
        if not self.valid_origin_host():
            return self.send_json(error('forbidden', 'Invalid origin or Host'), 403)
        if self.path == '/health':
            if not self.authenticated():
                return self.send_json(error('unauthorized', 'Pairing code required'), 401)
            return self.send_json({'service': 'console-canvas', 'version': VERSION})
        # The local editor and fixtures are public static assets; no captured user data is served.
        path = unquote(urlsplit(self.path).path).lstrip('/') or 'editor.html'
        allowed = set(json.loads((self.server.app_dir / 'runtime-manifest.json').read_text())['public'])
        if path not in allowed:
            return self.send_json(error('not_found', 'Static asset not found'), 404)
        file = self.server.app_dir / path
        if not file.is_file():
            return self.send_json(error('not_found', 'Static asset not found'), 404)
        raw = file.read_bytes()
        mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json'}.get(file.suffix, 'application/octet-stream')
        self.send_response(200)
        self.send_header('Content-Type', mime + '; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Referrer-Policy', 'no-referrer')
        if path == 'editor.html':
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data: blob: http: https:; font-src data: http: https:; connect-src http://127.0.0.1:*; frame-src 'self' about: data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'")
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        if not self.authenticated():
            return self.send_json(error('unauthorized', 'Invalid pairing code, origin or Host'), 401)
        try:
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size <= (32 * 1024 * 1024 if self.path == '/bridge/poll' else MAX_BODY):
                raise ValueError('Invalid request size')
            body = json.loads(self.rfile.read(size), parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON')))
            if not isinstance(body, dict):
                raise ValueError('Expected JSON object')
            if self.path == '/bridge/poll':
                value = self.server.broker.poll(body)
            elif self.path == '/bridge/disconnect':
                value = self.server.broker.disconnect(body.get('editor_id'))
            elif self.path == '/agent/call':
                value = self.server.broker.call(body.get('name'), body.get('arguments', {}))
            elif self.path == '/admin/stop':
                self.send_json({'ok': True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            else:
                return self.send_json(error('not_found', 'Unknown endpoint'), 404)
            self.send_json(value)
        except (ValueError, TypeError, KeyError) as exc:
            self.send_json(error('invalid_request', str(exc)), 400)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', required=True, type=Path)
    parser.add_argument('--app-dir', required=True, type=Path)
    parser.add_argument('--port', type=int, default=8849)
    args = parser.parse_args()
    args.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.daemon_threads = True
    server.app_dir = args.app_dir.resolve()
    server.broker = Broker(server.app_dir)
    server.token = secrets.token_urlsafe(32)
    target = args.state_dir / 'connection.json'
    temporary = args.state_dir / ('connection-' + str(os.getpid()) + '.tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
        json.dump({'url': 'http://127.0.0.1:' + str(args.port), 'token': server.token, 'version': VERSION, 'pid': os.getpid()}, stream)
    os.replace(temporary, target)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
