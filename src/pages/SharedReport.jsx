import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { sharedReportsClient } from '@/api/sharedReportsClient';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import { useAuth } from '@/lib/AuthContext';
import DocumentRichEditor from '@/components/document-comparison/DocumentRichEditor';
import DocumentComparisonEditorErrorBoundary from '@/components/document-comparison/DocumentComparisonEditorErrorBoundary';
import ComparisonWorkflowShell from '@/components/document-comparison/ComparisonWorkflowShell';
import Step1AddSources from '@/components/document-comparison/Step1AddSources';
import Step2EditSources from '@/components/document-comparison/Step2EditSources';
import ComparisonEvaluationStep from '@/components/document-comparison/ComparisonEvaluationStep';
import {
  buildCoachActionRequest,
  DOCUMENT_COMPARISON_COACH_ACTIONS,
} from '@/components/document-comparison/coachActions';
import { VISIBILITY_CONFIDENTIAL, VISIBILITY_SHARED, OWNER_PROPOSER, OWNER_RECIPIENT, createDocument, compileBundles, serializeDocumentsForDraft, deserializeDocumentsFromDraft } from '@/pages/document-comparison/documentsModel';
import { sanitizeEditorHtml } from '@/components/document-comparison/editorSanitization';
import {
  ComparisonDetailTabs,
} from '@/components/document-comparison/ComparisonDetailTabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  FileText,
  Loader2,
  Save,
  Send,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';

const CONFIDENTIAL_LABEL = 'Confidential Information';
const SHARED_LABEL = 'Shared Information';
const TOTAL_WORKFLOW_STEPS = 3;
const COACH_INTENT_LABELS = {
  improve_shared: 'Improve shared writing',
  negotiate: 'Negotiation strategy',
  risks: 'Risks & Gaps',
  rewrite_selection: 'Rewrite selection',
  general: 'General improvements',
  custom_prompt: 'Custom prompt',
  company_brief: 'Company Brief',
};

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clampStep(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.floor(numeric), 0), TOTAL_WORKFLOW_STEPS);
}

function parseCoachResponseBlocks(value) {
  const lines = String(value || '')
    .replace(/\r/g, '')
    .split('\n');
  const blocks = [];

  let index = 0;
  while (index < lines.length) {
    const rawLine = lines[index] || '';
    const line = rawLine.trim();
    if (!line) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        text: headingMatch[1].trim(),
      });
      index += 1;
      continue;
    }

    const orderedItemMatch = line.match(/^\d+[.)]\s+(.*)$/);
    if (orderedItemMatch) {
      const items = [];
      while (index < lines.length) {
        const orderedLine = String(lines[index] || '').trim();
        const match = orderedLine.match(/^\d+[.)]\s+(.*)$/);
        if (!match) {
          break;
        }
        const itemText = String(match[1] || '').trim();
        if (itemText) {
          items.push(itemText);
        }
        index += 1;
      }
      if (items.length) {
        blocks.push({ type: 'ordered', items });
      }
      continue;
    }

    const bulletItemMatch = line.match(/^[-*]\s+(.*)$/);
    if (bulletItemMatch) {
      const items = [];
      while (index < lines.length) {
        const bulletLine = String(lines[index] || '').trim();
        const match = bulletLine.match(/^[-*]\s+(.*)$/);
        if (!match) {
          break;
        }
        const itemText = String(match[1] || '').trim();
        if (itemText) {
          items.push(itemText);
        }
        index += 1;
      }
      if (items.length) {
        blocks.push({ type: 'unordered', items });
      }
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length) {
      const paragraphLine = String(lines[index] || '');
      const paragraphLineTrimmed = paragraphLine.trim();
      if (!paragraphLineTrimmed) {
        break;
      }
      if (/^#{1,6}\s+/.test(paragraphLineTrimmed) || /^\d+[.)]\s+/.test(paragraphLineTrimmed) || /^[-*]\s+/.test(paragraphLineTrimmed)) {
        break;
      }
      paragraphLines.push(paragraphLine);
      index += 1;
    }
    if (paragraphLines.length) {
      blocks.push({
        type: 'paragraph',
        text: paragraphLines.join('\n').trim(),
      });
    } else {
      index += 1;
    }
  }

  return blocks;
}

function CoachResponseText({ text = '' }) {
  const blocks = parseCoachResponseBlocks(text);
  if (!blocks.length) {
    return <p className="text-sm leading-6 text-slate-700 whitespace-pre-wrap">{String(text || '').trim()}</p>;
  }

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <h4 key={`coach-response-heading-${index}`} className="text-sm font-semibold text-slate-900">
              {block.text}
            </h4>
          );
        }
        if (block.type === 'unordered') {
          return (
            <ul key={`coach-response-unordered-${index}`} className="list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
              {block.items.map((item, itemIndex) => (
                <li key={`coach-response-unordered-item-${index}-${itemIndex}`}>{item}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'ordered') {
          return (
            <ol key={`coach-response-ordered-${index}`} className="list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-700">
              {block.items.map((item, itemIndex) => (
                <li key={`coach-response-ordered-item-${index}-${itemIndex}`}>{item}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={`coach-response-paragraph-${index}`} className="text-sm leading-6 text-slate-700 whitespace-pre-wrap">
            {block.text}
          </p>
        );
      })}
    </div>
  );
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
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function fileToMetadata(file) {
  return {
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: Number(file.size || 0),
  };
}

function parseDocJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  if (String(value.type || '').trim().toLowerCase() !== 'doc') {
    return null;
  }
  if (!Array.isArray(value.content)) {
    return null;
  }
  return value;
}

function getTokenFromRoute(paramsToken, locationSearch) {
  const pathToken = asText(paramsToken);
  if (pathToken) return pathToken;
  const search = new URLSearchParams(locationSearch || '');
  return asText(search.get('token'));
}

function normalizePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function coercePayloadToDocument(payload, fallbackLabel, fallbackText = '') {
  const safePayload = normalizePayload(payload);
  const directText = asText(safePayload.text);
  const notesText = asText(safePayload.notes);
  const text = directText || notesText || asText(fallbackText) || htmlToText(asText(safePayload.html));
  const rawHtml = asText(safePayload.html);
  const sanitizedHtml = sanitizeEditorHtml(rawHtml || '');
  const html =
    asText(htmlToText(sanitizedHtml)).length > 0
      ? sanitizedHtml
      : sanitizeEditorHtml(textToHtml(text));
  const json = parseDocJson(safePayload.json);
  const source = asText(safePayload.source) || 'typed';
  const files = Array.isArray(safePayload.files) ? safePayload.files : [];
  return {
    label: asText(safePayload.label) || fallbackLabel,
    text,
    html,
    json,
    source,
    files,
  };
}

function formatDateTime(value) {
  if (!value) return 'Never';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return parsed.toLocaleString();
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function toFriendlyLoadError(error) {
  const code = asText(error?.code).toLowerCase();
  if (code === 'token_expired') return 'This shared link has expired.';
  if (code === 'token_inactive') return 'This shared link has been revoked.';
  if (code === 'max_uses_reached') return 'This shared link has reached its view limit.';
  if (code === 'token_not_found') return 'This shared link is invalid.';
  if (code === 'request_timeout') return 'Loading timed out. Please refresh and try again.';
  return error?.message || 'Unable to load this shared report.';
}

function toFriendlySaveError(error) {
  const code = asText(error?.code).toLowerCase();
  if (code === 'token_expired') return 'This link has expired. Draft cannot be saved.';
  if (code === 'token_inactive') return 'This link is no longer active.';
  if (code === 'edit_not_allowed') return 'You do not have permission to edit Shared Information.';
  if (code === 'confidential_edit_not_allowed') {
    return 'You do not have permission to edit Confidential Information.';
  }
  if (code === 'payload_too_large') return 'Draft is too large to save.';
  return error?.message || 'Unable to save draft.';
}

function toFriendlyEvaluateError(error) {
  const code = asText(error?.code).toLowerCase();
  if (code === 'reevaluation_not_allowed') {
    return 'This link does not allow evaluation.';
  }
  if (code === 'not_configured') {
    return 'Evaluation is not configured in this environment yet.';
  }
  return error?.message || 'Unable to run evaluation.';
}

function toFriendlySendBackError(error) {
  const code = asText(error?.code).toLowerCase();
  if (Number(error?.status || 0) === 401 || code === 'unauthorized') {
    return 'Please sign in to send updates to the proposer.';
  }
  if (code === 'send_back_not_allowed') {
    return 'This link does not allow sending updates back.';
  }
  if (code === 'draft_required') {
    return 'Save a draft before sending back.';
  }
  return error?.message || 'Unable to send back updates.';
}

function toFriendlyVerifyError(error) {
  const code = asText(error?.code).toLowerCase();
  if (code === 'rate_limited') {
    return 'Too many verification requests. Please wait and try again.';
  }
  if (code === 'invalid_verification_code') {
    return 'That code is invalid. Try again.';
  }
  if (code === 'verification_code_expired') {
    return 'That code expired. Request a new one.';
  }
  if (code === 'verification_attempts_exceeded') {
    return 'Too many incorrect attempts. Request a new code.';
  }
  if (code === 'recipient_authorization_locked') {
    return 'This link has already been verified by another account. Switch to the verified account or ask the sender to issue a new link.';
  }
  return error?.message || 'Unable to verify access.';
}

async function fetchWorkspaceWithTimeout(token, timeoutMs = 45000) {
  let timeoutId = null;

  try {
    return await Promise.race([
      sharedReportsClient.getRecipientWorkspace(token),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const timeoutError = new Error('Loading timed out');
          timeoutError.code = 'request_timeout';
          reject(timeoutError);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export default function SharedReport() {
  const params = useParams();
  const location = useLocation();
  const { user, isAuthenticated, isLoadingAuth, navigateToLogin, logout } = useAuth();
  const token = useMemo(
    () => getTokenFromRoute(params.token, location.search),
    [params.token, location.search],
  );

  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('Shared Report');
  const [recipientDocuments, setRecipientDocuments] = useState([]);
  const [draftDirty, setDraftDirty] = useState(false);
  const [latestEvaluatedReport, setLatestEvaluatedReport] = useState(null);
  const [stepHydrated, setStepHydrated] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationRequested, setVerificationRequested] = useState(false);
  const [forcedMismatchInvitedEmail, setForcedMismatchInvitedEmail] = useState('');
  const [recipientDetailTab, setRecipientDetailTab] = useState('details');
  const [recipientActiveDocId, setRecipientActiveDocId] = useState(null);
  const [customPromptText, setCustomPromptText] = useState('');
  const [coachResult, setCoachResult] = useState(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState('');
  const [coachNotConfigured, setCoachNotConfigured] = useState(false);
  const [coachCached, setCoachCached] = useState(false);
  const [coachWithheldCount, setCoachWithheldCount] = useState(0);
  const [coachRequestMeta, setCoachRequestMeta] = useState(null);
  const [isCoachResponseCopied, setIsCoachResponseCopied] = useState(false);
  const [companyContextName, setCompanyContextName] = useState('');
  const [companyContextWebsite, setCompanyContextWebsite] = useState('');

  const activeImportRequestRef = useRef({ id: 0, controller: null });

  const workspaceQuery = useQuery({
    queryKey: ['shared-report-recipient-workspace', token],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => fetchWorkspaceWithTimeout(token),
  });

  const share = workspaceQuery.data?.share || null;
  const parent = workspaceQuery.data?.parent || null;
  const comparison = workspaceQuery.data?.comparison || null;
  const baseline = workspaceQuery.data?.baseline || {};
  const defaults = workspaceQuery.data?.defaults || {};
  const recipientDraft = workspaceQuery.data?.recipientDraft || workspaceQuery.data?.currentDraft || null;
  const latestEvaluation = workspaceQuery.data?.latestEvaluation || null;
  const latestSentRevision = workspaceQuery.data?.latestSentRevision || null;
  const baselineSharedPayload = useMemo(
    () => baseline?.shared_payload || workspaceQuery.data?.baselineShared || defaults.shared_payload || {},
    [baseline?.shared_payload, defaults.shared_payload, workspaceQuery.data?.baselineShared],
  );
  const baselineConfidentialPayload = useMemo(
    () => defaults.recipient_confidential_payload || {},
    [defaults.recipient_confidential_payload],
  );
  const baselineSharedDocument = useMemo(
    () =>
      coercePayloadToDocument(
        baselineSharedPayload,
        SHARED_LABEL,
        String(baselineSharedPayload?.text || ''),
      ),
    [baselineSharedPayload],
  );
  const recipientSharedDocument = useMemo(
    () =>
      coercePayloadToDocument(
        recipientDraft?.shared_payload || baselineSharedPayload,
        SHARED_LABEL,
        String(baselineSharedPayload?.text || ''),
      ),
    [baselineSharedPayload, recipientDraft?.shared_payload],
  );
  const recipientConfidentialDocument = useMemo(
    () =>
      coercePayloadToDocument(
        recipientDraft?.recipient_confidential_payload || baselineConfidentialPayload,
        CONFIDENTIAL_LABEL,
        String(baselineConfidentialPayload?.text || baselineConfidentialPayload?.notes || ''),
      ),
    [baselineConfidentialPayload, recipientDraft?.recipient_confidential_payload],
  );
  const currentUserEmail = asText(user?.email).toLowerCase();
  const invitedEmail =
    asText(share?.invited_email || forcedMismatchInvitedEmail).toLowerCase() || '';
  const senderEmail = asText(parent?.proposer_email);
  const recipientEmailDisplay =
    asText(share?.invited_email) ||
    asText(share?.authorization?.authorized_email) ||
    asText(forcedMismatchInvitedEmail);
  const authorizedForCurrentUser = Boolean(share?.authorization?.authorized_for_current_user);
  const requiresRecipientVerification =
    Boolean(isAuthenticated && invitedEmail) && !authorizedForCurrentUser;

  const canEditShared = Boolean(share?.permissions?.can_edit_shared);
  const canEditConfidential = Boolean(share?.permissions?.can_edit_confidential);
  const canReevaluate = Boolean(share?.permissions?.can_reevaluate);
  const canSendBack = Boolean(share?.permissions?.can_send_back);

  // ── Proposer shared document (locked, read-only baseline from comparison) ──
  const proposerSharedDoc = useMemo(() => {
    const text = baselineSharedDocument.text || '';
    const html = baselineSharedDocument.html || '';
    if (!text && !htmlToText(html)) return null;
    return createDocument({
      id: 'proposer-shared',
      title: baselineSharedDocument.label || SHARED_LABEL,
      visibility: VISIBILITY_SHARED,
      owner: OWNER_PROPOSER,
      source: baselineSharedDocument.source || 'typed',
      text,
      html,
      json: baselineSharedDocument.json || null,
      files: baselineSharedDocument.files || [],
      importStatus: (baselineSharedDocument.files || []).length > 0 ? 'imported' : 'idle',
    });
  }, [baselineSharedDocument]);

  // ── Combined documents for display (proposer shared + recipient documents) ──
  const allDisplayDocuments = useMemo(() => {
    const all = [];
    if (proposerSharedDoc) all.push(proposerSharedDoc);
    all.push(...recipientDocuments);
    return all;
  }, [proposerSharedDoc, recipientDocuments]);

  // ── Compiled bundles from recipient documents (for draft persistence + coach) ──
  const compiledRecipientBundles = useMemo(
    () => compileBundles(recipientDocuments),
    [recipientDocuments],
  );

  // ── Locked / read-only doc IDs ──
  const lockedDocIds = useMemo(() => {
    const ids = [];
    if (proposerSharedDoc) ids.push('proposer-shared');
    return ids;
  }, [proposerSharedDoc]);

  const readOnlyDocIds = useMemo(() => {
    const ids = [];
    if (proposerSharedDoc) ids.push('proposer-shared');
    if (requiresRecipientVerification) {
      recipientDocuments.forEach((d) => ids.push(d.id));
    }
    return ids;
  }, [proposerSharedDoc, recipientDocuments, requiresRecipientVerification]);

  // ── Recipient CRUD handlers ──
  const handleAddFiles = useCallback((files) => {
    const newDocs = Array.from(files).map((file) =>
      createDocument({
        title: file.name.replace(/\.(docx|pdf)$/i, ''),
        source: 'uploaded',
        owner: OWNER_RECIPIENT,
        _pendingFile: file,
      }),
    );
    setRecipientDocuments((prev) => [...prev, ...newDocs]);
    setDraftDirty(true);
    // Trigger import for each new file document
    newDocs.forEach((doc) => {
      if (doc._pendingFile) {
        importForDocument(doc.id, doc._pendingFile);
      }
    });
  }, []);

  const handleAddTypedDocument = useCallback(() => {
    const doc = createDocument({ owner: OWNER_RECIPIENT });
    setRecipientDocuments((prev) => [...prev, doc]);
    setDraftDirty(true);
  }, []);

  const handleRemoveDoc = useCallback((id) => {
    setRecipientDocuments((prev) => prev.filter((d) => d.id !== id));
    setDraftDirty(true);
  }, []);

  const handleRenameDoc = useCallback((id, newTitle) => {
    setRecipientDocuments((prev) =>
      prev.map((d) => (d.id === id ? { ...d, title: newTitle } : d)),
    );
    setDraftDirty(true);
  }, []);

  const handleSetVisibility = useCallback((id, visibility) => {
    setRecipientDocuments((prev) =>
      prev.map((d) => (d.id === id ? { ...d, visibility } : d)),
    );
    setDraftDirty(true);
  }, []);

  const handleRecipientDocumentContentChange = useCallback((id, { html, text, json }) => {
    // Don't allow editing proposer documents
    if (id === 'proposer-shared') return;
    if (requiresRecipientVerification) return;
    setRecipientDocuments((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, text, html, json, source: d.source === 'uploaded' ? 'uploaded' : 'typed' } : d,
      ),
    );
    setDraftDirty(true);
  }, [requiresRecipientVerification]);

  const hasActiveDraft = Boolean(recipientDraft && asText(recipientDraft.status).toLowerCase() === 'draft');
  const isSentToProposer =
    Boolean(latestSentRevision && asText(latestSentRevision.status).toLowerCase() === 'sent') && !hasActiveDraft;

  useEffect(() => {
    setStep(0);
    setStepHydrated(false);
    setRecipientDocuments([]);
    setRecipientActiveDocId(null);
    setVerificationCode('');
    setVerificationRequested(false);
    setForcedMismatchInvitedEmail('');
    setRecipientDetailTab('details');
    setCustomPromptText('');
    setCoachResult(null);
    setCoachLoading(false);
    setCoachError('');
    setCoachNotConfigured(false);
    setCoachCached(false);
    setCoachWithheldCount(0);
    setCoachRequestMeta(null);
    setIsCoachResponseCopied(false);
  }, [token]);

  useEffect(
    () => () => {
      if (activeImportRequestRef.current.controller) {
        activeImportRequestRef.current.controller.abort();
        activeImportRequestRef.current.controller = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!workspaceQuery.data) return;

    // Diagnostic: confirm what shared info and report data arrived from the server.
    // Check browser console (DevTools → Console) to verify values.
    const bp = baseline?.shared_payload || {};
    console.log('[SharedReport] comparisonId', workspaceQuery.data?.comparison?.id);
    console.log('[SharedReport] docBText length', String(bp?.text || '').length);
    console.log('[SharedReport] baseline.shared_payload keys', Object.keys(bp));
    const br = baseline?.ai_report || workspaceQuery.data?.baselineAiReport || comparison?.public_report || {};
    console.log('[SharedReport] report sections', Object.keys(br));
  }, [workspaceQuery.data]);

  useEffect(() => {
    if (!workspaceQuery.data) return;

    setTitle(asText(comparison?.title) || asText(parent?.title) || 'Shared Report');

    // Pre-populate company context from comparison data (if the proposer set it)
    if (!companyContextName) {
      const savedName = asText(comparison?.company_name);
      if (savedName) setCompanyContextName(savedName);
    }
    if (!companyContextWebsite) {
      const savedWebsite = asText(comparison?.company_website);
      if (savedWebsite) setCompanyContextWebsite(savedWebsite);
    }

    // ── Hydrate recipient documents ──
    const editorState = recipientDraft?.editor_state || {};
    const savedDocs = editorState.documents;

    if (Array.isArray(savedDocs) && savedDocs.length > 0) {
      // New multi-document model: restore from editor_state.documents
      setRecipientDocuments(deserializeDocumentsFromDraft(savedDocs));
    } else if (recipientDraft) {
      // Legacy model: create docs from shared_payload + recipient_confidential_payload
      const docs = [];
      const confText = recipientConfidentialDocument.text || '';
      const confHtml = recipientConfidentialDocument.html || '';
      if (confText || htmlToText(confHtml)) {
        docs.push(createDocument({
          id: 'legacy-conf',
          title: CONFIDENTIAL_LABEL,
          visibility: VISIBILITY_CONFIDENTIAL,
          owner: OWNER_RECIPIENT,
          source: recipientConfidentialDocument.source || 'typed',
          text: confText,
          html: confHtml,
          json: recipientConfidentialDocument.json || null,
          files: recipientConfidentialDocument.files || [],
          importStatus: (recipientConfidentialDocument.files || []).length > 0 ? 'imported' : 'idle',
        }));
      }
      // Only create a recipient shared doc if content differs from baseline
      const baseText = baselineSharedDocument.text || '';
      const draftSharedText = recipientSharedDocument.text || '';
      if (draftSharedText && draftSharedText !== baseText) {
        docs.push(createDocument({
          id: 'legacy-shared',
          title: SHARED_LABEL,
          visibility: VISIBILITY_SHARED,
          owner: OWNER_RECIPIENT,
          source: recipientSharedDocument.source || 'typed',
          text: draftSharedText,
          html: recipientSharedDocument.html || '',
          json: recipientSharedDocument.json || null,
          files: recipientSharedDocument.files || [],
          importStatus: (recipientSharedDocument.files || []).length > 0 ? 'imported' : 'idle',
        }));
      }
      if (docs.length === 0) {
        docs.push(createDocument({
          title: 'My Confidential Notes',
          visibility: VISIBILITY_CONFIDENTIAL,
          owner: OWNER_RECIPIENT,
        }));
      }
      setRecipientDocuments(docs);
    } else {
      // No draft — start with empty (user can add documents)
      setRecipientDocuments([]);
    }

    // Auto-select first recipient document for Step 2 editor
    if (!recipientActiveDocId) {
      const editorDocs = Array.isArray(savedDocs) && savedDocs.length > 0
        ? savedDocs
        : recipientDocuments;
      if (editorDocs.length > 0) {
        setRecipientActiveDocId(editorDocs[0].id);
      }
    }

    const hydratedStep = isAuthenticated ? clampStep(recipientDraft?.workflow_step, 0) : 0;
    if (!stepHydrated) {
      setStep(hydratedStep);
      setStepHydrated(true);
    } else if (!isAuthenticated && step !== 0) {
      setStep(0);
    }
    setDraftDirty(false);
  }, [
    workspaceQuery.data,
    comparison?.title,
    isAuthenticated,
    parent?.title,
    recipientDraft,
    recipientConfidentialDocument,
    recipientSharedDocument,
    baselineSharedDocument,
    step,
    stepHydrated,
  ]);

  useEffect(() => {
    if (requiresRecipientVerification && step !== 0) {
      setStep(0);
    }
  }, [requiresRecipientVerification, step]);

  const getMismatchInvitedEmail = (error) => {
    const fromBody = asText(error?.body?.error?.invitedEmail).toLowerCase();
    if (fromBody) return fromBody;
    return invitedEmail || '';
  };

  const isRecipientMismatchError = (error) =>
    asText(error?.code).toLowerCase() === 'recipient_email_mismatch';

  const handleRecipientMismatch = (error) => {
    const mismatchInvitedEmail = getMismatchInvitedEmail(error);
    if (mismatchInvitedEmail) {
      setForcedMismatchInvitedEmail(mismatchInvitedEmail);
    }
    setStep(0);
    toast.error(
      mismatchInvitedEmail
        ? `This link was sent to ${mismatchInvitedEmail}. Verify access or switch accounts.`
        : 'This link was sent to a different recipient email.',
    );
  };

  const buildDraftInput = (stepToSave = step) => {
    const sharedBundle = compiledRecipientBundles.shared;
    const confBundle = compiledRecipientBundles.confidential;
    return {
      shared_payload: {
        label: SHARED_LABEL,
        text: sharedBundle.text || '',
        html: sanitizeEditorHtml(sharedBundle.html || textToHtml(sharedBundle.text || '')),
        json: sharedBundle.json || null,
        source: sharedBundle.source || 'typed',
        files: sharedBundle.files || [],
      },
      recipient_confidential_payload: {
        label: CONFIDENTIAL_LABEL,
        text: confBundle.text || '',
        notes: confBundle.text || '',
        html: sanitizeEditorHtml(confBundle.html || textToHtml(confBundle.text || '')),
        json: confBundle.json || null,
        source: confBundle.source || 'typed',
        files: confBundle.files || [],
      },
      workflow_step: clampStep(stepToSave, 0),
      editor_state: {
        step: clampStep(stepToSave, 0),
        mode: 'recipient_document_comparison_v2',
        updated_at: new Date().toISOString(),
        documents: serializeDocumentsForDraft(recipientDocuments),
      },
    };
  };

  const saveDraftMutation = useMutation({
    mutationFn: async ({ stepToSave, silent: _silent = false } = {}) => {
      return sharedReportsClient.saveRecipientDraft(token, buildDraftInput(stepToSave));
    },
    onSuccess: async (_data, variables) => {
      setDraftDirty(false);
      if (!variables?.silent) {
        toast.success('Draft saved');
      }
      await workspaceQuery.refetch();
    },
    onError: (error) => {
      if (Number(error?.status) === 401) {
        const returnTo = `${location.pathname}${location.search || ''}${location.hash || ''}`;
        toast.error('Please sign in to save your draft.');
        navigateToLogin(returnTo);
        return;
      }
      if (isRecipientMismatchError(error)) {
        handleRecipientMismatch(error);
        return;
      }
      toast.error(toFriendlySaveError(error));
    },
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      if (draftDirty) {
        await saveDraftMutation.mutateAsync({ stepToSave: 2, silent: true });
      }
      return sharedReportsClient.evaluateRecipient(token);
    },
    onSuccess: async (result) => {
      setLatestEvaluatedReport(result?.evaluation?.public_report || null);
      setStep(3);
      toast.success('Evaluation complete');
      await workspaceQuery.refetch();
    },
    onError: (error) => {
      if (isRecipientMismatchError(error)) {
        handleRecipientMismatch(error);
        return;
      }
      toast.error(toFriendlyEvaluateError(error));
    },
  });

  const sendBackMutation = useMutation({
    mutationFn: () => sharedReportsClient.sendBackRecipient(token),
    onSuccess: async () => {
      toast.success('Sent to proposer');
      setDraftDirty(false);
      setStep(3);
      await workspaceQuery.refetch();
    },
    onError: (error) => {
      if (Number(error?.status) === 401) {
        const returnTo = `${location.pathname}${location.search || ''}${location.hash || ''}`;
        toast.error('Please sign in to send updates to the proposer.');
        navigateToLogin(returnTo);
        return;
      }
      if (isRecipientMismatchError(error)) {
        handleRecipientMismatch(error);
        return;
      }
      toast.error(toFriendlySendBackError(error));
    },
  });

  const verifyStartMutation = useMutation({
    mutationFn: () => sharedReportsClient.startRecipientVerification(token),
    onSuccess: () => {
      setVerificationRequested(true);
      toast.success(`Verification code sent to ${invitedEmail || 'the invited recipient email'}.`);
    },
    onError: (error) => {
      toast.error(toFriendlyVerifyError(error));
    },
  });

  const verifyConfirmMutation = useMutation({
    mutationFn: () => sharedReportsClient.confirmRecipientVerification(token, verificationCode),
    onSuccess: async () => {
      setVerificationCode('');
      setForcedMismatchInvitedEmail('');
      toast.success('Access verified. You can now continue with this signed-in account.');
      await workspaceQuery.refetch();
    },
    onError: (error) => {
      toast.error(toFriendlyVerifyError(error));
    },
  });

  const downloadSharedProposalPdfMutation = useMutation({
    mutationFn: () => sharedReportsClient.downloadRecipientProposalPdf(token),
    onSuccess: () => {
      toast.success('Proposal PDF download started');
    },
    onError: (error) => {
      toast.error(error?.message || 'Unable to download proposal PDF');
    },
  });

  const downloadSharedAiReportPdfMutation = useMutation({
    mutationFn: () => sharedReportsClient.downloadRecipientAiReportPdf(token),
    onSuccess: () => {
      toast.success('AI report PDF download started');
    },
    onError: (error) => {
      if (error?.code === 'not_configured' || Number(error?.status || 0) === 501) {
        toast.error('AI report PDF is not configured in this environment yet.');
        return;
      }
      toast.error(error?.message || 'Unable to download AI report PDF');
    },
  });

  const importForDocument = async (docId, file) => {
    if (!file) {
      toast.error('Select a .docx or .pdf file first.');
      return;
    }

    try {
      documentComparisonsClient.validateImportFile(file);
    } catch (error) {
      toast.error(error?.message || 'Failed to import file');
      return;
    }

    if (activeImportRequestRef.current.controller) {
      activeImportRequestRef.current.controller.abort();
    }
    const nextController = new AbortController();
    const nextRequestId = activeImportRequestRef.current.id + 1;
    activeImportRequestRef.current = {
      id: nextRequestId,
      controller: nextController,
    };

    // Mark document as importing
    setRecipientDocuments((prev) =>
      prev.map((d) =>
        d.id === docId ? { ...d, importStatus: 'importing', importError: '' } : d,
      ),
    );

    try {
      const extracted = await documentComparisonsClient.extractDocumentFromFile(file, {
        signal: nextController.signal,
      });

      if (
        nextController.signal.aborted ||
        activeImportRequestRef.current.id !== nextRequestId
      ) {
        return;
      }

      const rawText = asText(extracted?.text) || htmlToText(extracted?.html || '');
      const html = sanitizeEditorHtml(asText(extracted?.html) || textToHtml(rawText));
      const text = rawText || htmlToText(html);

      if (!text && !html) {
        throw new Error('No readable content was extracted from the selected file');
      }

      setRecipientDocuments((prev) =>
        prev.map((d) =>
          d.id === docId
            ? {
                ...d,
                text,
                html,
                json: null,
                source: 'uploaded',
                files: [fileToMetadata(file)],
                importStatus: 'imported',
                importError: '',
                _pendingFile: null,
              }
            : d,
        ),
      );
      setDraftDirty(true);
      toast.success(`${file.name} imported`);
    } catch (error) {
      if (
        nextController.signal.aborted ||
        activeImportRequestRef.current.id !== nextRequestId ||
        isAbortError(error)
      ) {
        return;
      }
      setRecipientDocuments((prev) =>
        prev.map((d) =>
          d.id === docId
            ? { ...d, importStatus: 'error', importError: error?.message || 'Import failed' }
            : d,
        ),
      );
      toast.error(error?.message || 'Failed to import file');
    } finally {
      if (activeImportRequestRef.current.id === nextRequestId) {
        activeImportRequestRef.current = {
          id: nextRequestId,
          controller: null,
        };
      }
    }
  };

  const requireSignInForEditing = () => {
    if (isAuthenticated) {
      return true;
    }

    if (isLoadingAuth) {
      return false;
    }

    const returnTo = `${location.pathname}${location.search || ''}${location.hash || ''}`;
    navigateToLogin(returnTo);
    return false;
  };

  const switchAccount = async () => {
    const returnTo = `${location.pathname}${location.search || ''}${location.hash || ''}`;
    try {
      await logout(false);
    } catch {
      // Best effort sign-out before opening login.
    }
    navigateToLogin(returnTo);
  };

  const jumpStep = async (nextStep) => {
    const bounded = clampStep(nextStep, step);
    if (bounded > 0 && !requireSignInForEditing()) {
      return;
    }
    if (bounded > 0 && requiresRecipientVerification) {
      toast.error('Verify access before editing this shared report.');
      setStep(0);
      return;
    }
    if (bounded === 2 && step < 2 && draftDirty) {
      try {
        await saveDraftMutation.mutateAsync({ stepToSave: 1, silent: true });
      } catch {
        return;
      }
    }
    setStep(bounded);
  };

  const runEvaluationFromStep2 = async () => {
    if (requiresRecipientVerification) {
      toast.error('Verify access before running evaluation.');
      setStep(0);
      return;
    }
    setStep(3);
    await evaluateMutation.mutateAsync();
  };

  const runCoach = async ({
    action = '',
    mode = 'full',
    intent = 'general',
    promptText = '',
    selectionText = '',
    selectionTarget = null,
    selectionRange = null,
  } = {}) => {
    if (!isAuthenticated) {
      if (!requireSignInForEditing()) {
        return null;
      }
    }
    if (requiresRecipientVerification) {
      toast.error('Verify access before using AI support.');
      setStep(0);
      return null;
    }
    if (coachNotConfigured) {
      return null;
    }

    setCoachLoading(true);
    setCoachError('');
    setIsCoachResponseCopied(false);

    try {
      const normalizedAction = String(action || intent || '').trim().toLowerCase();
      const isCustomPromptRequest = normalizedAction === 'custom_prompt';
      const payload = {
        action: action || undefined,
        mode,
        intent,
        promptText: isCustomPromptRequest ? String(promptText || '').trim() : undefined,
        selectionText: selectionText || undefined,
        selectionTarget: selectionTarget || undefined,
        company_name: asText(companyContextName) || undefined,
        company_website: asText(companyContextWebsite) || undefined,
      };
      if (!isCustomPromptRequest) {
        const confBundle = compiledRecipientBundles.confidential;
        const sharedBundle = compiledRecipientBundles.shared;
        const sanitizedDocAHtml = sanitizeEditorHtml(confBundle.html || textToHtml(confBundle.text || ''));
        const sanitizedDocBHtml = sanitizeEditorHtml(sharedBundle.html || textToHtml(sharedBundle.text || ''));
        const normalizedDocAText = asText(confBundle.text) || htmlToText(sanitizedDocAHtml);
        const normalizedDocBText = asText(sharedBundle.text) || htmlToText(sanitizedDocBHtml);
        payload.doc_a_text = normalizedDocAText;
        payload.doc_b_text = normalizedDocBText;
        payload.doc_a_html = sanitizedDocAHtml;
        payload.doc_b_html = sanitizedDocBHtml;
      }

      const response = await sharedReportsClient.coachRecipient(token, payload);
      const coach = response?.coach || null;
      setCoachResult(coach);
      setCoachCached(Boolean(response?.cached));
      setCoachWithheldCount(Number(response?.withheldCount || 0));
      setCoachNotConfigured(false);
      setCoachRequestMeta({
        action: action || '',
        mode,
        intent,
        promptText: isCustomPromptRequest ? String(promptText || '').trim() : '',
        model: response?.model || 'unknown',
        provider: response?.provider || 'vertex',
        selectionText: selectionText || '',
        selectionTarget: selectionTarget || null,
        selectionRange:
          selectionRange && Number.isFinite(selectionRange.from) && Number.isFinite(selectionRange.to)
            ? {
                from: Number(selectionRange.from),
                to: Number(selectionRange.to),
              }
            : null,
      });
      toast.success(response?.cached ? 'Loaded cached suggestions' : 'Suggestions ready');
      return response;
    } catch (error) {
      const status = Number(error?.status || 0);
      const code = asText(error?.body?.error?.code || error?.body?.code || error?.code);
      if (status === 501 || code === 'not_configured') {
        const message = 'AI suggestions are unavailable because Vertex AI is not configured.';
        setCoachResult(null);
        setCoachCached(false);
        setCoachWithheldCount(0);
        setCoachRequestMeta(null);
        setCoachError(message);
        setCoachNotConfigured(true);
        toast.error(message);
        return null;
      }

      const message = error?.message || 'Suggestion request failed';
      setCoachError(message);
      toast.error(message);
      return null;
    } finally {
      setCoachLoading(false);
    }
  };

  const runCustomPromptCoach = () => {
    const prompt = asText(customPromptText);
    if (!prompt || coachLoading || coachNotConfigured) {
      return;
    }

    runCoach({
      action: 'custom_prompt',
      mode: 'full',
      intent: 'custom_prompt',
      promptText: prompt,
    });
  };

  const runCompanyBrief = async () => {
    const name = asText(companyContextName);
    if (!name) {
      toast.error('Enter a company name first.');
      return null;
    }
    if (!isAuthenticated) {
      if (!requireSignInForEditing()) return null;
    }
    if (requiresRecipientVerification) {
      toast.error('Verify access before using AI support.');
      setStep(0);
      return null;
    }
    if (coachNotConfigured) return null;

    setCoachLoading(true);
    setCoachError('');
    setIsCoachResponseCopied(false);

    try {
      const response = await sharedReportsClient.companyBriefRecipient(token, {
        company_name: name,
        company_website: asText(companyContextWebsite) || undefined,
        lens: 'risk_negotiation',
      });

      const brief = response?.companyBrief || {};
      setCoachResult({
        version: 'coach-v1',
        summary: brief.content ? { overall: brief.content } : null,
        suggestions: [],
        custom_feedback: brief.content || '',
        company_brief_sources: brief.sources || [],
        company_brief_searches: brief.searches || [],
        company_brief_limited: Boolean(brief.limited),
      });
      setCoachCached(false);
      setCoachWithheldCount(0);
      setCoachRequestMeta({
        action: 'company_brief',
        mode: 'full',
        intent: 'company_brief',
        promptText: '',
        model: response?.model || 'unknown',
        provider: response?.provider || 'vertex',
      });
      toast.success('Company Brief ready');
      return response;
    } catch (error) {
      const status = Number(error?.status || 0);
      const code = asText(error?.body?.error?.code || error?.body?.code || error?.code);
      if (status === 501 || code === 'not_configured') {
        setCoachNotConfigured(true);
        setCoachError('AI suggestions are unavailable because Vertex AI is not configured.');
        toast.error('AI is not configured.');
        return null;
      }
      const message = error?.message || 'Company Brief request failed';
      setCoachError(message);
      toast.error(message);
      return null;
    } finally {
      setCoachLoading(false);
    }
  };

  const handleCustomPromptKeyDown = (event) => {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    runCustomPromptCoach();
  };

  const clearCoachResponse = () => {
    setCoachResult(null);
    setCoachError('');
    setCoachCached(false);
    setCoachWithheldCount(0);
    setCoachRequestMeta(null);
    setIsCoachResponseCopied(false);
  };

  const copyCoachResponse = async () => {
    const responseText = asText(coachResult?.custom_feedback || coachResult?.summary?.overall || '');
    if (!responseText) {
      return;
    }
    if (!navigator.clipboard?.writeText) {
      toast.error('Clipboard is not available in this browser');
      return;
    }
    try {
      await navigator.clipboard.writeText(responseText);
      setIsCoachResponseCopied(true);
      toast.success('Response copied');
    } catch {
      toast.error('Unable to copy response');
    }
  };

  const sendToProposer = async () => {
    if (!requireSignInForEditing()) {
      return;
    }
    if (requiresRecipientVerification) {
      toast.error('Verify access before sending updates.');
      setStep(0);
      return;
    }
    if (!canSendBack) {
      toast.error('Sending updates is disabled for this shared link.');
      return;
    }

    try {
      if (draftDirty || !hasActiveDraft) {
        await saveDraftMutation.mutateAsync({ stepToSave: 3, silent: true });
      }
      await sendBackMutation.mutateAsync();
    } catch {
      // Errors are surfaced by mutation handlers.
    }
  };

  const progress = (clampStep(step, 0) / TOTAL_WORKFLOW_STEPS) * 100;
  const baselineReport =
    baseline?.ai_report ||
    workspaceQuery.data?.baselineAiReport ||
    comparison?.public_report ||
    comparison?.evaluation_result?.report ||
    {};
  const updatedRecipientReport =
    latestEvaluatedReport ||
    latestEvaluation?.public_report ||
    workspaceQuery.data?.latestReport ||
    baselineReport ||
    {};
  const hasStep0Report =
    Boolean(baselineReport && typeof baselineReport === 'object' && !Array.isArray(baselineReport)) &&
    Object.keys(baselineReport).length > 0;
  const hasStep3Report =
    Boolean(updatedRecipientReport && typeof updatedRecipientReport === 'object' && !Array.isArray(updatedRecipientReport)) &&
    Object.keys(updatedRecipientReport).length > 0;
  const step0Recommendation =
    asText(baselineReport?.recommendation) ||
    asText(baseline?.summary) ||
    asText(comparison?.evaluation_result?.recommendation);
  const step3Recommendation =
    asText(updatedRecipientReport?.recommendation) ||
    asText(latestEvaluation?.summary) ||
    asText(comparison?.evaluation_result?.recommendation);
  const latestEvaluationStatus = asText(latestEvaluation?.status).toLowerCase();
  const latestEvaluationErrorCode = asText(
    latestEvaluation?.error_code ||
      latestEvaluation?.result_json?.error?.code ||
      latestEvaluation?.result?.error?.code ||
      latestEvaluation?.error?.code,
  ).toLowerCase();
  const step3IsEvaluationRunning =
    evaluateMutation.isPending ||
    latestEvaluationStatus === 'running' ||
    latestEvaluationStatus === 'queued' ||
    latestEvaluationStatus === 'evaluating';
  const step3IsEvaluationNotConfigured = latestEvaluationErrorCode === 'not_configured';
  const step3IsEvaluationFailed =
    !step3IsEvaluationRunning &&
    !step3IsEvaluationNotConfigured &&
    (latestEvaluationStatus === 'failed' ||
      latestEvaluationStatus === 'error' ||
      Boolean(latestEvaluationErrorCode));
  const step3EvaluationFailureMessage =
    asText(
      latestEvaluation?.error_message ||
        latestEvaluation?.result_json?.error?.message ||
        latestEvaluation?.result?.error?.message,
    ) || 'Evaluation failed. Please retry.';
  const baseTimelineItems = [
    {
      id: 'created',
      kind: 'file',
      tone: 'info',
      title: 'Proposal Created',
      timestamp: formatDateTime(parent?.created_at || comparison?.created_at),
    },
    {
      id: 'updated',
      kind: 'clock',
      tone: 'neutral',
      title: 'Last Updated',
      timestamp: formatDateTime(comparison?.updated_at || recipientDraft?.updated_at || parent?.updated_at),
    },
  ];
  const step3TimelineItems = [
    ...baseTimelineItems,
    ...(latestEvaluation
      ? [
          {
            id: 'recipient-evaluation',
            kind: 'sparkles',
            tone: step3IsEvaluationFailed
              ? 'danger'
              : step3IsEvaluationRunning
                ? 'info'
                : step3IsEvaluationNotConfigured
                  ? 'warning'
                  : 'success',
            title: step3IsEvaluationFailed
              ? 'Evaluation Failed'
              : step3IsEvaluationRunning
                ? 'Evaluation Running'
                : step3IsEvaluationNotConfigured
                  ? 'AI Not Configured'
                  : 'Evaluation Complete',
            timestamp: formatDateTime(latestEvaluation?.created_at || latestEvaluation?.updated_at),
          },
        ]
      : []),
  ];
  const coachSuggestions = Array.isArray(coachResult?.suggestions) ? coachResult.suggestions : [];
  const visibleCoachSuggestions = coachSuggestions.filter(
    (suggestion) => String(suggestion?.visibility || 'visible').toLowerCase() !== 'hidden',
  );
  const coachResponseText = asText(coachResult?.custom_feedback || coachResult?.summary?.overall || '');
  const coachIntentKey = String(coachRequestMeta?.intent || '').toLowerCase();
  const coachResponseLabel = COACH_INTENT_LABELS[coachIntentKey] || 'Suggestion feedback';
  const coachResponseMetaParts = [];
  if (visibleCoachSuggestions.length > 0) {
    coachResponseMetaParts.push(
      `${visibleCoachSuggestions.length} suggestion${visibleCoachSuggestions.length === 1 ? '' : 's'}`,
    );
  }
  if (Array.isArray(coachResult?.concerns) && coachResult.concerns.length > 0) {
    coachResponseMetaParts.push(
      `${coachResult.concerns.length} risk flag${coachResult.concerns.length === 1 ? '' : 's'}`,
    );
  }
  if (coachWithheldCount > 0) {
    coachResponseMetaParts.push(
      `${coachWithheldCount} shared suggestion${coachWithheldCount === 1 ? '' : 's'} withheld for safety`,
    );
  }
  const coachResponseMeta = coachResponseMetaParts.join(' · ');
  const canRunCoach = Boolean(canReevaluate) && !requiresRecipientVerification;
  const companyBriefSources = Array.isArray(coachResult?.company_brief_sources) ? coachResult.company_brief_sources : [];

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <Alert className="bg-amber-50 border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <AlertDescription className="text-amber-800">Missing shared report token.</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (workspaceQuery.isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <Card>
            <CardContent className="py-16 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-slate-600 mx-auto mb-3" />
              <p className="text-slate-700">Loading shared report...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (workspaceQuery.error || !share || !parent) {
    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            <AlertDescription className="text-red-800">{toFriendlyLoadError(workspaceQuery.error)}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  // ── Coach panel node ─────────────────────────────────────────────────────
  // Extracted so it can be passed as `coachPanel` prop to Step2EditSources,
  // matching the proposer flow where the coach panel renders at the top of Step 2.
  const coachPanelNode = (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-blue-600" />
          Ask for suggestions
          {coachCached ? <Badge variant="outline">Cached</Badge> : null}
        </CardTitle>
        <CardDescription>
          Generate suggestions only when you click an action. No background requests.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-full rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="space-y-3">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Company
                </p>
                <div className="space-y-2">
                  <Input
                    data-testid="company-context-name-input-inline"
                    placeholder="Company name"
                    value={companyContextName}
                    onChange={(e) => setCompanyContextName(e.target.value)}
                  />
                  <Input
                    data-testid="company-context-website-input-inline"
                    placeholder="Website"
                    value={companyContextWebsite}
                    onChange={(e) => setCompanyContextWebsite(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <p className="w-full text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Suggested Prompts</p>
                {DOCUMENT_COMPARISON_COACH_ACTIONS.map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={coachLoading || coachNotConfigured || !canRunCoach}
                    onClick={() => {
                      const request = buildCoachActionRequest(option, null);
                      if (!request) return;
                      runCoach(request);
                    }}
                  >
                    {coachLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                    {option.label}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={coachLoading || coachNotConfigured || !canRunCoach}
                  onClick={() => { if (!coachLoading && !coachNotConfigured) runCompanyBrief(); }}
                  data-testid="coach-company-brief-action"
                >
                  {coachLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  Company Brief
                </Button>
              </div>
              {!canReevaluate ? (
                <p className="text-xs text-amber-700">AI support is disabled for this shared link.</p>
              ) : null}
            </div>
          </div>
          <div
            className="h-full rounded-lg border border-slate-200 bg-slate-50/60 p-4 shadow-sm"
            data-testid="coach-custom-prompt-panel"
          >
            <div className="flex h-full flex-col gap-3">
              <div className="space-y-1">
                <Label htmlFor="coach-custom-prompt-input" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Custom prompt
                </Label>
                <p className="text-xs text-slate-500">Ask for feedback, risks, gaps, strategy...</p>
              </div>
              <Textarea
                id="coach-custom-prompt-input"
                data-testid="coach-custom-prompt-input"
                rows={5}
                className="min-h-[140px] w-full resize-y bg-white"
                placeholder="Ask for feedback, risks, gaps, strategy..."
                value={customPromptText}
                onChange={(event) => setCustomPromptText(event.target.value)}
                onKeyDown={handleCustomPromptKeyDown}
                disabled={coachLoading || coachNotConfigured || !canRunCoach}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  data-testid="coach-custom-prompt-run"
                  onClick={runCustomPromptCoach}
                  disabled={coachLoading || coachNotConfigured || !canRunCoach || !asText(customPromptText)}
                >
                  {coachLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {coachLoading ? 'Running...' : 'Run'}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {coachNotConfigured ? (
          <Alert className="bg-amber-50 border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <AlertDescription className="text-amber-800">
              AI suggestions are unavailable because Vertex AI is not configured.
            </AlertDescription>
          </Alert>
        ) : null}

        {!coachNotConfigured && coachError ? (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-700" />
            <AlertDescription className="text-red-800">{coachError}</AlertDescription>
          </Alert>
        ) : null}

        {coachResponseText ? (
          <div
            className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-all duration-200"
            data-testid={coachIntentKey === 'custom_prompt' ? 'coach-custom-prompt-feedback' : 'coach-response-feedback'}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{coachResponseLabel}</p>
                {coachResponseMeta ? <p className="text-xs text-slate-500">{coachResponseMeta}</p> : null}
              </div>
              <div className="flex items-center gap-1">
                <Button type="button" size="sm" variant="outline" onClick={copyCoachResponse} disabled={!coachResponseText}>
                  {isCoachResponseCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                  {isCoachResponseCopied ? 'Copied' : 'Copy'}
                </Button>
                <Button type="button" size="icon" variant="ghost" aria-label="Clear response" onClick={clearCoachResponse}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="min-h-[132px] px-4 py-4">
              <CoachResponseText text={coachResponseText} />
              {coachIntentKey === 'company_brief' && companyBriefSources.length > 0 ? (
                <div className="mt-4 border-t border-slate-200 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Sources</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600" data-testid="company-brief-sources">
                    {companyBriefSources.map((source, index) => {
                      const sourceTitle = asText(source?.title) || `Source ${index + 1}`;
                      const url = asText(source?.url);
                      if (!url) {
                        return (
                          <li key={`company-brief-source-${index}`}>
                            [{index + 1}] {sourceTitle}
                          </li>
                        );
                      }
                      return (
                        <li key={`company-brief-source-${index}`}>
                          [{index + 1}]{' '}
                          <a href={url} target="_blank" rel="noreferrer" className="text-blue-700 underline-offset-2 hover:underline">
                            {sourceTitle}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {visibleCoachSuggestions.length > 0 ? (
          <div className="space-y-2">
            {visibleCoachSuggestions.slice(0, 12).map((suggestion, index) => {
              const isShared = suggestion?.scope === 'shared' || suggestion?.proposed_change?.target === 'doc_b';
              return (
                <div key={`coach-suggestion-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{String(suggestion?.severity || 'info')}</Badge>
                    <Badge variant={isShared ? 'secondary' : 'outline'}>
                      {isShared ? 'Shared-safe' : 'Confidential-only'}
                    </Badge>
                    <span className="text-sm font-medium text-slate-800">{suggestion?.title || 'Suggestion'}</span>
                  </div>
                  {asText(suggestion?.explanation || suggestion?.rationale) ? (
                    <p className="mt-2 text-sm text-slate-600">
                      {asText(suggestion?.explanation || suggestion?.rationale)}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <ComparisonWorkflowShell
        title="Document Comparison"
        subtitle="Compare Shared Information and Confidential Information with recipient-safe reporting."
        step={step}
        totalSteps={TOTAL_WORKFLOW_STEPS}
        progress={progress}
        extraHeader={
          <>
            {/* ── Share metadata card ────────────────────────────────── */}
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle>{title || 'Shared Report'}</CardTitle>
                  <Badge variant="outline">{asText(share.status) || 'active'}</Badge>
                </div>
                <CardDescription>
                  Created: {formatDateTime(parent.created_at)} • Expires: {formatDateTime(share.expires_at)}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sent by</p>
                    <p className="text-sm font-medium text-slate-900 break-all">
                      {senderEmail || 'Unavailable'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sent to</p>
                    <p className="text-sm font-medium text-slate-900 break-all">
                      {recipientEmailDisplay || 'Unavailable until verification'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Cross-account confirmation ──────────────────────────── */}
            {isAuthenticated &&
            authorizedForCurrentUser &&
            asText(share?.authorization?.authorized_email) &&
            invitedEmail &&
            asText(share.authorization.authorized_email).toLowerCase() !== invitedEmail ? (
              <Alert className="bg-slate-50 border-slate-200">
                <AlertDescription className="text-slate-700">
                  Responding as: <span className="font-semibold">{share.authorization.authorized_email}</span>{' '}
                  (verified for {invitedEmail})
                </AlertDescription>
              </Alert>
            ) : null}

            {/* ── Recipient verification gate ─────────────────────────── */}
            {requiresRecipientVerification ? (
              <Alert className="bg-amber-50 border-amber-200">
                <AlertDescription className="text-amber-900 space-y-3">
                  <p>
                    This link was sent to <span className="font-semibold">{invitedEmail}</span>.
                    {currentUserEmail ? ` You are currently signed in as ${currentUserEmail}.` : ''}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={switchAccount}>
                      Switch account
                    </Button>
                    <Button
                      type="button"
                      onClick={() => verifyStartMutation.mutate()}
                      disabled={verifyStartMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {verifyStartMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                      Verify access
                    </Button>
                  </div>
                  {verificationRequested ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="shared-report-verify-code">Verification code</Label>
                        <Input
                          id="shared-report-verify-code"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          placeholder="6-digit code"
                          value={verificationCode}
                          onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                          className="w-[180px]"
                        />
                      </div>
                      <Button
                        type="button"
                        onClick={() => verifyConfirmMutation.mutate()}
                        disabled={verifyConfirmMutation.isPending || verificationCode.length !== 6}
                      >
                        {verifyConfirmMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                        Confirm
                      </Button>
                    </div>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}

            {/* ── Sent to proposer confirmation ───────────────────────── */}
            {isSentToProposer ? (
              <Alert className="bg-emerald-50 border-emerald-200">
                <AlertDescription className="text-emerald-800">
                  Sent to proposer on {formatDateTime(latestSentRevision?.updated_at)}.
                </AlertDescription>
              </Alert>
            ) : null}
          </>
        }
      >
        {/* ════════════════════════════════════════════════════════════
            STEP 0 — Baseline overview (read-only proposer report)
            ════════════════════════════════════════════════════════════ */}
        {step === 0 ? (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => downloadSharedProposalPdfMutation.mutate()}
                disabled={downloadSharedProposalPdfMutation.isPending}
              >
                {downloadSharedProposalPdfMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Download Proposal PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => downloadSharedAiReportPdfMutation.mutate()}
                disabled={downloadSharedAiReportPdfMutation.isPending}
              >
                {downloadSharedAiReportPdfMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Download AI Report PDF
              </Button>
            </div>

            <ComparisonDetailTabs
              activeTab={recipientDetailTab}
              onTabChange={setRecipientDetailTab}
              hasReportBadge={hasStep0Report}
              tabOrder={['details', 'report']}
              detailsTabLabel="Proposal"
              aiReportProps={{
                isEvaluationRunning: false,
                isPollingTimedOut: false,
                isEvaluationNotConfigured: false,
                showConfidentialityWarning: false,
                confidentialityWarningMessage: '',
                confidentialityWarningDetails: '',
                isEvaluationFailed: false,
                evaluationFailureBannerMessage: '',
                hasReport: hasStep0Report,
                hasEvaluations: false,
                noReportMessage: 'No baseline AI report is available yet for this proposal.',
                report: baselineReport,
                recommendation: step0Recommendation,
                timelineItems: baseTimelineItems,
              }}
              proposalDetailsProps={{
                description: 'Read-only baseline proposal content shared by the proposer.',
                documents: [
                  {
                    label: baselineSharedDocument.label || 'Proposal',
                    text: baselineSharedDocument.text || '',
                    html: baselineSharedDocument.html || '',
                    badges: [baselineSharedDocument.source || 'typed'],
                  },
                ],
              }}
            />

            <div className="space-y-3">
              {!isAuthenticated ? (
                <Alert className="bg-blue-50 border-blue-200">
                  <AlertDescription className="text-blue-900">Sign in to edit and respond.</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex justify-end">
                <Button
                  onClick={() => jumpStep(1)}
                  disabled={requiresRecipientVerification}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {requiresRecipientVerification ? 'Verify access to continue' : 'Edit Proposal'}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {/* ════════════════════════════════════════════════════════════
            STEP 1 — Upload / import  (shared Step1AddSources layout)
            ════════════════════════════════════════════════════════════ */}
        {step === 1 ? (
          <Step1AddSources
            title={title}
            onTitleChange={(v) => { setTitle(v); setDraftDirty(true); }}
            documents={allDisplayDocuments}
            showAddActions={!requiresRecipientVerification}
            onAddFiles={handleAddFiles}
            onAddTyped={handleAddTypedDocument}
            onRemoveDoc={handleRemoveDoc}
            onRenameDoc={handleRenameDoc}
            onSetVisibility={handleSetVisibility}
            lockedDocIds={lockedDocIds}
            readOnlyDocIds={readOnlyDocIds}
            onImportFile={(docId, file) => importForDocument(docId, file)}
            showBack
            onBack={() => setStep(0)}
            saveDraftPending={saveDraftMutation.isPending || requiresRecipientVerification}
            onSaveDraft={() => saveDraftMutation.mutate({ stepToSave: 1 })}
            onContinue={() => jumpStep(2)}
          />
        ) : null}

        {/* ════════════════════════════════════════════════════════════
            STEP 2 — Editor  (shared Step2EditSources layout)
            ════════════════════════════════════════════════════════════ */}
        {step === 2 ? (
          <DocumentComparisonEditorErrorBoundary
            onRetry={() => setStep(2)}
            onBackToStep1={() => setStep(1)}
          >
            <Step2EditSources
              documents={allDisplayDocuments}
              activeDocId={recipientActiveDocId || (allDisplayDocuments[0]?.id ?? null)}
              onSelectDoc={setRecipientActiveDocId}
              onDocumentContentChange={handleRecipientDocumentContentChange}
              readOnlyDocIds={readOnlyDocIds}
              limits={{ perDocumentCharacterLimit: 300000, warningCharacterThreshold: 255000 }}
              saveDraftPending={saveDraftMutation.isPending}
              exceedsAnySizeLimit={false}
              onSaveDraft={() => saveDraftMutation.mutate({ stepToSave: 2 })}
              onBack={() => setStep(1)}
              onContinue={runEvaluationFromStep2}
              continueLabel="Run Evaluation"
              continueDisabled={evaluateMutation.isPending || !canReevaluate || requiresRecipientVerification}
              coachPanel={coachPanelNode}
            />
          </DocumentComparisonEditorErrorBoundary>
        ) : null}

        {/* ════════════════════════════════════════════════════════════
            STEP 3 — Evaluation results  (shared ComparisonEvaluationStep)
            ════════════════════════════════════════════════════════════ */}
        {step === 3 ? (
          <ComparisonEvaluationStep
            stepTitle="Step 3: Evaluation"
            stepDescription="Run and review the latest recipient-side evaluation."
            actionSlot={
              <>
                <Button
                  type="button"
                  onClick={() => evaluateMutation.mutate()}
                  disabled={evaluateMutation.isPending || !canReevaluate || requiresRecipientVerification}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {evaluateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  {evaluateMutation.isPending ? 'Evaluating...' : 'Re-run Evaluation'}
                </Button>
                <Button
                  type="button"
                  onClick={sendToProposer}
                  disabled={
                    sendBackMutation.isPending ||
                    saveDraftMutation.isPending ||
                    !canSendBack ||
                    isSentToProposer ||
                    requiresRecipientVerification
                  }
                >
                  {sendBackMutation.isPending
                    ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    : <Send className="w-4 h-4 mr-2" />}
                  {isSentToProposer ? 'Sent to proposer' : sendBackMutation.isPending ? 'Sending...' : 'Send to proposer'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(2)}
                  disabled={requiresRecipientVerification}
                >
                  Edit again
                </Button>
              </>
            }
            activeTab={recipientDetailTab}
            onTabChange={setRecipientDetailTab}
            hasReportBadge={hasStep3Report}
            tabOrder={['details', 'report']}
            detailsTabLabel="Proposal"
            aiReportProps={{
              isEvaluationRunning: step3IsEvaluationRunning,
              isPollingTimedOut: false,
              isEvaluationNotConfigured: step3IsEvaluationNotConfigured,
              showConfidentialityWarning: false,
              confidentialityWarningMessage: '',
              confidentialityWarningDetails: '',
              isEvaluationFailed: step3IsEvaluationFailed,
              evaluationFailureBannerMessage: step3EvaluationFailureMessage,
              hasReport: hasStep3Report,
              hasEvaluations: Boolean(latestEvaluation),
              noReportMessage: 'No recipient evaluation is available yet. Run evaluation to generate one.',
              report: updatedRecipientReport,
              recommendation: step3Recommendation,
              timelineItems: step3TimelineItems,
            }}
            proposalDetailsProps={{
              description: 'Read-only current proposal state after recipient edits.',
              leftLabel: CONFIDENTIAL_LABEL,
              rightLabel: SHARED_LABEL,
              leftText: compiledRecipientBundles.confidential.text,
              leftHtml: compiledRecipientBundles.confidential.html,
              rightText: compiledRecipientBundles.shared.text,
              rightHtml: compiledRecipientBundles.shared.html,
              leftBadges: [compiledRecipientBundles.confidential.source || 'typed'],
              rightBadges: [compiledRecipientBundles.shared.source || 'typed'],
            }}
            onBack={() => setStep(2)}
            backLabel="Back to Editor"
          />
        ) : null}
      </ComparisonWorkflowShell>
    </div>
  );
}

