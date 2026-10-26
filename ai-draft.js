// Only non-secret composition fields may enter document persistence.
export function cleanAiDraft(value) {
  return {
    prompt: typeof value?.prompt === 'string' ? value.prompt.slice(0, 8000) : '',
    count:
      Number.isInteger(value?.count) && value.count >= 1 && value.count <= 12 ? value.count : 3,
    route: value?.route === 'api' ? 'api' : 'mcp',
  };
}
