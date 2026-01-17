import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft, Plus, Trash2, Eye, AlertTriangle, CheckCircle2,
  Save, Send, Wand2, XCircle, ChevronDown, ChevronUp
} from 'lucide-react';

export default function TemplateBuilder() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const templateId = searchParams.get('id');
  const queryClient = useQueryClient();

  const [template, setTemplate] = useState({
    name: '',
    slug: '',
    description: '',
    category: 'custom',
    status: 'hidden',
    party_a_label: 'Proposer',
    party_b_label: 'Recipient',
    sections: [],
    questions: []
  });

  const [editingQuestion, setEditingQuestion] = useState(null);
  const [showQuestionEditor, setShowQuestionEditor] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data: existingTemplate } = useQuery({
    queryKey: ['template', templateId],
    queryFn: async () => {
      if (!templateId) return null;
      const templates = await base44.entities.Template.list();
      return templates.find(t => t.id === templateId);
    },
    enabled: !!templateId
  });

  useEffect(() => {
    if (existingTemplate) {
      setTemplate(existingTemplate);
    }
  }, [existingTemplate]);

  const saveTemplateMutation = useMutation({
    mutationFn: async (data) => {
      if (templateId) {
        return await base44.entities.Template.update(templateId, data);
      }
      return await base44.entities.Template.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['template']);
      queryClient.invalidateQueries(['admin', 'templates']);
    }
  });

  // Validation functions
  const validateQuestion = (question) => {
    const errors = {};

    if (!question.label?.trim()) {
      errors.label = 'Label is required';
    }

    if (!question.field_type) {
      errors.field_type = 'Field type is required';
    }

    const needsOptions = ['select', 'radio', 'multi_select'].includes(question.field_type);
    if (needsOptions) {
      const options = question.allowed_values || [];
      if (options.length < 2) {
        errors.options = 'Options required (min 2, unique)';
      } else {
        const trimmed = options.map(o => o?.trim()).filter(Boolean);
        const unique = new Set(trimmed.map(o => o.toLowerCase()));
        if (trimmed.length !== unique.size) {
          errors.options = 'Options must be unique (case-insensitive)';
        }
        if (trimmed.some(o => !o)) {
          errors.options = 'Options cannot be empty';
        }
      }
    }

    return errors;
  };

  const validateTemplate = () => {
    const errors = [];
    
    if (!template.name?.trim()) {
      errors.push({ field: 'Template name', message: 'Template name is required' });
    }

    if (!template.questions || template.questions.length === 0) {
      errors.push({ field: 'Questions', message: 'Template must have at least one question' });
    }

    template.questions?.forEach((q, idx) => {
      const qErrors = validateQuestion(q);
      if (Object.keys(qErrors).length > 0) {
        errors.push({
          field: `Question ${idx + 1}: ${q.label || 'Untitled'}`,
          message: Object.values(qErrors).join(', ')
        });
      }
    });

    return errors;
  };

  const requiredCount = template.questions?.filter(q => q.required).length || 0;
  const selectCount = template.questions?.filter(q => 
    ['select', 'radio', 'multi_select'].includes(q.field_type)
  ).length || 0;

  const handleSaveDraft = async () => {
    await saveTemplateMutation.mutateAsync({
      ...template,
      status: 'hidden'
    });
  };

  const handlePublish = () => {
    const errors = validateTemplate();
    if (errors.length > 0) {
      setValidationErrors({ publish: errors });
      setShowPublishDialog(true);
      return;
    }
    setShowPublishDialog(true);
  };

  const confirmPublish = async () => {
    await saveTemplateMutation.mutateAsync({
      ...template,
      status: 'active'
    });
    setShowPublishDialog(false);
    navigate(createPageUrl('Admin'));
  };

  const handleAddQuestion = () => {
    setEditingQuestion({
      id: `q_${Date.now()}`,
      section_id: template.sections?.[0]?.id || 'default',
      page: 'proposal',
      applies_to_role: 'both',
      is_about_counterparty: false,
      label: '',
      description: '',
      field_type: 'text',
      allowed_values: [],
      required: false,
      visibility_default: 'full',
      evidence_requirement: 'none',
      verifiability_level: 'self_declared',
      sensitivity_level: 'public',
      module_key: '',
      preset_required: {},
      preset_visible: {}
    });
    setShowQuestionEditor(true);
    setShowAdvanced(false);
  };

  const handleEditQuestion = (question) => {
    setEditingQuestion({ 
      ...question,
      module_key: question.module_key || '',
      preset_required: question.preset_required || {},
      preset_visible: question.preset_visible || {}
    });
    setShowQuestionEditor(true);
    setShowAdvanced(false);
  };

  const handleSaveQuestion = () => {
    const errors = validateQuestion(editingQuestion);
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }

    const existingIdx = template.questions.findIndex(q => q.id === editingQuestion.id);
    if (existingIdx >= 0) {
      const updated = [...template.questions];
      updated[existingIdx] = editingQuestion;
      setTemplate({ ...template, questions: updated });
    } else {
      setTemplate({ ...template, questions: [...template.questions, editingQuestion] });
    }

    setShowQuestionEditor(false);
    setEditingQuestion(null);
    setValidationErrors({});
  };

  const handleDeleteQuestion = (questionId) => {
    setTemplate({
      ...template,
      questions: template.questions.filter(q => q.id !== questionId)
    });
  };

  const setPresetOptions = (preset) => {
    let options = [];
    switch (preset) {
      case 'yes-no':
        options = ['Yes', 'No'];
        break;
      case 'yes-no-unknown':
        options = ['Yes', 'No', 'Unknown'];
        break;
      case 'likert':
        options = ['1 - Strongly Disagree', '2 - Disagree', '3 - Neutral', '4 - Agree', '5 - Strongly Agree'];
        break;
      default:
        options = [];
    }
    setEditingQuestion({ ...editingQuestion, allowed_values: options });
  };

  const renderQuestionPreview = (question) => {
    if (!question) return null;

    return (
      <div className="space-y-2 p-4 bg-white border rounded-xl">
        <Label className="text-sm font-medium text-slate-900">
          {question.label || 'Question label'}
          {question.required && <span className="text-red-500 ml-1">*</span>}
        </Label>
        {question.description && (
          <p className="text-sm text-slate-600">{question.description}</p>
        )}

        <div className="mt-2">
          {question.field_type === 'select' && (
            question.allowed_values?.length > 0 ? (
              <Select disabled>
                <SelectTrigger>
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
                <Input disabled placeholder="Select..." />
                <Badge variant="outline" className="text-xs text-amber-600 mt-1">
                  Missing options in template
                </Badge>
              </>
            )
          )}

          {question.field_type === 'multi_select' && (
            <div className="space-y-2">
              {(question.allowed_values || []).map(opt => (
                <div key={opt} className="flex items-center space-x-2">
                  <Checkbox disabled />
                  <label className="text-sm">{opt}</label>
                </div>
              ))}
              {(!question.allowed_values || question.allowed_values.length === 0) && (
                <p className="text-sm text-amber-600">No options configured</p>
              )}
            </div>
          )}

          {question.field_type === 'boolean' && (
            <RadioGroup disabled>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Yes" />
                <Label>Yes</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="No" />
                <Label>No</Label>
              </div>
            </RadioGroup>
          )}

          {question.field_type === 'textarea' && (
            <Textarea disabled placeholder="Enter text..." className="min-h-[100px]" />
          )}

          {question.field_type === 'text' && (
            <Input disabled placeholder="Enter text..." />
          )}

          {question.field_type === 'number' && (
            <Input disabled type="number" placeholder="Enter number..." />
          )}

          {question.field_type === 'url' && (
            <Input disabled type="url" placeholder="https://..." />
          )}

          {question.field_type === 'file' && (
            <Input disabled type="file" />
          )}
        </div>
      </div>
    );
  };

  const publishErrors = validationErrors.publish || [];
  const canPublish = publishErrors.length === 0;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <Link to={createPageUrl('Admin')} className="inline-flex items-center text-slate-600 hover:text-slate-900 mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Admin
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {templateId ? 'Edit Template' : 'Create Template'}
              </h1>
              <p className="text-slate-500 mt-1">Build a pre-qualification template with validation.</p>
            </div>
            <div className="flex items-center gap-3">
              {template.slug === 'universal_enterprise_onboarding' && templateId && (
                <Button 
                  variant="outline" 
                  onClick={async () => {
                    if (!confirm('This will update module_key on ALL questions and fix missing options. Continue?')) {
                      return;
                    }
                    try {
                      const result = await base44.functions.invoke('fixUniversalTemplateModules', {});
                      console.log('Auto-tag result:', result);
                      
                      // Invalidate all template queries
                      queryClient.invalidateQueries(['template']);
                      queryClient.invalidateQueries(['templates']);
                      queryClient.invalidateQueries(['admin', 'templates']);
                      
                      // Reload the page to fetch fresh data
                      window.location.reload();
                    } catch (error) {
                      alert('Error: ' + error.message);
                      console.error('Auto-tag error:', error);
                    }
                  }}
                  className="border-purple-200 text-purple-700 hover:bg-purple-50"
                >
                  <Wand2 className="w-4 h-4 mr-2" />
                  Auto-tag Modules
                </Button>
              )}
              <Button variant="outline" onClick={handleSaveDraft} disabled={saveTemplateMutation.isPending}>
                <Save className="w-4 h-4 mr-2" />
                Save Draft
              </Button>
              <Button onClick={handlePublish} className="bg-blue-600 hover:bg-blue-700">
                <Send className="w-4 h-4 mr-2" />
                Publish
              </Button>
            </div>
          </div>
        </div>

        {/* Template Summary */}
        <Card className="border-0 shadow-sm mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-4 gap-4">
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-500">Total Questions</p>
                <p className="text-2xl font-bold text-slate-900">{template.questions?.length || 0}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-500">Required</p>
                <p className="text-2xl font-bold text-slate-900">
                  {requiredCount}
                  {requiredCount > 10 && (
                    <Badge variant="outline" className="ml-2 text-xs text-amber-600">High</Badge>
                  )}
                </p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-500">Select Fields</p>
                <p className="text-2xl font-bold text-slate-900">{selectCount}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-500">Status</p>
                <Badge className={
                  template.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'
                }>
                  {template.status || 'hidden'}
                </Badge>
              </div>
            </div>

            {requiredCount > 10 && (
              <Alert className="mt-4 border-amber-200 bg-amber-50">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-amber-900">
                  High required count ({requiredCount} fields) may reduce completion rate.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Template Settings */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Template Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Template Name *</Label>
                <Input
                  value={template.name}
                  onChange={(e) => setTemplate({ ...template, name: e.target.value })}
                  placeholder="Security Trust Exchange"
                />
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={template.description}
                  onChange={(e) => setTemplate({ ...template, description: e.target.value })}
                  placeholder="Describe what this template is for..."
                  className="min-h-[80px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select
                    value={template.category}
                    onValueChange={(v) => setTemplate({ ...template, category: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="custom">Custom</SelectItem>
                      <SelectItem value="m_and_a">M&A</SelectItem>
                      <SelectItem value="recruiting">Recruiting</SelectItem>
                      <SelectItem value="investment">Investment</SelectItem>
                      <SelectItem value="partnership">Partnership</SelectItem>
                      <SelectItem value="consulting">Consulting</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={template.status}
                    onValueChange={(v) => setTemplate({ ...template, status: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hidden">Hidden</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Party A Label</Label>
                  <Input
                    value={template.party_a_label}
                    onChange={(e) => setTemplate({ ...template, party_a_label: e.target.value })}
                    placeholder="Proposer"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Party B Label</Label>
                  <Input
                    value={template.party_b_label}
                    onChange={(e) => setTemplate({ ...template, party_b_label: e.target.value })}
                    placeholder="Recipient"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Right: Questions */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Questions ({template.questions?.length || 0})</CardTitle>
                <Button size="sm" onClick={handleAddQuestion}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Question
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {template.questions?.map((q, idx) => {
                  const qErrors = validateQuestion(q);
                  const hasErrors = Object.keys(qErrors).length > 0;

                  return (
                    <div key={q.id} className={`p-3 border rounded-lg ${hasErrors ? 'border-red-300 bg-red-50' : 'bg-slate-50'}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-medium text-sm">
                            {q.label || 'Untitled Question'}
                            {q.required && <span className="text-red-500 ml-1">*</span>}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            {q.field_type}
                            {['select', 'radio', 'multi_select'].includes(q.field_type) && 
                              ` (${q.allowed_values?.length || 0} options)`}
                          </p>
                          {hasErrors && (
                            <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                              <XCircle className="w-3 h-3" />
                              {Object.values(qErrors)[0]}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" onClick={() => handleEditQuestion(q)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDeleteQuestion(q.id)}>
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {template.questions?.length === 0 && (
                  <p className="text-center text-slate-500 py-8">No questions yet. Click "Add Question" to start.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Question Editor Dialog */}
        <Dialog open={showQuestionEditor} onOpenChange={setShowQuestionEditor}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingQuestion?.label || 'New Question'}
              </DialogTitle>
            </DialogHeader>

            <Tabs defaultValue="settings" className="mt-4">
              <TabsList>
                <TabsTrigger value="settings">Settings</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>

              <TabsContent value="settings" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Question Label *</Label>
                  <Input
                    value={editingQuestion?.label || ''}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, label: e.target.value })}
                    placeholder="What is your question?"
                    className={validationErrors.label ? 'border-red-500' : ''}
                  />
                  {validationErrors.label && (
                    <p className="text-sm text-red-600">{validationErrors.label}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={editingQuestion?.description || ''}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, description: e.target.value })}
                    placeholder="Provide context or instructions..."
                    className="min-h-[60px]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Field Type *</Label>
                    <Select
                      value={editingQuestion?.field_type}
                      onValueChange={(v) => setEditingQuestion({ ...editingQuestion, field_type: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="textarea">Textarea</SelectItem>
                        <SelectItem value="select">Select</SelectItem>
                        <SelectItem value="multi_select">Multi-Select</SelectItem>
                        <SelectItem value="boolean">Boolean (Yes/No)</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="url">URL</SelectItem>
                        <SelectItem value="file">File Upload</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Page</Label>
                    <Select
                      value={editingQuestion?.page}
                      onValueChange={(v) => setEditingQuestion({ ...editingQuestion, page: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="proposal">Proposal</SelectItem>
                        <SelectItem value="shared_core">Shared Core</SelectItem>
                        <SelectItem value="proposer">Proposer</SelectItem>
                        <SelectItem value="recipient">Recipient</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {['select', 'multi_select'].includes(editingQuestion?.field_type) && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Options *</Label>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setPresetOptions('yes-no')}>
                          <Wand2 className="w-3 h-3 mr-1" />
                          Yes/No
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setPresetOptions('yes-no-unknown')}>
                          <Wand2 className="w-3 h-3 mr-1" />
                          Yes/No/Unknown
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setPresetOptions('likert')}>
                          <Wand2 className="w-3 h-3 mr-1" />
                          Likert 1-5
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      value={(editingQuestion?.allowed_values || []).join('\n')}
                      onChange={(e) => setEditingQuestion({
                        ...editingQuestion,
                        allowed_values: e.target.value.split('\n').filter(Boolean)
                      })}
                      placeholder="One option per line..."
                      className={`min-h-[120px] ${validationErrors.options ? 'border-red-500' : ''}`}
                    />
                    {validationErrors.options && (
                      <p className="text-sm text-red-600">{validationErrors.options}</p>
                    )}
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <Checkbox
                    checked={editingQuestion?.required}
                    onCheckedChange={(checked) => setEditingQuestion({ ...editingQuestion, required: checked })}
                  />
                  <Label>Required field</Label>
                </div>

                {editingQuestion?.required && (
                  <div className="space-y-2">
                    <Label>Required Reason (internal)</Label>
                    <Input
                      value={editingQuestion?.required_reason || ''}
                      onChange={(e) => setEditingQuestion({ ...editingQuestion, required_reason: e.target.value })}
                      placeholder="Why is this field required?"
                    />
                  </div>
                )}

                {/* Advanced Section */}
                <div className="border-t pt-4 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center justify-between w-full text-left"
                  >
                    <Label className="text-sm font-semibold text-slate-700">Advanced (Presets & Modules)</Label>
                    {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {showAdvanced && (
                    <div className="space-y-4 mt-4">
                      <div className="space-y-2">
                        <Label>Module Key</Label>
                        <Select
                          value={editingQuestion?.module_key || 'none'}
                          onValueChange={(v) => setEditingQuestion({ 
                            ...editingQuestion, 
                            module_key: v === 'none' ? '' : v 
                          })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None (included in all presets)</SelectItem>
                            <SelectItem value="org_profile">org_profile</SelectItem>
                            <SelectItem value="security_compliance">security_compliance</SelectItem>
                            <SelectItem value="privacy_data_handling">privacy_data_handling</SelectItem>
                            <SelectItem value="operations_sla">operations_sla</SelectItem>
                            <SelectItem value="implementation_it">implementation_it</SelectItem>
                            <SelectItem value="legal_commercial">legal_commercial</SelectItem>
                            <SelectItem value="references">references</SelectItem>
                            <SelectItem value="api_data">api_data</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-slate-500">
                          Module determines which presets show this question.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label>Preset Required Overrides</Label>
                        <div className="space-y-2 pl-4">
                          {['vendor_prequal', 'saas_procurement', 'private_rfp_prequal', 'api_data_provider'].map(preset => (
                            <div key={preset} className="flex items-center space-x-2">
                              <Checkbox
                                checked={editingQuestion?.preset_required?.[preset] === true}
                                onCheckedChange={(checked) => {
                                  const updated = { ...(editingQuestion?.preset_required || {}) };
                                  if (checked) {
                                    updated[preset] = true;
                                  } else {
                                    delete updated[preset];
                                  }
                                  setEditingQuestion({ ...editingQuestion, preset_required: updated });
                                }}
                              />
                              <Label className="text-sm font-normal">{preset}</Label>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-slate-500">
                          Override default required flag for specific presets.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button variant="outline" onClick={() => { setShowQuestionEditor(false); setValidationErrors({}); }}>
                    Cancel
                  </Button>
                  <Button onClick={handleSaveQuestion} className="bg-blue-600 hover:bg-blue-700">
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Save Question
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="preview" className="mt-4">
                <div className="p-6 bg-slate-50 rounded-xl">
                  <h3 className="text-sm font-medium text-slate-700 mb-4">Live Preview</h3>
                  {renderQuestionPreview(editingQuestion)}
                </div>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>

        {/* Publish Dialog */}
        <Dialog open={showPublishDialog} onOpenChange={setShowPublishDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {canPublish ? 'Publish Template?' : 'Cannot Publish - Validation Errors'}
              </DialogTitle>
              <DialogDescription>
                {canPublish 
                  ? 'This will make the template visible to all users in the template library.'
                  : 'Please fix the following errors before publishing:'}
              </DialogDescription>
            </DialogHeader>

            {!canPublish && (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {publishErrors.map((err, idx) => (
                  <Alert key={idx} variant="destructive">
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription>
                      <strong>{err.field}:</strong> {err.message}
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            )}

            {canPublish && (
              <div className="space-y-3">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <p className="text-sm"><strong>Template:</strong> {template.name}</p>
                  <p className="text-sm"><strong>Questions:</strong> {template.questions?.length || 0}</p>
                  <p className="text-sm"><strong>Required:</strong> {requiredCount}</p>
                </div>
                {requiredCount > 10 && (
                  <Alert className="border-amber-200 bg-amber-50">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <AlertDescription className="text-amber-900">
                      High required count may reduce completion rate.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowPublishDialog(false)}>
                Cancel
              </Button>
              {canPublish && (
                <Button onClick={confirmPublish} className="bg-blue-600 hover:bg-blue-700">
                  <Send className="w-4 h-4 mr-2" />
                  Publish Now
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}