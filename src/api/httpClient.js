function parseJsonSafely(response) {
  return response
    .json()
    .catch(() => ({}));
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
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const body = await parseJsonSafely(response);

  if (!response.ok || body?.ok === false) {
    throw toError(response, body);
  }

  return body;
}
