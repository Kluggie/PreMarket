export const DOCUMENT_COMPARISON_COACH_ACTIONS = [
  {
    id: 'improve_shared',
    label: 'Improve Shared Writing',
    mode: 'shared_only',
    intent: 'improve_shared',
  },
  {
    id: 'negotiate_full',
    label: 'Negotiation Strategy',
    mode: 'full',
    intent: 'negotiate',
  },
  {
    id: 'risks_full',
    label: 'Risks & Gaps',
    mode: 'full',
    intent: 'risks',
  },
  {
    id: 'general_full',
    label: 'General Improvements',
    mode: 'full',
    intent: 'general',
  },
];

export function canRunRewriteSelection(selectionContext) {
  const text = String(selectionContext?.text || '').trim();
  const from = Number(selectionContext?.range?.from || 0);
  const to = Number(selectionContext?.range?.to || 0);
  return Boolean(text && Number.isFinite(from) && Number.isFinite(to) && to > from);
}

export function buildCoachActionRequest(action, selectionContext) {
  if (!action || typeof action !== 'object') {
    return null;
  }

  const mode = String(action.mode || '').trim();
  const intent = String(action.intent || '').trim();
  if (!mode || !intent) {
    return null;
  }

  return {
    mode,
    intent,
    selectionText:
      canRunRewriteSelection(selectionContext) && intent === 'rewrite_selection'
        ? String(selectionContext.text || '').trim()
        : undefined,
    selectionTarget:
      canRunRewriteSelection(selectionContext) && intent === 'rewrite_selection'
        ? selectionContext.side === 'a'
          ? 'confidential'
          : 'shared'
        : undefined,
    selectionRange:
      canRunRewriteSelection(selectionContext) && intent === 'rewrite_selection'
        ? {
            from: Number(selectionContext.range.from),
            to: Number(selectionContext.range.to),
          }
        : undefined,
  };
}

