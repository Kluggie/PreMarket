import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ 
                ok: false, 
                error: 'Forbidden: Admin access required' 
            }, { status: 403 });
        }

        // Call the custom Vertex Gemini integration
        const result = await base44.asServiceRole.integrations.VertexGemini3Evaluator.GenerateContent({
            projectId: "premarket-484606",
            location: "us-central1",
            model: "gemini-3-flash-preview",
            text: "Reply with exactly: OK",
            temperature: 0.2,
            maxOutputTokens: 32
        });

        return Response.json({
            ok: true,
            text: result?.text || result?.output || JSON.stringify(result),
            raw: result
        });

    } catch (error) {
        return Response.json({
            ok: false,
            error: error.message,
            raw: {
                name: error.name,
                stack: error.stack?.split('\n').slice(0, 3)
            }
        }, { status: 500 });
    }
});