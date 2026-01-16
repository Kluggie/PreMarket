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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Progress } from '@/components/ui/progress';
import {
  ArrowLeft, ArrowRight, FileText, User, Eye, EyeOff, Lock,
  Building2, Users, TrendingUp, Handshake, Briefcase, CheckCircle2,
  Send, Sparkles, AlertTriangle
} from 'lucide-react';

const iconMap = {
  m_and_a: Building2,
  recruiting: Users,
  investment: TrendingUp,
  partnership: Handshake,
  consulting: Briefcase,
  custom: FileText
};

// Default templates with questions
const defaultTemplates = [
  {
    id: 'ma-default',
    name: 'M&A Pre-Qualification',
    slug: 'm-and-a',
    description: 'Evaluate potential acquisition targets or acquirers.',
    category: 'm_and_a',
    status: 'published',
    party_a_label: 'Acquirer',
    party_b_label: 'Target Company',
    questions: [
      { id: 'company_name', section: 'Company Info', party: 'b', label: 'Company Name', field_type: 'text', required: true, supports_visibility: true },
      { id: 'industry', section: 'Company Info', party: 'b', label: 'Industry', field_type: 'text', required: true },
      { id: 'revenue', section: 'Financials', party: 'b', label: 'Annual Revenue', field_type: 'currency', required: true, supports_range: true },
      { id: 'employees', section: 'Company Info', party: 'b', label: 'Number of Employees', field_type: 'number', supports_range: true },
      { id: 'deal_size', section: 'Deal Terms', party: 'a', label: 'Target Deal Size', field_type: 'currency', required: true, supports_range: true },
      { id: 'timeline', section: 'Deal Terms', party: 'a', label: 'Desired Timeline', field_type: 'select', options: ['< 3 months', '3-6 months', '6-12 months', '12+ months'] },
      { id: 'strategic_rationale', section: 'Strategy', party: 'a', label: 'Strategic Rationale', field_type: 'text', required: true }
    ],
    evaluation_criteria: [
      { name: 'Financial Fit', weight: 30 },
      { name: 'Strategic Alignment', weight: 25 },
      { name: 'Market Position', weight: 20 },
      { name: 'Deal Terms Compatibility', weight: 25 }
    ]
  },
  {
    id: 'recruiting-default',
    name: 'Executive Recruiting',
    slug: 'recruiting',
    description: 'Pre-qualify candidates for executive positions.',
    category: 'recruiting',
    status: 'published',
    party_a_label: 'Employer',
    party_b_label: 'Candidate',
    questions: [
      { id: 'role_title', section: 'Position', party: 'a', label: 'Role Title', field_type: 'text', required: true },
      { id: 'experience_years', section: 'Requirements', party: 'b', label: 'Years of Experience', field_type: 'number', required: true, supports_range: true },
      { id: 'current_title', section: 'Background', party: 'b', label: 'Current Title', field_type: 'text', required: true },
      { id: 'compensation', section: 'Compensation', party: 'both', label: 'Compensation Expectation', field_type: 'currency', supports_range: true },
      { id: 'location_pref', section: 'Logistics', party: 'b', label: 'Location Preference', field_type: 'text' },
      { id: 'remote_preference', section: 'Logistics', party: 'both', label: 'Remote Work Preference', field_type: 'select', options: ['Fully Remote', 'Hybrid', 'On-site', 'Flexible'] }
    ],
    evaluation_criteria: [
      { name: 'Experience Match', weight: 30 },
      { name: 'Compensation Alignment', weight: 25 },
      { name: 'Location/Logistics Fit', weight: 20 },
      { name: 'Cultural Fit Indicators', weight: 25 }
    ]
  },
  {
    id: 'investment-default',
    name: 'Investor Matching',
    slug: 'investment',
    description: 'Connect startups with potential investors.',
    category: 'investment',
    status: 'published',
    party_a_label: 'Startup',
    party_b_label: 'Investor',
    questions: [
      { id: 'startup_name', section: 'Company', party: 'a', label: 'Startup Name', field_type: 'text', required: true },
      { id: 'stage', section: 'Company', party: 'a', label: 'Current Stage', field_type: 'select', options: ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C+'], required: true },
      { id: 'raise_amount', section: 'Funding', party: 'a', label: 'Raise Amount', field_type: 'currency', required: true, supports_range: true },
      { id: 'check_size', section: 'Investment', party: 'b', label: 'Typical Check Size', field_type: 'currency', supports_range: true },
      { id: 'sector_focus', section: 'Focus', party: 'b', label: 'Sector Focus', field_type: 'text' },
      { id: 'traction', section: 'Metrics', party: 'a', label: 'Key Traction Metrics', field_type: 'text' }
    ],
    evaluation_criteria: [
      { name: 'Stage Fit', weight: 25 },
      { name: 'Check Size Match', weight: 25 },
      { name: 'Sector Alignment', weight: 25 },
      { name: 'Traction/Growth', weight: 25 }
    ]
  }
];

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
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [guestEmail, setGuestEmail] = useState('');

  const { data: templates = [] } = useQuery({
    queryKey: ['templates'],
    queryFn: () => base44.entities.Template.filter({ status: 'published' })
  });

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => setUser(null));
  }, []);

  // Check for guest mode in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isGuest = params.get('guest') === 'true';
    setIsGuestMode(isGuest);
  }, []);

  // Check for template in URL params and auto-skip to step 2
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const templateId = params.get('template');
    
    if (templateId && !selectedTemplate) {
      // Merge DB templates with default templates
      const allTemplates = [...(templates || []), ...defaultTemplates];
      const template = allTemplates.find(t => t.id === templateId);
      
      if (template) {
        setSelectedTemplate(template);
        setHasTemplatePreselected(true);
        setStep(1); // Start at step 1 (Recipient & Title)
      }
    }
  }, [templates, selectedTemplate]);

  // Adjust step calculation based on whether template is preselected
  const actualStep = hasTemplatePreselected ? step : step;
  const totalSteps = hasTemplatePreselected ? 3 : 4;

  const displayTemplates = templates.length > 0 ? templates : defaultTemplates.filter(t => t.status === 'active');

  const createProposalMutation = useMutation({
    mutationFn: async (guestEmailParam) => {
      // Create proposal
      const proposal = await base44.entities.Proposal.create({
        title: proposalTitle || `${selectedTemplate.name} Proposal`,
        template_id: selectedTemplate.id,
        template_name: selectedTemplate.name,
        status: recipientEmail ? 'sent' : 'draft',
        party_a_user_id: user?.id || 'guest',
        party_a_email: isGuestMode ? guestEmailParam : user?.email,
        party_b_email: recipientEmail || null,
        reveal_level_a: 1,
        sent_at: recipientEmail ? new Date().toISOString() : null
      });

      // If guest mode, create guest proposal record
      if (isGuestMode && guestEmailParam) {
        const magicToken = Math.random().toString(36).substring(2) + Date.now().toString(36);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30); // 30 days expiry

        await base44.entities.GuestProposal.create({
          guest_email: guestEmailParam,
          magic_token: magicToken,
          proposal_id: proposal.id,
          expires_at: expiresAt.toISOString()
        });

        // Send magic link email
        await base44.integrations.Core.SendEmail({
          to: guestEmailParam,
          subject: 'Your PreMarket Proposal Link',
          body: `Hi there!\n\nYour proposal has been created on PreMarket.\n\nAccess your proposal: ${window.location.origin}${createPageUrl(`ProposalDetail?id=${proposal.id}&token=${magicToken}`)}\n\nThis link will expire in 30 days.\n\nBest regards,\nThe PreMarket Team`
        });
      }

      // Create responses
      const responsePromises = Object.entries(responses).map(([questionId, value]) => {
        const question = selectedTemplate.questions.find(q => q.id === questionId);
        const visibility = visibilitySettings[questionId] || 'full';
        
        let responseData = {
          proposal_id: proposal.id,
          question_id: questionId,
          party: question?.party === 'b' ? 'a' : 'a', // Party A is filling info about Party B initially
          value: typeof value === 'object' ? JSON.stringify(value) : String(value),
          visibility: visibility,
          reveal_at_gate: visibility === 'hidden' ? 3 : visibility === 'partial' ? 2 : 1
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
  };

  const handleVisibilityChange = (questionId, visibility) => {
    setVisibilitySettings(prev => ({ ...prev, [questionId]: visibility }));
  };

  const partyAQuestions = selectedTemplate?.questions?.filter(q => q.party === 'a' || q.party === 'both') || [];
  const partyBQuestions = selectedTemplate?.questions?.filter(q => q.party === 'b' || q.party === 'both') || [];

  const renderQuestionInput = (question) => {
    const value = responses[question.id] || '';
    const visibility = visibilitySettings[question.id] || 'full';

    return (
      <div key={question.id} className="space-y-3 p-4 bg-slate-50 rounded-xl">
        <div className="flex items-start justify-between">
          <div>
            <Label className="text-sm font-medium">
              {question.label}
              {question.required && <span className="text-red-500 ml-1">*</span>}
            </Label>
            {question.description && (
              <p className="text-xs text-slate-500 mt-1">{question.description}</p>
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

        {question.field_type === 'select' ? (
          <Select 
            value={value}
            onValueChange={(v) => handleResponseChange(question.id, v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {question.options?.map(opt => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : question.field_type === 'currency' && question.supports_range ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input 
                type="number"
                placeholder="Min"
                value={typeof value === 'object' ? value.min : ''}
                onChange={(e) => handleResponseChange(question.id, {
                  type: 'range',
                  min: Number(e.target.value),
                  max: typeof value === 'object' ? value.max : 0
                })}
                className="flex-1"
              />
              <span className="text-slate-400">to</span>
              <Input 
                type="number"
                placeholder="Max"
                value={typeof value === 'object' ? value.max : ''}
                onChange={(e) => handleResponseChange(question.id, {
                  type: 'range',
                  min: typeof value === 'object' ? value.min : 0,
                  max: Number(e.target.value)
                })}
                className="flex-1"
              />
            </div>
            <p className="text-xs text-slate-500">Enter a range or single value</p>
          </div>
        ) : question.field_type === 'number' && question.supports_range ? (
          <div className="flex items-center gap-2">
            <Input 
              type="number"
              placeholder="Min"
              value={typeof value === 'object' ? value.min : value}
              onChange={(e) => handleResponseChange(question.id, {
                type: 'range',
                min: Number(e.target.value),
                max: typeof value === 'object' ? value.max : 0
              })}
            />
            <span className="text-slate-400">to</span>
            <Input 
              type="number"
              placeholder="Max"
              value={typeof value === 'object' ? value.max : ''}
              onChange={(e) => handleResponseChange(question.id, {
                type: 'range',
                min: typeof value === 'object' ? value.min : 0,
                max: Number(e.target.value)
              })}
            />
          </div>
        ) : (
          <Input 
            type={question.field_type === 'number' || question.field_type === 'currency' ? 'number' : 'text'}
            value={value}
            onChange={(e) => handleResponseChange(question.id, e.target.value)}
            placeholder={`Enter ${question.label.toLowerCase()}...`}
          />
        )}
      </div>
    );
  };

  const progress = (actualStep / totalSteps) * 100;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
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

        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm text-slate-500 mb-2">
            <span>Step {actualStep} of {totalSteps}</span>
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
                    {displayTemplates.map(template => {
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

          {/* Step 1: Recipient & Title */}
          {step === 1 && (
            <motion.div
              key="step2"
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

                  <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-amber-900">About Party B Information</p>
                        <p className="text-sm text-amber-700 mt-1">
                          As the proposer, you'll provide initial information about the recipient ({selectedTemplate?.party_b_label}).
                          They can verify, correct, or update this information when they receive the proposal.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end mt-6">
                    <Button 
                      onClick={() => setStep(2)}
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

          {/* Step 2: Fill Template */}
          {step === 2 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              {/* Your Info (Party A) */}
              <Card className="border-0 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5 text-blue-600" />
                    Your Information ({selectedTemplate?.party_a_label})
                  </CardTitle>
                  <CardDescription>Information about you or your organization.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {partyAQuestions.map(renderQuestionInput)}
                  {partyAQuestions.length === 0 && (
                    <p className="text-slate-500 text-center py-4">No questions for this section in this template.</p>
                  )}
                </CardContent>
              </Card>

              {/* Counterparty Info (Party B) */}
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
                  {partyBQuestions.map(renderQuestionInput)}
                  {partyBQuestions.length === 0 && (
                    <p className="text-slate-500 text-center py-4">No questions for this section in this template.</p>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
                <Button 
                  onClick={() => setStep(3)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Review
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* Step 3: Review & Submit */}
          {step === 3 && (
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
                  {/* Summary */}
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

                  {/* AI Evaluation Notice */}
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
                    <Button variant="outline" onClick={() => setStep(2)}>
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Back
                    </Button>
                    <Button 
                      onClick={() => createProposalMutation.mutate(guestEmail)}
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