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

    const planTier = String(user.plan_tier || '').trim().toLowerCase();

    // Starter and unknown plans get 1 re-evaluation.
    // All elevated tiers (Early Access, Professional, Enterprise) get 3.
    const STARTER_PLAN_ALIASES = new Set(['starter', 'free', '']);
    const limit = STARTER_PLAN_ALIASES.has(planTier) ? 1 : 3;

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
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('Check re-evaluation limit error:', error);
    return Response.json({ 
      error: err.message 
    }, { status: 500 });
  }
});