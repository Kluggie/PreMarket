import {
  deserializeThreadsFromMetadata,
  serializeThreadsForPersistence,
} from '../document-comparison/suggestionThreads.js';

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function restoreRecipientEditorAiState(editorState) {
  const normalizedEditorState = asObject(editorState);
  const legacyAiState = asObject(
    normalizedEditorState.ai_state || normalizedEditorState.aiState,
  );
  const threadMetadata =
    Array.isArray(normalizedEditorState.suggestionThreads) ||
    normalizedEditorState.activeSuggestionThreadId
      ? normalizedEditorState
      : legacyAiState;
  const restoredThreads = deserializeThreadsFromMetadata(threadMetadata);

  return {
    suggestionThreads: restoredThreads.threads,
    activeSuggestionThreadId: restoredThreads.activeThreadId,
    companyContextName:
      asText(normalizedEditorState.companyContextName) ||
      asText(normalizedEditorState.company_name) ||
      asText(legacyAiState.companyContextName) ||
      asText(legacyAiState.company_name),
    companyContextWebsite:
      asText(normalizedEditorState.companyContextWebsite) ||
      asText(normalizedEditorState.company_website) ||
      asText(legacyAiState.companyContextWebsite) ||
      asText(legacyAiState.company_website),
  };
}

export function buildRecipientEditorStateWithAi({
  activeSuggestionThreadId = null,
  baseEditorState = {},
  companyContextName = '',
  companyContextWebsite = '',
  documents = [],
  step = 0,
  suggestionThreads = [],
}) {
  const normalizedEditorState = asObject(baseEditorState);
  const threadPersistence = serializeThreadsForPersistence(
    suggestionThreads,
    activeSuggestionThreadId,
  );

  return {
    ...normalizedEditorState,
    step,
    mode: 'recipient_document_comparison_v2',
    updated_at: new Date().toISOString(),
    documents,
    suggestionThreads: threadPersistence.suggestionThreads,
    activeSuggestionThreadId: threadPersistence.activeSuggestionThreadId,
    companyContextName: asText(companyContextName),
    companyContextWebsite: asText(companyContextWebsite),
  };
}
