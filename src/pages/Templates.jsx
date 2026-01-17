import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Building2, Users, TrendingUp, Briefcase, Handshake, FileText,
  ArrowRight, Lock, CheckCircle2, Clock, Database, Shield, Zap, Filter
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const iconMap = {
  m_and_a: Building2,
  recruiting: Users,
  investment: TrendingUp,
  partnership: Handshake,
  consulting: Briefcase,
  api_data: 'Database',
  saas_procurement: 'Shield',
  beta_access: 'Zap',
  custom: FileText
};

const categoryLabels = {
  m_and_a: 'M&A',
  recruiting: 'Recruiting',
  investment: 'Investment',
  partnership: 'Partnership',
  consulting: 'Consulting',
  api_data: 'API & Data',
  saas_procurement: 'SaaS Procurement',
  beta_access: 'Beta Access',
  custom: 'Custom'
};

export default function Templates() {
  const [showCustomRequest, setShowCustomRequest] = useState(false);
  const [customFormData, setCustomFormData] = useState({ name: '', email: '', message: '' });
  const [submitted, setSubmitted] = useState(false);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: async () => {
      const all = await base44.entities.Template.list('-created_date');
      // Show published and active templates, exclude hidden/archived/coming_soon
      return all.filter(t => t.status === 'published' || t.status === 'active');
    }
  });

  // Increment view count when template is clicked
  const incrementViewCount = async (templateId) => {
    try {
      const template = templates.find(t => t.id === templateId);
      if (template) {
        await base44.entities.Template.update(templateId, {
          view_count: (template.view_count || 0) + 1
        });
      }
    } catch (e) {
      // Silently fail - non-critical
    }
  };

  const handleCustomTemplateRequest = async (e) => {
    e.preventDefault();
    try {
      await base44.entities.ContactRequest.create({
        ...customFormData,
        reason: 'request',
        message: `Custom Template Request: ${customFormData.message}`,
        type: 'general',
        status: 'new'
      });
      setSubmitted(true);
      setTimeout(() => {
        setShowCustomRequest(false);
        setSubmitted(false);
        setCustomFormData({ name: '', email: '', message: '' });
      }, 2000);
    } catch (error) {
      console.error('Failed to submit request:', error);
    }
  };

  const displayTemplates = templates;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-slate-900 mb-4">Template Library</h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Choose from industry-specific templates to structure your pre-qualification proposals.
            Each template includes tailored questions and evaluation criteria.
          </p>
        </div>



        {/* Templates Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {displayTemplates.length === 0 ? (
            <div className="col-span-full">
              <Card className="border-0 shadow-sm text-center py-16">
                <CardContent>
                  <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-slate-900 mb-2">No templates available yet</h3>
                  <p className="text-slate-600 mb-6">
                    The template library is being prepared. Check back soon for pre-built templates to structure your proposals.
                  </p>
                  <Link to={createPageUrl('Admin')}>
                    <Button variant="outline">
                      <Settings className="w-4 h-4 mr-2" />
                      Admin Panel
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </div>
          ) : displayTemplates.map((template, index) => {
            const iconName = iconMap[template.category];
            const Icon = typeof iconName === 'string' ? 
              ({ Database, Shield, Zap }[iconName] || FileText) : 
              iconName || FileText;
            const isComingSoon = template.status === 'coming_soon';

            return (
              <motion.div
                key={template.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className={`h-full border-0 shadow-sm hover:shadow-lg transition-all duration-300 ${
                  isComingSoon ? 'opacity-75' : ''
                }`}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                        isComingSoon 
                          ? 'bg-slate-100' 
                          : 'bg-gradient-to-br from-blue-500 to-indigo-600'
                      }`}>
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

                    <h3 className="text-lg font-semibold text-slate-900 mb-2">
                      {template.name}
                    </h3>
                    <p className="text-slate-600 text-sm mb-4 line-clamp-3">
                      {template.description}
                    </p>

                    <div className="flex items-center gap-3 mb-6 text-xs text-slate-500">
                      <span className="px-2 py-1 bg-slate-100 rounded">
                        {template.party_a_label}
                      </span>
                      <ArrowRight className="w-3 h-3" />
                      <span className="px-2 py-1 bg-slate-100 rounded">
                        {template.party_b_label}
                      </span>
                    </div>

                    {isComingSoon ? (
                      <Button disabled variant="outline" className="w-full">
                        <Lock className="w-4 h-4 mr-2" />
                        Coming Soon
                      </Button>
                    ) : (
                              <Link to={createPageUrl(`CreateProposal?template=${template.id}`)}>
                        <Button 
                          onClick={() => incrementViewCount(template.id)}
                          className="w-full bg-slate-900 hover:bg-slate-800"
                        >
                          Use Template
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Custom Template CTA */}
        <div className="mt-12 text-center">
          <Card className="border-dashed border-2 border-slate-200 bg-white/50">
            <CardContent className="py-12">
              <FileText className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                Need a Custom Template?
              </h3>
              <p className="text-slate-600 mb-6 max-w-md mx-auto">
                Contact us to create industry-specific templates tailored to your pre-qualification needs.
              </p>
              <Button variant="outline" onClick={() => setShowCustomRequest(true)}>
                Request Custom Template
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Custom Template Request Dialog */}
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
                    onChange={(e) => setCustomFormData({ ...customFormData, name: e.target.value })}
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
                    onChange={(e) => setCustomFormData({ ...customFormData, email: e.target.value })}
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="custom-message">Template Requirements *</Label>
                  <Textarea
                    id="custom-message"
                    required
                    value={customFormData.message}
                    onChange={(e) => setCustomFormData({ ...customFormData, message: e.target.value })}
                    placeholder="Describe your use case and what fields/criteria you need..."
                    className="min-h-[100px]"
                  />
                </div>
                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700">
                  Submit Request
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}