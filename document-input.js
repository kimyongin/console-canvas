import { buildResourceDocument } from './resource-document.js';
import { cleanLayerNames } from './layer-names.js';
import { validateSnapshot, cleanEdits, cleanComments } from './engine.js';
import { expandCopyNodes } from './copy-model.js';
export function validateDocumentInput(snapshot, edits = {}, annotations = {}) {
  validateSnapshot(snapshot);
  cleanLayerNames(snapshot.layerNames);
  for (const value of [edits, annotations])
    if (value != null && (typeof value !== 'object' || Array.isArray(value)))
      throw Error('편집/주석 형식이 올바르지 않습니다.');
  const originals = buildResourceDocument(
    snapshot.html,
    new Map(snapshot.nodes.map((n) => [n.id, n])),
    snapshot.resourceRepairs || [],
  ).nodes;
  const cleaned = cleanEdits(edits, originals),
    nodes = expandCopyNodes(cleaned, originals).nodes;
  cleanComments(annotations, nodes);
}
