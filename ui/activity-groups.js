// Display grouping only: never merge persisted events or undo checkpoints.
export function activityGroups(entries) {
  const groups = [];
  const movable = (e) =>
    ['요소 이동', '속성 변경'].includes(e.label) &&
    e.changes.length === 1 &&
    ['move', 'property'].includes(e.changes[0].type);
  for (const event of entries) {
    const group = groups.at(-1),
      previous = group?.at(-1);
    if (
      previous &&
      movable(event) &&
      movable(previous) &&
      previous.parent_id === event.id &&
      previous.snapshot_id === event.snapshot_id &&
      previous.actor === event.actor &&
      previous.changes[0].id === event.changes[0].id &&
      previous.changes[0].type === event.changes[0].type &&
      Date.parse(previous.created_at) >= Date.parse(event.created_at) &&
      Date.parse(previous.created_at) - Date.parse(event.created_at) <= 60000
    )
      group.push(event);
    else groups.push([event]);
  }
  return groups;
}
