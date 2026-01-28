import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Creates an OAuth2 access token using Google Service Account JWT bearer flow
 */
async function getAccessToken(serviceAccountJson) {
  const serviceAccount = JSON.parse(serviceAccountJson);
  const { client_email, private_key } = serviceAccount;

  // Create JWT header
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  // Create JWT payload
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: client_email,
    sub: client_email,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    iat: now,
    exp: now + 3600
  };

  // Encode header and payload
  const encoder = new TextEncoder();
  const base64UrlEncode = (data) => {
    return btoa(String.fromCharCode(...new Uint8Array(data)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const headerEncoded = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadEncoded = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signatureInput = `${headerEncoded}.${payloadEncoded}`;

  // Import private key
  const pemKey = private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(pemKey), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );

  // Sign the JWT
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    encoder.encode(signatureInput)
  );

  const signatureEncoded = base64UrlEncode(signature);
  const jwt = `${signatureInput}.${signatureEncoded}`;

  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

/**
 * Calls Vertex AI generateContent using OAuth2 access token
 */
async function callVertexAI({ projectId, location, model, text, temperature, maxOutputTokens, thinkingBudget }, accessToken) {
  const url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text }]
      }
    ],
    generationConfig: {
      temperature,
      maxOutputTokens,
      thinkingConfig: {
        thinkingBudget
      }
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vertex AI call failed (${response.status}): ${errorText}`);
  }

  return await response.json();
}

Deno.serve(async (req) => {
  const correlationId = `gencontent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      console.log(`[${correlationId}] Unauthorized access attempt`);
      return Response.json({ 
        ok: false,
        errorCode: 'UNAUTHORIZED',
        error: 'Unauthorized',
        correlationId
      }, { status: 401 });
    }

    const payload = await req.json().catch(() => ({}));
    const {
      projectId = 'premarket-484606',
      location = 'global',
      model = 'gemini-3-flash-preview',
      text,
      temperature = 0.2,
      maxOutputTokens = 1200,
      thinkingBudget = 0
    } = payload;

    // Validate required params
    if (!text) {
      console.log(`[${correlationId}] Missing text parameter`);
      return Response.json({
        ok: false,
        errorCode: 'MISSING_TEXT',
        error: 'Missing required parameter: text',
        correlationId
      }, { status: 400 });
    }

    // Check payload size
    const textLength = text.length;
    console.log(`[${correlationId}] Text length: ${textLength} chars`);
    
    if (textLength > 500000) {
      console.log(`[${correlationId}] Text too large: ${textLength} chars`);
      return Response.json({
        ok: false,
        errorCode: 'PROMPT_TOO_LARGE',
        error: 'Input text is too large (>500k chars). Please reduce the content.',
        correlationId
      }, { status: 400 });
    }

    // Get service account JSON from secrets
    const serviceAccountJson = Deno.env.get('GCP_SERVICE_ACCOUNT_JSON');
    if (!serviceAccountJson) {
      console.error(`[${correlationId}] GCP_SERVICE_ACCOUNT_JSON not configured`);
      return Response.json({
        ok: false,
        errorCode: 'VERTEX_AUTH',
        error: 'GCP service account not configured',
        correlationId
      }, { status: 500 });
    }

    // Get OAuth2 access token
    let accessToken;
    try {
      accessToken = await getAccessToken(serviceAccountJson);
      console.log(`[${correlationId}] OAuth token generated successfully`);
    } catch (tokenError) {
      console.error(`[${correlationId}] Token generation failed:`, tokenError.message);
      return Response.json({
        ok: false,
        errorCode: 'VERTEX_AUTH',
        error: 'Failed to generate OAuth token',
        correlationId
      }, { status: 500 });
    }

    // Call Vertex AI
    let vertexResponse;
    try {
      vertexResponse = await callVertexAI(
        { projectId, location, model, text, temperature, maxOutputTokens, thinkingBudget },
        accessToken
      );
      console.log(`[${correlationId}] Vertex AI call successful`);
    } catch (vertexError) {
      console.error(`[${correlationId}] Vertex AI call failed:`, vertexError.message);
      
      // Parse status code from error
      let statusCode = 500;
      if (vertexError.message.includes('(401)')) statusCode = 401;
      else if (vertexError.message.includes('(403)')) statusCode = 403;
      else if (vertexError.message.includes('(429)')) statusCode = 429;
      
      return Response.json({
        ok: false,
        errorCode: statusCode === 401 || statusCode === 403 ? 'VERTEX_AUTH' : 'VERTEX_HTTP',
        error: `Vertex AI error (HTTP ${statusCode})`,
        details: vertexError.message,
        correlationId
      }, { status: 500 });
    }

    // Extract output text from candidates
    let outputText = null;
    if (vertexResponse.candidates && vertexResponse.candidates.length > 0) {
      const parts = vertexResponse.candidates[0].content?.parts || [];
      outputText = parts.map(part => part.text || '').join('');
    }

    if (!outputText) {
      console.warn(`[${correlationId}] Empty output from Vertex AI`);
    }

    return Response.json({
      ok: true,
      outputText,
      raw: vertexResponse,
      correlationId
    });

  } catch (error) {
    console.error(`[${correlationId}] Unexpected error:`, error.message);
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL',
      outputText: null,
      error: error.message,
      correlationId,
      raw: {
        error: error.message
      }
    }, { status: 500 });
  }
});