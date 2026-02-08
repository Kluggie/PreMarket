import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const MAX_VERTEX_ERROR_DETAILS = 500;

const toMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const truncate = (value: string | null | undefined, max = MAX_VERTEX_ERROR_DETAILS): string => {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}...` : value;
};

const stripWrappingQuotes = (value: string): string => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

async function loadServiceAccountJson(correlationId: string): Promise<string | null> {
  const inline = Deno.env.get('GCP_SERVICE_ACCOUNT_JSON');
  if (inline?.trim()) {
    return inline.trim();
  }

  const jsonPath = Deno.env.get('GCP_SERVICE_ACCOUNT_FILE');
  if (jsonPath?.trim()) {
    try {
      return (await Deno.readTextFile(jsonPath.trim())).trim();
    } catch (error) {
      console.warn(`[${correlationId}] Failed to read GCP_SERVICE_ACCOUNT_FILE: ${toMessage(error)}`);
    }
  }

  for (const envPath of ['.env.local', '../.env.local']) {
    try {
      const envText = await Deno.readTextFile(envPath);
      const match = envText.match(/^GCP_SERVICE_ACCOUNT_JSON=(.+)$/m);
      if (match && match[1]) {
        return stripWrappingQuotes(match[1]);
      }
    } catch {
      // ignore local env fallback misses
    }
  }

  return null;
}

/**
 * Creates an OAuth2 access token using Google Service Account JWT bearer flow
 */
async function getAccessToken(serviceAccountJson: string) {
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
async function callVertexAI({
  projectId,
  location,
  model,
  text,
  temperature,
  maxOutputTokens,
  thinkingBudget
}: {
  projectId: string;
  location: string;
  model: string;
  text: string;
  temperature: number;
  maxOutputTokens: number;
  thinkingBudget: number;
}, accessToken: string) {
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
    const err = new Error(`Vertex AI call failed (${response.status})`);
    (err as any).vertexStatusCode = response.status;
    (err as any).vertexErrorText = errorText;
    throw err;
  }

  return await response.json();
}

Deno.serve(async (req) => {
  const correlationId = `gencontent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    console.log(
      `[${correlationId}] caller=${user?.id ? `user:${user.id}` : 'service_or_anonymous'}`
    );

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
    if (typeof text !== 'string' || !text.trim()) {
      console.log(`[${correlationId}] Missing text parameter`);
      return Response.json({
        ok: false,
        errorCode: 'MISSING_TEXT',
        error: 'Missing required parameter: text',
        message: 'The text field is required.',
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
    const serviceAccountJson = await loadServiceAccountJson(correlationId);
    if (!serviceAccountJson) {
      console.error(`[${correlationId}] GCP_SERVICE_ACCOUNT_JSON not configured`);
      return Response.json({
        ok: false,
        errorCode: 'VERTEX_MISCONFIGURED',
        error: 'Missing GCP_SERVICE_ACCOUNT_JSON',
        message: 'Vertex credentials are not configured.',
        detailsSafe: 'Set GCP_SERVICE_ACCOUNT_JSON in Base44 secrets or local .env.local',
        correlationId
      }, { status: 200 });
    }

    // Get OAuth2 access token
    let accessToken;
    try {
      accessToken = await getAccessToken(serviceAccountJson);
      console.log(`[${correlationId}] OAuth token generated successfully`);
    } catch (tokenError) {
      const message = toMessage(tokenError);
      console.error(`[${correlationId}] Token generation failed:`, message);
      return Response.json({
        ok: false,
        errorCode: 'VERTEX_AUTH',
        error: 'Failed to generate OAuth token',
        message: 'Could not authenticate with Vertex AI.',
        detailsSafe: truncate(message),
        correlationId
      }, { status: 200 });
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
      const parsedStatus = typeof (vertexError as any)?.vertexStatusCode === 'number'
        ? (vertexError as any).vertexStatusCode
        : undefined;
      const rawDetails = (vertexError as any)?.vertexErrorText || toMessage(vertexError);
      const errorCode =
        parsedStatus === 401 || parsedStatus === 403
          ? 'VERTEX_AUTH'
          : parsedStatus === 429
            ? 'VERTEX_RATE_LIMITED'
            : 'VERTEX_REQUEST_FAILED';
      console.error(
        `[${correlationId}] Vertex AI call failed status=${parsedStatus ?? 'unknown'} details=${truncate(rawDetails)}`
      );
      return Response.json({
        ok: false,
        errorCode,
        error: toMessage(vertexError),
        message: 'Vertex AI request failed.',
        vertexStatusCode: parsedStatus,
        detailsSafe: truncate(rawDetails),
        correlationId
      }, { status: 200 });
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
    const message = toMessage(error);
    console.error(`[${correlationId}] Unexpected error:`, message);
    return Response.json({
      ok: false,
      errorCode: 'INTERNAL',
      outputText: null,
      error: message,
      message: 'GenerateContent failed with an internal error.',
      detailsSafe: truncate(message),
      correlationId,
      raw: {
        error: message
      }
    }, { status: 500 });
  }
});
