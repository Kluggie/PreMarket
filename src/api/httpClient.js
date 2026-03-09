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

  // Attempt to parse JSON. Track whether parsing succeeded so we can distinguish
  // "valid empty-ish body" from a real parse failure on a 2xx response.
  let body;
  let jsonParsed = false;
  try {
    body = await response.json();
    jsonParsed = true;
  } catch {
    body = {};
  }

  if (!response.ok || body?.ok === false) {
    throw toError(response, body);
  }

  // For successful (2xx) responses where JSON parsing failed — e.g. empty body,
  // HTML error page from a proxy/CDN, or binary content returned by mistake —
  // treat this as a server error rather than silently returning {} which would
  // allow downstream `response.field || fallback` patterns to mask the failure.
  if (!jsonParsed) {
    const err = new Error(`Server returned a non-JSON response for ${method} ${path}`);
    err.status = response.status;
    err.code = 'invalid_response';
    throw err;
  }

  return body;
}
