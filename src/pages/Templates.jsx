import React from 'react';
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
  ArrowRight, Lock, CheckCircle2, Clock
} from 'lucide-react';

const iconMap = {
  m_and_a: Building2,
  recruiting: Users,
  investment: TrendingUp,
  partnership: Handshake,
  consulting: Briefcase,
  custom: FileText
};

const categoryLabels = {
  m_and_a: 'M&A',
  recruiting: 'Recruiting',
  investment: 'Investment',
  partnership: 'Partnership',
  consulting: 'Consulting',
  custom: 'Custom'
};

export default function Templates() {
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => base44.entities.Template.list('-created_date')
  });

  // Default templates to show even if none exist
  const defaultTemplates = [
    {
      id: 'ma-default',
      name: 'M&A Pre-Qualification',
      slug: 'm-and-a',
      description: 'Evaluate potential acquisition targets or acquirers. Assess financial health, strategic fit, and deal structure compatibility.',
      category: 'm_and_a',
      status: 'active',
      party_a_label: 'Acquirer',
      party_b_label: 'Target Company'
    },
    {
      id: 'recruiting-default',
      name: 'Executive Recruiting',
      slug: 'recruiting',
      description: 'Pre-qualify candidates for executive positions. Evaluate experience, compensation expectations, and cultural fit.',
      category: 'recruiting',
      status: 'active',
      party_a_label: 'Employer',
      party_b_label: 'Candidate'
    },
    {
      id: 'investment-default',
      name: 'Investor Matching',
      slug: 'investment',
      description: 'Connect startups with potential investors. Evaluate stage fit, check size alignment, and sector expertise.',
      category: 'investment',
      status: 'active',
      party_a_label: 'Startup',
      party_b_label: 'Investor'
    },
    {
      id: 'partnership-default',
      name: 'Strategic Partnership',
      slug: 'partnership',
      description: 'Evaluate potential business partnerships. Assess complementary capabilities and strategic alignment.',
      category: 'partnership',
      status: 'coming_soon',
      party_a_label: 'Partner A',
      party_b_label: 'Partner B'
    },
    {
      id: 'consulting-default',
      name: 'Consulting Engagement',
      slug: 'consulting',
      description: 'Pre-qualify consulting firms or clients. Evaluate expertise, budget alignment, and project scope.',
      category: 'consulting',
      status: 'coming_soon',
      party_a_label: 'Client',
      party_b_label: 'Consultant'
    }
  ];

  const displayTemplates = templates.length > 0 ? templates : defaultTemplates;

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
          {displayTemplates.map((template, index) => {
            const Icon = iconMap[template.category] || FileText;
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
                      <Link to={createPageUrl(`CreateProposal?template=${template.id}&step=2`)}>
                        <Button className="w-full bg-slate-900 hover:bg-slate-800">
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
              <Button variant="outline">
                Request Custom Template
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}