import { request } from '@/api/httpClient';

export const betaClient = {
  async getCount() {
    const response = await request('/api/beta/count');
    return {
      claimed: Number(response.claimed || 0),
      limit: Number(response.limit || 50),
    };
  },

  async apply(input = {}) {
    const response = await request('/api/beta/apply', {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });

    return {
      claimed: Number(response.claimed || 0),
      limit: Number(response.limit || 50),
      applied: Boolean(response.applied),
    };
  },
};
