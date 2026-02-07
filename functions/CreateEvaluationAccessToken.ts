import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const correlationId = `token_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ 
        ok: false, 
        error: 'Unauthorized',
        correlationId 
      }, { status: 401 });
    }

    const { evaluationItemId, email, role } = await req.json();
    
    if (!evaluationItemId || !email || !role) {
      return Response.json({
        ok: false,
        error: 'Missing required fields: evaluationItemId, email, role',
        correlationId
      }, { status: 400 });
    }

    if (!['party_a', 'party_b'].includes(role)) {
      return Response.json({
        ok: false,
        error: 'Invalid role. Must be party_a or party_b',
        correlationId
      }, { status: 400 });
    }

    // Generate secure random token
    const token = `eval_${Math.random().toString(36).substring(2)}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2)}`;
    
    // Set expiry to 14 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);

    const tokenRecord = await base44.asServiceRole.entities.EvaluationAccessToken.create({
      token,
      evaluation_item_id: evaluationItemId,
      email,
      role,
      expires_at: expiresAt.toISOString(),
      max_uses: 20,
      used_count: 0
    });

    console.log(`[CreateEvaluationAccessToken] Created token for ${email}, role: ${role}, correlationId: ${correlationId}`);

    return Response.json({
      ok: true,
      token,
      expiresAt: expiresAt.toISOString(),
      correlationId
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[CreateEvaluationAccessToken] Error:', err.message, 'correlationId:', correlationId);
    return Response.json({
      ok: false,
      error: err.message,
      correlationId
    }, { status: 500 });
  }
});