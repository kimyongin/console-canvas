import { transact } from './db.js';
export function workspaceIdentity() {
  return transact(['settings'], 'readwrite', (tx, done) => {
    const store = tx.objectStore('settings'),
      read = store.get('workspace-identity');
    read.onsuccess = () => {
      const id = read.result?.value || crypto.randomUUID();
      if (!read.result) store.put({ id: 'workspace-identity', value: id });
      done(id);
    };
  });
}
