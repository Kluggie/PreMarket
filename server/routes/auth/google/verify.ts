import {
  enforceCanonicalRedirect,
  getRuntimeConfig,
  respondIfEnvMissing,
  shouldUseSecureCookies,
  toCanonicalAppUrl,
} from '../../../_lib/env.js';
import { json, methodNotAllowed, readJsonBody } from '../../../_lib/http.js';
import { createSessionToken, setSessionCookie } from '../../../_lib/session.js';
import { validateCsrf } from '../../../_lib/csrf.js';

type GoogleTokenInfo = {
  aud?: string;
  iss?: string;
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
  exp?: string;
  name?: string;
  picture?: string;
  hd?: string;
};

async function verifyGoogleIdToken(idToken: string, expectedAudience: string) {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    },
  );

  if (!response.ok) {
    throw new Error('google_token_invalid');
  }

  const tokenInfo = (await response.json()) as GoogleTokenInfo;

  if (tokenInfo.aud !== expectedAudience) {
    throw new Error('google_token_audience_mismatch');
  }

  if (
    tokenInfo.iss !== 'https://accounts.google.com' &&
    tokenInfo.iss !== 'accounts.google.com'
  ) {
    throw new Error('google_token_issuer_invalid');
  }

  const emailVerified = tokenInfo.email_verified === true || tokenInfo.email_verified === 'true';

  if (!emailVerified || !tokenInfo.sub || !tokenInfo.email) {
    throw new Error('google_token_identity_invalid');
  }

  const expiresAt = Number(tokenInfo.exp || 0);

  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new Error('google_token_expired');
  }

  return {
    sub: tokenInfo.sub,
    email: tokenInfo.email,
    name: tokenInfo.name,
    picture: tokenInfo.picture,
    hd: tokenInfo.hd,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST']);
    return;
  }

  if (respondIfEnvMissing(res)) {
    return;
  }

  const config = getRuntimeConfig();

  if (enforceCanonicalRedirect(req, res, config.appBaseUrl)) {
    return;
  }

  const body = await readJsonBody(req);
  const csrfHeader = req.headers?.['x-csrf-token'];
  const csrfToken = (Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader) || body.csrfToken;

  if (!validateCsrf(req, csrfToken, config.sessionSecret)) {
    json(res, 403, { error: 'csrf_validation_failed' });
    return;
  }

  const idTokenCandidate = body.idToken || body.credential;
  const idToken = typeof idTokenCandidate === 'string' ? idTokenCandidate : '';

  if (!idToken) {
    json(res, 400, { error: 'missing_id_token' });
    return;
  }

  try {
    const googleUser = await verifyGoogleIdToken(idToken, config.googleClientId);
    const sessionToken = createSessionToken(googleUser, config.sessionSecret);
    const secure = shouldUseSecureCookies(req, config.appBaseUrl);
    const redirectTo = toCanonicalAppUrl(config.appBaseUrl, body.returnTo);

    setSessionCookie(res, sessionToken, secure);

    json(res, 200, {
      ok: true,
      user: googleUser,
      redirectTo,
    });
  } catch {
    json(res, 401, { error: 'invalid_google_token' });
  }
}
