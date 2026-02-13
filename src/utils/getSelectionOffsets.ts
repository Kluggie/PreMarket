export function getSelectionOffsets(containerEl: HTMLElement, range: Range): { start: number; end: number } | null {
  if (!containerEl || !range) return null;
  if (!containerEl.contains(range.commonAncestorContainer)) return null;

  const preStart = range.cloneRange();
  preStart.selectNodeContents(containerEl);
  preStart.setEnd(range.startContainer, range.startOffset);
  const start = preStart.toString().length;

  const preEnd = range.cloneRange();
  preEnd.selectNodeContents(containerEl);
  preEnd.setEnd(range.endContainer, range.endOffset);
  const end = preEnd.toString().length;

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}
