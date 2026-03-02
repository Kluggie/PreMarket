import { request } from '@/api/httpClient';

export const notificationsClient = {
  async list() {
    const response = await request('/api/notifications');
    return response.notifications || [];
  },

  async markRead(id) {
    await request(`/api/notifications/${encodeURIComponent(String(id || ''))}`, {
      method: 'PATCH',
      body: JSON.stringify({ read: true }),
    });
  },

  async dismiss(id) {
    await request(`/api/notifications/${encodeURIComponent(String(id || ''))}`, {
      method: 'PATCH',
      body: JSON.stringify({ dismissed: true }),
    });
  },
};
