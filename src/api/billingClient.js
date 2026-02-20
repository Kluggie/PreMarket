import { request } from '@/api/httpClient';

export const billingClient = {
  async get() {
    const response = await request('/api/billing/status');
    return response.billing;
  },

  async status() {
    const response = await request('/api/billing');
    return response.billing;
  },

  async checkout() {
    const response = await request('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return {
      checkout: response.checkout || null,
      billing: response.billing || null,
    };
  },

  async cancel() {
    const response = await request('/api/billing/cancel', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return response.billing || null;
  },

  async update(input) {
    const response = await request('/api/billing', {
      method: 'PATCH',
      body: JSON.stringify(input || {}),
    });

    return response.billing;
  },
};
