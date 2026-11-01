import {
  activeProject,
  createProject,
  listProjects,
  getProject,
  updateProject,
  connectionRequest,
} from '../project-model.js';
import { agentRequest } from '../handoff-request.js';
// Project state belongs to storage, never to the agent transport's global context.
export function createProjectWorkflow({
  state,
  flush,
  openTicket,
  closeDocument,
  showTickets,
  confirm,
  publish,
  leave,
  importFile,
  copyRequest,
}) {
  let selected = null;
  async function initialize() {
    selected = await activeProject();
    state.project_id = state.project_id || selected;
    selected = state.project_id;
    return view();
  }
  async function view() {
    const projects = await listProjects(),
      project = projects.find((p) => p.id === (state.project_id || selected)) || null;
    return {
      projects,
      project,
      ticket: state.ticket
        ? {
            id: state.ticket.id,
            display_id: state.ticket.display_id,
            title: state.ticket.title,
            status: state.ticket.status,
            needs_reconfirmation: state.ticket.needs_reconfirmation,
            revision_requested: state.ticket.revision_requested,
          }
        : null,
      ticket_menu_open: !!document
        .querySelector('#document-menu-content')
        ?.matches(':popover-open'),
      ready: state.ready,
      confirming: !!state.confirming,
      save: { pending: !!state.savePending, error: state.lastSaveError || null },
    };
  }
  async function emit() {
    const value = await view();
    publish(value);
    return value;
  }
  async function execute({
    action,
    id,
    name,
    url,
    content,
    intent = 'read',
    scope = 'ticket',
    viaShell = false,
  }) {
    if (action === 'state') return emit();
    if (action === 'create') {
      await flush();
      leave();
      const project = await createProject(name);
      selected = project.id;
      if (url && /^https?:\/\//.test(url)) await updateProject(project.id, { last_url: url });
      if (state.snapshot) await closeDocument();
      state.project_id = selected;
    } else if (action === 'select') {
      await flush();
      const p = await getProject(id);
      if (!p) throw Error('프로젝트를 찾을 수 없습니다.');
      if (state.project_id !== p.id) {
        leave();
        if (state.snapshot) await closeDocument();
        selected = p.id;
        state.project_id = selected;
        await activeProject(selected);
        if (p.last_ticket_id) {
          try {
            await openTicket(p.last_ticket_id);
          } catch {
            /* deleted last ticket */
          }
        }
      }
    } else if (action === 'rename') await updateProject(state.project_id, { name });
    else if (action === 'save-url') {
      if (state.project_id) await updateProject(state.project_id, { last_url: url });
    } else if (action === 'copy-handoff') {
      await flush();
      const project = await getProject(state.project_id);
      const request = agentRequest(project, {
        ticket: scope === 'ticket' ? state.ticket : null,
        intent,
      });
      if (window.ConsoleCanvasDesktop && viaShell)
        return { ...(await view()), connection_request: request };
      await (copyRequest ? copyRequest(request) : navigator.clipboard.writeText(request));
    } else if (action === 'copy-connection') {
      const project = await getProject(state.project_id);
      if (!project) throw Error('프로젝트를 먼저 만들어 주세요.');
      if (window.ConsoleCanvasDesktop && viaShell)
        return { ...(await view()), connection_request: connectionRequest(project) };
      await (copyRequest
        ? copyRequest(connectionRequest(project))
        : navigator.clipboard.writeText(connectionRequest(project)));
    } else if (action === 'copy-ticket-id')
      return { ...(await view()), connection_request: state.ticket?.display_id || '' };
    else if (action === 'tickets') await showTickets();
    else if (action === 'confirm') await confirm();
    else if (action === 'import-file') {
      await ensure();
      await importFile(new File([content], name, { type: 'application/json' }));
    } else if (action === 'ticket-menu') {
      const menu = document.querySelector('#document-menu-content');
      menu.togglePopover();
      if (menu.matches(':popover-open')) menu.querySelector('button:not(:disabled)')?.focus();
    } else if (action === 'editor' && state.ready) leave();
    else if (action === 'editor' && !state.ready) throw Error('아직 가져온 티켓이 없습니다.');
    return emit();
  }
  async function ensure(projectId) {
    const p = await getProject(projectId || state.project_id || selected);
    if (!p) throw Error('프로젝트를 선택하거나 만든 뒤 가져와 주세요.');
    selected = p.id;
    state.project_id = p.id;
    await activeProject(p.id);
    return p;
  }
  return { initialize, view, execute, ensure, emit };
}
