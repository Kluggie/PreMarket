import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { createPageUrl } from '@/utils';
import { authClient } from '@/api/authClient';
import { contactClient } from '@/api/contactClient';
import { betaClient } from '@/api/betaClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, X, Zap, Building2, Shield } from 'lucide-react';
import { toast } from 'sonner';

export default function Pricing() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showContactSales, setShowContactSales] = useState(false);
  const [salesFormData, setSalesFormData] = useState({
    name: '',
    email: '',
    organization: '',
    message: '',
  });
  const [betaEmail, setBetaEmail] = useState('');
  const [betaSubmitted, setBetaSubmitted] = useState(false);
  const [betaAlreadySignedUp, setBetaAlreadySignedUp] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!user?.email) {
      return;
    }

    setSalesFormData((prev) => ({
      ...prev,
      name: prev.name || user.full_name || user.name || '',
      email: prev.email || user.email,
    }));
    setBetaEmail((prev) => prev || user.email || '');
  }, [user]);

  const {
    data: betaCount,
    isPending: betaCountLoading,
    isError: betaCountError,
  } = useQuery({
    queryKey: ['beta-signups-stats'],
    queryFn: () => betaClient.getCount(),
    // Retry 2x with exponential back-off before declaring failure.
    // This prevents transient network hiccups from showing a misleading zero.
    retry: 2,
  });

  // IMPORTANT: only use the DB-derived value when the query has actually
  // succeeded. Never fall back to a static "0" — that is indistinguishable
  // from "data was reset" and has previously caused support confusion.
  const betaCountReady = !betaCountLoading && !betaCountError && betaCount != null;
  const betaSeatsTotal = betaCountReady ? Number(betaCount.limit || 50) : 50;
  const betaSeatsClaimed = betaCountReady ? Number(betaCount.claimed ?? 0) : null;
  const betaProgress = betaCountReady
    ? Math.min(100, Math.round(((betaCount.claimed ?? 0) / Math.max(betaSeatsTotal, 1)) * 100))
    : 0;

  const submitSalesMutation = useMutation({
    mutationFn: async (data) =>
      contactClient.submit({
        name: data.name,
        email: data.email,
        organization: data.organization || '',
        reason: 'sales',
        message: data.message || 'Sales inquiry submitted from Pricing page.',
      }),
    onSuccess: () => {
      setSubmitted(true);
      setSalesFormData((prev) => ({ ...prev, organization: '', message: '' }));
      setTimeout(() => {
        setShowContactSales(false);
        setSubmitted(false);
      }, 1800);
    },
  });

  const applyBetaMutation = useMutation({
    mutationFn: (email) => betaClient.apply({ email, source: 'pricing' }),
    onSuccess: () => {
      setBetaSubmitted(true);
      setBetaAlreadySignedUp(false);
      toast.success("You're in!");
      queryClient.invalidateQueries({ queryKey: ['beta-signups-stats'] });
    },
    onError: (error) => {
      if (error?.code === 'already_signed_up') {
        setBetaSubmitted(false);
        setBetaAlreadySignedUp(true);
        toast("You're already signed up.");
        queryClient.invalidateQueries({ queryKey: ['beta-signups-stats'] });
        return;
      }

      setBetaAlreadySignedUp(false);
      toast.error(error?.message || 'Unable to submit your beta request right now.');
    },
  });

  const plans = [
    {
      name: 'Starter',
      price: '$0',
      period: 'Forever free',
      description: 'Perfect for individuals exploring pre-qualification.',
      icon: Zap,
      color: 'from-slate-500 to-slate-600',
      features: [
        { text: '3 opportunities per month', included: true },
        { text: 'AI evaluation report', included: true },
        { text: 'Limited re-evaluation per opportunity', included: true },
        { text: 'Pseudonymous mode', included: true },
        { text: 'Email support', included: true },
        { text: 'Organization profiles', included: true },
      ],
      cta: 'Get Started',
      popular: false,
    },
    {
      name: 'Professional',
      price: '$49.99',
      period: 'per month',
      description: 'For professionals who need more volume and features.',
      icon: Building2,
      color: 'from-blue-500 to-indigo-600',
      features: [
        { text: 'Unlimited opportunities', included: true },
        { text: 'Advanced AI negotiation', included: true },
        { text: 'Extended AI evaluation report', included: true },
        { text: 'Unlimited AI re-evaluations per opportunity', included: true },
        { text: 'Pseudonymous mode', included: true },
        { text: 'Priority support', included: true },
        { text: 'Organization profiles', included: true },
      ],
      cta: 'Start Subscription',
      popular: true,
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      period: 'contact us',
      description: 'For organizations with complex pre-qualification needs.',
      icon: Shield,
      color: 'from-indigo-500 to-purple-600',
      features: [
        { text: 'Unlimited opportunities', included: true },
        { text: 'Tailored / Fine-tuned AI negotiation', included: true },
        { text: 'Extended AI evaluation report', included: true },
        { text: 'Unlimited AI re-evaluations per opportunity', included: true },
        { text: 'Pseudonymous submissions', included: true },
        { text: 'Priority support', included: true },
        { text: 'Organization profiles', included: true },
        { text: 'Custom security review + onboarding', included: true },
        { text: 'Advanced data analytics', included: true },
      ],
      cta: 'Contact Sales',
      popular: false,
    },
  ];

  const handleSalesSubmit = (event) => {
    event.preventDefault();
    submitSalesMutation.mutate(salesFormData);
  };

  const handleBetaApply = (event) => {
    event.preventDefault();
    const normalizedEmail = betaEmail.trim();
    if (!normalizedEmail) {
      toast.error('Please enter your email address.');
      return;
    }
    setBetaSubmitted(false);
    setBetaAlreadySignedUp(false);
    applyBetaMutation.mutate(normalizedEmail);
  };

  const handleCTA = async (plan) => {
    if (plan.name === 'Enterprise') {
      setShowContactSales(true);
      return;
    }

    if (plan.name === 'Starter') {
      authClient.redirectToLogin(createPageUrl('Dashboard'));
      return;
    }

    if (plan.name === 'Professional') {
      try {
        await authClient.me();
        navigate(createPageUrl('Billing'));
      } catch {
        authClient.redirectToLogin(createPageUrl('Billing'));
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <Badge className="mb-4 bg-blue-100 text-blue-700">Pricing</Badge>
          <h1 className="text-4xl font-bold text-slate-900 mb-4">Simple, transparent pricing</h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Start free and scale as you grow. No hidden fees, no surprises.
          </p>
          <p className="text-sm text-slate-500 mt-2">
            Upgrades apply immediately. Downgrades and cancellations take effect at the end of your
            billing period.
          </p>
        </div>

        <Card className="max-w-3xl mx-auto border-0 shadow-sm mb-10 bg-blue-50/60">
          <CardContent className="p-6 sm:p-7">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Beta program: 6 months free for the first 50 users</h2>
                <p className="text-sm text-slate-600 mt-2 max-w-2xl">
                  Beta members get early access to workflow updates and a direct feedback loop with the product team.
                </p>
              </div>
            </div>
            <div className="mt-5">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-slate-600">Beta seats claimed</span>
                <span className="font-semibold text-slate-900">
                  {betaCountLoading ? (
                    <span className="text-slate-400">Loading…</span>
                  ) : betaCountError ? (
                    <span className="text-slate-400" title="Could not load seat count — please refresh">—/50</span>
                  ) : (
                    `${betaSeatsClaimed}/${betaSeatsTotal}`
                  )}
                </span>
              </div>
              <Progress value={betaProgress} className="h-2 bg-white" />
            </div>
            <form onSubmit={handleBetaApply} className="mt-5 flex flex-col sm:flex-row gap-3">
              <Input
                type="email"
                value={betaEmail}
                onChange={(event) => setBetaEmail(event.target.value)}
                placeholder="you@company.com"
                required
                className="bg-white"
              />
              <Button type="submit" variant="outline" disabled={applyBetaMutation.isPending}>
                {applyBetaMutation.isPending ? 'Applying...' : 'Apply for Beta'}
              </Button>
            </form>
            {betaSubmitted ? (
              <p className="text-sm text-blue-700 mt-2">You&apos;re in!</p>
            ) : null}
            {betaAlreadySignedUp ? (
              <p className="text-sm text-slate-700 mt-2">You&apos;re already signed up.</p>
            ) : null}
            {applyBetaMutation.error && applyBetaMutation.error.code !== 'already_signed_up' ? (
              <p className="text-sm text-red-600 mt-2">
                {applyBetaMutation.error.message || 'Unable to submit your beta request right now.'}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="relative"
            >
              {plan.popular ? (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
                  <Badge className="bg-blue-600 text-white px-4 py-1">Most Popular</Badge>
                </div>
              ) : null}
              <Card className={`h-full ${plan.popular ? 'border-2 border-blue-500 shadow-lg' : 'border-0 shadow-sm'}`}>
                <CardHeader className="text-center pb-2">
                  <div
                    className={`w-12 h-12 rounded-xl bg-gradient-to-br ${plan.color} flex items-center justify-center mx-auto mb-4`}
                  >
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
                    {plan.features.map((feature) => (
                      <li key={`${plan.name}-${feature.text}`} className="flex items-start gap-3">
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

        <div className="mt-20 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-slate-900 text-center mb-8">Frequently Asked Questions</h2>
          <div className="space-y-4">
            {[
              {
                q: 'Can I change plans later?',
                a: 'Yes. Upgrades apply immediately. Downgrades and cancellations apply at the end of your current period.',
              },
              {
                q: 'Do recipients need to pay or create an account?',
                a: 'No. Recipients can view and respond via the share link. An account is only required to create opportunities and manage negotiations.',
              },
              {
                q: 'What counts toward my plan limits?',
                a: 'Only actions taken by the opportunity owner count toward your plan (creating opportunities and running AI evaluations). Recipient viewing/responding does not use the recipient\'s plan.',
              },
              {
                q: 'How is confidential information protected?',
                a: 'Confidential fields are hidden by default. They only become shared when you explicitly move them into Shared information.',
              },
              {
                q: 'Is the AI giving legal/financial advice?',
                a: 'No. PreMarket provides negotiation support and structured analysis — it isn’t legal, financial, or brokerage advice.',
              },
              {
                q: 'Can I revoke a share link after sending it?',
                a: 'Share links should be treated like forwarded emails: once sent, you can’t fully retract them. Only share with trusted recipients.',
              },
            ].map((faq) => (
              <Card key={faq.q} className="border-0 shadow-sm">
                <CardContent className="p-6">
                  <h3 className="font-semibold text-slate-900 mb-2">{faq.q}</h3>
                  <p className="text-slate-600">{faq.a}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="mt-12 text-center">
          <Link to={createPageUrl('Billing')}>
            <Button variant="outline">Manage current subscription</Button>
          </Link>
        </div>

        <Dialog open={showContactSales} onOpenChange={setShowContactSales}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Contact Sales</DialogTitle>
              <DialogDescription>
                Share your requirements and we will follow up with a tailored plan.
              </DialogDescription>
            </DialogHeader>

            {submitted ? (
              <div className="py-8 text-center">
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Request Sent</h3>
                <p className="text-slate-600">We will contact you shortly.</p>
              </div>
            ) : (
              <form onSubmit={handleSalesSubmit} className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="sales-name">Name</Label>
                  <Input
                    id="sales-name"
                    value={salesFormData.name}
                    onChange={(event) =>
                      setSalesFormData((prev) => ({ ...prev, name: event.target.value }))
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sales-email">Email</Label>
                  <Input
                    id="sales-email"
                    type="email"
                    value={salesFormData.email}
                    onChange={(event) =>
                      setSalesFormData((prev) => ({ ...prev, email: event.target.value }))
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sales-org">Organization</Label>
                  <Input
                    id="sales-org"
                    value={salesFormData.organization}
                    onChange={(event) =>
                      setSalesFormData((prev) => ({ ...prev, organization: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sales-message">Message</Label>
                  <Textarea
                    id="sales-message"
                    rows={4}
                    value={salesFormData.message}
                    onChange={(event) =>
                      setSalesFormData((prev) => ({ ...prev, message: event.target.value }))
                    }
                    required
                  />
                </div>

                {submitSalesMutation.error ? (
                  <p className="text-sm text-red-600">{submitSalesMutation.error.message}</p>
                ) : null}

                <div className="flex justify-end gap-3 pt-2">
                  <Button type="button" variant="outline" onClick={() => setShowContactSales(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitSalesMutation.isPending}>
                    {submitSalesMutation.isPending ? 'Sending...' : 'Send Request'}
                  </Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
