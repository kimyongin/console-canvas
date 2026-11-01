import { transact } from './db.js';
const failure = (code, message, extra = {}) => Object.assign(Error(message), { code, ...extra });
function name(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120)
    throw failure('invalid_project', '프로젝트 이름을 입력해 주세요.');
  return value.trim();
}
export async function listProjects() {
  return transact(['projects'], 'readonly', (tx, done) => {
    const r = tx.objectStore('projects').getAll();
    r.onsuccess = () => done(r.result.sort((a, b) => a.created_at.localeCompare(b.created_at)));
  });
}
export async function getProject(ref) {
  return (await listProjects()).find((p) => p.id === ref || p.display_id === ref);
}
export async function createProject(title) {
  title = name(title);
  return transact(['projects', 'settings'], 'readwrite', (tx, done) => {
    const r = tx.objectStore('settings').get('project-sequence');
    r.onsuccess = () => {
      const n = (r.result?.value || 0) + 1;
      const project = {
        id: crypto.randomUUID(),
        display_id: 'P-' + String(n).padStart(2, '0'),
        name: title,
        revision: 0,
        repository: null,
        created_at: new Date().toISOString(),
      };
      tx.objectStore('projects').add(project);
      tx.objectStore('settings').put({ id: 'project-sequence', value: n });
      tx.objectStore('settings').put({ id: 'active-project', value: project.id });
      done(project);
    };
  });
}
export async function updateProject(id, patch) {
  if (patch.name !== undefined) patch = { ...patch, name: name(patch.name) };
  const allowed = Object.fromEntries(
    ['name', 'last_url', 'last_ticket_id'].filter((k) => k in patch).map((k) => [k, patch[k]]),
  );
  return transact(['projects'], 'readwrite', (tx, done) => {
    const r = tx.objectStore('projects').get(id);
    r.onsuccess = () => {
      if (!r.result) {
        tx.failure = failure('project_not_found', '프로젝트를 찾을 수 없습니다.');
        tx.abort();
        return;
      }
      const next = {
        ...r.result,
        ...allowed,
        revision: r.result.revision + (allowed.name !== undefined ? 1 : 0),
      };
      tx.objectStore('projects').put(next);
      done(next);
    };
  });
}
export async function activeProject(id) {
  if (id !== undefined && !(await getProject(id)))
    throw failure('project_not_found', '프로젝트를 선택해 주세요.');
  return transact(['settings'], id === undefined ? 'readonly' : 'readwrite', (tx, done) => {
    if (id !== undefined) {
      tx.objectStore('settings').put({ id: 'active-project', value: id });
      done(id);
    } else {
      const r = tx.objectStore('settings').get('active-project');
      r.onsuccess = () => done(r.result?.value || null);
    }
  });
}
export async function resolveProject({ project_id, repository } = {}) {
  const projects = await listProjects();
  if (project_id) {
    const project = projects.find((p) => p.id === project_id || p.display_id === project_id);
    if (!project) throw failure('project_not_found', '프로젝트 ID를 확인해 주세요.');
    if (repository && project.repository?.identity !== repository.identity)
      throw failure(
        'repository_mismatch',
        '현재 저장소와 프로젝트 연결이 다릅니다. 연결을 확인해 주세요.',
      );
    return project;
  }
  const matches = repository
    ? projects.filter((p) => p.repository?.identity === repository.identity)
    : [];
  if (matches.length === 1) return matches[0];
  throw failure(
    matches.length > 1 ? 'ambiguous_project' : 'project_required',
    matches.length > 1
      ? '이 저장소의 프로젝트를 선택해 주세요.'
      : '프로젝트 ID 또는 연결된 현재 저장소 경로를 지정해 주세요.',
    { candidates: matches.map(({ id, display_id, name }) => ({ id, display_id, name })) },
  );
}
export async function connectRepository(input) {
  const { repository, operation_id, expected_project_revision } = input;
  if (!repository?.identity || !repository.root || !repository.common_dir || !operation_id)
    throw failure('invalid_repository', '검증한 로컬 Git 저장소와 작업 ID가 필요합니다.');
  const project = await resolveProject({ project_id: input.project_id });
  const payload = JSON.stringify({ project_id: project.id, repository, expected_project_revision });
  return transact(['projects', 'operations'], 'readwrite', (tx, done) => {
    const key = 'repository:' + project.id + ':' + operation_id;
    const receipt = tx.objectStore('operations').get(key);
    receipt.onsuccess = () => {
      if (receipt.result) {
        if (receipt.result.payload !== payload) {
          tx.failure = failure('operation_id_reused', '다른 요청에 사용한 작업 ID입니다.');
          tx.abort();
        } else done(receipt.result.result);
        return;
      }
      const r = tx.objectStore('projects').get(project.id);
      r.onsuccess = () => {
        const p = r.result;
        if (p.repository?.identity === repository.identity) {
          tx.objectStore('operations').put({ id: key, payload, result: p });
          done(p);
          return;
        }
        if (p.revision !== expected_project_revision) {
          tx.failure = failure('project_revision_conflict', '프로젝트를 다시 조회해 주세요.');
          tx.abort();
          return;
        }
        const next = { ...p, repository, revision: p.revision + 1 };
        tx.objectStore('projects').put(next);
        tx.objectStore('operations').put({ id: key, payload, result: next });
        done(next);
      };
    };
  });
}
export function connectionRequest(project) {
  return `현재 저장소를 캔버스 프로젝트 ${project.display_id}에 연결하고 티켓을 보여줘.`;
}
