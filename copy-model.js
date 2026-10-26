// Copies reference sanitized capture nodes; clipboard/file input can never introduce HTML.
export function expandCopyNodes(value, originals) {
  const nodes = new Map(originals),
    copies = {};
  for (const [id, edit] of Object.entries(value || {})) {
    if (!edit?.copy) continue;
    const records = edit.copy.nodes;
    if (
      originals.has(id) ||
      !/^n\d+$/.test(id) ||
      !Array.isArray(records) ||
      !records.length ||
      records.length > 5000 ||
      nodes.size + records.length > 40000
    )
      throw new Error('복제 요소 정보가 올바르지 않습니다.');
    const mapped = new Map(),
      cleaned = [];
    for (const [index, record] of records.entries()) {
      const source = originals.get(record?.sourceId),
        r = record?.rect;
      if (
        !source ||
        !/^n\d+$/.test(record.id) ||
        nodes.has(record.id) ||
        mapped.has(record.sourceId) ||
        !r ||
        !['x', 'y', 'width', 'height'].every(
          (k) => Number.isFinite(r[k]) && Math.abs(r[k]) <= 1000000,
        ) ||
        r.width < 0 ||
        r.height < 0 ||
        (index === 0
          ? record.id !== id || record.parentId !== null
          : !mapped.has(source.parentId) || record.parentId !== mapped.get(source.parentId))
      )
        throw new Error('복제 요소의 구조나 좌표가 올바르지 않습니다.');
      const clean = {
        id: record.id,
        sourceId: source.id,
        parentId: record.parentId,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        hidden: record.hidden === true,
      };
      mapped.set(source.id, record.id);
      cleaned.push(clean);
      nodes.set(record.id, {
        ...source,
        id: record.id,
        parentId: record.parentId,
        rect: clean.rect,
        copiedFrom: source.id,
        codeDeleted: false,
        copyRoot: id,
        copyHidden: clean.hidden,
      });
    }
    copies[id] = { nodes: cleaned };
  }
  return { nodes, copies };
}
