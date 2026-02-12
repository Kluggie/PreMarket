import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { 
  Loader2, RefreshCw, XCircle, FileText, BarChart3, 
  Sparkles, ArrowLeft 
} from 'lucide-react';
import { FitCardReportDisplay, SharedFinanceReportDisplay, StandardReportDisplay, DocumentComparisonReportDisplay } from '../components/reports/AIReportDisplay';

const FRIENDLY_ERROR_MESSAGES = {
  AUTH_REQUIRED: 'Please sign in to continue.',
  TOKEN_NOT_FOUND: 'This shared link is invalid or no longer exists.',
  TOKEN_EXPIRED: 'This shared link has expired. Request a new link.',
  MAX_VIEWS_REACHED: 'This shared link has reached its maximum number of views.',
  RECIPIENT_MISMATCH: 'This link belongs to a different recipient account.',
  RECIPIENT_REQUIRED: 'This shared link is invalid. Ask the sender to share the report again.',
  TOKEN_INACTIVE: 'This shared link is inactive.',
  PROPOSAL_NOT_FOUND: 'The linked proposal could not be found.',
  PROPOSAL_LINK_MISSING: 'This shared link is not connected to a proposal.',
  VIEW_NOT_ALLOWED: 'Viewing is disabled for this link.',
  EDIT_NOT_ALLOWED: 'Editing is disabled for this shared link.',
  REEVALUATION_NOT_ALLOWED: 'Re-evaluation is disabled for this shared link.',
  REEVALUATION_LIMIT_REACHED: 'Re-evaluation limit reached for this shared link.',
  SEND_BACK_NOT_ALLOWED: 'Send-back is disabled for this shared link.'
};

const TEXTAREA_FIELD_TYPES = new Set(['textarea', 'long_text', 'multiline', 'text_area']);
const SELECT_FIELD_TYPES = new Set(['select', 'enum', 'dropdown', 'radio', 'single_select']);
const NUMBER_FIELD_TYPES = new Set(['number', 'integer', 'float', 'decimal', 'currency', 'percent']);
const BOOLEAN_FIELD_TYPES = new Set(['boolean', 'bool', 'checkbox', 'toggle', 'switch']);
const PARTY_B_KEYS = new Set(['b', 'party_b', 'recipient', 'counterparty']);

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

function buildErrorMeta(error) {
  const statusCode =
    error?.status ||
    error?.response?.status ||
    error?.originalError?.response?.status ||
    null;
  const responseBody =
    error?.data ||
    error?.response?.data ||
    error?.originalError?.response?.data ||
    null;
  const reasonCode =
    responseBody?.code ||
    responseBody?.reason ||
    responseBody?.errorCode ||
    error?.code ||
    'INVOKE_ERROR';

  return {
    statusCode,
    reasonCode,
    responseBody,
    message:
      responseBody?.message ||
      error?.message ||
      'Failed to resolve shared report'
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

async function invokeSharedResolver(token, options = {}) {
    const payload = {
      token,
      ...(typeof options.consumeView === 'boolean' ? { consumeView: options.consumeView } : {}),
      ...(options.debug ? { debug: '1' } : {})
    };

    try {
      const result = await base44.functions.invoke('ResolveSharedReport', payload);
      return {
        ...result,
        data: {
          ...(result?.data || {}),
          _clientEndpointUsed: 'ResolveSharedReport'
        }
      };
    } catch (error) {
      const meta = buildErrorMeta(error);
      const missingResolver =
        meta.statusCode === 404 &&
        (!meta.responseBody || (!meta.responseBody.code && !meta.responseBody.reason));

      if (!missingResolver) {
        throw error;
      }

      const fallback = await base44.functions.invoke('GetSharedReportData', payload);
      return {
        ...fallback,
        data: {
          ...(fallback?.data || {}),
          _clientEndpointUsed: 'GetSharedReportData'
        }
      };
    }
  }

async function invokeSharedComparisonDetails(token, options = {}) {
  const payload = {
    token,
    ...(typeof options.consumeView === 'boolean' ? { consumeView: options.consumeView } : {}),
    ...(options.debug ? { debug: '1' } : {})
  };

  return base44.functions.invoke('GetSharedComparisonDetails', payload);
}

function toArray(input) {
  return Array.isArray(input) ? input : [];
}

function normalizeAllowedValues(values) {
  return toArray(values)
    .map((value, index) => {
      if (value && typeof value === 'object') {
        const rawValue = value.value ?? value.id ?? value.key ?? value.code ?? value.label ?? value.name;
        const rawLabel = value.label ?? value.name ?? value.value ?? value.id ?? value.key ?? value.code;
        return {
          key: `opt_${index}_${String(rawValue ?? '')}`,
          value: rawValue === undefined || rawValue === null ? '' : String(rawValue),
          label: rawLabel === undefined || rawLabel === null ? '' : String(rawLabel)
        };
      }

      if (value === undefined || value === null) {
        return {
          key: `opt_${index}_empty`,
          value: '',
          label: ''
        };
      }

      return {
        key: `opt_${index}_${String(value)}`,
        value: String(value),
        label: String(value)
      };
    })
    .filter((item) => item.value.length > 0);
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y'].includes(normalized);
}

function toFieldType(question) {
  return String(question?.fieldType || question?.field_type || '').toLowerCase();
}

function normalizePartyKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isPartyBResponse(response) {
  return PARTY_B_KEYS.has(normalizePartyKey(response?.entered_by_party));
}

function formatSharedResponseValue(response) {
  const valueType = String(response?.value_type || '').toLowerCase();
  if (valueType === 'range') {
    const min = response?.range_min;
    const max = response?.range_max;
    if (min === null || min === undefined || max === null || max === undefined) return null;
    return `${min} - ${max}`;
  }

  const value = response?.value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function toInitialEdit(question) {
  const hasRange =
    question?.currentResponse?.rangeMin !== null && question?.currentResponse?.rangeMin !== undefined ||
    question?.currentResponse?.rangeMax !== null && question?.currentResponse?.rangeMax !== undefined;
  const currentVisibility = String(question?.currentResponse?.visibility || 'full').toLowerCase();

  return {
    questionId: question?.questionId,
    valueType: hasRange ? 'range' : (question?.valueType || 'text'),
    value: question?.currentResponse?.value ?? '',
    rangeMin: question?.currentResponse?.rangeMin ?? null,
    rangeMax: question?.currentResponse?.rangeMax ?? null,
    visibility: currentVisibility === 'hidden' ? 'hidden' : 'full'
  };
}

export default function SharedReport() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('overview');
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);
  const [shareData, setShareData] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [proposalView, setProposalView] = useState(null);
  const [proposalId, setProposalId] = useState(null);
  const [sourceProposalId, setSourceProposalId] = useState(null);
  const [snapshotId, setSnapshotId] = useState(null);
  const [snapshotVersion, setSnapshotVersion] = useState(null);
  const [snapshotData, setSnapshotData] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [partyAView, setPartyAView] = useState({ proposal: null, responses: [] });
  const [partyBEditableSchema, setPartyBEditableSchema] = useState({ totalQuestions: 0, editableQuestionIds: [], questions: [] });
  const [responsesView, setResponsesView] = useState([]);
  const [comparisonView, setComparisonView] = useState(null);
  const [comparisonDetailsData, setComparisonDetailsData] = useState(null);
  const [comparisonDetailsError, setComparisonDetailsError] = useState(null);
  const [isLoadingComparisonDetails, setIsLoadingComparisonDetails] = useState(false);
  const [recipientEdits, setRecipientEdits] = useState({});
  const [recipientEditMode, setRecipientEditMode] = useState(false);
  const [sendBackMessage, setSendBackMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isReevaluating, setIsReevaluating] = useState(false);
  const [isSendingBack, setIsSendingBack] = useState(false);
  const [reevaluationState, setReevaluationState] = useState(null);
  const [debugData, setDebugData] = useState(null);
  const resolvedTokenRef = useRef(null);
  const comparisonDetailsTokenRef = useRef(null);
  const workspaceSectionRef = useRef(null);
  const ensuredSnapshotAccessRef = useRef(new Set());

  const token = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('token') || params.get('sharedToken');
  }, [location.search]);

  const mode = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('mode');
  }, [location.search]);

  const debugMode = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('debug') === '1';
  }, [location.search]);

  const reportTitle = useMemo(() => {
    if (proposalView?.title) return proposalView.title;
    if (reportData?.title) return reportData.title;
    if (reportData?.type === 'proposal') return 'Shared Proposal Report';
    if (reportData?.type === 'document_comparison') return 'Shared Comparison Report';
    return 'Shared AI Report';
  }, [reportData, proposalView]);

  const isDocumentComparison = Boolean(reportData?.type === 'document_comparison' || comparisonView);
  
  const recipientEditableQuestions = useMemo(() => {
    const questions = toArray(partyBEditableSchema?.questions);
    
    // For document comparison, add Party B Notes field
    if (isDocumentComparison && questions.length === 0) {
      const existingNotes = toArray(responsesView)
        .find(r => r?.question_id === 'party_b_notes' && isPartyBResponse(r));
      
      return [{
        questionId: 'party_b_notes',
        label: 'Your Notes / Response',
        description: 'Add your notes or response to this document comparison',
        fieldType: 'textarea',
        valueType: 'text',
        required: false,
        supportsVisibility: false,
        allowedValues: [],
        currentResponse: {
          id: existingNotes?.id || null,
          value: existingNotes?.value || '',
          rangeMin: null,
          rangeMax: null,
          visibility: 'full',
          enteredByParty: 'b',
          updatedAt: existingNotes?.created_date || null
        }
      }];
    }
    
    return questions;
  }, [partyBEditableSchema, isDocumentComparison, responsesView]);

  const completeDetailsRows = useMemo(() => {
    const labelByQuestionId = {};
    toArray(partyAView?.responses).forEach((item) => {
      if (!item?.questionId || !item?.label) return;
      labelByQuestionId[item.questionId] = item.label;
    });
    recipientEditableQuestions.forEach((question) => {
      if (!question?.questionId || !question?.label) return;
      labelByQuestionId[question.questionId] = question.label;
    });

    const rows = [];

    // Add Party A responses (template-based)
    toArray(partyAView?.responses).forEach((item) => {
      const questionId = item?.questionId || '';
      const redaction = String(item?.redaction || '').toLowerCase();
      const value = String(item?.valueSummary || '').trim();

      if (!questionId || redaction === 'hidden' || !value) return;

      rows.push({
        key: item?.id || `party_a_${questionId}`,
        label: item?.label || questionId.replace(/_/g, ' '),
        value,
        party: 'Party A'
      });
    });

    const partyBRowsFromResponses = toArray(responsesView)
      .filter((response) => isPartyBResponse(response))
      .filter((response) => {
        const visibility = String(response?.visibility || '').toLowerCase();
        return visibility !== 'hidden' && visibility !== 'not_shared';
      })
      .map((response) => {
        const questionId = response?.question_id || '';
        const value = formatSharedResponseValue(response);
        if (!questionId || value === null) return null;
        return {
          key: response?.id || `${questionId}_${response?.created_date || ''}`,
          label: labelByQuestionId[questionId] || questionId.replace(/_/g, ' '),
          value,
          party: 'Party B'
        };
      })
      .filter(Boolean);

    const partyBRowsFromSchema = recipientEditableQuestions
      .map((question, index) => {
        const current = question?.currentResponse || {};
        const visibility = String(current.visibility || 'full').toLowerCase();
        if (visibility === 'hidden' || visibility === 'not_shared') return null;

        const questionId = question?.questionId || '';
        if (!questionId) return null;

        const rangeMin = current?.rangeMin;
        const rangeMax = current?.rangeMax;
        const hasRange = rangeMin !== null && rangeMin !== undefined && rangeMax !== null && rangeMax !== undefined;
        const rawValue = current?.value;
        const textValue = rawValue === null || rawValue === undefined ? '' : String(rawValue).trim();

        if (!hasRange && textValue.length === 0) return null;

        return {
          key: current?.id || `party_b_schema_${questionId}_${index}`,
          label: question?.label || labelByQuestionId[questionId] || questionId.replace(/_/g, ' '),
          value: hasRange ? `${rangeMin} - ${rangeMax}` : textValue,
          party: 'Party B'
        };
      })
      .filter(Boolean);

    const partyBRows = partyBRowsFromResponses.length > 0
      ? partyBRowsFromResponses
      : partyBRowsFromSchema;

    return [...rows, ...partyBRows];
  }, [responsesView, partyAView, recipientEditableQuestions]);

  const canEditRecipient = Boolean(permissions?.canEditRecipientSide ?? permissions?.canEdit) && Boolean(user);
  const canReevaluate = Boolean(permissions?.canReevaluate) && Boolean(user);
  const canSendBack = Boolean(permissions?.canSendBack) && Boolean(user);

  const hydrateSharedReport = useCallback(async ({ consumeView = true, silent = false } = {}) => {
    if (!token) return false;

    try {
      if (!silent) {
        setIsLoadingReport(true);
      }
      if (!silent) {
        setError(null);
      }

      const result = await invokeSharedResolver(token, { consumeView, debug: debugMode });
      const data = result?.data;

      if (debugMode) {
        const resolvedDocumentComparisonId =
          data?.comparisonView?.id ||
          data?.reportData?.documentComparisonId ||
          data?.shareLink?.documentComparisonId ||
          data?.proposalView?.document_comparison_id ||
          null;
        setDebugData({
          endpointUsed: data?._clientEndpointUsed || data?.endpoint || 'unknown',
          resolvedDocumentComparisonId,
          ...(data?.debug || {})
        });
      }

      if (!data || typeof data !== 'object' || !data.ok) {
        const reasonCode = data?.code || data?.reason || 'RESOLVE_FAILED';
        const statusCode = result?.status || null;
        const friendly = FRIENDLY_ERROR_MESSAGES[reasonCode] || data?.message || 'Unable to resolve shared link.';
        const errorMeta = {
          message: friendly,
          reasonCode,
          statusCode,
          correlationId: data?.correlationId || null,
          responseBody: data || null
        };

        console.error('[SharedReport] Resolve failed', {
          apiCall: {
            functionName: 'ResolveSharedReport',
            method: 'POST',
            payload: { token, consumeView }
          },
          statusCode,
          reasonCode,
          responseBody: data
        });

        setError(errorMeta);
        return false;
      }

      const resolvedShareData = data.shareLink || {};
      const resolvedReportData = data.reportData || {};
      const resolvedProposalView = data?.recipientView?.proposal || data?.proposalView || {};
      const contextProposalTitle =
        resolvedProposalView?.title ||
        resolvedReportData?.title ||
        resolvedShareData?.proposalTitle ||
        null;
      const contextTemplateName =
        resolvedProposalView?.template_name ||
        resolvedProposalView?.templateName ||
        resolvedReportData?.template_name ||
        resolvedReportData?.templateName ||
        null;
      const contextPartyAEmail =
        resolvedProposalView?.party_a_email ||
        resolvedProposalView?.partyAEmail ||
        data?.partyAView?.proposal?.party_a_email ||
        data?.partyAView?.proposal?.partyAEmail ||
        null;
      const resolvedProposalId =
        data.sourceProposalId ||
        data.proposalId ||
        resolvedShareData.proposalId ||
        resolvedReportData.proposalId ||
        resolvedReportData.proposal_id ||
        (resolvedReportData.type === 'proposal' ? resolvedReportData.id : null);
      const resolvedSnapshotId =
        data.snapshotId ||
        data?.snapshot?.id ||
        resolvedShareData.snapshotId ||
        null;
      const resolvedVersion =
        data.version ??
        data.snapshotVersion ??
        data?.snapshot?.version ??
        resolvedShareData.snapshotVersion ??
        null;

      const context = {
        token,
        proposalId: resolvedProposalId || null,
        sourceProposalId: resolvedProposalId || null,
        snapshotId: resolvedSnapshotId,
        version: resolvedVersion,
        role: 'recipient',
        proposalTitle: contextProposalTitle,
        templateName: contextTemplateName,
        partyAEmail: contextPartyAEmail,
        senderEmail: contextPartyAEmail,
        recipientEmail: data?.shareLink?.recipientEmail || null,
        currentUserEmail: data?.currentUserEmail || null,
        evaluationItemId: data.evaluationId || resolvedShareData.evaluationItemId || resolvedReportData.evaluationItemId || null,
        documentComparisonId: resolvedShareData.documentComparisonId || resolvedReportData.documentComparisonId || null,
        loadedAt: new Date().toISOString()
      };

      if (!resolvedProposalId) {
        setError({
          message: 'This shared report is valid but is not linked to a proposal.',
          reasonCode: 'PROPOSAL_LINK_MISSING',
          statusCode: 404,
          correlationId: data?.correlationId || null,
          responseBody: data
        });
        return false;
      }

      localStorage.setItem('sharedReportContext', JSON.stringify(context));
      window.dispatchEvent(new Event('shared-report-context-updated'));

      setShareData(resolvedShareData);
      setReportData(resolvedReportData);
      setProposalView(resolvedProposalView);
      setProposalId(resolvedProposalId);
      setSourceProposalId(resolvedProposalId || null);
      setSnapshotId(resolvedSnapshotId || null);
      setSnapshotVersion(
        resolvedVersion === null || resolvedVersion === undefined || Number.isNaN(Number(resolvedVersion))
          ? null
          : Number(resolvedVersion)
      );
      setSnapshotData(data.snapshotData || data?.snapshot?.snapshotData || null);
      setPermissions(data.permissions || {});
      setPartyAView(data.partyAView || { proposal: null, responses: [] });
      setPartyBEditableSchema(data.partyBEditableSchema || { totalQuestions: 0, editableQuestionIds: [], questions: [] });
      setResponsesView(data.responsesView || data?.recipientView?.responses || []);
      setComparisonView(data.comparisonView || data?.reportData?.comparisonView || null);
      setError(null);

      const sharedFieldCount = toArray(data.partyAView?.responses).filter(r => String(r?.redaction || '').toLowerCase() !== 'hidden').length;
      console.log('[SharedReport] snapshot', {
        snapshotId: resolvedSnapshotId,
        snapshotVersion: resolvedVersion,
        sourceProposalId: resolvedProposalId || null,
        sharedFieldCount,
        partyAFields: toArray(data.partyAView?.responses).length,
        partyBFields: recipientEditableQuestions.length,
        hiddenA: toArray(data.partyAView?.responses).filter(r => String(r?.redaction || '').toLowerCase() === 'hidden').length,
        responsesB: toArray(responsesView).filter(isPartyBResponse).length
      });

      return true;
    } catch (invokeError) {
      const invokeMeta = buildErrorMeta(invokeError);
      console.error('[SharedReport] Resolve threw', {
        apiCall: {
          functionName: 'ResolveSharedReport',
          method: 'POST',
          payload: { token, consumeView }
        },
        statusCode: invokeMeta.statusCode,
        reasonCode: invokeMeta.reasonCode,
        responseBody: invokeMeta.responseBody
      });

      setError({
        message: FRIENDLY_ERROR_MESSAGES[invokeMeta.reasonCode] || invokeMeta.message,
        reasonCode: invokeMeta.reasonCode,
        statusCode: invokeMeta.statusCode,
        correlationId: invokeMeta.responseBody?.correlationId || null,
        responseBody: invokeMeta.responseBody || null
      });
      return false;
    } finally {
      if (!silent) {
        setIsLoadingReport(false);
      }
    }
  }, [token]);

  const hydrateSharedComparisonDetails = useCallback(async ({ force = false } = {}) => {
    if (!token) return false;
    if (!force && comparisonDetailsTokenRef.current === token && comparisonDetailsData) return true;

    try {
      setIsLoadingComparisonDetails(true);
      setComparisonDetailsError(null);

      const result = await invokeSharedComparisonDetails(token, {
        consumeView: false,
        debug: debugMode
      });
      const data = result?.data || null;

      if (!data?.ok) {
        setComparisonDetailsData(data);
        setComparisonDetailsError({
          message: data?.message || data?.error || 'Failed to load shared comparison details.',
          reasonCode: data?.error || data?.code || 'REQUEST_FAILED',
          statusCode: result?.status || null,
          debug: data?.debug || null
        });
        return false;
      }

      comparisonDetailsTokenRef.current = token;
      setComparisonDetailsData(data);
      setComparisonDetailsError(null);
      return true;
    } catch (error) {
      const parsed = extractFunctionFailure(error, 'Failed to load shared comparison details');
      setComparisonDetailsError({
        message: parsed.message,
        reasonCode: parsed.reasonCode,
        statusCode: parsed.statusCode,
        debug: null
      });
      return false;
    } finally {
      setIsLoadingComparisonDetails(false);
    }
  }, [token, debugMode, comparisonDetailsData]);

  useEffect(() => {
    let active = true;
    base44.auth.me()
      .then((me) => {
        if (active) setUser(me || null);
      })
      .catch(() => {
        if (active) setUser(null);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    if (resolvedTokenRef.current === token) return;
    resolvedTokenRef.current = token;
    hydrateSharedReport({ consumeView: true, silent: false });
  }, [token, hydrateSharedReport]);

  useEffect(() => {
    comparisonDetailsTokenRef.current = null;
    setComparisonDetailsData(null);
    setComparisonDetailsError(null);
    setIsLoadingComparisonDetails(false);
  }, [token]);

  useEffect(() => {
    if (activeTab !== 'details') return;
    if (!token) return;
    if (isLoadingComparisonDetails) return;
    if (comparisonDetailsTokenRef.current === token && comparisonDetailsData?.ok) return;
    hydrateSharedComparisonDetails({ force: true });
  }, [activeTab, token, isLoadingComparisonDetails, comparisonDetailsData, hydrateSharedComparisonDetails]);

  useEffect(() => {
    if (mode !== 'workspace') return;
    workspaceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [mode, shareData, reportData, partyBEditableSchema]);

  useEffect(() => {
    const nextEdits = {};

    recipientEditableQuestions.forEach((question) => {
      if (!question?.questionId) return;
      nextEdits[question.questionId] = toInitialEdit(question);
    });

    setRecipientEdits(nextEdits);
  }, [recipientEditableQuestions]);

  useEffect(() => {
    if (!user?.id || !token || !snapshotId) return;

    const dedupeKey = `${user.id}:${snapshotId}`;
    if (ensuredSnapshotAccessRef.current.has(dedupeKey)) return;
    ensuredSnapshotAccessRef.current.add(dedupeKey);

    console.log('[ensureSnapshotAccess] called', { snapshotId });
    base44.functions.invoke('EnsureSnapshotAccess', {
      snapshotId,
      token
    }).catch((error) => {
      console.error('[ensureSnapshotAccess] failed', {
        snapshotId,
        message: error?.message || String(error)
      });
    });
  }, [user?.id, snapshotId, token]);

  const handleSignIn = () => {
    const returnPath = `${location.pathname}${location.search}`;
    base44.auth.redirectToLogin(returnPath);
  };

  const handleOpenWorkspace = () => {
    if (!token) return;
    navigate(createPageUrl(`SharedReport?token=${encodeURIComponent(token)}&mode=workspace`));
  };

  const handleRecipientEditChange = (questionId, patch) => {
    setRecipientEdits((prev) => ({
      ...prev,
      [questionId]: {
        ...(prev[questionId] || { questionId }),
        ...patch
      }
    }));
  };

  const buildRecipientPayload = () => {
    return Object.values(recipientEdits)
      .filter((entry) => entry?.questionId)
      .map((entry) => ({
        questionId: entry.questionId,
        valueType: entry.valueType || (entry.rangeMin !== null || entry.rangeMax !== null ? 'range' : 'text'),
        value: entry.value,
        rangeMin: entry.rangeMin,
        rangeMax: entry.rangeMax,
        visibility: String(entry.visibility || 'full').toLowerCase() === 'hidden' ? 'hidden' : 'full'
      }));
  };

  const handleSaveChanges = async () => {
    if (!token) return;

    const payload = buildRecipientPayload();
    if (payload.length === 0) {
      toast.error('No Party B fields are available to update.');
      return;
    }

    setIsSaving(true);

    try {
      const result = await base44.functions.invoke('UpsertSharedRecipientResponses', {
        token,
        responses: payload
      });

      const data = result?.data;
      if (!data?.ok) {
        const reasonCode = data?.code || data?.reason || 'UPDATE_FAILED';
        const message = FRIENDLY_ERROR_MESSAGES[reasonCode] || data?.message || 'Failed to save Party B updates.';
        throw new Error(`${message} (${reasonCode})`);
      }

      toast.success(data?.message || 'Party B changes saved.');
      setRecipientEditMode(false);
      await hydrateSharedReport({ consumeView: false, silent: true });
    } catch (error) {
      const parsed = extractFunctionFailure(error, 'Failed to save Party B updates');
      const friendly = FRIENDLY_ERROR_MESSAGES[parsed.reasonCode] || parsed.message;
      toast.error(friendly);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReevaluate = async () => {
    if (!token) return;
    setIsReevaluating(true);

    try {
      const result = await base44.functions.invoke('RunSharedReportReevaluation', {
        token
      });

      const data = result?.data;
      if (!data?.ok) {
        const reasonCode = data?.code || data?.reason || 'REEVALUATION_FAILED';
        const message = FRIENDLY_ERROR_MESSAGES[reasonCode] || data?.message || 'Re-evaluation failed.';
        throw new Error(`${message} (${reasonCode})`);
      }

      setReevaluationState(data?.reevaluation || null);
      toast.success(data?.message || 'Re-evaluation completed.');
      
      // Reload the shared report data to show new evaluation
      await hydrateSharedReport({ consumeView: false, silent: false });
      
      // Switch to evaluation tab to show new report
      setActiveTab('evaluation');
    } catch (error) {
      const parsed = extractFunctionFailure(error, 'Re-evaluation failed');
      const friendly = FRIENDLY_ERROR_MESSAGES[parsed.reasonCode] || parsed.message;
      toast.error(friendly);
    } finally {
      setIsReevaluating(false);
    }
  };

  const handleSendBack = async () => {
    if (!token) return;

    const message = sendBackMessage.trim();
    if (!message) {
      toast.error('Enter a response message before sending back.');
      return;
    }

    setIsSendingBack(true);

    try {
      const result = await base44.functions.invoke('SubmitSharedReportResponse', {
        token,
        message,
        counterproposal: {
          proposedChanges: buildRecipientPayload()
        }
      });

      const data = result?.data;
      if (!data?.ok) {
        const reasonCode = data?.code || data?.reason || 'SEND_BACK_FAILED';
        const messageText = FRIENDLY_ERROR_MESSAGES[reasonCode] || data?.message || 'Failed to submit response.';
        throw new Error(`${messageText} (${reasonCode})`);
      }

      setSendBackMessage('');
      toast.success(data?.message || 'Response sent back successfully.');
    } catch (error) {
      const parsed = extractFunctionFailure(error, 'Failed to send response back');
      const friendly = FRIENDLY_ERROR_MESSAGES[parsed.reasonCode] || parsed.message;
      toast.error(friendly);
    } finally {
      setIsSendingBack(false);
    }
  };

  const renderEditableField = (question) => {
    const questionId = question?.questionId;
    if (!questionId) return null;

    const edit = recipientEdits[questionId] || toInitialEdit(question);
    const fieldType = toFieldType(question);
    const valueType = String(edit?.valueType || question?.valueType || '').toLowerCase();
    const options = normalizeAllowedValues(question?.allowedValues);

    const isRange = valueType === 'range';
    const isBoolean = BOOLEAN_FIELD_TYPES.has(fieldType);
    const isNumeric = NUMBER_FIELD_TYPES.has(fieldType);
    const isSelect = options.length > 0 || SELECT_FIELD_TYPES.has(fieldType);
    const isTextarea = TEXTAREA_FIELD_TYPES.has(fieldType);
    const disabled = !canEditRecipient || !recipientEditMode;

    if (isRange) {
      return (
        <div className="grid grid-cols-2 gap-3">
          <Input
            type="number"
            value={edit.rangeMin ?? ''}
            onChange={(event) => handleRecipientEditChange(questionId, {
              valueType: 'range',
              rangeMin: event.target.value === '' ? null : Number(event.target.value)
            })}
            disabled={disabled}
            placeholder="Minimum"
          />
          <Input
            type="number"
            value={edit.rangeMax ?? ''}
            onChange={(event) => handleRecipientEditChange(questionId, {
              valueType: 'range',
              rangeMax: event.target.value === '' ? null : Number(event.target.value)
            })}
            disabled={disabled}
            placeholder="Maximum"
          />
        </div>
      );
    }

    if (isBoolean) {
      const checked = toBoolean(edit.value);
      return (
        <div className="flex items-center gap-3">
          <Checkbox
            id={`shared-question-${questionId}`}
            checked={checked}
            onCheckedChange={(nextChecked) => handleRecipientEditChange(questionId, {
              valueType: 'text',
              value: nextChecked === true
            })}
            disabled={disabled}
          />
          <Label htmlFor={`shared-question-${questionId}`}>{checked ? 'Yes' : 'No'}</Label>
        </div>
      );
    }

    if (isSelect) {
      const selectedValue = String(edit.value ?? '').trim() || '__unset__';
      return (
        <Select
          value={selectedValue}
          onValueChange={(nextValue) => handleRecipientEditChange(questionId, {
            valueType: 'text',
            value: nextValue === '__unset__' ? '' : nextValue
          })}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__unset__">Not specified</SelectItem>
            {options.map((option) => (
              <SelectItem key={option.key} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (isTextarea) {
      return (
        <Textarea
          rows={4}
          value={edit.value ?? ''}
          onChange={(event) => handleRecipientEditChange(questionId, {
            valueType: 'text',
            value: event.target.value
          })}
          disabled={disabled}
        />
      );
    }

    if (isNumeric) {
      return (
        <Input
          type="number"
          value={edit.value ?? ''}
          onChange={(event) => handleRecipientEditChange(questionId, {
            valueType: 'text',
            value: event.target.value
          })}
          disabled={disabled}
        />
      );
    }

    return (
      <Input
        value={edit.value ?? ''}
        onChange={(event) => handleRecipientEditChange(questionId, {
          valueType: 'text',
          value: event.target.value
        })}
        disabled={disabled}
      />
    );
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <XCircle className="w-10 h-10 text-red-500 mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-slate-900 mb-2">Missing access token</h1>
            <p className="text-slate-600 mb-6">This link is incomplete. Request a new report link.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoadingReport && !reportData) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <Loader2 className="w-10 h-10 text-blue-600 mx-auto mb-4 animate-spin" />
            <p className="text-slate-700 font-medium">Loading shared report...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-0 shadow-sm">
          <CardContent className="py-12 text-center">
            <XCircle className="w-10 h-10 text-red-500 mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-slate-900 mb-2">Unable to open shared report</h1>
            <p className="text-slate-600 mb-2">{error.message}</p>
            {error.reasonCode && (
              <p className="text-xs text-slate-500 mb-1">Reason: {error.reasonCode}</p>
            )}
            {error.statusCode && (
              <p className="text-xs text-slate-500 mb-1">HTTP: {error.statusCode}</p>
            )}
            {error.correlationId && (
              <p className="text-xs text-slate-500 mb-6">Correlation ID: {error.correlationId}</p>
            )}
            {!user && (
              <Button onClick={handleSignIn} className="bg-blue-600 hover:bg-blue-700 mr-2">
                Sign In
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate(createPageUrl('Dashboard'))}>
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const templateSlug = reportData?.template_name?.toLowerCase().replace(/\s+/g, '_');
  const isFinanceTemplate = templateSlug === 'universal_finance_deal_prequal';
  const isProfileMatchingTemplate = templateSlug === 'universal_profile_matching';

  const reportJson = reportData?.report || null;
  const partyAEmail = proposalView?.party_a_email || partyAView?.proposal?.party_a_email || 'Identity Protected';
  const partyBEmail = proposalView?.party_b_email || shareData?.recipientEmail || user?.email || 'Not specified';
  const comparisonDocA = comparisonDetailsData?.comparison?.docA || null;
  const comparisonDocB = comparisonDetailsData?.comparison?.docB || null;
  const comparisonDebugPanel = debugMode
    ? {
        endpointUsed: comparisonDetailsData?.endpoint || 'GetSharedComparisonDetails',
        resolvedShareLinkId:
          comparisonDetailsData?.debug?.resolvedShareLinkId ||
          comparisonDetailsData?.shareLink?.id ||
          null,
        resolvedDocumentComparisonId:
          comparisonDetailsData?.debug?.resolvedDocumentComparisonId ||
          comparisonDetailsData?.shareLink?.documentComparisonId ||
          null,
        shareLinkFound: comparisonDetailsData?.debug?.shareLinkFound ?? Boolean(comparisonDetailsData?.shareLink?.id),
        documentComparisonFound: comparisonDetailsData?.debug?.documentComparisonFound ?? Boolean(comparisonDetailsData?.comparison?.id),
        docATextLength:
          comparisonDetailsData?.debug?.docATextLength ??
          String(comparisonDocA?.text || '').length,
        docBTextLength:
          comparisonDetailsData?.debug?.docBTextLength ??
          String(comparisonDocB?.text || '').length,
        documentComparisonKeys: comparisonDetailsData?.debug?.documentComparisonKeys || []
      }
    : null;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <Button 
            variant="ghost" 
            onClick={() => navigate(createPageUrl('Dashboard'))}
            className="mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
          
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-slate-900">
                  {reportTitle}
                </h1>
                {proposalView?.status && <StatusBadge status={proposalView.status} />}
                {snapshotVersion !== null && snapshotVersion !== undefined && (
                  <Badge className="bg-blue-100 text-blue-700">v{snapshotVersion}</Badge>
                )}
              </div>
              <p className="text-slate-500">
                {reportData?.template_name || proposalView?.template_name || 'Shared Report'}
                {proposalView?.created_date && ` • Created ${new Date(proposalView.created_date).toLocaleDateString()}`}
              </p>
              <p className="text-sm text-blue-700 mt-1">
                Shared workspace - confidential data remains protected
              </p>
            </div>

            <div className="flex items-center gap-3">
              {canEditRecipient && (
                <Button
                  variant={recipientEditMode ? 'default' : 'outline'}
                  className={recipientEditMode ? 'bg-blue-600 hover:bg-blue-700' : ''}
                  onClick={() => setRecipientEditMode(!recipientEditMode)}
                >
                  {recipientEditMode ? 'Done Editing' : 'Edit Your Details'}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white border border-slate-200 p-1 mb-6">
            <TabsTrigger value="overview" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <FileText className="w-4 h-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="details" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <FileText className="w-4 h-4 mr-2" />
              Details
            </TabsTrigger>
            <TabsTrigger value="evaluation" className="data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <BarChart3 className="w-4 h-4 mr-2" />
              {isProfileMatchingTemplate ? 'Profile Evaluation' : 'AI Report'}
              {reportJson && (
                <Badge className="ml-2 bg-green-100 text-green-700 text-xs">
                  Available
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
                        <p className="font-medium text-slate-900">{partyAEmail}</p>
                      </div>
                      <div className="p-4 bg-indigo-50 rounded-xl">
                        <p className="text-sm text-indigo-600 font-medium mb-2">Party B (Recipient)</p>
                        <p className="font-medium text-slate-900">{partyBEmail}</p>
                        {user && <Badge className="mt-2 bg-indigo-100 text-indigo-700">You</Badge>}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Complete Proposal Details */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Complete Proposal Details</CardTitle>
                    <CardDescription>
                      {isDocumentComparison
                        ? 'Read-only document content with confidential sections removed.'
                        : 'Snapshot-based shared details. Party A confidential fields are hidden.'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {isDocumentComparison && comparisonView ? (
                      <div className="space-y-4">
                        {[
                          { doc: comparisonView.docA, label: comparisonView.docA?.label, color: 'blue' },
                          { doc: comparisonView.docB, label: comparisonView.docB?.label, color: 'indigo' }
                        ].filter(item => item.doc).map((item, index) => (
                          <div key={`doc-${index}`} className={`p-4 bg-${item.color}-50 rounded-xl border border-${item.color}-100`}>
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                              <p className={`text-sm text-${item.color}-700 font-semibold`}>
                                {item.label || `Document ${index + 1}`}
                              </p>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline">Source: {item.doc.source || 'typed'}</Badge>
                                {item.doc.hiddenCount > 0 && (
                                  <Badge className="bg-red-100 text-red-700 text-xs">
                                    {Number(item.doc.hiddenCount)} hidden
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="p-3 bg-white border border-slate-200 rounded-lg max-h-72 overflow-auto">
                              <pre className="whitespace-pre-wrap font-mono text-sm text-slate-800">
                                {item.doc.text || 'No text available'}
                              </pre>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : isDocumentComparison && !comparisonView ? (
                      <div className="text-center py-8">
                        <p className="text-amber-700 font-medium mb-2">⚠️ Snapshot contains no document comparison content</p>
                        <p className="text-sm text-slate-600">This may indicate a snapshot builder issue. Contact the sender.</p>
                      </div>
                    ) : completeDetailsRows.length === 0 ? (
                      <div>
                        <p className="text-slate-500 text-sm mb-2">No shared proposal details are available.</p>
                        <p className="text-xs text-amber-700">
                          Snapshot has {toArray(snapshotData?.partyAResponses).length || 0} fields 
                          ({toArray(partyAView?.responses).filter(r => String(r?.redaction || '').toLowerCase() !== 'hidden').length} visible, 
                          {toArray(partyAView?.responses).filter(r => String(r?.redaction || '').toLowerCase() === 'hidden').length} hidden)
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {completeDetailsRows.map((item) => (
                          <div key={item.key} className="p-4 border border-slate-200 rounded-xl">
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <p className="font-semibold text-slate-900 capitalize">{item.label}</p>
                                <Badge variant="outline" className="text-xs mt-1">
                                  {item.party}
                                </Badge>
                              </div>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-lg">
                              <p className="text-slate-700">{item.value}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Party B Editable Fields */}
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Your Details (Party B)</CardTitle>
                    <CardDescription>
                      You can edit only Party B fields. Party A values remain read-only.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {recipientEditableQuestions.length === 0 && (
                      <p className="text-slate-500 text-sm">No editable Party B fields were found.</p>
                    )}

                    {recipientEditableQuestions.map((question) => (
                      <div key={question.questionId} className="border rounded-lg p-3 space-y-2">
                        <Label className="font-medium text-slate-900">{question.label || question.questionId}</Label>
                        {question.description && (
                          <p className="text-xs text-slate-500">{question.description}</p>
                        )}
                        {renderEditableField(question)}
                        <div className="flex items-center gap-2 pt-1">
                          <Checkbox
                            id={`recipient-visibility-${question.questionId}`}
                            checked={String((recipientEdits[question.questionId] || {}).visibility || 'full').toLowerCase() === 'hidden'}
                            onCheckedChange={(nextChecked) => handleRecipientEditChange(question.questionId, {
                              visibility: nextChecked === true ? 'hidden' : 'full'
                            })}
                            disabled={!canEditRecipient || !recipientEditMode || isSaving}
                          />
                          <Label htmlFor={`recipient-visibility-${question.questionId}`} className="text-sm text-slate-700">
                            Keep this response confidential
                          </Label>
                        </div>
                      </div>
                    ))}

                    <div className="flex flex-wrap items-center gap-2 pt-2">
                      {recipientEditMode ? (
                        <Button
                          onClick={handleSaveChanges}
                          disabled={!canEditRecipient || isSaving || recipientEditableQuestions.length === 0}
                          className="bg-blue-600 hover:bg-blue-700"
                        >
                          {isSaving ? 'Saving...' : 'Save Changes'}
                        </Button>
                      ) : (
                        <Badge variant="outline">Click "Edit Your Details" to modify Party B fields</Badge>
                      )}
                      <Button
                        variant="outline"
                        onClick={handleReevaluate}
                        disabled={!canReevaluate || isReevaluating}
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        {isReevaluating ? 'Re-evaluating...' : 'Re-evaluate'}
                      </Button>
                    </div>

                    {reevaluationState && (
                      <p className="text-xs text-slate-500">
                        Re-evaluations used: {reevaluationState.used} / {reevaluationState.max} (remaining: {reevaluationState.remaining})
                      </p>
                    )}

                    {!user && (
                      <p className="text-xs text-amber-700">Sign in is required for save and re-evaluate actions.</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Sidebar - Quick Actions */}
              <div className="space-y-6">
                <Card className="border-0 shadow-sm">
                  <CardHeader>
                    <CardTitle>Shared Link Info</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Views</span>
                      <span className="font-medium">{shareData?.viewCount ?? shareData?.uses ?? 0} / {shareData?.maxViews ?? shareData?.maxUses ?? 25}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Expires</span>
                      <span className="font-medium">{shareData?.expiresAt ? new Date(shareData.expiresAt).toLocaleDateString() : 'N/A'}</span>
                    </div>
                    {snapshotVersion !== null && (
                      <div className="flex justify-between">
                        <span className="text-slate-600">Version</span>
                        <span className="font-medium">v{snapshotVersion}</span>
                      </div>
                    )}
                    {sourceProposalId && (
                      <div className="text-xs text-slate-500 pt-2 border-t">
                        Source: {sourceProposalId.slice(0, 8)}...
                      </div>
                    )}
                  </CardContent>
                </Card>

                {!user && (
                  <Card className="border-0 shadow-sm bg-amber-50">
                    <CardContent className="py-6 text-center">
                      <p className="text-sm text-amber-800 mb-3">Sign in to edit and save your responses</p>
                      <Button onClick={handleSignIn} className="bg-blue-600 hover:bg-blue-700">
                        Sign In
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Details Tab */}
          <TabsContent value="details">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>Complete Proposal Details</CardTitle>
                <CardDescription>
                  Live document comparison details resolved from the shared token.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isLoadingComparisonDetails && !comparisonDetailsData?.comparison && (
                  <div className="flex items-center gap-2 text-slate-600">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading shared comparison details...
                  </div>
                )}

                {comparisonDetailsError && (
                  <div className="border border-red-200 bg-red-50 rounded-lg p-4">
                    <p className="text-sm font-medium text-red-700">{comparisonDetailsError.message}</p>
                    {comparisonDetailsError.reasonCode && (
                      <p className="text-xs text-red-600 mt-1">Reason: {comparisonDetailsError.reasonCode}</p>
                    )}
                    <Button
                      variant="outline"
                      className="mt-3"
                      onClick={() => hydrateSharedComparisonDetails({ force: true })}
                      disabled={isLoadingComparisonDetails}
                    >
                      Retry
                    </Button>
                  </div>
                )}

                {!comparisonDetailsError && comparisonDetailsData?.comparison && (
                  <div className="space-y-4">
                    {[
                      { label: 'Document A', doc: comparisonDocA },
                      { label: 'Document B', doc: comparisonDocB }
                    ].map((item) => {
                      const spans = toArray(item?.doc?.spans);
                      return (
                        <div key={item.label} className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                            <Badge variant="outline">{spans.length} spans</Badge>
                          </div>
                          <div className="p-3 bg-white border border-slate-200 rounded-lg max-h-80 overflow-auto">
                            <pre className="whitespace-pre-wrap font-mono text-sm text-slate-800">
                              {String(item?.doc?.text || '') || 'No text available'}
                            </pre>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!isLoadingComparisonDetails && !comparisonDetailsError && !comparisonDetailsData?.comparison && (
                  <p className="text-sm text-slate-500">No document comparison data available for this shared link.</p>
                )}

                {debugMode && comparisonDebugPanel && (
                  <details className="bg-slate-50 rounded-lg p-4">
                    <summary className="font-semibold text-slate-700 cursor-pointer">
                      Comparison Debug (debug=1)
                    </summary>
                    <pre className="mt-3 text-xs bg-white p-4 rounded border border-slate-200 overflow-auto max-h-96" style={{ whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(comparisonDebugPanel, null, 2)}
                    </pre>
                  </details>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* AI Report Tab */}
          <TabsContent value="evaluation">
            {/* Profile Matching Template (FitCard) */}
            {isProfileMatchingTemplate && reportJson && (
              <FitCardReportDisplay report={reportData} />
            )}

            {/* Finance Template (Shared Report) */}
            {isFinanceTemplate && reportJson && (
              <div className="space-y-6">
                <SharedFinanceReportDisplay report={reportData} />
                
                {canReevaluate && (
                  <Button 
                    variant="outline"
                    onClick={handleReevaluate}
                    disabled={isReevaluating}
                    className="w-full"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Re-run Evaluation
                  </Button>
                )}
              </div>
            )}

            {/* Document Comparison */}
            {isDocumentComparison && reportJson && (
              <DocumentComparisonReportDisplay reportData={reportData} />
            )}

            {/* Standard Report (Other Templates) */}
            {!isFinanceTemplate && !isProfileMatchingTemplate && !isDocumentComparison && reportJson && (
              <div className="space-y-6">
                <StandardReportDisplay report={reportData} />
                
                {canReevaluate && (
                  <Button 
                    variant="outline"
                    onClick={handleReevaluate}
                    disabled={isReevaluating}
                    className="w-full"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Re-run Evaluation
                  </Button>
                )}
              </div>
            )}

            {/* Re-evaluating State */}
            {isReevaluating && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <RefreshCw className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Re-evaluating Report</h3>
                  <p className="text-slate-500">This may take 10-30 seconds...</p>
                </CardContent>
              </Card>
            )}

            {/* No Report Available */}
            {!reportJson && !isReevaluating && (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-16 text-center">
                  <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No AI report available yet</h3>
                  <p className="text-slate-500 mb-6">The sender has not generated an AI evaluation for this proposal yet.</p>
                  {canReevaluate && (
                    <>
                      <Button 
                        onClick={handleReevaluate}
                        disabled={isReevaluating}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Run Evaluation
                      </Button>
                      <p className="text-sm text-slate-500 mt-4">This may take 10-30 seconds...</p>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Debug Panel */}
        {debugMode && debugData && (
          <div className="mt-8 border-t border-slate-200 pt-6">
            <details className="bg-slate-50 rounded-lg p-4">
              <summary className="font-semibold text-slate-700 cursor-pointer">
                Debug Info (debug=1 mode)
              </summary>
              <pre className="mt-3 text-xs bg-white p-4 rounded border border-slate-200 overflow-auto max-h-96" style={{ whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(debugData, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
