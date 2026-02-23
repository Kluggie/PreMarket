export function isTipTapDocJson(value) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    String(value.type || '').trim().toLowerCase() === 'doc' &&
    Array.isArray(value.content)
  );
}

export function normalizeEditorContent(value) {
  if (isTipTapDocJson(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  return '<p></p>';
}
