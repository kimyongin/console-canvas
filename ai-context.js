import { renderPng } from './export.js';
import { withVersionScene } from './ui/version-preview.js';
import { layoutContext } from './ai-layout-context.js';
import { AI_IMAGE_LIMIT, aiInputError, validateAiInput } from './ai-input-policy.js';
export function buildAiContext(
  snapshot,
  point,
  { full = false, image = false, compact = false } = {},
) {
  return withVersionScene(snapshot, point, async (scene) => {
    const selected = point.selection?.filter((id) => scene.elements.has(id)) || [];
    const roots = full ? [] : [...new Set(selected.map((id) => scene.parent(id) || id))];
    const detached = selected.filter(
      (id) => !roots.some((root) => scene.elements.get(root)?.contains(scene.elements.get(id))),
    );
    let html = roots.length
      ? [...roots, ...detached].map((id) => scene.elements.get(id)?.outerHTML || '').join('\n')
      : scene.serialize();
    let styles = [...scene.doc.head.querySelectorAll('style')]
      .map((el) => el.textContent)
      .join('\n');
    let outline;
    if (compact && html.length + styles.length > 1_000_000) {
      outline = layoutContext(
        scene,
        roots.length
          ? [...roots, ...detached].map((id) => scene.elements.get(id)).filter(Boolean)
          : [scene.doc.body],
        selected,
      );
      html = outline.html;
      styles = styles.replace(/data:[^\s"'<>)]*/g, '[embedded asset]');
    }
    const context = {
      html,
      styles,
      ...(outline ? { representation: outline.representation } : {}),
      scope: roots.length ? 'selected_elements_and_parents' : 'full_screen',
      selection: selected,
      annotations: point.annotations,
      note: point.note,
      elements: [...scene.nodes.values()]
        .filter((node) =>
          outline
            ? outline.included.has(node.id)
            : !roots.length ||
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
    if (compact) validateAiInput(context);
    if (image) context.image_url = await imageUrl(scene);
    return context;
  });
}

async function imageUrl(scene) {
  const size = scene.contentSize();
  const blob = await renderPng(scene.serialize(), size.width, size.height);
  if (blob.size > AI_IMAGE_LIMIT) throw aiInputError('input_image_too_large');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('AI 입력 이미지를 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
}
