// Build once for a validated capture; editing changes offsets, never this hierarchy.
export function indexNodes(nodes) {
  const children = new Map(),
    descendantCounts = new Map();
  for (const node of nodes) {
    const parent = node.parentId || null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(node);
  }
  const stack = (children.get(null) || []).map((node) => [node, false]);
  while (stack.length) {
    const [node, visited] = stack.pop(),
      descendants = children.get(node.id) || [];
    if (!visited) {
      stack.push([node, true]);
      for (const child of descendants) stack.push([child, false]);
    } else
      descendantCounts.set(
        node.id,
        descendants.reduce((sum, child) => sum + 1 + descendantCounts.get(child.id), 0),
      );
  }
  return { children, descendantCounts };
}
