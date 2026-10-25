import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useSyncExternalStore, type ReactNode } from 'react';
import { EditorShell } from './editor-shell';
import type { EditorAdapter } from './store';
let shellRoot: Root | null = null;

export function mountEditorShell() {
  const host = document.getElementById('editor-root');
  if (!host) throw Error('Editor root missing');
  const root = createRoot(host);
  shellRoot = root;
  flushSync(() => root.render(<EditorShell />));
  return () => root.unmount();
}
export function connectShellAdapter(adapter: EditorAdapter) {
  flushSync(() => shellRoot!.render(<EditorShell adapter={adapter} />));
}
// Each stable island subscribes to a view slice, never to a copied capture/DOM tree.
const roots = new WeakMap<Element, { root: Root; set: (node: ReactNode) => void }>();
export function renderReact(host: Element, node: ReactNode) {
  let entry = roots.get(host);
  if (!entry) {
    let value: ReactNode = null;
    const listeners = new Set<() => void>();
    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };
    function View() {
      return useSyncExternalStore(subscribe, () => value);
    }
    const root = createRoot(host);
    entry = {
      root,
      set(next) {
        value = next;
        flushSync(() => {
          for (const listener of listeners) listener();
        });
      },
    };
    roots.set(host, entry);
    flushSync(() => root.render(<View />));
  }
  entry.set(node);
}
export function clearReact(host: Element) {
  const entry = roots.get(host);
  if (entry) {
    flushSync(() => entry.root.unmount());
    roots.delete(host);
  } else host.replaceChildren();
}
export function SaveStatus({ adapter }: { adapter: EditorAdapter }) {
  const view = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  return (
    <span data-save-state={view.save.error ? 'error' : view.save.pending ? 'pending' : 'saved'}>
      {view.save.message}
    </span>
  );
}
export function renderSaveStatus(host: Element, adapter: EditorAdapter) {
  renderReact(host, <SaveStatus adapter={adapter} />);
}
