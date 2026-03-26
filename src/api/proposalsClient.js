import { request } from '@/api/httpClient';

function requireArray(response, field) {
  if (!Array.isArray(response[field])) {
    const err = new Error(`Server response missing "${field}" array`);
    err.code = 'invalid_response';
    throw err;
  }
  return response[field];
}

export const proposalsClient = {
  buildQuery(params = {}) {
    const searchParams = new URLSearchParams();

    if (params.query) {
      searchParams.set('query', String(params.query));
    }

    if (params.status) {
      searchParams.set('status', String(params.status));
    }

    if (params.origin) {
      searchParams.set('origin', String(params.origin));
    }

    if (params.inbox) {
      searchParams.set('inbox', String(params.inbox));
    }

    if (params.tab) {
      searchParams.set('tab', String(params.tab));
    }

    if (params.cursor) {
      searchParams.set('cursor', String(params.cursor));
    }

    if (params.limit) {
      searchParams.set('limit', String(params.limit));
    }

    return searchParams.toString();
  },

  async list(params = {}) {
    const query = this.buildQuery(params);
    // request() throws on non-2xx (auth failure, DB error → 503, etc.).
    // requireArray() throws if proposals is absent on a 2xx response — that
    // would be a server-side bug, and should not silently look like "no data".
    const response = await request(`/api/proposals${query ? `?${query}` : ''}`);
    return requireArray(response, 'proposals');
  },

  async listWithMeta(params = {}) {
    const query = this.buildQuery(params);
    const response = await request(`/api/proposals${query ? `?${query}` : ''}`);
    return {
      proposals: requireArray(response, 'proposals'),
      page: response.page || {
        limit: Number(params.limit || 25),
        nextCursor: null,
        hasMore: false,
      },
    };
  },

  async create(input) {
    const response = await request('/api/proposals', {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });

    return response.proposal;
  },

  async getById(id) {
    const response = await request(`/api/proposals/${encodeURIComponent(String(id || ''))}`);
    return response.proposal || null;
  },

  async getDetail(id) {
    const response = await request(`/api/proposals/${encodeURIComponent(String(id || ''))}`);
    return {
      proposal: response.proposal || null,
      responses: requireArray(response, 'responses'),
      evaluations: requireArray(response, 'evaluations'),
      sharedLinks: requireArray(response, 'shared_links'),
      versions: requireArray(response, 'versions'),
    };
  },

  async update(id, input) {
    const response = await request(`/api/proposals/${encodeURIComponent(String(id || ''))}`, {
      method: 'PATCH',
      body: JSON.stringify(input || {}),
    });

    return response.proposal;
  },

  async remove(id) {
    return request(`/api/proposals/${encodeURIComponent(String(id || ''))}`, {
      method: 'DELETE',
    });
  },

  async getResponses(id) {
    const response = await request(`/api/proposals/${encodeURIComponent(String(id || ''))}/responses`);
    return requireArray(response, 'responses');
  },

  async saveResponses(id, responses = []) {
    const response = await request(`/api/proposals/${encodeURIComponent(String(id || ''))}/responses`, {
      method: 'PUT',
      body: JSON.stringify({
        responses: Array.isArray(responses) ? responses : [],
      }),
    });
    return requireArray(response, 'responses');
  },

  async send(id, input = {}) {
    const response = await request(`/api/proposals/${encodeURIComponent(String(id || ''))}/send`, {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });

    return {
      proposal: response.proposal || null,
      sharedLink: response.sharedLink || null,
    };
  },

  async evaluate(id, input = {}) {
    const response = await request(`/api/proposals/${encodeURIComponent(String(id || ''))}/evaluate`, {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });

    return {
      evaluation: response.evaluation || null,
      proposal: response.proposal || null,
    };
  },

  async getEvaluations(id) {
    const response = await request(`/api/proposals/${encodeURIComponent(String(id || ''))}/evaluations`);
    return requireArray(response, 'evaluations');
  },

  async archive(id) {
    const response = await request(`/api/proposals/${encodeURIComponent(String(id || ''))}/archive`, {
      method: 'PATCH',
    });
    return response.proposal || null;
  },

  async unarchive(id) {
    const response = await request(`/api/proposals/${encodeURIComponent(String(id || ''))}/unarchive`, {
      method: 'PATCH',
    });
    return response.proposal || null;
  },

  async markOutcome(id, outcome) {
    const response = await request(`/api/proposals/${encodeURIComponent(String(id || ''))}/outcome`, {
      method: 'POST',
      body: JSON.stringify({ outcome }),
    });
    return response.proposal || null;
  },

  async close(id, status) {
    return this.markOutcome(id, status);
  },
};
