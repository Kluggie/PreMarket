import { request } from '@/api/httpClient';

export const contactClient = {
  async submit(input = {}) {
    const response = await request('/api/contact', {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });

    return {
      request: response.request || null,
      delivery: response.delivery || 'email',
    };
  },
};
