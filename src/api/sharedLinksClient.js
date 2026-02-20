import { request } from '@/api/httpClient';

export const sharedLinksClient = {
  async list() {
    const response = await request('/api/shared-links');
    return response.sharedLinks || [];
  },

  async create(input) {
    const response = await request('/api/shared-links', {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });

    return response.sharedLink;
  },

  async getByToken(token, { consume = false, includeDetails = false } = {}) {
    const searchParams = new URLSearchParams();
    if (consume) {
      searchParams.set('consume', 'true');
    }

    const query = searchParams.toString();
    const response = await request(
      `/api/shared-links/${encodeURIComponent(String(token || ''))}${query ? `?${query}` : ''}`,
    );

    if (includeDetails) {
      return {
        sharedLink: response.sharedLink || null,
        responses: response.responses || [],
        evaluations: response.evaluations || [],
        documentComparison: response.documentComparison || null,
      };
    }

    return response.sharedLink;
  },

  async consume(token) {
    const response = await request(`/api/shared-links/${encodeURIComponent(String(token || ''))}/consume`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return response.sharedLink || null;
  },

  async respond(token, input = {}) {
    const response = await request(`/api/shared-links/${encodeURIComponent(String(token || ''))}/respond`, {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });
    return {
      sharedLink: response.sharedLink || null,
      savedResponses: Number(response.savedResponses || 0),
      evaluation: response.evaluation || null,
    };
  },
};
