import { snapshotTree } from './snapshot-tree.js';
// Position by ancestry, never by save order: A→D starts at A even if C was saved first.
export function snapshotGraph(entries) {
  const visible = snapshotTree(entries),
    byId = new Map(visible.map((e) => [e.id, e])),
    children = new Map();
  for (const node of visible) {
    const parent = byId.has(node.parentId) && node.parentId !== node.id ? node.parentId : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(node);
  }
  const nodes = [],
    edges = [],
    seen = new Set();
  let nextLane = 0;
  function visit(node, depth, lane, parent = null) {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    const point = { ...node, depth, lane, x: 58 + depth * 232, y: 86 + lane * 114 };
    nodes.push(point);
    if (parent)
      edges.push({
        parent_id: parent.id,
        child_id: node.id,
        from: { x: parent.x, y: parent.y },
        to: { x: point.x, y: point.y },
      });
    (children.get(node.id) || []).forEach((child, i) =>
      visit(child, depth + 1, i === 0 ? lane : ++nextLane, point),
    );
  }
  (children.get(null) || []).forEach((node, i) => visit(node, 0, i === 0 ? 0 : ++nextLane));
  for (const node of visible) if (!seen.has(node.id)) visit(node, 0, ++nextLane);
  return {
    nodes,
    edges,
    width: Math.max(1260, ...nodes.map((n) => n.x + 190)),
    height: Math.max(170, ...nodes.map((n) => n.y + 45)),
  };
}
