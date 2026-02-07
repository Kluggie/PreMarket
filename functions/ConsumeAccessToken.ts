import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const correlationId = `consume_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
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
        error: 'Token not found',
        correlationId
      }, { status: 404 });
    }

    // Increment usage count
    await base44.asServiceRole.entities.EvaluationAccessToken.update(tokenRecord.id, {
      used_count: (tokenRecord.used_count || 0) + 1
    });

    console.log(`[ConsumeAccessToken] Token consumed for ${tokenRecord.email}, new count: ${tokenRecord.used_count + 1}, correlationId: ${correlationId}`);

    return Response.json({
      ok: true,
      usedCount: tokenRecord.used_count + 1,
      correlationId
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[ConsumeAccessToken] Error:', err.message, 'correlationId:', correlationId);
    return Response.json({
      ok: false,
      error: err.message,
      correlationId
    }, { status: 500 });
  }
});