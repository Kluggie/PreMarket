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
  const inlineKeys = [
    'GCP_SERVICE_ACCOUNT_JSON',
    'GOOGLE_SERVICE_ACCOUNT_JSON',
    'VERTEX_GCP_SERVICE_ACCOUNT_JSON'
  ];
  for (const key of inlineKeys) {
    const inline = Deno.env.get(key);
    if (inline?.trim()) {
      return stripWrappingQuotes(inline.trim());
    }
  }

  const fileKeys = [
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GCP_SERVICE_ACCOUNT_FILE'
  ];
  for (const key of fileKeys) {
    const jsonPath = Deno.env.get(key);
    if (jsonPath?.trim()) {
      try {
        const filePath = stripWrappingQuotes(jsonPath.trim());
        return (await Deno.readTextFile(filePath)).trim();
      } catch (error) {
        console.warn(`[${correlationId}] Failed to read ${key}: ${toMessage(error)}`);
      }
    }
  }

  const envCandidates: (string | URL)[] = [
    '.env.local',
    '../.env.local',
    new URL('../.env.local', import.meta.url),
    new URL('../../.env.local', import.meta.url),
    new URL('./.env.local', import.meta.url)
  ];
  for (const envPath of envCandidates) {
    try {
      const envText = await Deno.readTextFile(envPath);
      const inlineRegexes = [
        /^\s*(?:export\s+)?GCP_SERVICE_ACCOUNT_JSON\s*=\s*(.+)\s*$/m,
        /^\s*(?:export\s+)?GOOGLE_SERVICE_ACCOUNT_JSON\s*=\s*(.+)\s*$/m,
        /^\s*(?:export\s+)?VERTEX_GCP_SERVICE_ACCOUNT_JSON\s*=\s*(.+)\s*$/m
      ];
      for (const regex of inlineRegexes) {
        const match = envText.match(regex);
        if (match?.[1]) {
          return stripWrappingQuotes(match[1]);
        }
      }

      const pathRegexes = [
        /^\s*(?:export\s+)?GOOGLE_APPLICATION_CREDENTIALS\s*=\s*(.+)\s*$/m,
        /^\s*(?:export\s+)?GCP_SERVICE_ACCOUNT_FILE\s*=\s*(.+)\s*$/m
      ];
      for (const regex of pathRegexes) {
        const match = envText.match(regex);
        if (match?.[1]) {
          const filePath = stripWrappingQuotes(match[1]);
          try {
            return (await Deno.readTextFile(filePath)).trim();
          } catch (error) {
            console.warn(
              `[${correlationId}] Failed to read service account file from ${String(envPath)}: ${toMessage(error)}`
            );
          }
        }
      }
    } catch {
      // ignore missing env file candidates
    }
  }

  const fallbackFiles: (string | URL)[] = [
    '../base44-vertex-key.json',
    '/Users/mac/Desktop/PreMarket/base44-vertex-key.json',
    new URL('../../base44-vertex-key.json', import.meta.url),
    new URL('../base44-vertex-key.json', import.meta.url)
  ];
  for (const fallback of fallbackFiles) {
    try {
      return (await Deno.readTextFile(fallback)).trim();
    } catch {
      // ignore fallback misses
    }
  }

  return null;
}

const validateServiceAccountJson = (raw: string): { ok: true } | { ok: false; reason: string } => {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'Service account JSON is not valid JSON' };
  }

  if (typeof parsed?.client_email !== 'string' || !parsed.client_email.trim()) {
    return { ok: false, reason: 'Service account JSON is missing client_email' };
  }

  if (typeof parsed?.private_key !== 'string' || !parsed.private_key.trim()) {
    return { ok: false, reason: 'Service account JSON is missing private_key' };
  }

  return { ok: true };
};

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
    let vertexErrorCode: string | undefined;
    let summary = response.statusText || 'Request failed';
    try {
      const parsedError = JSON.parse(errorText);
      const parsedPayload = parsedError?.error ?? parsedError;
      if (typeof parsedPayload?.status === 'string' && parsedPayload.status) {
        vertexErrorCode = parsedPayload.status;
      } else if (parsedPayload?.code != null) {
        vertexErrorCode = String(parsedPayload.code);
      }
      if (typeof parsedPayload?.message === 'string' && parsedPayload.message.trim()) {
        summary = parsedPayload.message.trim();
      }
    } catch {
      // keep raw text summary fallback
      if (errorText?.trim()) summary = errorText.trim();
    }
    const err = new Error(`Vertex AI call failed (${response.status}): ${truncate(summary, 180)}`);
    (err as any).vertexStatusCode = response.status;
    (err as any).vertexErrorText = errorText;
    (err as any).vertexErrorCode = vertexErrorCode;
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
      console.error(`[${correlationId}] Missing GCP service account credentials`);
      return Response.json({
        ok: false,
        errorCode: 'VERTEX_MISCONFIGURED',
        error: 'Missing or invalid GCP service account credentials',
        message: 'Vertex credentials are not configured.',
        detailsSafe: 'Set GCP_SERVICE_ACCOUNT_JSON (or GOOGLE_APPLICATION_CREDENTIALS file path) in Base44 secrets.',
        correlationId
      }, { status: 200 });
    }

    const credentialsValidation = validateServiceAccountJson(serviceAccountJson);
    if (!credentialsValidation.ok) {
      const validationReason = (credentialsValidation as { reason: string }).reason;
      console.error(`[${correlationId}] Invalid GCP service account credentials: ${validationReason}`);
      return Response.json({
        ok: false,
        errorCode: 'VERTEX_MISCONFIGURED',
        error: 'Missing or invalid GCP service account credentials',
        message: 'Vertex credentials are not configured.',
        detailsSafe: 'Set GCP_SERVICE_ACCOUNT_JSON (or GOOGLE_APPLICATION_CREDENTIALS file path) in Base44 secrets.',
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
      const parsedVertexErrorCode = typeof (vertexError as any)?.vertexErrorCode === 'string'
        ? (vertexError as any).vertexErrorCode
        : undefined;
      const rawDetails = (vertexError as any)?.vertexErrorText || toMessage(vertexError);
      console.error(
        `[${correlationId}] Vertex call failed status=${parsedStatus ?? 'unknown'} vertexErrorCode=${parsedVertexErrorCode ?? 'unknown'} details=${truncate(rawDetails)}`
      );
      return Response.json({
        ok: false,
        errorCode: 'VERTEX_REQUEST_FAILED',
        error: `Vertex request failed${parsedStatus ? ` (${parsedStatus})` : ''}`,
        message: 'Vertex AI request failed.',
        vertexStatus: parsedStatus,
        vertexErrorCode: parsedVertexErrorCode,
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
