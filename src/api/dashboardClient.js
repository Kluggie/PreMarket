import { request } from '@/api/httpClient';

export const dashboardClient = {
  async getSummary(range = null) {
    const searchParams = new URLSearchParams();
    if (range) {
      searchParams.set('range', String(range));
    }
    const query = searchParams.toString();
    const response = await request(`/api/dashboard/summary${query ? `?${query}` : ''}`);
    // request() throws on non-2xx, on 200+non-JSON, and on body.ok===false.
    // If summary is still missing after a successful response, throw rather than
    // silently returning fake zeroes — an API failure must not look like
    // "0 proposals" to the user.
    if (!response.summary || typeof response.summary !== 'object') {
      const error = new Error('Dashboard summary missing from server response');
      error.code = 'invalid_response';
      throw error;
    }
    return response.summary;
  },

  async getActivity(range = '30') {
    const searchParams = new URLSearchParams();
    if (range) {
      searchParams.set('range', String(range));
    }

    const query = searchParams.toString();
    const response = await request(`/api/dashboard/activity${query ? `?${query}` : ''}`);
    // Throw if the expected structure is absent — prefer explicit failure over
    // silently returning an empty chart that looks like "no proposal activity".
    if (!response || typeof response !== 'object') {
      const error = new Error('Dashboard activity missing from server response');
      error.code = 'invalid_response';
      throw error;
    }
    return {
      range: response.range || String(range || '30'),
      points: Array.isArray(response.points) ? response.points : [],
    };
  },
};
