"""Modern per-request envelopes and legacy compatibility are separate paths."""
import io
import json
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'mcp'))
from server import stdio
from modern import MODERN, VERSION_KEY, CAPS_KEY, ModernProtocol


def invoke(messages):
    output = io.StringIO()
    with patch('sys.stdin', io.StringIO('\n'.join(json.dumps(m) for m in messages))), patch('sys.stdout', output):
        stdio({'url': 'http://127.0.0.1:1', 'token': 'fake-test-only'})
    return [json.loads(line) for line in output.getvalue().splitlines()]


def rpc(ident, method, params=None):
    return {'jsonrpc': '2.0', 'id': ident, 'method': method, 'params': params or {}}


class ModernTests(unittest.TestCase):
    def test_no_initialize_and_no_implicit_metadata_inheritance(self):
        meta = {'_meta': {VERSION_KEY: MODERN, CAPS_KEY: {}}}
        results = invoke([rpc(1, 'server/discover', meta), rpc(2, 'tools/list', meta), rpc(3, 'tools/list')])
        self.assertIn(MODERN, results[0]['result']['supportedVersions'])
        self.assertEqual(results[1]['result']['resultType'], 'complete')
        self.assertEqual(results[1]['result']['ttlMs'], 0)
        self.assertEqual(results[1]['result']['cacheScope'], 'private')
        self.assertEqual(len(results[1]['result']['tools']), 16)
        self.assertEqual(results[2]['error']['code'], -32602)

    def test_invalid_versions_and_missing_capabilities_fail_before_tools(self):
        results = invoke([rpc(1, 'tools/list', {'_meta': {VERSION_KEY: '1900-01-01', CAPS_KEY: {}}}),
                          rpc(2, 'tools/list', {'_meta': {VERSION_KEY: MODERN}})])
        self.assertEqual(results[0]['error']['code'], -32022)
        self.assertIn(MODERN, results[0]['error']['data']['supported'])
        self.assertEqual(results[1]['error']['code'], -32602)

    def test_empty_connected_workspace_has_readable_resource_without_shared_projects(self):
        connected = True
        def call(name, args):
            if name == 'list_screens':
                return {'ok':True,'screens':[{'editor_id':'empty-workspace','title':'Empty','workspace':True,'project_ids':[]}] if connected else []}
            return {'ok':True,'tickets':[],'total':0}
        protocol = ModernProtocol(call, 'test', lambda value:None)
        try:
            uri = protocol.resources()[0]['uri']
            self.assertEqual(json.loads(protocol.read(uri)['contents'][0]['text'])['tickets'], [])
            connected = False
            self.assertEqual(protocol.resources(), [])
            with self.assertRaises(ValueError):
                protocol.read(uri)
        finally:
            protocol.close()

    def test_legacy_handshake_retains_legacy_wire_results(self):
        results = invoke([rpc(1, 'initialize', {'protocolVersion': '2025-11-25'}), rpc(2, 'tools/list')])
        self.assertEqual(results[0]['result']['protocolVersion'], '2025-11-25')
        self.assertNotIn('resultType', results[1]['result'])
        self.assertEqual(len(results[1]['result']['tools']), 16)


if __name__ == '__main__':
    unittest.main()
