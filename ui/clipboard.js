const FORMAT = 'console-canvas-clipboard';
export function createClipboard({ $, state, toast, commitCommentDraft, adapter }) {
  let local = null,
    lastText = '',
    pasteCount = 0,
    unbindScene = () => {};
  function editable(event) {
    return (
      event.target?.ownerDocument === document &&
      !!event.target.closest?.('input,textarea,select,[contenteditable="true"]')
    );
  }
  function available() {
    return (
      state.ready &&
      state.mode === 'edit' &&
      !state.scene?.drag &&
      !state.scene?.areaSelecting &&
      !document.querySelector('dialog[open]')
    );
  }
  function collect() {
    commitCommentDraft();
    const payload = state.scene.copySelection();
    local = payload;
    lastText = JSON.stringify(payload);
    pasteCount = 0;
    return lastText;
  }
  function pasteText(text) {
    if (!available()) return;
    if (typeof text !== 'string' || text.length > 10_000_000)
      throw new Error('복사한 요소 정보가 너무 큽니다.');
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('캔버스에서 복사한 요소를 붙여넣어 주세요.');
    }
    if (payload?.format !== FORMAT) throw new Error('캔버스에서 복사한 요소를 붙여넣어 주세요.');
    if (text !== lastText) {
      lastText = text;
      pasteCount = 0;
    }
    commitCommentDraft();
    const roots = state.scene.pasteSelection(payload, 24 * (pasteCount + 1));
    pasteCount++;
    toast(roots.length + '개 요소를 붙여넣었습니다.');
  }
  function safely(run) {
    try {
      return run();
    } catch (error) {
      toast(error.message);
    }
  }
  function bind(doc) {
    const copy = (event) => {
      if (editable(event) || !available() || !state.scene.selection.size) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      safely(() => {
        event.clipboardData.setData('text/plain', collect());
        toast(state.scene.selectionRoots().length + '개 요소를 복사했습니다.');
      });
    };
    const paste = (event) => {
      if (editable(event) || !available()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      safely(() => pasteText(event.clipboardData.getData('text/plain')));
    };
    doc.addEventListener('copy', copy, true);
    doc.addEventListener('paste', paste, true);
    return () => {
      doc.removeEventListener('copy', copy, true);
      doc.removeEventListener('paste', paste, true);
    };
  }
  bind(document);
  adapter.register('copy', async () => {
    if (!available()) return;
    const text = safely(collect);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast('요소를 복사했습니다.');
    } catch {
      toast('요소를 복사했습니다. 이 창에서 붙여넣기를 사용할 수 있습니다.');
    }
  });
  adapter.register('paste', async () => {
    if (!available()) return;
    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      if (local) text = JSON.stringify(local);
    }
    if (text == null) {
      toast('⌘/Ctrl+V로 붙여넣어 주세요.');
      return;
    }
    safely(() => pasteText(text));
  });
  return {
    bindScene(scene) {
      unbindScene();
      unbindScene = bind(scene.doc);
    },
    reset() {
      unbindScene();
      unbindScene = () => {};
    },
  };
}
