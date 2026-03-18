import { buildComparisonDraftSavePayload } from './draftPayload';
import {
  compileBundles,
  serializeDocumentsSession,
  VISIBILITY_CONFIDENTIAL,
  VISIBILITY_SHARED,
} from './documentsModel';

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDocuments(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((doc) => doc && typeof doc === 'object')
    .map((doc, index) => ({
      id: asText(doc.id) || `guest_doc_${index + 1}`,
      title: asText(doc.title) || 'Untitled Document',
      visibility:
        asText(doc.visibility) === VISIBILITY_CONFIDENTIAL
          ? VISIBILITY_CONFIDENTIAL
          : asText(doc.visibility) === VISIBILITY_SHARED
            ? VISIBILITY_SHARED
            : VISIBILITY_SHARED,
      text: String(doc.text || ''),
      html: asText(doc.html) || '<p></p>',
      json: doc.json || null,
      source: asText(doc.source) || 'typed',
      files: Array.isArray(doc.files) ? doc.files : [],
      importStatus: asText(doc.importStatus) || 'idle',
      importError: asText(doc.importError) || '',
    }));
}

function buildGuestSuggestionMetadata(draft) {
  const aiState =
    draft?.aiState && typeof draft.aiState === 'object' && !Array.isArray(draft.aiState)
      ? draft.aiState
      : {};
  const suggestionThreads = Array.isArray(aiState.suggestionThreads)
    ? aiState.suggestionThreads
    : [];
  const activeSuggestionThreadId = asText(aiState.activeSuggestionThreadId) || null;

  return {
    ...(suggestionThreads.length > 0 ? { suggestionThreads } : {}),
    ...(activeSuggestionThreadId ? { activeSuggestionThreadId } : {}),
  };
}

export function buildGuestComparisonMigrationPayload(
  draft,
  {
    sanitizeHtml = (value) => String(value || ''),
    partyALabel = 'Confidential Information',
    partyBLabel = 'Shared Information',
  } = {},
) {
  const normalizedDraft =
    draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {};
  const documents = normalizeDocuments(normalizedDraft.documents);
  const { confidential, shared } = compileBundles(documents);
  const metadata = buildGuestSuggestionMetadata(normalizedDraft);
  const confidentialDocs = documents.filter((doc) => doc.visibility === VISIBILITY_CONFIDENTIAL);
  const sharedDocs = documents.filter((doc) => doc.visibility === VISIBILITY_SHARED);

  return buildComparisonDraftSavePayload({
    snapshot: {
      title: asText(normalizedDraft.title) || 'Untitled',
      docAText: confidential.text,
      docAHtml: confidential.html,
      docAJson: confidential.json,
      docASource: confidential.source,
      docAFiles: confidential.files,
      docBText: shared.text,
      docBHtml: shared.html,
      docBJson: shared.json,
      docBSource: shared.source,
      docBFiles: shared.files,
    },
    fallback: {
      title: asText(normalizedDraft.title) || 'Untitled',
      docAText: confidential.text,
      docAHtml: confidential.html,
      docAJson: confidential.json,
      docASource: confidential.source,
      docAFiles: confidential.files,
      docBText: shared.text,
      docBHtml: shared.html,
      docBJson: shared.json,
      docBSource: shared.source,
      docBFiles: shared.files,
    },
    stepToSave: Number(normalizedDraft.step || 1),
    metadata,
    recipientName: asText(normalizedDraft.recipientName) || null,
    recipientEmail: asText(normalizedDraft.recipientEmail) || null,
    docATitle: confidentialDocs.length === 1 ? confidentialDocs[0]?.title || null : null,
    docBTitle: sharedDocs.length === 1 ? sharedDocs[0]?.title || null : null,
    documentsSession: serializeDocumentsSession(documents),
    sanitizeHtml,
    partyALabel,
    partyBLabel,
  });
}

export function buildGuestComparisonMigrationOverlay(draft, comparisonId) {
  const normalizedDraft =
    draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {};
  const guestEvaluationPreview =
    normalizedDraft?.guestEvaluationPreview &&
    typeof normalizedDraft.guestEvaluationPreview === 'object' &&
    !Array.isArray(normalizedDraft.guestEvaluationPreview)
      ? normalizedDraft.guestEvaluationPreview
      : null;

  if (!guestEvaluationPreview || !asText(comparisonId)) {
    return null;
  }

  return {
    comparisonId: asText(comparisonId),
    step: Number(normalizedDraft.step || 3),
    savedAt: Date.now(),
    guestEvaluationPreview,
  };
}
