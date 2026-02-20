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
};
