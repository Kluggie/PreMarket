import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  Shield, ArrowRight, CheckCircle2, Lock, Eye, FileText, 
  Users, Zap, BarChart3, RefreshCw, ChevronRight
} from 'lucide-react';

export default function Landing() {
  const navigate = useNavigate();
  const [showCTAModal, setShowCTAModal] = useState(false);

  const handleStartFree = () => {
    setShowCTAModal(true);
  };

  const handleGuestProposal = () => {
    setShowCTAModal(false);
    navigate(createPageUrl('CreateProposal?guest=true'));
  };

  const handleSignIn = () => {
    setShowCTAModal(false);
    base44.auth.redirectToLogin(createPageUrl('CreateProposal'));
  };

  const features = [
    {
      icon: Shield,
      title: 'Privacy-First',
      description: 'Start pseudonymously. Reveal identity only when both parties agree through mutual consent.'
    },
    {
      icon: FileText,
      title: 'Structured Templates',
      description: 'Use industry-specific templates for M&A, recruiting, investment, and more.'
    },
    {
      icon: BarChart3,
      title: 'AI Evaluation',
      description: 'Get compatibility scores, red flags, and recommendations powered by AI analysis.'
    },
    {
      icon: RefreshCw,
      title: 'Verify & Re-evaluate',
      description: 'Recipients can verify claims, correct data, and trigger re-evaluation.'
    },
    {
      icon: Eye,
      title: 'Progressive Reveal',
      description: 'Three-gate system controls what information is visible at each stage.'
    },
    {
      icon: Lock,
      title: 'Range & Tokens',
      description: 'Share ranges instead of exact values. Use tokenized references for sensitive data.'
    }
  ];

  const steps = [
    { number: '01', title: 'Choose Template', description: 'Select from M&A, recruiting, investment, or custom templates.' },
    { number: '02', title: 'Fill & Control', description: 'Enter your data with granular visibility controls per field.' },
    { number: '03', title: 'AI Evaluation', description: 'Get instant compatibility score and detailed analysis.' },
    { number: '04', title: 'Verify & Reveal', description: 'Recipient verifies, both parties reveal when ready.' }
  ];

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/50" />
        <div className="absolute inset-0">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-200/20 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-200/20 rounded-full blur-3xl" />
        </div>
        
        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-[0.015]" 
          style={{ backgroundImage: 'radial-gradient(circle, #000 1px, transparent 1px)', backgroundSize: '24px 24px' }} 
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
                Privacy-Preserving Pre-Qualification
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-5xl sm:text-6xl lg:text-7xl font-bold text-slate-900 tracking-tight mb-6"
            >
              Verify Fit
              <br />
              <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                Before You Reveal
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-xl text-slate-600 max-w-2xl mx-auto mb-10"
            >
              Exchange structured proposals and evaluate compatibility through AI-powered assessments. 
              Reveal identity only when both parties are ready.
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
              <Link to={createPageUrl('Templates')}>
                <Button variant="outline" size="lg" className="px-8 py-6 text-lg h-auto border-slate-200">
                  Browse Templates
                </Button>
              </Link>
            </motion.div>

            {/* CTA Choice Modal */}
            <Dialog open={showCTAModal} onOpenChange={setShowCTAModal}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Get Started with PreMarket</DialogTitle>
                  <DialogDescription>
                    Choose how you'd like to begin your pre-qualification journey.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-4">
                  <Button 
                    onClick={handleGuestProposal}
                    variant="outline"
                    className="w-full h-auto py-4 justify-start"
                  >
                    <div className="text-left">
                      <p className="font-semibold">Create Proposal (Guest)</p>
                      <p className="text-xs text-slate-500">No account required • Email link to continue later</p>
                    </div>
                  </Button>
                  <Button 
                    onClick={handleSignIn}
                    className="w-full h-auto py-4 bg-blue-600 hover:bg-blue-700 justify-start"
                  >
                    <div className="text-left">
                      <p className="font-semibold">Sign In / Create Account</p>
                      <p className="text-xs text-blue-100">Full dashboard • Analytics • Manage proposals</p>
                    </div>
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Trust indicators */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="flex flex-wrap items-center justify-center gap-6 mt-16 text-sm text-slate-500"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                No broker fees
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                No transaction handling
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                No financial advice
              </div>
            </motion.div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-6 h-10 border-2 border-slate-300 rounded-full flex items-start justify-center pt-2"
          >
            <div className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              How PreMarket Works
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              A generalized bilateral trust-matching protocol for any pre-qualification scenario.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {steps.map((step, index) => (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                viewport={{ once: true }}
                className="relative"
              >
                {index < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-8 left-full w-full h-px bg-gradient-to-r from-blue-200 to-transparent z-0" />
                )}
                <div className="relative bg-slate-50 rounded-2xl p-6 h-full border border-slate-100 hover:border-blue-200 transition-colors">
                  <span className="text-4xl font-bold text-blue-100 mb-4 block">{step.number}</span>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">{step.title}</h3>
                  <p className="text-slate-600 text-sm">{step.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Built for Trust & Privacy
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Every feature designed to help parties evaluate compatibility while protecting sensitive information.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                viewport={{ once: true }}
                className="bg-white rounded-2xl p-8 border border-slate-100 hover:shadow-lg hover:border-blue-100 transition-all duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mb-6">
                  <feature.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-slate-900 mb-3">{feature.title}</h3>
                <p className="text-slate-600">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-slate-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
            Ready to start pre-qualifying?
          </h2>
          <p className="text-lg text-slate-400 mb-10 max-w-2xl mx-auto">
            Create your first proposal in minutes. No commitment required.
          </p>
          <Button 
            size="lg"
            onClick={handleStartFree}
            className="bg-white text-slate-900 hover:bg-slate-100 px-8 py-6 text-lg h-auto"
          >
            Get Started Free
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
        </div>
      </section>
    </div>
  );
}