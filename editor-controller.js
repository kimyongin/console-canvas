import { hasCapturedPhoto } from './capture-reference.js';
import { captureAssessment } from './capture-status.js';
import { activityBranch } from './activity-history.js';
import { prepareEdits } from './edit-commands.js';
import { copy } from './engine.js';

// Shared by the browser editor and desktop shell. It operates only on a captured copy.
export function createEditorController(options) {
  const { state } = options;
  const failure = (code, message) => ({
    ok: false,
    error: { code, message },
    revision: state.revision,
  });
  function metadata() {
    if (!state.ready || !state.scene || !state.snapshot) return null;
    return {
      editor_id: options.editorId,
      document_id: state.snapshot.id,
      title: state.snapshot.documentName || state.snapshot.source.title || '가져온 화면',
      url: state.snapshot.source.url,
      revision: state.revision,
      project_id: state.project_id,
      ticket_revision: state.ticketRevision || 0,
      element_count: state.scene.nodes.size,
      comment_count: Object.keys(state.scene.annotations).length,
    };
  }
  function screen() {
    const assessment = captureAssessment(
      state.snapshot,
      state.scene.elements,
      state.scene.resourceRepairs,
    );
    return {
      capture_reference: {
        available: hasCapturedPhoto(state.snapshot),
        kind: 'captured_pixels',
        visual_comparison: 'not_measured',
      },
      capture_scope: state.snapshot.captureScope || { mode: 'document' },
      resource_repairs: (state.scene.resourceRepairs || [])
        .filter((p) => p.type === 'resource')
        .map((p) => ({ url: p.resource_url, embedded: true })),
      capture_status: {
        visual_comparison: 'not_measured',
        issue_count: assessment.items.length,
        counts: assessment.counts,
        remaining_counts: assessment.remaining_counts,
        repaired_count: assessment.repaired_count,
        applied_resource_count: assessment.applied_resource_count,
        issues: assessment.items.slice(0, 200).map(({ actionable, ...item }) => item),
        issues_truncated: assessment.items.length > 200,
      },
      ...metadata(),
      undo_count: state.undo.length,
      redo_count: state.redo.length,
      change_count: state.scene.changes().length,
      busy: !!state.scene.drag || !!state.scene.areaSelecting || !!options.isBusy?.(),
      last_action: state.lastAction || null,
    };
  }
  function nodeInfo(node) {
    const scene = state.scene,
      deleted = scene.hidden(node.id),
      offset = scene.offset(node.id),
      current = (!deleted && scene.rect(node.id)) || {
        ...node.rect,
        x: node.rect.x + offset.x,
        y: node.rect.y + offset.y,
      };
    return {
      id: node.id,
      name: node.name,
      ...(state.snapshot.layerNames?.[node.id]
        ? { alias: state.snapshot.layerNames[node.id] }
        : {}),
      tag: node.tag,
      kind: node.kind,
      parent_id: node.parentId,
      ...(node.copiedFrom ? { copied_from: node.copiedFrom } : {}),
      locator: node.locator,
      ...(node.frame ? { frame: node.frame } : {}),
      ...(node.image
        ? {
            image: {
              mode: node.image.mode,
              source_broken: !!node.image.broken,
              url: /^https?:/.test(node.image.url) ? node.image.url : null,
              coverage: scene.elements.get(node.id)?.dataset.uicImageCoverage || null,
              rendering: scene.elements.get(node.id)?.dataset.uicImageRendering || null,
            },
          }
        : {}),
      ...(node.rasterReason ? { raster_reason: node.rasterReason } : {}),
      ...(node.background
        ? {
            background_image: {
              mode: node.background.mode,
              coverage: scene.elements.get(node.id)?.dataset.uicBackgroundCoverage || null,
            },
          }
        : {}),
      captured_visible: node.visible,
      deleted,
      original_rect: node.rect,
      current_rect: current,
      offset: scene.edits[node.id]
        ? {
            dx: scene.edits[node.id].dx || 0,
            dy: scene.edits[node.id].dy || 0,
            deleted: !!scene.edits[node.id].deleted,
          }
        : {},
      comment: scene.annotations[node.id] || '',
    };
  }
  async function execute(command) {
    const scene = state.scene,
      meta = metadata(),
      args = command.arguments || {};
    if (!meta) return failure('not_ready', '화면을 가져온 뒤 다시 요청해 주세요.');
    if (command.document_id !== meta.document_id || args.editor_id !== options.editorId)
      return failure('wrong_document', '대상 화면이 바뀌었습니다. 화면 목록을 다시 조회해 주세요.');
    if (Date.now() > command.deadline * 1000)
      return failure('expired', '명령이 만료되어 적용하지 않았습니다.');
    const name = command.name;
    if (name === 'get_screen') return { ok: true, screen: screen() };
    if (name === 'list_elements') {
      const query = (args.query || '').toLowerCase(),
        offset = args.offset || 0,
        limit = args.limit || 50;
      const matches = [...scene.nodes.values()].filter(
        (node) =>
          (!args.parent_id || node.parentId === args.parent_id) &&
          (!query ||
            (
              node.id +
              ' ' +
              node.name +
              ' ' +
              (state.snapshot.layerNames?.[node.id] || '') +
              ' ' +
              node.tag +
              ' ' +
              JSON.stringify(node.locator)
            )
              .toLowerCase()
              .includes(query)),
      );
      return {
        ok: true,
        revision: state.revision,
        total: matches.length,
        offset,
        elements: matches.slice(offset, offset + limit).map(nodeInfo),
      };
    }
    if (name === 'list_comments') {
      const comments = scene
          .comments()
          .map((comment, index) => ({ ...comment, number: index + 1 }))
          .filter((c) => !args.element_id || c.id === args.element_id),
        offset = args.offset || 0,
        limit = args.limit || 50;
      return {
        ok: true,
        revision: state.revision,
        total: comments.length,
        offset,
        comments: comments.slice(offset, offset + limit),
      };
    }
    if (name === 'list_history') {
      const events = activityBranch(state, args.scope === 'all'),
        offset = args.offset || 0,
        limit = args.limit || 50;
      return {
        ok: true,
        revision: state.revision,
        active_head: state.activityHead || null,
        total: events.length,
        offset,
        events: events.slice(offset, offset + limit),
      };
    }
    if (['get_design_context', 'get_review_image'].includes(name)) {
      if (screen().busy) return failure('editor_busy', '편집을 마친 뒤 다시 요청해 주세요.');
      const revision = state.revision,
        documentId = state.snapshot.id;
      try {
        if (name === 'get_design_context') {
          const context = await options.buildDesignContext();
          if (state.revision !== revision || state.snapshot.id !== documentId)
            return failure('revision_conflict', '이미지 생성 중 편집이 바뀌었습니다.');
          return { ok: true, revision, source: state.snapshot.source, ...context };
        }
        const result = await options.buildHandoffImage();
        if (state.revision !== revision || state.snapshot.id !== documentId)
          return failure('revision_conflict', '이미지를 만드는 동안 편집이 바뀌었습니다.');
        if (result.blob.size > 20 * 1024 * 1024)
          return failure('image_error', '이미지 전송 한도를 넘었습니다.');
        const data_url = await new Promise((ok, no) => {
          const r = new FileReader();
          r.onload = () => ok(r.result);
          r.onerror = no;
          r.readAsDataURL(result.blob);
        });
        if (state.revision !== revision || state.snapshot.id !== documentId)
          return failure('revision_conflict', '이미지 생성 중 편집이 바뀌었습니다.');
        return {
          ok: true,
          revision,
          mime_type: 'image/png',
          data_url,
          width: result.width,
          height: result.height,
        };
      } catch (e) {
        return failure('image_error', e.message);
      }
    }
    if (!['apply_edits', 'undo', 'redo'].includes(name))
      return failure('unknown_tool', '지원하지 않는 명령입니다.');
    if (args.expected_revision !== state.revision)
      return failure(
        'revision_conflict',
        '화면이 변경되었습니다. 최신 상태를 조회한 뒤 수정해 주세요.',
      );
    if (scene.drag || scene.areaSelecting || options.isBusy?.())
      return failure(
        'editor_busy',
        '사용자가 편집 중입니다. 입력을 마친 후 최신 버전으로 다시 요청해 주세요.',
      );
    if (name === 'undo' || name === 'redo') {
      if (!state[name].length)
        return failure(
          'nothing_to_' + name,
          '실행 ' + (name === 'undo' ? '취소' : '복원') + '할 작업이 없습니다.',
        );
      options.undo(name, { actor: 'agent' });
    } else {
      const operations = args.operations;
      let next;
      try {
        next = prepareEdits(
          { edits: scene.edits, annotations: scene.annotations },
          operations,
          scene.elements,
        );
      } catch (error) {
        return failure(error.code || 'invalid_operation', error.message);
      }
      const { edits, annotations } = next;
      if (!next.changed) return { ok: true, unchanged: true, screen: screen() };
      const previous = options.checkpoint(),
        redo = state.redo;
      options.historyBefore();
      state.commentTarget = null;
      try {
        scene.setEdits(edits);
        scene.setComments(annotations);
        scene.select(operations[operations.length - 1].element_id);
        options.changeCommitted({ actor: 'agent', label: operations.length + '개 변경 적용' });
      } catch (error) {
        state.undo.pop();
        state.redo = redo;
        scene.setEdits(previous.edits);
        scene.setComments(previous.annotations);
        scene.select(previous.selected, {
          ids: previous.selection || (previous.selected ? [previous.selected] : []),
        });
        options.render?.();
        return failure('apply_failed', error.message);
      }
    }
    const result = { ok: true, screen: screen() };
    if (options.flush) {
      try {
        result.persisted = await options.flush();
      } catch (error) {
        result.persisted = false;
        result.save_error = error.message;
      }
    }
    return result;
  }
  return { metadata, execute, state };
}
