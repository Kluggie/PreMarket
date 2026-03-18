import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const planTier = String(user.plan_tier || '').trim().toLowerCase();

    // All non-starter tiers (Early Access, Professional, Enterprise) have unlimited proposals
    const STARTER_PLAN_ALIASES = new Set(['starter', 'free', '']);
    if (!STARTER_PLAN_ALIASES.has(planTier)) {
      return Response.json({
        allowed: true,
        limit: 'unlimited',
        used: 0,
      });
    }

    // Starter has 3 proposals per month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const proposals = await base44.entities.Proposal.filter({
      party_a_user_id: user.id,
      created_date: { $gte: startOfMonth.toISOString() }
    });

    const used = proposals.length;
    const limit = 3;
    const allowed = used < limit;

    return Response.json({
      allowed,
      limit,
      used,
      remaining: limit - used
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('Check limit error:', error);
    return Response.json({ 
      error: err.message 
    }, { status: 500 });
  }
});