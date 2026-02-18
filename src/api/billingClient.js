import { request } from '@/api/httpClient';

export const billingClient = {
  async get() {
    const response = await request('/api/billing');
    return response.billing;
  },

  async update(input) {
    const response = await request('/api/billing', {
      method: 'PATCH',
      body: JSON.stringify(input || {}),
    });

    return response.billing;
  },
};
