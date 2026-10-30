// Optional direct keys never replace the existing mouse paths or text editing.
export function createEditorCommands({
  $,
  state,
  adapter,
  panels,
  setPanelVisibility,
  snapshotLayout,
  restoreLayout,
  flushEditor,
  renameDialog,
  setAlias,
  toast,
  copyImage,
}) {
  let previousPanels = null,
    focusedPanels = null;
  const mod = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl';
  const commands = [
    {
      id: 'address',
      name: '웹사이트 주소 열기',
      key: 'l',
      shift: false,
      alt: false,
      label: mod + '+L',
      ready: () => !!window.ConsoleCanvasDesktop?.focusAddress,
      run: () => window.ConsoleCanvasDesktop.focusAddress(),
    },
    {
      id: 'focus',
      name: '캔버스 집중 보기 · 이전 패널로 복귀',
      key: 'f',
      shift: true,
      alt: false,
      label: mod + '+Shift+F',
      run: () => {
        if (previousPanels) {
          restoreLayout(previousPanels);
          previousPanels = null;
        } else {
          previousPanels = snapshotLayout();
          setPanelVisibility('layers', false, { persist: false });
          setPanelVisibility('properties', false, { persist: false });
        }
        focusedPanels = state.snapshot?.id;
      },
    },
    {
      id: 'coordinates',
      name: '선택 요소 좌표 편집',
      key: 'p',
      shift: false,
      alt: true,
      label: mod + '+Alt+P',
      ready: () => state.scene?.selection.size === 1,
      run: () => {
        adapter.dispatch('properties');
        $('#offset-x').focus();
        $('#offset-x').select();
      },
    },
    {
      id: 'duplicate',
      name: '선택 요소 복제',
      key: 'd',
      shift: false,
      alt: false,
      label: mod + '+D',
      ready: () => !!state.scene?.selection.size,
      run: () => adapter.dispatch('duplicate'),
    },
    {
      id: 'alias',
      name: '선택 레이어 별칭 변경',
      key: 'F2',
      plain: true,
      label: 'F2',
      ready: () => !!state.scene?.selected,
      run: () => {
        const id = state.scene.selected;
        renameDialog.open('레이어 별칭 변경', state.snapshot.layerNames?.[id] || '', (name) =>
          setAlias(id, name),
        );
      },
    },
    {
      id: 'snapshot-search',
      name: '스냅샷 검색 열기',
      key: 'f',
      shift: false,
      alt: true,
      label: mod + '+Alt+F',
      run: () => {
        $('#snapshot-dropdown').click();
        $('#snapshot-search').focus();
      },
    },
    {
      id: 'open',
      name: '편집 파일 열기',
      key: 'o',
      shift: false,
      alt: false,
      label: mod + '+O',
      ready: () => true,
      run: () => $('#import-button').click(),
    },
    {
      id: 'save',
      name: '편집 파일로 백업',
      key: 's',
      shift: true,
      alt: false,
      label: mod + '+Shift+S',
      run: () => $('#save-document').click(),
    },
    {
      id: 'image',
      name: '현재 작업 전달 이미지 복사',
      key: 'e',
      shift: true,
      alt: false,
      label: mod + '+Shift+E',
      run: () => copyImage(),
    },
  ];
  const available = (c) =>
    (state.ready || ['address', 'open'].includes(c.id)) && (c.ready ? c.ready() : state.ready);
  async function execute(c) {
    if (!available(c) || state.scene?.drag || state.scene?.areaSelecting) return;
    try {
      await c.run();
    } catch (error) {
      toast(error.message);
    }
  }
  function open() {
    $('#document-menu-content').hidePopover();
    const list = $('#command-list');
    list.replaceChildren();
    for (const c of commands) {
      const button = document.createElement('button');
      button.textContent = c.name + ' · ' + c.label;
      button.disabled = !available(c);
      button.addEventListener('click', () => {
        $('#commands-dialog').close();
        execute(c);
      });
      list.append(button);
    }
    $('#commands-dialog').showModal();
  }
  adapter.register('commands', open);
  $('#commands-close').addEventListener('click', () => $('#commands-dialog').close());
  function handle(e) {
    if (
      e.defaultPrevented ||
      e.isComposing ||
      e.keyCode === 229 ||
      e.repeat ||
      document.querySelector('dialog:modal') ||
      e.target.closest?.('input,textarea,select,[contenteditable="true"]')
    )
      return false;
    // Popover navigation keeps its existing keys (especially graph F2/arrow keys).
    if (document.querySelector(':popover-open')) return false;
    const c = commands.find((c) =>
      c.plain
        ? e.key === c.key && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
        : (e.metaKey || e.ctrlKey) &&
          e.key.toLowerCase() === c.key &&
          e.shiftKey === c.shift &&
          e.altKey === c.alt,
    );
    if (!c || !available(c)) return false;
    e.preventDefault();
    execute(c);
    return true;
  }
  return {
    handle,
    reset() {
      if (focusedPanels && focusedPanels !== state.snapshot?.id && previousPanels) {
        restoreLayout(previousPanels);
        previousPanels = null;
      }
    },
  };
}
