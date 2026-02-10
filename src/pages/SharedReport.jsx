import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Send, XCircle } from 'lucide-react';

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
    ...(typeof options.consumeView === 'boolean' ? { consumeView: options.consumeView } : {})
  };

  try {
    return await base44.functions.invoke('ResolveSharedReport', payload);
  } catch (error) {
    const meta = buildErrorMeta(error);
    const missingResolver =
      meta.statusCode === 404 &&
      (!meta.responseBody || (!meta.responseBody.code && !meta.responseBody.reason));

    if (!missingResolver) {
      throw error;
    }

    return base44.functions.invoke('GetSharedReportData', payload);
  }
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
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);
  const [shareData, setShareData] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [proposalId, setProposalId] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [partyAView, setPartyAView] = useState({ proposal: null, responses: [] });
  const [partyBEditableSchema, setPartyBEditableSchema] = useState({ totalQuestions: 0, editableQuestionIds: [], questions: [] });
  const [responsesView, setResponsesView] = useState([]);
  const [comparisonView, setComparisonView] = useState(null);
  const [recipientEdits, setRecipientEdits] = useState({});
  const [sendBackMessage, setSendBackMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isReevaluating, setIsReevaluating] = useState(false);
  const [isSendingBack, setIsSendingBack] = useState(false);
  const [reevaluationState, setReevaluationState] = useState(null);
  const resolvedTokenRef = useRef(null);
  const workspaceSectionRef = useRef(null);

  const token = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('token');
  }, [location.search]);

  const mode = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('mode');
  }, [location.search]);

  const reportTitle = useMemo(() => {
    if (reportData?.title) return reportData.title;
    if (reportData?.type === 'proposal') return 'Shared Proposal Report';
    if (reportData?.type === 'document_comparison') return 'Shared Comparison Report';
    return 'Shared AI Report';
  }, [reportData]);

  const recipientEditableQuestions = useMemo(() => {
    return toArray(partyBEditableSchema?.questions);
  }, [partyBEditableSchema]);

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

  const canEditRecipient = Boolean(permissions?.canEditRecipientSide ?? permissions?.canEdit);
  const canReevaluate = Boolean(permissions?.canReevaluate);
  const canSendBack = Boolean(permissions?.canSendBack);

  const hydrateSharedReport = useCallback(async ({ consumeView = true, silent = false } = {}) => {
    if (!token) return false;

    try {
      if (!silent) {
        setIsLoadingReport(true);
      }
      if (!silent) {
        setError(null);
      }

      const result = await invokeSharedResolver(token, { consumeView });
      const data = result?.data;

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
      const resolvedProposalId =
        data.proposalId ||
        resolvedShareData.proposalId ||
        resolvedReportData.proposalId ||
        resolvedReportData.proposal_id ||
        (resolvedReportData.type === 'proposal' ? resolvedReportData.id : null);

      const context = {
        token,
        proposalId: resolvedProposalId || null,
        role: 'recipient',
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
      try {
        const historyRaw = localStorage.getItem('sharedReportContextHistory');
        const parsedHistory = JSON.parse(historyRaw || '[]');
        const history = Array.isArray(parsedHistory) ? parsedHistory : [];
        const nextHistory = [context, ...history.filter((item) => item?.token !== context.token)].slice(0, 50);
        localStorage.setItem('sharedReportContextHistory', JSON.stringify(nextHistory));
      } catch {
        // Ignore malformed local storage history.
      }
      setShareData(resolvedShareData);
      setReportData(resolvedReportData);
      setProposalId(resolvedProposalId);
      setPermissions(data.permissions || {});
      setPartyAView(data.partyAView || { proposal: null, responses: [] });
      setPartyBEditableSchema(data.partyBEditableSchema || { totalQuestions: 0, editableQuestionIds: [], questions: [] });
      setResponsesView(data.responsesView || data?.recipientView?.responses || []);
      setComparisonView(data.comparisonView || data?.reportData?.comparisonView || null);
      setError(null);
      navigate(
        createPageUrl(
          `ProposalDetail?id=${encodeURIComponent(resolvedProposalId)}&sharedToken=${encodeURIComponent(token)}&role=recipient`
        ),
        { replace: true }
      );

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
  }, [token, navigate]);

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
    if (mode !== 'workspace') return;
    workspaceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [mode, shareData, reportData, partyBEditableSchema]);

  useEffect(() => {
    const questions = toArray(partyBEditableSchema?.questions);
    const nextEdits = {};

    questions.forEach((question) => {
      if (!question?.questionId) return;
      nextEdits[question.questionId] = toInitialEdit(question);
    });

    setRecipientEdits(nextEdits);
  }, [partyBEditableSchema]);

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
      await hydrateSharedReport({ consumeView: false, silent: true });
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
    const disabled = !canEditRecipient || isSaving;

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

  const reportJson = reportData?.report || null;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-5xl mx-auto px-4 space-y-6">
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>{reportTitle}</CardTitle>
            <CardDescription>
              Shared recipient workspace. Party A confidential data remains redacted.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{reportData?.type || 'shared-report'}</Badge>
              <Badge variant="outline">
                Views: {shareData?.viewCount ?? shareData?.uses ?? 0} / {shareData?.maxViews ?? shareData?.maxUses ?? 25}
              </Badge>
              <Badge variant="outline">
                Expires: {shareData?.expiresAt ? new Date(shareData.expiresAt).toLocaleDateString() : 'N/A'}
              </Badge>
            </div>

            <p className="text-sm text-slate-600">
              {user?.email ? `Signed in as ${user.email}.` : 'Viewing as guest.'}
            </p>

            <div className="pt-1 space-x-2">
              <Button
                onClick={handleOpenWorkspace}
                className="bg-blue-600 hover:bg-blue-700"
                disabled={!token}
              >
                Open Shared Workspace
              </Button>
              {!user && (
                <Button variant="outline" onClick={handleSignIn}>
                  Sign In for Editing
                </Button>
              )}
            </div>

            {!proposalId && (
              <p className="text-sm text-amber-700">
                This shared report is not linked to a proposal.
              </p>
            )}
          </CardContent>
        </Card>

        <div ref={workspaceSectionRef} className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>AI Report</CardTitle>
              <CardDescription>Read-only shared report output.</CardDescription>
            </CardHeader>
            <CardContent>
              {reportJson ? (
                <pre className="text-xs bg-slate-950 text-slate-100 p-4 rounded-lg overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(reportJson, null, 2)}
                </pre>
              ) : (
                <p className="text-slate-600">No report payload is available yet.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Party A Shared Information</CardTitle>
              <CardDescription>Confidential fields are redacted server-side before rendering.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {toArray(partyAView?.responses).length === 0 && (
                <p className="text-slate-500 text-sm">No Party A responses are available.</p>
              )}
              {toArray(partyAView?.responses).map((item) => (
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
              <CardTitle>Complete Proposal Details</CardTitle>
              <CardDescription>
                Read-only shared details. Confidential content is removed for recipients.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {reportData?.type === 'document_comparison' && comparisonView ? (
                <div className="space-y-4">
                  {[comparisonView.docA, comparisonView.docB].filter(Boolean).map((doc, index) => (
                    <div key={`shared-doc-${index}`} className="p-4 border rounded-lg bg-slate-50 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-slate-900">{doc.label || `Document ${index + 1}`}</p>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">Source: {doc.source || 'typed'}</Badge>
                          <Badge className="bg-red-100 text-red-700">
                            {Number(doc.hiddenCount || 0)} removed
                          </Badge>
                        </div>
                      </div>
                      <pre className="text-xs bg-white border rounded-md p-3 overflow-auto whitespace-pre-wrap">
                        {doc.text || 'No shared text available.'}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : completeDetailsRows.length === 0 ? (
                <p className="text-slate-500 text-sm">No shared proposal details are available.</p>
              ) : (
                completeDetailsRows.map((item) => (
                  <div key={item.key} className="p-3 border rounded-lg">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-slate-900">{item.label}</p>
                      <Badge variant="outline">{item.party}</Badge>
                    </div>
                    <p className="text-sm text-slate-700 mt-1">{item.value}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Your Details (Party B)</CardTitle>
              <CardDescription>
                You can edit only Party B fields defined by the shared token policy. All updates are saved through secure shared endpoints.
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
                      disabled={!canEditRecipient || isSaving}
                    />
                    <Label htmlFor={`recipient-visibility-${question.questionId}`} className="text-sm text-slate-700">
                      Keep this response confidential
                    </Label>
                  </div>
                </div>
              ))}

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button
                  onClick={handleSaveChanges}
                  disabled={!canEditRecipient || isSaving || recipientEditableQuestions.length === 0}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleReevaluate}
                  disabled={!canReevaluate || isReevaluating || !user}
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
                <p className="text-xs text-amber-700">Sign in is required for save/re-evaluate/send-back actions.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Send Back Response</CardTitle>
              <CardDescription>
                Submit your counterproposal or notes back to the sender. This action writes an auditable response record.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                rows={4}
                value={sendBackMessage}
                onChange={(event) => setSendBackMessage(event.target.value)}
                placeholder="Add your response or counterproposal..."
                disabled={!canSendBack || isSendingBack}
              />
              <Button
                onClick={handleSendBack}
                disabled={!canSendBack || isSendingBack || !user}
              >
                <Send className="w-4 h-4 mr-2" />
                {isSendingBack ? 'Sending...' : 'Send Back'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
