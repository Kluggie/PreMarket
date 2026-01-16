import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Shield, Eye, Lock, Users, BarChart3, ArrowRight } from 'lucide-react';

export default function About() {
  const values = [
    {
      icon: Shield,
      title: 'Privacy First',
      description: 'Your information is protected with industry-leading privacy controls and progressive reveal mechanisms.'
    },
    {
      icon: Eye,
      title: 'Transparency',
      description: 'Clear visibility into what information is shared, when, and with whom. No hidden data exchanges.'
    },
    {
      icon: Lock,
      title: 'Security',
      description: 'Enterprise-grade security measures to protect sensitive pre-qualification data.'
    },
    {
      icon: BarChart3,
      title: 'AI-Powered Insights',
      description: 'Advanced AI evaluations provide objective compatibility assessments with your explicit consent.'
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero */}
      <section className="py-20 bg-gradient-to-br from-slate-900 to-blue-900 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-6">
            About PreMarket
          </h1>
          <p className="text-xl text-blue-100 mb-8">
            A privacy-preserving pre-qualification platform for structured trust-building before commitment.
          </p>
          <Link to={createPageUrl('CreateProposal')}>
            <Button size="lg" className="bg-white text-slate-900 hover:bg-blue-50">
              Get Started
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Mission */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-8 md:p-12">
              <h2 className="text-2xl font-bold text-slate-900 mb-6">Our Mission</h2>
              <p className="text-lg text-slate-600 mb-4">
                PreMarket exists to solve a fundamental challenge in business relationships: how do parties evaluate compatibility and fit before revealing sensitive information or committing resources?
              </p>
              <p className="text-lg text-slate-600 mb-4">
                Traditional approaches often require extensive disclosure upfront, creating privacy concerns and information asymmetry. PreMarket introduces a structured, privacy-preserving framework where parties can:
              </p>
              <ul className="space-y-2 text-slate-600">
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  Exchange information gradually through progressive reveal gates
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  Leverage AI-powered compatibility assessments with explicit consent
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  Maintain pseudonymity until mutual interest is established
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  Verify claims through a structured verification workflow
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Values */}
      <section className="py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Our Values</h2>
            <p className="text-lg text-slate-600">
              Principles that guide everything we build
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {values.map((value, idx) => (
              <Card key={idx} className="border-0 shadow-sm">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <value.icon className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 mb-2">{value.title}</h3>
                      <p className="text-slate-600">{value.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* What We're Not */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Card className="border-0 shadow-sm border-l-4 border-l-amber-500">
            <CardContent className="p-8">
              <h2 className="text-2xl font-bold text-slate-900 mb-6">Important Clarifications</h2>
              <div className="space-y-4">
                <div className="p-4 bg-red-50 rounded-lg">
                  <h3 className="font-semibold text-red-900 mb-2">❌ We Are NOT Brokers</h3>
                  <p className="text-sm text-red-700">
                    PreMarket does not facilitate, intermediate, or execute transactions. All dealings are directly between parties.
                  </p>
                </div>
                <div className="p-4 bg-red-50 rounded-lg">
                  <h3 className="font-semibold text-red-900 mb-2">❌ We Do NOT Provide Financial Advice</h3>
                  <p className="text-sm text-red-700">
                    AI evaluations are informational only. Consult qualified professionals for investment, legal, or financial advice.
                  </p>
                </div>
                <div className="p-4 bg-red-50 rounded-lg">
                  <h3 className="font-semibold text-red-900 mb-2">❌ We Do NOT Handle Transactions</h3>
                  <p className="text-sm text-red-700">
                    PreMarket is a pre-qualification platform only. We do not process payments, hold funds, or manage contracts.
                  </p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg">
                  <h3 className="font-semibold text-green-900 mb-2">✓ We ARE an Information Platform</h3>
                  <p className="text-sm text-green-700">
                    We provide tools for structured information exchange, compatibility assessment, and privacy-controlled communication—nothing more.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Use Cases */}
      <section className="py-16 bg-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Use Cases</h2>
            <p className="text-lg text-slate-600">
              PreMarket serves various pre-qualification scenarios
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { title: 'M&A', desc: 'Evaluate acquisition targets and acquirers before detailed due diligence' },
              { title: 'Executive Recruiting', desc: 'Pre-qualify candidates and employers for senior positions' },
              { title: 'Investor Matching', desc: 'Connect startups with compatible investors at the right stage' },
              { title: 'Strategic Partnerships', desc: 'Assess partnership compatibility before formal negotiations' },
              { title: 'Consulting Engagements', desc: 'Pre-qualify consultants and clients for project fit' },
              { title: 'Custom Scenarios', desc: 'Create templates for any bilateral pre-qualification need' }
            ].map((useCase, idx) => (
              <Card key={idx} className="border-0 shadow-sm">
                <CardContent className="p-6">
                  <h3 className="font-semibold text-slate-900 mb-2">{useCase.title}</h3>
                  <p className="text-sm text-slate-600">{useCase.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-slate-900 mb-4">
            Ready to start pre-qualifying?
          </h2>
          <p className="text-lg text-slate-600 mb-8">
            Join PreMarket and verify fit before you reveal.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to={createPageUrl('CreateProposal')}>
              <Button size="lg" className="bg-blue-600 hover:bg-blue-700">
                Create Proposal
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <Link to={createPageUrl('Documentation')}>
              <Button size="lg" variant="outline">
                View Documentation
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}