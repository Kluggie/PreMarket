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
  Sparkles,
  TrendingUp,
  User,
  Users,
  XCircle,
} from 'lucide-react';
import { proposalsClient } from '@/api/proposalsClient';
import { templatesClient } from '@/api/templatesClient';
import {
  TEMPLATE_ONBOARDING_CONFIG,
  getEnabledModules,
  getModeOption,
  resolveTemplateKey,
} from '@/lib/templateOnboardingConfig';

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
  const [draftProposalId, setDraftProposalId] = useState(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSubmittingEvaluation, setIsSubmittingEvaluation] = useState(false);
  const [saveError, setSaveError] = useState('');
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
  const isModeSelectorQuestion = (question) =>
    String(question?.module_key || '') === 'mode_selector' || String(question?.id || '') === 'mode';

  const selectedTemplateKey = resolveTemplateKey(selectedTemplate);
  const selectedTemplateConfig = selectedTemplateKey
    ? TEMPLATE_ONBOARDING_CONFIG[selectedTemplateKey] || null
    : null;
  const isUniversalTemplate = selectedTemplateKey === 'universal_enterprise_onboarding';
  const isFinanceTemplate = selectedTemplateKey === 'universal_finance_deal_prequal';
  const isProfileMatchingTemplate = selectedTemplateKey === 'universal_profile_matching';

  const selectedModeOption = useMemo(() => {
    if (!selectedTemplateConfig || selectedTemplateConfig.valueSource !== 'mode') {
      return null;
    }
    return getModeOption(selectedTemplateKey, responses.mode);
  }, [selectedTemplateConfig, selectedTemplateKey, responses.mode]);

  const selectedVariantKey =
    selectedTemplateConfig?.valueSource === 'preset'
      ? presetKey
      : selectedModeOption?.key || '';

  const enabledModules = useMemo(() => {
    return getEnabledModules(selectedTemplateKey, selectedVariantKey);
  }, [selectedTemplateKey, selectedVariantKey]);

  const shouldIncludeQuestion = (question) => {
    if (!selectedTemplateConfig) return true;
    if (!question?.module_key) return false;

    const presetVisible =
      question?.preset_visible && typeof question.preset_visible === 'object'
        ? question.preset_visible
        : null;
    if (presetVisible && Object.keys(presetVisible).length > 0) {
      if (!selectedVariantKey) {
        return question.module_key === 'mode_selector';
      }
      if (presetVisible[selectedVariantKey] !== undefined) {
        return Boolean(presetVisible[selectedVariantKey]);
      }
      return false;
    }

    if (selectedTemplateConfig.valueSource === 'mode' && !selectedVariantKey) {
      return question.module_key === 'mode_selector';
    }

    return enabledModules.includes(question.module_key);
  };

  const getEffectiveRequired = () => false;

  const partyAQuestions = useMemo(
    () =>
      selectedTemplate?.questions?.filter((question) => {
        const roleType = question?.role_type || 'party_attribute';
        if (roleType === 'shared_fact') {
          // Mode is selected in Step 1; do not duplicate it as a question card in Step 2.
          if (selectedTemplateConfig?.valueSource === 'mode' && isModeSelectorQuestion(question)) {
            return false;
          }
          return true;
        }

        const normalized = getNormalizedParty(question);
        return (normalized === 'a' || normalized === 'both') && shouldIncludeQuestion(question);
      }) || [],
    [selectedTemplate, selectedTemplateConfig, selectedVariantKey, enabledModules],
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
    [selectedTemplate, selectedTemplateConfig, selectedVariantKey, enabledModules],
  );

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

    const nextResponses = {};
    if (payload.mode) nextResponses.mode = payload.mode;
    if (payload._profile_url) nextResponses._profile_url = payload._profile_url;
    if (payload._target_url) nextResponses._target_url = payload._target_url;

    const templateQuestionsById = new Map(
      Array.isArray(template?.questions)
        ? template.questions.map((question) => [question.id, question])
        : [],
    );

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

      const matchingQuestion = templateQuestionsById.get(responseRow.question_id);
      const roleType = matchingQuestion?.role_type || 'party_attribute';
      loadedVisibility[responseKey] =
        roleType === 'shared_fact' ? 'full' : normalizeVisibilitySetting(responseRow.visibility);
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
          visibility: enteredByParty === 'b' || roleType === 'shared_fact'
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
    draftStepOverride = step,
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
      draft_step: draftStepOverride,
      mode: responses.mode || null,
      preset_key: presetKey || null,
      enabled_modules: enabledModules,
      _profile_url: responses._profile_url || null,
      _target_url: responses._target_url || null,
      _include_profile: false,
      _include_organisation: false,
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

  const validateCurrentStep = () => {
    setValidationErrors({});
    return true;
  };

  const validateAll = () => {
    const errors = {};

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
    setSaveError('');

    return true;
  };

  const handleResponseChange = (questionId, value) => {
    setResponses((prev) => ({ ...prev, [questionId]: value }));
    setSaveError('');

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

  const handleVisibilityChange = (question, questionId, visibility) => {
    const roleType = question?.role_type || 'party_attribute';
    if (roleType === 'shared_fact') {
      setVisibilitySettings((prev) => ({ ...prev, [questionId]: 'full' }));
      return;
    }

    setVisibilitySettings((prev) => ({ ...prev, [questionId]: normalizeVisibilitySetting(visibility) }));
  };

  const handleStep1Continue = async () => {
    if (!validateStep1RecipientEmail()) {
      return;
    }
    if (isUniversalTemplate && !presetKey) {
      setSaveError('Select an onboarding type to continue.');
      return;
    }
    if ((isFinanceTemplate || isProfileMatchingTemplate) && !responses.mode) {
      setSaveError('Select a mode to continue.');
      return;
    }

    setIsSavingDraft(true);
    setSaveError('');
    setEvaluationError('');

    try {
      await persistDraft({ status: 'draft', createIfMissing: true, draftStepOverride: 2 });
      setStep(2);
      setValidationErrors({});
    } catch (error) {
      setSaveError(error?.message || 'Failed to save draft. Please try again.');
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleNext = async () => {
    if ((step === 2 || step === 3) && !validateCurrentStep()) {
      return;
    }

    setValidationErrors({});
    setSaveError('');

    const nextStep = step + 1;
    setIsSavingDraft(true);
    try {
      await persistDraft({ status: 'draft', createIfMissing: true, draftStepOverride: nextStep });
      setStep(nextStep);
    } catch (error) {
      setSaveError(error?.message || 'Failed to save draft. Please try again.');
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleBack = async (targetStep) => {
    setValidationErrors({});
    setSaveError('');
    setStep(targetStep);

    if (draftProposalId) {
      try {
        await persistDraft({ status: 'draft', createIfMissing: false, draftStepOverride: targetStep });
      } catch (error) {
        setSaveError(error?.message || 'Failed to save draft. Please try again.');
      }
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
        await proposalsClient.evaluate(proposalId, {});
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
      isSharedFact || step === 3
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
              {isCounterpartyObs && <Badge className="ml-2 text-xs bg-purple-100 text-purple-700">Your observation</Badge>}
            </Label>
            {question.description && <p className="text-sm text-slate-600 mt-1">{question.description}</p>}
          </div>
          {step !== 3 && (
            isSharedFact ? (
              <Badge variant="outline" className="h-8 px-3 text-xs bg-blue-50 text-blue-700 border-blue-200">
                Shared
              </Badge>
            ) : (
              <Select value={visibility} onValueChange={(nextVisibility) => handleVisibilityChange(question, responseKey, nextVisibility)}>
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
            )
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

        {saveError && (
          <Alert variant="destructive" className="mb-6">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

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

                  {isUniversalTemplate && (
                    <div className="space-y-3 p-4 border-2 border-blue-200 bg-blue-50 rounded-xl">
                      <Label className="text-sm font-semibold text-blue-900">Onboarding Type *</Label>
                      <RadioGroup value={presetKey} onValueChange={(value) => setPresetKey(value)}>
                        <div className="space-y-2">
                          {TEMPLATE_ONBOARDING_CONFIG.universal_enterprise_onboarding.options.map((option) => (
                            <div key={option.key} className="flex items-center space-x-2">
                              <RadioGroupItem value={option.key} id={`preset-${option.key}`} />
                              <Label htmlFor={`preset-${option.key}`} className="font-normal cursor-pointer">
                                {option.label}
                              </Label>
                            </div>
                          ))}
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
                          {TEMPLATE_ONBOARDING_CONFIG.universal_finance_deal_prequal.options.map((option) => (
                            <div key={option.key} className="flex items-center space-x-2">
                              <RadioGroupItem value={option.value} id={`mode-${option.key}`} />
                              <Label htmlFor={`mode-${option.key}`} className="font-normal cursor-pointer">
                                {option.label}
                              </Label>
                            </div>
                          ))}
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
                          {TEMPLATE_ONBOARDING_CONFIG.universal_profile_matching.options.map((option) => (
                            <div key={option.key} className="flex items-center space-x-2">
                              <RadioGroupItem value={option.value} id={`mode-${option.key}`} />
                              <Label htmlFor={`mode-${option.key}`} className="font-normal cursor-pointer">
                                {option.label}
                              </Label>
                            </div>
                          ))}
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
                <Button onClick={handleNext} disabled={isSavingDraft} className="bg-blue-600 hover:bg-blue-700">
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
                <Button onClick={handleNext} disabled={isSavingDraft} className="bg-blue-600 hover:bg-blue-700">
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
