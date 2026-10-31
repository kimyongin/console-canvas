import {
  createTicket,
  listTickets,
  getTicket,
  confirmTicketGoal,
  updateTicket,
  ticketReceipt,
  fingerprint,
} from './ticket-model.js';
import { getDocument, sharedProjects, editReceipt } from './db.js';
import { withSceneCopy } from './scene-preview.js';
import { createEditorController } from './editor-controller.js';
import { createEditorSession } from './editor-session.js';
import { buildVisualContext } from './design-context.js';
import { buildHandoffImage } from './handoff-image.js';

const dataUrl = (blob) =>
  new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = no;
    r.readAsDataURL(blob);
  });
const failure = (code, message, extra = {}) => ({ ok: false, error: { code, message, ...extra } });
export function createTicketWorkspace({ state, editorId, controller, flushEditor, refresh }) {
  let projects = [];
  async function permissions() {
    projects = await sharedProjects();
    return projects;
  }
  void permissions();
  const metadata = () => ({
    ...(controller.metadata() || {
      editor_id: editorId,
      document_id: 'workspace',
      title: 'Console Canvas 티켓',
      url: '',
      revision: 0,
      element_count: 0,
      comment_count: 0,
    }),
    workspace: true,
    project_ids: projects,
  });
  async function resolve(args) {
    const allowed = await permissions();
    if (args.project_id && !allowed.includes(args.project_id))
      throw Object.assign(Error('허용된 프로젝트가 아닙니다.'), { code: 'not_authorized' });
    const found = [];
    for (const project of args.project_id ? [args.project_id] : allowed) {
      try {
        const t = await getTicket(args.ticket_ref, project);
        if (t) found.push(t);
      } catch (e) {
        if (e.code === 'ambiguous_ticket') found.push(...e.candidates);
        else throw e;
      }
    }
    if (found.length > 1)
      throw Object.assign(Error('티켓이 여러 개입니다. ID로 선택해 주세요.'), {
        code: 'ambiguous_ticket',
        candidates: found.map(({ id, display_id, title, project_id, status }) => ({
          id,
          display_id,
          title,
          project_id,
          status,
        })),
      });
    if (!found.length)
      throw Object.assign(Error('허용 범위에서 티켓을 찾을 수 없습니다.'), {
        code: 'ticket_not_found',
      });
    return found[0];
  }
  async function runScene(ticket, run, saved = false) {
    if (saved && state.snapshot?.id === ticket.document_id) await flushEditor();
    if (state.snapshot?.id === ticket.document_id && !saved) {
      if (state.scene?.drag || state.scene?.areaSelecting || document.querySelector('dialog:modal'))
        throw Object.assign(Error('열린 편집을 마친 뒤 요청해 주세요.'), { code: 'editor_busy' });
      await flushEditor();
      return run(controller, await getDocument(ticket.document_id));
    }
    const doc = await getDocument(ticket.document_id);
    if (!doc)
      throw Object.assign(
        Error('이전 목표의 편집 화면이 없습니다. 출처에서 새 티켓으로 가져와 주세요.'),
        { code: 'workspace_unavailable' },
      );
    return withSceneCopy(doc, doc, async (scene) => {
      let note = doc.note || '';
      const local = {
        snapshot: doc,
        scene,
        ready: true,
        revision: doc.edit_revision || 0,
        storageRevision: doc.storage_revision || 0,
        writerId: editorId,
        project_id: ticket.project_id,
        undo: doc.undo || [],
        redo: doc.redo || [],
        activity: doc.activity || [],
        activityHead: doc.activityHead || null,
      };
      scene.select(null, { ids: doc.selection || [] });
      const session = createEditorSession({
        state: local,
        getNote: () => note,
        setNote: (v) => {
          note = v;
        },
        status: () => {},
        render: () => {},
        commitCommentDraft: () => {},
      });
      const closed = createEditorController({
        ...session,
        state: local,
        editorId,
        render: () => {},
        flush: async () => {
          await session.flush();
          return true;
        },
        buildDesignContext: () =>
          buildVisualContext(scene, { ...doc, selection: [...scene.selection] }),
        buildHandoffImage: () => buildHandoffImage(doc, scene, note),
      });
      return run(closed, doc);
    });
  }
  async function execute(command) {
    const args = command.arguments || {},
      name = command.name;
    if (Date.now() > command.deadline * 1000) return failure('expired', '명령이 만료됐습니다.');
    try {
      await permissions();
      if (name === 'list_tickets') {
        if (args.project_id && !projects.includes(args.project_id))
          return failure('not_authorized', '허용된 프로젝트가 아닙니다.');
        if (state.ready) await flushEditor();
        let rows = [];
        for (const project of args.project_id ? [args.project_id] : projects)
          rows.push(
            ...(
              await listTickets(project, { status: args.status, query: args.query, limit: 10000 })
            ).tickets,
          );
        rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        const offset = Number(args.cursor || 0),
          limit = args.limit || 50;
        if (!Number.isSafeInteger(offset) || offset < 0)
          return failure('invalid_cursor', '목록 커서를 확인해 주세요.');
        return {
          ok: true,
          projects,
          total: rows.length,
          tickets: rows.slice(offset, offset + limit),
          next_cursor: offset + limit < rows.length ? String(offset + limit) : null,
        };
      }
      if (name === 'create_ticket') {
        const project = args.project_id || (projects.length === 1 ? projects[0] : null);
        if (!project || !projects.includes(project))
          return failure('project_required', '허용된 프로젝트를 지정해 주세요.', { projects });
        const t = await createTicket({ ...args, project_id: project });
        refresh?.();
        return { ok: true, ticket: t, persisted: true };
      }
      const ticket = await resolve(args);
      if (name === 'update_ticket') {
        const next = await updateTicket({
          ...args,
          ticket_id: ticket.id,
          project_id: ticket.project_id,
          expected_revision: args.expected_ticket_revision,
        });
        refresh?.();
        return { ok: true, ticket: summary(next), persisted: true };
      }
      if (name === 'get_ticket') {
        let workspace = null,
          currentImages = [];
        if (ticket.document_id) {
          if (state.snapshot?.id === ticket.document_id) await flushEditor();
          const result = await runScene(
            ticket,
            async (c, doc) => {
              const context = doc.source.empty
                ? null
                : await c.execute({
                    ...command,
                    name: 'get_design_context',
                    document_id: doc.id,
                    arguments: { editor_id: editorId },
                  });
              if (context && !context.ok)
                throw Object.assign(Error(context.error.message), { code: context.error.code });
              return {
                workspace: {
                  edit_revision: context?.revision ?? doc.edit_revision ?? 0,
                  source: doc.source,
                  empty: !!doc.source.empty,
                  annotations: doc.annotations || {},
                  note: doc.note || '',
                  selection: doc.selection || [],
                  changes: doc.edits || {},
                  legacy_current_state: !!ticket.legacy_workspace,
                },
                images: context?.images || [],
              };
            },
            true,
          );
          workspace = result.workspace;
          currentImages = result.images.map((i) => ({
            ...i,
            role: 'current',
            edit_revision: workspace.edit_revision,
          }));
        }
        const evidence = args.evidence_record_id
          ? ticket.records.find((r) => r.id === args.evidence_record_id && r.image)
          : ticket.records.findLast((r) => r.image);
        if (args.evidence_record_id && !evidence)
          return failure('record_not_found', '구현 기록을 찾을 수 없습니다.');
        return {
          ok: true,
          ticket: {
            ...summary(ticket),
            workspace,
            next_actions: ticket.goal
              ? ['구현 요청', '목표·결과 검토']
              : ['편집·주석', '시안 탐색', '목표 확정'],
          },
          images: [
            ...currentImages,
            ...(ticket.goal
              ? [
                  {
                    role: 'goal',
                    kind: 'goal',
                    goal_id: ticket.goal.id,
                    image_url: ticket.goal.image.data_url,
                  },
                ]
              : []),
            ...(evidence
              ? [
                  {
                    role: 'implementation',
                    kind: 'implementation',
                    record_id: evidence.id,
                    image_url: evidence.image.data_url,
                  },
                ]
              : []),
          ],
        };
      }
      const operation_payload = { ...args };
      delete operation_payload.ticket_ref;
      operation_payload.ticket_id = ticket.id;
      if (name === 'confirm_ticket_goal') {
        const prior = await ticketReceipt(ticket.project_id, args.operation_id, operation_payload);
        if (prior) return { ok: true, ticket: summary(prior), persisted: true, replayed: true };
      }
      return runScene(
        ticket,
        async (c, doc) => {
          if (name === 'confirm_ticket_goal') {
            const image = args.image_data_url
              ? null
              : await c.execute({
                  ...command,
                  name: 'get_review_image',
                  document_id: doc.id,
                  arguments: { editor_id: editorId },
                });
            if (image && !image.ok) return image;
            const fresh = await getDocument(doc.id);
            const next = await confirmTicketGoal({
              ...args,
              expected_revision: args.expected_ticket_revision,
              project_id: ticket.project_id,
              ticket_id: ticket.id,
              image_data_url: args.image_data_url || image.data_url,
              source: doc.source,
              annotations: fresh.annotations || {},
              selection: fresh.selection || [],
              operation_payload,
            });
            refresh?.();
            return { ok: true, ticket: summary(next), persisted: true };
          }
          let receipt = null;
          if (['apply_edits', 'undo', 'redo'].includes(name)) {
            const payload = { ...args, ticket_id: ticket.id };
            delete payload.ticket_ref;
            delete payload.editor_id;
            receipt = {
              id: 'edit:' + ticket.id + ':' + args.operation_id,
              hash: await fingerprint({ name, ...payload }),
            };
            const prior = await editReceipt(receipt.id, receipt.hash);
            if (prior) return { ...prior, replayed: true };
            c.state.operationReceipt = receipt;
          }
          let result;
          try {
            result = await c.execute({
              ...command,
              document_id: doc.id,
              arguments: {
                ...args,
                editor_id: editorId,
                expected_revision: args.expected_edit_revision,
              },
            });
          } finally {
            c.state.operationReceipt = null;
          }
          if (result.ok && ['apply_edits', 'undo', 'redo'].includes(name)) refresh?.();
          return { ...result, ticket_id: ticket.id };
        },
        [
          'get_design_context',
          'get_review_image',
          'get_screen',
          'list_elements',
          'list_comments',
          'list_history',
        ].includes(name),
      );
    } catch (e) {
      return failure(
        e.code || 'ticket_error',
        e.message,
        e.candidates ? { candidates: e.candidates } : {},
      );
    }
  }
  function summary(t) {
    return {
      ...t,
      goal: t.goal ? { ...t.goal, image: { ...t.goal.image, data_url: undefined } } : null,
      records: t.records.map((r) => ({
        ...r,
        ...(r.image ? { image: { ...r.image, data_url: undefined } } : {}),
      })),
    };
  }
  return {
    metadata,
    execute: (command) =>
      navigator.locks
        ? navigator.locks.request('console-canvas-agent', () => execute(command))
        : execute(command),
    permissions,
  };
}
