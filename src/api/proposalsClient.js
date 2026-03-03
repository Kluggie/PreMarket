import { request } from '@/api/httpClient';

export const proposalsClient = {
  buildQuery(params = {}) {
    const searchParams = new URLSearchParams();

    if (params.query) {
      searchParams.set('query', String(params.query));
    }

    if (params.status) {
      searchParams.set('status', String(params.status));
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
    const response = await request(`/api/proposals${query ? `?${query}` : ''}`);
    return response.proposals || [];
  },

  async listWithMeta(params = {}) {
    const query = this.buildQuery(params);
    const response = await request(`/api/proposals${query ? `?${query}` : ''}`);
    return {
      proposals: response.proposals || [],
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
      responses: response.responses || [],
      evaluations: response.evaluations || [],
      sharedLinks: response.shared_links || [],
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
    await request(`/api/proposals/${encodeURIComponent(String(id || ''))}`, {
      method: 'DELETE',
    });
  },

  async getResponses(id) {
    const response = await request(`/api/proposals/${encodeURIComponent(String(id || ''))}/responses`);
    return response.responses || [];
  },

  async saveResponses(id, responses = []) {
    const response = await request(`/api/proposals/${encodeURIComponent(String(id || ''))}/responses`, {
      method: 'PUT',
      body: JSON.stringify({
        responses: Array.isArray(responses) ? responses : [],
      }),
    });

    return response.responses || [];
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
    return response.evaluations || [];
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

  async close(id, status) {
    // Redirects to the canonical PATCH /api/proposals/:id endpoint (no dedicated /close route)
    return this.update(id, { status });
  },
};
