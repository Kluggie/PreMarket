import { request } from './httpClient';

function normalizeApiPath(path) {
  const normalized = String(path || '').trim();
  if (!normalized) {
    return '/api';
  }
  if (normalized.startsWith('/api/')) {
    return normalized;
  }
  if (normalized === '/api') {
    return normalized;
  }
  return normalized.startsWith('/') ? `/api${normalized}` : `/api/${normalized}`;
}

async function requestWithMethod(method, path, body, options = {}) {
  const nextOptions = { ...options, method };
  if (body !== undefined) {
    nextOptions.body = body;
  }
  return request(normalizeApiPath(path), nextOptions);
}

export const apiGatewayClient = {
  request(path, options = {}) {
    return request(normalizeApiPath(path), options);
  },
  get(path, options = {}) {
    return requestWithMethod('GET', path, undefined, options);
  },
  post(path, payload, options = {}) {
    return requestWithMethod('POST', path, JSON.stringify(payload || {}), options);
  },
  put(path, payload, options = {}) {
    return requestWithMethod('PUT', path, JSON.stringify(payload || {}), options);
  },
  patch(path, payload, options = {}) {
    return requestWithMethod('PATCH', path, JSON.stringify(payload || {}), options);
  },
  delete(path, options = {}) {
    return requestWithMethod('DELETE', path, undefined, options);
  },
};

export default apiGatewayClient;
