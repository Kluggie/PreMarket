import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@17.5.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'), {
  apiVersion: '2024-12-18.acacia'
});

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!user.stripe_subscription_id) {
      return Response.json({ error: 'No active subscription' }, { status: 400 });
    }

    // Cancel at period end (don't cancel immediately)
    const subscription = await stripe.subscriptions.update(
      user.stripe_subscription_id,
      {
        cancel_at_period_end: true
      }
    );

    // Update user record
    await base44.asServiceRole.entities.User.update(user.id, {
      cancel_at_period_end: true,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
    });

    return Response.json({ 
      success: true,
      period_end: subscription.current_period_end
    });
  } catch (error) {
    console.error('Cancel error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});