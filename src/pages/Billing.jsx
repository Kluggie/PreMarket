import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { billingClient } from '@/api/billingClient';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CreditCard, CheckCircle2, AlertCircle, Loader2, Calendar, Zap } from 'lucide-react';
import { PLAN_FEATURES } from '@/lib/planFeatures';

function formatDate(value) {
  if (!value) return null;
  try {
    return format(new Date(value), 'MMM d, yyyy');
  } catch {
    return null;
  }
}

export default function Billing() {
  const queryClient = useQueryClient();

  const {
    data: billing,
    isLoading,
    refetch,
    error,
  } = useQuery({
    queryKey: ['billing-status'],
    queryFn: () => billingClient.get(),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgrade') === 'success') {
      refetch();
      window.history.replaceState({}, '', createPageUrl('Billing'));
    }
  }, [refetch]);

  const checkoutMutation = useMutation({
    mutationFn: () => billingClient.checkout(),
    onSuccess: (payload) => {
      queryClient.invalidateQueries({ queryKey: ['billing-status'] });
      const checkoutUrl = payload?.checkout?.url || null;
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
      }
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => billingClient.cancel(),
    onSuccess: (data) => {
      // Immediately update the cache with the fresh billing object returned by the
      // cancel route (which already has currentPeriodEnd written) so the date
      // appears instantly without a second round-trip.
      if (data) {
        queryClient.setQueryData(['billing-status'], data);
      }
      queryClient.invalidateQueries({ queryKey: ['billing-status'] });
    },
  });

  const handleCancel = () => {
    const confirmed = window.confirm(
      'Cancel subscription at period end? You will keep Professional access until the current billing period ends.',
    );
    if (!confirmed) return;
    cancelMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Alert className="bg-red-50 border-red-200">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">{error.message}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const planTier = billing?.plan_tier || 'starter';
  const isProfessional = planTier === 'professional';
  const isActive = billing?.subscription_status === 'active';
  const cancelAtPeriodEnd = Boolean(billing?.cancel_at_period_end);
  const periodEnd = formatDate(billing?.current_period_end);

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Billing & Subscription</h1>
          <p className="text-slate-500 mt-1">Manage your plan and billing information.</p>
        </div>

        <div className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-slate-400" />
                Current Plan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="text-2xl font-bold text-slate-900 capitalize">{planTier}</h3>
                    {isProfessional && isActive ? (
                      <Badge className="bg-green-100 text-green-700">Active</Badge>
                    ) : null}
                    {isProfessional && cancelAtPeriodEnd ? (
                      <Badge className="bg-amber-100 text-amber-700">Cancels Soon</Badge>
                    ) : null}
                    {billing?.subscription_status === 'past_due' ? (
                      <Badge className="bg-red-100 text-red-700">Past Due</Badge>
                    ) : null}
                  </div>
                  <p className="text-sm text-slate-500 mt-1">
                    {isProfessional ? '$0.01 per month' : 'Free forever'}
                  </p>
                </div>
                <div className="text-right">
                  {isProfessional && periodEnd ? (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Calendar className="w-4 h-4" />
                      {cancelAtPeriodEnd ? 'Cancels on' : 'Renews'} {periodEnd}
                    </div>
                  ) : null}
                </div>
              </div>

              {cancelAtPeriodEnd && periodEnd ? (
                <Alert className="bg-amber-50 border-amber-200">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-800">
                    Your subscription will end on {periodEnd}. You will automatically downgrade to
                    Starter afterwards.
                  </AlertDescription>
                </Alert>
              ) : null}

              {billing?.subscription_status === 'past_due' ? (
                <Alert className="bg-red-50 border-red-200">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-800">
                    Payment failed. Update your billing method in Stripe to keep Professional access.
                  </AlertDescription>
                </Alert>
              ) : null}

              {checkoutMutation.error ? (
                <Alert className="bg-red-50 border-red-200">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-800">
                    {checkoutMutation.error.message}
                  </AlertDescription>
                </Alert>
              ) : null}

              {cancelMutation.error ? (
                <Alert className="bg-red-50 border-red-200">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-800">
                    {cancelMutation.error.message}
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="flex gap-3 pt-2 flex-wrap">
                {!isProfessional ? (
                  <Button
                    onClick={() => checkoutMutation.mutate()}
                    disabled={checkoutMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {checkoutMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 mr-2" />
                        Upgrade to Professional
                      </>
                    )}
                  </Button>
                ) : null}
                {isProfessional && !cancelAtPeriodEnd ? (
                  <Button
                    onClick={handleCancel}
                    disabled={cancelMutation.isPending}
                    variant="outline"
                    className="text-red-600 border-red-200 hover:bg-red-50"
                  >
                    {cancelMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Canceling...
                      </>
                    ) : (
                      'Cancel Subscription'
                    )}
                  </Button>
                ) : null}
                <Link to={createPageUrl('Pricing')}>
                  <Button variant="outline">View All Plans</Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Plan Features</CardTitle>
              <CardDescription>What is included in your current plan</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {PLAN_FEATURES[planTier]
                  ? PLAN_FEATURES[planTier].map((f) => (
                      <Feature key={f.text} text={f.text} detail={f.detail} />
                    ))
                  : PLAN_FEATURES.starter.map((f) => (
                      <Feature key={f.text} text={f.text} detail={f.detail} />
                    ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Feature({ text, detail }) {
  return (
    <div className="flex items-start gap-3">
      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
      <div>
        <p className="font-medium">{text}</p>
        <p className="text-sm text-slate-500">{detail}</p>
      </div>
    </div>
  );
}
