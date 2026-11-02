import { workspaceIdentity } from '../workspace-identity.js';
import { createProject } from '../project-model.js';
import { getDocument, transact } from '../db.js';
import { listTickets } from '../ticket-model.js';
import {
  beginCaptureJob,
  persistCapturedTicket,
  recoverCaptureJob,
  readCaptureJob,
  finishCaptureJob,
} from '../capture-jobs.js';
import { agentRepositoryContext } from '../repository-context.js';

const results = [];
const check = (name, value) => {
  results.push({ name, passed: !!value });
  document.querySelector('#results').textContent = JSON.stringify(results);
  if (!value) throw Error(name);
};
const rejects = async (run) => {
  try {
    await run();
    return false;
  } catch {
    return true;
  }
};
try {
  const identities = await Promise.all(Array.from({ length: 8 }, () => workspaceIdentity()));
  check(
    'Concurrent workspace discovery creates exactly one durable UUID',
    new Set(identities).size === 1,
  );
  const project = await createProject('Extension storage verification');
  const jobRequest = {
    id: crypto.randomUUID(),
    project_id: project.id,
    tab_id: 43,
    url: 'https://example.test/page',
    scope: { mode: 'viewport' },
    session_id: 'browser-test',
  };
  const job = await beginCaptureJob(jobRequest);
  check(
    'Same capture request is replayed without a second operation',
    (await beginCaptureJob(jobRequest)).id === job.id,
  );
  check(
    'Different payload cannot reuse a capture request ID',
    await rejects(() => beginCaptureJob({ ...jobRequest, tab_id: 44 })),
  );
  check(
    'A second concurrent capture cannot silently change the target',
    await rejects(() => beginCaptureJob({ ...jobRequest, id: crypto.randomUUID() })),
  );
  const sample = await fetch('../sample.uiclone.json').then((r) => r.json());
  sample.source.url = jobRequest.url;
  await persistCapturedTicket(sample, job);
  await persistCapturedTicket(sample, job);
  check(
    'Duplicate persistence allocates only one ticket',
    (await listTickets(project.id)).total === 1,
  );
  const doc = await getDocument(job.id);
  check(
    'Capture preserves project and original browser-session binding',
    doc.project_id === project.id &&
      doc.source.extension.tab_id === 43 &&
      doc.source.extension.session_id === 'browser-test',
  );
  // Simulate response loss after the atomic capture save but before the status acknowledgement.
  await finishCaptureJob(job, { stage: 'running' });
  const recovered = await recoverCaptureJob();
  check(
    'Worker restart recovers an already committed capture as complete',
    recovered.stage === 'complete' && recovered.ticket_id === job.id,
  );
  const interrupted = await beginCaptureJob({ ...jobRequest, id: crypto.randomUUID() });
  const noCapture = await recoverCaptureJob();
  check(
    'Interrupted capture without a saved model creates no empty ticket',
    noCapture.stage === 'interrupted' &&
      !(await getDocument(interrupted.id)) &&
      (await listTickets(project.id)).total === 1,
  );
  check(
    'Recovered interruption stays durable',
    (await readCaptureJob(interrupted.id)).stage === 'interrupted',
  );
  const context = await agentRepositoryContext(
    { root: '/work/project', common_dir: '/work/project/.git', method: 'git_rev_parse' },
    '/work/project',
  );
  check(
    'Browser labels Git identity as agent-provided instead of filesystem-verified',
    context.verification.by === 'local_agent' &&
      context.verification.browser_filesystem_verified === false &&
      context.identity.length === 64,
  );
  check(
    'Unverified boolean and mismatched root cannot create a repository binding',
    await rejects(() =>
      agentRepositoryContext(
        { root: '/other', common_dir: '/work/project/.git', verified: true },
        '/work/project',
      ),
    ),
  );
  check(
    'Path traversal and forged identity are rejected',
    (await rejects(() =>
      agentRepositoryContext(
        { root: '/work/project', common_dir: '/work/../other', method: 'git_rev_parse' },
        '/work/project',
      ),
    )) &&
      (await rejects(() =>
        agentRepositoryContext(
          {
            root: '/work/project',
            common_dir: '/work/project/.git',
            method: 'git_rev_parse',
            identity: 'fake',
          },
          '/work/project',
        ),
      )),
  );
  check(
    'Workspace identity survives independent reads',
    (await workspaceIdentity()) === identities[0],
  );
  document.querySelector('#status').textContent = JSON.stringify({
    passed: results.length,
    failed: 0,
    total: results.length,
  });
  document.body.dataset.result = 'pass';
} catch (error) {
  document.querySelector('#status').textContent = 'FAILED: ' + error.stack;
  document.body.dataset.result = 'fail';
}
