import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@17.5.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'), {
  apiVersion: '2024-12-18.acacia'
});

Deno.serve(async (req) => {
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const signature = req.headers.get('stripe-signature');
  
  if (!signature || !webhookSecret) {
    return Response.json({ error: 'Missing signature or secret' }, { status: 400 });
  }

  try {
    const body = await req.text();
    const base44 = createClientFromRequest(req);
    
    // Verify webhook signature
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret
    );

    console.log('Webhook event:', event.type);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription') {
          const userId = session.metadata.user_id;
          const subscription = await stripe.subscriptions.retrieve(session.subscription);

          await base44.asServiceRole.entities.User.update(userId, {
            plan_tier: 'professional',
            stripe_subscription_id: subscription.id,
            subscription_status: 'active',
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: false,
            last_payment_at: new Date().toISOString()
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        
        // Look up user by customer ID
        const users = await base44.asServiceRole.entities.User.filter({ 
          stripe_customer_id: subscription.customer 
        });
        
        if (users.length > 0) {
          const user = users[0];
          const updates = {
            subscription_status: subscription.status,
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end
          };

          // If subscription ended or canceled without cancel_at_period_end, downgrade immediately
          if (subscription.status === 'canceled' && !subscription.cancel_at_period_end) {
            updates.plan_tier = 'starter';
          }

          await base44.asServiceRole.entities.User.update(user.id, updates);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        
        // Look up user by customer ID
        const users = await base44.asServiceRole.entities.User.filter({ 
          stripe_customer_id: subscription.customer 
        });
        
        if (users.length > 0) {
          const user = users[0];
          await base44.asServiceRole.entities.User.update(user.id, {
            plan_tier: 'starter',
            subscription_status: 'canceled',
            cancel_at_period_end: false
          });
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.subscription && invoice.customer) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          
          // Look up user by customer ID
          const users = await base44.asServiceRole.entities.User.filter({ 
            stripe_customer_id: invoice.customer 
          });
          
          if (users.length > 0) {
            const user = users[0];
            await base44.asServiceRole.entities.User.update(user.id, {
              subscription_status: 'active',
              last_payment_at: new Date().toISOString(),
              current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
            });
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription && invoice.customer) {
          // Look up user by customer ID
          const users = await base44.asServiceRole.entities.User.filter({ 
            stripe_customer_id: invoice.customer 
          });
          
          if (users.length > 0) {
            const user = users[0];
            await base44.asServiceRole.entities.User.update(user.id, {
              subscription_status: 'past_due'
            });
          }
        }
        break;
      }
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 400 });
  }
});