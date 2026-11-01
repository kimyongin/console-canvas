// Official SDK client for our disposable study projects only. Never creates tickets.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..'),
  round = process.argv[2],
  mode = process.argv[3] || 'inspect';
if (!/^I[1-5]$/.test(round)) throw Error('Choose I1..I5');
const dir = path.join(root, 'local/ux-study', round),
  tickets = JSON.parse(await fs.readFile(path.join(dir, 'tickets.json'), 'utf8'));
const project = JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8')).project;
const client = new Client({ name: 'console-canvas-study-' + round, version: '1.0.0' });
await client.connect(
  new StdioClientTransport({
    command: '/usr/bin/python3',
    args: [
      path.join(root, 'mcp/server.py'),
      '--state-dir',
      path.join(root, 'local/ux-study/bridge'),
      '--port',
      '59080',
    ],
    stderr: 'pipe',
  }),
);
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError || r.structuredContent?.ok === false)
    throw Error(JSON.stringify(r.structuredContent || r));
  return r;
};
try {
  const guide = (await call('get_agent_guide')).structuredContent;
  if (!guide.markdown.includes('confirm_ticket_goal')) throw Error('Old agent guide');
  const listed = [];
  let cursor;
  do {
    const r = (
      await call('list_tickets', {
        project_id: project,
        ...(mode === 'start' ? { status: 'queued' } : {}),
        limit: 2,
        ...(cursor ? { cursor } : {}),
      })
    ).structuredContent;
    listed.push(...r.tickets);
    cursor = r.next_cursor;
  } while (cursor);
  if (mode === 'inspect' || mode === 'start') {
    for (const t of tickets)
      if (!listed.some((x) => x.id === t.id)) throw Error('Missing queued study ticket ' + t.id);
  }
  const summaries = [];
  await fs.mkdir(path.join(dir, 'contexts'), { recursive: true });
  for (const t of tickets) {
    const result = await call('get_ticket', { project_id: project, ticket_ref: t.id });
    const value = result.structuredContent.ticket;
    if (value.id !== t.id || !value.goal?.id) throw Error('Wrong or missing fixed goal');
    let imageIndex = 0;
    for (const image of result.content.filter((b) => b.type === 'image')) {
      const ext = image.mimeType === 'image/jpeg' ? 'jpg' : 'png';
      await fs.writeFile(
        path.join(dir, 'contexts', t.case + '-' + imageIndex++ + '.' + ext),
        Buffer.from(image.data, 'base64'),
      );
    }
    if (mode === 'start') {
      await call('update_ticket', {
        project_id: project,
        ticket_ref: t.id,
        expected_ticket_revision: value.revision,
        goal_id: value.goal.id,
        operation_id: 'study-' + round + '-start-' + t.id,
        status: 'working',
        implementation_instruction:
          '사용자가 요청한 5개 샘플 프로젝트 실사용 검증에 따라 이 가상 프로젝트의 확정 목표를 실제 샘플 소스에 반영합니다. 원본 기능·반응형을 유지하고 결과는 검토 대기로 기록하며 사람 승인은 추정하지 않습니다.',
        summary: '묶음 요청의 대상 ID와 목표를 고정하고 실제 샘플 소스 구현을 시작합니다.',
      });
    }
    if (mode === 'review') {
      if (value.status !== 'working')
        throw Error('Review requires actual implementation in progress');
      const bytes = await fs.readFile(path.join(dir, 'implementation.jpg'));
      const mime = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
      const report = JSON.parse(
        await fs.readFile(path.join(dir, 'implementation-checks.json'), 'utf8'),
      );
      const updated = (
        await call('update_ticket', {
          project_id: project,
          ticket_ref: t.id,
          expected_ticket_revision: value.revision,
          goal_id: value.goal.id,
          operation_id: 'study-' + round + '-review-' + t.id,
          status: 'review',
          implementation_image_data_url: 'data:' + mime + ';base64,' + bytes.toString('base64'),
          checks: report.checks,
          summary:
            t.case +
            ' 실제 샘플 소스 반영·검증 완료. 전체 페이지 결과는 같은 프로젝트의5개 요청을 함께 반영한 실제 화면입니다. 사람 승인은 받지 않았으므로 검토 대기로 둡니다.',
        })
      ).structuredContent.ticket;
      if (updated.status !== 'review' || updated.goal.id !== value.goal.id)
        throw Error('Review persistence mismatch');
      value.status = updated.status;
      value.revision = updated.revision;
    }
    summaries.push({
      case: t.case,
      id: t.id,
      display: value.display_id,
      title: value.title,
      project: value.project_id,
      status: value.status,
      revision: value.revision,
      goal: value.goal.id,
      request: value.goal.request,
      comments: value.workspace.annotations,
      images: imageIndex,
    });
  }
  await fs.writeFile(
    path.join(dir, 'agent-' + mode + '.json'),
    JSON.stringify(
      {
        round,
        mode,
        version: guide.version,
        project,
        listed: listed.map((t) => t.id),
        tickets: summaries,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      round,
      mode,
      version: guide.version,
      project,
      listed: listed.length,
      tickets: summaries,
    }),
  );
} finally {
  await client.close();
}
