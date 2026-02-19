function parseJsonSafely(response) {
  return response.json().catch(() => ({}));
}

function toError(response, body) {
  const errorMessage = body?.error?.message || body?.message || 'Request failed';
  const errorCode = body?.error?.code || 'request_failed';
  const error = new Error(errorMessage);
  error.status = response.status;
  error.code = errorCode;
  error.body = body;
  return error;
}

export async function request(path, options = {}) {
  const headers = new Headers(options.headers || undefined);

  // Only set JSON content-type if caller didn't provide and body isn't FormData
  const isFormData =
    typeof FormData !== 'undefined' && options.body instanceof FormData;
  const method = String(options.method || 'GET').toUpperCase();

  if (!headers.has('Content-Type') && !isFormData && method !== 'GET' && options.body != null) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers,
  });

  const body = await parseJsonSafely(response);

  if (!response.ok || body?.ok === false) {
    throw toError(response, body);
  }

  return body;
}
