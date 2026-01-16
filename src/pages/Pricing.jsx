import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { base44 } from '@/api/base44Client';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, X, Zap, Building2, Shield } from 'lucide-react';

export default function Pricing() {
  const [showContactSales, setShowContactSales] = useState(false);
  const [salesFormData, setSalesFormData] = useState({
    name: '',
    email: '',
    organization: '',
    message: ''
  });
  const [submitted, setSubmitted] = useState(false);

  const submitSalesMutation = useMutation({
    mutationFn: async (data) => {
      return base44.entities.ContactRequest.create({
        ...data,
        type: 'sales',
        reason: 'sales',
        status: 'new'
      });
    },
    onSuccess: () => {
      setSubmitted(true);
      setSalesFormData({ name: '', email: '', organization: '', message: '' });
      setTimeout(() => {
        setShowContactSales(false);
        setSubmitted(false);
      }, 2000);
    }
  });

  const handleSalesSubmit = (e) => {
    e.preventDefault();
    submitSalesMutation.mutate(salesFormData);
  };

  const plans = [
    {
      name: 'Starter',
      price: '$0',
      period: 'Forever free',
      description: 'Perfect for individuals exploring pre-qualification.',
      icon: Zap,
      color: 'from-slate-500 to-slate-600',
      features: [
        { text: '3 proposals per month', included: true },
        { text: 'Basic templates', included: true },
        { text: 'AI evaluation reports', included: true },
        { text: 'Pseudonymous mode', included: true },
        { text: 'Email support', included: true },
        { text: 'Organization profiles', included: false },
        { text: 'Custom templates', included: false },
        { text: 'API access', included: false }
      ],
      cta: 'Get Started',
      popular: false
    },
    {
      name: 'Professional',
      price: '$49',
      period: 'per month',
      description: 'For professionals who need more volume and features.',
      icon: Building2,
      color: 'from-blue-500 to-indigo-600',
      features: [
        { text: 'Unlimited proposals', included: true },
        { text: 'All templates', included: true },
        { text: 'Advanced AI evaluation', included: true },
        { text: 'Pseudonymous mode', included: true },
        { text: 'Priority support', included: true },
        { text: 'Organization profiles', included: true },
        { text: 'Custom templates', included: false },
        { text: 'API access', included: false }
      ],
      cta: 'Start Free Trial',
      popular: true
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      period: 'contact us',
      description: 'For organizations with complex pre-qualification needs.',
      icon: Shield,
      color: 'from-indigo-500 to-purple-600',
      features: [
        { text: 'Unlimited proposals', included: true },
        { text: 'All templates', included: true },
        { text: 'Advanced AI evaluation', included: true },
        { text: 'Pseudonymous mode', included: true },
        { text: 'Dedicated support', included: true },
        { text: 'Organization profiles', included: true },
        { text: 'Custom templates', included: true },
        { text: 'API access', included: true }
      ],
      cta: 'Contact Sales',
      popular: false
    }
  ];

  const handleCTA = (plan) => {
    if (plan.name === 'Enterprise') {
      setShowContactSales(true);
    } else {
      base44.auth.redirectToLogin(createPageUrl('Dashboard'));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <Badge className="mb-4 bg-blue-100 text-blue-700">Pricing</Badge>
          <h1 className="text-4xl font-bold text-slate-900 mb-4">
            Simple, transparent pricing
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Start free and scale as you grow. No hidden fees, no surprises.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="relative"
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
                  <Badge className="bg-blue-600 text-white px-4 py-1">Most Popular</Badge>
                </div>
              )}
              <Card className={`h-full ${plan.popular ? 'border-2 border-blue-500 shadow-lg' : 'border-0 shadow-sm'}`}>
                <CardHeader className="text-center pb-2">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${plan.color} flex items-center justify-center mx-auto mb-4`}>
                    <plan.icon className="w-6 h-6 text-white" />
                  </div>
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <p className="text-sm text-slate-500">{plan.description}</p>
                </CardHeader>
                <CardContent>
                  <div className="text-center mb-6">
                    <span className="text-4xl font-bold text-slate-900">{plan.price}</span>
                    <span className="text-slate-500 ml-2">{plan.period}</span>
                  </div>

                  <ul className="space-y-3 mb-8">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-3">
                        {feature.included ? (
                          <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                        ) : (
                          <X className="w-5 h-5 text-slate-300 flex-shrink-0 mt-0.5" />
                        )}
                        <span className={feature.included ? 'text-slate-700' : 'text-slate-400'}>
                          {feature.text}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <Button 
                    onClick={() => handleCTA(plan)}
                    className={`w-full ${plan.popular ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                    variant={plan.popular ? 'default' : 'outline'}
                  >
                    {plan.cta}
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* FAQ Section */}
        <div className="mt-20 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-slate-900 text-center mb-8">
            Frequently Asked Questions
          </h2>
          <div className="space-y-4">
            {[
              {
                q: 'What happens after my free trial?',
                a: 'After your 14-day trial, you can choose to upgrade to a paid plan or continue with the free Starter plan with limited features.'
              },
              {
                q: 'Can I change plans later?',
                a: 'Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately.'
              },
              {
                q: 'Is my data secure?',
                a: 'Yes, all data is encrypted at rest and in transit. We never share your information with third parties.'
              },
              {
                q: 'Do you offer refunds?',
                a: 'We offer a 30-day money-back guarantee on all paid plans. No questions asked.'
              }
            ].map((faq, i) => (
              <Card key={i} className="border-0 shadow-sm">
                <CardContent className="p-6">
                  <h3 className="font-semibold text-slate-900 mb-2">{faq.q}</h3>
                  <p className="text-slate-600">{faq.a}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Contact Sales Modal */}
        <Dialog open={showContactSales} onOpenChange={setShowContactSales}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Contact Sales</DialogTitle>
              <DialogDescription>
                Let us know more about your needs and we'll get in touch within 24 hours.
              </DialogDescription>
            </DialogHeader>
            
            {submitted ? (
              <div className="py-8 text-center">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <Check className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Message Sent!</h3>
                <p className="text-slate-600">Our sales team will contact you soon.</p>
              </div>
            ) : (
              <form onSubmit={handleSalesSubmit} className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="sales-name">Name *</Label>
                  <Input
                    id="sales-name"
                    required
                    value={salesFormData.name}
                    onChange={(e) => setSalesFormData({ ...salesFormData, name: e.target.value })}
                    placeholder="Your name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sales-email">Email *</Label>
                  <Input
                    id="sales-email"
                    type="email"
                    required
                    value={salesFormData.email}
                    onChange={(e) => setSalesFormData({ ...salesFormData, email: e.target.value })}
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sales-org">Organization *</Label>
                  <Input
                    id="sales-org"
                    required
                    value={salesFormData.organization}
                    onChange={(e) => setSalesFormData({ ...salesFormData, organization: e.target.value })}
                    placeholder="Your company"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sales-message">Message</Label>
                  <Textarea
                    id="sales-message"
                    value={salesFormData.message}
                    onChange={(e) => setSalesFormData({ ...salesFormData, message: e.target.value })}
                    placeholder="Tell us about your needs..."
                    className="min-h-[100px]"
                  />
                </div>
                <Button 
                  type="submit" 
                  disabled={submitSalesMutation.isPending}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  {submitSalesMutation.isPending ? 'Sending...' : 'Send Message'}
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}