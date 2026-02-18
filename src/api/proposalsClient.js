import { request } from '@/api/httpClient';

export const proposalsClient = {
  async list(params = {}) {
    const searchParams = new URLSearchParams();

    if (params.status) {
      searchParams.set('status', String(params.status));
    }

    if (params.limit) {
      searchParams.set('limit', String(params.limit));
    }

    const query = searchParams.toString();
    const response = await request(`/api/proposals${query ? `?${query}` : ''}`);
    return response.proposals || [];
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
