// Parent IDs can reference trashed versions. Keep those ancestors visible as
// disabled connectors rather than making descendants appear to have new parents.
export function snapshotTree(entries) {
  const children = new Map(),
    ids = new Set(entries.map((e) => e.id));
  for (const entry of entries) {
    const parent = ids.has(entry.parentId) && entry.parentId !== entry.id ? entry.parentId : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(entry);
  }
  const result = [],
    seen = new Set();
  function visit(entry, depth) {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    result.push({
      ...entry,
      depth,
      created_at: entry.createdAt,
      parent_id: entry.parentId,
      active: false,
      change_count: Object.keys(entry.state?.edits || {}).length,
      comment_count: Object.keys(entry.state?.annotations || {}).length,
    });
    for (const child of children.get(entry.id) || []) visit(child, depth + 1);
  }
  for (const root of children.get(null) || []) visit(root, 0);
  for (const entry of entries) if (!seen.has(entry.id)) visit(entry, 0);
  const byId = new Map(entries.map((e) => [e.id, e])),
    keep = new Set();
  for (const entry of entries.filter((e) => !e.deletedAt)) {
    let id = entry.id;
    const visited = new Set();
    while (byId.has(id) && !visited.has(id)) {
      visited.add(id);
      keep.add(id);
      id = byId.get(id).parentId;
    }
  }
  return result.filter((e) => keep.has(e.id));
}
