import React, { useState, useEffect } from 'react';
import { authClient } from '@/api/authClient';
import { legacyClient } from '@/api/legacyClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CreditCard, CheckCircle2, AlertCircle, Loader2, Calendar, Zap } from 'lucide-react';
import { format } from 'date-fns';
import { createPageUrl } from '../utils';
import { Link } from 'react-router-dom';

export default function Billing() {
  const [user, setUser] = useState(null);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    authClient.me().then(setUser);
  }, []);

  const { data: freshUser, refetch } = useQuery({
    queryKey: ['user', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const users = await legacyClient.entities.User.filter({ id: user.id });
      return users[0] || user;
    },
    enabled: !!user?.id
  });

  const currentUser = freshUser || user;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgrade') === 'success') {
      refetch();
      window.history.replaceState({}, '', createPageUrl('Billing'));
    }
  }, []);

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const response = await legacyClient.functions.invoke('cancelSubscription');
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['user']);
      refetch();
    }
  });

  const handleUpgrade = async () => {
    setIsUpgrading(true);
    try {
      const response = await legacyClient.functions.invoke('createCheckoutSession');
      if (response.data.url) {
        window.location.href = response.data.url;
      }
    } catch (error) {
      console.error('Upgrade error:', error);
      alert('Failed to start checkout. Please try again.');
      setIsUpgrading(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel? You will keep Professional access until the end of your billing period, then automatically downgrade to Starter.')) {
      return;
    }
    cancelMutation.mutate();
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  const planTier = currentUser.plan_tier || 'starter';
  const isProfessional = planTier === 'professional';
  const isActive = currentUser.subscription_status === 'active';
  const cancelAtPeriodEnd = currentUser.cancel_at_period_end;
  const periodEnd = currentUser.current_period_end;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Billing & Subscription</h1>
          <p className="text-slate-500 mt-1">Manage your plan and billing information.</p>
        </div>

        <div className="space-y-6">
          {/* Current Plan */}
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
                  <div className="flex items-center gap-3">
                    <h3 className="text-2xl font-bold text-slate-900 capitalize">{planTier}</h3>
                    {isProfessional && isActive && (
                      <Badge className="bg-green-100 text-green-700">Active</Badge>
                    )}
                    {isProfessional && cancelAtPeriodEnd && (
                      <Badge className="bg-amber-100 text-amber-700">Cancels Soon</Badge>
                    )}
                    {currentUser.subscription_status === 'past_due' && (
                      <Badge className="bg-red-100 text-red-700">Past Due</Badge>
                    )}
                  </div>
                  {isProfessional && (
                    <p className="text-sm text-slate-500 mt-1">$49 per month</p>
                  )}
                  {!isProfessional && (
                    <p className="text-sm text-slate-500 mt-1">Free forever</p>
                  )}
                </div>
                <div className="text-right">
                  {isProfessional && periodEnd && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Calendar className="w-4 h-4" />
                      {cancelAtPeriodEnd ? 'Ends' : 'Renews'} {format(new Date(periodEnd), 'MMM d, yyyy')}
                    </div>
                  )}
                </div>
              </div>

              {cancelAtPeriodEnd && (
                <Alert className="bg-amber-50 border-amber-200">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-800">
                    Your subscription will end on {format(new Date(periodEnd), 'MMMM d, yyyy')}. 
                    You will keep Professional features until then, and automatically downgrade to Starter.
                  </AlertDescription>
                </Alert>
              )}

              {currentUser.subscription_status === 'past_due' && (
                <Alert className="bg-red-50 border-red-200">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-800">
                    Your payment failed. Please update your payment method in Stripe to keep your Professional access.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex gap-3 pt-2">
                {!isProfessional && (
                  <Button 
                    onClick={handleUpgrade}
                    disabled={isUpgrading}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {isUpgrading ? (
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
                )}
                {isProfessional && !cancelAtPeriodEnd && (
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
                )}
                <Link to={createPageUrl('Pricing')}>
                  <Button variant="outline">View All Plans</Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Plan Features */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle>Plan Features</CardTitle>
              <CardDescription>What's included in your current plan</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {isProfessional ? (
                  <>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">Unlimited proposals per month</p>
                        <p className="text-sm text-slate-500">Create as many proposals as you need</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">3 re-evaluations per proposal</p>
                        <p className="text-sm text-slate-500">Update and re-run evaluations</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">All templates</p>
                        <p className="text-sm text-slate-500">Access to all pre-qualification templates</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">Organization profiles</p>
                        <p className="text-sm text-slate-500">Create and manage organization profiles</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">Priority support</p>
                        <p className="text-sm text-slate-500">Get faster responses from our team</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">3 proposals per month</p>
                        <p className="text-sm text-slate-500">Perfect for getting started</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">1 re-evaluation per proposal</p>
                        <p className="text-sm text-slate-500">Update and re-run evaluations once</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">All templates</p>
                        <p className="text-sm text-slate-500">Access to all pre-qualification templates</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">AI evaluation reports</p>
                        <p className="text-sm text-slate-500">Full access to AI-powered evaluations</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">Email support</p>
                        <p className="text-sm text-slate-500">Get help when you need it</p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Billing Info */}
          <Card className="border-0 shadow-sm bg-slate-50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-slate-600">
                  <p className="font-medium mb-1">Billing Information</p>
                  <p>• Upgrades take effect immediately</p>
                  <p>• Downgrades and cancellations take effect at the end of your billing period</p>
                  <p>• You keep access to Professional features until your period ends</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}