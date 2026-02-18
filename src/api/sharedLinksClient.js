import { request } from '@/api/httpClient';

export const sharedLinksClient = {
  async create(input) {
    const response = await request('/api/shared-links', {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });

    return response.sharedLink;
  },

  async getByToken(token, { consume = false } = {}) {
    const searchParams = new URLSearchParams();
    if (consume) {
      searchParams.set('consume', 'true');
    }

    const query = searchParams.toString();
    const response = await request(
      `/api/shared-links/${encodeURIComponent(String(token || ''))}${query ? `?${query}` : ''}`,
    );

    return response.sharedLink;
  },
};
