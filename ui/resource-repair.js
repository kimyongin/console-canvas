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
    candidates = [];
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
  function results(items) {
    list.replaceChildren();
    for (const [index, item] of items.entries()) {
      const li = document.createElement('li'),
        label = document.createElement('label'),
        box = document.createElement('input');
      box.type = 'checkbox';
      box.value = item.url;
      box.checked = !item.error && index < 16;
      box.disabled = !!item.data;
      label.append(
        box,
        document.createTextNode(
          ' ' + item.label + (item.data ? ' · 준비됨' : item.error ? ' · ' + item.error : ''),
        ),
      );
      li.append(label);
      list.append(li);
    }
  }
  async function open() {
    if (!state.ready || !window.ConsoleCanvasDesktop?.retryAssets) return;
    commitCommentDraft();
    generation++;
    identity = { document: state.snapshot.id, revision: state.revision };
    patches = [];
    candidates = resourceCandidates(state.snapshot, state.scene.codePatches);
    results(candidates);
    $('#repair-assets-status').textContent =
      '최대 16개까지 선택해 주세요. 취소하면 현재 편집은 바뀌지 않습니다.';
    $('#repair-assets-apply').disabled = true;
    $('#repair-assets-fetch').disabled = false;
    clearReact($('#repair-assets-preview'));
    $('#capture-status-dialog').close();
    dialog.showModal();
  }
  $('#repair-assets-fetch').addEventListener('click', async () => {
    const token = ++generation;
    patches = [];
    $('#repair-assets-apply').disabled = true;
    if (!valid()) {
      toast('편집 상태가 바뀌었습니다. 복구 창을 다시 열어 주세요.');
      return;
    }
    const urls = [...list.querySelectorAll('input:checked:not(:disabled)')].map((el) => el.value);
    if (!urls.length || urls.length > 16) {
      $('#repair-assets-status').textContent = '1~16개를 선택해 주세요.';
      return;
    }
    $('#repair-assets-fetch').disabled = true;
    $('#repair-assets-status').textContent = '공개 자산을 다시 읽고 있습니다…';
    try {
      const read = await window.ConsoleCanvasDesktop.retryAssets(urls);
      if (!current(token)) return;
      await Promise.all(
        read.map(async (r) => {
          if (!r.data) return;
          try {
            validateResourcePatch({ resource_url: r.url, data: r.data });
            await decodeResource(r.data);
          } catch (error) {
            delete r.data;
            r.error = error.message;
          }
        }),
      );
      if (!current(token)) return;
      const next = read
        .filter((r) => r.data)
        .map((r) => ({ type: 'resource', resource_url: r.url, data: r.data }));
      validateCodePatches([...state.scene.codePatches, ...next]);
      const preview = await withVersionScene(
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
      results(
        read.map((r) => ({ ...r, label: candidates.find((c) => c.url === r.url)?.label || r.url })),
      );
      renderVersionFrame(
        $('#repair-assets-preview'),
        preview,
        '자산 복구 미리보기',
        Math.min(1, 700 / preview.size.width),
      );
      $('#repair-assets-status').textContent =
        next.length +
        '개 준비 · 실패 ' +
        read.filter((r) => r.error).length +
        '개. 아래 미리보기를 확인한 뒤 적용하세요. 원본 수집 경고와 사진은 보존됩니다.';
      $('#repair-assets-apply').disabled = !next.length;
    } catch (error) {
      if (token === generation) $('#repair-assets-status').textContent = error.message;
    } finally {
      if (token === generation) $('#repair-assets-fetch').disabled = false;
    }
  });
  $('#repair-assets-apply').addEventListener('click', () => {
    if (!valid() || !patches.length) {
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
    clearReact($('#repair-assets-preview'));
  });
  adapter.register('repair-assets', open);
}
