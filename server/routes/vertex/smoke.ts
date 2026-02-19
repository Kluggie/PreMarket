import { createSign } from 'node:crypto';
import { ok } from '../../_lib/api-response.js';
import { requireUser } from '../../_lib/auth.js';
import { ApiError } from '../../_lib/errors.js';
import { getVertexConfig } from '../../_lib/integrations.js';
import { readJsonBody } from '../../_lib/http.js';
import { ensureMethod, withApiRoute } from '../../_lib/route.js';

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signJwt(unsignedToken: string, privateKey: string) {
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  return signer.sign(privateKey, 'base64url');
}

async function fetchGoogleAccessToken(credentials: {
  client_email: string;
  private_key: string;
  token_uri: string;
}) {
  const now = Math.floor(Date.now() / 1000);

  const jwtHeader = base64UrlEncode(
    JSON.stringify({
      alg: 'RS256',
      typ: 'JWT',
    }),
  );

  const jwtPayload = base64UrlEncode(
    JSON.stringify({
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: credentials.token_uri,
      exp: now + 60 * 60,
      iat: now,
    }),
  );

  const unsignedToken = `${jwtHeader}.${jwtPayload}`;
  const signedToken = `${unsignedToken}.${signJwt(unsignedToken, credentials.private_key)}`;

  const response = await fetch(credentials.token_uri, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedToken,
    }),
  });

  if (!response.ok) {
    throw new ApiError(502, 'vertex_auth_failed', 'Unable to authenticate with Vertex AI');
  }

  const payload = (await response.json()) as {
    access_token?: string;
  };

  const accessToken = typeof payload?.access_token === 'string' ? payload.access_token.trim() : '';

  if (!accessToken) {
    throw new ApiError(502, 'vertex_auth_failed', 'Vertex AI access token was not returned');
  }

  return accessToken;
}

function extractModelText(payload: any) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const firstCandidate = candidates[0];
  const parts = Array.isArray(firstCandidate?.content?.parts) ? firstCandidate.content.parts : [];

  const textParts = parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter((part) => part.length > 0);

  return textParts.join('\n').trim();
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/vertex/smoke', async (context) => {
    ensureMethod(req, ['POST']);

    const auth = await requireUser(req, res);
    if (!auth.ok) {
      return;
    }
    context.userId = auth.user.id;

    const vertex = getVertexConfig();
    if (!vertex.ready || !vertex.credentials) {
      throw new ApiError(500, 'server_not_configured', 'Vertex AI integration is not configured');
    }

    const body = await readJsonBody(req);
    const prompt = typeof body.prompt === 'string' && body.prompt.trim().length > 0
      ? body.prompt.trim()
      : 'Reply with: vertex smoke test ok';

    const accessToken = await fetchGoogleAccessToken(vertex.credentials);

    const endpoint =
      `https://${vertex.location}-aiplatform.googleapis.com/v1/projects/` +
      `${encodeURIComponent(vertex.credentials.project_id)}/locations/` +
      `${encodeURIComponent(vertex.location)}/publishers/google/models/` +
      `${encodeURIComponent(vertex.model)}:generateContent`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 128,
          temperature: 0,
        },
      }),
    });

    if (!response.ok) {
      throw new ApiError(502, 'vertex_request_failed', 'Vertex AI request failed');
    }

    const payload = await response.json();

    ok(res, 200, {
      result: {
        model: vertex.model,
        location: vertex.location,
        text: extractModelText(payload),
      },
    });
  });
}
