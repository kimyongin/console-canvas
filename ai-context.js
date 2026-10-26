import { renderPng } from './export.js';
import { withVersionScene } from './ui/version-preview.js';
export function buildAiContext(snapshot, point, { full = false, image = false } = {}) {
  return withVersionScene(snapshot, point, async (scene) => {
    const selected = point.selection?.filter((id) => scene.elements.has(id)) || [];
    const roots = full ? [] : [...new Set(selected.map((id) => scene.parent(id) || id))];
    const detached = selected.filter(
      (id) => !roots.some((root) => scene.elements.get(root)?.contains(scene.elements.get(id))),
    );
    const html = roots.length
      ? [...roots, ...detached].map((id) => scene.elements.get(id)?.outerHTML || '').join('\n')
      : scene.serialize();
    const styles = [...scene.doc.head.querySelectorAll('style')]
      .map((el) => el.textContent)
      .join('\n');
    const image_url = image ? await imageUrl(scene) : undefined;
    return {
      ...(image_url ? { image_url } : {}),
      html,
      styles,
      scope: roots.length ? 'selected_elements_and_parents' : 'full_screen',
      selection: selected,
      annotations: point.annotations,
      note: point.note,
      elements: [...scene.nodes.values()]
        .filter(
          (node) =>
            !roots.length ||
            roots.includes(node.id) ||
            scene.ancestors(node.id).some((id) => roots.includes(id)),
        )
        .map((node) => ({
          id: node.id,
          parent_id: node.parentId,
          name: node.name,
          locator: node.locator,
          generated: !!node.generated,
          deleted: scene.hidden(node.id),
        })),
    };
  });
}

async function imageUrl(scene) {
  const size = scene.contentSize();
  const blob = await renderPng(scene.serialize(), size.width, size.height);
  if (blob.size > 15_000_000) throw new Error('AI 입력 이미지가 너무 큽니다.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('AI 입력 이미지를 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
}
