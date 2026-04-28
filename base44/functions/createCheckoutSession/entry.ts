import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@17.5.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-12-18.acacia'
});

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const priceId = Deno.env.get('PROFESSIONAL_STRIPE_PRICE_ID');
    if (!priceId) {
      return Response.json({ error: 'Stripe price not configured' }, { status: 500 });
    }

    // Get or create Stripe customer
    let customerId = user.stripe_customer_id;
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          user_id: user.id,
          user_email: user.email
        }
      });
      customerId = customer.id;

      // Update user with customer ID
      await base44.asServiceRole.entities.User.update(user.id, {
        stripe_customer_id: customerId
      });
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${req.headers.get('origin')}/settings?upgrade=success`,
      cancel_url: `${req.headers.get('origin')}/pricing?upgrade=canceled`,
      metadata: {
        user_id: user.id,
        user_email: user.email
      }
    });

    return Response.json({ 
      sessionId: session.id,
      url: session.url
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('Checkout error:', error);
    return Response.json({ 
      error: err.message 
    }, { status: 500 });
  }
});