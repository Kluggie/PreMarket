import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ 
                ok: false,
                outputText: null,
                raw: { error: 'Unauthorized' }
            }, { status: 401 });
        }

        const apiKey = Deno.env.get('GCP_VERTEX_API_KEY');
        if (!apiKey) {
            return Response.json({
                ok: false,
                outputText: null,
                raw: { error: 'GCP_VERTEX_API_KEY not configured' }
            }, { status: 500 });
        }

        const payload = await req.json();
        const {
            projectId,
            location = 'us-central1',
            model = 'gemini-3-flash-preview',
            text,
            temperature = 0.2,
            maxOutputTokens = 1200
        } = payload;

        if (!projectId || !text) {
            return Response.json({
                ok: false,
                outputText: null,
                raw: { error: 'Missing required fields: projectId and text' }
            }, { status: 400 });
        }

        const url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent?key=${apiKey}`;

        const body = {
            contents: [
                {
                    role: 'user',
                    parts: [{ text }]
                }
            ],
            generationConfig: {
                temperature,
                maxOutputTokens
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        const rawResponse = await response.json();

        if (!response.ok) {
            return Response.json({
                ok: false,
                outputText: null,
                raw: {
                    status: response.status,
                    statusText: response.statusText,
                    error: rawResponse
                }
            }, { status: response.status });
        }

        // Extract text from Vertex AI response
        const outputText = rawResponse?.candidates?.[0]?.content?.parts?.[0]?.text || null;

        return Response.json({
            ok: true,
            outputText,
            raw: rawResponse
        });

    } catch (error) {
        console.error('GenerateContent error:', error);
        return Response.json({
            ok: false,
            outputText: null,
            raw: {
                error: error.message,
                name: error.name
            }
        }, { status: 500 });
    }
});