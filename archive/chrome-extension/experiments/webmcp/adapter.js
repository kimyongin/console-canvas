// Experimental only: injected into a disposable extension copy by run.mjs.
// No localhost bridge, Native Messaging host, polyfill or production auto-registration.
const status = (window.ConsoleCanvasWebMcpExperiment = { ready: false, tools: [] });
const context = document.modelContext;
if (!context?.registerTool) {
  status.unsupported = true;
} else {
  try {
    const deadline = Date.now() + 20000;
    while (!window.ConsoleCanvas?.controller.metadata()) {
      if (Date.now() > deadline) throw new Error('Editor did not become ready');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const definitions = await fetch('./experiment-tools.json').then((response) => response.json());
    const writes = new Set(['apply_edits', 'undo', 'redo', 'create_snapshot', 'restore_snapshot']);
    const replay = new Map();
    let queue = Promise.resolve();
    const canonical = (value) =>
      JSON.stringify(value, (_key, item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(
              Object.keys(item)
                .sort()
                .map((key) => [key, item[key]]),
            )
          : item,
      );
    async function execute(name, args) {
      const controller = window.ConsoleCanvas.controller;
      const metadata = controller.metadata();
      if (!metadata) return { ok: false, error: { code: 'not_ready' } };
      if (name === 'list_screens') return { ok: true, screens: [metadata] };
      if (args.editor_id !== metadata.editor_id)
        return { ok: false, error: { code: 'wrong_document' } };
      const key = writes.has(name)
        ? canonical([metadata.document_id, args.editor_id, args.operation_id])
        : null;
      const fingerprint = canonical({ name, args });
      if (key && replay.has(key)) {
        const previous = replay.get(key);
        return previous.fingerprint === fingerprint
          ? structuredClone(previous.result)
          : { ok: false, error: { code: 'operation_id_reused' } };
      }
      const result = await controller.execute({
        name,
        document_id: metadata.document_id,
        arguments: args,
        deadline: Date.now() / 1000 + 30,
      });
      if (key) {
        if (replay.size >= 200) replay.delete(replay.keys().next().value);
        replay.set(key, { fingerprint, result: structuredClone(result) });
      }
      return result;
    }
    for (const tool of definitions) {
      const name = 'console_canvas_' + tool.name;
      await context.registerTool({
        name,
        description: 'Console Canvas captured-copy editor. ' + tool.description,
        inputSchema: tool.inputSchema,
        execute(args) {
          const task = queue.catch(() => {}).then(() => execute(tool.name, args));
          queue = task;
          return task;
        },
      });
      status.tools.push(name);
    }
    status.ready = true;
  } catch (error) {
    status.error = error.message;
  }
}
