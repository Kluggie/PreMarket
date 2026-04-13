import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  ArrowRight, Shield, Eye, EyeOff, CheckCircle2, ChevronDown,
  Briefcase, Handshake, TrendingUp, Building2, Lock
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

export default function HowItWorks() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    document.title = 'How PreMarket Works';
    return () => { document.title = 'PreMarket'; };
  }, []);

  const handleStartFree = () => {
    navigate(user ? '/DocumentComparisonCreate' : '/opportunities/new');
  };

  const ctaLink = user ? '/DocumentComparisonCreate' : '/opportunities/new';

  return (
    <div className="min-h-screen">
      {/* SECTION A — Hero */}
      <section className="relative min-h-[85vh] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/50" />
        <div className="absolute inset-0">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-200/20 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-200/20 rounded-full blur-3xl" />
        </div>
        <div className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: 'radial-gradient(circle, #000 0.0625rem, transparent 0.0625rem)',
            backgroundSize: '1.5rem 1.5rem',
          }}
        />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-32 pb-20">
          <div className="text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <span className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-100 rounded-full text-sm text-blue-700 font-medium mb-8">
                <Shield className="w-4 h-4" />
                Neutral AI Workflow
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-5xl sm:text-6xl lg:text-7xl font-bold text-slate-900 tracking-tight mb-6"
            >
              How PreMarket Works
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-xl text-slate-600 max-w-2xl mx-auto mb-10"
            >
              A neutral AI workflow for negotiating business terms without broker fees, while keeping confidential information protected.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <Button
                size="lg"
                onClick={handleStartFree}
                className="bg-slate-900 hover:bg-slate-800 text-white px-8 py-6 text-lg h-auto"
              >
                Start Free
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
              <Link to={ctaLink}>
                <Button variant="outline" size="lg" className="px-8 py-6 text-lg h-auto border-slate-200">
                  Try AI Deal Mediator
                </Button>
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* SECTION B — Step-by-step visual walkthrough */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-20">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Three steps to a structured negotiation
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Each side works independently. The AI brings both positions together into a neutral analysis.
            </p>
          </div>

          {/* Step 1 */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center mb-24"
          >
            <div>
              <div className="inline-flex items-center gap-3 mb-6">
                <span className="w-10 h-10 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center shrink-0">1</span>
                <span className="text-xs font-semibold uppercase tracking-widest text-blue-600">Step one</span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">Each side submits their position</h3>
              <p className="text-slate-600 mb-6">
                Both parties fill out the same structured form independently. Each side provides context the other party can see — and separately adds confidential information that stays private.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  'Shared information is visible to the counterparty',
                  'Confidential information is only accessible to you and the AI',
                  'Goals, priorities, constraints, and supporting documents can all be included',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-slate-600 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-slate-500 italic">
                This is where each side outlines the opportunity, provides shared context for the other party, and adds confidential information that stays private.
              </p>
            </div>
            <div>
              <Step1Mockup />
              <p className="text-xs text-slate-400 text-center mt-3">Shared and confidential inputs are clearly separated in the form.</p>
            </div>
          </motion.div>

          {/* Step 2 — reversed */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center mb-24"
          >
            <div className="order-2 lg:order-1">
              <Step2Mockup />
              <p className="text-xs text-slate-400 text-center mt-3">The AI surfaces alignment, risks, and missing information across both submissions.</p>
            </div>
            <div className="order-1 lg:order-2">
              <div className="inline-flex items-center gap-3 mb-6">
                <span className="w-10 h-10 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center shrink-0">2</span>
                <span className="text-xs font-semibold uppercase tracking-widest text-blue-600">Step two</span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">PreMarket evaluates both sides</h3>
              <p className="text-slate-600 mb-6">
                The AI reads both submissions — shared and confidential — without exposing private inputs to either party. It maps alignment, identifies conflicts, flags missing information, and checks commercial fit.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  'Overlap in objectives and commercial goals',
                  'Conflicts in expectations or pricing',
                  'Missing information that could block progress',
                  'Commercial risks and deal-readiness signals',
                  'Possible paths toward agreement',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-slate-600 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-slate-500 italic">
                PreMarket analyzes both sides using a neutral structure. This is not a generic AI response — it is structured deal analysis.
              </p>
            </div>
          </motion.div>

          {/* Step 3 */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center"
          >
            <div>
              <div className="inline-flex items-center gap-3 mb-6">
                <span className="w-10 h-10 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center shrink-0">3</span>
                <span className="text-xs font-semibold uppercase tracking-widest text-blue-600">Step three</span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">Both sides receive a structured output</h3>
              <p className="text-slate-600 mb-6">
                Rather than unstructured back-and-forth, both parties receive a clear, organized report: where you agree, where the gaps are, what information is still missing, and what to address first.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  'Neutral analysis of both positions',
                  'Areas of alignment identified',
                  'Key gaps to resolve before progressing',
                  'Suggested next steps for both sides',
                  'A clearer, more efficient basis for discussion',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5 text-slate-600 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-slate-500 italic">
                Instead of unstructured back-and-forth, both sides receive a clearer, structured basis for discussion.
              </p>
            </div>
            <div>
              <Step3Mockup />
              <p className="text-xs text-slate-400 text-center mt-3">The report gives both sides a structured basis for discussion — areas of alignment, gaps to resolve, and suggested next steps.</p>
            </div>
          </motion.div>

        </div>
      </section>

      {/* SECTION C — What each side sees */}
      <section className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              What each side sees
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              PreMarket separates shared and confidential inputs so each party controls exactly what the other side sees.
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
            className="max-w-3xl mx-auto mb-12"
          >
            <ConfidentialityMockup />
            <p className="text-xs text-slate-400 text-center mt-3">The confidential and shared panels are clearly separated in the product — the counterparty never sees the confidential side.</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Shared column */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
              viewport={{ once: true }}
              className="bg-white rounded-2xl p-8 border border-slate-100"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <Eye className="w-5 h-5 text-emerald-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">Shared with the other party</h3>
              </div>
              <ul className="space-y-3">
                {[
                  'Business context',
                  'Opportunity summary',
                  'Terms intended for discussion',
                  'Selected documents or structured fields',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-slate-600">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* Confidential column */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
              viewport={{ once: true }}
              className="bg-white rounded-2xl p-8 border border-slate-100"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                  <EyeOff className="w-5 h-5 text-amber-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">Kept confidential</h3>
              </div>
              <ul className="space-y-3">
                {[
                  'Internal constraints',
                  'Walk-away points',
                  'Private priorities',
                  'Internal financial or strategic context',
                  'Notes intended only for AI evaluation',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-slate-600">
                    <Shield className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            viewport={{ once: true }}
            className="text-center text-slate-500 mt-10 max-w-2xl mx-auto text-sm"
          >
            Confidential information is hidden from the counterparty and used to improve the quality of the neutral evaluation.
          </motion.p>
        </div>
      </section>

      {/* SECTION D — Why this is different */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Why this is different
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Traditional */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              viewport={{ once: true }}
              className="bg-slate-50 rounded-2xl p-8 border border-slate-200"
            >
              <h3 className="text-lg font-semibold text-slate-900 mb-6">Traditional process</h3>
              <ul className="space-y-3">
                {[
                  'Broker fees',
                  'Slow back-and-forth',
                  'Inconsistent advice',
                  'Incentives may not be neutral',
                  'Confidential context is fragmented',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-slate-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* PreMarket */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              viewport={{ once: true }}
              className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-8 border border-blue-200 ring-1 ring-blue-100"
            >
              <h3 className="text-lg font-semibold text-slate-900 mb-6 flex items-center gap-2">
                PreMarket
                <span className="text-xs font-medium bg-blue-600 text-white px-2 py-0.5 rounded-full">Better</span>
              </h3>
              <ul className="space-y-3">
                {[
                  'No success fees or commissions',
                  'Faster structured evaluation',
                  'One neutral framework for both sides',
                  'Clear separation of shared vs confidential inputs',
                  'Consistent deal analysis',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-slate-700">
                    <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </div>
      </section>

      {/* SECTION E — Example use cases */}
      <section className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Built for real negotiations
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              PreMarket works wherever two parties need to evaluate terms, align expectations, and move toward agreement.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Building2,
                title: 'M&A early-stage alignment',
                description: 'Evaluate fit, surface deal-breakers, and structure initial terms before formal diligence.',
              },
              {
                icon: Briefcase,
                title: 'Vendor and procurement negotiations',
                description: 'Compare vendor opportunities against internal priorities with a structured, neutral framework.',
              },
              {
                icon: Handshake,
                title: 'Strategic partnerships',
                description: 'Align on shared goals and identify gaps in expectations before committing resources.',
              },
              {
                icon: TrendingUp,
                title: 'Investment and commercial deal evaluation',
                description: 'Get a structured assessment of alignment, risk, and readiness before term sheet discussions.',
              },
            ].map((useCase, index) => (
              <motion.div
                key={useCase.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                viewport={{ once: true }}
                className="bg-white rounded-2xl p-6 border border-slate-100 hover:shadow-lg hover:border-blue-100 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mb-5">
                  <useCase.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">{useCase.title}</h3>
                <p className="text-slate-600 text-sm">{useCase.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION F — What the AI evaluates */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              What the AI evaluates
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Every evaluation covers the dimensions that matter for reaching agreement.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mx-auto">
            {[
              'Commercial alignment',
              'Pricing and value expectations',
              'Timeline compatibility',
              'Implementation or integration risk',
              'Decision readiness',
              'Missing information',
              'Likely blockers',
              'Negotiation tradeoffs',
            ].map((item, index) => (
              <motion.div
                key={item}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                viewport={{ once: true }}
                className="flex items-center gap-3 bg-slate-50 rounded-xl px-5 py-4 border border-slate-100"
              >
                <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="text-sm font-medium text-slate-700">{item}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION G — FAQ */}
      <FAQSection />

      {/* SECTION H — Final CTA */}
      <section className="py-24 bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
            Start negotiating with structure, not broker fees
          </h2>
          <p className="text-lg text-slate-400 mb-10 max-w-2xl mx-auto">
            Create your first opportunity in minutes. No commitment required.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              size="lg"
              onClick={handleStartFree}
              className="bg-white text-slate-900 hover:bg-slate-100 px-8 py-6 text-lg h-auto"
            >
              Start Free
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
            <Link to={ctaLink}>
              <Button
                variant="outline"
                size="lg"
                className="px-8 py-6 text-lg h-auto border-white/30 text-white hover:bg-white/10 bg-transparent"
              >
                Try AI Deal Mediator
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Product UI Mockups ─────────────────────────────────────────────

function MockupWindow({ title, actions, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
      <div className="bg-slate-900 px-4 py-3 flex items-center gap-3">
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-600" />
          <span className="w-2.5 h-2.5 rounded-full bg-slate-600" />
          <span className="w-2.5 h-2.5 rounded-full bg-slate-600" />
        </div>
        <span className="text-xs text-slate-400 font-medium flex-1 text-center">{title}</span>
        {actions && <div className="flex gap-1.5">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

function Step1Mockup() {
  return (
    <MockupWindow title="PreMarket — New Opportunity">
      <div className="p-5 bg-slate-50 space-y-3.5">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Opportunity Title</p>
          <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700">
            SaaS platform acquisition — initial terms
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Counterparty</p>
          <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-400">
            counterparty@company.com
          </div>
        </div>
        {/* Confidential panel */}
        <div className="rounded-xl border border-amber-200 overflow-hidden">
          <div className="px-3.5 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-amber-600" />
            <span className="text-xs font-bold text-amber-800 uppercase tracking-wide">Confidential Information</span>
            <span className="ml-auto text-xs text-amber-500">Only you &amp; AI</span>
          </div>
          <div className="px-3.5 py-3 bg-amber-50/60 space-y-2">
            {['Walk-away price: $1.8M', 'Must close before Q2 2026', 'Board approval required above $2M'].map(item => (
              <div key={item} className="flex items-start gap-2 text-xs text-amber-900">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                {item}
              </div>
            ))}
          </div>
        </div>
        {/* Shared panel */}
        <div className="rounded-xl border border-blue-200 overflow-hidden">
          <div className="px-3.5 py-2.5 bg-blue-50 border-b border-blue-200 flex items-center gap-2">
            <Eye className="w-3.5 h-3.5 text-blue-600" />
            <span className="text-xs font-bold text-blue-800 uppercase tracking-wide">Shared Information</span>
            <span className="ml-auto text-xs text-blue-500">Visible to counterparty</span>
          </div>
          <div className="px-3.5 py-3 bg-blue-50/60 space-y-2">
            {['Acquisition of B2B SaaS product', 'Target valuation: $2M – $3.5M', 'Integration timeline: 6 months post-close'].map(item => (
              <div key={item} className="flex items-start gap-2 text-xs text-blue-900">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </MockupWindow>
  );
}

function Step2Mockup() {
  return (
    <MockupWindow title="PreMarket — AI Mediation Review">
      <div className="p-5 bg-slate-50 space-y-3">
        {/* Metadata row */}
        <div className="bg-white rounded-xl border border-slate-100 px-4 py-3 flex flex-wrap gap-x-5 gap-y-2">
          {[
            { label: 'Recommendation', value: 'Proceed', cls: 'text-slate-700' },
            { label: 'Confidence', value: '84%', cls: 'text-slate-700' },
            { label: 'Status', value: 'Ready', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200 border rounded px-2' },
            { label: 'Open Items', value: '3 items', cls: 'bg-amber-100 text-amber-700 border-amber-200 border rounded px-2' },
          ].map(({ label, value, cls }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
              <span className={`text-xs font-medium ${cls}`}>{value}</span>
            </div>
          ))}
        </div>
        {/* Report paper */}
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-4 space-y-3.5">
          <div>
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Commercial Alignment</h4>
            <p className="text-xs text-slate-700 leading-relaxed">Both sides show alignment on acquisition structure. The buyer's target range overlaps with the seller's floor, suggesting a viable pricing zone.</p>
          </div>
          <div className="border-t border-slate-100 pt-3">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Key Gaps</h4>
            <ul className="space-y-1.5">
              {['Pricing expectations diverge by ~15%', 'Integration timeline not yet specified by either party'].map(item => (
                <li key={item} className="flex items-start gap-1.5 text-xs text-slate-700">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-slate-100 pt-3">
            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Open Questions</h4>
            <ul className="space-y-1.5">
              {['IP ownership and transfer scope not addressed', 'Payment structure and milestone conditions unclear'].map(item => (
                <li key={item} className="flex items-start gap-1.5 text-xs text-slate-700">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </MockupWindow>
  );
}

function Step3Mockup() {
  return (
    <MockupWindow
      title="PreMarket — Mediation Report"
      actions={<span className="text-[10px] bg-slate-700 text-slate-300 px-2 py-0.5 rounded">Download PDF</span>}
    >
      <div className="p-5 bg-slate-50 space-y-3">
        <div className="bg-white rounded-xl border border-slate-100 px-4 py-3">
          <div className="text-sm font-bold text-slate-900 mb-0.5">SaaS platform acquisition — initial terms</div>
          <div className="text-xs text-slate-500">Both parties submitted · AI Mediation Review ready</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 px-4 py-4">
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Areas of Alignment</h4>
          <ul className="space-y-2">
            {[
              'Acquisition structure is acceptable to both parties',
              'Target timeline overlaps within a 6-week window',
              'Both sides open to a staged integration approach',
            ].map(item => (
              <li key={item} className="flex items-start gap-2 text-xs text-slate-700">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 px-4 py-4">
          <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Suggested Next Steps</h4>
          <ul className="space-y-2">
            {[
              'Narrow pricing gap with a midpoint counteroffer',
              'Agree on IP transfer scope before progressing',
              'Both sides to provide integration timeline estimate',
            ].map((item, i) => (
              <li key={item} className="flex items-start gap-2 text-xs text-slate-700">
                <span className="text-xs font-bold text-blue-500 shrink-0 mt-0.5">{i + 1}.</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </MockupWindow>
  );
}

function ConfidentialityMockup() {
  return (
    <MockupWindow title="PreMarket — Opportunity Details">
      <div className="p-5 bg-slate-50">
        <div className="grid grid-cols-2 gap-3">
          {/* Confidential panel */}
          <div className="rounded-xl border border-amber-200 overflow-hidden">
            <div className="px-3 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-1.5">
              <Lock className="w-3 h-3 text-amber-700" />
              <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wide">Confidential Information</span>
            </div>
            <div className="px-3 py-3 bg-amber-50/50 space-y-1.5">
              {['Walk-away price: $1.8M', 'Close deadline: Q1 2026', 'Board threshold: $2M', 'Negotiation authority: CEO'].map(item => (
                <div key={item} className="flex items-center gap-1.5 text-[11px] text-amber-900">
                  <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />
                  {item}
                </div>
              ))}
              <div className="pt-2 mt-1 border-t border-amber-200">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600">
                  <EyeOff className="w-3 h-3" /> Hidden from counterparty
                </span>
              </div>
            </div>
          </div>
          {/* Shared panel */}
          <div className="rounded-xl border border-blue-200 overflow-hidden">
            <div className="px-3 py-2.5 bg-blue-50 border-b border-blue-200 flex items-center gap-1.5">
              <Eye className="w-3 h-3 text-blue-700" />
              <span className="text-[10px] font-bold text-blue-800 uppercase tracking-wide">Shared Information</span>
            </div>
            <div className="px-3 py-3 bg-blue-50/50 space-y-1.5">
              {['Acquisition of B2B SaaS', 'Target valuation: $2M–$3.5M', 'Integration: 6 months', 'Preferred structure: cash deal'].map(item => (
                <div key={item} className="flex items-center gap-1.5 text-[11px] text-blue-900">
                  <span className="w-1 h-1 rounded-full bg-blue-400 shrink-0" />
                  {item}
                </div>
              ))}
              <div className="pt-2 mt-1 border-t border-blue-200">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600">
                  <Eye className="w-3 h-3" /> Visible to counterparty
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MockupWindow>
  );
}

const faqItems = [
  {
    question: 'Is PreMarket a broker or advisor?',
    answer:
      'No. PreMarket is an information platform that provides AI-assisted deal analysis. It does not act as a broker, advisor, or intermediary, and it does not handle transactions or provide financial advice.',
  },
  {
    question: 'Can the other side see my confidential information?',
    answer:
      'No. Confidential inputs are never shared with the counterparty. They are used only to improve the quality and relevance of the neutral AI evaluation that both sides receive.',
  },
  {
    question: 'Do both sides need to join?',
    answer:
      'For a full two-sided evaluation, yes. However, you can start by submitting your own position first. The evaluation improves once both sides have provided their inputs.',
  },
  {
    question: 'What kinds of deals can I use this for?',
    answer:
      'PreMarket is designed for any bilateral negotiation where two parties need to evaluate terms — including M&A, vendor procurement, strategic partnerships, and investment discussions.',
  },
  {
    question: 'How does the AI negotiate fairly?',
    answer:
      'The AI evaluates both positions using the same neutral framework. It does not optimize for either side or weight one party\'s inputs more heavily. The output highlights alignment, gaps, and risks equally so both sides get the same quality of analysis.',
  },
];

function FAQSection() {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <section className="py-24 bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
            Frequently asked questions
          </h2>
        </div>

        <div className="space-y-3">
          {faqItems.map((item, index) => {
            const isOpen = openIndex === index;
            return (
              <motion.div
                key={item.question}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                viewport={{ once: true }}
                className="bg-white rounded-xl border border-slate-100 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  className="w-full flex items-center justify-between px-6 py-5 text-left"
                >
                  <span className="text-base font-medium text-slate-900 pr-4">
                    {item.question}
                  </span>
                  <ChevronDown
                    className={`w-5 h-5 text-slate-400 shrink-0 transition-transform duration-200 ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-6 pb-5">
                    <p className="text-slate-600 text-sm leading-relaxed">{item.answer}</p>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
