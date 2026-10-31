export interface EditorView {
  documentId: string | null;
  generation: number;
  revision: number;
  ready: boolean;
  selected: boolean;
  selectedHidden: boolean;
  undoCount: number;
  redoCount: number;
  save: { pending: boolean; error: string | null; message: string };
}
export type EditorCommand =
  | 'tickets'
  | 'new-ticket'
  | 'capture-back'
  | 'layer-search-clear'
  | 'undo'
  | 'redo'
  | 'delete'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'focus-view'
  | 'commands'
  | 'repair-assets'
  | 'source-compare'
  | 'capture-status'
  | 'properties'
  | 'comment';
export function createEditorAdapter(read: () => EditorView) {
  let snapshot = read();
  const listeners = new Set<() => void>();
  const actions = new Map<EditorCommand, () => unknown>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish() {
      snapshot = read();
      for (const listener of listeners) listener();
    },
    register(command: EditorCommand, run: () => unknown) {
      if (actions.has(command)) throw Error('Duplicate editor command: ' + command);
      actions.set(command, run);
      return () => {
        actions.delete(command);
      };
    },
    dispatch(command: EditorCommand) {
      if (!actions.has(command)) throw Error('Unknown editor command: ' + command);
      return actions.get(command)!();
    },
    dispose() {
      listeners.clear();
      actions.clear();
    },
  };
}
export type EditorAdapter = ReturnType<typeof createEditorAdapter>;
