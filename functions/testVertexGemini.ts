import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    let stage = 'start';
    
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ 
                ok: false,
                stage: 'auth_failed',
                text: null,
                status: 403,
                error: 'Forbidden: Admin access required',
                raw: null
            }, { status: 403 });
        }

        console.log('[testVertexGemini] Stage: start - calling integration');
        stage = 'calling_integration';

        // Call the custom Vertex Gemini integration
        const result = await base44.asServiceRole.integrations.VertexGemini3Evaluator.GenerateContent({
            projectId: "premarket-484606",
            location: "us-central1",
            model: "gemini-3-flash-preview",
            text: "Reply with exactly: OK",
            temperature: 0.2,
            maxOutputTokens: 32
        });

        console.log('[testVertexGemini] Stage: integration_returned', result);
        stage = 'integration_returned';

        // Check if result is empty or undefined
        if (!result || (typeof result === 'object' && Object.keys(result).length === 0)) {
            console.error('[testVertexGemini] Integration returned empty result');
            return Response.json({
                ok: false,
                stage: 'empty_result',
                text: null,
                status: null,
                error: 'Integration returned empty result',
                raw: result
            });
        }

        stage = 'done';

        // Extract text from various possible response shapes
        const text = result?.text || 
                    result?.output || 
                    result?.candidates?.[0]?.content?.parts?.[0]?.text ||
                    (typeof result === 'string' ? result : null);

        return Response.json({
            ok: true,
            stage: 'done',
            text: text,
            status: result?.status || 200,
            error: null,
            raw: result
        });

    } catch (error) {
        console.error('[testVertexGemini] Stage: error', stage, error);
        
        return Response.json({
            ok: false,
            stage: 'error',
            text: null,
            status: error.status || null,
            error: error.message || 'Unknown error',
            raw: {
                name: error.name,
                message: error.message,
                status: error.status,
                statusText: error.statusText,
                data: error.data,
                stack: error.stack?.split('\n').slice(0, 5)
            }
        }, { status: 500 });
    }
});