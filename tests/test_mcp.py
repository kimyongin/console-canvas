"""Protocol schemas, scoped delivery, replay protection and loopback HTTP boundary."""
import importlib.util
import http.client
import json
from pathlib import Path
import sys
import threading
import tempfile
import time
import unittest
from unittest.mock import patch, Mock
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'mcp'))
from bridge import Broker, Handler, ThreadingHTTPServer, allowed_origin, validate
from server import TOOLS, VERSION, ensure_bridge, BridgeClient


class UpgradeTests(unittest.TestCase):
    def test_rotated_credential_recovers_same_origin_once(self):
        with tempfile.TemporaryDirectory() as directory:
            connection_file = Path(directory) / 'connection.json'
            old = {'url': 'http://127.0.0.1:8849', 'token': 'old'}
            new = {**old, 'token': 'new'}
            connection_file.write_text(json.dumps(new))
            rejected = urllib.error.HTTPError(old['url'], 401, 'Unauthorized', {}, None)
            client = BridgeClient(old, connection_file)
            with patch('server.request', side_effect=[rejected, {'service': 'console-canvas'}, {'ok': True}, {'ok': True}]) as call:
                self.assertEqual(client.request('/agent/call', {'operation_id': 'same'}), {'ok': True})
                self.assertEqual(client.request('/agent/call'), {'ok': True})
            self.assertEqual(call.call_count, 4)
            self.assertEqual(call.call_args_list[2].args[2], {'operation_id': 'same'})
            self.assertEqual(call.call_args_list[3].args[0], new)

    def test_refresh_never_follows_changed_origin_or_retries_other_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            connection_file = Path(directory) / 'connection.json'
            old = {'url': 'http://127.0.0.1:8849', 'token': 'old'}
            for candidate in ({**old, 'url': 'http://127.0.0.1:9000', 'token': 'new'}, old, {**old, 'token': ''}, [], None):
                connection_file.write_text(json.dumps(candidate))
                with patch('server.request', side_effect=urllib.error.HTTPError(old['url'], 401, 'Unauthorized', {}, None)) as call:
                    with self.assertRaises(urllib.error.HTTPError):
                        BridgeClient(old, connection_file).request('/agent/call')
                    self.assertEqual(call.call_count, 1)
            for error in (OSError('lost acknowledgement'), urllib.error.HTTPError(old['url'], 403, 'Forbidden', {}, None)):
                with patch('server.request', side_effect=error) as call:
                    with self.assertRaises(type(error)):
                        BridgeClient(old, connection_file).request('/agent/call')
                    self.assertEqual(call.call_count, 1)

    def test_upgrade_tolerates_an_old_bridge_closing_before_acknowledgement(self):
        with tempfile.TemporaryDirectory() as directory:
            state_dir = Path(directory)
            (state_dir / 'connection.json').write_text(json.dumps({'url': 'http://127.0.0.1:8849', 'token': 'test-token'}))
            old = {'service': 'console-canvas', 'version': '0.3.0'}
            new = {'service': 'console-canvas', 'version': VERSION}
            with patch('server.request', side_effect=[old, old, http.client.IncompleteRead(b'', 12), new]) as request, patch('server.subprocess.Popen', return_value=Mock()) as process:
                connection = ensure_bridge(state_dir, ROOT, 8849)
            self.assertEqual(connection['url'], 'http://127.0.0.1:8849')
            self.assertEqual(request.call_args_list[2].args[1], '/admin/stop')
            process.assert_called_once()


class BrokerTests(unittest.TestCase):
    def setUp(self):
        self.broker = Broker()
        self.screen = {'editor_id': 'test-editor', 'document_id': 'test-document', 'title': 'Fake console',
                       'url': 'https://example.com/console', 'revision': 1, 'element_count': 3, 'comment_count': 0}
        with self.broker.condition:
            self.broker.sessions['test-editor'] = {'screen': self.screen, 'seen': time.monotonic(), 'closed': False, 'queue': __import__('collections').deque()}

    def test_unconnected_screens_are_not_visible(self):
        self.assertEqual(len(self.broker.call('list_screens', {})['screens']), 1)
        self.broker.disconnect('test-editor')
        self.assertEqual(self.broker.call('list_screens', {})['screens'], [])
        self.assertEqual(self.broker.call('get_screen', {'editor_id': 'missing','ticket_ref':'CC-1'})['error']['code'], 'not_connected')

    def test_strict_schemas_reject_extra_or_malformed_operations(self):
        self.assertEqual(self.broker.call('list_screens', {'unexpected': True})['error']['code'], 'invalid_arguments')
        rule = next(t[2] for t in TOOLS if t[0] == 'apply_edits')
        for operation in ({'type': 'eval', 'element_id': 'n1'}, {'type': 'move', 'element_id': 'n1', 'dx': float('inf'), 'dy': 0, 'mode': 'relative'}):
            with self.assertRaises(ValueError):
                validate({'editor_id': 'test-editor', 'expected_edit_revision': 1,'ticket_ref':'CC-1', 'operation_id': 'unique', 'operations': [operation]}, rule)

    def test_delivery_is_scoped_and_writes_are_idempotent(self):
        arguments = {'editor_id': 'test-editor', 'expected_edit_revision': 1,'ticket_ref':'CC-1', 'operation_id': 'once',
                     'operations': [{'type': 'comment', 'element_id': 'n1', 'text': 'move me'}]}
        results = []
        thread = threading.Thread(target=lambda: results.append(self.broker.call('apply_edits', arguments)))
        thread.start()
        delivery = self.broker.poll({'screen': self.screen})['command']
        self.assertEqual(delivery['document_id'], 'test-document')
        # Acknowledgement from a different editor cannot complete the operation.
        wrong = {**self.screen, 'editor_id': 'different'}
        wrong_poll = threading.Thread(target=lambda: self.broker.poll({'screen': wrong, 'ack': {'command_id': delivery['command_id'], 'result': {'ok': True, 'wrong': True}}}))
        wrong_poll.start()
        time.sleep(.01)
        self.assertIsNone(self.broker.commands[delivery['command_id']]['result'])
        with self.broker.condition:
            self.broker.commands[delivery['command_id']]['result'] = {'ok': True, 'revision': 2}
            self.broker.condition.notify_all()
        thread.join(1)
        self.assertEqual(results, [{'ok': True, 'revision': 2}])
        self.assertEqual(self.broker.call('apply_edits', arguments), results[0])
        changed = {**arguments, 'expected_edit_revision': 2}
        self.assertEqual(self.broker.call('apply_edits', changed)['error']['code'], 'operation_id_reused')
        self.broker.disconnect('different');wrong_poll.join(1)

    def test_connected_workspace_routes_unknown_project_filter_without_access_grant(self):
        self.screen.update(workspace=True, project_ids=[], project_id='current-project')
        self.assertEqual(self.broker.call('list_screens', {})['screens'][0], self.screen)
        result = []
        thread = threading.Thread(target=lambda: result.append(self.broker.call('list_tickets', {'project_id':'new-project'})))
        thread.start()
        delivery = self.broker.poll({'screen':self.screen})['command']
        self.assertEqual(delivery['arguments']['project_id'], 'new-project')
        with self.broker.condition:
            self.broker.commands[delivery['command_id']]['result'] = {'ok':True,'tickets':[],'total':0}
            self.broker.condition.notify_all()
        thread.join(1)
        self.assertEqual(result, [{'ok':True,'tickets':[],'total':0}])
        self.broker.disconnect('test-editor')
        self.assertEqual(self.broker.call('list_tickets', {})['error']['code'], 'not_connected')

    def test_project_filter_never_merges_or_implicitly_selects_another_workspace(self):
        self.screen.update(workspace=True, project_ids=['first-project'])
        with self.broker.condition:
            self.broker.sessions['second'] = {'screen':{**self.screen,'editor_id':'second','project_ids':['second-project']},
                'seen':time.monotonic(),'closed':False,'queue':__import__('collections').deque()}
        self.assertEqual(self.broker.call('list_tickets', {'project_id':'first-project'})['error']['code'], 'ambiguous_workspace')

    def test_origin_allow_list(self):
        for origin in ('http://127.0.0.1:8849', 'chrome-extension://' + 'a' * 32, 'null', None):
            self.assertTrue(allowed_origin(origin))
        for origin in ('https://evil.example', 'http://127.0.0.1.evil.example:8849', 'http://user@127.0.0.1:8849', 'chrome-extension://invalid'):
            self.assertFalse(allowed_origin(origin))

    def test_ticket_tools_require_project_revision_and_identity(self):
        definitions_by_name = {t[0]: {'inputSchema': t[2]} for t in TOOLS}
        self.assertNotIn('list_snapshots', definitions_by_name)
        for name in ('confirm_ticket_goal', 'update_ticket'):
            with self.assertRaises(ValueError):
                validate({'editor_id': 'test-editor'}, definitions_by_name[name]['inputSchema'])
        validate({'ticket_ref':'CC-1','expected_ticket_revision':0,'expected_edit_revision':0,'operation_id':'once','request':'responsive goal','selection_confirmed':True},definitions_by_name['confirm_ticket_goal']['inputSchema'])



class HttpBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.server.token = 'test-only-pairing-token'
        self.server.app_dir = ROOT
        self.server.broker = Broker()
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join()

    def request(self, path, token=True, origin=None, host=None):
        headers = {}
        if token:headers['Authorization'] = 'Bearer ' + self.server.token
        if origin:headers['Origin'] = origin
        if host:headers['Host'] = host
        return urllib.request.urlopen(urllib.request.Request(self.url + path, headers=headers))

    def test_health_requires_pairing_and_valid_host_origin(self):
        self.assertEqual(json.load(self.request('/health'))['service'], 'console-canvas')
        for kwargs in ({'token': False}, {'origin': 'https://evil.example'}, {'host': 'evil.example'}):
            with self.subTest(kwargs=kwargs), self.assertRaises(urllib.error.HTTPError):
                self.request('/health', **kwargs)

    def test_only_public_app_assets_are_served(self):
        with self.request('/editor.html', token=False) as response:
            self.assertIn("script-src 'self'", response.headers['Content-Security-Policy'])
        for path in ('/../mcp/server.py', '/connection.json', '/README.md', '/%2e%2e/config.toml'):
            with self.subTest(path=path), self.assertRaises(urllib.error.HTTPError):
                self.request(path)

    def test_stop_returns_a_complete_response_before_shutdown(self):
        request = urllib.request.Request(self.url + '/admin/stop', data=b'{}', headers={'Authorization': 'Bearer ' + self.server.token, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(request) as response:
            self.assertEqual(json.load(response), {'ok': True})


if __name__ == '__main__':
    unittest.main()
