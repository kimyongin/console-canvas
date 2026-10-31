import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTicketUpdate, ticketImage } from '../../ticket-model.js';
const ticket = {
  id: 't',
  project_id: 'project',
  status: 'queued',
  revision: 0,
  goal: { image: { data_url: 'fixed' }, request: 'fixed' },
  records: [],
};
test('ticket CAS and authorization/evidence guard a fixed goal', () => {
  const write = (patch, base = ticket) =>
    applyTicketUpdate(base, { expected_revision: base.revision, summary: 'work', ...patch });
  assert.throws(
    () => write({ status: 'done' }),
    (e) => e.code === 'invalid_transition',
  );
  assert.throws(
    () => write({ status: 'working' }),
    (e) => e.code === 'instruction_required',
  );
  const working = write({
    status: 'working',
    implementation_instruction: 'human requested implementation',
  });
  assert.throws(
    () => write({ status: 'review' }, working),
    (e) => e.code === 'evidence_required',
  );
  const review = write(
    { status: 'review', image: { data_url: 'result' }, checks: 'responsive verified' },
    working,
  );
  assert.throws(
    () => write({ status: 'done' }, review),
    (e) => e.code === 'approval_required',
  );
  const done = write(
    { status: 'done', review_decision: 'approved', review_note: 'human approved' },
    review,
  );
  assert.equal(done.status, 'done');
  assert.deepEqual(done.goal, ticket.goal);
  assert.equal(ticket.records.length, 0);
  assert.throws(
    () => write({ expected_revision: 0, status: 'queued' }, done),
    (e) => e.code === 'ticket_revision_conflict',
  );
});
test('image ingestion refuses text disguised as PNG and active SVG content', async () => {
  await assert.rejects(
    ticketImage('data:image/png;base64,' + btoa('<script>code</script>')),
    (e) => e.code === 'invalid_image',
  );
  await assert.rejects(
    ticketImage('data:image/svg+xml;base64,' + btoa('<svg/>')),
    (e) => e.code === 'invalid_image',
  );
});
