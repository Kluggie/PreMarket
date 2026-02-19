import { request } from '@/api/httpClient';

export const verificationItemsClient = {
  async create(input) {
    const response = await request('/api/verification-items', {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });

    return response.item || null;
  },
};
