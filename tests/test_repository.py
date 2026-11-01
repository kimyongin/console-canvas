"""Real Git paths, worktrees and independent clones are repository context, never URLs."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest
import io
import json
from unittest.mock import patch
from server import stdio
from bridge import Broker
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'mcp'))
from repository import repository_identity

class RepositoryTests(unittest.TestCase):
    def test_worktree_and_symlink_share_identity_independent_clone_does_not(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory); source=base/'repo with spaces'; linked=base/'linked'; clone=base/'clone'; alias=base/'alias'
            subprocess.run(['git','init','-q',str(source)],check=True)
            subprocess.run(['git','-C',str(source),'-c','user.name=QA','-c','user.email=qa@example.test','commit','-q','--allow-empty','-m','fixture'],check=True)
            subprocess.run(['git','-C',str(source),'worktree','add','-q',str(linked)],check=True)
            subprocess.run(['git','clone','-q',str(source),str(clone)],check=True)
            alias.symlink_to(source, target_is_directory=True)
            one=repository_identity(str(source)); two=repository_identity(str(linked))
            self.assertEqual(one['identity'],two['identity'])
            self.assertNotEqual(one['root'],two['root'])
            self.assertEqual(one['identity'],repository_identity(str(alias))['identity'])
            self.assertNotEqual(one['identity'],repository_identity(str(clone))['identity'])

    def test_non_git_path_is_not_guessed_from_a_website_or_remote(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError): repository_identity(directory)
        for value in ('https://example.test/project', '', None):
            with self.assertRaises((ValueError, OSError)): repository_identity(value)

class RepositoryTransportTests(unittest.TestCase):
    def test_agent_stdio_attaches_verified_context_without_gui_filesystem_access(self):
        repository={'identity':'a'*64,'root':'/agent/repository','common_dir':'/agent/repository/.git'}
        messages=[{'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-11-25'}},
                  {'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'resolve_project','arguments':{'repository_path':'/agent/repository'}}}]
        with patch('server.repository_identity',return_value=repository) as verify, patch('server.request',return_value={'ok':True}) as call, patch('sys.stdin',io.StringIO('\n'.join(json.dumps(m) for m in messages))), patch('sys.stdout',io.StringIO()):
            stdio({'url':'http://127.0.0.1:1','token':'fixture'})
        verify.assert_called_once_with('/agent/repository')
        self.assertEqual(call.call_args.args[2]['repository_context'],repository)

    def test_broker_does_not_guess_or_read_unverified_agent_repository(self):
        with tempfile.TemporaryDirectory() as directory:
            broker=Broker(Path(directory))
            result=broker.call('resolve_project',{'repository_path':'/not-readable-by-gui'})
            self.assertEqual(result['error']['code'],'repository_context_required')
