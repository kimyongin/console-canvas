import type { EditorAdapter, EditorCommand } from './store';
let active: EditorAdapter | null = null;
export function connectEditorCommands(adapter: EditorAdapter) {
  if (active) throw Error('Editor commands already connected');
  active = adapter;
  return () => {
    if (active === adapter) active = null;
  };
}
export function dispatchEditorCommand(command: EditorCommand) {
  return active?.dispatch(command);
}
