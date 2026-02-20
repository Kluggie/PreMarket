import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  Eye,
  FileText,
  Handshake,
  Lock,
  Save,
  Sparkles,
  TrendingUp,
  User,
  Users,
  XCircle,
} from 'lucide-react';
import { request } from '@/api/httpClient';
import { proposalsClient } from '@/api/proposalsClient';
import { templatesClient } from '@/api/templatesClient';

const iconMap = {
  m_and_a: Building2,
  recruiting: Users,
  investment: TrendingUp,
  partnership: Handshake,
  consulting: Briefcase,
  custom: FileText,
  beta_access: Sparkles,
  saas_procurement: Briefcase,
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeVisibilitySetting = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['hidden', 'not_shared', 'private', 'confidential', 'partial'].includes(normalized)) {
    return 'hidden';
  }
  return 'full';
};

const asSearchParams = () => new URLSearchParams(window.location.search);

const isRecipientEmailQuestion = (question) => {
  const id = String(question?.id || '').toLowerCase();
  const label = String(question?.label || '').toLowerCase();
  return (
    id === 'recipient_email' ||
    id === 'party_b_email' ||
    id === 'counterparty_email' ||
    label.includes('recipient email') ||
    label.includes('counterparty email')
  );
};

function parseValue(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return '';
  }

  if (typeof rawValue === 'object') {
    return rawValue;
  }

  const text = String(rawValue);
  if (!text) {
    return '';
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function serializeResponseValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function CreateProposalWithDrafts() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hasInitializedLoad = useRef(false);

  const [step, setStep] = useState(1);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [proposalTitle, setProposalTitle] = useState('');
  const [responses, setResponses] = useState({});
  const [visibilitySettings, setVisibilitySettings] = useState({});
  const [validationErrors, setValidationErrors] = useState({});
  const [presetKey, setPresetKey] = useState('');
  const [enabledModules, setEnabledModules] = useState([]);
  const [draftProposalId, setDraftProposalId] = useState(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSubmittingEvaluation, setIsSubmittingEvaluation] = useState(false);
  const [evaluationError, setEvaluationError] = useState('');

  const routeParams = asSearchParams();
  const requestedStep = Number.parseInt(routeParams.get('step') || '', 10);
  const initialStepFromQuery = Number.isFinite(requestedStep) && requestedStep >= 1 && requestedStep <= 4
    ? requestedStep
    : null;

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesClient.list(),
  });

  const getModulesForPreset = (preset) => {
    const baseModules = [
      'org_profile',
      'security_compliance',
      'privacy_data_handling',
      'operations_sla',
      'implementation_it',
      'legal_commercial',
      'references',
    ];

    if (preset === 'api_data_provider') {
      return [...baseModules, 'api_data'];
    }

    return baseModules;
  };

  const getNormalizedParty = (question) => {
    if (question?.party) return question.party;
    if (question?.is_about_counterparty === true) return 'b';
    if (question?.applies_to_role === 'proposer') return 'a';
    if (question?.applies_to_role === 'recipient') return 'b';
    if (question?.applies_to_role === 'both') return 'both';
    return 'a';
  };

  const getQuestionResponseKey = (question, stepHint = step) => {
    const roleType = question?.role_type || 'party_attribute';
    if (roleType === 'shared_fact') return question.id;
    if (stepHint === 3) return `${question.id}__b`;
    if (stepHint === 2) return question.id;

    const normalized = getNormalizedParty(question);
    if (normalized === 'b') return `${question.id}__b`;
    return question.id;
  };

  const getQuestionResponseValue = (question, stepHint = step) => {
    const responseKey = getQuestionResponseKey(question, stepHint);
    if (responses[responseKey] !== undefined) return responses[responseKey];
    return responses[question.id];
  };

  const isUniversalTemplate =
    selectedTemplate?.slug === 'universal_enterprise_onboarding' ||
    selectedTemplate?.template_key === 'universal_enterprise_onboarding' ||
    selectedTemplate?.name === 'Universal Enterprise Onboarding';

  const isFinanceTemplate =
    selectedTemplate?.slug === 'universal_finance_deal_prequal' ||
    selectedTemplate?.template_key === 'universal_finance_deal_prequal';

  const isProfileMatchingTemplate =
    selectedTemplate?.slug === 'universal_profile_matching' ||
    selectedTemplate?.template_key === 'universal_profile_matching';

  const shouldIncludeQuestion = (question) => {
    if (isUniversalTemplate) {
      if (!presetKey || enabledModules.length === 0) return false;
      if (question?.module_key) {
        return enabledModules.includes(question.module_key);
      }
      return false;
    }

    if (isFinanceTemplate) {
      const selectedMode = responses.mode;
      if (question.module_key === 'mode_selector') return true;
      if (!selectedMode) return false;
      if (question.module_key === 'common_core') return true;
      if (selectedMode === 'Investor Fit' && question.module_key === 'investor_fit') return true;
      if (selectedMode === 'M&A Fit' && question.module_key === 'm_and_a_fit') return true;
      if (selectedMode === 'Lending Fit' && question.module_key === 'lending_fit') return true;
      return false;
    }

    if (isProfileMatchingTemplate) {
      const selectedMode = responses.mode;
      if (question.module_key === 'mode_selector') return true;
      if (!selectedMode) return false;
      if (question.module_key === 'shared_core') return true;
      if (selectedMode === 'Job Fit' && question.module_key === 'job_fit') return true;
      if (selectedMode === 'Beta Access Fit' && question.module_key === 'beta_access_fit') return true;
      if (selectedMode === 'Program/Accelerator Fit' && question.module_key === 'program_fit') return true;
      if (selectedMode === 'Grant/Scholarship Fit' && question.module_key === 'grant_fit') return true;
      return false;
    }

    return true;
  };

  const getEffectiveRequired = (question) => {
    if (isUniversalTemplate && presetKey && question?.preset_required) {
      return question.preset_required[presetKey] !== undefined
        ? Boolean(question.preset_required[presetKey])
        : Boolean(question.required);
    }

    if (isFinanceTemplate && question?.preset_required) {
      const selectedMode = responses.mode;
      const modeKey =
        selectedMode === 'Investor Fit'
          ? 'investor_fit'
          : selectedMode === 'M&A Fit'
            ? 'm_and_a_fit'
            : selectedMode === 'Lending Fit'
              ? 'lending_fit'
              : null;
      if (modeKey && question.preset_required[modeKey] !== undefined) {
        return Boolean(question.preset_required[modeKey]);
      }
    }

    if (isProfileMatchingTemplate && question?.preset_required) {
      const selectedMode = responses.mode;
      const modeKey =
        selectedMode === 'Job Fit'
          ? 'job_fit'
          : selectedMode === 'Beta Access Fit'
            ? 'beta_access_fit'
            : selectedMode === 'Program/Accelerator Fit'
              ? 'program_fit'
              : selectedMode === 'Grant/Scholarship Fit'
                ? 'grant_fit'
                : null;
      if (modeKey && question.preset_required[modeKey] !== undefined) {
        return Boolean(question.preset_required[modeKey]);
      }
    }

    return Boolean(question.required);
  };

  const partyAQuestions = useMemo(
    () =>
      selectedTemplate?.questions?.filter((question) => {
        const roleType = question?.role_type || 'party_attribute';
        if (roleType === 'shared_fact') return true;

        const normalized = getNormalizedParty(question);
        return (normalized === 'a' || normalized === 'both') && shouldIncludeQuestion(question);
      }) || [],
    [selectedTemplate, step, presetKey, enabledModules, responses.mode],
  );

  const partyBQuestions = useMemo(
    () =>
      selectedTemplate?.questions?.filter((question) => {
        const roleType = question?.role_type || 'party_attribute';
        if (roleType === 'shared_fact') return false;
        if (isRecipientEmailQuestion(question)) return false;

        const normalized = getNormalizedParty(question);
        return (normalized === 'b' || normalized === 'both') && shouldIncludeQuestion(question);
      }) || [],
    [selectedTemplate, step, presetKey, enabledModules, responses.mode],
  );

  const isValueEmpty = (question, value) => {
    if (value === null || value === undefined || value === '') return true;
    if (question.field_type === 'multi_select') {
      return !Array.isArray(value) || value.length === 0;
    }
    if (question.field_type === 'boolean' || question.field_type === 'select') {
      return value === '' || value === null || value === undefined;
    }
    return false;
  };

  const hydrateDraft = async (proposalId) => {
    const proposal = await proposalsClient.getById(proposalId);
    if (!proposal) {
      return;
    }

    const template = templates.find((entry) => entry.id === proposal.template_id) || null;
    if (template) {
      setSelectedTemplate(template);
    }

    setDraftProposalId(proposal.id);
    setProposalTitle(proposal.title || '');
    setRecipientEmail(proposal.party_b_email || '');

    const payload = proposal.payload && typeof proposal.payload === 'object' ? proposal.payload : {};
    if (payload.preset_key) {
      setPresetKey(String(payload.preset_key));
    }
    if (Array.isArray(payload.enabled_modules)) {
      setEnabledModules(payload.enabled_modules.map((entry) => String(entry)));
    }

    const nextResponses = {};
    if (payload.mode) nextResponses.mode = payload.mode;
    if (payload._profile_url) nextResponses._profile_url = payload._profile_url;
    if (payload._target_url) nextResponses._target_url = payload._target_url;
    if (payload._include_profile !== undefined) nextResponses._include_profile = Boolean(payload._include_profile);
    if (payload._include_organisation !== undefined) {
      nextResponses._include_organisation = Boolean(payload._include_organisation);
    }

    const responseRows = await proposalsClient.getResponses(proposalId);
    const loadedResponses = {};
    const loadedVisibility = {};

    for (const responseRow of responseRows) {
      const subjectParty = responseRow.entered_by_party === 'b' ? 'b' : 'a';
      const responseKey = subjectParty === 'b'
        ? `${responseRow.question_id}__b`
        : responseRow.question_id;

      if (responseRow.value_type === 'range') {
        loadedResponses[responseKey] = {
          type: 'range',
          min: responseRow.range_min || '',
          max: responseRow.range_max || '',
        };
      } else {
        loadedResponses[responseKey] = parseValue(responseRow.value);
      }

      loadedVisibility[responseKey] = normalizeVisibilitySetting(responseRow.visibility);
      if (subjectParty === 'a' && loadedResponses[responseRow.question_id] === undefined) {
        loadedResponses[responseRow.question_id] = loadedResponses[responseKey];
      }
    }

    setResponses({ ...nextResponses, ...loadedResponses });
    setVisibilitySettings(loadedVisibility);

    const draftStep = Number(payload.draft_step || 1);
    const nextStep = initialStepFromQuery || (draftStep >= 1 && draftStep <= 4 ? draftStep : 1);
    setStep(nextStep);
  };

  useEffect(() => {
    if (hasInitializedLoad.current || templates.length === 0) {
      return;
    }

    const params = asSearchParams();
    const resumeDraftId = params.get('draft');
    const templateId = params.get('template');

    if (resumeDraftId) {
      hasInitializedLoad.current = true;
      hydrateDraft(resumeDraftId).catch(() => {
        hasInitializedLoad.current = true;
      });
      return;
    }

    if (templateId && !selectedTemplate) {
      const template = templates.find((entry) => entry.id === templateId);
      if (template) {
        setSelectedTemplate(template);
        setStep(1);
      }
    }

    hasInitializedLoad.current = true;
  }, [templates]);

  const buildResponseRows = () => {
    if (!selectedTemplate) {
      return [];
    }

    const templateQuestions = Array.isArray(selectedTemplate.questions) ? selectedTemplate.questions : [];

    return Object.entries(responses)
      .filter(([responseKey]) => !responseKey.startsWith('_'))
      .map(([responseKey, responseValue]) => {
        const [questionId, suffix] = responseKey.includes('__')
          ? responseKey.split('__')
          : [responseKey, 'a'];

        const question = templateQuestions.find((entry) => entry.id === questionId);
        if (!question) {
          return null;
        }

        const enteredByParty = suffix === 'b' ? 'b' : 'a';
        const roleType = question?.role_type || 'party_attribute';
        const claimType =
          roleType === 'shared_fact'
            ? 'shared_fact'
            : enteredByParty === 'b'
              ? 'counterparty_claim'
              : 'self';

        const row = {
          question_id: questionId,
          section_id: question.section_id || null,
          value: serializeResponseValue(responseValue),
          value_type: 'text',
          range_min: null,
          range_max: null,
          visibility: enteredByParty === 'b'
            ? 'full'
            : normalizeVisibilitySetting(
                visibilitySettings[responseKey] || visibilitySettings[questionId] || question.visibility_default,
              ),
          claim_type: claimType,
          entered_by_party: enteredByParty,
        };

        if (responseValue && typeof responseValue === 'object' && responseValue.type === 'range') {
          row.value = null;
          row.value_type = 'range';
          row.range_min = String(responseValue.min || '');
          row.range_max = String(responseValue.max || '');
        }

        return row;
      })
      .filter(Boolean);
  };

  const ensureDraftExists = async () => {
    if (draftProposalId) {
      return draftProposalId;
    }

    if (!selectedTemplate) {
      return null;
    }

    const created = await templatesClient.useTemplate(selectedTemplate.id, {
      title: proposalTitle || `${selectedTemplate.name} Proposal`,
      partyBEmail: recipientEmail.trim() || null,
      idempotencyKey: `wizard:${selectedTemplate.id}:${Date.now()}`,
    });

    const createdProposalId = created?.proposal?.id || null;
    if (createdProposalId) {
      setDraftProposalId(createdProposalId);
      queryClient.invalidateQueries(['proposals']);
    }

    return createdProposalId;
  };

  const persistDraft = async ({
    status = 'draft',
    createIfMissing = false,
  } = {}) => {
    if (!selectedTemplate) {
      return null;
    }

    let proposalId = draftProposalId;

    if (!proposalId && createIfMissing) {
      proposalId = await ensureDraftExists();
    }

    if (!proposalId) {
      return null;
    }

    const payload = {
      draft_step: step,
      mode: responses.mode || null,
      preset_key: presetKey || null,
      enabled_modules: enabledModules,
      _profile_url: responses._profile_url || null,
      _target_url: responses._target_url || null,
      _include_profile: Boolean(responses._include_profile),
      _include_organisation: Boolean(responses._include_organisation),
    };

    await proposalsClient.update(proposalId, {
      title: proposalTitle || `${selectedTemplate.name} Proposal`,
      status,
      template_id: selectedTemplate.id,
      template_name: selectedTemplate.name,
      party_b_email: recipientEmail.trim() || null,
      payload,
    });

    await proposalsClient.saveResponses(proposalId, buildResponseRows());

    return proposalId;
  };

  useEffect(() => {
    if (!selectedTemplate || !draftProposalId) {
      return;
    }

    const timer = setTimeout(() => {
      setAutoSaving(true);
      persistDraft({ status: 'draft', createIfMissing: false })
        .catch(() => {
          // Auto-save intentionally does not block the wizard flow.
        })
        .finally(() => setAutoSaving(false));
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    selectedTemplate,
    draftProposalId,
    proposalTitle,
    recipientEmail,
    responses,
    visibilitySettings,
    presetKey,
    enabledModules,
    step,
  ]);

  const validateCurrentStep = () => {
    const errors = {};
    const questions = step === 2 ? partyAQuestions : step === 3 ? partyBQuestions : [];

    for (const question of questions) {
      const required = getEffectiveRequired(question);
      const value = getQuestionResponseValue(question, step === 3 ? 3 : 2);
      if (required && isValueEmpty(question, value)) {
        errors[question.id] = 'This field is required';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateAll = () => {
    const errors = {};

    for (const question of partyAQuestions) {
      const required = getEffectiveRequired(question);
      const value = getQuestionResponseValue(question, 2);
      if (required && isValueEmpty(question, value)) {
        errors[question.id] = 'This field is required';
      }
    }

    for (const question of partyBQuestions) {
      const required = getEffectiveRequired(question);
      const value = getQuestionResponseValue(question, 3);
      if (required && isValueEmpty(question, value)) {
        errors[question.id] = 'This field is required';
      }
    }

    const trimmedRecipientEmail = recipientEmail.trim();
    if (!trimmedRecipientEmail) {
      errors._recipient_email = 'Recipient email is required';
    } else if (!EMAIL_REGEX.test(trimmedRecipientEmail)) {
      errors._recipient_email = 'Enter a valid email address';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateStep1RecipientEmail = () => {
    const trimmedRecipientEmail = recipientEmail.trim();
    if (!trimmedRecipientEmail) {
      setValidationErrors((prev) => ({ ...prev, _recipient_email: 'Recipient email is required' }));
      return false;
    }

    if (!EMAIL_REGEX.test(trimmedRecipientEmail)) {
      setValidationErrors((prev) => ({ ...prev, _recipient_email: 'Enter a valid email address' }));
      return false;
    }

    setRecipientEmail(trimmedRecipientEmail);
    setValidationErrors((prev) => {
      const next = { ...prev };
      delete next._recipient_email;
      return next;
    });

    return true;
  };

  const handleResponseChange = (questionId, value) => {
    setResponses((prev) => ({ ...prev, [questionId]: value }));

    const [baseQuestionId] = String(questionId).split('__');
    if (validationErrors[questionId] || validationErrors[baseQuestionId]) {
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[questionId];
        delete next[baseQuestionId];
        return next;
      });
    }
  };

  const handleVisibilityChange = (questionId, visibility) => {
    setVisibilitySettings((prev) => ({ ...prev, [questionId]: normalizeVisibilitySetting(visibility) }));
  };

  const handleStep1Continue = async () => {
    if (!validateStep1RecipientEmail()) {
      return;
    }

    setIsSavingDraft(true);
    setEvaluationError('');

    try {
      await ensureDraftExists();
      await persistDraft({ status: 'draft', createIfMissing: true });
      setStep(2);
      setValidationErrors({});
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleNext = async () => {
    if ((step === 2 || step === 3) && !validateCurrentStep()) {
      return;
    }

    setValidationErrors({});

    const nextStep = step + 1;
    setStep(nextStep);

    await persistDraft({ status: 'draft', createIfMissing: true });
  };

  const handleBack = async (targetStep) => {
    setValidationErrors({});
    setStep(targetStep);

    if (draftProposalId) {
      await persistDraft({ status: 'draft', createIfMissing: false });
    }
  };

  const handleRunEvaluation = async () => {
    if (!validateAll()) {
      const isRecipientEmailInvalid =
        !recipientEmail.trim() || !EMAIL_REGEX.test(recipientEmail.trim());
      setStep(isRecipientEmailInvalid ? 1 : 2);
      return;
    }

    setIsSubmittingEvaluation(true);
    setEvaluationError('');

    try {
      const proposalId = await persistDraft({ status: 'submitted', createIfMissing: true });
      if (!proposalId) {
        throw new Error('Failed to save proposal draft.');
      }

      try {
        await request('/api/vertex/smoke', {
          method: 'POST',
          body: JSON.stringify({
            prompt: `Run evaluation for proposal ${proposalId}`,
          }),
        });
      } catch (error) {
        if (error?.status === 501 || error?.code === 'not_configured') {
          setEvaluationError('AI evaluation is not configured for this environment yet.');
        } else {
          setEvaluationError(error?.message || 'Evaluation failed. Proposal was still saved.');
        }
      }

      queryClient.invalidateQueries(['proposals']);
      navigate(createPageUrl(`ProposalDetail?id=${encodeURIComponent(proposalId)}`));
    } catch (error) {
      setEvaluationError(error?.message || 'Failed to submit proposal.');
    } finally {
      setIsSubmittingEvaluation(false);
    }
  };

  const renderQuestionInput = (question) => {
    const roleType = question.role_type || 'party_attribute';
    const isSharedFact = roleType === 'shared_fact';
    const isCounterpartyObs = roleType === 'counterparty_observation';

    const responseKey = getQuestionResponseKey(question, step);
    const value = getQuestionResponseValue(question, step) || '';
    const visibility =
      step === 3
        ? 'full'
        : normalizeVisibilitySetting(
            visibilitySettings[responseKey] || visibilitySettings[question.id] || question.visibility_default || 'full',
          );
    const hasError = validationErrors[question.id];
    const effectiveRequired = getEffectiveRequired(question);

    return (
      <div key={question.id} className="space-y-2 p-4 bg-white border rounded-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Label className="text-sm font-medium text-slate-900">
              {question.label}
              {effectiveRequired && <span className="text-red-500 ml-1">*</span>}
              {isSharedFact && <Badge className="ml-2 text-xs bg-blue-100 text-blue-700">Shared</Badge>}
              {isCounterpartyObs && <Badge className="ml-2 text-xs bg-purple-100 text-purple-700">Your observation</Badge>}
            </Label>
            {question.description && <p className="text-sm text-slate-600 mt-1">{question.description}</p>}
          </div>
          {step !== 3 && (
            <Select value={visibility} onValueChange={(nextVisibility) => handleVisibilityChange(responseKey, nextVisibility)}>
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">
                  <span className="flex items-center gap-1">
                    <Eye className="w-3 h-3" />
                    Visible
                  </span>
                </SelectItem>
                <SelectItem value="hidden">
                  <span className="flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    Hidden
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-2">
          {question.field_type === 'select' ? (
            question.allowed_values && question.allowed_values.length > 0 ? (
              <Select value={value} onValueChange={(nextValue) => handleResponseChange(responseKey, nextValue)}>
                <SelectTrigger className={hasError ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {question.allowed_values.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                type="text"
                value={value}
                onChange={(event) => handleResponseChange(responseKey, event.target.value)}
                placeholder="Enter value..."
                className={hasError ? 'border-red-500' : ''}
              />
            )
          ) : question.field_type === 'multi_select' ? (
            <div className="space-y-2">
              {question.allowed_values?.map((option) => (
                <div key={option} className="flex items-center space-x-2">
                  <Checkbox
                    id={`${question.id}-${option}`}
                    checked={(value || []).includes(option)}
                    onCheckedChange={(checked) => {
                      const current = Array.isArray(value) ? value : [];
                      const nextValue = checked
                        ? [...current, option]
                        : current.filter((entry) => entry !== option);
                      handleResponseChange(responseKey, nextValue);
                    }}
                  />
                  <label htmlFor={`${question.id}-${option}`} className="text-sm">
                    {option}
                  </label>
                </div>
              ))}
            </div>
          ) : question.field_type === 'boolean' ? (
            <RadioGroup value={value} onValueChange={(nextValue) => handleResponseChange(responseKey, nextValue)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Yes" id={`${question.id}-yes`} />
                <Label htmlFor={`${question.id}-yes`}>Yes</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="No" id={`${question.id}-no`} />
                <Label htmlFor={`${question.id}-no`}>No</Label>
              </div>
            </RadioGroup>
          ) : question.field_type === 'textarea' ? (
            <Textarea
              value={value}
              onChange={(event) => handleResponseChange(responseKey, event.target.value)}
              placeholder={`Enter ${question.label.toLowerCase()}...`}
              className={`min-h-[100px] ${hasError ? 'border-red-500' : ''}`}
            />
          ) : (
            <Input
              type={question.field_type === 'number' ? 'number' : question.field_type === 'url' ? 'url' : 'text'}
              value={value}
              onChange={(event) => handleResponseChange(responseKey, event.target.value)}
              placeholder={`Enter ${question.label.toLowerCase()}...`}
              className={hasError ? 'border-red-500' : ''}
            />
          )}

          {hasError && (
            <p className="text-sm text-red-600 flex items-center gap-1">
              <XCircle className="w-4 h-4" />
              {hasError}
            </p>
          )}
        </div>
      </div>
    );
  };

  const totalSteps = 4;
  const progress = (step / totalSteps) * 100;
  const hasValidationErrors = Object.keys(validationErrors).length > 0;
  const allTemplates = templates;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <Link to={createPageUrl('Templates')} className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Template Library
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Create Proposal</h1>
              <p className="text-slate-500 mt-1">Fill out the template to create a pre-qualification proposal.</p>
            </div>
            {(autoSaving || isSavingDraft) && (
              <Badge variant="outline" className="text-blue-600">
                <Save className="w-3 h-3 mr-1 animate-pulse" />
                Auto-saving...
              </Badge>
            )}
          </div>
        </div>

        <div className="mb-8">
          <div className="flex items-center justify-between text-sm text-slate-500 mb-2">
            <span>
              Step {step} of {totalSteps}
            </span>
            <span>{Math.round(progress)}% complete</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <AnimatePresence mode="wait">
          {step === 1 && !selectedTemplate && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Select Template</CardTitle>
                  <CardDescription>Choose a template that matches your pre-qualification needs.</CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <p className="text-sm text-slate-500">Loading templates...</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {allTemplates.map((template) => {
                        const Icon = iconMap[template.category] || FileText;
                        return (
                          <button
                            key={template.id}
                            onClick={() => {
                              setSelectedTemplate(template);
                            }}
                            className={`p-4 rounded-xl border-2 text-left transition-all ${
                              selectedTemplate?.id === template.id
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <Icon
                              className={`w-6 h-6 mb-2 ${
                                selectedTemplate?.id === template.id ? 'text-blue-600' : 'text-slate-400'
                              }`}
                            />
                            <h3 className="font-semibold text-slate-900">{template.name}</h3>
                            <p className="text-sm text-slate-500 mt-1 line-clamp-2">{template.description}</p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {step === 1 && selectedTemplate && (
            <motion.div key="step1-details" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Proposal Details</CardTitle>
                  <CardDescription>Set the title and recipient for your proposal.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label>Proposal Title</Label>
                    <Input
                      value={proposalTitle}
                      onChange={(event) => setProposalTitle(event.target.value)}
                      placeholder={`${selectedTemplate?.name} Proposal`}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>
                      Recipient Email <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      type="email"
                      value={recipientEmail}
                      onChange={(event) => {
                        setRecipientEmail(event.target.value);
                        if (validationErrors._recipient_email) {
                          setValidationErrors((prev) => {
                            const next = { ...prev };
                            delete next._recipient_email;
                            return next;
                          });
                        }
                      }}
                      placeholder="recipient@example.com"
                      className={validationErrors._recipient_email ? 'border-red-500' : ''}
                    />
                    {validationErrors._recipient_email ? (
                      <p className="text-sm text-red-600 flex items-center gap-1">
                        <XCircle className="w-4 h-4" />
                        {validationErrors._recipient_email}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Required: this is used for the shared workspace and report delivery.
                      </p>
                    )}
                  </div>

                  <div className="space-y-3 p-4 border border-slate-200 bg-slate-50 rounded-xl">
                    <Label className="text-sm font-semibold text-slate-900">Additional Context for AI Evaluation</Label>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-700">Include my Profile</p>
                          <p className="text-xs text-slate-500">Use your profile information in the AI assessment</p>
                        </div>
                        <Switch
                          checked={Boolean(responses._include_profile)}
                          onCheckedChange={(checked) => handleResponseChange('_include_profile', checked)}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-slate-700">Include my Organisation</p>
                          <p className="text-xs text-slate-500">Use your organisation details in the AI assessment</p>
                        </div>
                        <Switch
                          checked={Boolean(responses._include_organisation)}
                          onCheckedChange={(checked) => handleResponseChange('_include_organisation', checked)}
                        />
                      </div>
                    </div>
                  </div>

                  {isUniversalTemplate && (
                    <div className="space-y-3 p-4 border-2 border-blue-200 bg-blue-50 rounded-xl">
                      <Label className="text-sm font-semibold text-blue-900">Onboarding Type *</Label>
                      <RadioGroup
                        value={presetKey}
                        onValueChange={(value) => {
                          setPresetKey(value);
                          setEnabledModules(getModulesForPreset(value));
                        }}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="vendor_prequal" id="preset-vendor" />
                            <Label htmlFor="preset-vendor" className="font-normal cursor-pointer">
                              Vendor Pre-Qualification
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="saas_procurement" id="preset-saas" />
                            <Label htmlFor="preset-saas" className="font-normal cursor-pointer">
                              SaaS Procurement
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="private_rfp_prequal" id="preset-rfp" />
                            <Label htmlFor="preset-rfp" className="font-normal cursor-pointer">
                              Private RFP Pre-Qualification
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="api_data_provider" id="preset-api" />
                            <Label htmlFor="preset-api" className="font-normal cursor-pointer">
                              API / Data Provider Matching
                            </Label>
                          </div>
                        </div>
                      </RadioGroup>
                      <p className="text-xs text-blue-700 mt-2">
                        This determines which questions you'll see in the next steps.
                      </p>
                    </div>
                  )}

                  {isFinanceTemplate && (
                    <div className="space-y-3 p-4 border-2 border-emerald-200 bg-emerald-50 rounded-xl">
                      <Label className="text-sm font-semibold text-emerald-900">Deal Mode *</Label>
                      <RadioGroup value={responses.mode || ''} onValueChange={(value) => handleResponseChange('mode', value)}>
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Investor Fit" id="mode-investor" />
                            <Label htmlFor="mode-investor" className="font-normal cursor-pointer">
                              Investor Fit
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="M&A Fit" id="mode-ma" />
                            <Label htmlFor="mode-ma" className="font-normal cursor-pointer">
                              M&A Fit
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Lending Fit" id="mode-lending" />
                            <Label htmlFor="mode-lending" className="font-normal cursor-pointer">
                              Lending Fit
                            </Label>
                          </div>
                        </div>
                      </RadioGroup>
                      <p className="text-xs text-emerald-700 mt-2">
                        This determines which questions you'll see in the next steps.
                      </p>
                    </div>
                  )}

                  {isProfileMatchingTemplate && (
                    <div className="space-y-3 p-4 border-2 border-purple-200 bg-purple-50 rounded-xl">
                      <Label className="text-sm font-semibold text-purple-900">Profile Matching Mode *</Label>
                      <RadioGroup value={responses.mode || ''} onValueChange={(value) => handleResponseChange('mode', value)}>
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Job Fit" id="mode-job" />
                            <Label htmlFor="mode-job" className="font-normal cursor-pointer">
                              Job Match
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Beta Access Fit" id="mode-beta" />
                            <Label htmlFor="mode-beta" className="font-normal cursor-pointer">
                              Beta Access Match
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Program/Accelerator Fit" id="mode-program" />
                            <Label htmlFor="mode-program" className="font-normal cursor-pointer">
                              Program/Accelerator Match
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Grant/Scholarship Fit" id="mode-grant" />
                            <Label htmlFor="mode-grant" className="font-normal cursor-pointer">
                              Grant/Scholarship Match
                            </Label>
                          </div>
                        </div>
                      </RadioGroup>
                      <p className="text-xs text-purple-700 mt-2">
                        This determines which questions you'll see in the next steps.
                      </p>
                    </div>
                  )}

                  <div className="flex justify-between mt-6">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelectedTemplate(null);
                      }}
                    >
                      Change Template
                    </Button>
                    <Button
                      onClick={handleStep1Continue}
                      disabled={
                        isSavingDraft ||
                        (isUniversalTemplate && !presetKey) ||
                        (isFinanceTemplate && !responses.mode) ||
                        (isProfileMatchingTemplate && !responses.mode)
                      }
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      Continue
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5 text-blue-600" />
                    Your Information ({selectedTemplate?.party_a_label})
                  </CardTitle>
                  <CardDescription>Information about you or your organization.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {hasValidationErrors && (
                    <Alert variant="destructive">
                      <AlertTriangle className="w-4 h-4" />
                      <AlertDescription>Please complete all required fields before continuing.</AlertDescription>
                    </Alert>
                  )}

                  {partyAQuestions.map(renderQuestionInput)}
                  {partyAQuestions.length === 0 && (
                    <p className="text-slate-500 text-center py-4">No questions for this section.</p>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-between mt-6">
                <Button variant="outline" onClick={() => handleBack(1)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button onClick={handleNext} className="bg-blue-600 hover:bg-blue-700">
                  Continue
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-600" />
                    Counterparty Information ({selectedTemplate?.party_b_label})
                  </CardTitle>
                  <CardDescription>
                    Information about the recipient. They can verify or correct this later.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {hasValidationErrors && (
                    <Alert variant="destructive">
                      <AlertTriangle className="w-4 h-4" />
                      <AlertDescription>Please complete all required fields before continuing.</AlertDescription>
                    </Alert>
                  )}

                  {partyBQuestions.map(renderQuestionInput)}
                  {partyBQuestions.length === 0 && (
                    <p className="text-slate-500 text-center py-4">No questions for this section.</p>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-between mt-6">
                <Button variant="outline" onClick={() => handleBack(2)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button onClick={handleNext} className="bg-blue-600 hover:bg-blue-700">
                  Review
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Review & Submit</CardTitle>
                  <CardDescription>Review your proposal before sending.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="p-4 bg-slate-50 rounded-xl space-y-3">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Template</span>
                      <span className="font-medium">{selectedTemplate?.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Title</span>
                      <span className="font-medium">{proposalTitle || `${selectedTemplate?.name} Proposal`}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Recipient</span>
                      <span className="font-medium">{recipientEmail || 'Not specified'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Fields Completed</span>
                      <span className="font-medium">
                        {Object.keys(responses).filter((key) => !key.startsWith('_')).length} /{' '}
                        {selectedTemplate?.questions?.length || 0}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                    <div className="flex items-start gap-3">
                      <Sparkles className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-blue-900">AI Evaluation</p>
                        <p className="text-sm text-blue-700 mt-1">
                          Run evaluation to generate compatibility signals and next-step recommendations.
                        </p>
                      </div>
                    </div>
                  </div>

                  {evaluationError && (
                    <Alert variant="destructive">
                      <AlertTriangle className="w-4 h-4" />
                      <AlertDescription>{evaluationError}</AlertDescription>
                    </Alert>
                  )}

                  <div className="flex justify-between">
                    <Button variant="outline" onClick={() => handleBack(3)}>
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Back
                    </Button>
                    <Button
                      onClick={handleRunEvaluation}
                      disabled={isSubmittingEvaluation}
                      className={isProfileMatchingTemplate ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'}
                    >
                      {isSubmittingEvaluation ? (
                        'Running Evaluation...'
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-2" />
                          {isProfileMatchingTemplate ? 'Run Profile Evaluation' : 'Run Evaluation'}
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
