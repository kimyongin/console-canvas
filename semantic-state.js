// Only design intent invalidates a confirmation. View/selection/history metadata does not.
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, ordered(value[key])]),
    );
  return value;
}
export function semanticState(value = {}) {
  return JSON.stringify(
    ordered({
      edits: value.edits || {},
      annotations: value.annotations || {},
      note: value.note || '',
      resourceRepairs: value.resourceRepairs || [],
    }),
  );
}
