import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRecipientEditorStateWithAi,
  restoreRecipientEditorAiState,
} from '../../src/pages/shared-report/recipientEditorAiState.js';

function makeThread(id, title, content) {
  return {
    id,
    title,
    createdAt: 1,
    updatedAt: 2,
    entries: [
      {
        role: 'user',
        content: `Prompt for ${title}`,
        promptType: 'custom_prompt',
        timestamp: 3,
      },
      {
        role: 'assistant',
        content,
        coachResultHash: `hash_${id}`,
        timestamp: 4,
      },
    ],
  };
}

test('buildRecipientEditorStateWithAi stores proposer-style suggestion metadata and company context', () => {
  const editorState = buildRecipientEditorStateWithAi({
    baseEditorState: {
      mode: 'recipient_document_comparison_v1',
      untouched: 'keep-me',
    },
    step: 2,
    documents: [{ id: 'doc_1', title: 'Recipient Notes' }],
    suggestionThreads: [makeThread('thread_1', 'Risks', 'Risk response')],
    activeSuggestionThreadId: 'thread_1',
    companyContextName: 'Acme Corp',
    companyContextWebsite: 'https://acme.test',
  });

  assert.equal(editorState.step, 2);
  assert.equal(editorState.mode, 'recipient_document_comparison_v2');
  assert.equal(editorState.untouched, 'keep-me');
  assert.equal(Array.isArray(editorState.documents), true);
  assert.equal(Array.isArray(editorState.suggestionThreads), true);
  assert.equal(editorState.suggestionThreads.length, 1);
  assert.equal(editorState.activeSuggestionThreadId, 'thread_1');
  assert.equal(editorState.companyContextName, 'Acme Corp');
  assert.equal(editorState.companyContextWebsite, 'https://acme.test');
});

test('restoreRecipientEditorAiState reads top-level recipient thread metadata', () => {
  const restored = restoreRecipientEditorAiState({
    suggestionThreads: [makeThread('thread_top', 'Negotiation', 'Top-level reply')],
    activeSuggestionThreadId: 'thread_top',
    companyContextName: 'Top Level Co',
    companyContextWebsite: 'https://top-level.test',
  });

  assert.equal(restored.suggestionThreads.length, 1);
  assert.equal(restored.activeSuggestionThreadId, 'thread_top');
  assert.equal(restored.companyContextName, 'Top Level Co');
  assert.equal(restored.companyContextWebsite, 'https://top-level.test');
});

test('restoreRecipientEditorAiState falls back to legacy ai_state thread metadata', () => {
  const restored = restoreRecipientEditorAiState({
    ai_state: {
      suggestionThreads: [makeThread('thread_legacy', 'Legacy', 'Legacy reply')],
      activeSuggestionThreadId: 'thread_legacy',
      company_name: 'Legacy Co',
      company_website: 'https://legacy.test',
    },
  });

  assert.equal(restored.suggestionThreads.length, 1);
  assert.equal(restored.activeSuggestionThreadId, 'thread_legacy');
  assert.equal(restored.companyContextName, 'Legacy Co');
  assert.equal(restored.companyContextWebsite, 'https://legacy.test');
});
