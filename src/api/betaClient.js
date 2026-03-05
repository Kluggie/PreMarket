import { request } from '@/api/httpClient';

export const betaClient = {
  async getCount() {
    const response = await request('/api/beta-signups/stats');
    return {
      claimed: Number(response.seatsClaimed || 0),
      limit: Number(response.seatsTotal || 50),
    };
  },

  async apply(input = {}) {
    const response = await request('/api/beta-signups', {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });

    return {
      claimed: Number(response.seatsClaimed || 0),
      limit: Number(response.seatsTotal || 50),
      applied: true,
    };
  },
};
