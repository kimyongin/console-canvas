import { resourceCandidates, decodeResource, validateResourcePatch } from '../resource-repair.js';
import { validateCodePatches } from '../code-patches.js';
import { withVersionScene } from './version-preview.js';
import { renderVersionFrame } from './react/versions.tsx';
import { clearReact } from './react/mount.tsx';
export function createResourceRepair({
  $,
  state,
  adapter,
  commitCommentDraft,
  historyBefore,
  changeCommitted,
  toast,
}) {
  let generation = 0,
    identity = null,
    patches = [],
    items = [],
    busy = false;
  const list = $('#repair-assets-results'),
    dialog = $('#repair-assets-dialog');
  const valid = () =>
    dialog.open &&
    state.ready &&
    identity?.document === state.snapshot.id &&
    identity?.revision === state.revision;
  const current = (token) => {
    if (token !== generation || !dialog.open) return false;
    if (!valid()) {
      $('#repair-assets-status').textContent =
        '편집 상태가 바뀌었습니다. 복구 창을 다시 열어 주세요.';
      $('#repair-assets-apply').disabled = true;
      return false;
    }
    return true;
  };
  function controls() {
    $('#repair-assets-fetch').disabled = busy || !items.some((i) => i.selected && !i.data);
    const failed = items.filter((i) => i.error).length;
    $('#repair-assets-retry').hidden = !failed;
    $('#repair-assets-retry').disabled = busy;
    $('#repair-assets-retry').textContent = '실패한 ' + Math.min(16, failed) + '개 다시 읽기';
    for (const box of list.querySelectorAll('input')) box.disabled = busy;
    if (busy) $('#repair-assets-apply').disabled = true;
  }
  function results() {
    list.replaceChildren();
    for (const item of items) {
      const li = document.createElement('li'),
        label = document.createElement('label'),
        box = document.createElement('input');
      box.type = 'checkbox';
      box.value = item.url;
      box.checked = item.selected;
      box.addEventListener('change', () => {
        item.selected = box.checked;
        const token = ++generation;
        $('#repair-assets-apply').disabled = true;
        preview(token).catch((error) => {
          if (current(token)) $('#repair-assets-status').textContent = error.message;
        });
        controls();
      });
      label.append(
        box,
        document.createTextNode(
          ' ' +
            item.label +
            (item.data ? ' · 준비됨' : item.error ? ' · ' + item.error : ' · 읽기 전'),
        ),
      );
      li.append(label);
      list.append(li);
    }
    controls();
  }
  async function preview(token) {
    if (!current(token)) return;
    patches = [];
    const next = items
      .filter((i) => i.data && i.selected)
      .map((i) => ({ type: 'resource', resource_url: i.url, data: i.data }));
    $('#repair-assets-status').textContent =
      next.length +
      '개 준비 · 실패 ' +
      items.filter((i) => i.error).length +
      '개 · 읽기 전 ' +
      items.filter((i) => !i.data && !i.error).length +
      '개. 준비된 항목을 선택해 적용합니다. 원본 경고와 사진은 보존됩니다.';
    if (!next.length) {
      clearReact($('#repair-assets-preview'));
      return;
    }
    validateCodePatches([...state.scene.codePatches, ...next]);
    const view = await withVersionScene(
      state.snapshot,
      {
        codePatches: [...state.scene.codePatches, ...next],
        edits: structuredClone(state.scene.edits),
        annotations: structuredClone(state.scene.annotations),
      },
      (scene) => scene.preview(),
    );
    if (!current(token)) return;
    patches = next;
    renderVersionFrame(
      $('#repair-assets-preview'),
      view,
      '자산 복구 미리보기',
      Math.min(1, 700 / view.size.width),
    );
    $('#repair-assets-apply').textContent = '준비된 ' + next.length + '개 적용';
    $('#repair-assets-apply').disabled = false;
  }
  async function read(urls) {
    if (busy || !valid()) return;
    if (!urls.length || urls.length > 16) {
      $('#repair-assets-status').textContent = '1~16개를 선택해 주세요.';
      return;
    }
    const token = ++generation;
    busy = true;
    controls();
    $('#repair-assets-status').textContent = '공개 자산을 다시 읽고 있습니다…';
    try {
      const values = await window.ConsoleCanvasDesktop.retryAssets(urls);
      if (!current(token)) return;
      for (const url of urls) {
        const value = values.find((v) => v.url === url) || { url, error: '응답 없음' };
        let data = value.data,
          error = value.error;
        if (data)
          try {
            validateResourcePatch({ resource_url: url, data });
            await decodeResource(data);
            error = '';
          } catch (e) {
            data = null;
            error = e.message;
          }
        if (!current(token)) return;
        const item = items.find((i) => i.url === url);
        Object.assign(item, { data, error: error || (data ? '' : '읽기 실패'), selected: !!data });
      }
      results();
      await preview(token);
    } catch (error) {
      if (current(token)) {
        for (const url of urls) {
          const item = items.find((i) => i.url === url);
          if (!item.data) Object.assign(item, { error: error.message, selected: false });
        }
        results();
        await preview(token).catch(() => {});
        if (current(token)) $('#repair-assets-status').textContent += ' · ' + error.message;
      }
    } finally {
      if (token === generation) {
        busy = false;
        controls();
      }
    }
  }
  async function open() {
    if (!state.ready || !window.ConsoleCanvasDesktop?.retryAssets) return;
    commitCommentDraft();
    generation++;
    busy = false;
    identity = { document: state.snapshot.id, revision: state.revision };
    patches = [];
    items = resourceCandidates(state.snapshot, state.scene.codePatches).map((i, index) => ({
      ...i,
      selected: index < 16,
    }));
    results();
    $('#repair-assets-status').textContent =
      '최대 16개까지 선택해 읽습니다. 준비된 결과는 재시도해도 유지됩니다.';
    $('#repair-assets-apply').disabled = true;
    clearReact($('#repair-assets-preview'));
    $('#capture-status-dialog').close();
    dialog.showModal();
  }
  $('#repair-assets-fetch').addEventListener('click', () =>
    read(items.filter((i) => i.selected && !i.data).map((i) => i.url)),
  );
  $('#repair-assets-retry').addEventListener('click', () =>
    read(
      items
        .filter((i) => i.error)
        .slice(0, 16)
        .map((i) => i.url),
    ),
  );
  $('#repair-assets-apply').addEventListener('click', () => {
    if (busy || !valid() || !patches.length) {
      toast('편집 상태가 바뀌었습니다. 복구 창을 다시 열어 주세요.');
      return;
    }
    try {
      const next = validateCodePatches([...state.scene.codePatches, ...patches]);
      historyBefore();
      state.scene.setCodePatches(next, state.scene.edits, state.scene.annotations);
      changeCommitted({ label: '이미지·폰트 복구' });
      dialog.close();
      toast('자산 복구를 적용했습니다. 실행 취소하거나 스냅샷으로 보관할 수 있습니다.');
    } catch (error) {
      $('#repair-assets-status').textContent = error.message;
    }
  });
  dialog.addEventListener('close', () => {
    generation++;
    patches = [];
    items = [];
    clearReact($('#repair-assets-preview'));
  });
  adapter.register('repair-assets', open);
}
