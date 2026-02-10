import React, { useMemo, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { getProposalId } from '@/lib/utils';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import DeleteDraftDialog from '../components/proposal/DeleteDraftDialog';
import { toast } from 'sonner';
import {
  ArrowLeft, ArrowRight, FileText, BarChart3, Clock, CheckCircle2,
  AlertTriangle, XCircle, MessageSquare, RefreshCw,
  Send, Sparkles, ChevronRight, Upload, ThumbsUp
} from 'lucide-react';
import { Label } from '@/components/ui/label';

const StatusBadge = ({ status }) => {
  const config = {
    draft: { color: 'bg-slate-100 text-slate-700', label: 'Draft' },
    sent: { color: 'bg-blue-100 text-blue-700', label: 'Sent' },
    received: { color: 'bg-amber-100 text-amber-700', label: 'Received' },
    under_verification: { color: 'bg-purple-100 text-purple-700', label: 'Under Review' },
    re_evaluated: { color: 'bg-indigo-100 text-indigo-700', label: 'Re-evaluated' },
    mutual_interest: { color: 'bg-green-100 text-green-700', label: 'Mutual Interest' },
    revealed: { color: 'bg-emerald-100 text-emerald-700', label: 'Revealed' },
    closed: { color: 'bg-slate-100 text-slate-600', label: 'Closed' },
    withdrawn: { color: 'bg-red-100 text-red-700', label: 'Withdrawn' }
  };
  const { color, label } = config[status] || config.draft;
  return <Badge className={`${color} font-medium`}>{label}</Badge>;
};

const SHARED_ERROR_MESSAGES = {
  AUTH_REQUIRED: 'Please sign in to continue.',
  TOKEN_NOT_FOUND: 'This shared link is invalid or no longer exists.',
  TOKEN_EXPIRED: 'This shared link has expired. Ask for a fresh link.',
  MAX_VIEWS_REACHED: 'This shared link has reached its view limit.',
  RECIPIENT_MISMATCH: 'This link belongs to a different recipient account.',
  RECIPIENT_REQUIRED: 'This shared link is invalid. Ask the sender to share the report again.',
  TOKEN_INACTIVE: 'This shared link is inactive.',
  PROPOSAL_NOT_FOUND: 'The linked proposal could not be found.',
  PROPOSAL_LINK_MISSING: 'This shared link is not tied to a proposal.'
};

const NO_SHARED_WORKSPACE_LINK_MESSAGE =
  'No shared workspace link found. Ask the sender to share again.';

function normalizeComparisonSpanLevel(level) {
  const normalized = String(level || '').trim().toLowerCase();
  if (normalized === 'confidential' || normalized === 'hidden') return 'confidential';
  if (normalized === 'partial') return 'confidential';
  return null;
}

function normalizeComparisonSpans(spans, textLength) {
  if (!Array.isArray(spans)) return [];
  return spans
    .map((span) => {
      const rawStart = Number(span?.start);
      const rawEnd = Number(span?.end);
      const level = normalizeComparisonSpanLevel(span?.level);
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || !level) return null;

      const start = Math.max(0, Math.min(rawStart, textLength));
      const end = Math.max(0, Math.min(rawEnd, textLength));
      if (end <= start) return null;
      return { start, end, level };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

function renderReadOnlyComparisonText(text, spans) {
  if (!text) {
    return <p className="text-sm text-slate-500 italic">No text available.</p>;
  }

  const normalizedSpans = normalizeComparisonSpans(spans, text.length);
  if (normalizedSpans.length === 0) {
    return <div className="whitespace-pre-wrap font-mono text-sm text-slate-800">{text}</div>;
  }

  const parts = [];
  let lastIndex = 0;

  normalizedSpans.forEach((span) => {
    if (span.start > lastIndex) {
      parts.push({ text: text.slice(lastIndex, span.start), highlight: null });
    }
    parts.push({ text: text.slice(span.start, span.end), highlight: span.level });
    lastIndex = span.end;
  });

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), highlight: null });
  }

  return (
    <div className="whitespace-pre-wrap font-mono text-sm text-slate-800">
      {parts.map((part, idx) => (
        <span
          key={`comparison-part-${idx}`}
          className={part.highlight === 'confidential' ? 'bg-red-200 text-red-900 px-0.5 rounded' : ''}
        >
          {part.text}
        </span>
      ))}
    </div>
  );
}

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function isProposalOwner(proposal, user) {
  if (!proposal || !user) return false;

  const userId = String(user?.id || '').trim();
  const ownerUserId = String(proposal?.party_a_user_id || proposal?.created_by_user_id || '').trim();
  if (userId && ownerUserId && userId === ownerUserId) {
    return true;
  }

  const userEmail = normalizeEmail(user?.email);
  const ownerEmail = normalizeEmail(proposal?.party_a_email);
  return Boolean(userEmail && ownerEmail && userEmail === ownerEmail);
}

async function getActiveShareLinkForRecipient(proposalId) {
  const normalizedProposalId = String(proposalId || '').trim();
  if (!normalizedProposalId) {
    return {
      ok: false,
      message: 'Proposal ID is required'
    };
  }

  try {
    const result = await base44.functions.invoke('GetActiveShareLinkForRecipient', {
      proposalId: normalizedProposalId
    });
    const data = result?.data;
    if (data?.ok && data?.token) {
      return {
        ok: true,
        token: data.token
      };
    }
    return {
      ok: false,
      message: data?.message || NO_SHARED_WORKSPACE_LINK_MESSAGE
    };
  } catch (error) {
    const message =
      error?.data?.message ||
      error?.response?.data?.message ||
      error?.message ||
      NO_SHARED_WORKSPACE_LINK_MESSAGE;
    return {
      ok: false,
      message
    };
  }
}

function extractSharedInvokeError(error) {
  const statusCode =
    error?.status ||
    error?.response?.status ||
    error?.originalError?.response?.status ||
    null;
  const body =
    error?.data ||
    error?.response?.data ||
    error?.originalError?.response?.data ||
    null;
  const reasonCode = body?.code || body?.reason || body?.errorCode || error?.code || 'INVOKE_ERROR';

  return {
    statusCode,
    reasonCode,
    body,
    message: body?.message || error?.message || 'Failed to resolve shared report'
  };
}

function extractFunctionFailure(error, fallbackMessage) {
  const statusCode =
    error?.status ||
    error?.response?.status ||
    error?.originalError?.response?.status ||
    null;
  const body =
    error?.data ||
    error?.response?.data ||
    error?.originalError?.response?.data ||
    null;
  const reasonCode = body?.code || body?.reason || body?.errorCode || 'REQUEST_FAILED';
  const message = body?.message || error?.message || fallbackMessage;
  return {
    statusCode,
    reasonCode,
    message: `${message}${statusCode ? ` (HTTP ${statusCode})` : ''}`
  };
}

function dedupeById(records = []) {
  const byId = new Map();
  records.forEach((record, index) => {
    const key = String(record?.id || `row_${index}`);
    if (!byId.has(key)) {
      byId.set(key, record);
    }
  });
  return Array.from(byId.values()).sort((a, b) => {
    const aTime = new Date(a?.created_date || a?.updated_date || 0).getTime();
    const bTime = new Date(b?.created_date || b?.updated_date || 0).getTime();
    return bTime - aTime;
  });
}

function normalizeFallbackVisibility(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['hidden', 'not_shared', 'private', 'confidential', 'partial'].includes(normalized)) {
    return 'hidden';
  }
  return 'full';
}

function toFallbackResponseValue(rawValue) {
  if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    const type = String(rawValue.type || '').toLowerCase();
    if (type === 'range') {
      const minRaw = Number(rawValue.min);
      const maxRaw = Number(rawValue.max);
      return {
        value_type: 'range',
        value: null,
        range_min: Number.isFinite(minRaw) ? minRaw : null,
        range_max: Number.isFinite(maxRaw) ? maxRaw : null
      };
    }

    return {
      value_type: 'text',
      value: JSON.stringify(rawValue),
      range_min: null,
      range_max: null
    };
  }

  if (Array.isArray(rawValue)) {
    return {
      value_type: 'text',
      value: JSON.stringify(rawValue),
      range_min: null,
      range_max: null
    };
  }

  if (rawValue === null || rawValue === undefined) {
    return {
      value_type: 'text',
      value: '',
      range_min: null,
      range_max: null
    };
  }

  return {
    value_type: 'text',
    value: String(rawValue),
    range_min: null,
    range_max: null
  };
}

function buildFallbackResponsesFromStepState(stepState, proposalId) {
  const rawResponses = stepState?.responses;
  if (!rawResponses || typeof rawResponses !== 'object') return [];

  const rawVisibility = stepState?.visibilitySettings && typeof stepState.visibilitySettings === 'object'
    ? stepState.visibilitySettings
    : {};

  const rows = [];
  const seen = new Set();

  Object.entries(rawResponses).forEach(([responseKey, rawValue], index) => {
    if (responseKey.startsWith('_')) return;

    const [questionId, subjectSuffix] = responseKey.includes('__')
      ? responseKey.split('__')
      : [responseKey, null];
    if (!questionId) return;

    const normalizedSubject = String(subjectSuffix || '').trim().toLowerCase();
    const subject_party = normalizedSubject === 'b' || normalizedSubject === 'party_b' || normalizedSubject === 'recipient'
      ? 'b'
      : (normalizedSubject === 'shared' ? 'shared' : 'a');

    const dedupeKey = `${questionId}__${subject_party}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const parsed = toFallbackResponseValue(rawValue);
    const visibility = subject_party === 'b'
      ? 'full'
      : normalizeFallbackVisibility(rawVisibility[responseKey] ?? rawVisibility[questionId]);

    rows.push({
      id: `fallback_${proposalId || 'proposal'}_${index}_${dedupeKey}`,
      proposal_id: proposalId || null,
      question_id: questionId,
      entered_by_party: 'a',
      author_party: 'a',
      subject_party,
      is_about_counterparty: subject_party === 'b',
      value_type: parsed.value_type,
      value: parsed.value,
      range_min: parsed.range_min,
      range_max: parsed.range_max,
      visibility,
      created_date: null
    });
  });

  return rows;
}

function normalizeSnapshotEnteredByParty(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'b' || normalized === 'party_b' || normalized === 'recipient' || normalized === 'counterparty') {
    return 'b';
  }
  return 'a';
}

function buildFallbackResponsesFromInputSnapshot(inputSnapshot, proposalId) {
  const snapshotResponses = Array.isArray(inputSnapshot?.responses) ? inputSnapshot.responses : [];
  if (snapshotResponses.length === 0) return [];

  const rows = [];
  const seen = new Set();

  snapshotResponses.forEach((item, index) => {
    const questionId = String(item?.question_id || item?.questionId || '').trim();
    if (!questionId) return;

    const enteredByParty = normalizeSnapshotEnteredByParty(item?.party || item?.entered_by_party || item?.enteredByParty);
    const dedupeKey = `${questionId}__${enteredByParty}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const valueType = String(item?.value_type || item?.valueType || '').toLowerCase();
    const parsed = valueType === 'range'
      ? {
          value_type: 'range',
          value: null,
          range_min: Number.isFinite(Number(item?.range_min ?? item?.rangeMin))
            ? Number(item?.range_min ?? item?.rangeMin)
            : null,
          range_max: Number.isFinite(Number(item?.range_max ?? item?.rangeMax))
            ? Number(item?.range_max ?? item?.rangeMax)
            : null
        }
      : toFallbackResponseValue(item?.value);

    rows.push({
      id: `snapshot_${proposalId || 'proposal'}_${index}_${questionId}`,
      proposal_id: proposalId || null,
      question_id: questionId,
      entered_by_party: enteredByParty,
      author_party: enteredByParty,
      subject_party: enteredByParty === 'b' ? 'b' : 'a',
      is_about_counterparty: enteredByParty === 'b',
      value_type: parsed.value_type,
      value: parsed.value,
      range_min: parsed.range_min,
      range_max: parsed.range_max,
      visibility: normalizeFallbackVisibility(item?.visibility),
      created_date: null
    });
  });

  return rows;
}

async function invokeSharedResolver(token, options = {}) {
  const payload = {
    token,
    ...(typeof options.consumeView === 'boolean' ? { consumeView: options.consumeView } : {})
  };
  try {
    return await base44.functions.invoke('ResolveSharedReport', payload);
  } catch (error) {
    const parsed = extractSharedInvokeError(error);
    const missingResolver =
      parsed.statusCode === 404 &&
      (!parsed.body || (!parsed.body.code && !parsed.body.reason));

    if (!missingResolver) {
      throw error;
    }

    return base44.functions.invoke('GetSharedReportData', payload);
  }
}

export default function ProposalDetail() {
  const [user, setUser] = useState(null);
  const [isUserResolved, setIsUserResolved] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [sendReportModalOpen, setSendReportModalOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [recipientEdits, setRecipientEdits] = useState({});
  const [sendBackMessage, setSendBackMessage] = useState('');
  const [openingSharedWorkspace, setOpeningSharedWorkspace] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { search } = useLocation();

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const proposalId = params.get('id');
  const requestedTab = params.get('tab');
  const sharedToken = params.get('sharedToken');
  const sharedRole = params.get('role');
  const isRecipientView = Boolean(sharedToken && sharedRole === 'recipient');
  const isRecipientRoutedRequest = Boolean(sharedToken || sharedRole === 'recipient');

  useEffect(() => {
    if (requestedTab === 'evaluation' || requestedTab === 'overview') {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  useEffect(() => {
    let active = true;
    base44.auth.me()
      .then((me) => {
        if (active) setUser(me || null);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setIsUserResolved(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isRecipientRoutedRequest) return;

    let cancelled = false;

    const redirectToSharedWorkspace = async () => {
      if (sharedToken) {
        navigate(
          createPageUrl(`SharedReport?token=${encodeURIComponent(sharedToken)}`),
          { replace: true }
        );
        return;
      }

      if (!proposalId || !isUserResolved) return;

      const shareLink = await getActiveShareLinkForRecipient(proposalId);
      if (cancelled) return;

      if (shareLink.ok) {
        navigate(
          createPageUrl(`SharedReport?token=${encodeURIComponent(shareLink.token)}`),
          { replace: true }
        );
      }
    };

    redirectToSharedWorkspace();

    return () => {
      cancelled = true;
    };
  }, [isRecipientRoutedRequest, sharedToken, proposalId, isUserResolved, navigate]);

  const { data: sharedRecipientData, isLoading: loadingRecipientData, error: sharedRecipientError } = useQuery({
    queryKey: ['sharedRecipientData', sharedToken],
    queryFn: async () => {
      let result;
      try {
        result = await invokeSharedResolver(sharedToken, { consumeView: false });
      } catch (invokeError) {
        const parsed = extractSharedInvokeError(invokeError);
        console.error('[ProposalDetail] shared resolve threw', {
          token: sharedToken,
          statusCode: parsed.statusCode,
          reasonCode: parsed.reasonCode,
          responseBody: parsed.body
        });

        const friendly = SHARED_ERROR_MESSAGES[parsed.reasonCode] || parsed.message;
        throw new Error(`${friendly}${parsed.statusCode ? ` (HTTP ${parsed.statusCode})` : ''}`);
      }

      const data = result?.data;

      if (!data?.ok) {
        const reasonCode = data?.code || data?.reason || 'RESOLVE_FAILED';
        const statusCode = result?.status || null;
        const correlationSuffix = data?.correlationId ? ` (correlationId: ${data.correlationId})` : '';
        const friendly = SHARED_ERROR_MESSAGES[reasonCode] || data?.message || 'Invalid or expired shared report link.';
        console.error('[ProposalDetail] shared resolve failed', {
          token: sharedToken,
          statusCode,
          reasonCode,
          responseBody: data
        });
        throw new Error(`${friendly}${statusCode ? ` (HTTP ${statusCode})` : ''}${correlationSuffix}`);
      }

      const resolvedProposalId =
        data?.shareLink?.proposalId ||
        data?.reportData?.proposalId ||
        data?.reportData?.proposal_id ||
        (data?.reportData?.type === 'proposal' ? data?.reportData?.id : null);

      if (!resolvedProposalId) {
        throw new Error('This shared report is not linked to a proposal.');
      }

      if (proposalId && resolvedProposalId !== proposalId) {
        throw new Error('Shared report token does not match this proposal.');
      }

      return data;
    },
    enabled: Boolean(isRecipientView && sharedToken)
  });

  const { data: proposalEntity, isLoading: loadingProposalEntity } = useQuery({
    queryKey: ['proposal', proposalId],
    queryFn: async () => {
      const proposals = await base44.entities.Proposal.filter({ id: proposalId });
      return proposals[0];
    },
    enabled: !!proposalId && !isRecipientRoutedRequest
  });
  const ownerWorkspaceEnabled = Boolean(!isRecipientRoutedRequest && proposalId && isProposalOwner(proposalEntity, user));

  const { data: responsesEntity = [] } = useQuery({
    queryKey: ['proposalResponses', proposalId],
    queryFn: async () => {
      const responseBuckets = await Promise.all([
        base44.entities.ProposalResponse.filter({ proposal_id: proposalId }),
        base44.entities.ProposalResponse.filter({ proposalId: proposalId }),
        base44.entities.ProposalResponse.filter({ 'data.proposal_id': proposalId }),
        base44.entities.ProposalResponse.filter({ 'data.proposalId': proposalId })
      ]);

      return dedupeById(responseBuckets.flat());
    },
    enabled: ownerWorkspaceEnabled
  });

  const { data: fallbackEvaluationItem = null } = useQuery({
    queryKey: ['fallbackEvaluationItem', proposalId],
    queryFn: async () => {
      const itemBuckets = await Promise.all([
        base44.entities.EvaluationItem.filter({ linked_proposal_id: proposalId }, '-created_date', 1),
        base44.entities.EvaluationItem.filter({ linkedProposalId: proposalId }, '-created_date', 1),
        base44.entities.EvaluationItem.filter({ 'data.linked_proposal_id': proposalId }, '-created_date', 1),
        base44.entities.EvaluationItem.filter({ 'data.linkedProposalId': proposalId }, '-created_date', 1)
      ]);
      return itemBuckets.flat()?.[0] || null;
    },
    enabled: ownerWorkspaceEnabled
  });

  const { data: fallbackInputSnapshot = null } = useQuery({
    queryKey: ['fallbackInputSnapshot', proposalId],
    queryFn: async () => {
      const [reportsByProposal, reportsByDataProposal] = await Promise.all([
        base44.entities.EvaluationReport.filter({ proposal_id: proposalId }, '-created_date', 10),
        base44.entities.EvaluationReport.filter({ 'data.proposal_id': proposalId }, '-created_date', 10)
      ]);
      const rows = [...(reportsByProposal || []), ...(reportsByDataProposal || [])];
      for (const row of rows) {
        const data = row?.data && typeof row.data === 'object' ? row.data : {};
        const snapshot = row?.input_snapshot_json || data?.input_snapshot_json || null;
        if (snapshot && Array.isArray(snapshot?.responses) && snapshot.responses.length > 0) {
          return snapshot;
        }
      }
      return null;
    },
    enabled: ownerWorkspaceEnabled
  });

  const fallbackResponsesEntity = useMemo(() => {
    if (!ownerWorkspaceEnabled || responsesEntity.length > 0) return [];
    if (fallbackEvaluationItem) {
      const data = fallbackEvaluationItem?.data && typeof fallbackEvaluationItem.data === 'object'
        ? fallbackEvaluationItem.data
        : {};
      const stepState = fallbackEvaluationItem?.step_state_json || data?.step_state_json || null;
      if (stepState) {
        const rows = buildFallbackResponsesFromStepState(stepState, proposalId);
        if (rows.length > 0) {
          return rows;
        }
      }
    }

    if (fallbackInputSnapshot) {
      return buildFallbackResponsesFromInputSnapshot(fallbackInputSnapshot, proposalId);
    }

    return [];
  }, [ownerWorkspaceEnabled, responsesEntity, fallbackEvaluationItem, fallbackInputSnapshot, proposalId]);

  const { data: linkedDocumentComparison = null } = useQuery({
    queryKey: ['linkedDocumentComparison', proposalId, proposalEntity?.document_comparison_id || null],
    queryFn: async () => {
      if (!proposalEntity) return null;
      if (proposalEntity?.proposal_type !== 'document_comparison' && !proposalEntity?.document_comparison_id) {
        return null;
      }

      if (proposalEntity?.document_comparison_id) {
        const byId = await base44.entities.DocumentComparison.filter({ id: proposalEntity.document_comparison_id }, '-created_date', 1);
        if (byId?.[0]) return byId[0];
      }

      const byProposal = await base44.entities.DocumentComparison.filter({ proposal_id: proposalId }, '-created_date', 1);
      if (byProposal?.[0]) return byProposal[0];

      const byProposalInData = await base44.entities.DocumentComparison.filter({ 'data.proposal_id': proposalId }, '-created_date', 1);
      return byProposalInData?.[0] || null;
    },
    enabled: Boolean(ownerWorkspaceEnabled && proposalId && proposalEntity)
  });

  const proposal = isRecipientView
    ? (sharedRecipientData?.recipientView?.proposal || sharedRecipientData?.proposalView || null)
    : proposalEntity;
  const responses = isRecipientView
    ? (sharedRecipientData?.recipientView?.responses || sharedRecipientData?.responsesView || [])
    : (responsesEntity.length > 0 ? responsesEntity : fallbackResponsesEntity);
  const loadingProposal = isRecipientView ? loadingRecipientData : loadingProposalEntity;
  const sharedPermissions = sharedRecipientData?.permissions || {};
  const partyAView = sharedRecipientData?.partyAView || { proposal: null, responses: [] };
  const partyBEditableSchema = sharedRecipientData?.partyBEditableSchema || { questions: [], editableQuestionIds: [] };
  const isDocumentComparisonProposal = Boolean(
    !isRecipientView &&
    (proposal?.proposal_type === 'document_comparison' || proposal?.document_comparison_id || linkedDocumentComparison)
  );

  useEffect(() => {
    if (!isRecipientView) return;
    const nextEdits = {};
    const questions = Array.isArray(partyBEditableSchema?.questions) ? partyBEditableSchema.questions : [];
    questions.forEach((question) => {
      if (!question?.questionId) return;
      nextEdits[question.questionId] = {
        questionId: question.questionId,
        valueType: question?.currentResponse?.rangeMin !== null || question?.currentResponse?.rangeMax !== null ? 'range' : (question?.valueType || 'text'),
        value: question?.currentResponse?.value ?? '',
        rangeMin: question?.currentResponse?.rangeMin ?? null,
        rangeMax: question?.currentResponse?.rangeMax ?? null
      };
    });
    setRecipientEdits(nextEdits);
  }, [isRecipientView, partyBEditableSchema]);

  const { data: evaluations = [] } = useQuery({
    queryKey: ['evaluations', proposalId],
    queryFn: () => base44.entities.EvaluationRun.filter({ proposal_id: proposalId }, '-created_date'),
    enabled: ownerWorkspaceEnabled
  });

  const { data: evaluationReports = [] } = useQuery({
    queryKey: ['evaluationReports', proposalId, proposal?.document_comparison_id || null],
    queryFn: async () => {
      const normalizeReport = (report) => {
        const data = report?.data && typeof report.data === 'object' ? report.data : {};
        return {
          ...report,
          proposal_id: report.proposal_id ?? data.proposal_id ?? proposalId,
          status: report.status ?? data.status ?? null,
          output_report_json: report.output_report_json ?? data.output_report_json ?? null,
          generated_at: report.generated_at ?? data.generated_at ?? null,
          created_date: report.created_date ?? data.created_date ?? null,
          error_message: report.error_message ?? data.error_message ?? report.error ?? data.error ?? null
        };
      };

      let source = 'none';
      let reports = await base44.entities.EvaluationReport.filter({ proposal_id: proposalId });
      let normalizedReports = reports.map(normalizeReport);
      if (normalizedReports.length > 0) source = 'EvaluationReport.proposal_id';

      if (normalizedReports.length === 0) {
        const dataPathReports = await base44.entities.EvaluationReport.filter({ 'data.proposal_id': proposalId });
        normalizedReports = dataPathReports.map(normalizeReport);
        if (normalizedReports.length > 0) source = 'EvaluationReport.data.proposal_id';
      }

      if (normalizedReports.length === 0) {
        let comparisons = await base44.entities.DocumentComparison.filter({ proposal_id: proposalId }, '-created_date');
        if (!comparisons || comparisons.length === 0) {
          comparisons = await base44.entities.DocumentComparison.filter({ 'data.proposal_id': proposalId }, '-created_date');
        }
        const comparisonWithReport = comparisons.find(c =>
          c.evaluation_report_json ||
          c?.data?.evaluation_report_json ||
          c.output_report_json ||
          c?.data?.output_report_json
        );
        if (comparisonWithReport) {
          const data = comparisonWithReport?.data && typeof comparisonWithReport.data === 'object' ? comparisonWithReport.data : {};
          const comparisonReport =
            comparisonWithReport.evaluation_report_json ||
            data.evaluation_report_json ||
            comparisonWithReport.output_report_json ||
            data.output_report_json;
          if (comparisonReport && typeof comparisonReport === 'object') {
            const comparisonGeneratedAt = comparisonWithReport.generated_at || data.generated_at;
            normalizedReports = [{
              id: `comparison-${comparisonWithReport.id}`,
              proposal_id: proposalId,
              status: 'succeeded',
              output_report_json: comparisonReport,
              generated_at: comparisonGeneratedAt || comparisonWithReport.created_date || data.created_date || new Date().toISOString(),
              created_date: comparisonWithReport.created_date || data.created_date || new Date().toISOString(),
              error_message: null
            }];
            source = 'DocumentComparison.byProposal';
          }
        }
      }

      if (normalizedReports.length === 0 && proposal?.document_comparison_id) {
        const byId = await base44.entities.DocumentComparison.filter({ id: proposal.document_comparison_id });
        const comparisonById = byId?.[0];
        if (comparisonById) {
          const data = comparisonById?.data && typeof comparisonById.data === 'object' ? comparisonById.data : {};
          const comparisonReport =
            comparisonById.evaluation_report_json ||
            data.evaluation_report_json ||
            comparisonById.output_report_json ||
            data.output_report_json;
          if (comparisonReport && typeof comparisonReport === 'object') {
            const comparisonGeneratedAt = comparisonById.generated_at || data.generated_at;
            normalizedReports = [{
              id: `comparison-${comparisonById.id}`,
              proposal_id: proposalId,
              status: 'succeeded',
              output_report_json: comparisonReport,
              generated_at: comparisonGeneratedAt || comparisonById.created_date || data.created_date || new Date().toISOString(),
              created_date: comparisonById.created_date || data.created_date || new Date().toISOString(),
              error_message: null
            }];
            source = 'DocumentComparison.byId';
          }
        }
      }

      if (import.meta.env.DEV) {
        console.debug('[ProposalDetail] evaluationReports source', {
          proposalId,
          documentComparisonId: proposal?.document_comparison_id || null,
          source,
          count: normalizedReports.length
        });
      }

      return normalizedReports.sort((a, b) => {
        const dateA = a.generated_at || a.created_date;
        const dateB = b.generated_at || b.created_date;
        return new Date(dateB) - new Date(dateA);
      }).slice(0, 5);
    },
    enabled: Boolean(ownerWorkspaceEnabled && proposal),
    refetchInterval: (data) => {
      const hasRunning = Array.isArray(data) && data.some(r => ['queued', 'running'].includes(r.status));
      return hasRunning ? 2000 : false;
    }
  });

  const { data: sharedReports = [] } = useQuery({
    queryKey: ['sharedReports', proposalId],
    queryFn: () => base44.entities.EvaluationReportShared.filter({ proposal_id: proposalId }),
    enabled: ownerWorkspaceEnabled,
    refetchInterval: (data) => {
      const hasRunning = Array.isArray(data) && data.some(r => ['queued', 'running'].includes(r.status));
      return hasRunning ? 2000 : false;
    }
  });

  const { data: fitCardReports = [] } = useQuery({
    queryKey: ['fitCardReports', proposalId],
    queryFn: () => base44.entities.FitCardReportShared.filter({ proposal_id: proposalId }),
    enabled: ownerWorkspaceEnabled,
    refetchInterval: (data) => {
      const hasRunning = Array.isArray(data) && data.some(r => ['queued', 'running'].includes(r.status));
      return hasRunning ? 2000 : false;
    }
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['templates'],
    queryFn: () => base44.entities.Template.list(),
    enabled: Boolean(ownerWorkspaceEnabled && proposal?.template_id)
  });

  const { data: verifications = [] } = useQuery({
    queryKey: ['verifications', proposalId],
    queryFn: () => base44.entities.VerificationItem.filter({ proposal_id: proposalId }),
    enabled: ownerWorkspaceEnabled
  });

  const { data: comments = [] } = useQuery({
    queryKey: ['comments', proposalId],
    queryFn: () => base44.entities.ProposalComment.filter({ proposal_id: proposalId }, '-created_date'),
    enabled: ownerWorkspaceEnabled
  });

  const { data: attachments = [] } = useQuery({
    queryKey: ['attachments', proposalId],
    queryFn: () => base44.entities.Attachment.filter({ proposal_id: proposalId }),
    enabled: ownerWorkspaceEnabled
  });

  const isPartyA = proposal?.party_a_email === user?.email;
  const isPartyB = proposal?.party_b_email === user?.email;
  const latestEvaluation = evaluations[0];
  const latestReport = evaluationReports?.[0];
  const latestSuccessReport = evaluationReports?.find(r => r.status === 'succeeded');
  const sharedReport = sharedReports?.[0];
  const fitCardReport = fitCardReports?.[0];
  const hasShareableReport = Boolean(
    latestSuccessReport?.output_report_json ||
    sharedReports.some(r => r.status === 'succeeded' && r.output_report_json) ||
    fitCardReports.some(r => r.status === 'succeeded' && r.output_report_json)
  );

  const currentTemplate = templates.find(t => t.id === proposal?.template_id);
  const isFinanceTemplate = currentTemplate?.slug === 'universal_finance_deal_prequal';
  const isProfileMatchingTemplate = currentTemplate?.slug === 'universal_profile_matching';
  const partyAIdentity = isRecipientView
    ? 'Identity Protected'
    : (proposal?.mutual_reveal || isPartyA ? proposal?.party_a_email : 'Identity Protected');
  const partyBIdentity = proposal?.party_b_email || user?.email || 'Not specified';

  const isPartyAResponse = (response) => {
    const party = String(response?.entered_by_party || 'a').toLowerCase();
    return party === 'a' || party === 'party_a' || party === 'proposer';
  };
  const isPartyBResponse = (response) => {
    const party = String(response?.entered_by_party || '').toLowerCase();
    return party === 'b' || party === 'party_b' || party === 'recipient' || party === 'counterparty';
  };

  const isResponseOwnedByCurrentUser = (response) => {
    if (isPartyA) return isPartyAResponse(response);
    if (isPartyB) return isPartyBResponse(response);
    return false;
  };

  const isResponseHiddenForViewer = (response) => {
    const subjectParty = String(response?.subject_party || response?.subjectParty || '').toLowerCase();
    const isCounterpartyClaim =
      subjectParty === 'b' ||
      subjectParty === 'party_b' ||
      subjectParty === 'recipient' ||
      response?.is_about_counterparty === true;
    if (isRecipientView && isPartyAResponse(response) && !isCounterpartyClaim) return true;
    const visibilityValue = String(response?.visibility || '').toLowerCase();
    const visibility = visibilityValue === 'partial' ? 'hidden' : visibilityValue;
    if (visibility !== 'hidden') return false;
    return !isResponseOwnedByCurrentUser(response);
  };

  const getResponseDisplayValue = (response) => {
    if (isResponseHiddenForViewer(response)) return 'Not shared';
    if (response.value_type === 'range') return `Range: ${response.range_min} - ${response.range_max}`;
    return response.value || 'Not provided';
  };

  // Run New Evaluation (Vertex Gemini)
  const runNewEvaluationMutation = useMutation({
    mutationFn: async ({ trigger } = {}) => {
      if (trigger !== 'user_click') {
        if (import.meta.env.DEV) {
          console.warn('[EvaluationGuard] Blocked evaluation without explicit user trigger', { proposalId });
        }
        throw new Error('Evaluation can only run from explicit user action');
      }

      const clientCorrelationId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const resolvedProposalId = getProposalId(proposal) || proposalId;
      if (!resolvedProposalId) {
        throw new Error('Cannot evaluate: proposal id missing');
      }

      let comparisonId = proposal?.document_comparison_id || null;
      try {
        // Prefer resolving a linked DocumentComparison by proposal id rather than relying solely on proposal shape.
        try {
          let comparisons = await base44.entities.DocumentComparison.filter({ proposal_id: resolvedProposalId }, '-created_date');
          if ((!comparisons || comparisons.length === 0) && resolvedProposalId) {
            comparisons = await base44.entities.DocumentComparison.filter({ 'data.proposal_id': resolvedProposalId }, '-created_date');
          }
          if (comparisons && comparisons.length > 0) {
            comparisonId = comparisons[0].id || comparisonId;
          }
        } catch (cmpErr) {
          // Non-fatal: if lookup fails, fall back to proposal fields
          if (import.meta.env.DEV) console.debug('DocumentComparison lookup error', cmpErr);
        }

        let functionName = null;
        let payload = null;

        if (isFinanceTemplate) {
          functionName = 'EvaluateProposalShared';
          payload = { proposal_id: resolvedProposalId, trigger };
        } else if (isProfileMatchingTemplate) {
          functionName = 'EvaluateFitCardShared';
          payload = { proposal_id: resolvedProposalId, trigger };
        } else if (comparisonId) {
          // Always prefer the working DocumentComparison flow for proposals with a comparison
          functionName = 'EvaluateDocumentComparison';
          payload = { comparison_id: comparisonId, trigger };
        } else {
          functionName = 'EvaluateProposal';
          payload = { proposal_id: resolvedProposalId, trigger };
        }

        if (import.meta.env.DEV) {
          console.debug('Invoking evaluation', { functionName, proposalId: resolvedProposalId, comparisonId, payload });
        }

        const response = await base44.functions.invoke(functionName, payload);

        // Check if response is valid JSON
        if (!response.data || typeof response.data !== 'object') {
          const rawText = typeof response.data === 'string' ? response.data.substring(0, 300) : JSON.stringify(response.data).substring(0, 300);
          throw new Error(`Non-JSON response\n\nCorrelation ID: ${clientCorrelationId}\n\nRaw (first 300 chars):\n${rawText}`);
        }

        // Normalize success/failure checks across different functions
        if (response.data.status === 'failed' || response.data.status === 'error' || response.data.ok === false) {
          const errorMsg = response.data.error_message || response.data.error || response.data.message || 'Evaluation failed';
          const corrId = response.data.correlation_id || response.data.correlationId || clientCorrelationId;
          throw new Error(`${errorMsg}\n\nCorrelation ID: ${corrId}`);
        }

        return response.data;
      } catch (error) {
        // Dev-only enhanced logging for easy diagnosis of 404s and other failures
        if (import.meta.env.DEV) {
          console.error('Evaluation request failed', {
            message: error?.message,
            status: error?.response?.status || error?.status,
            responseData: error?.response?.data || null,
            url: error?.config?.url || error?.request?.responseURL || null,
            proposalId: resolvedProposalId,
            comparisonId: comparisonId || null
          });
        }

        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['evaluationReports', proposalId]);
      queryClient.invalidateQueries(['sharedReports', proposalId]);
      queryClient.invalidateQueries(['fitCardReports', proposalId]);
      queryClient.invalidateQueries(['proposal', proposalId]);
    },
    onError: (error) => {
      alert(`Evaluation failed:\n\n${error.message}`);
    }
  });

  const handleRunEvaluationClick = () => {
    if (import.meta.env.DEV) {
      console.debug('[EvaluationGuard] User clicked Run AI Evaluation', { proposalId });
    }
    runNewEvaluationMutation.mutate({ trigger: 'user_click' });
  };

  const sendReportMutation = useMutation({
    mutationFn: async () => {
      const toEmail = recipientEmail.trim();
      if (!toEmail || !toEmail.includes('@')) {
        throw new Error('Please enter a valid recipient email.');
      }
      if (!hasShareableReport) {
        throw new Error('No AI report is available to send yet.');
      }

      let evaluationItemId =
        latestEvaluation?.evaluation_item_id ||
        latestEvaluation?.evaluationItemId ||
        null;

      if (!evaluationItemId && proposalId) {
        const linkedItems = await base44.entities.EvaluationItem.filter(
          { linked_proposal_id: proposalId },
          '-created_date',
          1
        );
        evaluationItemId = linkedItems?.[0]?.id || null;
      }

      const sendResult = await base44.functions.invoke('SendReportEmailSafe', {
        proposalId,
        evaluationItemId,
        documentComparisonId: proposal?.document_comparison_id || null,
        recipientEmail: toEmail,
        toEmail,
        message: emailMessage
      });

      if (!sendResult?.data?.ok) {
        const errorCode = sendResult?.data?.errorCode || 'UNKNOWN';
        const correlationId = sendResult?.data?.correlationId;
        const baseMessage = sendResult?.data?.message || 'Failed to send report email.';

        if (['MISSING_EMAIL_PROVIDER_KEY', 'EMAIL_CONFIG_MISSING', 'EMAIL_CONFIG_INVALID'].includes(errorCode)) {
          const statusResult = await base44.functions.invoke('EmailConfigStatus', {}).catch(() => null);
          const config = statusResult?.data;
          const configDetail = config
            ? `Email config: RESEND_API_KEY ${config.hasResendKey ? 'set' : 'missing'}, RESEND_FROM_EMAIL ${config.hasFromEmail ? 'set' : 'missing'}.`
            : 'Unable to load email configuration status.';
          throw new Error(`${baseMessage} ${configDetail}${correlationId ? ` (Correlation ID: ${correlationId})` : ''}`);
        }

        throw new Error(`${baseMessage}${correlationId ? ` (Correlation ID: ${correlationId})` : ''}`);
      }

      return sendResult.data;
    },
    onSuccess: () => {
      toast.success('Report sent');
      setSendReportModalOpen(false);
      setRecipientEmail('');
      setEmailMessage('');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to send AI report.');
    }
  });

  const handleDownloadAIReportPdf = async () => {
    try {
      if (!proposalId) {
        throw new Error('Missing proposal id');
      }

      const latestEvaluationItemId =
        latestEvaluation?.evaluation_item_id ||
        latestEvaluation?.evaluationItemId ||
        null;

      const latestEvaluationReportId =
        latestSuccessReport?.id && !String(latestSuccessReport.id).startsWith('comparison-')
          ? latestSuccessReport.id
          : null;

      const pdfResult = await base44.functions.invoke('DownloadReportPDF', {
        proposalId,
        evaluationReportId: latestEvaluationReportId,
        evaluationItemId: latestEvaluationItemId,
        documentComparisonId: proposal?.document_comparison_id || null
      });

      if (!pdfResult?.data || typeof pdfResult.data !== 'object') {
        throw new Error('Could not load report (correlationId: client_non_json_response)');
      }

      if (!pdfResult.data.ok || !pdfResult.data.pdfBase64) {
        const correlationId = pdfResult.data.correlationId || 'unknown';
        const message = pdfResult.data.message || pdfResult.data.error || 'Failed to generate AI report PDF.';
        throw new Error(`${message} (correlationId: ${correlationId})`);
      }

      const byteCharacters = atob(pdfResult.data.pdfBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i += 1) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }

      const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pdfResult.data.filename || `${proposal.title || 'proposal'}_ai_report.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      toast.success('AI report PDF downloaded');
    } catch (error) {
      console.error('PDF download error:', error);
      toast.error(error?.message || 'Failed to download AI report PDF.');
    }
  };

  // Run AI Evaluation (Legacy)
  const runEvaluationMutation = useMutation({
    mutationFn: async () => {
      // Create evaluation run
      const evalRun = await base44.entities.EvaluationRun.create({
        proposal_id: proposalId,
        run_by_party: isPartyA ? 'a' : 'b',
        run_by_user_id: user.id,
        status: 'processing'
      });

      // Generate AI evaluation
      const prompt = `
        Evaluate this pre-qualification proposal:
        Template: ${proposal.template_name}
        
        Responses provided:
        ${responses.map(r => `- ${r.question_id}: ${r.value}`).join('\n')}
        
        Generate a compatibility evaluation with:
        1. Overall score (0-100)
        2. Confidence level (0-100)
        3. Criteria scores for: Financial Fit, Strategic Alignment, Market Position, Deal Terms
        4. Missing data penalties
        5. Red flags (if any)
        6. Recommendations
        7. Summary
      `;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            overall_score: { type: 'number' },
            confidence: { type: 'number' },
            criteria_scores: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  score: { type: 'number' },
                  rationale: { type: 'string' },
                  weight: { type: 'number' }
                }
              }
            },
            missing_data_penalties: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  penalty: { type: 'number' },
                  reason: { type: 'string' }
                }
              }
            },
            red_flags: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  severity: { type: 'string' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  recommendation: { type: 'string' }
                }
              }
            },
            recommendations: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' }
          }
        }
      });

      // Update evaluation with results
      await base44.entities.EvaluationRun.update(evalRun.id, {
        ...result,
        status: 'completed'
      });

      // Update proposal with latest score
      await base44.entities.Proposal.update(proposalId, {
        latest_score: result.overall_score,
        latest_evaluation_id: evalRun.id,
        status: proposal.status === 'received' ? 'under_verification' : proposal.status
      });

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['evaluations', proposalId]);
      queryClient.invalidateQueries(['proposal', proposalId]);
    }
  });

  // Request Reveal
  const requestRevealMutation = useMutation({
    mutationFn: async () => {
      const updateField = isPartyA ? 'reveal_requested_by_a' : 'reveal_requested_by_b';
      await base44.entities.Proposal.update(proposalId, {
        [updateField]: true
      });

      // Check if mutual reveal is complete
      const otherPartyRequested = isPartyA ? proposal.reveal_requested_by_b : proposal.reveal_requested_by_a;
      if (otherPartyRequested) {
        await base44.entities.Proposal.update(proposalId, {
          mutual_reveal: true,
          status: 'revealed',
          reveal_level_a: 3,
          reveal_level_b: 3
        });

        await base44.entities.RevealEvent.create({
          proposal_id: proposalId,
          user_id: user.id,
          party: isPartyA ? 'a' : 'b',
          event_type: 'mutual_reveal_completed',
          from_level: isPartyA ? proposal.reveal_level_a : proposal.reveal_level_b,
          to_level: 3
        });
      } else {
        await base44.entities.RevealEvent.create({
          proposal_id: proposalId,
          user_id: user.id,
          party: isPartyA ? 'a' : 'b',
          event_type: 'reveal_requested',
          from_level: isPartyA ? proposal.reveal_level_a : proposal.reveal_level_b,
          to_level: 3
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['proposal', proposalId]);
    }
  });

  // Express Interest
  const expressInterestMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.Proposal.update(proposalId, {
        status: 'mutual_interest'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['proposal', proposalId]);
    }
  });

  const recipientEditableQuestions = useMemo(() => (
    Array.isArray(partyBEditableSchema?.questions) ? partyBEditableSchema.questions : []
  ), [partyBEditableSchema]);

  const handleRecipientEditChange = (questionId, patch) => {
    setRecipientEdits((prev) => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        questionId,
        ...patch
      }
    }));
  };

  const saveRecipientResponsesMutation = useMutation({
    mutationFn: async () => {
      const payload = Object.values(recipientEdits)
        .filter((entry) => entry?.questionId)
        .map((entry) => ({
          questionId: entry.questionId,
          valueType: entry.valueType || 'text',
          value: entry.value,
          rangeMin: entry.rangeMin,
          rangeMax: entry.rangeMax
        }));

      try {
        const result = await base44.functions.invoke('UpsertSharedRecipientResponses', {
          token: sharedToken,
          responses: payload
        });

        const data = result?.data;
        if (!data?.ok) {
          const reasonCode = data?.code || data?.reason || 'UPDATE_FAILED';
          throw new Error(`${data?.message || 'Failed to save recipient responses'} (${reasonCode})`);
        }

        return data;
      } catch (error) {
        const parsed = extractFunctionFailure(error, 'Failed to save recipient responses');
        throw new Error(`${parsed.message} (${parsed.reasonCode})`);
      }
    },
    onSuccess: () => {
      toast.success('Your Party B updates were saved');
      queryClient.invalidateQueries(['sharedRecipientData', sharedToken]);
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to save updates.');
    }
  });

  const runSharedReevaluationMutation = useMutation({
    mutationFn: async () => {
      try {
        const result = await base44.functions.invoke('RunSharedReportReevaluation', {
          token: sharedToken
        });
        const data = result?.data;
        if (!data?.ok) {
          const reasonCode = data?.code || data?.reason || 'REEVALUATION_FAILED';
          throw new Error(`${data?.message || 'Re-evaluation failed'} (${reasonCode})`);
        }
        return data;
      } catch (error) {
        const parsed = extractFunctionFailure(error, 'Re-evaluation failed');
        throw new Error(`${parsed.message} (${parsed.reasonCode})`);
      }
    },
    onSuccess: (data) => {
      toast.success(`Re-evaluation complete. Remaining: ${data?.reevaluation?.remaining ?? 0}`);
      queryClient.invalidateQueries(['sharedRecipientData', sharedToken]);
    },
    onError: (error) => {
      toast.error(error?.message || 'Re-evaluation failed.');
    }
  });

  const submitSendBackMutation = useMutation({
    mutationFn: async () => {
      const message = sendBackMessage.trim();
      if (!message) {
        throw new Error('Enter a response or counterproposal message before sending.');
      }

      try {
        const result = await base44.functions.invoke('SubmitSharedReportResponse', {
          token: sharedToken,
          message
        });

        const data = result?.data;
        if (!data?.ok) {
          const reasonCode = data?.code || data?.reason || 'SEND_BACK_FAILED';
          throw new Error(`${data?.message || 'Failed to send response'} (${reasonCode})`);
        }

        return data;
      } catch (error) {
        const parsed = extractFunctionFailure(error, 'Failed to send response');
        throw new Error(`${parsed.message} (${parsed.reasonCode})`);
      }
    },
    onSuccess: () => {
      toast.success('Response sent back and recorded');
      setSendBackMessage('');
      queryClient.invalidateQueries(['sharedRecipientData', sharedToken]);
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to send response.');
    }
  });

  const handleOpenSharedWorkspace = async () => {
    if (!proposalId) return;

    if (!user) {
      base44.auth.redirectToLogin(window.location.href);
      return;
    }

    setOpeningSharedWorkspace(true);
    const shareLink = await getActiveShareLinkForRecipient(proposalId);
    if (shareLink.ok) {
      setOpeningSharedWorkspace(false);
      navigate(createPageUrl(`SharedReport?token=${encodeURIComponent(shareLink.token)}`));
      return;
    }

    toast.error(shareLink.message || NO_SHARED_WORKSPACE_LINK_MESSAGE);
    setOpeningSharedWorkspace(false);
  };

  const handleOpenSharedWorkspaceFromRecipientRoute = async () => {
    if (sharedToken) {
      navigate(createPageUrl(`SharedReport?token=${encodeURIComponent(sharedToken)}`));
      return;
    }
    await handleOpenSharedWorkspace();
  };

  if (isRecipientRoutedRequest) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-3xl mx-auto px-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="py-10 text-center">
              <XCircle className="w-10 h-10 text-amber-500 mx-auto mb-4" />
              <h1 className="text-lg font-semibold text-slate-900 mb-2">Recipient access is handled in Shared Workspace</h1>
              <p className="text-slate-600 mb-6">
                ProposalDetail is owner-only. Open the shared recipient workspace to continue.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  onClick={handleOpenSharedWorkspaceFromRecipientRoute}
                  disabled={openingSharedWorkspace}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {openingSharedWorkspace ? 'Opening...' : 'Open Shared Workspace'}
                </Button>
                <Button variant="outline" onClick={() => navigate(createPageUrl('Proposals'))}>
                  Back to Proposals
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isRecipientView && sharedRecipientError) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-3xl mx-auto px-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="py-10 text-center">
              <XCircle className="w-10 h-10 text-red-500 mx-auto mb-4" />
              <h1 className="text-lg font-semibold text-slate-900 mb-2">Unable to load shared proposal</h1>
              <p className="text-slate-600 mb-6">
                {sharedRecipientError instanceof Error
                  ? sharedRecipientError.message
                  : 'This shared link is invalid or expired.'}
              </p>
              <Button variant="outline" onClick={() => navigate(createPageUrl('Dashboard'))}>
                Go to Dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (loadingProposal || !proposal || (!isRecipientView && !isUserResolved)) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-6xl mx-auto px-4">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-slate-200 rounded w-48" />
            <div className="h-64 bg-slate-100 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  const isOwnerWorkspace = isProposalOwner(proposal, user);
  if (!isRecipientView && !isOwnerWorkspace) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-3xl mx-auto px-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="py-10 text-center">
              <XCircle className="w-10 h-10 text-amber-500 mx-auto mb-4" />
              <h1 className="text-lg font-semibold text-slate-900 mb-2">Access limited to proposal owner workspace</h1>
              <p className="text-slate-600 mb-6">
                This proposal is owned by another account. Open the shared recipient workspace instead.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  onClick={handleOpenSharedWorkspace}
                  disabled={openingSharedWorkspace}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {openingSharedWorkspace ? 'Opening...' : 'Open Shared Workspace'}
                </Button>
                <Button variant="outline" onClick={() => navigate(createPageUrl('Proposals'))}>
                  Back to Proposals
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isRecipientView) {
    const canEditRecipient = Boolean(sharedPermissions?.canEditRecipientSide ?? sharedPermissions?.canEdit);
    const canReevaluate = Boolean(sharedPermissions?.canReevaluate);
    const canSendBack = Boolean(sharedPermissions?.canSendBack);
    const reportJson = sharedRecipientData?.reportData?.report || null;
    const recipientEditableProposalId =
      proposal?.id ||
      proposalId ||
      sharedRecipientData?.proposalId ||
      sharedRecipientData?.reportData?.proposalId ||
      sharedRecipientData?.reportData?.proposal_id ||
      null;

    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-5xl mx-auto px-4 space-y-6">
          <div className="flex items-center justify-between gap-3">
            <Link to={createPageUrl(`SharedReport?token=${encodeURIComponent(sharedToken || '')}`)} className="inline-flex items-center text-slate-600 hover:text-slate-900">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Shared Report
            </Link>
            <div className="flex items-center gap-2">
              {recipientEditableProposalId && (
                <Button
                  variant="outline"
                  onClick={() => navigate(
                    createPageUrl(`CreateProposal?draft=${recipientEditableProposalId}&step=4&role=recipient&sharedToken=${encodeURIComponent(sharedToken || '')}`)
                  )}
                >
                  Edit Proposal
                </Button>
              )}
              {!user && (
                <Button variant="outline" onClick={() => base44.auth.redirectToLogin(window.location.href)}>
                  Sign In to Re-evaluate
                </Button>
              )}
            </div>
          </div>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-blue-600" />
                Shared AI Report
              </CardTitle>
            </CardHeader>
            <CardContent>
              {reportJson ? (
                <pre className="text-xs bg-slate-950 text-slate-100 p-4 rounded-lg overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(reportJson, null, 2)}
                </pre>
              ) : (
                <p className="text-slate-600">No report payload was found for this proposal yet.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Party A Shared Information</CardTitle>
              <CardDescription>Confidential fields are redacted before they are returned to this view.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(partyAView?.responses || []).length === 0 && (
                <p className="text-slate-500 text-sm">No Party A responses are available.</p>
              )}
              {(partyAView?.responses || []).map((item) => (
                <div key={item.id || item.questionId} className="p-3 border rounded-lg">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="font-medium text-slate-900">{item.label || item.questionId}</p>
                    <Badge variant="outline">{item.redaction || item.visibility || 'shared'}</Badge>
                  </div>
                  <p className="text-sm text-slate-600">{item.valueSummary || 'Not shared'}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Party B Editable Information</CardTitle>
              <CardDescription>
                Update only your side of the proposal. These edits are validated server-side against the shared token policy.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {recipientEditableQuestions.length === 0 && (
                <p className="text-slate-500 text-sm">No editable Party B fields were found.</p>
              )}
              {recipientEditableQuestions.map((question) => {
                const edit = recipientEdits[question.questionId] || {};
                const isRange = String(edit.valueType || question.valueType || '').toLowerCase() === 'range';
                return (
                  <div key={question.questionId} className="border rounded-lg p-3 space-y-2">
                    <Label className="font-medium text-slate-900">{question.label || question.questionId}</Label>
                    {question.description && (
                      <p className="text-xs text-slate-500">{question.description}</p>
                    )}
                    {isRange ? (
                      <div className="grid grid-cols-2 gap-3">
                        <Input
                          type="number"
                          value={edit.rangeMin ?? ''}
                          onChange={(event) => handleRecipientEditChange(question.questionId, {
                            valueType: 'range',
                            rangeMin: event.target.value === '' ? null : Number(event.target.value)
                          })}
                          disabled={!canEditRecipient || saveRecipientResponsesMutation.isPending}
                          placeholder="Minimum"
                        />
                        <Input
                          type="number"
                          value={edit.rangeMax ?? ''}
                          onChange={(event) => handleRecipientEditChange(question.questionId, {
                            valueType: 'range',
                            rangeMax: event.target.value === '' ? null : Number(event.target.value)
                          })}
                          disabled={!canEditRecipient || saveRecipientResponsesMutation.isPending}
                          placeholder="Maximum"
                        />
                      </div>
                    ) : (
                      <Textarea
                        rows={3}
                        value={edit.value ?? ''}
                        onChange={(event) => handleRecipientEditChange(question.questionId, {
                          valueType: 'text',
                          value: event.target.value
                        })}
                        disabled={!canEditRecipient || saveRecipientResponsesMutation.isPending}
                      />
                    )}
                  </div>
                );
              })}

              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  onClick={() => saveRecipientResponsesMutation.mutate()}
                  disabled={!canEditRecipient || saveRecipientResponsesMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {saveRecipientResponsesMutation.isPending ? 'Saving...' : 'Save Party B Updates'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => runSharedReevaluationMutation.mutate()}
                  disabled={!canReevaluate || runSharedReevaluationMutation.isPending || !user}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {runSharedReevaluationMutation.isPending ? 'Re-evaluating...' : 'Re-evaluate'}
                </Button>
              </div>
              {runSharedReevaluationMutation.data?.reevaluation && (
                <p className="text-xs text-slate-500">
                  Re-evaluations used: {runSharedReevaluationMutation.data.reevaluation.used} / {runSharedReevaluationMutation.data.reevaluation.max}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Send Back Response</CardTitle>
              <CardDescription>
                Submit your counterproposal or notes. A proposal-linked audit response record is created on send.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                rows={4}
                value={sendBackMessage}
                onChange={(event) => setSendBackMessage(event.target.value)}
                placeholder="Add your response or counterproposal..."
                disabled={!canSendBack || submitSendBackMutation.isPending}
              />
              <Button
                onClick={() => submitSendBackMutation.mutate()}
                disabled={!canSendBack || submitSendBackMutation.isPending}
              >
                <Send className="w-4 h-4 mr-2" />
                {submitSendBackMutation.isPending ? 'Sending...' : 'Send Back'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const canRequestReveal = (isPartyA && !proposal.reveal_requested_by_a) || 
                          (isPartyB && !proposal.reveal_requested_by_b);
  const otherPartyRequestedReveal = (isPartyA && proposal.reveal_requested_by_b) || 
                                    (isPartyB && proposal.reveal_requested_by_a);

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <Link to={createPageUrl('Proposals')} className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Proposals
          </Link>
          
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-slate-900">
                  {proposal.title || 'Untitled Proposal'}
                </h1>
                <StatusBadge status={proposal.status} />
              </div>
              <p className="text-slate-500">
                {proposal.template_name} • Created {new Date(proposal.created_date).toLocaleDateString()}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {proposal.status === 'draft' && isPartyA && (
                <DeleteDraftDialog 
                  onConfirm={async () => {
                    try {
                      const responses = await base44.entities.ProposalResponse.filter({ proposal_id: proposalId });
                      const reports = await base44.entities.EvaluationReport.filter({ proposal_id: proposalId });
                      const attachments = await base44.entities.Attachment.filter({ proposal_id: proposalId });
                      
                      await Promise.all([
                        ...responses.map(r => base44.entities.ProposalResponse.delete(r.id)),
                        ...reports.map(r => base44.entities.EvaluationReport.delete(r.id)),
                        ...attachments.map(a => base44.entities.Attachment.delete(a.id))
                      ]);
                      
                      await base44.entities.Proposal.delete(proposalId);
                      navigate(createPageUrl('Proposals'));
                    } catch (error) {
                      console.error('Delete failed:', error);
                      alert('Failed to delete draft');
                    }
                  }}
                />
              )}
              <Button 
                variant="outline"
                onClick={async () => {
                  const { jsPDF } = await import('jspdf');
                  const { default: autoTable } = await import('jspdf-autotable');
                  const doc = new jsPDF();
                  
                  // Header
                  doc.setFillColor(15, 23, 42);
                  doc.rect(0, 0, 210, 35, 'F');
                  doc.setTextColor(255, 255, 255);
                  doc.setFontSize(20);
                  doc.text('PreMarket', 20, 15);
                  doc.setFontSize(14);
                  doc.text('Proposal Information', 20, 25);
                  
                  doc.setTextColor(0, 0, 0);
                  
                  // Title Section
                  doc.setFontSize(16);
                  doc.setFont(undefined, 'bold');
                  doc.text(proposal.title || 'Untitled Proposal', 20, 45);
                  doc.setFont(undefined, 'normal');
                  doc.setFontSize(10);
                  doc.setTextColor(100, 100, 100);
                  doc.text(`Template: ${proposal.template_name}`, 20, 52);
                  doc.text(`Created: ${new Date(proposal.created_date).toLocaleDateString()}`, 20, 58);
                  
                  // Parties Table
                  doc.setTextColor(0, 0, 0);
                  autoTable(doc, {
                    startY: 68,
                    head: [['Party', 'Identity']],
                    body: [
                      ['Party A (Proposer)', partyAIdentity],
                      ['Party B (Recipient)', partyBIdentity]
                    ],
                    theme: 'grid',
                    headStyles: { fillColor: [37, 99, 235], fontSize: 11, fontStyle: 'bold' },
                    styles: { fontSize: 10, cellPadding: 5 }
                  });
                  
                  // Responses Table
                  const responsesData = responses.map(r => [
                    r.question_id.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                    isResponseHiddenForViewer(r)
                      ? 'Not shared'
                      : (r.value_type === 'range' ? `${r.range_min} - ${r.range_max}` : (r.value || 'Not provided')),
                    isResponseHiddenForViewer(r) ? 'not_shared' : (r.visibility || 'full')
                  ]);
                  
                  autoTable(doc, {
                    startY: doc.lastAutoTable.finalY + 10,
                    head: [['Field', 'Value', 'Visibility']],
                    body: responsesData.length > 0 ? responsesData : [['No responses recorded', '', '']],
                    theme: 'striped',
                    headStyles: { fillColor: [37, 99, 235], fontSize: 11, fontStyle: 'bold' },
                    styles: { fontSize: 9, cellPadding: 4 },
                    columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: 100 }, 2: { cellWidth: 30 } }
                  });
                  
                  // Footer
                  const pageCount = doc.internal.getNumberOfPages();
                  for (let i = 1; i <= pageCount; i++) {
                    doc.setPage(i);
                    doc.setFontSize(8);
                    doc.setTextColor(150, 150, 150);
                    doc.text(`Page ${i} of ${pageCount}`, 20, 285);
                    doc.text(`Generated: ${new Date().toLocaleString()}`, 150, 285);
                  }
                  
                  doc.save(`${proposal.title || 'proposal'}_info.pdf`);
                }}
              >
                <FileText className="w-4 h-4 mr-2" />
                Download Proposal Info PDF
              </Button>
              {!isRecipientView && isProposalOwner(proposal, user) && proposalId && (
                <Button
                  variant="outline"
                  onClick={() => navigate(createPageUrl(`CreateProposal?draft=${proposalId}&step=4`))}
                >
                  <ArrowRight className="w-4 h-4 mr-2" />
                  Edit Proposal
                </Button>
              )}
              {proposalId && hasShareableReport && (
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={() => {
                    setRecipientEmail(proposal?.party_b_email || '');
                    setEmailMessage('');
                    setSendReportModalOpen(true);
                  }}
                >
                  <Send className="w-4 h-4 mr-2" />
                  Send AI Report
                </Button>
              )}
              {latestSuccessReport && latestSuccessReport.output_report_json && (
                <Button 
                  variant="outline"
                  onClick={handleDownloadAIReportPdf}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Download AI Report PDF
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Score Card */}
        {latestEvaluation && (
          <Card className="border-0 shadow-sm mb-6 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-5xl font-bold">{latestEvaluation.overall_score || 0}%</p>
                    <p className="text-blue-100 mt-1">Match Score</p>
                  </div>
                  <Separator orientation="vertical" className="h-16 bg-blue-400/30 hidden md:block" />
                  <div>
                    <p className="text-sm text-blue-100">Confidence</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Progress value={latestEvaluation.confidence || 0} className="w-32 h-2 bg-blue-400/30" />
                      <span className="text-sm font-medium">{latestEvaluation.confidence || 0}%</span>
                    </div>
                  </div>
                </div>

                {latestEvaluation.red_flags?.length > 0 && (
                  <div className="flex items-center gap-2 px-4 py-2 bg-red-500/20 rounded-lg">
                    <AlertTriangle className="w-5 h-5" />
                    <span>{latestEvaluation.red_flags.length} Red Flag{latestEvaluation.red_flags.length > 1 ? 's' : ''}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}



        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white border border-slate-200 p-1 mb-6 flex-wrap">
            <TabsTrigger value="overview" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <FileText className="w-4 h-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="evaluation" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <BarChart3 className="w-4 h-4 mr-2" />
              {isProfileMatchingTemplate ? 'Profile Evaluation' : 'AI Report'}
              {(latestSuccessReport || sharedReport?.status === 'succeeded' || fitCardReport?.status === 'succeeded') && (
                <Badge className="ml-2 bg-green-100 text-green-700 text-xs">
                  Complete
                </Badge>
              )}
            </TabsTrigger>

          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {/* Parties */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Parties</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="p-4 bg-blue-50 rounded-xl">
                        <p className="text-sm text-blue-600 font-medium mb-2">Party A (Proposer)</p>
                        <p className="font-medium text-slate-900">
                          {partyAIdentity}
                        </p>
                        {!isRecipientView && isPartyA && <Badge className="mt-2 bg-blue-100 text-blue-700">You</Badge>}
                      </div>
                      <div className="p-4 bg-indigo-50 rounded-xl">
                        <p className="text-sm text-indigo-600 font-medium mb-2">Party B (Recipient)</p>
                        <p className="font-medium text-slate-900">
                          {partyBIdentity}
                        </p>
                        {isPartyB && <Badge className="mt-2 bg-indigo-100 text-indigo-700">You</Badge>}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Detailed Responses */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Complete Proposal Details</CardTitle>
                    <CardDescription>
                      {isDocumentComparisonProposal
                        ? 'Read-only document content with hidden highlights.'
                        : (isRecipientView
                          ? 'Only shared information is visible in recipient view.'
                          : 'All information provided in this proposal.')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {isDocumentComparisonProposal ? (
                      <div className="space-y-4">
                        <p className="text-xs text-slate-500">
                          Read-only preview. Hidden spans are highlighted in red.
                        </p>

                        <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                            <p className="text-sm text-blue-700 font-semibold">
                              {linkedDocumentComparison?.party_a_label || 'Document A'}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">
                                Source: {linkedDocumentComparison?.doc_a_source || 'typed'}
                              </Badge>
                              <Badge className="bg-red-100 text-red-700 text-xs">
                                {normalizeComparisonSpans(
                                  linkedDocumentComparison?.doc_a_spans_json || [],
                                  String(linkedDocumentComparison?.doc_a_plaintext || '').length
                                ).length} hidden
                              </Badge>
                            </div>
                          </div>
                          <div className="p-3 bg-white border border-slate-200 rounded-lg max-h-72 overflow-auto">
                            {renderReadOnlyComparisonText(
                              linkedDocumentComparison?.doc_a_plaintext || '',
                              linkedDocumentComparison?.doc_a_spans_json || []
                            )}
                          </div>
                        </div>

                        <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                            <p className="text-sm text-indigo-700 font-semibold">
                              {linkedDocumentComparison?.party_b_label || 'Document B'}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">
                                Source: {linkedDocumentComparison?.doc_b_source || 'typed'}
                              </Badge>
                              <Badge className="bg-red-100 text-red-700 text-xs">
                                {normalizeComparisonSpans(
                                  linkedDocumentComparison?.doc_b_spans_json || [],
                                  String(linkedDocumentComparison?.doc_b_plaintext || '').length
                                ).length} hidden
                              </Badge>
                            </div>
                          </div>
                          <div className="p-3 bg-white border border-slate-200 rounded-lg max-h-72 overflow-auto">
                            {renderReadOnlyComparisonText(
                              linkedDocumentComparison?.doc_b_plaintext || '',
                              linkedDocumentComparison?.doc_b_spans_json || []
                            )}
                          </div>
                        </div>
                      </div>
                    ) : responses.length === 0 ? (
                      <p className="text-slate-500 text-center py-8">No responses recorded yet.</p>
                    ) : (
                      <div className="space-y-4">
                        {responses.map(response => {
                          const hiddenForViewer = isResponseHiddenForViewer(response);
                          return (
                          <div key={response.id} className="p-4 border border-slate-200 rounded-xl">
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <p className="font-semibold text-slate-900 capitalize mb-1">
                                  {response.question_id.replace(/_/g, ' ')}
                                </p>
                                <Badge variant="outline" className="text-xs">
                                  Party {response.entered_by_party?.toUpperCase() || 'A'}
                                </Badge>
                              </div>
                              <Badge className={
                                hiddenForViewer
                                  ? 'bg-slate-100 text-slate-700'
                                  : (response.visibility === 'full'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-slate-100 text-slate-700')
                              }>
                                {hiddenForViewer
                                  ? 'not_shared'
                                  : (String(response.visibility || '').toLowerCase() === 'partial' ? 'hidden' : response.visibility)}
                              </Badge>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-lg">
                              <p className="text-slate-700">
                                {getResponseDisplayValue(response)}
                              </p>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                {/* Quick Actions */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {isPartyB && proposal.status === 'received' && (
                      <Button 
                        className="w-full bg-green-600 hover:bg-green-700"
                        onClick={() => expressInterestMutation.mutate()}
                      >
                        <ThumbsUp className="w-4 h-4 mr-2" />
                        Express Interest
                      </Button>
                    )}
                    <Button variant="outline" className="w-full">
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Add Comment
                    </Button>
                    <Button variant="outline" className="w-full">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Document
                    </Button>
                  </CardContent>
                </Card>

                {/* Activity Timeline */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Activity Timeline</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex items-start gap-4">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                          <FileText className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-medium">Proposal Created</p>
                          <p className="text-sm text-slate-500">{new Date(proposal.created_date).toLocaleString()}</p>
                        </div>
                      </div>
                      {proposal.sent_at && (
                        <div className="flex items-start gap-4">
                          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                            <Send className="w-4 h-4 text-green-600" />
                          </div>
                          <div>
                            <p className="font-medium">Proposal Sent</p>
                            <p className="text-sm text-slate-500">{new Date(proposal.sent_at).toLocaleString()}</p>
                          </div>
                        </div>
                      )}
                      {evaluations.map(evalRun => (
                        <div key={evalRun.id} className="flex items-start gap-4">
                          <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                            <Sparkles className="w-4 h-4 text-purple-600" />
                          </div>
                          <div>
                            <p className="font-medium">AI Evaluation Run</p>
                            <p className="text-sm text-slate-500">
                              Score: {evalRun.overall_score}% • {new Date(evalRun.created_date).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ))}
                      {proposal.mutual_reveal && (
                        <div className="flex items-start gap-4">
                          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                          </div>
                          <div>
                            <p className="font-medium">Reveal Status: Passed</p>
                            <p className="text-sm text-slate-500">Both parties agreed to reveal identities</p>
                          </div>
                        </div>
                      )}
                      {!proposal.mutual_reveal && (proposal.reveal_requested_by_a || proposal.reveal_requested_by_b) && (
                        <div className="flex items-start gap-4">
                          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                            <Clock className="w-4 h-4 text-amber-600" />
                          </div>
                          <div>
                            <p className="font-medium">Reveal Status: Pending</p>
                            <p className="text-sm text-slate-500">Waiting for mutual reveal agreement</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* AI Report Tab */}
          <TabsContent value="evaluation">
            {/* FitCard Report for Profile Matching Template */}
            {isProfileMatchingTemplate && fitCardReport?.status === 'succeeded' && fitCardReport.output_report_json && (
              <div className="space-y-6">
                <Card className="border-0 shadow-sm bg-gradient-to-br from-purple-50 to-indigo-50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-purple-600" />
                        Profile Evaluation Report
                      </CardTitle>
                      <Badge variant="outline">Shared with both parties</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="p-4 bg-white rounded-lg">
                        <p className="text-sm text-slate-600">Mode</p>
                        <p className="text-xl font-bold">{fitCardReport.mode_value}</p>
                      </div>
                      <div className="p-4 bg-white rounded-lg">
                        <p className="text-sm text-slate-600">Match Level</p>
                        <p className="text-xl font-bold capitalize">{fitCardReport.output_report_json.summary?.fit_level || 'Unknown'}</p>
                      </div>
                    </div>

                    {fitCardReport.output_report_json.must_haves_check && (
                      <div className="mb-4 p-4 bg-white rounded-lg">
                        <h4 className="font-semibold mb-2">Must-Haves Check</h4>
                        <p className="text-2xl font-bold text-blue-600">
                          {fitCardReport.output_report_json.must_haves_check.satisfied_count} / {fitCardReport.output_report_json.must_haves_check.total_count}
                        </p>
                        {fitCardReport.output_report_json.must_haves_check.missing_items?.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {fitCardReport.output_report_json.must_haves_check.missing_items.map((item, idx) => (
                              <div key={idx} className="text-sm p-2 bg-red-50 border border-red-100 rounded">
                                {item.text}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {fitCardReport.output_report_json.summary?.top_strengths?.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                          Top Match Reasons
                        </h4>
                        <div className="space-y-2">
                          {fitCardReport.output_report_json.summary.top_strengths.map((strength, idx) => (
                            <div key={idx} className="p-3 bg-green-50 border border-green-100 rounded-lg">
                              <p className="text-sm text-slate-800">{strength.text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {fitCardReport.output_report_json.summary?.key_gaps?.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <XCircle className="w-4 h-4 text-red-600" />
                          Key Gaps
                        </h4>
                        <div className="space-y-2">
                          {fitCardReport.output_report_json.summary.key_gaps.map((gap, idx) => (
                            <div key={idx} className="p-3 bg-red-50 border border-red-100 rounded-lg">
                              <p className="text-sm text-slate-800">{gap.text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {fitCardReport.output_report_json.flags?.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          Flags & Concerns
                        </h4>
                        <div className="space-y-2">
                          {fitCardReport.output_report_json.flags.map((flag, idx) => (
                            <div key={idx} className={`p-3 rounded-lg border ${
                              flag.severity === 'high' ? 'bg-red-50 border-red-200' :
                              flag.severity === 'med' ? 'bg-amber-50 border-amber-200' :
                              'bg-blue-50 border-blue-200'
                            }`}>
                              <div className="flex items-start gap-2">
                                <Badge className={
                                  flag.severity === 'high' ? 'bg-red-600' :
                                  flag.severity === 'med' ? 'bg-amber-600' :
                                  'bg-blue-600'
                                }>
                                  {flag.severity}
                                </Badge>
                                <div className="flex-1">
                                  <p className="font-medium text-sm">{flag.title}</p>
                                  <p className="text-sm text-slate-600 mt-1">{flag.detail}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {fitCardReport.output_report_json.followup_questions?.length > 0 && (
                      <div>
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-blue-600" />
                          Follow-up Questions
                        </h4>
                        <div className="space-y-2">
                          {fitCardReport.output_report_json.followup_questions.map((q, idx) => (
                            <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                              <div className="flex items-start gap-2">
                                <Badge variant="outline" className="text-xs">{q.priority}</Badge>
                                <div className="flex-1">
                                  <p className="text-sm font-medium">{q.question_text}</p>
                                  <p className="text-xs text-slate-600 mt-1">{q.why_this_matters}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Button 
                  variant="outline"
                  onClick={() => handleRunEvaluationClick()}
                  disabled={runNewEvaluationMutation.isPending || fitCardReport?.status === 'running'}
                  className="w-full"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Re-run Profile Evaluation
                </Button>
              </div>
            )}

            {isProfileMatchingTemplate && fitCardReport?.status === 'running' && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <RefreshCw className="w-12 h-12 text-purple-500 mx-auto mb-4 animate-spin" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Generating Profile Evaluation</h3>
                  <p className="text-slate-500">This may take 10-30 seconds...</p>
                </CardContent>
              </Card>
            )}

            {isProfileMatchingTemplate && fitCardReport?.status === 'failed' && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <XCircle className="w-12 h-12 text-red-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Evaluation Failed</h3>
                  <p className="text-slate-500 mb-4">{fitCardReport.error_message || 'Unknown error'}</p>
                  <Button 
                    onClick={() => handleRunEvaluationClick()}
                    disabled={runNewEvaluationMutation.isPending}
                    variant="outline"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Retry
                  </Button>
                </CardContent>
              </Card>
            )}

            {isProfileMatchingTemplate && !fitCardReport && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No profile evaluation yet</h3>
                  <p className="text-slate-500 mb-6">Run a profile evaluation to see compatibility analysis.</p>
                  <Button 
                    onClick={() => handleRunEvaluationClick()}
                    disabled={runNewEvaluationMutation.isPending}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    {runNewEvaluationMutation.isPending ? 'Generating...' : 'Run Profile Evaluation'}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Shared Report for Finance Template */}
            {isFinanceTemplate && sharedReport?.status === 'succeeded' && sharedReport.output_report_json && (
              <div className="space-y-6">
                <Card className="border-0 shadow-sm bg-gradient-to-br from-emerald-50 to-blue-50">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-emerald-600" />
                        Shared Evaluation Report
                      </CardTitle>
                      <Badge variant="outline">
                        Both parties see this report
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="p-4 bg-white rounded-lg">
                        <p className="text-sm text-slate-600">Deal Mode</p>
                        <p className="text-xl font-bold">{sharedReport.mode_value}</p>
                      </div>
                      <div className="p-4 bg-white rounded-lg">
                        <p className="text-sm text-slate-600">Overall Fit</p>
                        <p className="text-xl font-bold capitalize">{sharedReport.output_report_json.summary?.fit_level || 'Unknown'}</p>
                      </div>
                    </div>

                    {sharedReport.output_report_json.summary?.top_fit_reasons?.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                          Top Match Reasons
                        </h4>
                        <div className="space-y-2">
                          {sharedReport.output_report_json.summary.top_fit_reasons.map((reason, idx) => (
                            <div key={idx} className="p-3 bg-green-50 border border-green-100 rounded-lg">
                              <p className="text-sm text-slate-800">{reason.text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {sharedReport.output_report_json.summary?.top_blockers?.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <XCircle className="w-4 h-4 text-red-600" />
                          Top Blockers
                        </h4>
                        <div className="space-y-2">
                          {sharedReport.output_report_json.summary.top_blockers.map((blocker, idx) => (
                            <div key={idx} className="p-3 bg-red-50 border border-red-100 rounded-lg">
                              <p className="text-sm text-slate-800">{blocker.text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {sharedReport.output_report_json.flags?.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          Flags & Concerns
                        </h4>
                        <div className="space-y-2">
                          {sharedReport.output_report_json.flags.map((flag, idx) => (
                            <div key={idx} className={`p-3 rounded-lg border ${
                              flag.severity === 'high' ? 'bg-red-50 border-red-200' :
                              flag.severity === 'med' ? 'bg-amber-50 border-amber-200' :
                              'bg-blue-50 border-blue-200'
                            }`}>
                              <div className="flex items-start gap-2">
                                <Badge className={
                                  flag.severity === 'high' ? 'bg-red-600' :
                                  flag.severity === 'med' ? 'bg-amber-600' :
                                  'bg-blue-600'
                                }>
                                  {flag.severity}
                                </Badge>
                                <div className="flex-1">
                                  <p className="font-medium text-sm">{flag.title}</p>
                                  <p className="text-sm text-slate-600 mt-1">{flag.detail}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {sharedReport.output_report_json.followup_questions?.length > 0 && (
                      <div>
                        <h4 className="font-semibold mb-2 flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-blue-600" />
                          Follow-up Questions
                        </h4>
                        <div className="space-y-2">
                          {sharedReport.output_report_json.followup_questions.map((q, idx) => (
                            <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                              <div className="flex items-start gap-2">
                                <Badge variant="outline" className="text-xs">
                                  {q.priority}
                                </Badge>
                                <div className="flex-1">
                                  <p className="text-sm font-medium">{q.question_text}</p>
                                  <p className="text-xs text-slate-600 mt-1">{q.why_this_matters}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Button 
                  variant="outline"
                  onClick={() => handleRunEvaluationClick()}
                  disabled={runNewEvaluationMutation.isPending || sharedReport?.status === 'running'}
                  className="w-full"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Re-run Evaluation
                </Button>
              </div>
            )}

            {isFinanceTemplate && sharedReport?.status === 'running' && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <RefreshCw className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Generating shared evaluation</h3>
                  <p className="text-slate-500">This may take 10-30 seconds...</p>
                </CardContent>
              </Card>
            )}

            {isFinanceTemplate && sharedReport?.status === 'failed' && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <XCircle className="w-12 h-12 text-red-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Evaluation Failed</h3>
                  <p className="text-slate-500 mb-4">{sharedReport.error_message || 'Unknown error'}</p>
                  <Button 
                    onClick={() => handleRunEvaluationClick()}
                    disabled={runNewEvaluationMutation.isPending}
                    variant="outline"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Retry Evaluation
                  </Button>
                </CardContent>
              </Card>
            )}

            {isFinanceTemplate && !sharedReport && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No evaluation yet</h3>
                  <p className="text-slate-500 mb-6">Run an AI evaluation to get comprehensive compatibility analysis.</p>
                  <Button 
                    onClick={() => handleRunEvaluationClick()}
                    disabled={runNewEvaluationMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    {runNewEvaluationMutation.isPending ? 'Evaluating...' : 'Run Evaluation'}
                  </Button>
                  {runNewEvaluationMutation.isPending && (
                    <p className="text-sm text-slate-500 mt-4">This may take 10-30 seconds...</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Standard Reports (Non-Finance Templates) */}
            {!isFinanceTemplate && evaluationReports.length > 0 && (
              <Card className="border-0 shadow-sm mb-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    Evaluation History ({evaluationReports.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {evaluationReports.map((report, idx) => (
                      <div key={report.id} className={`p-3 rounded-lg border ${
                        idx === 0 ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Badge className={
                              report.status === 'succeeded' ? 'bg-green-600' :
                              report.status === 'failed' ? 'bg-red-600' :
                              report.status === 'running' ? 'bg-blue-600' :
                              'bg-slate-600'
                            }>
                              {report.status}
                            </Badge>
                            <span className="text-sm text-slate-600">
                              {new Date(report.generated_at || report.created_date).toLocaleString()}
                            </span>
                            {idx === 0 && <Badge variant="outline">Latest</Badge>}
                          </div>
                          {report.status === 'succeeded' && report.output_report_json && (
                            <span className="text-sm font-medium text-blue-600">
                              {Math.round((report.output_report_json.quality?.confidence_overall || 0) * 100)}% confidence
                            </span>
                          )}
                        </div>
                        {report.status === 'failed' && report.error_message && (
                          <p className="text-xs text-red-600 mt-2">{report.error_message}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {!isFinanceTemplate && !latestReport && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No evaluation yet</h3>
                  <p className="text-slate-500 mb-6">Run an AI evaluation to get comprehensive compatibility analysis.</p>
                  <Button 
                    onClick={() => handleRunEvaluationClick()}
                    disabled={runNewEvaluationMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    {runNewEvaluationMutation.isPending ? 'Evaluating...' : 'Run Evaluation'}
                  </Button>
                  {runNewEvaluationMutation.isPending && (
                    <p className="text-sm text-slate-500 mt-4">This may take 10-30 seconds...</p>
                  )}
                </CardContent>
              </Card>
            )}

            {!isFinanceTemplate && latestReport && (latestReport.status === 'queued' || latestReport.status === 'running') && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <RefreshCw className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Evaluation in progress</h3>
                  <p className="text-slate-500">This may take 10-30 seconds...</p>
                  <Badge className="mt-4 bg-blue-600">{latestReport.status}</Badge>
                </CardContent>
              </Card>
            )}
            
            {!isFinanceTemplate && latestReport && latestReport.status === 'succeeded' && latestReport.output_report_json && (
              <div className="space-y-6">
                {/* Quality Metrics */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Quality Assessment</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-slate-500">Party A Completeness</p>
                        <p className="text-2xl font-bold">{Math.round((latestReport.output_report_json.quality?.completeness_a || 0) * 100)}%</p>
                      </div>
                      <div>
                        <p className="text-sm text-slate-500">Party B Completeness</p>
                        <p className="text-2xl font-bold">{Math.round((latestReport.output_report_json.quality?.completeness_b || 0) * 100)}%</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-sm text-slate-500 mb-2">Overall Confidence</p>
                        <Progress value={(latestReport.output_report_json.quality?.confidence_overall || 0) * 100} className="h-3" />
                        <p className="text-xs text-slate-500 mt-1">
                          {latestReport.output_report_json.quality?.confidence_reasoning?.join(' • ')}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Summary */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Executive Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-4">
                      <Badge className={
                        latestReport.output_report_json.summary?.fit_level === 'high' ? 'bg-green-600' :
                        latestReport.output_report_json.summary?.fit_level === 'medium' ? 'bg-amber-600' :
                        'bg-slate-600'
                      }>
                        {(latestReport.output_report_json.summary?.fit_level || 'unknown')} fit
                      </Badge>
                    </div>
                    
                    {latestReport.output_report_json.summary?.top_fit_reasons?.length > 0 && (
                          <div>
                            <p className="font-medium mb-2">Top Match Reasons</p>
                        <ul className="space-y-1">
                          {latestReport.output_report_json.summary.top_fit_reasons.map((reason, i) => (
                            <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                              {reason.text}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {latestReport.output_report_json.summary?.top_blockers?.length > 0 && (
                      <div>
                        <p className="font-medium mb-2">Top Blockers</p>
                        <ul className="space-y-1">
                          {latestReport.output_report_json.summary.top_blockers.map((blocker, i) => (
                            <li key={i} className="text-sm text-red-600 flex items-start gap-2">
                              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                              {blocker.text}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {latestReport.output_report_json.summary?.next_actions?.length > 0 && (
                      <div>
                        <p className="font-medium mb-2">Next Actions</p>
                        <ul className="space-y-1">
                          {latestReport.output_report_json.summary.next_actions.map((action, i) => (
                            <li key={i} className="text-sm text-blue-600 flex items-start gap-2">
                              <ChevronRight className="w-4 h-4 flex-shrink-0 mt-0.5" />
                              {action}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Flags */}
                {latestReport.output_report_json.flags?.length > 0 && (
                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle>Flags & Risks</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {latestReport.output_report_json.flags.map((flag, i) => (
                          <div key={i} className={`p-3 rounded-lg ${
                            flag.severity === 'high' ? 'bg-red-50' :
                            flag.severity === 'med' ? 'bg-amber-50' :
                            'bg-slate-50'
                          }`}>
                            <div className="flex items-start gap-2">
                              <Badge className={
                                flag.severity === 'high' ? 'bg-red-600' :
                                flag.severity === 'med' ? 'bg-amber-600' :
                                'bg-slate-600'
                              }>
                                {flag.severity}
                              </Badge>
                              <div>
                                <p className="font-medium">{flag.title}</p>
                                <p className="text-sm text-slate-600">{flag.detail}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Follow-up Questions */}
                {latestReport.output_report_json.followup_questions?.length > 0 && (
                  <Card className="border-0 shadow-sm">
                    <CardHeader>
                      <CardTitle>Recommended Follow-up Questions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {latestReport.output_report_json.followup_questions.map((q, i) => (
                          <div key={i} className="p-3 bg-blue-50 rounded-lg">
                            <div className="flex items-start gap-2">
                              <Badge className={
                                q.priority === 'high' ? 'bg-red-600' :
                                q.priority === 'med' ? 'bg-amber-600' :
                                'bg-slate-600'
                              }>
                                {q.priority}
                              </Badge>
                              <div>
                                <p className="font-medium">{q.question_text}</p>
                                <p className="text-sm text-slate-600 mt-1">{q.why_this_matters}</p>
                                <Badge variant="outline" className="text-xs mt-2">To: Party {(q.to_party || '').toUpperCase()}</Badge>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Failed Evaluation Display */}
            {!isFinanceTemplate && latestReport && latestReport.status === 'failed' && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <XCircle className="w-12 h-12 text-red-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Evaluation Failed</h3>
                  <p className="text-slate-500 mb-4">{latestReport.error_message || 'Unknown error'}</p>
                  {latestReport.raw_output && (
                    <details className="mt-4 text-left">
                      <summary className="cursor-pointer text-sm text-slate-600">View raw output</summary>
                      <pre className="mt-2 p-3 bg-slate-100 rounded text-xs overflow-auto max-h-48">
                        {latestReport.raw_output}
                      </pre>
                    </details>
                  )}
                  <Button 
                    onClick={() => handleRunEvaluationClick()}
                    disabled={runNewEvaluationMutation.isPending}
                    variant="outline"
                    className="mt-4"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Retry Evaluation
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>



          {/* Full Proposal Tab */}

        </Tabs>

        <Dialog open={sendReportModalOpen} onOpenChange={setSendReportModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Send AI Report</DialogTitle>
              <DialogDescription>
                Send a secure report link by email.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>To</Label>
                <Input
                  type="email"
                  placeholder="recipient@example.com"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Message (Optional)</Label>
                <Textarea
                  placeholder="Add an optional message"
                  value={emailMessage}
                  onChange={(e) => setEmailMessage(e.target.value)}
                  className="min-h-[120px]"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setSendReportModalOpen(false)}
                disabled={sendReportMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => sendReportMutation.mutate()}
                disabled={sendReportMutation.isPending || !recipientEmail.trim()}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {sendReportMutation.isPending ? 'Sending...' : 'Send'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
