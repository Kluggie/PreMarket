import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const correlationId = `resolve_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  try {
    const base44 = createClientFromRequest(req);

    const { token } = await req.json();
    
    if (!token) {
      return Response.json({
        ok: false,
        error: 'Missing token',
        correlationId
      }, { status: 400 });
    }

    // Find token record
    const tokens = await base44.asServiceRole.entities.EvaluationAccessToken.filter({ token });
    const tokenRecord = tokens[0];
    
    if (!tokenRecord) {
      return Response.json({
        ok: false,
        error: 'Invalid or expired token',
        message: 'This link is invalid or has expired. Please request a new one.',
        correlationId
      }, { status: 404 });
    }

    // Check expiry
    const now = new Date();
    const expiresAt = new Date(tokenRecord.expires_at);
    
    if (now > expiresAt) {
      return Response.json({
        ok: false,
        error: 'Token expired',
        message: 'This link has expired. Please request a new one.',
        correlationId
      }, { status: 401 });
    }

    // Check usage limit
    if (tokenRecord.used_count >= tokenRecord.max_uses) {
      return Response.json({
        ok: false,
        error: 'Token usage limit exceeded',
        message: 'This link has been used too many times. Please request a new one.',
        correlationId
      }, { status: 401 });
    }

    console.log(`[ResolveAccessToken] Token resolved for ${tokenRecord.email}, role: ${tokenRecord.role}, correlationId: ${correlationId}`);

    return Response.json({
      ok: true,
      evaluationItemId: tokenRecord.evaluation_item_id,
      role: tokenRecord.role,
      email: tokenRecord.email,
      usedCount: tokenRecord.used_count,
      maxUses: tokenRecord.max_uses,
      expiresAt: tokenRecord.expires_at,
      correlationId
    });

  } catch (error) {
    console.error('[ResolveAccessToken] Error:', error.message, 'correlationId:', correlationId);
    return Response.json({
      ok: false,
      error: error.message,
      correlationId
    }, { status: 500 });
  }
});