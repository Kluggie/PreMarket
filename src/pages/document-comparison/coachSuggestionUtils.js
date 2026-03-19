const DIFF_CONTEXT_CHARS = 220;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenizeWords(value) {
  return String(value || '')
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
}

export function applySuggestedTextChange({ currentText, op, nextText, headingHint, selectedText }) {
  const base = String(currentText || '');
  const incoming = String(nextText || '').trim();
  if (!incoming) {
    return base;
  }

  if (op === 'append') {
    return base.trim() ? `${base.trim()}\n\n${incoming}` : incoming;
  }

  if (op === 'replace_selection') {
    const selection = String(selectedText || '').trim();
    if (selection && base.includes(selection)) {
      return base.replace(selection, incoming);
    }
    return base.trim() ? `${base.trim()}\n\n${incoming}` : incoming;
  }

  if (op === 'insert_after_heading') {
    const hint = String(headingHint || '').trim();
    if (!hint) {
      return base.trim() ? `${base.trim()}\n\n${incoming}` : incoming;
    }
    const lines = base.split('\n');
    const index = lines.findIndex((line) => line.toLowerCase().includes(hint.toLowerCase()));
    if (index < 0) {
      return base.trim() ? `${base.trim()}\n\n${incoming}` : incoming;
    }
    const nextLines = [...lines.slice(0, index + 1), '', incoming, ...lines.slice(index + 1)];
    return nextLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  if (op === 'replace_section') {
    const hint = String(headingHint || '').trim();
    if (!hint) {
      return incoming;
    }
    const pattern = new RegExp(`${escapeRegExp(hint)}[\\s\\S]*?(?=\\n\\n[^\\n]+:|$)`, 'i');
    if (pattern.test(base)) {
      return base.replace(pattern, `${hint}\n${incoming}`).trim();
    }
    return base.trim() ? `${base.trim()}\n\n${incoming}` : incoming;
  }

  return base.trim() ? `${base.trim()}\n\n${incoming}` : incoming;
}

export function buildDiffPreview(beforeText, afterText) {
  const before = String(beforeText || '');
  const after = String(afterText || '');
  if (before === after) {
    const snippet = before.length > 0 ? before.slice(0, DIFF_CONTEXT_CHARS * 2) : '(No content)';
    return {
      beforeHtml: escapeHtml(snippet),
      afterHtml: escapeHtml(snippet),
    };
  }

  let prefixLength = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefixLength < maxPrefix && before[prefixLength] === after[prefixLength]) {
    prefixLength += 1;
  }

  let beforeSuffixStart = before.length;
  let afterSuffixStart = after.length;
  while (
    beforeSuffixStart > prefixLength &&
    afterSuffixStart > prefixLength &&
    before[beforeSuffixStart - 1] === after[afterSuffixStart - 1]
  ) {
    beforeSuffixStart -= 1;
    afterSuffixStart -= 1;
  }

  const sliceStart = Math.max(0, prefixLength - DIFF_CONTEXT_CHARS);
  const beforeSliceEnd = Math.min(before.length, beforeSuffixStart + DIFF_CONTEXT_CHARS);
  const afterSliceEnd = Math.min(after.length, afterSuffixStart + DIFF_CONTEXT_CHARS);
  const leadingEllipsis = sliceStart > 0 ? '...' : '';
  const trailingEllipsis =
    beforeSliceEnd < before.length || afterSliceEnd < after.length ? '...' : '';

  const prefixContext = before.slice(sliceStart, prefixLength);
  const removedText = before.slice(prefixLength, beforeSuffixStart);
  const addedText = after.slice(prefixLength, afterSuffixStart);
  const suffixContext = before.slice(beforeSuffixStart, beforeSliceEnd);

  return {
    beforeHtml:
      `${leadingEllipsis}${escapeHtml(prefixContext)}` +
      `${removedText ? `<span class="bg-rose-100 text-rose-800 line-through rounded-sm px-0.5">${escapeHtml(removedText)}</span>` : ''}` +
      `${escapeHtml(suffixContext)}${trailingEllipsis}`,
    afterHtml:
      `${leadingEllipsis}${escapeHtml(prefixContext)}` +
      `${addedText ? `<span class="bg-emerald-100 text-emerald-800 rounded-sm px-0.5">${escapeHtml(addedText)}</span>` : ''}` +
      `${escapeHtml(suffixContext)}${trailingEllipsis}`,
  };
}

export function getSuggestionChangeSummary(op, headingHint) {
  if (op === 'append') {
    return 'This will append text at the end of the target document.';
  }
  if (op === 'replace_selection') {
    return 'This will replace the current selected text if found, otherwise append the proposal.';
  }
  if (op === 'insert_after_heading') {
    return headingHint
      ? `This will insert text after heading "${headingHint}".`
      : 'This will insert text after a heading when available, otherwise append.';
  }
  if (op === 'replace_section') {
    return headingHint
      ? `This will replace the section matching "${headingHint}" when found.`
      : 'This will replace a section when detected, otherwise append.';
  }
  return 'This will apply the proposed text change to the target document.';
}

export function getNormalizedSuggestionId(suggestion, fallbackIndex = -1) {
  const explicitId = String(suggestion?.id || '').trim();
  if (explicitId) {
    return explicitId;
  }
  const title = String(suggestion?.title || '').trim();
  const target = String(suggestion?.proposed_change?.target || '').trim();
  const text = String(suggestion?.proposed_change?.text || '').trim().slice(0, 32);
  const seed = [title, target, text, fallbackIndex >= 0 ? String(fallbackIndex) : ''].join('|');
  return seed || `suggestion-${fallbackIndex >= 0 ? fallbackIndex : 'unknown'}`;
}

export function buildWordDiffPreview(beforeText, afterText) {
  const beforeWords = tokenizeWords(beforeText);
  const afterWords = tokenizeWords(afterText);
  if (!beforeWords.length && !afterWords.length) {
    return {
      beforeHtml: '(No content)',
      afterHtml: '(No content)',
    };
  }

  const dp = Array.from({ length: beforeWords.length + 1 }, () =>
    Array.from({ length: afterWords.length + 1 }, () => 0),
  );
  for (let i = beforeWords.length - 1; i >= 0; i -= 1) {
    for (let j = afterWords.length - 1; j >= 0; j -= 1) {
      if (beforeWords[i] === afterWords[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const beforeParts = [];
  const afterParts = [];
  let i = 0;
  let j = 0;
  while (i < beforeWords.length && j < afterWords.length) {
    if (beforeWords[i] === afterWords[j]) {
      const safe = escapeHtml(beforeWords[i]);
      beforeParts.push(safe);
      afterParts.push(safe);
      i += 1;
      j += 1;
      continue;
    }

    if (dp[i + 1][j] >= dp[i][j + 1]) {
      beforeParts.push(`<span class="bg-rose-100 text-rose-800 line-through rounded-sm px-0.5">${escapeHtml(beforeWords[i])}</span>`);
      i += 1;
    } else {
      afterParts.push(`<span class="bg-emerald-100 text-emerald-800 rounded-sm px-0.5">${escapeHtml(afterWords[j])}</span>`);
      j += 1;
    }
  }

  while (i < beforeWords.length) {
    beforeParts.push(`<span class="bg-rose-100 text-rose-800 line-through rounded-sm px-0.5">${escapeHtml(beforeWords[i])}</span>`);
    i += 1;
  }
  while (j < afterWords.length) {
    afterParts.push(`<span class="bg-emerald-100 text-emerald-800 rounded-sm px-0.5">${escapeHtml(afterWords[j])}</span>`);
    j += 1;
  }

  return {
    beforeHtml: beforeParts.join(' '),
    afterHtml: afterParts.join(' '),
  };
}

export function getSuggestionCategoryLabel(category) {
  const normalized = String(category || '').trim().toLowerCase();
  if (normalized === 'negotiation') {
    return 'Negotiation';
  }
  if (normalized === 'risk') {
    return 'Risk';
  }
  if (normalized === 'wording') {
    return 'Wording';
  }
  return '';
}
