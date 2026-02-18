import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { billingClient } from '@/api/billingClient';

export default function BillingDb() {
  const { data: billing, isLoading, refetch } = useQuery({
    queryKey: ['db-billing'],
    queryFn: () => billingClient.get(),
  });

  const [formState, setFormState] = useState({
    plan_tier: 'starter',
    subscription_status: 'inactive',
    stripe_customer_id: '',
    stripe_subscription_id: '',
  });

  React.useEffect(() => {
    if (!billing) return;
    setFormState({
      plan_tier: billing.plan_tier || 'starter',
      subscription_status: billing.subscription_status || 'inactive',
      stripe_customer_id: billing.stripe_customer_id || '',
      stripe_subscription_id: billing.stripe_subscription_id || '',
    });
  }, [billing]);

  const updateMutation = useMutation({
    mutationFn: () => billingClient.update(formState),
    onSuccess: () => {
      refetch();
    },
  });

  const setField = (key, value) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Billing References</h1>
          <p className="text-sm text-slate-500">Store and read subscription reference fields in Postgres.</p>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>Billing Record</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading && <p className="text-sm text-slate-500">Loading billing references...</p>}

            <div className="space-y-2">
              <Label htmlFor="plan-tier">Plan</Label>
              <Input
                id="plan-tier"
                value={formState.plan_tier}
                onChange={(event) => setField('plan_tier', event.target.value)}
                placeholder="starter"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subscription-status">Subscription Status</Label>
              <Input
                id="subscription-status"
                value={formState.subscription_status}
                onChange={(event) => setField('subscription_status', event.target.value)}
                placeholder="inactive"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stripe-customer">Stripe Customer ID</Label>
              <Input
                id="stripe-customer"
                value={formState.stripe_customer_id}
                onChange={(event) => setField('stripe_customer_id', event.target.value)}
                placeholder="cus_..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stripe-subscription">Stripe Subscription ID</Label>
              <Input
                id="stripe-subscription"
                value={formState.stripe_subscription_id}
                onChange={(event) => setField('stripe_subscription_id', event.target.value)}
                placeholder="sub_..."
              />
            </div>

            {updateMutation.error && (
              <p className="text-sm text-red-600">{updateMutation.error.message}</p>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => refetch()}>
                Refresh
              </Button>
              <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Saving...' : 'Save Billing References'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
