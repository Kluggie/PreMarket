import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const correlationId = `build_public_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ 
        ok: false,
        errorCode: 'UNAUTHORIZED',
        error: 'Unauthorized',
        correlationId 
      }, { status: 401 });
    }

    const { internalReportJson, evaluationResponses } = await req.json();
    
    if (!internalReportJson) {
      return Response.json({
        ok: false,
        errorCode: 'MISSING_INTERNAL_REPORT',
        error: 'Missing internal report',
        correlationId
      }, { status: 400 });
    }

    // Build public report from internal report
    // Remove confidential data and ensure no verbatim quotes of hidden content
    
    const publicReport = JSON.parse(JSON.stringify(internalReportJson));
    
    // Sanitize all sections that might contain confidential data
    const sanitizeField = (value, isConfidential, isPartial) => {
      if (isConfidential) {
        return '[CONFIDENTIAL - NOT DISCLOSED]';
      }
      if (isPartial) {
        return '[PARTIAL DISCLOSURE - HIGH LEVEL ONLY]';
      }
      return value;
    };

    // Process evaluation responses to identify confidential fields
    const confidentialFields = new Set();
    const partialFields = new Set();
    
    if (evaluationResponses && Array.isArray(evaluationResponses)) {
      evaluationResponses.forEach(resp => {
        if (resp.confidentiality_json) {
          Object.entries(resp.confidentiality_json).forEach(([field, level]) => {
            if (level === 'confidential' || level === 'hidden') {
              confidentialFields.add(field);
            } else if (level === 'partial') {
              partialFields.add(field);
            }
          });
        }
        if (resp.visibility === 'hidden') {
          confidentialFields.add(resp.question_id);
        } else if (resp.visibility === 'partial' || resp.visibility === 'range_only') {
          partialFields.add(resp.question_id);
        }
      });
    }

    // Recursively sanitize the report
    const sanitizeObject = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      
      if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item));
      }
      
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        const isConf = confidentialFields.has(key);
        const isPart = partialFields.has(key);
        
        if (typeof value === 'object' && value !== null) {
          sanitized[key] = sanitizeObject(value);
        } else if (typeof value === 'string') {
          // Never include exact verbatim quotes from confidential fields
          if (isConf && value.length > 50) {
            sanitized[key] = '[REDACTED - CONFIDENTIAL]';
          } else if (isPart && value.length > 100) {
            sanitized[key] = value.substring(0, 100) + '... [PARTIAL DISCLOSURE]';
          } else {
            sanitized[key] = value;
          }
        } else {
          sanitized[key] = value;
        }
      }
      
      return sanitized;
    };

    const sanitizedReport = sanitizeObject(publicReport);

    // Add metadata
    sanitizedReport._meta = {
      generated_at: new Date().toISOString(),
      visibility: 'public',
      confidential_fields_count: confidentialFields.size,
      partial_fields_count: partialFields.size
    };

    console.log(`[BuildPublicReport] Success, correlationId: ${correlationId}`);

    return Response.json({
      ok: true,
      publicReportJson: sanitizedReport,
      correlationId
    });

  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[BuildPublicReport] Error:', err.message);
    
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL_ERROR',
      error: err.message,
      correlationId
    }, { status: 500 });
  }
});