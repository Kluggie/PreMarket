import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { proposal_id } = await req.json();

    if (!proposal_id) {
      return Response.json({ error: 'Missing proposal_id' }, { status: 400 });
    }

    const planTier = user.plan_tier || 'starter';
    
    // Get re-evaluation limit by plan
    const limits = {
      starter: 1,
      professional: 3
    };
    
    const limit = limits[planTier] || 1;

    // Count existing evaluation runs for this proposal
    const evaluations = await base44.entities.EvaluationRun.filter({
      proposal_id: proposal_id
    });

    const used = evaluations.length;
    const allowed = used < limit;

    return Response.json({
      allowed,
      limit,
      used,
      remaining: Math.max(0, limit - used)
    });
  } catch (error) {
    console.error('Check re-evaluation limit error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});