import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { sharedReportsClient } from '@/api/sharedReportsClient';
import { documentComparisonsClient } from '@/api/documentComparisonsClient';
import { useAuth } from '@/lib/AuthContext';
import DocumentRichEditor from '@/components/document-comparison/DocumentRichEditor';
import DocumentComparisonEditorErrorBoundary from '@/components/document-comparison/DocumentComparisonEditorErrorBoundary';
import { sanitizeEditorHtml } from '@/components/document-comparison/editorSanitization';
import {
  ComparisonDetailTabs,
  buildOverviewBullets,
} from '@/components/document-comparison/ComparisonDetailTabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Save,
  Send,
  Upload,
} from 'lucide-react';

const CONFIDENTIAL_LABEL = 'Confidential Information';
const SHARED_LABEL = 'Shared Information';
const MAX_PREVIEW_CHARS = 500;
const TOTAL_WORKFLOW_STEPS = 3;

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function previewSnippet(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= MAX_PREVIEW_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_PREVIEW_CHARS)}...`;
}

function formatFileSize(bytes) {
  const numeric = Number(bytes || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '0 B';
  }
  if (numeric < 1024) {
    return `${numeric} B`;
  }
  if (numeric < 1024 * 1024) {
    return `${(numeric / 1024).toFixed(1)} KB`;
  }
  return `${(numeric / (1024 * 1024)).toFixed(1)} MB`;
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
  const html = sanitizeEditorHtml(asText(safePayload.html) || textToHtml(text));
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

function buildSharedPayloadFromState(state) {
  return {
    label: SHARED_LABEL,
    text: String(state.docBText || ''),
    html: sanitizeEditorHtml(state.docBHtml || textToHtml(state.docBText || '')),
    json: state.docBJson || null,
    source: asText(state.docBSource) || 'typed',
    files: Array.isArray(state.docBFiles) ? state.docBFiles : [],
  };
}

function buildConfidentialPayloadFromState(state) {
  const text = String(state.docAText || '');
  return {
    label: CONFIDENTIAL_LABEL,
    text,
    notes: text,
    html: sanitizeEditorHtml(state.docAHtml || textToHtml(text)),
    json: state.docAJson || null,
    source: asText(state.docASource) || 'typed',
    files: Array.isArray(state.docAFiles) ? state.docAFiles : [],
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
  const [docAText, setDocAText] = useState('');
  const [docBText, setDocBText] = useState('');
  const [docAHtml, setDocAHtml] = useState('<p></p>');
  const [docBHtml, setDocBHtml] = useState('<p></p>');
  const [docAJson, setDocAJson] = useState(null);
  const [docBJson, setDocBJson] = useState(null);
  const [docASource, setDocASource] = useState('typed');
  const [docBSource, setDocBSource] = useState('typed');
  const [docAFiles, setDocAFiles] = useState([]);
  const [docBFiles, setDocBFiles] = useState([]);
  const [docASelectedFile, setDocASelectedFile] = useState(null);
  const [docBSelectedFile, setDocBSelectedFile] = useState(null);
  const [docAPreviewSnippet, setDocAPreviewSnippet] = useState('');
  const [docBPreviewSnippet, setDocBPreviewSnippet] = useState('');
  const [importingSide, setImportingSide] = useState(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [latestEvaluatedReport, setLatestEvaluatedReport] = useState(null);
  const [stepHydrated, setStepHydrated] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationRequested, setVerificationRequested] = useState(false);
  const [forcedMismatchInvitedEmail, setForcedMismatchInvitedEmail] = useState('');
  const [recipientDetailTab, setRecipientDetailTab] = useState('overview');

  const docAInputFileRef = useRef(null);
  const docBInputFileRef = useRef(null);
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
  const baselineConfidentialDocument = useMemo(
    () =>
      coercePayloadToDocument(
        baselineConfidentialPayload,
        CONFIDENTIAL_LABEL,
        String(baselineConfidentialPayload?.text || baselineConfidentialPayload?.notes || ''),
      ),
    [baselineConfidentialPayload],
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
  const authorizedForCurrentUser = Boolean(share?.authorization?.authorized_for_current_user);
  const requiresRecipientVerification =
    Boolean(isAuthenticated && invitedEmail) && !authorizedForCurrentUser;

  const canEditShared = Boolean(share?.permissions?.can_edit_shared);
  const canEditConfidential = Boolean(share?.permissions?.can_edit_confidential);
  const canReevaluate = Boolean(share?.permissions?.can_reevaluate);
  const canSendBack = Boolean(share?.permissions?.can_send_back);

  const hasActiveDraft = Boolean(recipientDraft && asText(recipientDraft.status).toLowerCase() === 'draft');
  const isSentToProposer =
    Boolean(latestSentRevision && asText(latestSentRevision.status).toLowerCase() === 'sent') && !hasActiveDraft;

  useEffect(() => {
    setStep(0);
    setStepHydrated(false);
    setVerificationCode('');
    setVerificationRequested(false);
    setForcedMismatchInvitedEmail('');
    setRecipientDetailTab('overview');
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

    setTitle(asText(comparison?.title) || asText(parent?.title) || 'Shared Report');

    setDocAText(recipientConfidentialDocument.text);
    setDocAHtml(recipientConfidentialDocument.html);
    setDocAJson(recipientConfidentialDocument.json);
    setDocASource(recipientConfidentialDocument.source);
    setDocAFiles(recipientConfidentialDocument.files);
    setDocAPreviewSnippet(
      previewSnippet(recipientConfidentialDocument.text || htmlToText(recipientConfidentialDocument.html)),
    );

    setDocBText(recipientSharedDocument.text);
    setDocBHtml(recipientSharedDocument.html);
    setDocBJson(recipientSharedDocument.json);
    setDocBSource(recipientSharedDocument.source);
    setDocBFiles(recipientSharedDocument.files);
    setDocBPreviewSnippet(
      previewSnippet(recipientSharedDocument.text || htmlToText(recipientSharedDocument.html)),
    );

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

  const buildDraftInput = (stepToSave = step) => ({
    shared_payload: buildSharedPayloadFromState({
      docBText,
      docBHtml,
      docBJson,
      docBSource,
      docBFiles,
    }),
    recipient_confidential_payload: buildConfidentialPayloadFromState({
      docAText,
      docAHtml,
      docAJson,
      docASource,
      docAFiles,
    }),
    workflow_step: clampStep(stepToSave, 0),
    editor_state: {
      step: clampStep(stepToSave, 0),
      mode: 'recipient_document_comparison_v1',
      updated_at: new Date().toISOString(),
    },
  });

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

  const applyImportedContent = (side, file, extracted) => {
    const rawText = asText(extracted?.text) || htmlToText(extracted?.html || '');
    const html = sanitizeEditorHtml(asText(extracted?.html) || textToHtml(rawText));
    const text = rawText || htmlToText(html);

    if (!text && !html) {
      throw new Error('No readable content was extracted from the selected file');
    }

    if (side === 'a') {
      setDocAText(text);
      setDocAHtml(html);
      setDocAJson(null);
      setDocASource('uploaded');
      setDocAFiles([fileToMetadata(file)]);
      setDocAPreviewSnippet(previewSnippet(text || htmlToText(html)));
    } else {
      setDocBText(text);
      setDocBHtml(html);
      setDocBJson(null);
      setDocBSource('uploaded');
      setDocBFiles([fileToMetadata(file)]);
      setDocBPreviewSnippet(previewSnippet(text || htmlToText(html)));
    }

    setDraftDirty(true);
  };

  const importForSide = async (side, fileOverride = null) => {
    const selectedFile = fileOverride || (side === 'a' ? docASelectedFile : docBSelectedFile);
    if (!selectedFile) {
      toast.error('Select a .docx or .pdf file first.');
      return;
    }

    try {
      documentComparisonsClient.validateImportFile(selectedFile);
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

    setImportingSide(side);
    try {
      const extracted = await documentComparisonsClient.extractDocumentFromFile(selectedFile, {
        signal: nextController.signal,
      });

      if (
        nextController.signal.aborted ||
        activeImportRequestRef.current.id !== nextRequestId
      ) {
        return;
      }

      applyImportedContent(side, selectedFile, extracted);
      toast.success(`${selectedFile.name} imported`);
    } catch (error) {
      if (
        nextController.signal.aborted ||
        activeImportRequestRef.current.id !== nextRequestId ||
        isAbortError(error)
      ) {
        return;
      }
      toast.error(error?.message || 'Failed to import file');
    } finally {
      if (activeImportRequestRef.current.id === nextRequestId) {
        activeImportRequestRef.current = {
          id: nextRequestId,
          controller: null,
        };
        setImportingSide(null);
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
  const step0OverviewBullets = buildOverviewBullets(baselineReport);
  const step3OverviewBullets = buildOverviewBullets(updatedRecipientReport);
  const latestEvaluationStatus = asText(latestEvaluation?.status).toLowerCase();
  const latestEvaluationErrorCode = asText(
    latestEvaluation?.result?.error?.code || latestEvaluation?.error?.code,
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
    (latestEvaluationStatus === 'failed' || Boolean(latestEvaluation?.result?.error));
  const step3EvaluationFailureMessage =
    asText(latestEvaluation?.result?.error?.message) || 'Evaluation failed. Please retry.';
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

  const renderImportPanel = ({ side, label, selectedFile, setSelectedFile, preview, source, files, fileRef }) => {
    const isImporting = importingSide === side;
    const isAnyImporting = Boolean(importingSide);
    const canEditSide = (side === 'a' ? canEditConfidential : canEditShared) && !requiresRecipientVerification;

    return (
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{label} (Upload/Import)</CardTitle>
          <CardDescription>Upload a DOCX or PDF and import extracted content into this document.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept=".docx,.pdf"
            className="hidden"
            data-testid={`import-file-input-${side}`}
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              event.target.value = '';
              setSelectedFile(file);
              if (!file || !canEditSide) {
                return;
              }
              void importForSide(side, file);
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={!canEditSide}
            >
              <Upload className="w-4 h-4 mr-2" />
              Choose File
            </Button>

            <Button
              type="button"
              onClick={() => importForSide(side)}
              disabled={!canEditSide || !selectedFile || isAnyImporting}
              data-testid={`import-button-${side}`}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isImporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
              {isImporting ? 'Importing...' : 'Import'}
            </Button>

            <Badge variant="outline">{source || 'typed'}</Badge>
          </div>

          {selectedFile ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <p className="font-medium break-all">{selectedFile.name}</p>
              <p className="text-xs text-slate-500">{formatFileSize(selectedFile.size)}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No file selected.</p>
          )}

          {files.length > 0 ? (
            <p className="text-xs text-slate-500">Last imported: {files[0]?.filename || 'Unknown file'}</p>
          ) : null}

          <div className="space-y-1">
            <Label className="text-sm font-semibold">Preview</Label>
            <div
              className="min-h-[130px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 whitespace-pre-wrap"
              data-testid={`import-preview-${side}`}
            >
              {preview || 'Imported content preview will appear here.'}
            </div>
            {isImporting ? <p className="text-xs text-slate-500">Importing...</p> : null}
          </div>
          {!canEditSide ? (
            <p className="text-xs text-amber-700">
              {requiresRecipientVerification
                ? 'Verify access to edit this section.'
                : 'This section is read-only for this link.'}
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 xl:px-12 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-slate-900">Document Comparison</h1>
          <p className="text-slate-500">
            Compare Shared Information and Confidential Information with recipient-safe reporting.
          </p>
        </div>

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
        </Card>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-slate-700">Step {step} of {TOTAL_WORKFLOW_STEPS}</span>
            <span className="text-slate-500">{Math.round(progress)}% complete</span>
          </div>
          <Progress value={progress} className="h-3" />
        </div>

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

        {requiresRecipientVerification ? (
          <Alert className="bg-amber-50 border-amber-200">
            <AlertDescription className="text-amber-900 space-y-3">
              <p>
                This link was sent to <span className="font-semibold">{invitedEmail}</span>.
                {currentUserEmail
                  ? ` You are currently signed in as ${currentUserEmail}.`
                  : ''}
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

        {isSentToProposer ? (
          <Alert className="bg-emerald-50 border-emerald-200">
            <AlertDescription className="text-emerald-800">
              Sent to proposer on {formatDateTime(latestSentRevision?.updated_at)}.
            </AlertDescription>
          </Alert>
        ) : null}

        {step === 0 ? (
          <div className="space-y-6">
            <ComparisonDetailTabs
              activeTab={recipientDetailTab}
              onTabChange={setRecipientDetailTab}
              hasReportBadge={hasStep0Report}
              overviewProps={{
                recommendation: step0Recommendation,
                overviewBullets: step0OverviewBullets,
                isEvaluationRunning: false,
                isPollingTimedOut: false,
                isEvaluationNotConfigured: false,
                showConfidentialityWarning: false,
                confidentialityWarningMessage: '',
                confidentialityWarningDetails: '',
                isEvaluationFailed: false,
                evaluationFailureBannerMessage: '',
                hasReport: hasStep0Report,
                noReportMessage: 'No baseline evaluation is available yet for this proposal.',
                timelineItems: baseTimelineItems,
              }}
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
              }}
              proposalDetailsProps={{
                description: 'Read-only baseline proposal content shared by the proposer.',
                leftLabel: baselineConfidentialDocument.label || CONFIDENTIAL_LABEL,
                rightLabel: baselineSharedDocument.label || SHARED_LABEL,
                leftText: baselineConfidentialDocument.text || '',
                leftHtml: baselineConfidentialDocument.html || '',
                rightText: baselineSharedDocument.text || '',
                rightHtml: baselineSharedDocument.html || '',
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

        {step === 1 ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Step 1: Upload and Import</CardTitle>
                <CardDescription>
                  Upload DOCX or PDF files and import extracted content before editing.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2 max-w-xl">
                  <Label>Comparison Title</Label>
                  <Input
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setDraftDirty(true);
                    }}
                    placeholder="e.g., Mutual NDA comparison"
                    disabled={requiresRecipientVerification}
                  />
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {renderImportPanel({
                    side: 'a',
                    label: CONFIDENTIAL_LABEL,
                    selectedFile: docASelectedFile,
                    setSelectedFile: setDocASelectedFile,
                    preview: docAPreviewSnippet,
                    source: docASource,
                    files: docAFiles,
                    fileRef: docAInputFileRef,
                  })}
                  {renderImportPanel({
                    side: 'b',
                    label: SHARED_LABEL,
                    selectedFile: docBSelectedFile,
                    setSelectedFile: setDocBSelectedFile,
                    preview: docBPreviewSnippet,
                    source: docBSource,
                    files: docBFiles,
                    fileRef: docBInputFileRef,
                  })}
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep(0)}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Overview
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => saveDraftMutation.mutate({ stepToSave: 1 })}
                  disabled={saveDraftMutation.isPending || requiresRecipientVerification}
                >
                  {saveDraftMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  {saveDraftMutation.isPending ? 'Saving...' : 'Save Draft'}
                </Button>
                <Button
                  type="button"
                  onClick={() => jumpStep(2)}
                  disabled={saveDraftMutation.isPending || requiresRecipientVerification}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Continue to Editor
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <DocumentComparisonEditorErrorBoundary
            onRetry={() => setStep(2)}
            onBackToStep1={() => setStep(1)}
          >
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Step 2: Editor</CardTitle>
                  <CardDescription>Shared Information is prefilled from proposer baseline until you edit it.</CardDescription>
                </CardHeader>
              </Card>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                <Card className="border border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base">{CONFIDENTIAL_LABEL}</CardTitle>
                    <CardDescription>Private to you and used in AI analysis.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <DocumentRichEditor
                      label={CONFIDENTIAL_LABEL}
                      content={docAJson || docAHtml}
                      placeholder={`Edit ${CONFIDENTIAL_LABEL}...`}
                      minHeightClassName="min-h-[500px]"
                      scrollContainerClassName="h-[500px]"
                      maxCharacters={300000}
                      data-testid="doc-a-editor"
                      onChange={({ html, text, json }) => {
                        if (!canEditConfidential || requiresRecipientVerification) return;
                        setDocAText(text);
                        setDocAHtml(html);
                        setDocAJson(json);
                        setDocASource('typed');
                        setDraftDirty(true);
                      }}
                    />
                  </CardContent>
                </Card>

                <Card className="border border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base">{SHARED_LABEL}</CardTitle>
                    <CardDescription>Visible to both sides.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <DocumentRichEditor
                      label={SHARED_LABEL}
                      content={docBJson || docBHtml}
                      placeholder={`Edit ${SHARED_LABEL}...`}
                      minHeightClassName="min-h-[500px]"
                      scrollContainerClassName="h-[500px]"
                      maxCharacters={300000}
                      data-testid="doc-b-editor"
                      onChange={({ html, text, json }) => {
                        if (!canEditShared || requiresRecipientVerification) return;
                        setDocBText(text);
                        setDocBHtml(html);
                        setDocBJson(json);
                        setDocBSource('typed');
                        setDraftDirty(true);
                      }}
                    />
                  </CardContent>
                </Card>
              </div>

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Upload
                </Button>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => saveDraftMutation.mutate({ stepToSave: 2 })}
                    disabled={saveDraftMutation.isPending || requiresRecipientVerification}
                  >
                    {saveDraftMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    {saveDraftMutation.isPending ? 'Saving...' : 'Save Draft'}
                  </Button>
                  <Button
                    type="button"
                    onClick={runEvaluationFromStep2}
                    disabled={evaluateMutation.isPending || !canReevaluate || requiresRecipientVerification}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {evaluateMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Evaluating...
                      </>
                    ) : (
                      <>
                        Run Evaluation
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </DocumentComparisonEditorErrorBoundary>
        ) : null}

        {step === 3 ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Step 3: Evaluation</CardTitle>
                <CardDescription>Run and review the latest recipient-side evaluation.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
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
                    onClick={() => sendBackMutation.mutate()}
                    disabled={sendBackMutation.isPending || !canSendBack || isSentToProposer || requiresRecipientVerification}
                  >
                    {sendBackMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                    {isSentToProposer ? 'Sent to proposer' : sendBackMutation.isPending ? 'Sending...' : 'Send back to proposer'}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(2)}
                    disabled={requiresRecipientVerification}
                  >
                    Edit again
                  </Button>
                </div>
              </CardContent>
            </Card>

            <ComparisonDetailTabs
              activeTab={recipientDetailTab}
              onTabChange={setRecipientDetailTab}
              hasReportBadge={hasStep3Report}
              overviewProps={{
                recommendation: step3Recommendation,
                overviewBullets: step3OverviewBullets,
                isEvaluationRunning: step3IsEvaluationRunning,
                isPollingTimedOut: false,
                isEvaluationNotConfigured: step3IsEvaluationNotConfigured,
                showConfidentialityWarning: false,
                confidentialityWarningMessage: '',
                confidentialityWarningDetails: '',
                isEvaluationFailed: step3IsEvaluationFailed,
                evaluationFailureBannerMessage: step3EvaluationFailureMessage,
                hasReport: hasStep3Report,
                noReportMessage: 'No recipient evaluation is available yet. Run evaluation to generate one.',
                timelineItems: step3TimelineItems,
              }}
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
              }}
              proposalDetailsProps={{
                description: 'Read-only current proposal state after recipient edits.',
                leftLabel: CONFIDENTIAL_LABEL,
                rightLabel: SHARED_LABEL,
                leftText: docAText,
                leftHtml: docAHtml,
                rightText: docBText,
                rightHtml: docBHtml,
                leftBadges: [docASource || 'typed'],
                rightBadges: [docBSource || 'typed'],
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
