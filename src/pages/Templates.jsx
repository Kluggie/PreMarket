import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { templatesClient } from '@/api/templatesClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Building2,
  Users,
  TrendingUp,
  Briefcase,
  Handshake,
  FileText,
  ArrowRight,
  Lock,
  CheckCircle2,
  Clock,
  Database,
  Shield,
  Zap,
  Settings,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const iconMap = {
  m_and_a: Building2,
  recruiting: Users,
  investment: TrendingUp,
  partnership: Handshake,
  consulting: Briefcase,
  api_data: Database,
  saas_procurement: Shield,
  beta_access: Zap,
  custom: FileText,
};

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

export default function Templates() {
  const [showCustomRequest, setShowCustomRequest] = useState(false);
  const [customFormData, setCustomFormData] = useState({ name: '', email: '', message: '' });
  const [submitted, setSubmitted] = useState(false);

  const { data: templates = [] } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesClient.list(),
  });

  const customTemplateMutation = useMutation({
    mutationFn: (payload) => templatesClient.submitCustomRequest(payload),
    onSuccess: () => {
      setSubmitted(true);
      setTimeout(() => {
        setShowCustomRequest(false);
        setSubmitted(false);
        setCustomFormData({ name: '', email: '', message: '' });
      }, 1500);
    },
  });

  const incrementViewCount = async (templateId) => {
    try {
      await templatesClient.recordView(templateId);
    } catch {
      // Silently fail - non-critical parity behavior.
    }
  };

  const handleCustomTemplateRequest = async (event) => {
    event.preventDefault();
    await customTemplateMutation.mutateAsync({
      name: customFormData.name,
      email: customFormData.email,
      message: `Custom Template Request: ${customFormData.message}`,
    });
  };

  const displayTemplates = templates.filter((template) => {
    const status = normalizeStatus(template.status);
    return status === 'published' || status === 'active';
  });

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-slate-900 mb-4">Templates & Tools</h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Choose from templates and tools for your pre-qualification needs.
          </p>
        </div>

        <div className="mb-12">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">Tools</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Link to={createPageUrl('DocumentComparisonCreate')}>
              <Card className="border-0 shadow-sm hover:shadow-lg transition-all duration-300 cursor-pointer h-full">
                <CardContent className="p-6">
                  <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center mb-4">
                    <FileText className="w-6 h-6 text-purple-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">Document Comparison</h3>
                  <p className="text-sm text-slate-500 mb-4">
                    Compare two documents with AI evaluation and confidentiality controls
                  </p>
                  <Badge className="bg-purple-100 text-purple-700">Tool</Badge>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-slate-900 mb-4">Proposal Templates</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayTemplates.length === 0 ? (
              <div className="col-span-full">
                <Card className="border-0 shadow-sm text-center py-16">
                  <CardContent>
                    <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-slate-900 mb-2">Get Started with Templates</h3>
                    <p className="text-slate-600 mb-6">
                      Create your first template to structure pre-qualification proposals.
                    </p>
                    <Link to={createPageUrl('Admin')}>
                      <Button className="bg-blue-600 hover:bg-blue-700">
                        <Settings className="w-4 h-4 mr-2" />
                        Create Your First Template
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              </div>
            ) : (
              displayTemplates.map((template, index) => {
                const Icon = iconMap[template.category] || FileText;
                const isComingSoon = normalizeStatus(template.status) === 'coming_soon';

                return (
                  <motion.div
                    key={template.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <Card
                      className={`h-full border-0 shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col ${
                        isComingSoon ? 'opacity-75' : ''
                      }`}
                    >
                      <CardContent className="p-6 flex flex-col flex-1">
                        <div className="flex items-start justify-between mb-4">
                          <div
                            className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                              isComingSoon ? 'bg-slate-100' : 'bg-gradient-to-br from-blue-500 to-indigo-600'
                            }`}
                          >
                            <Icon className={`w-6 h-6 ${isComingSoon ? 'text-slate-400' : 'text-white'}`} />
                          </div>
                          {isComingSoon ? (
                            <Badge variant="outline" className="text-slate-500 border-slate-300">
                              <Clock className="w-3 h-3 mr-1" />
                              Coming Soon
                            </Badge>
                          ) : (
                            <Badge className="bg-green-100 text-green-700">
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Active
                            </Badge>
                          )}
                        </div>

                        <h3 className="text-lg font-semibold text-slate-900 mb-2">{template.name}</h3>
                        <p className="text-slate-600 text-sm mb-4 line-clamp-3 flex-1">{template.description}</p>

                        <div className="flex items-center gap-3 mb-4 text-xs text-slate-500">
                          <span className="px-2 py-1 bg-slate-100 rounded">
                            {template.party_a_label || 'Party A'}
                          </span>
                          <ArrowRight className="w-3 h-3" />
                          <span className="px-2 py-1 bg-slate-100 rounded">
                            {template.party_b_label || 'Party B'}
                          </span>
                        </div>

                        <div className="mt-auto">
                          {isComingSoon ? (
                            <Button disabled variant="outline" className="w-full">
                              <Lock className="w-4 h-4 mr-2" />
                              Coming Soon
                            </Button>
                          ) : (
                            <Link to={createPageUrl(`CreateProposal?template=${encodeURIComponent(template.id)}`)}>
                              <Button
                                onClick={() => incrementViewCount(template.id)}
                                className="w-full bg-slate-900 hover:bg-slate-800"
                              >
                                Use Template
                                <ArrowRight className="w-4 h-4 ml-2" />
                              </Button>
                            </Link>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>

        <div className="mt-12 text-center">
          <Card className="border-dashed border-2 border-slate-200 bg-white/50">
            <CardContent className="py-12">
              <FileText className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Need a Custom Template?</h3>
              <p className="text-slate-600 mb-6 max-w-md mx-auto">
                Contact us to create industry-specific templates tailored to your pre-qualification needs.
              </p>
              <Button variant="outline" onClick={() => setShowCustomRequest(true)}>
                Request Custom Template
              </Button>
            </CardContent>
          </Card>
        </div>

        <Dialog open={showCustomRequest} onOpenChange={setShowCustomRequest}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Request Custom Template</DialogTitle>
              <DialogDescription>
                Tell us about your pre-qualification needs and we'll create a template for you.
              </DialogDescription>
            </DialogHeader>

            {submitted ? (
              <div className="py-8 text-center">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Request Sent!</h3>
                <p className="text-slate-600">We'll contact you within 24 hours.</p>
              </div>
            ) : (
              <form onSubmit={handleCustomTemplateRequest} className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="custom-name">Name *</Label>
                  <Input
                    id="custom-name"
                    required
                    value={customFormData.name}
                    onChange={(event) =>
                      setCustomFormData((prev) => ({
                        ...prev,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Your name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="custom-email">Email *</Label>
                  <Input
                    id="custom-email"
                    type="email"
                    required
                    value={customFormData.email}
                    onChange={(event) =>
                      setCustomFormData((prev) => ({
                        ...prev,
                        email: event.target.value,
                      }))
                    }
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="custom-message">Template Requirements *</Label>
                  <Textarea
                    id="custom-message"
                    required
                    value={customFormData.message}
                    onChange={(event) =>
                      setCustomFormData((prev) => ({
                        ...prev,
                        message: event.target.value,
                      }))
                    }
                    placeholder="Describe your use case and what fields/criteria you need..."
                    className="min-h-[100px]"
                  />
                </div>
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={customTemplateMutation.isPending}>
                  {customTemplateMutation.isPending ? 'Submitting...' : 'Submit Request'}
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
