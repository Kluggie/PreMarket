/**
 * documentsModel.js
 *
 * Helpers for the multi-document model used in the Step 1 / 2 / 3 workflow.
 * The backend still persists data as doc_a (confidential) + doc_b (shared),
 * so this module handles:
 *   - Creating document entries
 *   - Compiling a documents[] array into confidential + shared bundles
 *   - Hydrating a documents[] from an existing doc_a / doc_b comparison row
 */

// ─────────────────────────────────────────────
//  Visibility constants
// ─────────────────────────────────────────────
export const VISIBILITY_UNCLASSIFIED = 'unclassified';
export const VISIBILITY_CONFIDENTIAL = 'confidential';
export const VISIBILITY_SHARED = 'shared';

// ─────────────────────────────────────────────
//  Owner constants
// ─────────────────────────────────────────────
export const OWNER_PROPOSER = 'proposer';
export const OWNER_RECIPIENT = 'recipient';

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments where crypto.randomUUID is unavailable
  return `doc-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  const paragraphs = normalized.split(/\n{2,}/g).filter(Boolean);
  if (!paragraphs.length) {
    return '<p></p>';
  }
  return paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

// ─────────────────────────────────────────────
//  Document factory
// ─────────────────────────────────────────────

/**
 * Create a new empty document entry.
 *
 * @param {object} overrides
 * @returns {SourceDocument}
 */
export function createDocument(overrides = {}) {
  return {
    id: generateId(),
    title: 'Untitled Document',
    visibility: VISIBILITY_UNCLASSIFIED,
    owner: OWNER_RECIPIENT,
    source: 'typed',
    text: '',
    html: '<p></p>',
    json: null,
    files: [],
    importStatus: 'idle',   // 'idle' | 'importing' | 'imported' | 'error'
    importError: '',
    // UI-only: never serialised to persistence
    _pendingFile: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────
//  Hydration — convert old doc_a / doc_b row → documents[]
// ─────────────────────────────────────────────

/**
 * Convert an existing comparison row (doc_a / doc_b model) into the new
 * documents array format. Called when opening an existing draft.
 *
 * Returns an array of 0–2 documents. Empty only if both sides are truly blank.
 *
 * @param {object} comparison  – the mapped comparison row from the server
 * @returns {SourceDocument[]}
 */
export function hydrateDocumentsFromComparison(comparison) {
  const docs = [];

  const docAText = String(comparison?.doc_a_text || '');
  const docAHtml = String(comparison?.doc_a_html || '') || textToHtml(docAText);
  const docAJson = comparison?.doc_a_json || null;
  const docASource = String(comparison?.doc_a_source || 'typed');
  const docAFiles = Array.isArray(comparison?.doc_a_files) ? comparison.doc_a_files : [];
  const hasDocA = Boolean(docAText || htmlToText(docAHtml));

  const docBText = String(comparison?.doc_b_text || '');
  const docBHtml = String(comparison?.doc_b_html || '') || textToHtml(docBText);
  const docBJson = comparison?.doc_b_json || null;
  const docBSource = String(comparison?.doc_b_source || 'typed');
  const docBFiles = Array.isArray(comparison?.doc_b_files) ? comparison.doc_b_files : [];
  const hasDocB = Boolean(docBText || htmlToText(docBHtml));

  if (hasDocA) {
    docs.push(createDocument({
      id: 'legacy-doc-a',
      title: 'Confidential Information',
      visibility: VISIBILITY_CONFIDENTIAL,
      source: docASource,
      text: docAText,
      html: docAHtml,
      json: docAJson,
      files: docAFiles,
      importStatus: docAFiles.length > 0 ? 'imported' : 'idle',
    }));
  }

  if (hasDocB) {
    docs.push(createDocument({
      id: 'legacy-doc-b',
      title: 'Shared Information',
      visibility: VISIBILITY_SHARED,
      source: docBSource,
      text: docBText,
      html: docBHtml,
      json: docBJson,
      files: docBFiles,
      importStatus: docBFiles.length > 0 ? 'imported' : 'idle',
    }));
  }

  return docs;
}

// ─────────────────────────────────────────────
//  Compilation — documents[] → docA / docB bundles
// ─────────────────────────────────────────────

const SECTION_SEPARATOR_TEXT = '\n\n---\n\n';

/**
 * Compile all documents of a given visibility into a single bundle
 * compatible with the existing doc_a / doc_b persistence model.
 *
 * @param {SourceDocument[]} documents
 * @param {'confidential' | 'shared'} visibility
 * @returns {{ text: string, html: string, json: null, source: string, files: object[] }}
 */
export function compileBundleForVisibility(documents, visibility) {
  const filtered = (documents || []).filter(
    (d) => d.visibility === visibility,
  );

  if (filtered.length === 0) {
    return {
      text: '',
      html: '<p></p>',
      json: null,
      source: 'typed',
      files: [],
    };
  }

  if (filtered.length === 1) {
    const d = filtered[0];
    return {
      text: d.text || htmlToText(d.html || ''),
      html: d.html || textToHtml(d.text || ''),
      json: d.json || null,
      source: d.source || 'typed',
      files: Array.isArray(d.files) ? d.files : [],
    };
  }

  // Multiple documents — compile with section headers
  const textParts = filtered.map((d) => {
    const content = d.text || htmlToText(d.html || '');
    const titleLine = d.title ? `${d.title}\n\n` : '';
    return `${titleLine}${content}`;
  });
  const compiledText = textParts.join(SECTION_SEPARATOR_TEXT);

  const htmlParts = filtered.map((d) => {
    const titleHtml = d.title
      ? `<p><strong>${escapeHtml(d.title)}</strong></p>`
      : '';
    const contentHtml = d.html || textToHtml(d.text || '');
    return `${titleHtml}${contentHtml}`;
  });
  const compiledHtml = htmlParts.join('<hr/><p></p>');

  const allFiles = filtered.flatMap((d) => (Array.isArray(d.files) ? d.files : []));
  const hasUploaded = filtered.some((d) => d.source === 'uploaded');

  return {
    text: compiledText,
    html: compiledHtml,
    json: null,               // Multi-doc compilation clears JSON; editor uses HTML
    source: hasUploaded ? 'uploaded' : 'typed',
    files: allFiles,
  };
}

/**
 * Convenience wrapper — returns both bundles at once.
 *
 * @param {SourceDocument[]} documents
 * @returns {{ confidential: BundleResult, shared: BundleResult }}
 */
export function compileBundles(documents) {
  return {
    confidential: compileBundleForVisibility(documents, VISIBILITY_CONFIDENTIAL),
    shared: compileBundleForVisibility(documents, VISIBILITY_SHARED),
  };
}

// ─────────────────────────────────────────────
//  Validation helpers
// ─────────────────────────────────────────────

/**
 * Returns true if every document has been classified (i.e. none are unclassified).
 * Required before the user can proceed from Step 1.
 */
export function allDocumentsClassified(documents) {
  if (!documents || documents.length === 0) {
    return false;
  }
  return documents.every(
    (d) => d.visibility === VISIBILITY_CONFIDENTIAL || d.visibility === VISIBILITY_SHARED,
  );
}

/**
 * Gets counts for diagnostics / Step 3 overview.
 */
export function getDocumentCounts(documents) {
  const all = documents || [];
  return {
    total: all.length,
    confidential: all.filter((d) => d.visibility === VISIBILITY_CONFIDENTIAL).length,
    shared: all.filter((d) => d.visibility === VISIBILITY_SHARED).length,
    unclassified: all.filter((d) => d.visibility === VISIBILITY_UNCLASSIFIED).length,
  };
}

// ─────────────────────────────────────────────
//  Draft state hashing (for dirty detection)
// ─────────────────────────────────────────────

/**
 * Build a deterministic string representing the current document list state.
 * Used to detect whether there are unsaved changes.
 */
export function buildDocumentsStateHash(documents) {
  if (!Array.isArray(documents)) {
    return '[]';
  }
  return JSON.stringify(
    documents.map((d) => ({
      id: d.id,
      title: d.title || '',
      visibility: d.visibility || VISIBILITY_UNCLASSIFIED,
      source: d.source || 'typed',
      text: d.text || '',
      html: d.html || '',
      files: Array.isArray(d.files) ? d.files : [],
    })),
  );
}

// ─────────────────────────────────────────────
//  Recipient draft serialization
// ─────────────────────────────────────────────

/**
 * Serialize recipient-owned documents for persistence in editor_state.documents.
 * Strips transient UI fields (_pendingFile, etc.) and normalises import status.
 *
 * @param {SourceDocument[]} documents
 * @returns {object[]}
 */
export function serializeDocumentsForDraft(documents) {
  return (documents || [])
    .filter((d) => d.owner === OWNER_RECIPIENT)
    .map((d) => ({
      id: d.id,
      title: d.title || 'Untitled Document',
      visibility: d.visibility || VISIBILITY_UNCLASSIFIED,
      owner: OWNER_RECIPIENT,
      source: d.source || 'typed',
      text: d.text || '',
      html: d.html || '<p></p>',
      json: d.json || null,
      files: Array.isArray(d.files) ? d.files : [],
      importStatus: d.importStatus === 'importing' ? 'idle' : (d.importStatus || 'idle'),
      importError: '',
    }));
}

/**
 * Deserialize documents stored in editor_state.documents back into
 * SourceDocument objects.
 *
 * @param {object[]} serialized
 * @returns {SourceDocument[]}
 */
export function deserializeDocumentsFromDraft(serialized) {
  if (!Array.isArray(serialized)) return [];
  return serialized.map((d) =>
    createDocument({
      id: d.id,
      title: d.title || 'Untitled Document',
      visibility: d.visibility || VISIBILITY_UNCLASSIFIED,
      owner: OWNER_RECIPIENT,
      source: d.source || 'typed',
      text: d.text || '',
      html: d.html || '<p></p>',
      json: d.json || null,
      files: Array.isArray(d.files) ? d.files : [],
      importStatus: d.importStatus || 'idle',
      importError: '',
    }),
  );
}
