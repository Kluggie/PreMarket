export const COMPANY_CONTEXT_COACH_ACTION = {
  id: 'company_context_full',
  label: 'Company Context',
  mode: 'full',
  intent: 'company_context',
};

export const DOCUMENT_COMPARISON_COACH_ACTIONS = [
  {
    id: 'draft_response_full',
    label: 'Draft Response',
    mode: 'full',
    intent: 'draft_response',
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
    id: 'clarifying_questions_full',
    label: 'Clarifying Questions',
    mode: 'full',
    intent: 'clarifying_questions',
  },
];

export function hasCompanyContextInput(input = {}) {
  return Boolean(
    String(input.companyName || '').trim() ||
      String(input.companyWebsite || '').trim()
  );
}

export function getCompanyContextInputBasis(input = {}) {
  const companyName = String(input.companyName || '').trim();
  const companyWebsite = String(input.companyWebsite || '').trim();

  if (companyName && companyWebsite) {
    return `Based on: website + company name · Website provided: ${companyWebsite}`;
  }
  if (companyWebsite) {
    return `Based on: website only · Website provided: ${companyWebsite}`;
  }
  if (companyName) {
    return 'Based on: company name only';
  }
  return '';
}

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
