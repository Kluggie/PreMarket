import { request } from '@/api/httpClient';

export const contactClient = {
  async submit(input = {}) {
    await request('/api/contact', {
      method: 'POST',
      body: JSON.stringify(input || {}),
    });
    return { ok: true };
  },
};
