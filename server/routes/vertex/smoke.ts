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

function allowPublicSmoke() {
  if (String(process.env.ALLOW_PUBLIC_VERTEX_SMOKE || '').trim() === '1') {
    return true;
  }

  return String(process.env.NODE_ENV || '').trim() !== 'production';
}

function pickPrompt(req: any, body: Record<string, unknown>) {
  const queryPromptRaw = Array.isArray(req?.query?.prompt) ? req.query.prompt[0] : req?.query?.prompt;
  const queryPrompt = typeof queryPromptRaw === 'string' ? queryPromptRaw.trim() : '';
  if (queryPrompt) {
    return queryPrompt;
  }

  const bodyPrompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (bodyPrompt) {
    return bodyPrompt;
  }

  return 'Reply with: vertex smoke test ok';
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function pickModel(req: any, body: Record<string, unknown>) {
  const queryModelRaw = Array.isArray(req?.query?.model) ? req.query.model[0] : req?.query?.model;
  const queryModel = asText(queryModelRaw);
  if (queryModel) {
    return queryModel;
  }
  return asText(body?.model);
}

function buildModelCandidates(preferredModel: string) {
  const fallbacks = [
    preferredModel,
    'gemini-2.0-flash-001',
    'gemini-1.5-flash-001',
    'gemini-1.5-flash',
    'gemini-1.5-flash-002',
  ].filter(Boolean);

  const seen = new Set<string>();
  return fallbacks.filter((model) => {
    const normalized = String(model || '').trim();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

export default async function handler(req: any, res: any) {
  await withApiRoute(req, res, '/api/vertex/smoke', async (context) => {
    ensureMethod(req, ['GET', 'POST']);

    const vertex = getVertexConfig();
    if (!vertex.ready || !vertex.credentials) {
      throw new ApiError(501, 'not_configured', 'Vertex AI integration is not configured');
    }

    if (!allowPublicSmoke()) {
      const auth = await requireUser(req, res);
      if (!auth.ok) {
        return;
      }
      context.userId = auth.user.id;
    }

    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    const prompt = pickPrompt(req, body);

    const accessToken = await fetchGoogleAccessToken(vertex.credentials);
    const projectId = asText(process.env.GCP_PROJECT_ID) || vertex.credentials.project_id;
    const location = asText(process.env.GCP_LOCATION) || vertex.location;
    const preferredModel =
      pickModel(req, body) || asText(process.env.VERTEX_MODEL) || vertex.model;
    const modelCandidates = buildModelCandidates(preferredModel);

    let selectedModel = preferredModel;
    let payload: any = null;
    let lastStatus = 0;
    let lastMessage = '';

    for (const candidateModel of modelCandidates) {
      const endpoint =
        `https://${location}-aiplatform.googleapis.com/v1/projects/` +
        `${encodeURIComponent(projectId)}/locations/` +
        `${encodeURIComponent(location)}/publishers/google/models/` +
        `${encodeURIComponent(candidateModel)}:generateContent`;

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

      if (response.ok) {
        selectedModel = candidateModel;
        payload = await response.json();
        break;
      }

      const details = await response.text().catch(() => '');
      lastStatus = response.status;
      lastMessage = details ? details.slice(0, 400) : '';
      const modelMissing = response.status === 404 && /publisher model/i.test(details);
      if (modelMissing) {
        continue;
      }

      throw new ApiError(502, 'vertex_request_failed', 'Vertex AI request failed', {
        upstreamStatus: response.status,
        upstreamMessage: lastMessage || null,
        triedModels: modelCandidates,
      });
    }

    if (!payload) {
      throw new ApiError(502, 'vertex_request_failed', 'Vertex AI request failed', {
        upstreamStatus: lastStatus || 404,
        upstreamMessage: lastMessage || 'No accessible Vertex model found for this project',
        triedModels: modelCandidates,
      });
    }

    ok(res, 200, {
      ok: true,
      configured: true,
      projectId,
      location,
      model: selectedModel,
      result: { text: extractModelText(payload) },
    });
  });
}
