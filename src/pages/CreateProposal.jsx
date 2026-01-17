import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation } from '@tanstack/react-query';
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
import {
  ArrowLeft, ArrowRight, FileText, User, Eye, EyeOff, Lock,
  Building2, Users, TrendingUp, Handshake, Briefcase, CheckCircle2,
  Send, Sparkles, AlertTriangle, XCircle
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

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: async () => {
      const all = await base44.entities.Template.list();
      const visible = all.filter(t => t.status === 'published' || t.status === 'active');
      
      // For Universal template, always get the most recently updated one
      const byKey = visible.reduce((acc, t) => {
        const key = t.template_key || t.slug;
        if (!acc[key]) {
          acc[key] = t;
        } else if (key === 'universal_enterprise_onboarding') {
          // For universal, pick the one with most recent update
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
    setIsGuestMode(isGuest);
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

  const totalSteps = hasTemplatePreselected ? 4 : 5;

  const allTemplates = templates;

  // Check if template is Universal Enterprise Onboarding
  const isUniversalTemplate = selectedTemplate?.slug === 'universal_enterprise_onboarding' || 
                               selectedTemplate?.template_key === 'universal_enterprise_onboarding' ||
                               selectedTemplate?.name === 'Universal Enterprise Onboarding';

  // Preset to modules mapping
  const getModulesForPreset = (preset) => {
    const baseModules = ['org_profile', 'security_compliance', 'privacy_data_handling', 'operations_sla', 'implementation_it', 'legal_commercial', 'references'];
    if (preset === 'api_data_provider') {
      return [...baseModules, 'api_data'];
    }
    return baseModules;
  };

  // Normalize question party for backward compatibility
  const getNormalizedParty = (question) => {
    if (question.party) {
      return question.party;
    }
    if (question.is_about_counterparty === true) {
      return 'b';
    }
    if (question.applies_to_role === 'proposer') {
      return 'a';
    }
    if (question.applies_to_role === 'recipient') {
      return 'b';
    }
    if (question.applies_to_role === 'both') {
      return 'both';
    }
    return 'a';
  };

  // Check if question should be included based on modules
  const shouldIncludeQuestion = (question) => {
    // Non-universal templates: include all questions
    if (!isUniversalTemplate) {
      return true;
    }
    
    // Universal template but no preset selected yet: exclude all
    if (!presetKey || enabledModules.length === 0) {
      return false;
    }
    
    // Question has module_key: MUST be in enabled modules
    if (question.module_key) {
      const included = enabledModules.includes(question.module_key);
      console.log(`[Filter] Question "${question.label}" (${question.id}) - module: ${question.module_key} - included: ${included}`);
      return included;
    }
    
    // Question missing module_key: EXCLUDE (should not happen after auto-tag)
    console.warn(`[Filter] Question "${question.label}" (${question.id}) has NO module_key - EXCLUDING`);
    return false;
  };

  // Get effective required flag based on preset
  const getEffectiveRequired = (question) => {
    if (isUniversalTemplate && presetKey && question.preset_required) {
      return question.preset_required[presetKey] !== undefined 
        ? question.preset_required[presetKey]
        : question.required;
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

  // Diagnostics for Universal Template
  if (isUniversalTemplate && selectedTemplate) {
    const moduleStats = {};
    selectedTemplate.questions?.forEach(q => {
      const key = q.module_key || 'NO_MODULE_KEY';
      moduleStats[key] = (moduleStats[key] || 0) + 1;
    });
    console.log('=== UNIVERSAL TEMPLATE DEBUG ===');
    console.log('Selected Preset:', presetKey);
    console.log('Enabled Modules:', enabledModules);
    console.log('Total Questions:', selectedTemplate.questions?.length || 0);
    console.log('Questions by Module:', moduleStats);
    console.log('Filtered Party A Questions:', partyAQuestions.length);
    console.log('Filtered Party B Questions:', partyBQuestions.length);
    console.log('=================================');
  }

  // Check if value is empty based on field type
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

  // Check if question is conditionally required
  const isConditionallyRequired = (question) => {
    if (question.evidence_requirement !== 'conditional') return false;
    
    // SOC2/ISO evidence required if Type I/II or Certified
    if (question.id === 'soc2_iso_evidence') {
      const soc2 = responses['soc2_status'];
      const iso = responses['iso27001'];
      return soc2 === 'Type I' || soc2 === 'Type II' || iso === 'Certified';
    }
    
    // Pen test summary required if Annual/Biannual
    if (question.id === 'pentest_summary') {
      const freq = responses['pentest_freq'];
      return freq === 'Annual' || freq === 'Biannual';
    }
    
    return false;
  };

  // Validate questions for current step
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

  // Validate all for final submit
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

  const createProposalMutation = useMutation({
    mutationFn: async (guestEmailParam) => {
      const proposalData = {
        title: proposalTitle || `${selectedTemplate.name} Proposal`,
        template_id: selectedTemplate.id,
        template_name: selectedTemplate.name,
        status: recipientEmail ? 'sent' : 'draft',
        party_a_user_id: user?.id || 'guest',
        party_a_email: isGuestMode ? guestEmailParam : user?.email,
        party_b_email: recipientEmail || null,
        disclosure_mode: responses['disclosure_mode'] || 'open',
        sent_at: recipientEmail ? new Date().toISOString() : null
      };

      // Add preset fields if Universal Enterprise Onboarding
      if (isUniversalTemplate && presetKey) {
        proposalData.preset_key = presetKey;
        proposalData.enabled_modules = enabledModules;
      }

      const proposal = await base44.entities.Proposal.create(proposalData);

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
          body: `Hi there!\n\nYour proposal has been created on PreMarket.\n\nAccess your proposal: ${window.location.origin}${createPageUrl(`ProposalDetail?id=${proposal.id}&token=${magicToken}`)}\n\nThis link will expire in 30 days.\n\nBest regards,\nThe PreMarket Team`
        });
      }

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
      return proposal;
    },
    onSuccess: (proposal) => {
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

  const renderQuestionInput = (question) => {
    const value = responses[question.id] || '';
    const visibility = visibilitySettings[question.id] || 'full';
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
          {question.supports_visibility && (
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
          )}
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
              <>
                <Input 
                  type="text"
                  value={value}
                  onChange={(e) => handleResponseChange(question.id, e.target.value)}
                  placeholder="Enter value..."
                  className={hasError ? 'border-red-500' : ''}
                />
                {process.env.NODE_ENV === 'development' && (
                  <Badge variant="outline" className="text-xs text-amber-600">
                    Missing options in template
                  </Badge>
                )}
              </>
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
          {user && (
            <Link to={createPageUrl('Dashboard')} className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Link>
          )}
          <h1 className="text-2xl font-bold text-slate-900">Create Proposal</h1>
          <p className="text-slate-500 mt-1">Fill out the template to create a pre-qualification proposal.</p>
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
                    <Label>Recipient Email (optional)</Label>
                    <Input 
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      placeholder="recipient@example.com"
                    />
                    <p className="text-xs text-slate-500">
                      Leave empty to save as draft. The recipient will receive an email invitation.
                    </p>
                  </div>

                  {/* Universal Enterprise Onboarding Preset Selector */}
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

                  <div className="flex justify-end mt-6">
                    <Button 
                      onClick={() => setStep(2)}
                      disabled={isUniversalTemplate && !presetKey}
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
                    createProposalMutation.mutate(email);
                  }}
                  isSubmitting={createProposalMutation.isPending}
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
                        <span className="font-medium">{recipientEmail || 'Draft (no recipient)'}</span>
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
                      <Button 
                        onClick={() => {
                          if (recipientEmail && !validateAll()) {
                            setStep(2);
                            return;
                          }
                          createProposalMutation.mutate(guestEmail);
                        }}
                        disabled={createProposalMutation.isPending || (isGuestMode && !guestEmail)}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        {createProposalMutation.isPending ? (
                          'Creating...'
                        ) : recipientEmail ? (
                          <>
                            <Send className="w-4 h-4 mr-2" />
                            Send Proposal
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                            Save Draft
                          </>
                        )}
                      </Button>
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