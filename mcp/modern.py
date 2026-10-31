"""2026-07-28 per-request stdio framing and scoped resource subscriptions.

No sampling/server-initiated requests. The loopback broker remains an internal
transport, not a public Streamable HTTP MCP endpoint.
"""
import json
import re
import threading

VERSION_KEY = 'io.modelcontextprotocol/protocolVersion'
CAPS_KEY = 'io.modelcontextprotocol/clientCapabilities'
INFO_KEY = 'io.modelcontextprotocol/clientInfo'
SERVER_KEY = 'io.modelcontextprotocol/serverInfo'
SUB_KEY = 'io.modelcontextprotocol/subscriptionId'
MODERN = '2026-07-28'


class ModernProtocol:
    def __init__(self, call, version, emit):
        self.call, self.version, self.emit = call, version, emit
        self.subscriptions = {}
        self.lock = threading.RLock()
        self.closed = threading.Event()
        self.thread = threading.Thread(target=self.watch, daemon=True)
        self.thread.start()

    def result(self, value):
        return {'ttlMs': 0, 'cacheScope': 'private', **value, 'resultType': 'complete', '_meta': {
            **value.get('_meta', {}), SERVER_KEY: {'name': 'console-canvas', 'version': self.version}}}

    def screens(self):
        return self.call('list_screens', {}).get('screens', [])

    @staticmethod
    def uri(editor):
        return 'console-canvas://editors/' + editor + '/tickets'

    def resources(self):
        return [{'uri': self.uri(s['editor_id']), 'name': s['title'] + ' · Work tickets',
                 'mimeType': 'application/json'} for s in self.screens()]

    def notify(self, method, request_id, values):
        self.emit({'jsonrpc': '2.0', 'method': method, 'params': {
            **values, '_meta': {SUB_KEY: request_id}}})

    def read(self, uri):
        match = re.fullmatch(r'console-canvas://editors/([\w-]{1,100})/tickets', uri or '')
        if not match or not any(s['editor_id'] == match[1] for s in self.screens()):
            raise ValueError('Resource is not connected')
        value = self.call('list_tickets', {'editor_id': match[1], 'project_id': next(s['project_id'] for s in self.screens() if s['editor_id'] == match[1])})
        if not value.get('ok'):
            raise ValueError('Resource read failed')
        return {'contents': [{'uri': uri, 'mimeType': 'application/json',
                              'text': json.dumps(value, ensure_ascii=False)}]}

    def listen(self, request_id, params):
        wanted = params.get('notifications')
        if not isinstance(wanted, dict) or len(wanted.get('resourceSubscriptions', [])) > 100:
            raise ValueError('Invalid notification filter')
        resources = {item['uri'] for item in self.resources()}
        honored = {}
        if wanted.get('resourcesListChanged') is True:
            honored['resourcesListChanged'] = True
        if isinstance(wanted.get('resourceSubscriptions'), list):
            honored['resourceSubscriptions'] = [uri for uri in wanted['resourceSubscriptions'] if uri in resources]
        with self.lock:
            if len(self.subscriptions) >= 100 or request_id in self.subscriptions:
                raise ValueError('Too many or duplicate subscriptions')
            # Ack is emitted under the lock before the watcher can emit an update.
            self.notify('notifications/subscriptions/acknowledged', request_id, {'notifications': honored})
            self.subscriptions[request_id] = {'filter': honored, 'stamps': None}

    def cancel(self, request_id):
        with self.lock:
            self.subscriptions.pop(request_id, None)

    def watch(self):
        while not self.closed.wait(.5):
            with self.lock:
                if not self.subscriptions:
                    continue
            try:
                stamps = {self.uri(s['editor_id']): (s['document_id'], s.get('ticket_revision', 0))
                          for s in self.screens()}
                with self.lock:
                    for request_id, subscription in list(self.subscriptions.items()):
                        previous = subscription['stamps']
                        subscription['stamps'] = stamps
                        if previous is None:
                            continue
                        rule = subscription['filter']
                        if rule.get('resourcesListChanged') and set(previous) != set(stamps):
                            self.notify('notifications/resources/list_changed', request_id, {})
                        for uri in rule.get('resourceSubscriptions', []):
                            if previous.get(uri) != stamps.get(uri):
                                self.notify('notifications/resources/updated', request_id, {'uri': uri})
            except (OSError, ValueError, KeyError):
                continue

    def close(self):
        self.closed.set()
        with self.lock:
            for request_id in self.subscriptions:
                self.emit({'jsonrpc': '2.0', 'id': request_id,
                           'result': self.result({'_meta': {SUB_KEY: request_id}})})
            self.subscriptions.clear()
