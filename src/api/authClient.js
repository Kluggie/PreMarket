const LOGIN_EVENT_NAME = 'pm:auth:open-login';
const RETURN_TO_KEY = 'pm:return_to';
const CSRF_HEADER_NAME = 'X-CSRF-Token';

let csrfTokenCache = null;
let csrfFetchPromise = null;

function getCurrentPath() {
  if (typeof window === 'undefined') {
    return '/';
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function normalizeReturnTo(returnTo) {
  const fallback = getCurrentPath();

  if (!returnTo || typeof returnTo !== 'string') {
    return fallback;
  }

  if (typeof window === 'undefined') {
    return returnTo.startsWith('/') ? returnTo : fallback;
  }

  try {
    const parsed = new URL(returnTo, window.location.origin);

    if (parsed.origin !== window.location.origin) {
      return fallback;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

function toError(status, body, fallbackMessage) {
  const rawError = body?.error;
  const message =
    (rawError && typeof rawError === 'object' ? rawError.message || rawError.code : rawError) ||
    body?.message ||
    fallbackMessage ||
    'Request failed';
  const error = new Error(String(message));
  error.status = status;
  error.body = body;
  error.code = rawError && typeof rawError === 'object' ? rawError.code : undefined;
  return error;
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function fetchCsrfToken(forceRefresh = false) {
  if (!forceRefresh && csrfTokenCache) {
    return csrfTokenCache;
  }

  if (!forceRefresh && csrfFetchPromise) {
    return csrfFetchPromise;
  }

  csrfFetchPromise = fetch('/api/auth/csrf', {
    method: 'GET',
    credentials: 'include',
  })
    .then(async (response) => {
      const body = await parseJsonResponse(response);

      if (!response.ok || !body?.csrfToken) {
        throw toError(response.status, body, 'Unable to initialize CSRF token');
      }

      csrfTokenCache = body.csrfToken;
      return csrfTokenCache;
    })
    .finally(() => {
      csrfFetchPromise = null;
    });

  return csrfFetchPromise;
}

export const authClient = {
  async getCsrfToken(forceRefresh = false) {
    return fetchCsrfToken(forceRefresh);
  },

  async verifyGoogleIdToken(idToken, returnTo) {
    if (!idToken || typeof idToken !== 'string') {
      throw new Error('Missing Google ID token');
    }

    let csrfToken = await fetchCsrfToken(false);

    const sendVerifyRequest = async (token) => {
      return fetch('/api/auth/google/verify', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          [CSRF_HEADER_NAME]: token,
        },
        body: JSON.stringify({
          idToken,
          csrfToken: token,
          returnTo: normalizeReturnTo(returnTo),
        }),
      });
    };

    let response = await sendVerifyRequest(csrfToken);

    if (response.status === 403) {
      csrfTokenCache = null;
      csrfToken = await fetchCsrfToken(true);
      response = await sendVerifyRequest(csrfToken);
    }

    const body = await parseJsonResponse(response);

    if (!response.ok) {
      throw toError(response.status, body, 'Google authentication failed');
    }

    return body;
  },

  async completeMfaChallenge(codeOrBackup) {
    const response = await fetch('/api/security/mfa/challenge', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        codeOrBackup: String(codeOrBackup || ''),
      }),
    });

    const body = await parseJsonResponse(response);

    if (!response.ok) {
      throw toError(response.status, body, 'MFA challenge failed');
    }

    return body;
  },

  async me() {
    const response = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
    });

    const body = await parseJsonResponse(response);

    if (!response.ok || !body?.user) {
      throw toError(response.status, body, 'Not authenticated');
    }

    return body.user;
  },

  async isAuthenticated() {
    try {
      await this.me();
      return true;
    } catch {
      return false;
    }
  },

  async logout(returnTo) {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const body = await parseJsonResponse(response);

    if (!response.ok) {
      throw toError(response.status, body, 'Logout failed');
    }

    if (typeof window !== 'undefined' && typeof returnTo === 'string' && returnTo.length > 0) {
      window.location.assign(returnTo);
    }

    return body;
  },

  storeReturnTo(returnTo) {
    if (typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.setItem(RETURN_TO_KEY, normalizeReturnTo(returnTo));
  },

  consumeReturnTo() {
    if (typeof window === 'undefined') {
      return '/';
    }

    const storedValue = window.sessionStorage.getItem(RETURN_TO_KEY);

    if (!storedValue) {
      return getCurrentPath();
    }

    window.sessionStorage.removeItem(RETURN_TO_KEY);
    return normalizeReturnTo(storedValue);
  },

  redirectToLogin(returnTo) {
    if (typeof window === 'undefined') {
      return;
    }

    const normalizedReturnTo = normalizeReturnTo(returnTo);
    this.storeReturnTo(normalizedReturnTo);

    window.dispatchEvent(
      new CustomEvent(LOGIN_EVENT_NAME, {
        detail: {
          returnTo: normalizedReturnTo,
        },
      }),
    );
  },
};
