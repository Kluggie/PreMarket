import { request } from '@/api/httpClient';

export const dashboardClient = {
  async getSummary() {
    const response = await request('/api/dashboard/summary');
    return response.summary || {
      sentCount: 0,
      receivedCount: 0,
      draftsCount: 0,
      mutualInterestCount: 0,
      wonCount: 0,
      lostCount: 0,
      totalCount: 0,
    };
  },

  async getActivity(range = '30') {
    const searchParams = new URLSearchParams();
    if (range) {
      searchParams.set('range', String(range));
    }

    const query = searchParams.toString();
    const response = await request(`/api/dashboard/activity${query ? `?${query}` : ''}`);
    return {
      range: response.range || String(range || '30'),
      points: response.points || [],
    };
  },
};
