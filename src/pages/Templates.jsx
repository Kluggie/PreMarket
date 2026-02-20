import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { createPageUrl } from '@/utils';
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
  Loader2,
} from 'lucide-react';

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
  const navigate = useNavigate();
  const [activeTemplateId, setActiveTemplateId] = useState(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesClient.list(),
  });

  const useTemplateMutation = useMutation({
    mutationFn: async (template) => {
      const idempotencyKey = `use_template:${template.id}:${Date.now()}`;
      return templatesClient.useTemplate(template.id, { idempotencyKey });
    },
    onSuccess: ({ proposal }) => {
      if (proposal?.id) {
        navigate(createPageUrl(`ProposalDetail?id=${encodeURIComponent(proposal.id)}`));
      } else {
        navigate(createPageUrl('Proposals'));
      }
    },
    onSettled: () => {
      setActiveTemplateId(null);
    },
  });

  const displayTemplates = useMemo(() => {
    return templates
      .filter((template) => {
        const status = normalizeStatus(template.status);
        return status === 'active' || status === 'published' || status === 'coming_soon';
      })
      .sort((a, b) => {
        const left = Number(a.sort_order || 0);
        const right = Number(b.sort_order || 0);
        if (left !== right) return left - right;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
  }, [templates]);

  const handleUseTemplate = (template) => {
    if (!template?.id || useTemplateMutation.isPending) {
      return;
    }
    setActiveTemplateId(template.id);
    useTemplateMutation.mutate(template);
  };

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
            {isLoading ? (
              <div className="col-span-full">
                <Card className="border-0 shadow-sm text-center py-16">
                  <CardContent>
                    <p className="text-slate-600">Loading templates...</p>
                  </CardContent>
                </Card>
              </div>
            ) : displayTemplates.length === 0 ? (
              <div className="col-span-full">
                <Card className="border-0 shadow-sm text-center py-16">
                  <CardContent>
                    <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-slate-900 mb-2">Get Started with Templates</h3>
                    <p className="text-slate-600 mb-6">
                      Create your first template to structure pre-qualification proposals.
                    </p>
                    <Link to={createPageUrl('TemplateBuilder')}>
                      <Button className="bg-blue-600 hover:bg-blue-700">Create Your First Template</Button>
                    </Link>
                  </CardContent>
                </Card>
              </div>
            ) : (
              displayTemplates.map((template, index) => {
                const Icon = iconMap[template.category] || FileText;
                const isComingSoon = normalizeStatus(template.status) === 'coming_soon';
                const isSubmitting = useTemplateMutation.isPending && activeTemplateId === template.id;

                return (
                  <motion.div
                    key={template.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
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
                        <p className="text-slate-600 text-sm mb-4 line-clamp-3 flex-1">
                          {template.description || 'No description available.'}
                        </p>

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
                            <Button
                              onClick={() => handleUseTemplate(template)}
                              className="w-full bg-slate-900 hover:bg-slate-800"
                              disabled={isSubmitting}
                            >
                              {isSubmitting ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Creating Draft...
                                </>
                              ) : (
                                <>
                                  Use Template
                                  <ArrowRight className="w-4 h-4 ml-2" />
                                </>
                              )}
                            </Button>
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
      </div>
    </div>
  );
}
