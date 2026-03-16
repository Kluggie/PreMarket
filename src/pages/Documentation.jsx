import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  BookOpen, Users, Shield, BarChart3, 
  Lock, ArrowRight
} from 'lucide-react';

export default function Documentation() {
  const sections = [
    {
      title: 'Getting Started',
      icon: BookOpen,
      color: 'from-blue-500 to-blue-600',
      items: [
        { title: 'What is PreMarket?', desc: 'Understanding the platform and its purpose' },
        { title: 'Creating Your First Opportunity', desc: 'Step-by-step guide to getting started' },
        { title: 'Browsing Products', desc: 'Finding the right template or tool for your needs' },
        { title: 'Guest vs. Account Mode', desc: 'Understanding the differences' }
      ]
    },
    {
      title: 'Privacy & Security',
      icon: Shield,
      color: 'from-purple-500 to-purple-600',
      items: [
        { title: 'Privacy Modes', desc: 'Public, Pseudonymous, and Private explained' },
        { title: 'Progressive Reveal', desc: 'Understanding the 3-gate system' },
        { title: 'Visibility Controls', desc: 'Managing field-level privacy' },
        { title: 'Mutual Reveal Process', desc: 'How identity reveal works' }
      ]
    },
    {
      title: 'AI Evaluations',
      icon: BarChart3,
      color: 'from-green-500 to-green-600',
      items: [
        { title: 'How Evaluations Work', desc: 'Understanding AI compatibility scoring' },
        { title: 'Criteria & Weights', desc: 'What factors influence the score' },
        { title: 'Red Flags', desc: 'Interpreting warnings and recommendations' },
        { title: 'Social Links Consent', desc: 'Opting in to social profile analysis' }
      ]
    },
    {
      title: 'Workflow Guide',
      icon: Users,
      color: 'from-indigo-500 to-indigo-600',
      items: [
        { title: 'Opportunity Lifecycle', desc: 'From creation to reveal' },
        { title: 'Verification Process', desc: 'How to verify counterparty information' },
        { title: 'Re-evaluation', desc: 'Updating evaluations with new data' },
        { title: 'Comments & Communication', desc: 'Collaborating within opportunities' }
      ]
    }
  ];

  const disclaimers = [
    { 
      title: 'Pre-Qualification Only',
      desc: 'PreMarket is designed for initial compatibility assessment, not final decision-making.'
    },
    { 
      title: 'No Brokerage Services',
      desc: 'We do not facilitate transactions, act as intermediaries, or handle any financial dealings.'
    },
    { 
      title: 'No Professional Advice',
      desc: 'Platform outputs are informational only. Consult qualified professionals for legal, financial, or investment advice.'
    },
    { 
      title: 'User Responsibility',
      desc: 'All parties are responsible for conducting their own due diligence and making informed decisions.'
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
            <BookOpen className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-4">Documentation</h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Everything you need to know about using PreMarket effectively and safely.
          </p>
        </div>

        {/* Quick Start */}
        <Card className="border-0 shadow-sm mb-8 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
          <CardContent className="p-8">
            <h2 className="text-2xl font-bold mb-4">Quick Start Guide</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center mb-3">
                  <span className="font-bold">1</span>
                </div>
                <h3 className="font-semibold mb-2">Select Product</h3>
                <p className="text-blue-100 text-sm">Choose from M&A, Recruiting, Investment, or custom templates</p>
              </div>
              <div>
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center mb-3">
                  <span className="font-bold">2</span>
                </div>
                <h3 className="font-semibold mb-2">Fill Opportunity</h3>
                <p className="text-blue-100 text-sm">Enter information with granular visibility controls</p>
              </div>
              <div>
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center mb-3">
                  <span className="font-bold">3</span>
                </div>
                <h3 className="font-semibold mb-2">Get AI Score</h3>
                <p className="text-blue-100 text-sm">Receive compatibility analysis and recommendations</p>
              </div>
            </div>
            <Link to="/templates">
              <Button className="mt-6 bg-white text-blue-600 hover:bg-blue-50">
                Create Your First Opportunity
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Documentation Sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {sections.map((section, idx) => (
            <Card key={idx} className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${section.color} flex items-center justify-center`}>
                    <section.icon className="w-5 h-5 text-white" />
                  </div>
                  {section.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {section.items.map((item, i) => (
                    <button
                      key={i}
                      className="w-full text-left p-3 rounded-lg hover:bg-slate-50 transition-colors flex items-start gap-3 group"
                    >
                      <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-slate-900 group-hover:text-blue-600">{item.title}</p>
                        <p className="text-sm text-slate-500">{item.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Important Disclaimers */}
        <Card className="border-0 shadow-sm border-l-4 border-l-amber-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-amber-600" />
              Important Disclaimers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {disclaimers.map((item, idx) => (
                <div key={idx} className="p-4 bg-amber-50 rounded-lg">
                  <h3 className="font-semibold text-amber-900 mb-2">{item.title}</h3>
                  <p className="text-sm text-amber-700">{item.desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Need Help */}
        <Card className="border-0 shadow-sm mt-8">
          <CardContent className="p-8 text-center">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Still have questions?</h2>
            <p className="text-slate-600 mb-6">
              Our support team is here to help you get the most out of PreMarket.
            </p>
            <Link to="/contact">
              <Button>
                Contact Support
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
