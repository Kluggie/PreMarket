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
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Allow service role calls (no user check needed when called from backend)
    // Only check for admin when called directly by users
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const payload = await req.json();
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
      return Response.json({
        ok: false,
        error: 'Missing required parameter: text'
      }, { status: 400 });
    }

    // Get service account JSON from secrets
    const serviceAccountJson = Deno.env.get('GCP_SERVICE_ACCOUNT_JSON');
    if (!serviceAccountJson) {
      return Response.json({
        ok: false,
        error: 'GCP_SERVICE_ACCOUNT_JSON secret not configured'
      }, { status: 500 });
    }

    // Get OAuth2 access token
    const accessToken = await getAccessToken(serviceAccountJson);

    // Call Vertex AI
    const vertexResponse = await callVertexAI(
      { projectId, location, model, text, temperature, maxOutputTokens, thinkingBudget },
      accessToken
    );

    // Extract output text from candidates
    let outputText = null;
    if (vertexResponse.candidates && vertexResponse.candidates.length > 0) {
      const parts = vertexResponse.candidates[0].content?.parts || [];
      outputText = parts.map(part => part.text || '').join('');
    }

    return Response.json({
      ok: true,
      outputText,
      raw: vertexResponse
    });

  } catch (error) {
    // Log error without exposing secrets
    console.error('GenerateContent error:', error.message);
    return Response.json({
      ok: false,
      outputText: null,
      error: error.message,
      raw: {
        error: error.message
      }
    }, { status: 500 });
  }
});