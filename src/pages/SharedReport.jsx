import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sharedReportsClient } from '@/api/sharedReportsClient';
import { proposalsClient } from '@/api/proposalsClient';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import { useAuth } from '@/lib/AuthContext';
import {
  applyUpdatedProposalToCaches,
  invalidateProposalThreadQueries,
} from '@/lib/proposalThreadCache';
import DocumentComparisonEditorErrorBoundary from '@/components/document-comparison/DocumentComparisonEditorErrorBoundary';
import ComparisonWorkflowShell from '@/components/document-comparison/ComparisonWorkflowShell';
import SuggestionCoachPanel from '@/components/document-comparison/SuggestionCoachPanel';
import Step1AddSources from '@/components/document-comparison/Step1AddSources';
import Step2EditSources from '@/components/document-comparison/Step2EditSources';
import ComparisonEvaluationStep from '@/components/document-comparison/ComparisonEvaluationStep';
import {
  buildCoachActionRequest,
  DOCUMENT_COMPARISON_COACH_ACTIONS,
} from '@/components/document-comparison/coachActions';
import {
  VISIBILITY_CONFIDENTIAL,
  VISIBILITY_SHARED,
  OWNER_PROPOSER,
  OWNER_RECIPIENT,
  createDocument,
  compileBundles,
  serializeDocumentsForDraft,
  deserializeDocumentsFromDraft,
} from '@/pages/document-comparison/documentsModel';
import { sanitizeEditorHtml } from '@/components/document-comparison/editorSanitization';
import {
  applySuggestedTextChange,
  buildDiffPreview,
  buildWordDiffPreview,
  getNormalizedSuggestionId,
  getSuggestionChangeSummary,
} from '@/pages/document-comparison/coachSuggestionUtils';
import {
  appendAssistantEntry,
  appendUserEntry,
  buildThreadHistoryForRequest,
  canCreateThread,
  createThread,
  deleteThread,
  getActiveThread,
  getLastAssistantEntry,
  MAX_THREADS,
  renameThread,
} from '@/pages/document-comparison/suggestionThreads';
import {
  buildRecipientEditorStateWithAi,
  restoreRecipientEditorAiState,
} from '@/pages/shared-report/recipientEditorAiState';
import {
  ComparisonDetailTabs,
} from '@/components/document-comparison/ComparisonDetailTabs';
import RequestAgreementConfirmDialog from '@/components/proposal/RequestAgreementConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import {
  getRunAiMediationLabel,
  MEDIATION_REVIEW_LABEL,
} from '@/lib/aiReportUtils';
import {
  buildSharedReportTurnCopy,
  getSharedReportSendActionLabel,
} from '@/lib/sharedReportSendDirection';
import {
  buildSharedReportStatusBanner,
  getProposalThreadUiState,
} from '@/lib/proposalThreadStatusUi';
import {
  CONTINUE_NEGOTIATING_LABEL,
  getAgreementActionLabel,
  getOutcomeHelperText,
  getOutcomeToastMessage,
  shouldConfirmRequestAgreement,
  shouldShowContinueNegotiating,
} from '@/lib/proposalOutcomeUi';
import { buildActivityTimelineItems } from '@/lib/activityTimeline';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Send,
  XCircle,
} from 'lucide-react';

const CONFIDENTIAL_LABEL = 'Confidential Information';
const SHARED_LABEL = 'Shared Information';
const TOTAL_WORKFLOW_STEPS = 3;
const DEFAULT_STEP2_AUTOSAVE_DEBOUNCE_MS = 30_000;
const DEFAULT_STEP2_AUTOSAVE_MIN_INTERVAL_MS = 30_000;
const E2E_AUTOSAVE_MIN_MS = 250;
const HISTORY_SHARED_DOC_ID_PREFIX = 'shared-history-';
const HISTORY_CONFIDENTIAL_DOC_ID_PREFIX = 'history-confidential-';
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

function resolveStep2AutosaveDelayMs(defaultMs) {
  if (typeof window === 'undefined') {
    return defaultMs;
  }
  // Test-only override used by Playwright to keep autosave assertions reliable
  // without depending on large per-test timeouts.
  const overrideMs = Number(window.__PM_E2E_AUTOSAVE_MS);
  if (Number.isFinite(overrideMs) && overrideMs >= E2E_AUTOSAVE_MIN_MS) {
    return Math.floor(overrideMs);
  }
  return defaultMs;
}

function renderActionButtons(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return null;
  }
  return actions
    .filter((action) => asText(action?.label) && typeof action?.onClick === 'function')
    .map((action, index) => {
      const Icon = action?.icon || null;
      const key = asText(action?.key) || `action-${index}`;
      const isLoading = Boolean(action?.loading);
      return (
        <Button
          key={key}
          type="button"
          size="sm"
          variant={asText(action?.variant) || 'outline'}
          className={asText(action?.className) || undefined}
          onClick={action.onClick}
          disabled={Boolean(action?.disabled) || isLoading}
        >
          {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          {!isLoading && Icon ? <Icon className="w-4 h-4 mr-2" /> : null}
          {asText(action.label)}
        </Button>
      );
    });
}

function clampStep(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.floor(numeric), 0), TOTAL_WORKFLOW_STEPS);
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

function isImmutableHistoryDocumentId(value) {
  const id = asText(value).toLowerCase();
  if (!id) return false;
  return (
    id.startsWith(HISTORY_SHARED_DOC_ID_PREFIX) ||
    id.startsWith('shared-history-baseline') ||
    id.startsWith(HISTORY_CONFIDENTIAL_DOC_ID_PREFIX) ||
    id.startsWith('confidential-history-')
  );
}

function filterEditableDraftDocuments(documents, immutableHistoryDocIdSet) {
  const immutableIds = immutableHistoryDocIdSet instanceof Set ? immutableHistoryDocIdSet : new Set();
  return (Array.isArray(documents) ? documents : [])
    .filter((doc) => doc && typeof doc === 'object' && !Array.isArray(doc))
    .filter((doc) => {
      const id = asText(doc.id);
      if (!id) {
        return true;
      }
      if (isImmutableHistoryDocumentId(id)) {
        return false;
      }
      return !immutableIds.has(id);
    })
    .map((doc) => ({
      ...doc,
      isHistoricalRound: false,
      historySource: null,
      readOnlyReason: '',
    }));
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

function getPartyRoleLabel(value) {
  return asText(value).toLowerCase() === OWNER_PROPOSER ? 'Proposer' : 'Recipient';
}

function getPrimaryStatusClass(value) {
  const normalized = asText(value).toLowerCase();
  if (normalized === 'closed_won') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (normalized === 'closed_lost') return 'bg-rose-100 text-rose-700 border-rose-200';
  if (normalized === 'draft') return 'bg-slate-100 text-slate-700 border-slate-200';
  if (normalized === 'under_review') return 'bg-violet-100 text-violet-700 border-violet-200';
  if (normalized === 'waiting_on_counterparty') return 'bg-slate-100 text-slate-700 border-slate-200';
  if (normalized === 'needs_reply') return 'bg-rose-100 text-rose-700 border-rose-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function getStatusBannerClass(tone) {
  if (tone === 'success') {
    return 'bg-emerald-50 border-emerald-200 text-emerald-800';
  }
  if (tone === 'warning') {
    return 'bg-amber-50 border-amber-200 text-amber-900';
  }
  if (tone === 'info') {
    return 'bg-blue-50 border-blue-200 text-blue-900';
  }
  if (tone === 'danger') {
    return 'bg-rose-50 border-rose-200 text-rose-800';
  }
  return 'bg-slate-50 border-slate-200 text-slate-700';
}

function buildDefaultDraftDocuments(owner) {
  const resolvedOwner = asText(owner).toLowerCase() === OWNER_PROPOSER
    ? OWNER_PROPOSER
    : OWNER_RECIPIENT;
  return [
    createDocument({
      title: 'My New Shared Contribution',
      visibility: VISIBILITY_SHARED,
      owner: resolvedOwner,
    }),
    createDocument({
      title: 'My Confidential Notes',
      visibility: VISIBILITY_CONFIDENTIAL,
      owner: resolvedOwner,
    }),
  ];
}

function composeSharedDocuments(documents) {
  const sharedDocs = Array.isArray(documents)
    ? documents.filter((doc) => doc?.visibility === VISIBILITY_SHARED)
    : [];
  if (!sharedDocs.length) {
    return {
      text: '',
      html: '<p></p>',
      source: 'typed',
      files: [],
    };
  }

  const text = sharedDocs
    .map((doc) => {
      const content = doc.text || htmlToText(doc.html || '');
      const title = asText(doc.title);
      return title ? `${title}\n\n${content}` : content;
    })
    .join('\n\n---\n\n')
    .trim();

  const html = sharedDocs
    .map((doc) => {
      const title = asText(doc.title);
      const titleHtml = title ? `<p><strong>${escapeHtml(title)}</strong></p>` : '';
      const bodyHtml = asText(doc.html) || textToHtml(doc.text || '');
      return `${titleHtml}${bodyHtml || '<p></p>'}`;
    })
    .join('<hr/><p></p>');

  return {
    text,
    html: html || '<p></p>',
    source: sharedDocs.some((doc) => asText(doc.source).toLowerCase() === 'uploaded')
      ? 'uploaded'
      : (sharedDocs[sharedDocs.length - 1]?.source || 'typed'),
    files: sharedDocs.flatMap((doc) => (Array.isArray(doc.files) ? doc.files : [])),
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
    return 'This link does not allow AI mediation.';
  }
  if (code === 'not_configured') {
    return 'AI mediation is not configured in this environment yet.';
  }
  return error?.message || 'Unable to run AI mediation.';
}

function toFriendlySendBackError(error, sendTargetNoun = 'proposer') {
  const code = asText(error?.code).toLowerCase();
  if (Number(error?.status || 0) === 401 || code === 'unauthorized') {
    return `Please sign in to send updates to the ${sendTargetNoun}.`;
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
  const queryClient = useQueryClient();
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
  const [requestAgreementDialogOpen, setRequestAgreementDialogOpen] = useState(false);
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
  const [coachResultHash, setCoachResultHash] = useState('');
  const [appliedSuggestionIdsByHash, setAppliedSuggestionIdsByHash] = useState({});
  const [ignoredSuggestionIdsByHash, setIgnoredSuggestionIdsByHash] = useState({});
  const [expandedSuggestionIds, setExpandedSuggestionIds] = useState([]);
  const [selectionContext, setSelectionContext] = useState({ side: 'b', text: '', range: null });
  const [replaceSelectionRequest, setReplaceSelectionRequest] = useState({
    side: null,
    id: 0,
    from: 0,
    to: 0,
    text: '',
  });
  const [focusEditorRequest, setFocusEditorRequest] = useState({ side: null, id: 0, jumpText: '' });
  const [pendingReviewSuggestion, setPendingReviewSuggestion] = useState(null);
  const [isApplyingReviewSuggestion, setIsApplyingReviewSuggestion] = useState(false);
  const [isCoachResponseCopied, setIsCoachResponseCopied] = useState(false);
  const [companyContextName, setCompanyContextName] = useState('');
  const [companyContextWebsite, setCompanyContextWebsite] = useState('');
  const [companyContextSaveState, setCompanyContextSaveState] = useState('idle');
  const [companyContextSaveError, setCompanyContextSaveError] = useState('');
  const [companyContextValidationError, setCompanyContextValidationError] = useState('');
  const [isSavingCompanyContext, setIsSavingCompanyContext] = useState(false);
  const [suggestionThreads, setSuggestionThreads] = useState([]);
  const [activeSuggestionThreadId, setActiveSuggestionThreadId] = useState(null);
  const [showThreadHistory, setShowThreadHistory] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState(null);
  const [renamingThreadId, setRenamingThreadId] = useState(null);
  const [renameInputValue, setRenameInputValue] = useState('');

  const activeImportRequestRef = useRef({ id: 0, controller: null });
  const companyContextNameInputRef = useRef(null);
  const suggestionThreadsRef = useRef([]);
  const activeSuggestionThreadIdRef = useRef(null);
  const lastStep2AutosaveAtRef = useRef(0);
  const step2AutosaveDebounceMs = useMemo(
    () => resolveStep2AutosaveDelayMs(DEFAULT_STEP2_AUTOSAVE_DEBOUNCE_MS),
    [],
  );
  const step2AutosaveMinIntervalMs = useMemo(
    () => resolveStep2AutosaveDelayMs(DEFAULT_STEP2_AUTOSAVE_MIN_INTERVAL_MS),
    [],
  );

  const workspaceQuery = useQuery({
    queryKey: ['shared-report-recipient-workspace', token],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => fetchWorkspaceWithTimeout(token),
  });

  const share = workspaceQuery.data?.share || null;
  const parent = workspaceQuery.data?.parent || null;
  const hasCanonicalParentStatus = Boolean(asText(parent?.primary_status_key));
  const parentThreadState = useMemo(
    () => (hasCanonicalParentStatus ? getProposalThreadUiState(parent) : null),
    [hasCanonicalParentStatus, parent],
  );
  const parentOutcome = parent?.outcome || {};
  const parentOutcomeState = asText(parentOutcome?.state || parent?.status).toLowerCase();
  const parentPrimaryStatusKey = parentThreadState?.primaryStatusKey || '';
  const parentPrimaryStatusLabel = parentThreadState?.primaryStatusLabel || 'Active';
  const comparison = workspaceQuery.data?.comparison || null;
  const baseline = workspaceQuery.data?.baseline || {};
  const defaults = workspaceQuery.data?.defaults || {};
  const sharedHistory = workspaceQuery.data?.sharedHistory || null;
  const activityHistory = Array.isArray(workspaceQuery.data?.activityHistory)
    ? workspaceQuery.data.activityHistory
    : [];
  const partyContext = workspaceQuery.data?.partyContext || null;
  const recipientDraft = workspaceQuery.data?.recipientDraft || workspaceQuery.data?.currentDraft || null;
  const latestEvaluation = workspaceQuery.data?.latestEvaluation || null;
  const latestSentRevision = workspaceQuery.data?.latestSentRevision || null;
  const sharedHistoryEntries = useMemo(
    () => (Array.isArray(sharedHistory?.entries) ? sharedHistory.entries : []),
    [sharedHistory?.entries],
  );
  const sharedHistoryConfidentialEntries = useMemo(
    () => (Array.isArray(sharedHistory?.confidential_entries) ? sharedHistory.confidential_entries : []),
    [sharedHistory?.confidential_entries],
  );
  const draftDocumentOwner = asText(partyContext?.draft_author_role).toLowerCase() === OWNER_PROPOSER
    ? OWNER_PROPOSER
    : OWNER_RECIPIENT;
  const sendDirectionCopy = useMemo(
    () => buildSharedReportTurnCopy(draftDocumentOwner),
    [draftDocumentOwner],
  );
  const activeRoundNumber = useMemo(() => {
    const nextOutgoingRound = Number(partyContext?.next_outgoing_round || 0);
    if (Number.isFinite(nextOutgoingRound) && nextOutgoingRound >= 1) {
      return Math.floor(nextOutgoingRound);
    }
    const currentRound = Number(partyContext?.current_link_round || 0);
    if (Number.isFinite(currentRound) && currentRound >= 1) {
      return Math.floor(currentRound) + 1;
    }
    return 1;
  }, [partyContext?.current_link_round, partyContext?.next_outgoing_round]);
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

  const canReevaluate = Boolean(share?.permissions?.can_reevaluate);
  const canSendBack = Boolean(share?.permissions?.can_send_back);
  const canUpdateOutcomeFromStep0 = Boolean(
    isAuthenticated &&
    asText(parent?.proposal_id) &&
    parentOutcome?.actor_role,
  );

  const sharedHistoryDocuments = useMemo(() => {
    if (sharedHistoryEntries.length > 0) {
      return sharedHistoryEntries.map((entry, index) =>
        createDocument({
          id: `${HISTORY_SHARED_DOC_ID_PREFIX}${entry.id || index}`,
          title:
            entry.round_number
              ? `Round ${entry.round_number} - ${entry.visibility_label || `Shared by ${entry.author_label || getPartyRoleLabel(entry.author_role)}`}`
              : (entry.visibility_label || `Shared by ${entry.author_label || getPartyRoleLabel(entry.author_role)}`),
          visibility: VISIBILITY_SHARED,
          owner: asText(entry.author_role).toLowerCase() === OWNER_PROPOSER
            ? OWNER_PROPOSER
            : OWNER_RECIPIENT,
          source: entry.source || 'typed',
          text: entry.text || '',
          html: entry.html || '',
          json: entry.json || null,
          files: entry.files || [],
          importStatus: Array.isArray(entry.files) && entry.files.length > 0 ? 'imported' : 'idle',
          isHistoricalRound: true,
          historySource: 'previous_round',
          historyRoundNumber: Number(entry.round_number || 0) || null,
          readOnlyReason: 'Previous round content is view-only and cannot be changed.',
        }),
      );
    }

    const text = baselineSharedDocument.text || '';
    const html = baselineSharedDocument.html || '';
    if (!text && !htmlToText(html)) {
      return [];
    }
    return [
      createDocument({
        id: 'shared-history-baseline',
        title: baselineSharedDocument.label || 'Round 1 - Shared by Proposer',
        visibility: VISIBILITY_SHARED,
        owner: OWNER_PROPOSER,
        source: baselineSharedDocument.source || 'typed',
        text,
        html,
        json: baselineSharedDocument.json || null,
        files: baselineSharedDocument.files || [],
        importStatus: (baselineSharedDocument.files || []).length > 0 ? 'imported' : 'idle',
        isHistoricalRound: true,
        historySource: 'previous_round',
        historyRoundNumber: 1,
        readOnlyReason: 'Previous round content is view-only and cannot be changed.',
      }),
    ];
  }, [baselineSharedDocument, sharedHistoryEntries]);

  const previousRoundConfidentialDocuments = useMemo(() => {
    if (!sharedHistoryConfidentialEntries.length) {
      return [];
    }
    return sharedHistoryConfidentialEntries
      .filter((entry) => {
        const roundNumber = Number(entry?.round_number || 0);
        if (!Number.isFinite(roundNumber) || roundNumber < 1) {
          return true;
        }
        return roundNumber < activeRoundNumber;
      })
      .map((entry, index) => {
        const text = asText(entry?.text) || htmlToText(asText(entry?.html));
        const html = sanitizeEditorHtml(asText(entry?.html) || textToHtml(text));
        const roundNumber = Number(entry?.round_number || 0);
        const normalizedRoundNumber = Number.isFinite(roundNumber) && roundNumber >= 1
          ? Math.floor(roundNumber)
          : null;
        return createDocument({
          id: `${HISTORY_CONFIDENTIAL_DOC_ID_PREFIX}${entry?.id || index}`,
          title: normalizedRoundNumber
            ? `Round ${normalizedRoundNumber} - My Confidential Notes`
            : 'My Previous Confidential Notes',
          visibility: VISIBILITY_CONFIDENTIAL,
          owner: draftDocumentOwner,
          source: asText(entry?.source) || 'typed',
          text,
          html,
          json: parseDocJson(entry?.json),
          files: Array.isArray(entry?.files) ? entry.files : [],
          importStatus: Array.isArray(entry?.files) && entry.files.length > 0 ? 'imported' : 'idle',
          isHistoricalRound: true,
          historySource: 'previous_round',
          historyRoundNumber: normalizedRoundNumber,
          readOnlyReason: 'Previous round content is view-only and cannot be changed.',
        });
      });
  }, [activeRoundNumber, draftDocumentOwner, sharedHistoryConfidentialEntries]);

  // ── Combined documents for display (read-only history + editable draft docs) ──
  const allDisplayDocuments = useMemo(() => {
    return [...sharedHistoryDocuments, ...previousRoundConfidentialDocuments, ...recipientDocuments];
  }, [sharedHistoryDocuments, previousRoundConfidentialDocuments, recipientDocuments]);

  // ── Compiled bundles from recipient documents (for draft persistence + coach) ──
  const compiledRecipientBundles = useMemo(
    () => compileBundles(recipientDocuments),
    [recipientDocuments],
  );

  // ── Step 3 bundles: full proposal state (shared history + current draft docs) ──
  const step3Bundles = useMemo(() => {
    const recipientBundles = compileBundles(recipientDocuments);
    const combinedShared = composeSharedDocuments([
      ...sharedHistoryDocuments,
      ...recipientDocuments.filter((doc) => doc.visibility === VISIBILITY_SHARED),
    ]);

    return {
      confidential: recipientBundles.confidential,
      shared: {
        text: combinedShared.text,
        html: combinedShared.html || '<p></p>',
        json: null,
        source: combinedShared.source || recipientBundles.shared.source || 'typed',
        files: combinedShared.files || [],
      },
    };
  }, [recipientDocuments, sharedHistoryDocuments]);

  // ── Locked / read-only doc IDs ──
  const immutableHistoryDocIds = useMemo(
    () => [...sharedHistoryDocuments, ...previousRoundConfidentialDocuments].map((doc) => doc.id),
    [sharedHistoryDocuments, previousRoundConfidentialDocuments],
  );
  const immutableHistoryDocIdSet = useMemo(
    () => new Set(immutableHistoryDocIds),
    [immutableHistoryDocIds],
  );

  const lockedDocIds = useMemo(() => immutableHistoryDocIds, [immutableHistoryDocIds]);

  const readOnlyDocIds = useMemo(() => {
    const ids = [...immutableHistoryDocIds];
    if (requiresRecipientVerification) {
      recipientDocuments.forEach((d) => ids.push(d.id));
    }
    return ids;
  }, [immutableHistoryDocIds, recipientDocuments, requiresRecipientVerification]);

  // ── Recipient CRUD handlers ──
  const handleAddFiles = useCallback((files) => {
    const newDocs = Array.from(files).map((file) =>
      createDocument({
        title: file.name.replace(/\.(docx|pdf)$/i, ''),
        source: 'uploaded',
        owner: draftDocumentOwner,
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
  }, [draftDocumentOwner]);

  const handleAddTypedDocument = useCallback(() => {
    const doc = createDocument({ owner: draftDocumentOwner });
    setRecipientDocuments((prev) => [...prev, doc]);
    setDraftDirty(true);
  }, [draftDocumentOwner]);

  const handleRemoveDoc = useCallback((id) => {
    if (immutableHistoryDocIdSet.has(id)) {
      return;
    }
    setRecipientDocuments((prev) => prev.filter((d) => d.id !== id));
    setDraftDirty(true);
  }, [immutableHistoryDocIdSet]);

  const handleRenameDoc = useCallback((id, newTitle) => {
    if (immutableHistoryDocIdSet.has(id)) {
      return;
    }
    setRecipientDocuments((prev) =>
      prev.map((d) => (d.id === id ? { ...d, title: newTitle } : d)),
    );
    setDraftDirty(true);
  }, [immutableHistoryDocIdSet]);

  const handleSetVisibility = useCallback((id, visibility) => {
    if (immutableHistoryDocIdSet.has(id)) {
      return;
    }
    setRecipientDocuments((prev) =>
      prev.map((d) => (d.id === id ? { ...d, visibility } : d)),
    );
    setDraftDirty(true);
  }, [immutableHistoryDocIdSet]);

  const handleRecipientDocumentContentChange = useCallback((id, { html, text, json }) => {
    // Don't allow editing proposer documents
    if (id === 'proposer-shared') return;
    if (immutableHistoryDocIdSet.has(id)) return;
    if (requiresRecipientVerification) return;
    setRecipientDocuments((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, text, html, json, source: d.source === 'uploaded' ? 'uploaded' : 'typed' } : d,
      ),
    );
    setDraftDirty(true);
  }, [immutableHistoryDocIdSet, requiresRecipientVerification]);

  const hasActiveDraft = Boolean(recipientDraft && asText(recipientDraft.status).toLowerCase() === 'draft');
  const sharedReportStatusBanner = useMemo(
    () =>
      hasCanonicalParentStatus
        ? buildSharedReportStatusBanner({
            proposal: parent,
            counterpartyNoun: sendDirectionCopy.counterpartyNoun,
            sentAtText: formatDateTime(
              latestSentRevision?.updated_at ||
                latestSentRevision?.sent_at ||
                parent?.last_thread_activity_at ||
                parent?.updated_at,
            ),
          })
        : null,
    [
      hasCanonicalParentStatus,
      latestSentRevision?.sent_at,
      latestSentRevision?.updated_at,
      parent,
      sendDirectionCopy.counterpartyNoun,
    ],
  );
  const isSentToCounterparty = Boolean(parentThreadState?.waitingOnCounterparty);

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
    setCoachResultHash('');
    setAppliedSuggestionIdsByHash({});
    setIgnoredSuggestionIdsByHash({});
    setExpandedSuggestionIds([]);
    setSelectionContext({ side: 'b', text: '', range: null });
    setReplaceSelectionRequest({ side: null, id: 0, from: 0, to: 0, text: '' });
    setFocusEditorRequest({ side: null, id: 0, jumpText: '' });
    setPendingReviewSuggestion(null);
    setIsApplyingReviewSuggestion(false);
    setIsCoachResponseCopied(false);
    setCompanyContextName('');
    setCompanyContextWebsite('');
    setCompanyContextSaveState('idle');
    setCompanyContextSaveError('');
    setCompanyContextValidationError('');
    setIsSavingCompanyContext(false);
    setSuggestionThreads([]);
    setActiveSuggestionThreadId(null);
    setShowThreadHistory(false);
    setDeletingThreadId(null);
    setRenamingThreadId(null);
    setRenameInputValue('');
    suggestionThreadsRef.current = [];
    activeSuggestionThreadIdRef.current = null;
    lastStep2AutosaveAtRef.current = 0;
  }, [token]);

  useEffect(() => {
    suggestionThreadsRef.current = suggestionThreads;
    activeSuggestionThreadIdRef.current = activeSuggestionThreadId;
  }, [suggestionThreads, activeSuggestionThreadId]);

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
    const editorState =
      recipientDraft?.editor_state ||
      latestSentRevision?.editor_state ||
      {};
    const restoredAiState = restoreRecipientEditorAiState(editorState);
    const nextCompanyContextName =
      restoredAiState.companyContextName || asText(comparison?.company_name);
    const nextCompanyContextWebsite =
      restoredAiState.companyContextWebsite || asText(comparison?.company_website);

    setCompanyContextName(nextCompanyContextName);
    setCompanyContextWebsite(nextCompanyContextWebsite);
    setCompanyContextSaveState(
      nextCompanyContextName || nextCompanyContextWebsite ? 'saved' : 'idle',
    );
    setCompanyContextSaveError('');
    setCompanyContextValidationError('');
    setSuggestionThreads(restoredAiState.suggestionThreads);
    setActiveSuggestionThreadId(restoredAiState.activeSuggestionThreadId);
    suggestionThreadsRef.current = restoredAiState.suggestionThreads;
    activeSuggestionThreadIdRef.current = restoredAiState.activeSuggestionThreadId;
    const restoredActiveThread = restoredAiState.suggestionThreads.find(
      (thread) => thread.id === restoredAiState.activeSuggestionThreadId,
    );
    const restoredAssistant = restoredActiveThread
      ? getLastAssistantEntry(restoredActiveThread)
      : null;
    setCoachResult(restoredAssistant?.coachResult || null);
    setCoachResultHash(restoredAssistant?.coachResultHash || '');
    setCoachCached(Boolean(restoredAssistant?.coachCached));
    setCoachWithheldCount(Number(restoredAssistant?.withheldCount || 0));
    setCoachRequestMeta(restoredAssistant?.coachRequestMeta || null);
    setCoachError('');
    setCoachNotConfigured(false);
    setIsCoachResponseCopied(false);
    setExpandedSuggestionIds([]);
    setAppliedSuggestionIdsByHash({});
    setIgnoredSuggestionIdsByHash({});
    setPendingReviewSuggestion(null);
    setIsApplyingReviewSuggestion(false);
    setShowThreadHistory(false);
    setDeletingThreadId(null);
    setRenamingThreadId(null);
    setRenameInputValue('');

    // ── Hydrate recipient documents ──
    const savedDocs = editorState.documents;

    if (Array.isArray(savedDocs) && savedDocs.length > 0) {
      // New multi-document model: restore from editor_state.documents
      const restored = filterEditableDraftDocuments(
        deserializeDocumentsFromDraft(savedDocs),
        immutableHistoryDocIdSet,
      );
      setRecipientDocuments(
        restored.length > 0 ? restored : buildDefaultDraftDocuments(draftDocumentOwner),
      );
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
          owner: draftDocumentOwner,
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
          owner: draftDocumentOwner,
          source: recipientSharedDocument.source || 'typed',
          text: draftSharedText,
          html: recipientSharedDocument.html || '',
          json: recipientSharedDocument.json || null,
          files: recipientSharedDocument.files || [],
          importStatus: (recipientSharedDocument.files || []).length > 0 ? 'imported' : 'idle',
        }));
      }
      if (docs.length === 0) {
        docs.push(...buildDefaultDraftDocuments(draftDocumentOwner));
      }
      setRecipientDocuments(docs);
    } else if (latestSentRevision) {
      // No active draft but a sent revision exists — hydrate from the sent state.
      // This prevents documents from being erased after a send-back.
      const sentEditorState = latestSentRevision.editor_state || {};
      const sentDocs = sentEditorState.documents;
      if (Array.isArray(sentDocs) && sentDocs.length > 0) {
        const restored = filterEditableDraftDocuments(
          deserializeDocumentsFromDraft(sentDocs),
          immutableHistoryDocIdSet,
        );
        setRecipientDocuments(
          restored.length > 0 ? restored : buildDefaultDraftDocuments(draftDocumentOwner),
        );
      } else {
        // Legacy sent revision: rebuild from payloads
        const sentDocs2 = [];
        const sentConfPayload = latestSentRevision.recipient_confidential_payload || {};
        const sentConfText = sentConfPayload.text || sentConfPayload.notes || '';
        const sentConfHtml = sentConfPayload.html || '';
        if (sentConfText || htmlToText(sentConfHtml)) {
          sentDocs2.push(createDocument({
            id: 'sent-conf',
            title: CONFIDENTIAL_LABEL,
            visibility: VISIBILITY_CONFIDENTIAL,
            owner: draftDocumentOwner,
            source: sentConfPayload.source || 'typed',
            text: sentConfText,
            html: sentConfHtml,
            json: sentConfPayload.json || null,
            files: sentConfPayload.files || [],
            importStatus: (sentConfPayload.files || []).length > 0 ? 'imported' : 'idle',
          }));
        }
        const sentSharedPayload = latestSentRevision.shared_payload || {};
        const sentSharedText = sentSharedPayload.text || '';
        const sentSharedHtml = sentSharedPayload.html || '';
        const baseText = baselineSharedDocument.text || '';
        if (sentSharedText && sentSharedText !== baseText) {
          sentDocs2.push(createDocument({
            id: 'sent-shared',
            title: SHARED_LABEL,
            visibility: VISIBILITY_SHARED,
            owner: draftDocumentOwner,
            source: sentSharedPayload.source || 'typed',
            text: sentSharedText,
            html: sentSharedHtml,
            json: sentSharedPayload.json || null,
            files: sentSharedPayload.files || [],
            importStatus: (sentSharedPayload.files || []).length > 0 ? 'imported' : 'idle',
          }));
        }
        if (sentDocs2.length === 0) {
          sentDocs2.push(...buildDefaultDraftDocuments(draftDocumentOwner));
        }
        setRecipientDocuments(sentDocs2);
      }
    } else {
      // No draft and no sent revision — start with a fresh additive draft.
      setRecipientDocuments(buildDefaultDraftDocuments(draftDocumentOwner));
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

    const hydratedStep = isAuthenticated
      ? clampStep(recipientDraft?.workflow_step ?? latestSentRevision?.workflow_step, 0)
      : 0;
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
    draftDocumentOwner,
    isAuthenticated,
    parent?.title,
    recipientDraft,
    latestSentRevision,
    recipientConfidentialDocument,
    recipientSharedDocument,
    baselineSharedDocument,
    step,
    stepHydrated,
    immutableHistoryDocIdSet,
  ]);

  useEffect(() => {
    if (recipientActiveDocId && allDisplayDocuments.some((doc) => doc.id === recipientActiveDocId)) {
      return;
    }
    const nextDocId = recipientDocuments[0]?.id || allDisplayDocuments[0]?.id || null;
    if (nextDocId) {
      setRecipientActiveDocId(nextDocId);
    }
  }, [allDisplayDocuments, recipientActiveDocId, recipientDocuments]);

  useEffect(() => {
    if (requiresRecipientVerification && step !== 0) {
      setStep(0);
    }
  }, [requiresRecipientVerification, step]);

  useEffect(() => {
    if (companyContextSaveState !== 'saved') {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setCompanyContextSaveState('idle');
    }, 1200);
    return () => window.clearTimeout(timeoutId);
  }, [companyContextSaveState]);

  useEffect(() => {
    if (!draftDirty) {
      return undefined;
    }
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [draftDirty]);

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
    const baseEditorState =
      recipientDraft?.editor_state ||
      latestSentRevision?.editor_state ||
      {};
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
      editor_state: buildRecipientEditorStateWithAi({
        activeSuggestionThreadId: activeSuggestionThreadIdRef.current,
        baseEditorState,
        companyContextName,
        companyContextWebsite,
        documents: serializeDocumentsForDraft(
          recipientDocuments.filter((document) => !isImmutableHistoryDocumentId(document.id)),
        ),
        step: clampStep(stepToSave, 0),
        suggestionThreads: suggestionThreadsRef.current,
      }),
    };
  };

  const saveDraftMutation = useMutation({
    mutationFn: async ({ stepToSave, silent: _silent = false } = {}) => {
      return sharedReportsClient.saveRecipientDraft(token, buildDraftInput(stepToSave));
    },
    onSuccess: async (_data, variables) => {
      setDraftDirty(false);
      setCompanyContextSaveState('saved');
      setCompanyContextSaveError('');
      setIsSavingCompanyContext(false);
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
      if (step === 2 && (companyContextName || companyContextWebsite)) {
        setCompanyContextSaveError(toFriendlySaveError(error));
        setCompanyContextSaveState('idle');
      }
      setIsSavingCompanyContext(false);
      toast.error(toFriendlySaveError(error));
    },
  });

  useEffect(() => {
    if (
      !isAuthenticated ||
      requiresRecipientVerification ||
      step < 2 ||
      !draftDirty ||
      saveDraftMutation.isPending
    ) {
      return undefined;
    }

    const now = Date.now();
    const msSinceLastAutosave = now - lastStep2AutosaveAtRef.current;
    const delayMs =
      msSinceLastAutosave >= step2AutosaveMinIntervalMs
        ? step2AutosaveDebounceMs
        : Math.max(
            step2AutosaveDebounceMs,
            step2AutosaveMinIntervalMs - msSinceLastAutosave,
          );

    const timer = window.setTimeout(() => {
      if (!draftDirty) {
        return;
      }
      lastStep2AutosaveAtRef.current = Date.now();
      setIsSavingCompanyContext(true);
      setCompanyContextSaveState('saving');
      setCompanyContextSaveError('');
      saveDraftMutation.mutate({ stepToSave: 2, silent: true });
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [
    activeSuggestionThreadId,
    companyContextName,
    companyContextWebsite,
    draftDirty,
    isAuthenticated,
    recipientDocuments,
    requiresRecipientVerification,
    saveDraftMutation,
    step2AutosaveDebounceMs,
    step2AutosaveMinIntervalMs,
    step,
    suggestionThreads,
    title,
  ]);

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
      toast.success('AI mediation review ready');
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
      toast.success(sendDirectionCopy.sentCtaLabel);
      setDraftDirty(false);
      setStep(3);
      await workspaceQuery.refetch();
    },
    onError: (error) => {
      if (Number(error?.status) === 401) {
        const returnTo = `${location.pathname}${location.search || ''}${location.hash || ''}`;
        toast.error(sendDirectionCopy.signInToSendLabel);
        navigateToLogin(returnTo);
        return;
      }
      if (isRecipientMismatchError(error)) {
        handleRecipientMismatch(error);
        return;
      }
      toast.error(toFriendlySendBackError(error, sendDirectionCopy.counterpartyNoun));
    },
  });

  const markOutcomeMutation = useMutation({
    mutationFn: (nextOutcome) =>
      proposalsClient.markOutcome(asText(parent?.proposal_id), nextOutcome),
    onSuccess: async (updatedProposal) => {
      applyUpdatedProposalToCaches(queryClient, updatedProposal);
      toast.success(getOutcomeToastMessage(updatedProposal));
      await workspaceQuery.refetch();
      await invalidateProposalThreadQueries(queryClient, {
        proposalId: asText(parent?.proposal_id),
        documentComparisonId:
          updatedProposal?.document_comparison_id || asText(parent?.document_comparison_id) || null,
      });
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to update opportunity outcome');
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
      toast.success('Opportunity PDF download started');
    },
    onError: (error) => {
      toast.error(error?.message || 'Unable to download opportunity PDF');
    },
  });

  const downloadSharedAiMediationReviewPdfMutation = useMutation({
    mutationFn: () => sharedReportsClient.downloadRecipientAiReportPdf(token, { format: 'web-parity' }),
    onSuccess: () => {
      toast.success('AI mediation review PDF download started');
    },
    onError: (error) => {
      if (error?.code === 'not_configured' || Number(error?.status || 0) === 501) {
        toast.error('AI mediation review PDF is not configured in this environment yet.');
        return;
      }
      toast.error(error?.message || 'Unable to download AI mediation review PDF');
    },
  });
  const parentIsClosed = parentOutcomeState === 'won' || parentOutcomeState === 'lost';
  const outcomeActionDisabled = markOutcomeMutation.isPending;
  const outcomeHelperText = getOutcomeHelperText(parentOutcome, 'opportunity');

  const step0DownloadActions = [
    {
      key: 'opportunity-pdf',
      label: 'Opportunity PDF',
      onClick: () => downloadSharedProposalPdfMutation.mutate(),
      disabled: downloadSharedProposalPdfMutation.isPending,
      loading: downloadSharedProposalPdfMutation.isPending,
      variant: 'outline',
    },
    {
      key: 'ai-mediation-review-pdf',
      label: 'AI Mediation Review PDF',
      onClick: () => downloadSharedAiMediationReviewPdfMutation.mutate(),
      disabled: downloadSharedAiMediationReviewPdfMutation.isPending,
      loading: downloadSharedAiMediationReviewPdfMutation.isPending,
      variant: 'outline',
    },
  ];
  const handleAgreementAction = () => {
    if (shouldConfirmRequestAgreement(parentOutcome)) {
      setRequestAgreementDialogOpen(true);
      return;
    }

    markOutcomeMutation.mutate('won');
  };
  const handleRequestAgreementConfirm = () => {
    setRequestAgreementDialogOpen(false);
    markOutcomeMutation.mutate('won');
  };
  const handleContinueNegotiating = () => {
    markOutcomeMutation.mutate('continue_negotiating');
  };
  const step0StatusActions = canUpdateOutcomeFromStep0 && !parentIsClosed
    ? [
        {
          key: 'request-agreement',
          label: getAgreementActionLabel(parentOutcome),
          onClick: handleAgreementAction,
          disabled:
            outcomeActionDisabled ||
            !parentOutcome?.can_mark_won ||
            Boolean(parentOutcome?.requested_by_current_user),
          icon: CheckCircle2,
          variant: 'default',
          className: 'bg-emerald-600 hover:bg-emerald-700',
        },
        ...(shouldShowContinueNegotiating(parentOutcome)
          ? [
              {
                key: 'continue-negotiating',
                label: CONTINUE_NEGOTIATING_LABEL,
                onClick: handleContinueNegotiating,
                disabled:
                  outcomeActionDisabled ||
                  !parentOutcome?.can_continue_negotiating,
                icon: ArrowRight,
                variant: 'outline',
                className: 'border-slate-200 text-slate-700 hover:bg-slate-50',
              },
            ]
          : []),
        {
          key: 'mark-lost',
          label: 'Mark as Lost',
          onClick: () => markOutcomeMutation.mutate('lost'),
          disabled: outcomeActionDisabled || !parentOutcome?.can_mark_lost,
          icon: XCircle,
          variant: 'outline',
          className: 'text-rose-600 border-rose-200 hover:bg-rose-50',
        },
      ]
    : [];

  const importForDocument = async (docId, file) => {
    if (immutableHistoryDocIdSet.has(docId)) {
      toast.error('Previous round content is view-only and cannot be changed.');
      return;
    }
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
      toast.error('Verify access before running AI mediation.');
      setStep(0);
      return;
    }
    // Do NOT pre-emptively setStep(3) here. The step transition happens only
    // inside onSuccess so that when step 3 renders the report data is already
    // ready and `step3IsEvaluationRunning` is definitively false. This
    // eliminates the flash (step-3 shows briefly with isPending=false before
    // isPending becomes true) and the inconsistency where the review panel
    // shows 'updates automatically' after the evaluation has already finished.
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
    setCompanyContextValidationError('');
    setIsCoachResponseCopied(false);
    setExpandedSuggestionIds([]);

    try {
      const normalizedAction = String(action || intent || '').trim().toLowerCase();
      const isCustomPromptRequest = normalizedAction === 'custom_prompt';
      const userContent = isCustomPromptRequest
        ? String(promptText || '').trim()
        : (COACH_INTENT_LABELS[intent] || action || intent || 'prompt');
      const appended = appendUserEntry(
        suggestionThreadsRef.current,
        activeSuggestionThreadIdRef.current,
        { content: userContent, promptType: intent || action, intent },
      );
      setSuggestionThreads(appended.threads);
      setActiveSuggestionThreadId(appended.activeThreadId);
      suggestionThreadsRef.current = appended.threads;
      activeSuggestionThreadIdRef.current = appended.activeThreadId;
      setDraftDirty(true);
      setCompanyContextSaveState('idle');
      const threadHistory = buildThreadHistoryForRequest(
        appended.threads,
        appended.activeThreadId,
      );
      const payload = {
        action: action || undefined,
        mode,
        intent,
        promptText: isCustomPromptRequest ? String(promptText || '').trim() : undefined,
        selectionText: selectionText || undefined,
        selectionTarget: selectionTarget || undefined,
        threadHistory: threadHistory.length > 0 ? threadHistory : undefined,
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
      setCoachResultHash(String(response?.cacheHash || ''));
      setCoachCached(Boolean(response?.cached));
      setCoachWithheldCount(Number(response?.withheldCount || 0));
      setCoachNotConfigured(false);
      const requestMeta = {
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
      };
      setCoachRequestMeta(requestMeta);
      const assistantContent = asText(
        coach?.custom_feedback || coach?.summary?.overall || '',
      );
      const assistantAppended = appendAssistantEntry(
        suggestionThreadsRef.current,
        activeSuggestionThreadIdRef.current,
        {
          content: assistantContent,
          coachResult: coach,
          coachResultHash: String(response?.cacheHash || ''),
          coachCached: Boolean(response?.cached),
          coachRequestMeta: requestMeta,
          withheldCount: Number(response?.withheldCount || 0),
        },
      );
      setSuggestionThreads(assistantAppended.threads);
      suggestionThreadsRef.current = assistantAppended.threads;
      setDraftDirty(true);
      setCompanyContextSaveState('idle');
      toast.success(response?.cached ? 'Loaded cached suggestions' : 'Suggestions ready');
      return response;
    } catch (error) {
      const status = Number(error?.status || 0);
      const code = asText(error?.body?.error?.code || error?.body?.code || error?.code);
      if (status === 501 || code === 'not_configured') {
        const message = 'AI suggestions are unavailable because Vertex AI is not configured.';
        setCoachResult(null);
        setCoachResultHash('');
        setCoachCached(false);
        setCoachWithheldCount(0);
        setCoachRequestMeta(null);
        setExpandedSuggestionIds([]);
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
      setCompanyContextValidationError('Company name is required for Company Brief');
      companyContextNameInputRef.current?.focus?.();
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
    setCoachResultHash('');
    setExpandedSuggestionIds([]);
    setIsCoachResponseCopied(false);
    setCompanyContextValidationError('');

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
      setCoachResultHash('');
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
      setCoachError('');
      setCoachNotConfigured(false);
      toast.success('Company Brief ready');
      return response;
    } catch (error) {
      const status = Number(error?.status || 0);
      const code = asText(error?.body?.error?.code || error?.body?.code || error?.code);
      if (status === 400 && code === 'missing_company_context') {
        setCompanyContextValidationError('Company name is required for Company Brief');
        companyContextNameInputRef.current?.focus?.();
        setCoachError('Company name is required for Company Brief.');
        toast.error('Company context is missing.');
        return null;
      }
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
    if (coachLoading || coachNotConfigured) {
      return;
    }
    const key = String(event?.key || '').toLowerCase();
    if (key === 'enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      runCustomPromptCoach();
    }
  };

  const clearCoachResponse = () => {
    setCoachResult(null);
    setCoachResultHash('');
    setCoachError('');
    setCoachCached(false);
    setCoachWithheldCount(0);
    setCoachRequestMeta(null);
    setExpandedSuggestionIds([]);
    setIsCoachResponseCopied(false);
  };

  const copyCoachResponse = async () => {
    const responseText = asText(coachResult?.custom_feedback || coachResult?.summary?.overall || '');
    if (!responseText) {
      return;
    }
    if (!navigator.clipboard?.writeText) {
      toast.error('Clipboard is unavailable in this browser.');
      return;
    }
    try {
      await navigator.clipboard.writeText(responseText);
      setIsCoachResponseCopied(true);
      toast.success('Response copied.');
    } catch {
      toast.error('Could not copy response.');
    }
  };

  const restoreCoachStateFromThread = useCallback((thread) => {
    const lastAssistant = thread ? getLastAssistantEntry(thread) : null;
    if (lastAssistant) {
      setCoachResult(lastAssistant.coachResult || null);
      setCoachResultHash(lastAssistant.coachResultHash || '');
      setCoachCached(lastAssistant.coachCached || false);
      setCoachWithheldCount(lastAssistant.withheldCount || 0);
      setCoachRequestMeta(lastAssistant.coachRequestMeta || null);
    } else {
      setCoachResult(null);
      setCoachResultHash('');
      setCoachCached(false);
      setCoachWithheldCount(0);
      setCoachRequestMeta(null);
    }
    setExpandedSuggestionIds([]);
    setCoachError('');
    setIsCoachResponseCopied(false);
  }, []);

  const handleStartNewThread = useCallback(() => {
    const currentThreads = suggestionThreadsRef.current;
    const currentActiveId = activeSuggestionThreadIdRef.current;

    if (!canCreateThread(currentThreads, currentActiveId)) {
      if (currentThreads.length >= MAX_THREADS) {
        toast.info('Max 3 threads — delete one to start fresh.');
      }
      return;
    }

    const result = createThread(currentThreads, currentActiveId);
    setSuggestionThreads(result.threads);
    setActiveSuggestionThreadId(result.activeThreadId);
    suggestionThreadsRef.current = result.threads;
    activeSuggestionThreadIdRef.current = result.activeThreadId;
    setDraftDirty(true);
    setCompanyContextSaveState('idle');
    setCoachResult(null);
    setCoachResultHash('');
    setCoachCached(false);
    setCoachWithheldCount(0);
    setCoachRequestMeta(null);
    setExpandedSuggestionIds([]);
    setCoachError('');
    setIsCoachResponseCopied(false);
  }, []);

  const handleSelectThread = useCallback((threadId) => {
    if (!threadId || threadId === activeSuggestionThreadIdRef.current) {
      return;
    }
    const thread = suggestionThreadsRef.current.find((entry) => entry.id === threadId);
    if (!thread) {
      return;
    }
    setActiveSuggestionThreadId(threadId);
    activeSuggestionThreadIdRef.current = threadId;
    restoreCoachStateFromThread(thread);
    setShowThreadHistory(false);
    setDraftDirty(true);
    setCompanyContextSaveState('idle');
  }, [restoreCoachStateFromThread]);

  const handleDeleteThread = useCallback((threadId) => {
    setDeletingThreadId(threadId);
  }, []);

  const handleCancelDelete = useCallback(() => {
    setDeletingThreadId(null);
  }, []);

  const handleConfirmDeleteThread = useCallback((threadId) => {
    const currentThreads = suggestionThreadsRef.current;
    const currentActiveId = activeSuggestionThreadIdRef.current;
    const wasActive = currentActiveId === threadId;

    let result = deleteThread(currentThreads, currentActiveId, threadId);
    if (result.threads.length === 0) {
      const fresh = createThread([], null);
      result = { threads: fresh.threads, activeThreadId: fresh.activeThreadId };
    }

    setSuggestionThreads(result.threads);
    setActiveSuggestionThreadId(result.activeThreadId);
    suggestionThreadsRef.current = result.threads;
    activeSuggestionThreadIdRef.current = result.activeThreadId;
    setDeletingThreadId(null);
    setDraftDirty(true);
    setCompanyContextSaveState('idle');

    if (wasActive) {
      const nextActiveThread =
        result.threads.find((entry) => entry.id === result.activeThreadId) || null;
      restoreCoachStateFromThread(nextActiveThread);
    }
  }, [restoreCoachStateFromThread]);

  const handleStartRename = useCallback((threadId, currentTitle) => {
    setDeletingThreadId(null);
    setRenamingThreadId(threadId);
    setRenameInputValue(currentTitle || '');
  }, []);

  const handleConfirmRename = useCallback(() => {
    const threadId = renamingThreadId;
    const newTitle = renameInputValue.trim();
    if (threadId && newTitle) {
      const updated = renameThread(suggestionThreadsRef.current, threadId, newTitle);
      setSuggestionThreads(updated);
      suggestionThreadsRef.current = updated;
      setDraftDirty(true);
      setCompanyContextSaveState('idle');
    }
    setRenamingThreadId(null);
    setRenameInputValue('');
  }, [renamingThreadId, renameInputValue]);

  const handleCancelRename = useCallback(() => {
    setRenamingThreadId(null);
    setRenameInputValue('');
  }, []);

  const copyPendingProposedText = async () => {
    if (!pendingReviewSuggestion?.nextText) {
      toast.error('No proposed text to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(String(pendingReviewSuggestion.nextText || ''));
      toast.success('Proposed text copied.');
    } catch {
      toast.error('Could not copy proposed text.');
    }
  };

  const markSuggestionApplied = (suggestionIdValue, suggestionHashValue) => {
    const suggestionId = String(suggestionIdValue || '');
    const suggestionHash = String(suggestionHashValue || activeCoachHash || 'unhashed');
    if (!suggestionId) {
      return;
    }
    setAppliedSuggestionIdsByHash((previous) => {
      const current = Array.isArray(previous[suggestionHash]) ? previous[suggestionHash] : [];
      if (current.includes(suggestionId)) {
        return previous;
      }
      return {
        ...previous,
        [suggestionHash]: [...current, suggestionId],
      };
    });
    setExpandedSuggestionIds((previous) => previous.filter((id) => id !== suggestionId));
  };

  const openCoachSuggestionReview = (suggestion, suggestionIdOverride = '') => {
    const target = suggestion?.proposed_change?.target === 'doc_a' ? 'a' : 'b';
    const op = String(suggestion?.proposed_change?.op || 'append');
    const nextText = String(suggestion?.proposed_change?.text || '');
    const headingHint = String(suggestion?.proposed_change?.heading_hint || '');
    const requestIntent = String(coachRequestMeta?.intent || '').trim().toLowerCase();
    const isRewriteSelectionIntent = requestIntent === 'rewrite_selection' && op === 'replace_selection';
    const requestSelectionTarget = String(coachRequestMeta?.selectionTarget || '').toLowerCase();
    const requestSelectionSide =
      requestSelectionTarget === 'confidential'
        ? 'a'
        : requestSelectionTarget === 'shared'
          ? 'b'
          : null;
    const selectionRangeFromRequest =
      isRewriteSelectionIntent &&
      coachRequestMeta?.selectionRange &&
      requestSelectionSide === target &&
      Number.isFinite(coachRequestMeta.selectionRange.from) &&
      Number.isFinite(coachRequestMeta.selectionRange.to)
        ? {
            from: Number(coachRequestMeta.selectionRange.from),
            to: Number(coachRequestMeta.selectionRange.to),
          }
        : null;
    const selectedText = isRewriteSelectionIntent
      ? String(coachRequestMeta?.selectionText || '').trim()
      : selectionContext.side === target
        ? String(selectionContext.text || '').trim()
        : '';
    const targetVisibility = target === 'a' ? VISIBILITY_CONFIDENTIAL : VISIBILITY_SHARED;
    const currentTargetDoc = recipientDocuments.find(
      (document) =>
        document.owner === OWNER_RECIPIENT && document.visibility === targetVisibility,
    );
    const currentText = String(currentTargetDoc?.text || '');
    const updatedText = applySuggestedTextChange({
      currentText,
      op,
      nextText,
      headingHint,
      selectedText,
    });
    const isShared = suggestion?.scope === 'shared' || suggestion?.proposed_change?.target === 'doc_b';
    const diffPreview = isRewriteSelectionIntent
      ? buildWordDiffPreview(selectedText, nextText)
      : buildDiffPreview(currentText, updatedText);
    const jumpText = String(nextText || selectedText || headingHint || '').trim();

    setPendingReviewSuggestion({
      suggestion,
      suggestionId: String(suggestionIdOverride || getNormalizedSuggestionId(suggestion)),
      coachHash: activeCoachHash,
      target,
      op,
      nextText,
      selectedText,
      headingHint,
      currentText,
      updatedText,
      intent: requestIntent,
      selectionRange: selectionRangeFromRequest,
      isShared,
      diffPreview,
      jumpText: jumpText.slice(0, 280),
      changeSummary: isRewriteSelectionIntent
        ? 'This will replace only the selected snippet in the target editor.'
        : getSuggestionChangeSummary(op, headingHint),
    });
  };

  const handleReplaceSelectionApplied = (result) => {
    const requestId = Number(result?.id || 0);
    if (!pendingReviewSuggestion || requestId !== Number(replaceSelectionRequest.id || 0)) {
      return;
    }

    setReplaceSelectionRequest({ side: null, id: 0, from: 0, to: 0, text: '' });

    if (!result?.success) {
      setIsApplyingReviewSuggestion(false);
      toast.error('Could not apply rewrite to the selected text. Please reselect and try again.');
      return;
    }

    markSuggestionApplied(
      pendingReviewSuggestion.suggestionId,
      pendingReviewSuggestion.coachHash,
    );
    setPendingReviewSuggestion(null);
    setIsApplyingReviewSuggestion(false);
    setDraftDirty(true);
    setCompanyContextSaveState('idle');
    setFocusEditorRequest({
      side: pendingReviewSuggestion.target,
      id: Date.now(),
      jumpText: String(result?.text || '').trim().slice(0, 280),
    });
    toast.success('Suggestion applied locally. Click Save Draft to persist.');
  };

  const confirmCoachSuggestionApply = () => {
    if (!pendingReviewSuggestion) {
      return;
    }

    setIsApplyingReviewSuggestion(true);
    const target = pendingReviewSuggestion.target === 'a' ? 'a' : 'b';
    const jumpText = String(pendingReviewSuggestion.jumpText || '').trim();
    const suggestionId = String(pendingReviewSuggestion.suggestionId || '');
    const suggestionHash = String(pendingReviewSuggestion.coachHash || activeCoachHash || 'unhashed');
    const isRewriteSelection = pendingReviewSuggestion.intent === 'rewrite_selection';

    if (isRewriteSelection) {
      const range = pendingReviewSuggestion.selectionRange;
      const nextText = String(pendingReviewSuggestion.nextText || '').trim();
      if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from) {
        setIsApplyingReviewSuggestion(false);
        toast.error('Selection is no longer available. Re-select text and request rewrite again.');
        return;
      }
      if (!nextText) {
        setIsApplyingReviewSuggestion(false);
        toast.error('No rewritten text returned for this suggestion.');
        return;
      }
      const requestId = Date.now();
      setReplaceSelectionRequest({
        side: target,
        id: requestId,
        from: Number(range.from),
        to: Number(range.to),
        text: nextText,
      });
      return;
    }

    const targetVisibility = target === 'a' ? VISIBILITY_CONFIDENTIAL : VISIBILITY_SHARED;
    const updatedText = String(pendingReviewSuggestion.updatedText || '');
    const updatedHtml = sanitizeEditorHtml(textToHtml(updatedText));

    setRecipientDocuments((previous) => {
      let applied = false;
      const next = previous.map((document) => {
        if (!applied && document.owner === OWNER_RECIPIENT && document.visibility === targetVisibility) {
          applied = true;
          return {
            ...document,
            text: updatedText,
            html: updatedHtml,
            json: null,
            source: 'typed',
          };
        }
        return document;
      });

      if (!applied) {
        next.push(
          createDocument({
            title: targetVisibility === VISIBILITY_SHARED ? SHARED_LABEL : CONFIDENTIAL_LABEL,
            visibility: targetVisibility,
            owner: draftDocumentOwner,
            source: 'typed',
            text: updatedText,
            html: updatedHtml,
            json: null,
          }),
        );
      }

      return next;
    });

    markSuggestionApplied(suggestionId, suggestionHash);
    setPendingReviewSuggestion(null);
    setIsApplyingReviewSuggestion(false);
    setDraftDirty(true);
    setCompanyContextSaveState('idle');
    setFocusEditorRequest({
      side: target,
      id: Date.now(),
      jumpText,
    });
    toast.success('Suggestion applied locally. Click Save Draft to persist.');
  };

  const toggleSuggestionExpanded = (suggestionId) => {
    const normalizedId = String(suggestionId || '');
    if (!normalizedId) {
      return;
    }
    setExpandedSuggestionIds((previous) =>
      previous.includes(normalizedId)
        ? previous.filter((id) => id !== normalizedId)
        : [...previous, normalizedId],
    );
  };

  const dismissSuggestion = (suggestionId) => {
    const normalizedId = String(suggestionId || '');
    if (!normalizedId) {
      return;
    }
    const suggestionHash = String(activeCoachHash || 'unhashed');
    setIgnoredSuggestionIdsByHash((previous) => {
      const current = Array.isArray(previous[suggestionHash]) ? previous[suggestionHash] : [];
      if (current.includes(normalizedId)) {
        return previous;
      }
      return {
        ...previous,
        [suggestionHash]: [...current, normalizedId],
      };
    });
    setExpandedSuggestionIds((previous) => previous.filter((id) => id !== normalizedId));
  };

  const sendToCounterparty = async () => {
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
  // The recipient evaluate endpoint is synchronous: it blocks until the
  // Vertex AI call completes and returns the full result in a single HTTP
  // round-trip.  The server-side evaluation run row only ever carries statuses
  // 'pending', 'success', or 'error' — never 'running'/'queued'/'evaluating'.
  // Checking those statuses against latestEvaluationStatus would therefore
  // never fire for legitimate in-progress evaluations, but COULD wrongly show
  // the 'processing' card if stale workspace data happens to contain one of
  // those strings.  Binding isEvaluationRunning solely to the mutation's
  // pending state keeps the review panel and timeline perfectly in sync:
  // they both derive from the same variable and transition to 'ready' in the
  // same React render batch as the mutation settling.
  const step3IsEvaluationRunning = evaluateMutation.isPending;
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
    ) || 'AI mediation could not be completed. Please retry.';
  const latestEvaluationTimelineTone = step3IsEvaluationFailed
    ? 'danger'
    : step3IsEvaluationRunning
      ? 'info'
      : step3IsEvaluationNotConfigured
        ? 'warning'
        : 'success';
  const latestEvaluationTimelineTitle = step3IsEvaluationFailed
    ? 'AI Mediation Failed'
    : step3IsEvaluationRunning
      ? 'AI Mediation Running'
      : step3IsEvaluationNotConfigured
        ? 'AI Mediation Unavailable'
        : 'AI Mediation Ready';
  const timelineItems = buildActivityTimelineItems({
    activityHistory,
    createdAt: parent?.created_at || comparison?.created_at,
    updatedAt: comparison?.updated_at || recipientDraft?.updated_at || parent?.updated_at,
    hasLatestEvaluation: Boolean(latestEvaluation),
    latestEvaluationTone: latestEvaluationTimelineTone,
    latestEvaluationTitle: latestEvaluationTimelineTitle,
    latestEvaluationTimestamp: latestEvaluation?.created_at || latestEvaluation?.updated_at,
    formatDateTime,
  });
  const coachSuggestions = Array.isArray(coachResult?.suggestions) ? coachResult.suggestions : [];
  const activeCoachHash = coachResultHash || 'unhashed';
  const appliedSuggestionIds = appliedSuggestionIdsByHash[activeCoachHash] || [];
  const ignoredSuggestionIds = ignoredSuggestionIdsByHash[activeCoachHash] || [];
  const hiddenSuggestionIds = new Set([...appliedSuggestionIds, ...ignoredSuggestionIds]);
  const visibleCoachSuggestions = coachSuggestions.filter(
    (suggestion, index) =>
      String(suggestion?.visibility || 'visible').toLowerCase() !== 'hidden' &&
      !hiddenSuggestionIds.has(getNormalizedSuggestionId(suggestion, index)),
  );
  const coachResponseText = asText(coachResult?.custom_feedback || coachResult?.summary?.overall || '');
  const coachIntentKey = String(coachRequestMeta?.intent || '').toLowerCase();
  const activeThread = getActiveThread(suggestionThreads, activeSuggestionThreadId);
  const activeThreadEntryCount = activeThread?.entries?.length || 0;
  const canStartNewThread = canCreateThread(suggestionThreads, activeSuggestionThreadId);
  const atThreadLimit = suggestionThreads.length >= MAX_THREADS;
  const companyBriefSources = Array.isArray(coachResult?.company_brief_sources) ? coachResult.company_brief_sources : [];
  const companyBriefLimited = Boolean(coachResult?.company_brief_limited);
  const companyContextHasValues = Boolean(companyContextName || companyContextWebsite);
  const companyContextStatusText = companyContextHasValues
    ? companyContextSaveState === 'saving'
      ? 'Saving...'
      : companyContextSaveState === 'saved'
        ? 'Saved'
        : ''
    : '';
  const companyContextStatusClassName = companyContextSaveState === 'saving'
    ? 'text-blue-700'
    : companyContextSaveState === 'saved'
      ? 'text-emerald-700'
      : 'text-slate-500';
  const isCustomPromptResponse = coachIntentKey === 'custom_prompt';
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
  if (coachIntentKey === 'company_brief' && companyBriefSources.length > 0) {
    coachResponseMetaParts.push(
      `${companyBriefSources.length} source${companyBriefSources.length === 1 ? '' : 's'}`,
    );
  }
  if (coachIntentKey === 'company_brief' && companyBriefLimited) {
    coachResponseMetaParts.push('Limited public info found');
  }
  const coachResponseMeta = coachResponseMetaParts.join(' · ');
  const canRunCoach = Boolean(canReevaluate) && !requiresRecipientVerification;

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
    <SuggestionCoachPanel
      activeThread={activeThread}
      activeThreadEntryCount={activeThreadEntryCount}
      atThreadLimit={atThreadLimit}
      canStartNewThread={canStartNewThread}
      coachCached={coachCached}
      coachError={coachError}
      coachLoading={coachLoading}
      coachNotConfigured={coachNotConfigured}
      coachResponseLabel={coachResponseLabel}
      coachResponseMeta={coachResponseMeta}
      coachResponseText={coachResponseText}
      companyBriefSources={coachIntentKey === 'company_brief' ? companyBriefSources : []}
      companyContextName={companyContextName}
      companyContextNameInputRef={companyContextNameInputRef}
      companyContextSaveError={companyContextSaveError}
      companyContextStatusClassName={companyContextStatusClassName}
      companyContextStatusText={companyContextStatusText}
      companyContextValidationError={companyContextValidationError}
      companyContextWebsite={companyContextWebsite}
      customPromptText={customPromptText}
      deletingThreadId={deletingThreadId}
      disableCompanyBrief={!canRunCoach}
      disableCustomPrompt={!canRunCoach}
      disableSuggestedPrompts={!canRunCoach}
      expandedSuggestionIds={expandedSuggestionIds}
      isApplyingReviewSuggestion={isApplyingReviewSuggestion}
      isCoachResponseCopied={isCoachResponseCopied}
      isCustomPromptResponse={isCustomPromptResponse}
      isSavingCompanyContext={isSavingCompanyContext}
      leftDocLabel={CONFIDENTIAL_LABEL}
      onCancelDelete={handleCancelDelete}
      onCancelRename={handleCancelRename}
      onClearCoachResponse={clearCoachResponse}
      onClosePendingReviewSuggestion={() => {
        setPendingReviewSuggestion(null);
        setIsApplyingReviewSuggestion(false);
      }}
      onCompanyContextBlur={() => {}}
      onCompanyContextNameChange={(value) => {
        setCompanyContextName(value);
        setCompanyContextValidationError('');
        setCompanyContextSaveError('');
        setCompanyContextSaveState('idle');
        setDraftDirty(true);
      }}
      onCompanyContextWebsiteChange={(value) => {
        setCompanyContextWebsite(value);
        setCompanyContextSaveError('');
        setCompanyContextSaveState('idle');
        setDraftDirty(true);
      }}
      onConfirmCoachSuggestionApply={confirmCoachSuggestionApply}
      onConfirmDeleteThread={handleConfirmDeleteThread}
      onConfirmRename={handleConfirmRename}
      onCopyCoachResponse={copyCoachResponse}
      onCopyPendingProposedText={copyPendingProposedText}
      onCustomPromptKeyDown={handleCustomPromptKeyDown}
      onCustomPromptTextChange={setCustomPromptText}
      onDeleteThread={handleDeleteThread}
      onDismissSuggestion={dismissSuggestion}
      onOpenCoachSuggestionReview={openCoachSuggestionReview}
      onRetryCompanyContextSave={() => {
        if (saveDraftMutation.isPending) {
          return;
        }
        setIsSavingCompanyContext(true);
        setCompanyContextSaveState('saving');
        setCompanyContextSaveError('');
        saveDraftMutation.mutate({ stepToSave: 2, silent: true });
      }}
      onRunCompanyBrief={runCompanyBrief}
      onRunCustomPrompt={runCustomPromptCoach}
      onRunSuggestedPrompt={(option) => {
        const request = buildCoachActionRequest(option, selectionContext);
        if (!request) return;
        runCoach(request);
      }}
      onSelectThread={handleSelectThread}
      onStartNewThread={handleStartNewThread}
      onStartRename={handleStartRename}
      onToggleSuggestionExpanded={toggleSuggestionExpanded}
      onToggleThreadHistory={() => setShowThreadHistory((value) => !value)}
      onRenameInputValueChange={setRenameInputValue}
      pendingReviewSuggestion={pendingReviewSuggestion}
      renamingThreadId={renamingThreadId}
      renameInputValue={renameInputValue}
      rightDocLabel={SHARED_LABEL}
      showThreadHistory={showThreadHistory}
      suggestedPromptOptions={DOCUMENT_COMPARISON_COACH_ACTIONS}
      suggestionThreads={suggestionThreads}
      supplementaryAlert={
        !canReevaluate ? (
          <p className="text-xs text-amber-700">AI support is disabled for this shared link.</p>
        ) : null
      }
      visibleCoachSuggestions={visibleCoachSuggestions}
    />
  );

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <RequestAgreementConfirmDialog
        open={requestAgreementDialogOpen}
        onOpenChange={setRequestAgreementDialogOpen}
        onConfirm={handleRequestAgreementConfirm}
        isPending={markOutcomeMutation.isPending}
      />
      <ComparisonWorkflowShell
        title="Opportunity Workspace"
        subtitle="Review recipient-safe shared history and AI mediation insights."
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
              <CardContent className="pt-0 space-y-4">
                {step === 0 ? (
                  <div className="grid gap-6 sm:grid-cols-2">
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sent by</p>
                        <p className="text-sm font-medium text-slate-900 break-all">
                          {senderEmail || 'Unavailable'}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Status
                          </p>
                          <Badge className={`border font-medium ${getPrimaryStatusClass(parentPrimaryStatusKey)}`}>
                            {parentPrimaryStatusLabel}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {renderActionButtons(step0StatusActions)}
                        </div>
                        {canUpdateOutcomeFromStep0 && outcomeHelperText ? (
                          <p className="text-xs text-slate-500">{outcomeHelperText}</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sent to</p>
                        <p className="text-sm font-medium text-slate-900 break-all">
                          {recipientEmailDisplay || 'Unavailable until verification'}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Downloads
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          {renderActionButtons(step0DownloadActions)}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
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
                )}
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

            {/* ── Canonical thread-state banner ───────────────────────── */}
            {sharedReportStatusBanner ? (
              <Alert className={getStatusBannerClass(sharedReportStatusBanner.tone)}>
                <AlertDescription>{sharedReportStatusBanner.text}</AlertDescription>
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
            <ComparisonDetailTabs
              activeTab={recipientDetailTab}
              onTabChange={setRecipientDetailTab}
              hasReportBadge={hasStep0Report}
              tabOrder={['details', 'report']}
              detailsTabLabel="Opportunity"
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
                noReportMessage: 'No baseline AI mediation review is available yet for this opportunity.',
                report: baselineReport,
                recommendation: step0Recommendation,
                timelineItems,
              }}
              proposalDetailsProps={{
                description: 'Read-only cumulative shared history. Each round stays labeled by author and remains immutable.',
                documents: sharedHistoryEntries.length > 0
                  ? sharedHistoryEntries.map((entry) => ({
                      label:
                        entry.round_number
                          ? `Round ${entry.round_number} - ${entry.visibility_label || `Shared by ${entry.author_label || getPartyRoleLabel(entry.author_role)}`}`
                          : (entry.visibility_label || `Shared by ${entry.author_label || getPartyRoleLabel(entry.author_role)}`),
                      text: entry.text || '',
                      html: entry.html || '',
                      badges: [
                        entry.source || 'typed',
                        entry.author_label || getPartyRoleLabel(entry.author_role),
                      ],
                    }))
                  : [
                      {
                        label: baselineSharedDocument.label || 'Round 1 - Shared by Proposer',
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
                  {requiresRecipientVerification ? 'Verify access to continue' : 'Edit Opportunity'}
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
              onSaveDraft={() => {
                setIsSavingCompanyContext(true);
                setCompanyContextSaveState('saving');
                setCompanyContextSaveError('');
                saveDraftMutation.mutate({ stepToSave: 2 });
              }}
              onBack={() => setStep(1)}
              onContinue={runEvaluationFromStep2}
              continueLabel={getRunAiMediationLabel({
                isPending: evaluateMutation.isPending,
                hasExisting: Boolean(latestEvaluation),
              })}
              continueDisabled={evaluateMutation.isPending || !canReevaluate || requiresRecipientVerification}
              coachPanel={coachPanelNode}
              focusEditorRequest={focusEditorRequest}
              replaceSelectionRequest={replaceSelectionRequest}
              onReplaceSelectionApplied={handleReplaceSelectionApplied}
              onSelectionChange={({ text: selectedText, range }) => {
                const activeDoc =
                  allDisplayDocuments.find(
                    (document) => document.id === (recipientActiveDocId || allDisplayDocuments[0]?.id),
                  ) || null;
                const normalized = String(selectedText || '').trim();
                setSelectionContext({
                  side: activeDoc?.visibility === VISIBILITY_CONFIDENTIAL ? 'a' : 'b',
                  text: normalized,
                  range:
                    range && Number.isFinite(range.from) && Number.isFinite(range.to)
                      ? { from: Number(range.from), to: Number(range.to) }
                      : null,
                });
              }}
              onRenameDoc={handleRenameDoc}
            />
          </DocumentComparisonEditorErrorBoundary>
        ) : null}

        {/* ════════════════════════════════════════════════════════════
            STEP 3 — Evaluation results  (shared ComparisonEvaluationStep)
            ════════════════════════════════════════════════════════════ */}
        {step === 3 ? (
          <ComparisonEvaluationStep
            stepTitle={`Step 3: ${MEDIATION_REVIEW_LABEL}`}
            stepDescription={sendDirectionCopy.step3Description}
            actionSlot={
              <>
                <Button
                  type="button"
                  onClick={sendToCounterparty}
                  disabled={
                    sendBackMutation.isPending ||
                    saveDraftMutation.isPending ||
                    !canSendBack ||
                    Boolean(parentThreadState?.isClosed) ||
                    isSentToCounterparty ||
                    requiresRecipientVerification
                  }
                >
                  {sendBackMutation.isPending
                    ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    : <Send className="w-4 h-4 mr-2" />}
                  {getSharedReportSendActionLabel(draftDocumentOwner, {
                    isSent: isSentToCounterparty,
                    isPending: sendBackMutation.isPending,
                  })}
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
            detailsTabLabel="Opportunity"
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
              noReportMessage: sendDirectionCopy.noReportMessage,
              report: updatedRecipientReport,
              recommendation: step3Recommendation,
              timelineItems,
            }}
            proposalDetailsProps={{
              description: sendDirectionCopy.proposalDetailsDescription,
              leftLabel: CONFIDENTIAL_LABEL,
              rightLabel: SHARED_LABEL,
              leftText: step3Bundles.confidential.text,
              leftHtml: step3Bundles.confidential.html,
              rightText: step3Bundles.shared.text,
              rightHtml: step3Bundles.shared.html,
              leftBadges: [step3Bundles.confidential.source || 'typed'],
              rightBadges: [step3Bundles.shared.source || 'typed'],
            }}
            onBack={() => setStep(2)}
            backLabel="Back to Editor"
          />
        ) : null}
      </ComparisonWorkflowShell>
    </div>
  );
}
