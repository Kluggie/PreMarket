import { getRequestHost, getRequestProtocol, json } from './http.js';

export type RuntimeConfig = {
  appBaseUrl: string;
  sessionSecret: string;
  googleClientId: string;
};

export type SessionConfig = {
  appBaseUrl: string;
  sessionSecret: string;
};

export function getGoogleClientId() {
  return (
    process.env.GOOGLE_CLIENT_ID ||
    process.env.VITE_GOOGLE_CLIENT_ID ||
    ''
  ).trim();
}

export function getEnvReadiness() {
  return {
    APP_BASE_URL: Boolean(process.env.APP_BASE_URL),
    SESSION_SECRET: Boolean(process.env.SESSION_SECRET),
    GOOGLE_CLIENT_ID: Boolean(getGoogleClientId()),
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
  };
}

export function getRuntimeConfig(): RuntimeConfig {
  const appBaseUrl = (process.env.APP_BASE_URL || '').trim();
  const sessionSecret = (process.env.SESSION_SECRET || '').trim();
  const googleClientId = getGoogleClientId();

  const missing: string[] = [];

  if (!appBaseUrl) {
    missing.push('APP_BASE_URL');
  }

  if (!sessionSecret) {
    missing.push('SESSION_SECRET');
  }

  if (!googleClientId) {
    missing.push('GOOGLE_CLIENT_ID');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    appBaseUrl,
    sessionSecret,
    googleClientId,
  };
}

export function getSessionConfig(): SessionConfig {
  const appBaseUrl = (process.env.APP_BASE_URL || '').trim();
  const sessionSecret = (process.env.SESSION_SECRET || '').trim();
  const missing: string[] = [];

  if (!appBaseUrl) {
    missing.push('APP_BASE_URL');
  }

  if (!sessionSecret) {
    missing.push('SESSION_SECRET');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    appBaseUrl,
    sessionSecret,
  };
}

export function isProductionDeployment() {
  return process.env.VERCEL_ENV === 'production';
}

function isLocalhostHost(host: string) {
  const normalized = String(host || '').trim().toLowerCase();
  const hostname = normalized.startsWith('[')
    ? normalized.slice(1, normalized.indexOf(']'))
    : normalized.split(':')[0];

  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isApiRequest(req: any) {
  const queryPath = req?.query?.path;
  if (queryPath) {
    return true;
  }

  const rawUrl = String(req?.url || '').trim();
  if (!rawUrl) {
    return false;
  }

  try {
    const parsed = new URL(rawUrl, 'http://local');
    if (parsed.pathname.startsWith('/api/')) {
      return true;
    }
    if (parsed.pathname === '/api') {
      return true;
    }
    if (parsed.searchParams.has('path')) {
      return true;
    }
  } catch {
    if (rawUrl.startsWith('/api/')) {
      return true;
    }
    if (rawUrl === '/api') {
      return true;
    }
  }

  return false;
}

export function shouldUseSecureCookies(req: any, appBaseUrl: string) {
  const requestHost = getRequestHost(req);
  if (isLocalhostHost(requestHost)) {
    return false;
  }

  const requestProtocol = getRequestProtocol(req);
  if (requestProtocol === 'http') {
    return false;
  }

  try {
    const parsed = new URL(appBaseUrl);
    return parsed.protocol === 'https:';
  } catch {
    return process.env.NODE_ENV === 'production';
  }
}

export function toCanonicalAppUrl(appBaseUrl: string, returnTo?: unknown) {
  const canonical = new URL(appBaseUrl);

  if (!returnTo || typeof returnTo !== 'string') {
    return canonical.toString();
  }

  try {
    const parsed = new URL(returnTo, canonical);
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return new URL(path, canonical).toString();
  } catch {
    return canonical.toString();
  }
}

export function enforceCanonicalRedirect(req: any, res: any, appBaseUrl: string) {
  if (!isProductionDeployment()) {
    return false;
  }

  // API routes must stay same-origin for auth/bootstrap fetches and cookie semantics.
  if (isApiRequest(req)) {
    return false;
  }

  const canonical = new URL(appBaseUrl);
  const requestHost = getRequestHost(req);

  if (!requestHost || requestHost === canonical.host.toLowerCase()) {
    return false;
  }

  const target = new URL(req.url || '/', canonical.origin);
  res.statusCode = 307;
  res.setHeader('Location', target.toString());
  res.setHeader('Cache-Control', 'no-store');
  res.end();
  return true;
}

export function respondIfEnvMissing(res: any) {
  const readiness = getEnvReadiness();

  if (
    readiness.APP_BASE_URL &&
    readiness.SESSION_SECRET &&
    readiness.GOOGLE_CLIENT_ID &&
    readiness.DATABASE_URL
  ) {
    return false;
  }

  json(res, 503, {
    ok: false,
    error: {
      code: 'not_configured',
      message: 'Server authentication is not fully configured',
      env: readiness,
    },
  });

  return true;
}

export function respondIfSessionEnvMissing(res: any) {
  const readiness = getEnvReadiness();

  if (readiness.APP_BASE_URL && readiness.SESSION_SECRET) {
    return false;
  }

  json(res, 503, {
    ok: false,
    error: {
      code: 'not_configured',
      message: 'Session/CSRF configuration is missing',
      env: {
        APP_BASE_URL: readiness.APP_BASE_URL,
        SESSION_SECRET: readiness.SESSION_SECRET,
      },
    },
  });

  return true;
}
