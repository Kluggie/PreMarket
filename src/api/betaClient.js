import { request } from '@/api/httpClient';

function requireCount(response, field) {
  if (typeof response[field] !== 'number') {
    const err = new Error(`Server response missing "${field}" count`);
    err.code = 'invalid_response';
    throw err;
  }
  return response[field];
}

export const betaClient = {
  async getCount() {
    const response = await request('/api/beta-signups/stats');
    // Throw if seatsClaimed is absent — returning 0 would be indistinguishable
    // from "no one has signed up", hiding DB/deploy failures from the UI.
    const claimed = requireCount(response, 'seatsClaimed');
    return {
      claimed,
      limit: typeof response.seatsTotal === 'number' ? response.seatsTotal : 50,
    };
  },

  async apply(input = {}) {
    const response = await request('/api/beta-signups', {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });
    // Throw if seatsClaimed is absent on a successful signup response.
    const claimed = requireCount(response, 'seatsClaimed');
    return {
      claimed,
      limit: typeof response.seatsTotal === 'number' ? response.seatsTotal : 50,
      applied: true,
    };
  },
};
