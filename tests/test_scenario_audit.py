"""The published scenario/action audit must not silently omit goals or invent coverage."""
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ScenarioAuditTests(unittest.TestCase):
    def setUp(self):
        self.audit = json.loads((ROOT / 'docs/scenarios-0.34.json').read_text())

    def test_original_and_added_goals_are_complete_and_unique(self):
        counts = dict(A=13, B=12, C=11, D=9, E=13, F=6, G=10, H=7,
                      I=8, J=13, K=10, L=5, M=4, N=16)
        expected = {f'{prefix}{number:02d}' for prefix, size in counts.items()
                    for number in range(1, size + 1)}
        values = self.audit['scenarios']
        ids = [row['id'] for row in values]
        self.assertEqual(len(ids), 137)
        self.assertEqual(set(ids), expected)
        self.assertEqual(len(ids), len(set(ids)))
        markdown = (ROOT / 'docs/scenario-matrix-0.34.md').read_text()
        self.assertEqual(set(re.findall(r'^\| ([A-N]\d{2}) \|', markdown, re.M)), expected)

    def test_each_goal_has_boundaries_and_executable_evidence(self):
        runner = (ROOT / 'tests/browser-runner.cjs').read_text()
        partial = 0
        for row in self.audit['scenarios']:
            for field in ['goal', 'start', 'finish', 'before', 'after', 'external', 'decision']:
                self.assertTrue(row[field], (row['id'], field))
            self.assertIn(row['coverage'], ['controlled', 'partial'])
            partial += row['coverage'] == 'partial'
            self.assertEqual(row['count_kind'], 'conditional_model')
            self.assertTrue(row['tests'], row['id'])
            for ref in row['tests']:
                target = (ROOT / ref).resolve()
                self.assertTrue(target.is_relative_to(ROOT))
                self.assertTrue(target.is_file(), (row['id'], ref))
                if re.fullmatch(r'tests/[^/]+\.js', ref):
                    self.assertIn("'" + target.stem + "'", runner, (row['id'], ref))
        self.assertEqual(partial, 16)

    def test_roundtrip_actions_include_menu_close_and_return_costs(self):
        flows = {flow['id']: flow for flow in self.audit['flows']}
        for key, expected in {'review-return': (5, 2), 'snapshot-handoff-roundtrip': (5, 2),
                              'recover-open': (5, 3)}.items():
            flow = flows[key]
            self.assertEqual((len(flow['before']), len(flow['after'])), expected)
            self.assertEqual(flow['url_navigations'], [0, 0])
            self.assertTrue(flow['start'] and flow['end'] and flow['boundary'])
        self.assertIn('기준 메뉴 열기', flows['review-return']['before'])
        self.assertIn('검토 닫기', flows['review-return']['before'])
        goals = {row['id']: row for row in self.audit['scenarios']}
        self.assertEqual((goals['N10']['before'], goals['N10']['after']), ('1', '1'))
        self.assertEqual((goals['N13']['before'], goals['N13']['after']), ('3', '3'))


if __name__ == '__main__':
    unittest.main()
