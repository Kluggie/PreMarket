import { authClient } from '@/api/authClient';

function toError(status, body, fallbackMessage) {
  const error = new Error(body?.error || body?.message || fallbackMessage || 'Request failed');
  error.status = status;
  error.body = body;
  return error;
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await parseJson(response);

  if (!response.ok) {
    throw toError(response.status, payload, `Request failed: ${method} ${path}`);
  }

  return payload;
}

function createEntityApi(entityName) {
  const encodedEntity = encodeURIComponent(entityName);

  return {
    list(sort, limit) {
      const searchParams = new URLSearchParams();

      if (sort) {
        searchParams.set('sort', String(sort));
      }

      if (typeof limit === 'number') {
        searchParams.set('limit', String(limit));
      }

      const query = searchParams.toString();
      return request(`/api/entities/${encodedEntity}${query ? `?${query}` : ''}`);
    },

    filter(filter = {}, sort, limit) {
      return request(`/api/entities/${encodedEntity}/filter`, {
        method: 'POST',
        body: { filter, sort, limit },
      });
    },

    create(data) {
      return request(`/api/entities/${encodedEntity}`, {
        method: 'POST',
        body: data,
      });
    },

    update(id, data) {
      return request(`/api/entities/${encodedEntity}/${encodeURIComponent(String(id))}`, {
        method: 'PATCH',
        body: data,
      });
    },

    delete(id) {
      return request(`/api/entities/${encodedEntity}/${encodeURIComponent(String(id))}`, {
        method: 'DELETE',
      });
    },
  };
}

function createIntegrationProxy(pathParts = []) {
  const call = async (payload = {}) => {
    const endpoint = `/api/integrations/${pathParts.map((part) => encodeURIComponent(part)).join('/')}`;
    return request(endpoint, {
      method: 'POST',
      body: payload,
    });
  };

  return new Proxy(call, {
    get(_target, property) {
      if (property === 'then') {
        return undefined;
      }

      return createIntegrationProxy([...pathParts, String(property)]);
    },

    apply(_target, _thisArg, args) {
      return call(...args);
    },
  });
}

const entityProxy = new Proxy(
  {},
  {
    get(_target, property) {
      return createEntityApi(String(property));
    },
  },
);

const functionsApi = {
  async invoke(name, payload = {}) {
    const data = await request(`/api/functions/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: payload,
    });

    return { data };
  },
};

const appLogsApi = {
  async logUserInApp(_pageName) {
    return { ok: true };
  },
};

export const legacyClient = {
  auth: authClient,
  entities: entityProxy,
  functions: functionsApi,
  integrations: createIntegrationProxy(),
  asServiceRole: {
    entities: entityProxy,
    functions: functionsApi,
    integrations: createIntegrationProxy(),
  },
  appLogs: appLogsApi,
};
