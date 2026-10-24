// One writer, at most one pending value per document. Flush reports every failed document.
export function createSaveQueue(write, { onSaved = () => {}, onError = () => {} } = {}) {
  const pending = new Map(),
    failures = new Map();
  let running = null;
  async function drain() {
    while (pending.size) {
      const [id, value] = pending.entries().next().value;
      pending.delete(id);
      try {
        await write(id, value);
        failures.delete(id);
        onSaved(id);
      } catch (error) {
        failures.set(id, error);
        onError(error, id);
      }
    }
  }
  function enqueue(id, value) {
    pending.set(id, structuredClone(value));
    if (!running)
      running = Promise.resolve()
        .then(drain)
        .finally(() => {
          running = null;
        });
    return running;
  }
  async function flush() {
    while (running) await running;
    if (failures.size) throw failures.values().next().value;
  }
  return { enqueue, flush };
}
