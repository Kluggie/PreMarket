/**
 * GuestCreateOpportunity.jsx
 *
 * Unauthenticated (signed-out) version of the opportunity creation wizard.
 *
 * - Steps 1–3: fully local, no server calls required.
 * - Step 4 (Review/Evaluate): shows a sign-in gate — requires login before
 *   running evaluation or inviting the other party.
 * - Draft is stored in localStorage via useGuestDraft.
 * - After sign-in, the guest draft is migrated to the authenticated account
 *   and the user is forwarded into the normal CreateOpportunity flow.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
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
  LogIn,
  Sparkles,
  TrendingUp,
  User,
  Users,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useGuestDraft } from '@/hooks/useGuestDraft';
import {
  TEMPLATE_ONBOARDING_CONFIG,
  getEnabledModules,
  getModeOption,
  resolveTemplateKey,
} from '@/lib/templateOnboardingConfig';

// ─── Constants ────────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GUEST_RETURN_TO_KEY = 'pm:guest_return_to';

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const normalizeVisibilitySetting = (value) => {
  const v = String(value || '').trim().toLowerCase();
  return ['hidden', 'not_shared', 'private', 'confidential', 'partial'].includes(v)
    ? 'hidden'
    : 'full';
};

function parseValue(rawValue) {
  if (rawValue === null || rawValue === undefined) return '';
  if (typeof rawValue === 'object') return rawValue;
  const text = String(rawValue);
  if (!text) return '';
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

const asSearchParams = () => new URLSearchParams(window.location.search);

const isRecipientEmailQuestion = (q) => {
  const id = String(q?.id || '').toLowerCase();
  const label = String(q?.label || '').toLowerCase();
  return (
    id === 'recipient_email' ||
    id === 'party_b_email' ||
    id === 'counterparty_email' ||
    label.includes('recipient email') ||
    label.includes('counterparty email')
  );
};

const isModeSelectorQuestion = (q) =>
  String(q?.module_key || '') === 'mode_selector' || String(q?.id || '') === 'mode';

// ─── Sign-in Gate ─────────────────────────────────────────────────────────────

function SignInGate({ message, onSignIn, className = '' }) {
  return (
    <div className={`rounded-xl border-2 border-blue-200 bg-blue-50 p-6 text-center ${className}`}>
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
        <Lock className="h-6 w-6 text-blue-600" />
      </div>
      <h3 className="mb-1 text-lg font-semibold text-slate-900">Sign in to continue</h3>
      <p className="mb-5 text-sm text-slate-600">{message}</p>
      <Button
        onClick={onSignIn}
        className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
        data-testid="guest-signin-gate-btn"
      >
        <LogIn className="h-4 w-4" />
        Sign in to invite the other party
      </Button>
      <p className="mt-3 text-xs text-slate-500">
        Your progress has been saved in this browser on this device.
      </p>
    </div>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

export default function GuestCreateOpportunity() {
  const navigate = useNavigate();
  const { user, isLoadingAuth } = useAuth();
  const { guestDraft, saveGuestDraft, clearGuestDraft, hasGuestDraft } = useGuestDraft();

  // If the user just signed in, migrate and redirect.
  const hasMigratedRef = useRef(false);
  useEffect(() => {
    if (!isLoadingAuth && user && !hasMigratedRef.current) {
      hasMigratedRef.current = true;
      migrateGuestDraftAndRedirect();
    }
  }, [user, isLoadingAuth]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Templates (public, no auth) ──────────────────────────────────────────
  const [templates, setTemplates] = useState([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [templateLoadError, setTemplateLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/public/templates')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load templates');
        return res.json();
      })
      .then((body) => {
        if (!cancelled) {
          setTemplates(Array.isArray(body?.templates) ? body.templates : []);
          setIsLoadingTemplates(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setTemplateLoadError(err.message || 'Could not load templates');
          setIsLoadingTemplates(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Wizard state ──────────────────────────────────────────────────────────
  const hasInitialized = useRef(false);
  const [step, setStep] = useState(1);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [proposalTitle, setProposalTitle] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [responses, setResponses] = useState({});
  const [visibilitySettings, setVisibilitySettings] = useState({});
  const [validationErrors, setValidationErrors] = useState({});
  const [presetKey, setPresetKey] = useState('');
  const [saveError, setSaveError] = useState('');
  const [showSignInGate, setShowSignInGate] = useState(false);

  // ── Restore draft from localStorage on mount ──────────────────────────────
  useEffect(() => {
    if (hasInitialized.current || templates.length === 0) return;
    hasInitialized.current = true;

    // URL can override: ?template=<slug>
    const params = asSearchParams();
    const templateSlugParam = params.get('template');

    if (guestDraft) {
      const template =
        templates.find((t) => t.slug === guestDraft.templateSlug) ||
        templates.find((t) => t.id === guestDraft.templateId) ||
        null;
      if (template) setSelectedTemplate(template);
      setProposalTitle(guestDraft.proposalTitle || '');
      setRecipientEmail(guestDraft.recipientEmail || '');
      setPresetKey(guestDraft.presetKey || '');
      setResponses(guestDraft.responses || {});
      setVisibilitySettings(guestDraft.visibilitySettings || {});
      const draftStep = Number(guestDraft.step || 1);
      setStep(draftStep >= 1 && draftStep <= 3 ? draftStep : 1);
      return;
    }

    if (templateSlugParam) {
      const template = templates.find(
        (t) => t.slug === templateSlugParam || t.template_key === templateSlugParam,
      );
      if (template) {
        setSelectedTemplate(template);
        setStep(1);
      }
    }
  }, [templates]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist draft whenever editable state changes (debounced-like: on step change) ──
  const persistGuestDraft = useCallback(
    (overrideStep) => {
      if (!selectedTemplate) return;
      saveGuestDraft({
        templateSlug: selectedTemplate.slug,
        templateId: selectedTemplate.id,
        proposalTitle,
        recipientEmail,
        presetKey,
        responses,
        visibilitySettings,
        step: overrideStep ?? step,
      });
    },
    [selectedTemplate, proposalTitle, recipientEmail, presetKey, responses, visibilitySettings, step, saveGuestDraft],
  );

  // ── Template helpers ──────────────────────────────────────────────────────
  const selectedTemplateKey = resolveTemplateKey(selectedTemplate);
  const selectedTemplateConfig = selectedTemplateKey
    ? TEMPLATE_ONBOARDING_CONFIG[selectedTemplateKey] || null
    : null;
  const isUniversalTemplate = selectedTemplateKey === 'universal_enterprise_onboarding';
  const isFinanceTemplate = selectedTemplateKey === 'universal_finance_deal_prequal';
  const isProfileMatchingTemplate = selectedTemplateKey === 'universal_profile_matching';

  const selectedModeOption = useMemo(() => {
    if (!selectedTemplateConfig || selectedTemplateConfig.valueSource !== 'mode') return null;
    return getModeOption(selectedTemplateKey, responses.mode);
  }, [selectedTemplateConfig, selectedTemplateKey, responses.mode]);

  const selectedVariantKey =
    selectedTemplateConfig?.valueSource === 'preset'
      ? presetKey
      : selectedModeOption?.key || '';

  const enabledModules = useMemo(
    () => getEnabledModules(selectedTemplateKey, selectedVariantKey),
    [selectedTemplateKey, selectedVariantKey],
  );

  const getNormalizedParty = (question) => {
    if (question?.party) return question.party;
    if (question?.is_about_counterparty === true) return 'b';
    if (question?.applies_to_role === 'proposer') return 'a';
    if (question?.applies_to_role === 'recipient') return 'b';
    if (question?.applies_to_role === 'both') return 'both';
    return 'a';
  };

  const shouldIncludeQuestion = (question) => {
    if (!selectedTemplateConfig) return true;
    if (!question?.module_key) return false;
    const presetVisible =
      question?.preset_visible && typeof question.preset_visible === 'object'
        ? question.preset_visible
        : null;
    if (presetVisible && Object.keys(presetVisible).length > 0) {
      if (!selectedVariantKey) return question.module_key === 'mode_selector';
      if (presetVisible[selectedVariantKey] !== undefined) return Boolean(presetVisible[selectedVariantKey]);
      return false;
    }
    if (selectedTemplateConfig.valueSource === 'mode' && !selectedVariantKey) {
      return question.module_key === 'mode_selector';
    }
    return enabledModules.includes(question.module_key);
  };

  const partyAQuestions = useMemo(
    () =>
      selectedTemplate?.questions?.filter((q) => {
        const roleType = q?.role_type || 'party_attribute';
        if (roleType === 'shared_fact') {
          if (selectedTemplateConfig?.valueSource === 'mode' && isModeSelectorQuestion(q)) return false;
          return true;
        }
        const n = getNormalizedParty(q);
        return (n === 'a' || n === 'both') && shouldIncludeQuestion(q);
      }) || [],
    [selectedTemplate, selectedTemplateConfig, selectedVariantKey, enabledModules],
  );

  const partyBQuestions = useMemo(
    () =>
      selectedTemplate?.questions?.filter((q) => {
        const roleType = q?.role_type || 'party_attribute';
        if (roleType === 'shared_fact') return false;
        if (isRecipientEmailQuestion(q)) return false;
        const n = getNormalizedParty(q);
        return (n === 'b' || n === 'both') && shouldIncludeQuestion(q);
      }) || [],
    [selectedTemplate, selectedTemplateConfig, selectedVariantKey, enabledModules],
  );

  // ── Response helpers ──────────────────────────────────────────────────────
  const getQuestionResponseKey = (question, stepHint = step) => {
    const roleType = question?.role_type || 'party_attribute';
    if (roleType === 'shared_fact') return question.id;
    if (stepHint === 3) return `${question.id}__b`;
    if (stepHint === 2) return question.id;
    const normalized = getNormalizedParty(question);
    return normalized === 'b' ? `${question.id}__b` : question.id;
  };

  const getQuestionResponseValue = (question, stepHint = step) => {
    const key = getQuestionResponseKey(question, stepHint);
    return responses[key] !== undefined ? responses[key] : responses[question.id];
  };

  const handleResponseChange = (questionId, value) => {
    setResponses((prev) => ({ ...prev, [questionId]: value }));
    setSaveError('');
    const [baseId] = String(questionId).split('__');
    if (validationErrors[questionId] || validationErrors[baseId]) {
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[questionId];
        delete next[baseId];
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
    setVisibilitySettings((prev) => ({
      ...prev,
      [questionId]: normalizeVisibilitySetting(visibility),
    }));
  };

  // ── Validation ────────────────────────────────────────────────────────────
  const validateStep1RecipientEmail = () => {
    const trimmed = recipientEmail.trim();
    if (!trimmed) {
      setValidationErrors((prev) => ({ ...prev, _recipient_email: 'Recipient email is required' }));
      return false;
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      setValidationErrors((prev) => ({
        ...prev,
        _recipient_email: 'Enter a valid email address',
      }));
      return false;
    }
    setRecipientEmail(trimmed);
    setValidationErrors((prev) => {
      const next = { ...prev };
      delete next._recipient_email;
      return next;
    });
    return true;
  };

  // ── Navigation ────────────────────────────────────────────────────────────
  const handleStep1Continue = () => {
    if (!validateStep1RecipientEmail()) return;
    if (isUniversalTemplate && !presetKey) {
      setSaveError('Select an onboarding type to continue.');
      return;
    }
    if ((isFinanceTemplate || isProfileMatchingTemplate) && !responses.mode) {
      setSaveError('Select a mode to continue.');
      return;
    }
    setSaveError('');
    setValidationErrors({});
    persistGuestDraft(2);
    setStep(2);
  };

  const handleNext = () => {
    setValidationErrors({});
    setSaveError('');
    const nextStep = step + 1;
    persistGuestDraft(nextStep);
    setStep(nextStep);
  };

  const handleClearDraft = useCallback(() => {
    clearGuestDraft();
    navigate('/opportunities/new');
    // Reset wizard state
    setStep(1);
    setSelectedTemplate(null);
    setProposalTitle('');
    setRecipientEmail('');
    setPresetKey('');
    setResponses({});
    setVisibilitySettings({});
    setSaveError('');
    setValidationErrors({});
  }, [clearGuestDraft, navigate]);

  const handleBack = (targetStep) => {
    setValidationErrors({});
    setSaveError('');
    persistGuestDraft(targetStep);
    setStep(targetStep);
  };

  // ── Sign-in gate ──────────────────────────────────────────────────────────
  const { navigateToLogin } = useAuth();

  const handleRequestSignIn = useCallback(() => {
    // Persist the draft before navigating away so it survives the auth round-trip.
    persistGuestDraft(step);
    // Store the return-to URL so post-auth we come back here.
    localStorage.setItem(GUEST_RETURN_TO_KEY, window.location.pathname + window.location.search);
    // Use the AuthContext inline login dialog (opens within the SPA, no full navigation).
    // The AuthProvider listens for the LOGIN_EVENT_NAME custom event.
    window.dispatchEvent(new CustomEvent('pm:auth:open-login', {
      detail: { returnTo: window.location.pathname + window.location.search },
    }));
  }, [persistGuestDraft, step]);

  // ── Post-auth migration ───────────────────────────────────────────────────
  async function migrateGuestDraftAndRedirect() {
    const draft = guestDraft;
    if (!draft || !draft.templateSlug) {
      // No draft — just go to authenticated create opportunity.
      navigate(createPageUrl('CreateOpportunity'));
      return;
    }

    try {
      // 1. Look up the template by slug in the authenticated templates list.
      const templatesRes = await fetch('/api/templates');
      if (!templatesRes.ok) throw new Error('Could not load templates after sign-in');
      const templatesBody = await templatesRes.json();
      const authedTemplates = Array.isArray(templatesBody?.templates) ? templatesBody.templates : [];
      const template =
        authedTemplates.find((t) => t.slug === draft.templateSlug) ||
        authedTemplates.find((t) => t.id === draft.templateId) ||
        null;

      if (!template) {
        // Template not found — go to normal create flow with no pre-fill
        clearGuestDraft();
        navigate(createPageUrl('CreateOpportunity'));
        return;
      }

      // 2. Create a draft proposal.
      const createRes = await fetch(`/api/templates/${encodeURIComponent(template.id)}/use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: draft.proposalTitle || `${template.name} Opportunity`,
          partyBEmail: draft.recipientEmail?.trim() || null,
          idempotencyKey: `guest-migrate:${template.id}:${draft.savedAt || Date.now()}`,
        }),
      });
      if (!createRes.ok) throw new Error('Could not create draft after sign-in');
      const createBody = await createRes.json();
      const proposalId = createBody?.proposal?.id || null;
      if (!proposalId) throw new Error('No proposal ID in migration response');

      // 3. Save draft responses.
      const questions = Array.isArray(template.questions) ? template.questions : [];
      const responseRows = buildMigrationResponseRows(draft.responses || {}, draft.visibilitySettings || {}, questions);

      if (responseRows.length > 0) {
        const responsesRes = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/responses`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ responses: responseRows }),
        });
        if (!responsesRes.ok) {
          // Non-fatal: we still have the proposal, just without responses pre-filled.
          console.warn('GuestMigration: failed to save responses', await responsesRes.text());
        }
      }

      // 4. Clear the local draft now that it's safely in the server.
      clearGuestDraft();

      // 5. Navigate to the newly created draft (step 3 or wherever they were).
      const resumeStep = Math.min(Number(draft.step || 2), 3);
      navigate(
        createPageUrl(`CreateOpportunity?draft=${encodeURIComponent(proposalId)}&step=${resumeStep}`),
      );
    } catch (err) {
      // Migration failed — DON'T clear the local draft so user doesn't lose data.
      console.error('GuestMigration: failed', err);
      // Fall back: go to authenticated create flow; draft remains in localStorage.
      navigate(createPageUrl('CreateOpportunity'));
    }
  }

  // Build response rows suitable for PUT /api/proposals/:id/responses
  function buildMigrationResponseRows(savedResponses, savedVisibility, questions) {
    const templateQuestionsById = new Map(questions.map((q) => [q.id, q]));
    return Object.entries(savedResponses)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, value]) => {
        const [questionId, suffix] = key.includes('__')
          ? key.split('__')
          : [key, 'a'];
        const question = templateQuestionsById.get(questionId);
        if (!question) return null;

        const enteredByParty = suffix === 'b' ? 'b' : 'a';
        const roleType = question?.role_type || 'party_attribute';
        const claimType =
          roleType === 'shared_fact' ? 'shared_fact' : enteredByParty === 'b' ? 'counterparty_claim' : 'self';

        const row = {
          question_id: questionId,
          section_id: question.section_id || null,
          value: serializeResponseValue(value),
          value_type: 'text',
          range_min: null,
          range_max: null,
          visibility:
            enteredByParty === 'b' || roleType === 'shared_fact'
              ? 'full'
              : normalizeVisibilitySetting(
                  savedVisibility[key] || savedVisibility[questionId] || question.visibility_default,
                ),
          claim_type: claimType,
          entered_by_party: enteredByParty,
        };

        if (value && typeof value === 'object' && value.type === 'range') {
          row.value = null;
          row.value_type = 'range';
          row.range_min = String(value.min || '');
          row.range_max = String(value.max || '');
        }
        return row;
      })
      .filter(Boolean);
  }

  // ── Question renderer (adapted from CreateProposalWithDrafts) ─────────────
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

    return (
      <div key={question.id} className="space-y-2 p-4 bg-white border rounded-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Label className="text-sm font-medium text-slate-900">
              {question.label}
              {isCounterpartyObs && (
                <Badge className="ml-2 text-xs bg-purple-100 text-purple-700">Your observation</Badge>
              )}
            </Label>
            {question.description && (
              <p className="text-sm text-slate-600 mt-1">{question.description}</p>
            )}
          </div>
          {step !== 3 && (
            isSharedFact ? (
              <Badge variant="outline" className="h-8 px-3 text-xs bg-blue-50 text-blue-700 border-blue-200">
                Shared
              </Badge>
            ) : (
              <Select
                value={visibility}
                onValueChange={(v) => handleVisibilityChange(question, responseKey, v)}
              >
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
            question.allowed_values?.length > 0 ? (
              <Select
                value={value}
                onValueChange={(v) => handleResponseChange(responseKey, v)}
              >
                <SelectTrigger className={hasError ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {question.allowed_values.map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                type="text"
                value={value}
                onChange={(e) => handleResponseChange(responseKey, e.target.value)}
                placeholder="Enter value..."
                className={hasError ? 'border-red-500' : ''}
              />
            )
          ) : question.field_type === 'multi_select' ? (
            <div className="space-y-2">
              {question.allowed_values?.map((opt) => (
                <div key={opt} className="flex items-center space-x-2">
                  <Checkbox
                    id={`${question.id}-${opt}`}
                    checked={(value || []).includes(opt)}
                    onCheckedChange={(checked) => {
                      const current = Array.isArray(value) ? value : [];
                      handleResponseChange(
                        responseKey,
                        checked ? [...current, opt] : current.filter((e) => e !== opt),
                      );
                    }}
                  />
                  <label htmlFor={`${question.id}-${opt}`} className="text-sm">{opt}</label>
                </div>
              ))}
            </div>
          ) : question.field_type === 'boolean' ? (
            <RadioGroup
              value={value}
              onValueChange={(v) => handleResponseChange(responseKey, v)}
            >
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
              onChange={(e) => handleResponseChange(responseKey, e.target.value)}
              placeholder={`Enter ${question.label.toLowerCase()}...`}
              className={`min-h-[100px] ${hasError ? 'border-red-500' : ''}`}
            />
          ) : (
            <Input
              type={question.field_type === 'number' ? 'number' : question.field_type === 'url' ? 'url' : 'text'}
              value={value}
              onChange={(e) => handleResponseChange(responseKey, e.target.value)}
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

  // ── Progress ──────────────────────────────────────────────────────────────
  const totalSteps = 4;
  const progress = (step / totalSteps) * 100;
  const hasValidationErrors = Object.keys(validationErrors).length > 0;

  // ── Loading / migrating states ────────────────────────────────────────────
  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  // Authenticated users who arrive here (e.g. via direct URL) should be
  // redirected to the normal authenticated flow. The useEffect above handles
  // this; show a spinner while that kick-off happens.
  if (user) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 py-8" data-testid="guest-opportunity-page">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="mb-8">
          <Link to="/" className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">New Opportunity</h1>
            <p className="text-slate-500 mt-1">
              Try the Opportunity creation flow — no account required for Steps 1–3.
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm text-slate-500 mb-2">
            <span>Step {step} of {totalSteps}</span>
            <span>{Math.round(progress)}% complete</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Trial banner */}
        <Alert className="mb-6 border-amber-200 bg-amber-50">
          <Sparkles className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 flex items-center justify-between flex-wrap gap-2">
            <span>
              <strong>Preview mode</strong> — Your progress is saved on this device only.
              Sign in to invite the other party and save permanently to your account.
            </span>
            {hasGuestDraft && (
              <button
                type="button"
                data-testid="clear-draft-btn"
                onClick={handleClearDraft}
                className="text-xs underline text-amber-700 hover:text-amber-900 shrink-0"
              >
                Clear draft
              </button>
            )}
          </AlertDescription>
        </Alert>

        {saveError && (
          <Alert variant="destructive" className="mb-6">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        <AnimatePresence mode="wait">
          {/* ── Step 1: Template selection ── */}
          {step === 1 && !selectedTemplate && (
            <motion.div
              key="step1-select"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Select Template</CardTitle>
                  <CardDescription>Choose a template that matches your needs.</CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoadingTemplates ? (
                    <p className="text-sm text-slate-500">Loading templates…</p>
                  ) : templateLoadError ? (
                    <p className="text-sm text-red-600">{templateLoadError}</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="template-grid">
                      {templates.map((template) => {
                        const Icon = iconMap[template.category] || FileText;
                        return (
                          <button
                            key={template.id}
                            data-testid={`template-option-${template.slug}`}
                            onClick={() => setSelectedTemplate(template)}
                            className={`p-4 rounded-xl border-2 text-left transition-all ${
                              selectedTemplate?.id === template.id
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <Icon className={`w-6 h-6 mb-2 ${
                              selectedTemplate?.id === template.id ? 'text-blue-600' : 'text-slate-400'
                            }`} />
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

          {/* ── Step 1: Opportunity details ── */}
          {step === 1 && selectedTemplate && (
            <motion.div
              key="step1-details"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Opportunity Details</CardTitle>
                  <CardDescription>Set the title and recipient for your opportunity.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label>Opportunity Title</Label>
                    <Input
                      data-testid="opportunity-title-input"
                      value={proposalTitle}
                      onChange={(e) => setProposalTitle(e.target.value)}
                      placeholder={`${selectedTemplate?.name} Opportunity`}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>
                      Recipient Email <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      data-testid="recipient-email-input"
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => {
                        setRecipientEmail(e.target.value);
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
                        Required: used for the counterparty workspace.
                      </p>
                    )}
                  </div>

                  {isUniversalTemplate && (
                    <div className="space-y-3 p-4 border-2 border-blue-200 bg-blue-50 rounded-xl">
                      <Label className="text-sm font-semibold text-blue-900">Onboarding Type *</Label>
                      <RadioGroup value={presetKey} onValueChange={(v) => setPresetKey(v)}>
                        <div className="space-y-2">
                          {TEMPLATE_ONBOARDING_CONFIG.universal_enterprise_onboarding.options.map((opt) => (
                            <div key={opt.key} className="flex items-center space-x-2">
                              <RadioGroupItem value={opt.key} id={`preset-${opt.key}`} />
                              <Label htmlFor={`preset-${opt.key}`} className="font-normal cursor-pointer">
                                {opt.label}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </RadioGroup>
                    </div>
                  )}

                  {isFinanceTemplate && (
                    <div className="space-y-3 p-4 border-2 border-emerald-200 bg-emerald-50 rounded-xl">
                      <Label className="text-sm font-semibold text-emerald-900">Deal Mode *</Label>
                      <RadioGroup
                        value={responses.mode || ''}
                        onValueChange={(v) => handleResponseChange('mode', v)}
                      >
                        <div className="space-y-2">
                          {TEMPLATE_ONBOARDING_CONFIG.universal_finance_deal_prequal.options.map((opt) => (
                            <div key={opt.key} className="flex items-center space-x-2">
                              <RadioGroupItem value={opt.value} id={`mode-${opt.key}`} />
                              <Label htmlFor={`mode-${opt.key}`} className="font-normal cursor-pointer">
                                {opt.label}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </RadioGroup>
                    </div>
                  )}

                  {isProfileMatchingTemplate && (
                    <div className="space-y-3 p-4 border-2 border-purple-200 bg-purple-50 rounded-xl">
                      <Label className="text-sm font-semibold text-purple-900">Profile Matching Mode *</Label>
                      <RadioGroup
                        value={responses.mode || ''}
                        onValueChange={(v) => handleResponseChange('mode', v)}
                      >
                        <div className="space-y-2">
                          {TEMPLATE_ONBOARDING_CONFIG.universal_profile_matching.options.map((opt) => (
                            <div key={opt.key} className="flex items-center space-x-2">
                              <RadioGroupItem value={opt.value} id={`mode-${opt.key}`} />
                              <Label htmlFor={`mode-${opt.key}`} className="font-normal cursor-pointer">
                                {opt.label}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </RadioGroup>
                    </div>
                  )}

                  <div className="flex justify-between mt-6">
                    <Button
                      variant="outline"
                      onClick={() => setSelectedTemplate(null)}
                    >
                      Change Template
                    </Button>
                    <Button
                      data-testid="step1-continue-btn"
                      onClick={handleStep1Continue}
                      disabled={
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

          {/* ── Step 2: Your information ── */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
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
                      <AlertDescription>Please complete all required fields.</AlertDescription>
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
                <Button
                  data-testid="step2-continue-btn"
                  onClick={handleNext}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Continue
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Step 3: Counterparty information ── */}
          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
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
                      <AlertDescription>Please complete all required fields.</AlertDescription>
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
                <Button
                  data-testid="step3-review-btn"
                  onClick={handleNext}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Review
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Step 4: Review + Sign-in gate ── */}
          {step === 4 && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card className="border-0 shadow-sm mb-6">
                <CardHeader>
                  <CardTitle>Review Your Opportunity</CardTitle>
                  <CardDescription>Summary of what you've entered so far.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 bg-slate-50 rounded-xl space-y-3">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Template</span>
                      <span className="font-medium">{selectedTemplate?.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Title</span>
                      <span className="font-medium">
                        {proposalTitle || `${selectedTemplate?.name} Opportunity`}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Recipient</span>
                      <span className="font-medium">{recipientEmail || 'Not specified'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Fields Completed</span>
                      <span className="font-medium">
                        {Object.keys(responses).filter((k) => !k.startsWith('_')).length} /{' '}
                        {selectedTemplate?.questions?.length || 0}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                    <div className="flex items-start gap-3">
                      <Sparkles className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-blue-900">Invite Other Party</p>
                        <p className="text-sm text-blue-700 mt-1">
                          Sign in to save this opportunity to your account and invite the other
                          party to a shared workspace. Your draft will be restored automatically.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Sign-in gate */}
              <SignInGate
                message='Sign in to save this opportunity to your account and invite the other party to a shared workspace.'
                onSignIn={handleRequestSignIn}
              />

              <div className="flex justify-start mt-6">
                <Button variant="outline" onClick={() => handleBack(3)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
