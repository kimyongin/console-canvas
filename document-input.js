import { cleanImplementationReviews } from './workflow-state.js';
import { validateAiRequests } from './ai-requests.js';
import { buildCodeDocument } from './code-patches.js';
import { cleanLayerNames } from './layer-names.js';
import { validateSnapshot, cleanEdits, cleanComments } from './engine.js';
import { expandCopyNodes } from './copy-model.js';
import { createSnapshotHistory } from './snapshot-history.js';

// Validate the whole portable document before flushing or replacing the active editor.
export function validateDocumentInput(snapshot, edits, annotations, timeline) {
  validateSnapshot(snapshot);
  cleanLayerNames(snapshot.layerNames);
  validateAiRequests(snapshot.aiRequests, snapshot);
  cleanImplementationReviews(snapshot.implementationReviews, snapshot);
  for (const value of [edits, annotations])
    if (value != null && (typeof value !== 'object' || Array.isArray(value)))
      throw new Error('편집/주석 형식이 올바르지 않습니다.');
  if (snapshot.activity != null && !Array.isArray(snapshot.activity))
    throw new Error('변경 이력 형식이 올바르지 않습니다.');
  const events = new Set();
  for (const event of snapshot.activity || []) {
    if (
      !event ||
      typeof event.id !== 'string' ||
      !event.id ||
      events.has(event.id) ||
      typeof event.label !== 'string' ||
      !Number.isFinite(Date.parse(event.created_at)) ||
      !Array.isArray(event.changes) ||
      event.changes.some(
        (change) =>
          !change ||
          typeof change.type !== 'string' ||
          typeof change.name !== 'string' ||
          (change.id != null && typeof change.id !== 'string'),
      )
    )
      throw new Error('변경 이력 정보가 올바르지 않습니다.');
    events.add(event.id);
  }
  const captureNodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const originals = buildCodeDocument(
    snapshot.html,
    captureNodes,
    snapshot.codePatches || [],
  ).nodes;
  const cleaned = cleanEdits(edits, originals);
  const nodes = expandCopyNodes(cleaned, originals).nodes;
  const point = { edits: cleaned, annotations: cleanComments(annotations, nodes) };
  const temporary = { snapshot, scene: { nodes, captureNodes }, timeline: null };
  createSnapshotHistory({ state: temporary, checkpoint: () => point }).initialise(timeline);
}
