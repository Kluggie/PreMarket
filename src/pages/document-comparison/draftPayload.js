function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function htmlToText(value) {
  return String(value || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, '')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function textToHtml(value) {
  const normalized = String(value || '').replace(/\r/g, '').trim();
  if (!normalized) {
    return '<p></p>';
  }

  const escapeHtml = (text) =>
    String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const paragraphs = normalized.split(/\n{2,}/g).filter(Boolean);
  if (!paragraphs.length) {
    return '<p></p>';
  }

  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

export function buildComparisonDraftSavePayload({
  snapshot = {},
  fallback = {},
  stepToSave = 1,
  linkedProposalId = '',
  routeProposalId = '',
  token = '',
  partyALabel = 'Confidential Information',
  partyBLabel = 'Shared Information',
  metadata = {},
  docASpans = [],
  docBSpans = [],
  recipientName = null,
  recipientEmail = null,
  docATitle = null,
  docBTitle = null,
  documentsSession = null,
  sanitizeHtml = (value) => String(value || ''),
}) {
  const nextTitle = asText(snapshot.title || fallback.title) || 'Untitled';
  const nextDocAText = String(snapshot.docAText || fallback.docAText || '');
  const nextDocBText = String(snapshot.docBText || fallback.docBText || '');
  const nextDocAHtml =
    snapshot.docAHtml || fallback.docAHtml || textToHtml(nextDocAText);
  const nextDocBHtml =
    snapshot.docBHtml || fallback.docBHtml || textToHtml(nextDocBText);
  const sanitizedDocAHtml = sanitizeHtml(nextDocAHtml);
  const sanitizedDocBHtml = sanitizeHtml(nextDocBHtml);
  const normalizedDocAText = nextDocAText || htmlToText(sanitizedDocAHtml);
  const normalizedDocBText = nextDocBText || htmlToText(sanitizedDocBHtml);

  const payload = {
    title: nextTitle,
    party_a_label: partyALabel,
    party_b_label: partyBLabel,
    doc_a_text: normalizedDocAText,
    doc_b_text: normalizedDocBText,
    doc_a_html: sanitizedDocAHtml,
    doc_b_html: sanitizedDocBHtml,
    doc_a_json: snapshot.docAJson || fallback.docAJson || null,
    doc_b_json: snapshot.docBJson || fallback.docBJson || null,
    doc_a_source: asText(snapshot.docASource || fallback.docASource) || 'typed',
    doc_b_source: asText(snapshot.docBSource || fallback.docBSource) || 'typed',
    doc_a_files: Array.isArray(snapshot.docAFiles) ? snapshot.docAFiles : fallback.docAFiles || [],
    doc_b_files: Array.isArray(snapshot.docBFiles) ? snapshot.docBFiles : fallback.docBFiles || [],
    doc_a_spans: Array.isArray(docASpans) ? docASpans : [],
    doc_b_spans: Array.isArray(docBSpans) ? docBSpans : [],
    metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
    draft_step: Number(stepToSave || 1),
    proposalId: linkedProposalId || routeProposalId || null,
    createProposal: !(linkedProposalId || routeProposalId),
    recipient_name: recipientName || null,
    recipient_email: recipientEmail ? String(recipientEmail).trim().toLowerCase() : null,
    doc_a_title: docATitle || null,
    doc_b_title: docBTitle || null,
    documents_session: Array.isArray(documentsSession) && documentsSession.length > 0 ? documentsSession : null,
  };

  if (token) {
    payload.token = token;
  }

  return payload;
}
