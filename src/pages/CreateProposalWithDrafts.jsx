import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import GuestProposalBanner from '../components/proposal/GuestProposalBanner';
import GuestEmailCapture from '../components/proposal/GuestEmailCapture';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import {
  ArrowLeft, ArrowRight, FileText, User, Eye, EyeOff, Lock,
  Building2, Users, TrendingUp, Handshake, Briefcase, CheckCircle2,
  Send, Sparkles, AlertTriangle, XCircle, Save, Link as LinkIcon, Loader2, X, Check
} from 'lucide-react';

const iconMap = {
  m_and_a: Building2,
  recruiting: Users,
  investment: TrendingUp,
  partnership: Handshake,
  consulting: Briefcase,
  custom: FileText
};

export default function CreateProposal() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [step, setStep] = useState(1);
  const [hasTemplatePreselected, setHasTemplatePreselected] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [proposalTitle, setProposalTitle] = useState('');
  const [responses, setResponses] = useState({});
  const [visibilitySettings, setVisibilitySettings] = useState({});
  const [validationErrors, setValidationErrors] = useState({});
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [guestEmail, setGuestEmail] = useState('');
  const [presetKey, setPresetKey] = useState('');
  const [enabledModules, setEnabledModules] = useState([]);
  const [draftProposalId, setDraftProposalId] = useState(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const [extractUrl, setExtractUrl] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractedFields, setExtractedFields] = useState([]);
  const [showReviewExtracted, setShowReviewExtracted] = useState(false);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: async () => {
      const all = await base44.entities.Template.list();
      const visible = all.filter(t => t.status === 'published' || t.status === 'active');
      
      const byKey = visible.reduce((acc, t) => {
        const key = t.template_key || t.slug;
        if (!acc[key]) {
          acc[key] = t;
        } else if (key === 'universal_enterprise_onboarding') {
          if (new Date(t.updated_date || t.created_date) > new Date(acc[key].updated_date || acc[key].created_date)) {
            acc[key] = t;
          }
        } else if ((t.questions?.length || 0) > (acc[key].questions?.length || 0)) {
          acc[key] = t;
        }
        return acc;
      }, {});
      return Object.values(byKey);
    }
  });

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isGuest = params.get('guest') === 'true';
    const resumeDraftId = params.get('draft');
    setIsGuestMode(isGuest);
    
    if (resumeDraftId) {
      setDraftProposalId(resumeDraftId);
      loadDraft(resumeDraftId);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const templateId = params.get('template');
    
    if (templateId && !selectedTemplate) {
      const template = templates.find(t => t.id === templateId);
      
      if (template) {
        setSelectedTemplate(template);
        setHasTemplatePreselected(true);
        setStep(1);
      }
    }
  }, [templates, selectedTemplate]);

  const loadDraft = async (proposalId) => {
    try {
      const proposals = await base44.entities.Proposal.filter({ id: proposalId });
      const proposal = proposals[0];
      if (!proposal) return;

      const template = templates.find(t => t.id === proposal.template_id);
      if (template) {
        setSelectedTemplate(template);
        setProposalTitle(proposal.title || '');
        setRecipientEmail(proposal.party_b_email || '');
        setPresetKey(proposal.preset_key || '');
        setEnabledModules(proposal.enabled_modules || []);

        // Load all responses (both subject_party a and b)
        const draftResponses = await base44.entities.ProposalResponse.filter({ proposal_id: proposalId });
        const responsesObj = {};
        const visibilityObj = {};

        draftResponses.forEach(r => {
          // Build unique key: question_id + subject_party
          const key = r.question_id;
          const subjectParty = r.subject_party || (r.is_about_counterparty ? 'b' : 'a');
          
          // Store with subject indication for later filtering
          const responseKey = `${key}__${subjectParty}`;
          
          if (r.value_type === 'range') {
            responsesObj[responseKey] = { type: 'range', min: r.range_min, max: r.range_max };
          } else {
            try {
              responsesObj[responseKey] = JSON.parse(r.value);
            } catch {
              responsesObj[responseKey] = r.value;
            }
          }
          visibilityObj[responseKey] = r.visibility || 'full';
          
          // Also store without suffix for backward compatibility with shared facts
          if (subjectParty === 'shared' || subjectParty === 'a') {
            if (!responsesObj[key]) {
              if (r.value_type === 'range') {
                responsesObj[key] = { type: 'range', min: r.range_min, max: r.range_max };
              } else {
                try {
                  responsesObj[key] = JSON.parse(r.value);
                } catch {
                  responsesObj[key] = r.value;
                }
              }
              visibilityObj[key] = r.visibility || 'full';
            }
          }
        });

        setResponses(responsesObj);
        setVisibilitySettings(visibilityObj);
        
        // Resume at saved draft step
        const resumeStep = proposal.draft_step || 1;
        setStep(resumeStep);
        
        // Restore draft state
        if (proposal.draft_state_json) {
          const draftState = proposal.draft_state_json;
          if (draftState.mode) {
            handleResponseChange('mode', draftState.mode);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load draft:', error);
    }
  };

  // Auto-save draft
  const autoSaveDraft = async () => {
    if (!selectedTemplate || !user || isGuestMode || autoSaving) return;

    setAutoSaving(true);
    try {
      const proposalData = {
        title: proposalTitle || `${selectedTemplate.name} Proposal`,
        template_id: selectedTemplate.id,
        template_name: selectedTemplate.name,
        status: 'draft',
        party_a_user_id: user.id,
        party_a_email: user.email,
        party_b_email: recipientEmail || null,
        disclosure_mode: responses['disclosure_mode'] || 'open',
        include_profile: responses['_include_profile'] || false,
        include_organisation: responses['_include_organisation'] || false
      };

      if (presetKey) {
        proposalData.preset_key = presetKey;
        proposalData.enabled_modules = enabledModules;
      }

      let proposalId = draftProposalId;

      if (!proposalId) {
        const proposal = await base44.entities.Proposal.create(proposalData);
        proposalId = proposal.id;
        setDraftProposalId(proposalId);
        queryClient.invalidateQueries(['proposals']);
      } else {
        await base44.entities.Proposal.update(proposalId, proposalData);
      }

      const existingResponses = await base44.entities.ProposalResponse.filter({ proposal_id: proposalId });
      const existingIds = new Set(existingResponses.map(r => r.question_id));

      for (const [questionId, value] of Object.entries(responses)) {
        if (questionId.startsWith('_include_')) continue;
        
        const question = selectedTemplate.questions.find(q => q.id === questionId);
        const visibility = visibilitySettings[questionId] || 'full';

        const responseData = {
          proposal_id: proposalId,
          question_id: questionId,
          entered_by_party: 'a',
          is_about_counterparty: question?.is_about_counterparty || false,
          value: typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : Array.isArray(value) ? JSON.stringify(value) : String(value),
          visibility: visibility
        };

        if (typeof value === 'object' && value.type === 'range') {
          responseData.value_type = 'range';
          responseData.range_min = value.min;
          responseData.range_max = value.max;
        }

        if (existingIds.has(questionId)) {
          const existing = existingResponses.find(r => r.question_id === questionId);
          await base44.entities.ProposalResponse.update(existing.id, responseData);
        } else {
          await base44.entities.ProposalResponse.create(responseData);
        }
      }
    } catch (error) {
      console.error('Auto-save failed:', error);
    } finally {
      setAutoSaving(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (selectedTemplate && Object.keys(responses).length > 0) {
        autoSaveDraft();
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [responses, proposalTitle, recipientEmail, selectedTemplate, presetKey]);

  const totalSteps = hasTemplatePreselected ? 4 : 5;

  const allTemplates = templates;

  const isUniversalTemplate = selectedTemplate?.slug === 'universal_enterprise_onboarding' || 
                                selectedTemplate?.template_key === 'universal_enterprise_onboarding' ||
                                selectedTemplate?.name === 'Universal Enterprise Onboarding';

  const isFinanceTemplate = selectedTemplate?.slug === 'universal_finance_deal_prequal' ||
                            selectedTemplate?.template_key === 'universal_finance_deal_prequal';

  const isProfileMatchingTemplate = selectedTemplate?.slug === 'universal_profile_matching' ||
                                     selectedTemplate?.template_key === 'universal_profile_matching';

  const getModulesForPreset = (preset) => {
    const baseModules = ['org_profile', 'security_compliance', 'privacy_data_handling', 'operations_sla', 'implementation_it', 'legal_commercial', 'references'];
    if (preset === 'api_data_provider') {
      return [...baseModules, 'api_data'];
    }
    return baseModules;
  };

  const getNormalizedParty = (question) => {
    if (question.party) return question.party;
    if (question.is_about_counterparty === true) return 'b';
    if (question.applies_to_role === 'proposer') return 'a';
    if (question.applies_to_role === 'recipient') return 'b';
    if (question.applies_to_role === 'both') return 'both';
    return 'a';
  };

  const shouldIncludeQuestion = (question) => {
    // Universal Enterprise Onboarding filtering
    if (isUniversalTemplate) {
      if (!presetKey || enabledModules.length === 0) return false;
      if (question.module_key) {
        return enabledModules.includes(question.module_key);
      }
      return false;
    }

    // Universal Finance Deal Pre-Qual filtering
    if (isFinanceTemplate) {
      const selectedMode = responses['mode'];
      
      // Mode selector always shown
      if (question.module_key === 'mode_selector') return true;
      
      // Require mode selection before showing other questions
      if (!selectedMode) return false;
      
      // Common core always included
      if (question.module_key === 'common_core') return true;
      
      // Mode-specific questions
      if (selectedMode === 'Investor Fit' && question.module_key === 'investor_fit') return true;
      if (selectedMode === 'M&A Fit' && question.module_key === 'm_and_a_fit') return true;
      if (selectedMode === 'Lending Fit' && question.module_key === 'lending_fit') return true;
      
      return false;
    }

    // Universal Profile Matching filtering
    if (isProfileMatchingTemplate) {
      const selectedMode = responses['mode'];
      
      // Mode selector always shown
      if (question.module_key === 'mode_selector') return true;
      
      // Require mode selection before showing other questions
      if (!selectedMode) return false;
      
      // Shared core always included
      if (question.module_key === 'shared_core') return true;
      
      // Mode-specific questions
      if (selectedMode === 'Job Fit' && question.module_key === 'job_fit') return true;
      if (selectedMode === 'Beta Access Fit' && question.module_key === 'beta_access_fit') return true;
      if (selectedMode === 'Program/Accelerator Fit' && question.module_key === 'program_fit') return true;
      if (selectedMode === 'Grant/Scholarship Fit' && question.module_key === 'grant_fit') return true;
      
      return false;
    }

    // All other templates: show all questions
    return true;
  };

  const getEffectiveRequired = (question) => {
    // Universal Enterprise Onboarding preset-based requirements
    if (isUniversalTemplate && presetKey && question.preset_required) {
      return question.preset_required[presetKey] !== undefined 
        ? question.preset_required[presetKey]
        : question.required;
    }

    // Universal Finance Deal Pre-Qual mode-based requirements
    if (isFinanceTemplate) {
      const selectedMode = responses['mode'];
      if (!selectedMode) return question.required;
      
      // Check preset_required for mode-specific questions
      if (question.preset_required) {
        const modeKey = selectedMode === 'Investor Fit' ? 'investor_fit' 
                      : selectedMode === 'M&A Fit' ? 'm_and_a_fit'
                      : selectedMode === 'Lending Fit' ? 'lending_fit'
                      : null;
        if (modeKey && question.preset_required[modeKey] !== undefined) {
          return question.preset_required[modeKey];
        }
      }
    }

    // Universal Profile Matching mode-based requirements
    if (isProfileMatchingTemplate) {
      const selectedMode = responses['mode'];
      if (!selectedMode) return question.required;
      
      // Check preset_required for mode-specific questions
      if (question.preset_required) {
        const modeKey = selectedMode === 'Job Fit' ? 'job_fit'
                      : selectedMode === 'Beta Access Fit' ? 'beta_access_fit'
                      : selectedMode === 'Program/Accelerator Fit' ? 'program_fit'
                      : selectedMode === 'Grant/Scholarship Fit' ? 'grant_fit'
                      : null;
        if (modeKey && question.preset_required[modeKey] !== undefined) {
          return question.preset_required[modeKey];
        }
      }
    }

    return question.required;
  };

  const partyAQuestions = selectedTemplate?.questions?.filter(q => {
    const normalized = getNormalizedParty(q);
    return (normalized === 'a' || normalized === 'both') && shouldIncludeQuestion(q);
  }) || [];
  
  const partyBQuestions = selectedTemplate?.questions?.filter(q => {
    const normalized = getNormalizedParty(q);
    return (normalized === 'b' || normalized === 'both') && shouldIncludeQuestion(q);
  }) || [];

  const isValueEmpty = (question, value) => {
    if (value === null || value === undefined || value === '') return true;
    if (question.field_type === 'multi_select') {
      return !Array.isArray(value) || value.length === 0;
    }
    if (question.field_type === 'boolean' || question.field_type === 'select') {
      return value === '' || value === null || value === undefined;
    }
    if (question.field_type === 'file' || question.field_type === 'url') {
      return value === '' || value === null;
    }
    return false;
  };

  const isConditionallyRequired = (question) => {
    if (question.evidence_requirement !== 'conditional') return false;
    if (question.id === 'soc2_iso_evidence') {
      const soc2 = responses['soc2_status'];
      const iso = responses['iso27001'];
      return soc2 === 'Type I' || soc2 === 'Type II' || iso === 'Certified';
    }
    if (question.id === 'pentest_summary') {
      const freq = responses['pentest_freq'];
      return freq === 'Annual' || freq === 'Biannual';
    }
    return false;
  };

  const validateCurrentStep = () => {
    const errors = {};
    let questionsToValidate = [];
    
    if (step === 2) {
      questionsToValidate = partyAQuestions;
    } else if (step === 3) {
      questionsToValidate = partyBQuestions;
    }
    
    questionsToValidate.forEach(question => {
      const effectiveRequired = getEffectiveRequired(question);
      const isRequired = effectiveRequired || isConditionallyRequired(question);
      const value = responses[question.id];
      
      if (isRequired && isValueEmpty(question, value)) {
        errors[question.id] = 'This field is required';
      }
    });
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateAll = () => {
    const errors = {};
    const allQuestions = [...partyAQuestions, ...partyBQuestions];
    
    allQuestions.forEach(question => {
      const effectiveRequired = getEffectiveRequired(question);
      const isRequired = effectiveRequired || isConditionallyRequired(question);
      const value = responses[question.id];
      
      if (isRequired && isValueEmpty(question, value)) {
        errors[question.id] = 'This field is required';
      }
    });
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleNext = () => {
    if (step === 2 || step === 3) {
      if (!validateCurrentStep()) {
        return;
      }
    }
    setValidationErrors({});
    setStep(step + 1);
  };

  const sendProposalMutation = useMutation({
    mutationFn: async (guestEmailParam) => {
      if (!isGuestMode && user) {
        const limitCheck = await base44.functions.invoke('checkProposalLimit');
        if (!limitCheck.data.allowed) {
          throw new Error(`You've reached your monthly proposal limit (${limitCheck.data.limit} proposals). Upgrade to Professional for unlimited proposals.`);
        }
      }

      const proposalData = {
        title: proposalTitle || `${selectedTemplate.name} Proposal`,
        template_id: selectedTemplate.id,
        template_name: selectedTemplate.name,
        status: 'sent',
        party_a_user_id: user?.id || 'guest',
        party_a_email: isGuestMode ? guestEmailParam : user?.email,
        party_b_email: recipientEmail,
        disclosure_mode: responses['disclosure_mode'] || 'open',
        sent_at: new Date().toISOString(),
        include_profile: responses['_include_profile'] || false,
        include_organisation: responses['_include_organisation'] || false
      };

      if (isUniversalTemplate && presetKey) {
        proposalData.preset_key = presetKey;
        proposalData.enabled_modules = enabledModules;
      }

      let proposal;
      if (draftProposalId) {
        await base44.entities.Proposal.update(draftProposalId, proposalData);
        const proposals = await base44.entities.Proposal.filter({ id: draftProposalId });
        proposal = proposals[0];
      } else {
        proposal = await base44.entities.Proposal.create(proposalData);

        const responsePromises = Object.entries(responses).map(([questionId, value]) => {
          const question = selectedTemplate.questions.find(q => q.id === questionId);
          const visibility = visibilitySettings[questionId] || 'full';
          
          let responseData = {
            proposal_id: proposal.id,
            question_id: questionId,
            entered_by_party: 'a',
            is_about_counterparty: question?.is_about_counterparty || false,
            value: typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : Array.isArray(value) ? JSON.stringify(value) : String(value),
            visibility: visibility
          };

          if (typeof value === 'object' && value.type === 'range') {
            responseData.value_type = 'range';
            responseData.range_min = value.min;
            responseData.range_max = value.max;
          }

          return base44.entities.ProposalResponse.create(responseData);
        });

        await Promise.all(responsePromises);
      }

      if (isGuestMode && guestEmailParam) {
        const magicToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        await base44.entities.GuestProposal.create({
          guest_email: guestEmailParam,
          magic_token: magicToken,
          proposal_id: proposal.id,
          expires_at: expiresAt.toISOString()
        });

        await base44.integrations.Core.SendEmail({
          to: guestEmailParam,
          subject: 'Your PreMarket Proposal Link',
          body: `Hi there!\n\nYour proposal has been sent on PreMarket.\n\nAccess your proposal: ${window.location.origin}${createPageUrl(`ProposalDetail?id=${proposal.id}&token=${magicToken}`)}\n\nThis link will expire in 30 days.\n\nBest regards,\nThe PreMarket Team`
        });
      }

      return proposal;
    },
    onSuccess: (proposal) => {
      queryClient.invalidateQueries(['proposals']);
      navigate(createPageUrl(`ProposalDetail?id=${proposal.id}`));
    }
  });

  const handleResponseChange = (questionId, value) => {
    setResponses(prev => ({ ...prev, [questionId]: value }));
    if (validationErrors[questionId]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[questionId];
        return newErrors;
      });
    }
  };

  const handleVisibilityChange = (questionId, visibility) => {
    setVisibilitySettings(prev => ({ ...prev, [questionId]: visibility }));
  };

  const handleExtractFromUrl = async () => {
    if (!extractUrl) return;
    
    setExtracting(true);
    try {
      const result = await base44.functions.invoke('ExtractRequirementsFromUrl', {
        url: extractUrl,
        mode: responses['mode'],
        maxPages: 6
      });
      
      if (result.data.ok && result.data.inferred_fields) {
        setExtractedFields(result.data.inferred_fields.map(f => ({
          ...f,
          accepted: false,
          edited_value: f.suggested_value
        })));
        setShowReviewExtracted(true);
      } else {
        alert(result.data.error || 'Failed to extract requirements');
      }
    } catch (error) {
      alert('Extraction failed: ' + error.message);
    } finally {
      setExtracting(false);
    }
  };

  const handleApplyExtracted = () => {
    const accepted = extractedFields.filter(f => f.accepted);
    
    accepted.forEach(field => {
      // Find matching question by label
      const question = partyBQuestions.find(q => 
        q.label.toLowerCase() === field.question_label.toLowerCase() ||
        q.label.toLowerCase().includes(field.question_label.toLowerCase()) ||
        field.question_label.toLowerCase().includes(q.label.toLowerCase())
      );
      
      if (question) {
        handleResponseChange(question.id, field.edited_value);
        if (question.supports_visibility) {
          handleVisibilityChange(question.id, 'partial');
        }
      }
    });
    
    setShowReviewExtracted(false);
    setExtractedFields([]);
    setExtractUrl('');
  };

  const renderQuestionInput = (question) => {
    const value = responses[question.id] || '';
    const visibility = visibilitySettings[question.id] || question.visibility_default || 'full';
    const hasError = validationErrors[question.id];
    const isConditionalReq = isConditionallyRequired(question);
    const effectiveRequired = getEffectiveRequired(question);

    return (
      <div key={question.id} className="space-y-2 p-4 bg-white border rounded-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <Label className="text-sm font-medium text-slate-900">
              {question.label}
              {(effectiveRequired || isConditionalReq) && <span className="text-red-500 ml-1">*</span>}
            </Label>
            {question.description && (
              <p className="text-sm text-slate-600 mt-1">{question.description}</p>
            )}
          </div>
          <Select 
            value={visibility}
            onValueChange={(v) => handleVisibilityChange(question.id, v)}
          >
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full">
                <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> Full</span>
              </SelectItem>
              <SelectItem value="partial">
                <span className="flex items-center gap-1"><EyeOff className="w-3 h-3" /> Partial</span>
              </SelectItem>
              <SelectItem value="hidden">
                <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Hidden</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          {question.field_type === 'select' ? (
            question.allowed_values && question.allowed_values.length > 0 ? (
              <Select 
                value={value}
                onValueChange={(v) => handleResponseChange(question.id, v)}
              >
                <SelectTrigger className={hasError ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {question.allowed_values.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input 
                type="text"
                value={value}
                onChange={(e) => handleResponseChange(question.id, e.target.value)}
                placeholder="Enter value..."
                className={hasError ? 'border-red-500' : ''}
              />
            )
          ) : question.field_type === 'multi_select' ? (
            <div className="space-y-2">
              {question.allowed_values?.map(opt => (
                <div key={opt} className="flex items-center space-x-2">
                  <Checkbox 
                    id={`${question.id}-${opt}`}
                    checked={(value || []).includes(opt)}
                    onCheckedChange={(checked) => {
                      const current = value || [];
                      const newValue = checked 
                        ? [...current, opt]
                        : current.filter(v => v !== opt);
                      handleResponseChange(question.id, newValue);
                    }}
                  />
                  <label htmlFor={`${question.id}-${opt}`} className="text-sm">{opt}</label>
                </div>
              ))}
            </div>
          ) : question.field_type === 'boolean' ? (
            <RadioGroup value={value} onValueChange={(v) => handleResponseChange(question.id, v)}>
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
              onChange={(e) => handleResponseChange(question.id, e.target.value)}
              placeholder={`Enter ${question.label.toLowerCase()}...`}
              className={`min-h-[100px] ${hasError ? 'border-red-500' : ''}`}
            />
          ) : question.field_type === 'url' ? (
            <Input 
              type="url"
              value={value}
              onChange={(e) => handleResponseChange(question.id, e.target.value)}
              placeholder="https://..."
              className={hasError ? 'border-red-500' : ''}
            />
          ) : question.field_type === 'file' ? (
            <Input 
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleResponseChange(question.id, file.name);
                }
              }}
              className={hasError ? 'border-red-500' : ''}
            />
          ) : (
            <Input 
              type={question.field_type === 'number' ? 'number' : 'text'}
              value={value}
              onChange={(e) => handleResponseChange(question.id, e.target.value)}
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

  const progress = (step / totalSteps) * 100;

  const hasValidationErrors = Object.keys(validationErrors).length > 0;

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
            {autoSaving && (
              <Badge variant="outline" className="text-blue-600">
                <Save className="w-3 h-3 mr-1 animate-pulse" />
                Auto-saving...
              </Badge>
            )}
          </div>
        </div>

        <div className="mb-8">
          <div className="flex items-center justify-between text-sm text-slate-500 mb-2">
            <span>Step {step} of {totalSteps}</span>
            <span>{Math.round(progress)}% complete</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        <AnimatePresence mode="wait">
          {/* Step 1: Select Template */}
          {step === 1 && !selectedTemplate && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle>Select Template</CardTitle>
                  <CardDescription>Choose a template that matches your pre-qualification needs.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {allTemplates.map(template => {
                      const Icon = iconMap[template.category] || FileText;
                      return (
                        <button
                          key={template.id}
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

                  <div className="flex justify-end mt-6">
                    <Button 
                      onClick={() => setStep(2)}
                      disabled={!selectedTemplate}
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

          {/* Step 1: Proposal Details */}
          {step === 1 && selectedTemplate && (
            <motion.div
              key="step1-details"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
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
                      onChange={(e) => setProposalTitle(e.target.value)}
                      placeholder={`${selectedTemplate?.name} Proposal`}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Recipient Email (Optional)</Label>
                    <Input 
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="recipient@example.com"
                    />
                    <p className="text-xs text-slate-500">
                      Optional: You can send this later from the Drafts tab.
                    </p>
                  </div>

                  {user && (
                    <div className="space-y-3 p-4 border border-slate-200 bg-slate-50 rounded-xl">
                      <Label className="text-sm font-semibold text-slate-900">
                        Additional Context for AI Evaluation
                      </Label>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-slate-700">Include my Profile</p>
                            <p className="text-xs text-slate-500">Use your profile information in the AI assessment</p>
                          </div>
                          <Switch 
                            checked={responses['_include_profile'] || false}
                            onCheckedChange={(checked) => handleResponseChange('_include_profile', checked)}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-slate-700">Include my Organisation</p>
                            <p className="text-xs text-slate-500">Use your organisation details in the AI assessment</p>
                          </div>
                          <Switch 
                            checked={responses['_include_organisation'] || false}
                            onCheckedChange={(checked) => handleResponseChange('_include_organisation', checked)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {isUniversalTemplate && (
                   <div className="space-y-3 p-4 border-2 border-blue-200 bg-blue-50 rounded-xl">
                     <Label className="text-sm font-semibold text-blue-900">
                       Onboarding Type *
                     </Label>
                     <RadioGroup value={presetKey} onValueChange={(value) => {
                       setPresetKey(value);
                       setEnabledModules(getModulesForPreset(value));
                     }}>
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
                      <Label className="text-sm font-semibold text-emerald-900">
                        Deal Mode *
                      </Label>
                      <RadioGroup value={responses['mode']} onValueChange={(value) => handleResponseChange('mode', value)}>
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
                      <Label className="text-sm font-semibold text-purple-900">
                        Matching Mode *
                      </Label>
                      <RadioGroup value={responses['mode']} onValueChange={(value) => handleResponseChange('mode', value)}>
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Job Fit" id="mode-job" />
                            <Label htmlFor="mode-job" className="font-normal cursor-pointer">
                              Job Fit
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Beta Access Fit" id="mode-beta" />
                            <Label htmlFor="mode-beta" className="font-normal cursor-pointer">
                              Beta Access Fit
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Program/Accelerator Fit" id="mode-program" />
                            <Label htmlFor="mode-program" className="font-normal cursor-pointer">
                              Program/Accelerator Fit
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="Grant/Scholarship Fit" id="mode-grant" />
                            <Label htmlFor="mode-grant" className="font-normal cursor-pointer">
                              Grant/Scholarship Fit
                            </Label>
                          </div>
                        </div>
                      </RadioGroup>
                      <p className="text-xs text-purple-700 mt-2">
                        This determines which questions you'll see in the next steps.
                      </p>
                    </div>
                  )}

                  <div className="flex justify-end mt-6">
                    <Button 
                      onClick={() => setStep(2)}
                      disabled={(isUniversalTemplate && !presetKey) || (isFinanceTemplate && !responses['mode']) || (isProfileMatchingTemplate && !responses['mode'])}
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

          {/* Step 2: Your Information */}
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
                      <AlertDescription>
                        Please complete all required fields before continuing.
                      </AlertDescription>
                    </Alert>
                  )}
                  
                  {partyAQuestions.map(renderQuestionInput)}
                  {partyAQuestions.length === 0 && (
                    <p className="text-slate-500 text-center py-4">No questions for this section.</p>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-between mt-6">
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button 
                  onClick={handleNext}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Continue
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step 3: Counterparty Information */}
          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              {/* URL Extraction (Profile Matching only) */}
              {isProfileMatchingTemplate && !showReviewExtracted && (
                <Card className="border-0 shadow-sm mb-6 bg-gradient-to-br from-purple-50 to-blue-50">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <LinkIcon className="w-5 h-5 text-purple-600" />
                      Auto-build Requirements from URL (Optional)
                    </CardTitle>
                    <CardDescription>
                      Extract requirements from a job posting, company page, GitHub repo, or program page
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2">
                      <Input 
                        placeholder="https://..."
                        value={extractUrl}
                        onChange={(e) => setExtractUrl(e.target.value)}
                        className="flex-1"
                      />
                      <Button 
                        onClick={handleExtractFromUrl}
                        disabled={!extractUrl || extracting}
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        {extracting ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Extracting...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4 mr-2" />
                            Extract
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Review Extracted Fields */}
              {isProfileMatchingTemplate && showReviewExtracted && (
                <Card className="border-0 shadow-sm mb-6">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">Review Extracted Requirements</CardTitle>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => {
                          setShowReviewExtracted(false);
                          setExtractedFields([]);
                        }}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <CardDescription>
                      Accept, edit, or remove AI-extracted fields
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {extractedFields.map((field, idx) => (
                      <div key={idx} className="p-3 border rounded-lg bg-white">
                        <div className="flex items-start gap-3">
                          <Checkbox 
                            checked={field.accepted}
                            onCheckedChange={(checked) => {
                              setExtractedFields(prev => prev.map((f, i) => 
                                i === idx ? {...f, accepted: checked} : f
                              ));
                            }}
                            className="mt-1"
                          />
                          <div className="flex-1 space-y-2">
                            <div>
                              <Label className="text-sm font-medium">{field.question_label}</Label>
                              <Badge className="ml-2 text-xs" variant="outline">
                                {Math.round(field.confidence * 100)}% confidence
                              </Badge>
                            </div>
                            <Input 
                              value={field.edited_value}
                              onChange={(e) => {
                                setExtractedFields(prev => prev.map((f, i) => 
                                  i === idx ? {...f, edited_value: e.target.value} : f
                                ));
                              }}
                              className="text-sm"
                            />
                            {field.source_excerpt && (
                              <p className="text-xs text-slate-500 italic">
                                Source: "{field.source_excerpt.substring(0, 100)}..."
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    
                    <div className="flex justify-end gap-2 mt-4">
                      <Button 
                        variant="outline"
                        onClick={() => {
                          setShowReviewExtracted(false);
                          setExtractedFields([]);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button 
                        onClick={handleApplyExtracted}
                        disabled={!extractedFields.some(f => f.accepted)}
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        <Check className="w-4 h-4 mr-2" />
                        Apply Selected ({extractedFields.filter(f => f.accepted).length})
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

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
                      <AlertDescription>
                        Please complete all required fields before continuing.
                      </AlertDescription>
                    </Alert>
                  )}
                  
                  {partyBQuestions.map(renderQuestionInput)}
                  {partyBQuestions.length === 0 && (
                    <p className="text-slate-500 text-center py-4">No questions for this section.</p>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-between mt-6">
                <Button variant="outline" onClick={() => { setValidationErrors({}); setStep(2); }}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button 
                  onClick={handleNext}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Review
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step 4: Review & Submit */}
          {step === 4 && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              {isGuestMode && <GuestProposalBanner />}
              
              {isGuestMode && !guestEmail ? (
                <GuestEmailCapture 
                  onEmailSubmit={(email) => {
                    setGuestEmail(email);
                    sendProposalMutation.mutate(email);
                  }}
                  isSubmitting={sendProposalMutation.isPending}
                />
              ) : (
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
                        <span className="font-medium">{Object.keys(responses).length} / {selectedTemplate?.questions?.length || 0}</span>
                      </div>
                    </div>

                    <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                      <div className="flex items-start gap-3">
                        <Sparkles className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-blue-900">AI Evaluation</p>
                          <p className="text-sm text-blue-700 mt-1">
                            After submission, AI will generate a compatibility score, identify red flags, 
                            and provide recommendations based on the information provided.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between">
                      <Button variant="outline" onClick={() => setStep(3)}>
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back
                      </Button>
                      {recipientEmail ? (
                        <Button 
                          onClick={() => {
                            if (!validateAll()) {
                              setStep(2);
                              return;
                            }
                            sendProposalMutation.mutate(guestEmail);
                          }}
                          disabled={sendProposalMutation.isPending || (isGuestMode && !guestEmail)}
                          className="bg-blue-600 hover:bg-blue-700"
                        >
                          {sendProposalMutation.isPending ? (
                            'Sending...'
                          ) : (
                            <>
                              <Send className="w-4 h-4 mr-2" />
                              Send Proposal
                            </>
                          )}
                        </Button>
                      ) : (
                        <Button 
                          onClick={() => navigate(createPageUrl('Proposals'))}
                          variant="outline"
                        >
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Go to Drafts
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}